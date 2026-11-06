/**
 * Mudança de sistema (E4, 05/11/2026): quem é quem, para não duplicar.
 * Puro: trabalha sobre um índice em memória dos cadastros da agência, que o
 * ensaio e a aplicação montam do banco e vão acrescentando o que "criam".
 *
 * Regras (as mesmas do resto do sistema):
 * - pessoa: CPF/CNPJ manda (só dígitos). E-mail ou telefone igual SÓ junta
 *   quando o nome também é o mesmo (regra do CRM: casal, escritório e
 *   familiar dividem e-mail e telefone). Sem documento, o nome junta quando
 *   só UMA pessoa tem esse nome e os documentos não se contradizem (a mesma
 *   escada de fornecedor-sync.ts). Dois homônimos sem documento: ninguém
 *   escolhe por sorteio, a linha volta pedindo o CPF/CNPJ;
 * - categoria: nome sem acento e sem caixa, dentro do tipo (receita ou
 *   despesa), preferindo a do mesmo grupo;
 * - centro de custo: nome sem caixa;
 * - conta bancária: banco + agência + conta (só dígitos) ou o nome;
 * - título: pessoa + documento + vencimento + valor + parcela (chave natural).
 */
import { nomeComparavel } from '../fornecedor-sync';
import { emailComparavel, telefoneComparavel } from '../plataformas/conciliacao';
import type { Movimento } from './interpretar';
import { normalizar } from './valores';

export type PapelSimples = 'cliente' | 'fornecedor';

export interface PessoaConhecida {
  id: string;
  papel: PapelSimples;
  nome: string;
  razao_social: string;
  documento: string;
  email: string;
  telefones: string[];
  /** Criada por este lote (no ensaio, "vai ser criada"). */
  doLote: boolean;
}

export interface CategoriaConhecida {
  id: string;
  nome: string;
  tipo: 'RECEITA' | 'DESPESA';
  pai_id: string | null;
  codigo: string;
  doLote: boolean;
}

export interface CentroConhecido { id: string; nome: string; doLote: boolean }

export interface ContaConhecida {
  id: string;
  nome: string;
  banco: string;
  agencia: string;
  numero: string;
  /** Já tem movimento aqui (saldo diferente de zero ou baixa registrada). */
  temMovimento: boolean;
  doLote: boolean;
}

/** Título em aberto que já existe aqui (para vincular em vez de duplicar). */
export interface TituloConhecido {
  id: string;
  tabela: 'contas_pagar' | 'contas_receber';
  pessoa_id: string;
  vencimento: string;
  valor: number;
  documento: string;
}

export interface IndiceDeCadastros {
  pessoas: PessoaConhecida[];
  categorias: CategoriaConhecida[];
  centros: CentroConhecido[];
  contas: ContaConhecida[];
  titulos: TituloConhecido[];
  /** Chaves naturais de títulos já trazidos por outra mudança (não desfeita): chave → onde. */
  chavesImportadas: Map<string, string>;
  // ---- Histórico (E7) ----
  /** Vendas trazidas do sistema anterior (por qualquer mudança não desfeita). */
  vendas: VendaConhecida[];
  /** Registros do histórico (faturas, notas, comissões pagas, reembolsos, créditos) já trazidos por OUTRA mudança: "tipo:chave" → onde. */
  registros: Map<string, string>;
  /** Pessoas nas funções de comissão (para as metas). */
  pessoasFuncao: PessoaNaFuncaoConhecida[];
  /** Baixas (dinheiro que entrou ou saiu) para ligar as linhas do extrato a elas. */
  baixas: BaixaConhecida[];
  /** Títulos que ESTA mudança criou (para ligar à venda e ao reembolso). */
  titulosDoLote: TituloDoLote[];
}

export interface VendaConhecida { id: string; numero_anterior: string; doLote: boolean }
export interface PessoaNaFuncaoConhecida { id: string; pessoa_nome: string; funcao_nome: string }
export interface BaixaConhecida {
  id: string;
  conta_id: string;
  data: string;
  /** Centavos que entraram ou saíram da conta. */
  valor: number;
  entrada: boolean;
  pessoa_id: string;
  titulo_id: string;
  doLote: boolean;
  /** Já ligada a uma linha do extrato nesta mudança. */
  ligada?: boolean;
}
export interface TituloDoLote {
  tabela: 'contas_pagar' | 'contas_receber';
  id: string;
  pessoa_id: string;
  valor: number;
  venda: string;
  liquidado: boolean;
  /** Já ligado a um reembolso. */
  reembolso?: boolean;
}

export function indiceVazio(): IndiceDeCadastros {
  return {
    pessoas: [], categorias: [], centros: [], contas: [], titulos: [], chavesImportadas: new Map(),
    vendas: [], registros: new Map(), pessoasFuncao: [], baixas: [], titulosDoLote: [],
  };
}

const dig = (v: string) => String(v ?? '').replace(/\D/g, '');

// ---------------------------------------------------------------------------
// Pessoa

export interface PessoaProcurada {
  nome: string;
  razao_social?: string;
  documento?: string;
  email?: string;
  telefones?: string[];
}

export type ResultadoDaPessoa =
  | { tipo: 'achou'; pessoa: PessoaConhecida; como: 'documento' | 'email' | 'telefone' | 'nome'; avisos: string[] }
  | { tipo: 'nova'; avisos: string[] }
  | { tipo: 'ambigua'; motivo: string };

function nomesDe(p: { nome: string; razao_social?: string }): Set<string> {
  return new Set([nomeComparavel(p.nome), nomeComparavel(p.razao_social ?? '')].filter(Boolean));
}

function mesmoNome(a: { nome: string; razao_social?: string }, b: { nome: string; razao_social?: string }): boolean {
  const na = nomesDe(a);
  for (const n of nomesDe(b)) if (na.has(n)) return true;
  return false;
}

/** Acha a pessoa no papel pedido (cliente ou fornecedor) pelas regras do cabeçalho. */
export function acharPessoa(indice: IndiceDeCadastros, papel: PapelSimples, p: PessoaProcurada): ResultadoDaPessoa {
  const doPapel = indice.pessoas.filter(x => x.papel === papel);
  const doc = dig(p.documento ?? '');
  const avisos: string[] = [];
  if (doc) {
    const porDoc = doPapel.find(x => x.documento === doc);
    if (porDoc) return { tipo: 'achou', pessoa: porDoc, como: 'documento', avisos };
  }
  const email = emailComparavel(p.email);
  if (email) {
    const mesmos = doPapel.filter(x => x.email && emailComparavel(x.email) === email && (!doc || !x.documento || x.documento === doc));
    const comNome = mesmos.find(x => mesmoNome(x, p));
    if (comNome) return { tipo: 'achou', pessoa: comNome, como: 'email', avisos };
    if (mesmos.length) avisos.push(`Tem o mesmo e-mail de "${mesmos[0].nome}", mas outro nome: fica como pessoa separada.`);
  }
  const tels = (p.telefones ?? []).map(telefoneComparavel).filter(Boolean);
  if (tels.length) {
    const mesmos = doPapel.filter(x => x.telefones.some(t => tels.includes(telefoneComparavel(t))) && (!doc || !x.documento || x.documento === doc));
    const comNome = mesmos.find(x => mesmoNome(x, p));
    if (comNome) return { tipo: 'achou', pessoa: comNome, como: 'telefone', avisos };
    if (mesmos.length) avisos.push(`Tem o mesmo telefone de "${mesmos[0].nome}", mas outro nome: fica como pessoa separada.`);
  }
  const homonimos = doPapel.filter(x => mesmoNome(x, p) && (!doc || !x.documento || x.documento === doc));
  if (homonimos.length === 1) {
    // Com documento dos dois lados e diferentes já ficou de fora acima.
    return { tipo: 'achou', pessoa: homonimos[0], como: 'nome', avisos };
  }
  if (homonimos.length > 1) {
    return {
      tipo: 'ambigua',
      motivo: `Há ${homonimos.length} ${papel === 'cliente' ? 'clientes' : 'fornecedores'} chamados "${p.nome}". Inclua a coluna CPF/CNPJ para saber qual é.`,
    };
  }
  return { tipo: 'nova', avisos };
}

// ---------------------------------------------------------------------------
// Categoria, centro, conta

export function acharCategoria(indice: IndiceDeCadastros, tipo: 'RECEITA' | 'DESPESA', nome: string, grupo?: string): CategoriaConhecida | null {
  const n = normalizar(nome);
  if (!n) return null;
  const mesmas = indice.categorias.filter(c => c.tipo === tipo && normalizar(c.nome) === n);
  if (mesmas.length <= 1) return mesmas[0] ?? null;
  const g = normalizar(grupo ?? '');
  if (g) {
    const pai = indice.categorias.filter(c => c.tipo === tipo && normalizar(c.nome) === g).map(c => c.id);
    const doGrupo = mesmas.find(c => c.pai_id && pai.includes(c.pai_id));
    if (doGrupo) return doGrupo;
  }
  // A mais funda (folha) primeiro: é onde se lança.
  return [...mesmas].sort((a, b) => b.codigo.split('.').length - a.codigo.split('.').length || a.codigo.localeCompare(b.codigo))[0];
}

export function acharCentro(indice: IndiceDeCadastros, nome: string): CentroConhecido | null {
  const n = normalizar(nome);
  return n ? indice.centros.find(c => normalizar(c.nome) === n) ?? null : null;
}

export function acharConta(indice: IndiceDeCadastros, c: { nome: string; banco?: string; agencia?: string; numero?: string }): ContaConhecida | null {
  const numero = dig(c.numero ?? '');
  if (numero) {
    const banco = dig(c.banco ?? '');
    const agencia = dig(c.agencia ?? '');
    const porDados = indice.contas.find(x => dig(x.numero) === numero
      && (!banco || !dig(x.banco) || dig(x.banco) === banco)
      && (!agencia || !dig(x.agencia) || dig(x.agencia) === agencia));
    if (porDados) return porDados;
  }
  const n = normalizar(c.nome);
  return n ? indice.contas.find(x => normalizar(x.nome) === n) ?? null : null;
}

// ---------------------------------------------------------------------------
// Título

/** Chave natural do título: a mesma linha exportada duas vezes dá a mesma chave. */
export function chaveDoTitulo(t: {
  movimento: Movimento; pessoa: string; documento_pessoa: string; documento: string; vencimento: string;
  valor: number; parcela_numero: number; total_parcelas: number;
}): string {
  const quem = t.documento_pessoa || nomeComparavel(t.pessoa);
  return [t.movimento, quem, normalizar(t.documento), t.vencimento, String(t.valor), `${t.parcela_numero}/${t.total_parcelas}`].join('|');
}

/** Título em aberto já cadastrado aqui com a mesma pessoa, vencimento, valor e documento. */
export function acharTituloExistente(
  indice: IndiceDeCadastros, tabela: TituloConhecido['tabela'], pessoaId: string, vencimento: string, valor: number, documento: string,
): TituloConhecido | null {
  const doc = normalizar(documento);
  return indice.titulos.find(t => t.tabela === tabela && t.pessoa_id === pessoaId && t.vencimento === vencimento
    && t.valor === valor && (!doc || !t.documento || normalizar(t.documento) === doc)) ?? null;
}

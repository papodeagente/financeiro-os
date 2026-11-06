/**
 * Mudança de sistema (E4, 05/11/2026): o que fazer com cada linha.
 *
 * O MESMO código decide no ensaio e na aplicação. A diferença é o
 * "gravador": no ensaio ele só inventa ids ("novo:7") e nada toca o banco;
 * na aplicação ele grava de verdade (servidor.ts). Assim o que o ensaio
 * mostrou é o que a aplicação faz, linha por linha, salvo o que mudou no
 * banco entre um e outro (e isso fica registrado na própria linha).
 */
import type { ListaId } from './dicionario';
import {
  acharCategoria, acharCentro, acharConta, acharPessoa, acharTituloExistente, chaveDoTitulo,
  type CategoriaConhecida, type IndiceDeCadastros, type PapelSimples, type PessoaConhecida,
} from './identidade';
import type {
  CategoriaLida, CodigoDeRecusa, ContaLida, PessoaLida, RegistroLido, SaldoLido, TituloLido,
} from './interpretar';
import { dataBR, reais } from './valores';

export type Resultado = 'criar' | 'vincular' | 'recusar' | 'ignorar';

/** De onde veio o registro: vai junto em cada coisa criada. */
export interface OrigemDaLinha {
  lote_id: string;
  arquivo_id: string;
  arquivo: string;
  linha: number;
  etapa: number;
}

export interface RefsDoTitulo {
  pessoa_id: string;
  pessoa_nome: string;
  categoria_id: string;
  centro_id: string;
  centro_nome: string;
  conta_id: string | null;
}

/** Quem grava. No ensaio, só simula. */
export interface Gravador {
  readonly simulado: boolean;
  criarConta(d: ContaLida, o: OrigemDaLinha): Promise<string>;
  aplicarSaldo(contaId: string, centavos: number, o: OrigemDaLinha): Promise<void>;
  criarCategoria(c: { nome: string; tipo: 'RECEITA' | 'DESPESA'; pai_id: string | null; codigo: string; repasse: boolean }, o: OrigemDaLinha): Promise<string>;
  criarCentro(nome: string, o: OrigemDaLinha): Promise<string>;
  criarPessoa(papel: PapelSimples, d: PessoaLida, o: OrigemDaLinha): Promise<string>;
  criarTitulo(tabela: 'contas_pagar' | 'contas_receber', t: TituloLido, refs: RefsDoTitulo, chave: string, o: OrigemDaLinha): Promise<string>;
  vincular(tabela: string, id: string, o: OrigemDaLinha, chave?: string): Promise<void>;
}

/** Decisões que dependem do lote inteiro, tomadas no ensaio e guardadas na linha. */
export interface Enriquecimento {
  /** Pessoas: em que papéis entra (pela coluna, pelo uso nos títulos ou pelo padrão). */
  papeis?: PapelSimples[];
  /** Contas: o saldo desta linha vale (não há linha na lista de saldos para a conta). */
  usar_saldo?: boolean;
}

export interface ContextoDoPlano {
  dataCorte: string | null;
  /** Chaves de título já vistas neste lote: chave → "linha 12 de Abril.xlsx". */
  chavesDoLote: Map<string, string>;
  /** Contas que já receberam saldo neste lote. */
  saldosDoLote: Set<string>;
}

export interface Decisao {
  resultado: Resultado;
  codigo: CodigoDeRecusa | string | null;
  motivo: string;
  avisos: string[];
  alvo_tabela: string | null;
  alvo_id: string | null;
  chave: string | null;
}

const recusa = (codigo: CodigoDeRecusa, motivo: string): Decisao =>
  ({ resultado: 'recusar', codigo, motivo, avisos: [], alvo_tabela: null, alvo_id: null, chave: null });

// ---------------------------------------------------------------------------
// Códigos do plano de contas

function raizDoTipo(indice: IndiceDeCadastros, tipo: 'RECEITA' | 'DESPESA'): CategoriaConhecida | null {
  const raizes = indice.categorias.filter(c => c.tipo === tipo && !c.pai_id);
  const preferida = tipo === 'RECEITA' ? '1' : '2';
  return raizes.find(c => c.codigo === preferida) ?? raizes.sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))[0] ?? null;
}

/** Próximo código livre debaixo de `pai` (ou no primeiro nível). */
export function proximoCodigo(indice: IndiceDeCadastros, pai: CategoriaConhecida | null): string {
  if (!pai || !pai.codigo) {
    const max = indice.categorias.reduce((m, c) => (/^\d+$/.test(c.codigo) ? Math.max(m, Number(c.codigo)) : m), 0);
    return String(max + 1);
  }
  const prefixo = `${pai.codigo}.`;
  let max = 0;
  for (const c of indice.categorias) {
    if (!c.codigo.startsWith(prefixo)) continue;
    const resto = c.codigo.slice(prefixo.length);
    if (/^\d+$/.test(resto)) max = Math.max(max, Number(resto));
  }
  const n = max + 1;
  return pai.codigo.includes('.') ? `${prefixo}${String(n).padStart(2, '0')}` : `${prefixo}${n}`;
}

/** Acha ou cria a categoria (e o grupo dela). */
async function garantirCategoria(
  indice: IndiceDeCadastros, g: Gravador, o: OrigemDaLinha,
  tipo: 'RECEITA' | 'DESPESA', nome: string, grupo: string, repasse = false,
): Promise<{ categoria: CategoriaConhecida; criada: boolean; grupoCriado: boolean }> {
  const ja = acharCategoria(indice, tipo, nome, grupo);
  if (ja) return { categoria: ja, criada: false, grupoCriado: false };
  let pai: CategoriaConhecida | null = null;
  let grupoCriado = false;
  if (grupo) {
    pai = acharCategoria(indice, tipo, grupo);
    if (!pai) {
      const raiz = raizDoTipo(indice, tipo);
      const codigo = proximoCodigo(indice, raiz);
      const id = await g.criarCategoria({ nome: grupo, tipo, pai_id: raiz?.id ?? null, codigo, repasse: false }, o);
      pai = { id, nome: grupo, tipo, pai_id: raiz?.id ?? null, codigo, doLote: true };
      indice.categorias.push(pai);
      grupoCriado = true;
    }
  } else {
    pai = raizDoTipo(indice, tipo);
  }
  const codigo = proximoCodigo(indice, pai);
  const id = await g.criarCategoria({ nome, tipo, pai_id: pai?.id ?? null, codigo, repasse }, o);
  const categoria: CategoriaConhecida = { id, nome, tipo, pai_id: pai?.id ?? null, codigo, doLote: true };
  indice.categorias.push(categoria);
  return { categoria, criada: true, grupoCriado };
}

async function garantirCentro(indice: IndiceDeCadastros, g: Gravador, o: OrigemDaLinha, nome: string): Promise<{ id: string; nome: string; criado: boolean }> {
  const ja = acharCentro(indice, nome);
  if (ja) return { id: ja.id, nome: ja.nome, criado: false };
  const id = await g.criarCentro(nome, o);
  indice.centros.push({ id, nome, doLote: true });
  return { id, nome, criado: true };
}

function pessoaVazia(nome: string): PessoaLida {
  return {
    nome, razao_social: '', documento: '', email: '', telefone: '', celular: '', tipo_pessoa: 'PF', papel: null,
    cep: '', endereco: '', numero: '', bairro: '', cidade: '', uf: '', codigo: '',
  };
}

function registrarPessoa(indice: IndiceDeCadastros, id: string, papel: PapelSimples, d: PessoaLida): PessoaConhecida {
  const p: PessoaConhecida = {
    id, papel, nome: d.nome, razao_social: d.razao_social, documento: d.documento, email: d.email,
    telefones: [d.telefone, d.celular].filter(Boolean), doLote: true,
  };
  indice.pessoas.push(p);
  return p;
}

/** Saldo de abertura numa conta (nova ou sem movimento). */
async function saldoNaConta(
  indice: IndiceDeCadastros, ctx: ContextoDoPlano, g: Gravador, o: OrigemDaLinha,
  contaId: string, contaNome: string, centavos: number,
): Promise<Decisao> {
  const conta = indice.contas.find(c => c.id === contaId);
  if (ctx.saldosDoLote.has(contaId)) return recusa('duplicado_no_arquivo', `A conta "${contaNome}" já recebeu saldo nesta mudança.`);
  if (conta?.temMovimento && !conta.doLote) {
    return recusa('conta_com_movimento', `A conta "${contaNome}" já tem movimento aqui: o saldo dela não foi trocado. Confira na prova da mudança.`);
  }
  if (!ctx.dataCorte) return recusa('falta_coluna', 'Informe a data de corte da mudança para lançar os saldos.');
  await g.aplicarSaldo(contaId, centavos, o);
  ctx.saldosDoLote.add(contaId);
  if (conta) conta.temMovimento = centavos !== 0;
  return {
    resultado: 'criar', codigo: null, motivo: `Saldo de abertura de ${reais(centavos)} em ${dataBR(ctx.dataCorte)} na conta "${contaNome}".`,
    avisos: [], alvo_tabela: 'contas_bancarias', alvo_id: contaId, chave: null,
  };
}

// ---------------------------------------------------------------------------

/** Decide (e, com o gravador de verdade, grava) uma linha já interpretada. */
export async function processarRegistro(
  registro: RegistroLido, enriq: Enriquecimento, indice: IndiceDeCadastros, ctx: ContextoDoPlano, g: Gravador, o: OrigemDaLinha,
): Promise<Decisao> {
  switch (registro.lista) {
    case 'contas': {
      const d = registro.dados;
      const ja = acharConta(indice, d);
      let id: string;
      let resultado: Resultado;
      let motivo: string;
      if (ja) {
        id = ja.id; resultado = 'vincular';
        motivo = `Já existe aqui: "${ja.nome}".`;
        await g.vincular('contas_bancarias', id, o);
      } else {
        id = await g.criarConta(d, o);
        indice.contas.push({ id, nome: d.nome, banco: d.banco, agencia: d.agencia, numero: d.numero, temMovimento: false, doLote: true });
        resultado = 'criar'; motivo = 'Conta nova.';
      }
      const avisos: string[] = [];
      // O saldo recusado não recusa a conta: vira aviso, e o código vai junto
      // para as provas explicarem a diferença do saldo.
      let codigo: string | null = null;
      if (d.saldo !== null && enriq.usar_saldo !== false) {
        const s = await saldoNaConta(indice, ctx, g, o, id, d.nome, d.saldo);
        if (s.resultado === 'recusar') { avisos.push(s.motivo); codigo = s.codigo; }
        else motivo += ` ${s.motivo}`;
      }
      return { resultado, codigo, motivo, avisos, alvo_tabela: 'contas_bancarias', alvo_id: id, chave: null };
    }
    case 'categorias': {
      const d: CategoriaLida = registro.dados;
      const r = await garantirCategoria(indice, g, o, d.tipo, d.nome, d.grupo, d.repasse);
      if (!r.criada) await g.vincular('plano_contas', r.categoria.id, o);
      return {
        resultado: r.criada ? 'criar' : 'vincular', codigo: null,
        motivo: r.criada ? `Categoria nova${r.grupoCriado ? ` (e o grupo "${d.grupo}")` : ''}.` : `Já existe aqui: "${r.categoria.nome}".`,
        avisos: [], alvo_tabela: 'plano_contas', alvo_id: r.categoria.id, chave: null,
      };
    }
    case 'centros_custo': {
      const r = await garantirCentro(indice, g, o, registro.dados.nome);
      if (!r.criado) await g.vincular('centros_custo', r.id, o);
      return { resultado: r.criado ? 'criar' : 'vincular', codigo: null, motivo: r.criado ? 'Centro de custo novo.' : `Já existe aqui: "${r.nome}".`, avisos: [], alvo_tabela: 'centros_custo', alvo_id: r.id, chave: null };
    }
    case 'pessoas': {
      const d = registro.dados;
      const papeis = enriq.papeis?.length ? enriq.papeis : ['cliente' as const];
      const avisos: string[] = [];
      const feitos: string[] = [];
      let criou = false;
      let primeiro: { tabela: string; id: string } | null = null;
      const ambiguas: string[] = [];
      for (const papel of papeis) {
        const tabela = papel === 'cliente' ? 'clientes' : 'fornecedores_crm';
        const r = acharPessoa(indice, papel, { nome: d.nome, razao_social: d.razao_social, documento: d.documento, email: d.email, telefones: [d.telefone, d.celular] });
        if (r.tipo === 'ambigua') { ambiguas.push(r.motivo); continue; }
        avisos.push(...r.avisos);
        if (r.tipo === 'achou') {
          await g.vincular(tabela, r.pessoa.id, o);
          feitos.push(`${papel === 'cliente' ? 'cliente' : 'fornecedor'} já existe${r.pessoa.doLote ? ' (repetido no arquivo)' : ''}, ligado pelo ${r.como === 'documento' ? 'CPF/CNPJ' : r.como === 'email' ? 'e-mail e nome' : r.como === 'telefone' ? 'telefone e nome' : 'nome'}`);
          primeiro ??= { tabela, id: r.pessoa.id };
        } else {
          const id = await g.criarPessoa(papel, d, o);
          registrarPessoa(indice, id, papel, d);
          criou = true;
          feitos.push(`${papel === 'cliente' ? 'cliente' : 'fornecedor'} novo`);
          primeiro ??= { tabela, id };
        }
      }
      if (!primeiro) return recusa('pessoa_ambigua', ambiguas[0] ?? 'Pessoa ambígua.');
      avisos.push(...ambiguas);
      const texto = feitos.join('; ');
      return {
        resultado: criou ? 'criar' : 'vincular', codigo: null, motivo: texto.charAt(0).toUpperCase() + texto.slice(1) + '.',
        avisos, alvo_tabela: primeiro.tabela, alvo_id: primeiro.id, chave: null,
      };
    }
    case 'saldos': {
      const d: SaldoLido = registro.dados;
      const conta = acharConta(indice, { nome: d.conta });
      if (!conta) return recusa('conta_nao_encontrada', `A conta "${d.conta}" não está na lista de contas nem cadastrada aqui.`);
      const s = await saldoNaConta(indice, ctx, g, o, conta.id, conta.nome, d.saldo);
      if (s.resultado !== 'recusar') await g.vincular('contas_bancarias', conta.id, o);
      return s;
    }
    case 'titulos': {
      const t: TituloLido = registro.dados;
      const chave = chaveDoTitulo(t);
      const onde = `linha ${o.linha} de "${o.arquivo}"`;
      const outra = indice.chavesImportadas.get(chave);
      if (outra) return { ...recusa('ja_importado', `Já trazido por outra mudança (${outra}).`), chave };
      const repetida = ctx.chavesDoLote.get(chave);
      if (repetida) return { ...recusa('duplicado_no_arquivo', `Repete a ${repetida}.`), chave };
      const papel: PapelSimples = t.movimento === 'receber' ? 'cliente' : 'fornecedor';
      const tabela = t.movimento === 'receber' ? 'contas_receber' : 'contas_pagar';
      const avisos: string[] = [];
      const r = acharPessoa(indice, papel, { nome: t.pessoa, razao_social: t.razao_social, documento: t.documento_pessoa });
      if (r.tipo === 'ambigua') return { ...recusa('pessoa_ambigua', r.motivo), chave };
      let pessoa: PessoaConhecida;
      if (r.tipo === 'achou') {
        pessoa = r.pessoa;
      } else {
        const nova: PessoaLida = { ...pessoaVazia(t.pessoa), razao_social: t.razao_social, documento: t.documento_pessoa, tipo_pessoa: t.documento_pessoa.length === 14 ? 'PJ' : 'PF' };
        const id = await g.criarPessoa(papel, nova, o);
        pessoa = registrarPessoa(indice, id, papel, nova);
        avisos.push(`${papel === 'cliente' ? 'Cliente' : 'Fornecedor'} "${t.pessoa}" não estava cadastrado: será criado.`);
      }
      avisos.push(...r.avisos);
      const tipoCat = t.movimento === 'receber' ? 'RECEITA' : 'DESPESA';
      let categoriaId = '';
      if (t.categoria) {
        const c = await garantirCategoria(indice, g, o, tipoCat, t.categoria, t.grupo);
        categoriaId = c.categoria.id;
        if (c.criada) avisos.push(`Categoria "${t.categoria}" não existia: será criada.`);
      } else {
        avisos.push('Sem categoria: aparece em "sem categoria" nos relatórios até alguém escolher.');
      }
      let centroId = '';
      let centroNome = '';
      if (t.centro_custo) {
        const c = await garantirCentro(indice, g, o, t.centro_custo);
        centroId = c.id; centroNome = c.nome;
        if (c.criado) avisos.push(`Centro de custo "${t.centro_custo}" não existia: será criado.`);
      }
      let contaId: string | null = null;
      if (t.conta) {
        const c = acharConta(indice, { nome: t.conta });
        if (c) contaId = c.id;
        else avisos.push(`A conta "${t.conta}" não foi encontrada: o lançamento fica sem conta prevista.`);
      }
      ctx.chavesDoLote.set(chave, onde);
      if (!pessoa.doLote) {
        const existente = acharTituloExistente(indice, tabela, pessoa.id, t.vencimento, t.valor, t.documento);
        if (existente) {
          await g.vincular(tabela, existente.id, o, chave);
          return { resultado: 'vincular', codigo: null, motivo: 'Já está lançado aqui (mesma pessoa, vencimento, valor e documento).', avisos, alvo_tabela: tabela, alvo_id: existente.id, chave };
        }
      }
      const id = await g.criarTitulo(tabela, t, {
        pessoa_id: pessoa.id, pessoa_nome: pessoa.nome, categoria_id: categoriaId, centro_id: centroId, centro_nome: centroNome, conta_id: contaId,
      }, chave, o);
      return {
        resultado: 'criar', codigo: null,
        motivo: `Conta a ${t.movimento} de ${reais(t.valor)} com vencimento em ${dataBR(t.vencimento)}.`,
        avisos, alvo_tabela: tabela, alvo_id: id, chave,
      };
    }
  }
}

/** Gravador do ensaio: nada toca o banco, os ids são inventados. */
export function gravadorDeEnsaio(): Gravador {
  let n = 0;
  const novo = async () => `novo:${++n}`;
  return {
    simulado: true,
    criarConta: novo,
    aplicarSaldo: async () => {},
    criarCategoria: novo,
    criarCentro: novo,
    criarPessoa: novo,
    criarTitulo: novo,
    vincular: async () => {},
  };
}

/** Lista em que cada etapa grava (para a ordem e o desfazer). */
export function tabelasDaLista(lista: ListaId): string[] {
  switch (lista) {
    case 'contas': return ['contas_bancarias'];
    case 'categorias': return ['plano_contas'];
    case 'centros_custo': return ['centros_custo'];
    case 'pessoas': return ['clientes', 'fornecedores_crm'];
    case 'titulos': return ['contas_pagar', 'contas_receber'];
    case 'saldos': return ['contas_bancarias'];
  }
}

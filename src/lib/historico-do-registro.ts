/**
 * Aba Histórico de cada título e cadastro (06/11/2026, E7) — regra pura.
 *
 * Lê o registro de atividades que já existe (audit_log, gravado pelo gatilho
 * do banco a cada INSERT/UPDATE/DELETE) filtrado por UM registro, e traduz
 * para quem usa a tela:
 *   - rótulos legíveis ("Vencimento", não "data.data_vencimento");
 *   - ruído escondido (datas de gravação, ids internos, marcas da tela,
 *     campos técnicos que mudam sozinhos);
 *   - antes → depois no formato da tela: R$, dd/mm/aaaa, Sim/Não, situação
 *     pelo nome ("Em aberto", "Pago");
 *   - um evento por gravação: quem, quando, o que mudou.
 * Exclusão lógica de títulos: a linha sai da tabela (Excluiu) e volta na
 * restauração (uma criação depois da exclusão do mesmo id = Restaurou).
 */
import type { LogAuditoria } from './crm-types';

export type GrupoDoHistorico = 'financeiro' | 'cadastro';

export interface EntidadeDoHistorico {
  /** Como a tela chama o registro: "esta conta a pagar". */
  nome: string;
  /** Quem pode ver: financeiro = ver_financeiro; cadastro = a regra do Registro de atividades. */
  grupo: GrupoDoHistorico;
}

/** Lista fechada: só estas tabelas têm aba Histórico. */
export const ENTIDADES_DO_HISTORICO: Readonly<Record<string, EntidadeDoHistorico>> = {
  contas_pagar: { nome: 'conta a pagar', grupo: 'financeiro' },
  contas_receber: { nome: 'conta a receber', grupo: 'financeiro' },
  contas_bancarias: { nome: 'conta bancária', grupo: 'financeiro' },
  plano_contas: { nome: 'categoria', grupo: 'financeiro' },
  centros_custo: { nome: 'centro de custo', grupo: 'financeiro' },
  formas_pagamento: { nome: 'forma de pagamento', grupo: 'financeiro' },
  clientes: { nome: 'cliente', grupo: 'cadastro' },
  fornecedores_crm: { nome: 'fornecedor', grupo: 'cadastro' },
};

export function entidadeDoHistorico(entidade: string): EntidadeDoHistorico | null {
  return Object.prototype.hasOwnProperty.call(ENTIDADES_DO_HISTORICO, entidade) ? ENTIDADES_DO_HISTORICO[entidade] : null;
}

type Formato = 'texto' | 'dinheiro' | 'centavos' | 'data' | 'booleano' | 'status' | 'percentual' | 'numero' | 'lista'
  | 'tipo_conta' | 'tipo_categoria' | 'uso_forma' | 'referencia';

/** Referências por id que a rota troca pelo nome (categoria, centro, conta). */
export type TipoDeReferencia = 'categoria' | 'centro' | 'conta';

interface Campo { rotulo: string; formato: Formato; ref?: TipoDeReferencia }

const c = (rotulo: string, formato: Formato = 'texto', ref?: TipoDeReferencia): Campo => ({ rotulo, formato, ref });

/** Campos dos títulos (a pagar e a receber). */
const CAMPOS_DO_TITULO: Record<string, Campo> = {
  descricao: c('Descrição'),
  observacoes: c('Observações'),
  documento: c('Documento'),
  numero_documento: c('Nº do documento'),
  linha_digitavel: c('Linha digitável'),
  fornecedor_nome: c('Fornecedor'),
  cliente_nome: c('Cliente'),
  valor_final: c('Valor', 'dinheiro'),
  valor_original: c('Valor na moeda da conta', 'numero'),
  valor_brl: c('Valor em reais', 'dinheiro'),
  valor: c('Valor', 'dinheiro'),
  valor_pago: c('Valor pago', 'dinheiro'),
  valor_recebido: c('Valor recebido', 'dinheiro'),
  juros: c('Juros', 'dinheiro'),
  multa: c('Multa', 'dinheiro'),
  desconto: c('Desconto', 'dinheiro'),
  taxa: c('Taxa', 'dinheiro'),
  moeda: c('Moeda'),
  cambio: c('Câmbio', 'numero'),
  data_emissao: c('Emissão', 'data'),
  data_vencimento: c('Vencimento', 'data'),
  data_pagamento: c('Data do pagamento', 'data'),
  data_recebimento: c('Data do recebimento', 'data'),
  data_competencia: c('Competência', 'data'),
  status: c('Situação', 'status'),
  forma_pagamento: c('Forma de pagamento'),
  forma_recebimento: c('Forma de recebimento'),
  categoria_id: c('Categoria', 'referencia', 'categoria'),
  centro_custo_id: c('Centro de custo', 'referencia', 'centro'),
  centro_custo: c('Centro de custo'),
  conta_bancaria_id: c('Conta bancária', 'referencia', 'conta'),
  conta_previsao_id: c('Conta (previsão)', 'referencia', 'conta'),
  rateio: c('Rateio', 'lista'),
  anexos: c('Anexos', 'lista'),
  parcela_numero: c('Parcela', 'numero'),
  total_parcelas: c('Total de parcelas', 'numero'),
  natureza_custo: c('Natureza do custo'),
  is_custo_comercial: c('Custo comercial', 'booleano'),
  numero: c('Nº', 'numero'),
};

const CAMPOS_DA_CONTA_BANCARIA: Record<string, Campo> = {
  nome: c('Nome'),
  banco: c('Banco'),
  banco_codigo: c('Código do banco'),
  agencia: c('Agência'),
  agencia_digito: c('Dígito da agência'),
  conta: c('Conta'),
  conta_digito: c('Dígito da conta'),
  titular: c('Titular'),
  titular_documento: c('CPF/CNPJ do titular'),
  tipo: c('Tipo', 'tipo_conta'),
  moeda: c('Moeda'),
  saldo_inicial: c('Saldo inicial', 'dinheiro'),
  limite: c('Limite', 'dinheiro'),
  dia_fechamento: c('Dia do fechamento', 'numero'),
  dia_vencimento: c('Dia do vencimento', 'numero'),
  ativo: c('Ativa', 'booleano'),
};

const CAMPOS_DA_CATEGORIA: Record<string, Campo> = {
  nome: c('Nome'),
  descricao: c('Nome'),
  codigo: c('Código'),
  tipo: c('Tipo', 'tipo_categoria'),
  pai_id: c('Grupo', 'referencia', 'categoria'),
  ativo: c('Ativa', 'booleano'),
  repasse: c('Repasse', 'booleano'),
  natureza_custo: c('Natureza do custo'),
  is_custo_comercial: c('Custo comercial', 'booleano'),
};

const CAMPOS_DO_CENTRO: Record<string, Campo> = {
  nome: c('Nome'),
  codigo: c('Código'),
  descricao: c('Descrição'),
  responsavel: c('Responsável'),
  ativo: c('Ativo', 'booleano'),
  pai_id: c('Centro acima', 'referencia', 'centro'),
};

const CAMPOS_DA_FORMA: Record<string, Campo> = {
  nome: c('Nome'),
  uso: c('Usada em', 'uso_forma'),
  ativo: c('Ativa', 'booleano'),
  conta_bancaria_id: c('Conta onde cai', 'referencia', 'conta'),
  dias_para_cair: c('Dias para cair', 'numero'),
  taxa_pct: c('Taxa', 'percentual'),
  taxa_fixa_centavos: c('Taxa fixa', 'centavos'),
  informacoes: c('Informações'),
  ordem: c('Ordem', 'numero'),
};

const CAMPOS_DA_PESSOA: Record<string, Campo> = {
  nome: c('Nome'),
  nome_completo: c('Nome completo'),
  nome_fantasia: c('Nome fantasia'),
  razao_social: c('Razão social'),
  tipo: c('Tipo'),
  cpf: c('CPF'),
  cnpj: c('CNPJ'),
  cpf_cnpj: c('CPF/CNPJ'),
  email: c('E-mail'),
  telefone: c('Telefone'),
  celular: c('Celular'),
  whatsapp: c('WhatsApp'),
  data_nascimento: c('Nascimento', 'data'),
  cidade: c('Cidade'),
  estado: c('Estado'),
  cep: c('CEP'),
  endereco: c('Endereço'),
  observacoes: c('Observações'),
  categoria: c('Categoria'),
  ativo: c('Ativo', 'booleano'),
};

const CAMPOS_POR_ENTIDADE: Record<string, Record<string, Campo>> = {
  contas_pagar: CAMPOS_DO_TITULO,
  contas_receber: CAMPOS_DO_TITULO,
  contas_bancarias: CAMPOS_DA_CONTA_BANCARIA,
  plano_contas: CAMPOS_DA_CATEGORIA,
  centros_custo: CAMPOS_DO_CENTRO,
  formas_pagamento: CAMPOS_DA_FORMA,
  clientes: CAMPOS_DA_PESSOA,
  fornecedores_crm: CAMPOS_DA_PESSOA,
};

/** Campos que nunca aparecem: gravação, ids internos, marcas da tela e derivados que mudam sozinhos. */
const RUIDO = new Set([
  'id', 'tenant_id', 'created_at', 'updated_at', 'criado_em', 'atualizado_em', 'createdAt', 'updatedAt',
  '_versao', '_status_lido', 'versao', 'sistema',
  'saldo_atual', 'cliente_id', 'fornecedor_id', 'vendedor_id', 'venda_id', 'origem_venda_id', 'origem_item_id',
  'origem_comissao_id', 'serie_id', 'grupo_id', 'compra_id', 'fatura_id', 'cartao_id', 'usuario_id',
  'auto_gerado', 'venda_modelo', 'plataforma_transacao', 'chave_idempotencia', 'importado_de', 'migracao_id',
  'cadastrado_por', 'cadastrado_em', 'excluido_por', 'excluido_em',
]);

/** O caminho do gatilho ("data.valor_final", "status") sem o prefixo da coluna JSON. */
export function chaveDoCampo(caminho: string): string {
  return caminho.startsWith('data.') ? caminho.slice(5) : caminho;
}

/** Esconder esta alteração? */
export function ehRuido(caminho: string): boolean {
  const chave = chaveDoCampo(caminho);
  if (!chave) return true;
  const raiz = chave.split('.')[0];
  if (RUIDO.has(raiz) || raiz.startsWith('_')) return true;
  // Ids internos que não têm rótulo (os que têm viram o nome pela referência).
  return false;
}

function humanizar(chave: string): string {
  const t = chave.replace(/_/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : chave;
}

/** Definição do campo (rótulo e formato). Desconhecido: o nome por extenso, como texto. */
export function campoDe(entidade: string, caminho: string): Campo {
  const chave = chaveDoCampo(caminho);
  const tabela = CAMPOS_POR_ENTIDADE[entidade] ?? {};
  if (tabela[chave]) return tabela[chave];
  const partes = chave.split('.');
  if (partes[0] === 'campos_personalizados' && partes[1]) return c(`Campo personalizado: ${humanizar(partes.slice(1).join(' '))}`);
  if (partes.length > 1 && tabela[partes[0]]) return c(`${tabela[partes[0]].rotulo}: ${humanizar(partes.slice(1).join(' '))}`);
  // Uma coluna da tabela (ex.: status, nome) também pode ter rótulo no JSON.
  return c(humanizar(partes.join(' ')));
}

export function rotuloDoCampo(entidade: string, caminho: string): string {
  return campoDe(entidade, caminho).rotulo;
}

// ─── Formatação ──────────────────────────────────────────────────────────────

const STATUS: Record<string, string> = {
  PENDENTE: 'Em aberto', pendente: 'Em aberto', ABERTO: 'Em aberto', ATRASADO: 'Em atraso',
  PAGO: 'Pago', RECEBIDO: 'Recebido', PARCIAL: 'Pago em parte', CANCELADO: 'Cancelado',
};
const STATUS_RECEBER: Record<string, string> = { PARCIAL: 'Recebido em parte' };
const TIPO_CONTA: Record<string, string> = {
  CORRENTE: 'Conta corrente', POUPANCA: 'Poupança', CARTAO_CREDITO: 'Cartão de crédito', CAIXA: 'Caixa', APLICACAO: 'Aplicação',
};
const TIPO_CATEGORIA: Record<string, string> = { RECEITA: 'Receita', DESPESA: 'Despesa', receita: 'Receita', despesa: 'Despesa' };
const USO_FORMA: Record<string, string> = { ambos: 'Pagar e receber', pagar: 'Só pagar', receber: 'Só receber' };

export const VAZIO = 'vazio';

const numeroDe = (v: string): number | null => {
  const t = v.trim();
  if (!/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const reais = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function dataBR(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** Nomes das referências (`categoria:<id>` → "Aluguel"), resolvidos pela rota. */
export type NomesDeReferencia = ReadonlyMap<string, string>;

/** Um valor do registro no formato da tela. Vazio vira "vazio". */
export function formatarValor(
  entidade: string, caminho: string, valor: string | null | undefined, nomes: NomesDeReferencia = new Map(),
): string {
  const v = String(valor ?? '');
  if (v.trim() === '' || v === 'null') return VAZIO;
  const campo = campoDe(entidade, caminho);
  switch (campo.formato) {
    case 'dinheiro': {
      const n = numeroDe(v);
      return n === null ? v : reais(n);
    }
    case 'centavos': {
      const n = numeroDe(v);
      return n === null ? v : reais(n / 100);
    }
    case 'percentual': {
      const n = numeroDe(v);
      return n === null ? v : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
    }
    case 'numero': {
      const n = numeroDe(v);
      return n === null ? v : n.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
    }
    case 'data':
      return dataBR(v) ?? v;
    case 'booleano':
      if (v === 'true') return 'Sim';
      if (v === 'false') return 'Não';
      return v;
    case 'status':
      if (entidade === 'contas_receber' && STATUS_RECEBER[v]) return STATUS_RECEBER[v];
      if (entidade === 'contas_receber' && v === 'PAGO') return 'Recebido';
      return STATUS[v] ?? v;
    case 'tipo_conta':
      return TIPO_CONTA[v] ?? v;
    case 'tipo_categoria':
      return TIPO_CATEGORIA[v] ?? v;
    case 'uso_forma':
      return USO_FORMA[v] ?? v;
    case 'referencia': {
      const nome = campo.ref ? nomes.get(`${campo.ref}:${v}`) : undefined;
      return nome || 'cadastro removido';
    }
    case 'lista': {
      try {
        const lista = JSON.parse(v);
        if (Array.isArray(lista)) {
          if (lista.length === 0) return VAZIO;
          if (chaveDoCampo(caminho) === 'rateio') return lista.length === 1 ? 'dividida em 1 parte' : `dividida em ${lista.length} partes`;
          return lista.length === 1 ? '1 item' : `${lista.length} itens`;
        }
      } catch { /* não é lista: mostra como veio */ }
      return v;
    }
    default:
      return v.length > 300 ? `${v.slice(0, 297)}...` : v;
  }
}

/** Ids de referência citados nas alterações, por tipo, para a rota buscar os nomes. */
export function referenciasCitadas(entidade: string, logs: readonly LogAuditoria[]): Record<TipoDeReferencia, string[]> {
  const r: Record<TipoDeReferencia, Set<string>> = { categoria: new Set(), centro: new Set(), conta: new Set() };
  for (const l of logs) {
    for (const a of l.alteracoes ?? []) {
      const campo = campoDe(entidade, a.campo);
      if (campo.formato !== 'referencia' || !campo.ref) continue;
      for (const v of [a.valor_anterior, a.valor_novo]) if (v && v !== 'null') r[campo.ref].add(v);
    }
  }
  return { categoria: [...r.categoria], centro: [...r.centro], conta: [...r.conta] };
}

// ─── Eventos ─────────────────────────────────────────────────────────────────

export type TipoDoEvento = 'criou' | 'alterou' | 'excluiu' | 'restaurou' | 'outro';

export interface AlteracaoLegivel {
  campo: string;
  rotulo: string;
  antes: string;
  depois: string;
}

export interface EventoDoHistorico {
  id: string;
  tipo: TipoDoEvento;
  /** Frase curta: "Alterou a conta a pagar", "Excluiu", "Restaurou". */
  titulo: string;
  /** ISO do servidor. */
  quando: string;
  /** "06/11/2026 às 14:32" em Brasília. */
  quando_texto: string;
  quem: string;
  /** Pela tela, pelo sistema ou por integração. */
  origem: string;
  alteracoes: AlteracaoLegivel[];
}

const ORIGEM: Record<string, string> = {
  USUARIO: 'pela tela', SISTEMA: 'pelo sistema', INTEGRACAO: 'por integração', PUBLICO: 'pelo link público',
};

/** Data e hora em Brasília, como a pessoa lê. */
export function quandoEmTexto(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const p = (t: string) => partes.find(x => x.type === t)?.value ?? '';
  return `${p('day')}/${p('month')}/${p('year')} às ${p('hour')}:${p('minute')}`;
}

/** Na criação, só os campos que dizem o que é o registro (o resto seria uma lista enorme de "vazio → x"). */
const RESUMO_DA_CRIACAO: Record<string, string[]> = {
  contas_pagar: ['descricao', 'fornecedor_nome', 'valor_final', 'data_vencimento', 'status'],
  contas_receber: ['descricao', 'cliente_nome', 'valor_final', 'data_vencimento', 'status'],
  contas_bancarias: ['nome', 'banco', 'agencia', 'conta', 'saldo_inicial'],
  plano_contas: ['nome', 'codigo', 'tipo'],
  centros_custo: ['nome', 'codigo'],
  formas_pagamento: ['nome', 'uso', 'dias_para_cair', 'taxa_pct'],
  clientes: ['nome', 'nome_completo', 'nome_fantasia', 'email', 'telefone'],
  fornecedores_crm: ['nome_fantasia', 'razao_social', 'cnpj', 'email'],
};

function alteracoesLegiveis(entidade: string, log: LogAuditoria, nomes: NomesDeReferencia, soResumo: boolean): AlteracaoLegivel[] {
  const resumo = RESUMO_DA_CRIACAO[entidade] ?? [];
  const vistas = new Set<string>();
  const saida: AlteracaoLegivel[] = [];
  for (const a of log.alteracoes ?? []) {
    if (ehRuido(a.campo)) continue;
    const chave = chaveDoCampo(a.campo);
    if (soResumo && !resumo.includes(chave)) continue;
    const antes = formatarValor(entidade, a.campo, a.valor_anterior, nomes);
    const depois = formatarValor(entidade, a.campo, a.valor_novo, nomes);
    if (antes === depois) continue;
    // A mesma informação na coluna e no JSON (ex.: status e data.status) aparece uma vez.
    const rotulo = rotuloDoCampo(entidade, a.campo);
    const marca = `${rotulo}|${antes}|${depois}`;
    if (vistas.has(marca)) continue;
    vistas.add(marca);
    saida.push({ campo: chave, rotulo, antes, depois });
  }
  if (soResumo) saida.sort((x, y) => resumo.indexOf(x.campo) - resumo.indexOf(y.campo));
  return saida;
}

/**
 * Os eventos do registro, do mais novo para o mais antigo. `logs` pode vir em
 * qualquer ordem; precisa trazer TODOS os eventos do registro até o mais
 * antigo da página para reconhecer a restauração (a rota manda o histórico
 * todo, que é de um registro só).
 */
export function eventosDoHistorico(
  entidade: string, logs: readonly LogAuditoria[], nomes: NomesDeReferencia = new Map(),
): EventoDoHistorico[] {
  const ent = entidadeDoHistorico(entidade);
  const nome = ent?.nome ?? 'registro';
  const ordem = [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
  let excluidoAntes = false;
  const eventos: EventoDoHistorico[] = [];
  for (const log of ordem) {
    let tipo: TipoDoEvento;
    let titulo: string;
    let alteracoes: AlteracaoLegivel[] = [];
    if (log.acao === 'CRIAR') {
      tipo = excluidoAntes ? 'restaurou' : 'criou';
      titulo = excluidoAntes ? `Restaurou ${artigo(nome)}` : `Criou ${artigo(nome)}`;
      if (!excluidoAntes) alteracoes = alteracoesLegiveis(entidade, log, nomes, true);
      excluidoAntes = false;
    } else if (log.acao === 'EXCLUIR') {
      tipo = 'excluiu';
      titulo = `Excluiu ${artigo(nome)}`;
      excluidoAntes = true;
    } else if (log.acao === 'EDITAR') {
      alteracoes = alteracoesLegiveis(entidade, log, nomes, false);
      // Gravação só de campos técnicos: nada que a pessoa precise ver.
      if (alteracoes.length === 0) continue;
      tipo = 'alterou';
      titulo = alteracoes.length === 1 ? `Alterou ${alteracoes[0].rotulo.toLowerCase()}` : `Alterou ${alteracoes.length} campos`;
    } else {
      tipo = 'outro';
      titulo = log.descricao || 'Registro';
    }
    eventos.push({
      id: log.id, tipo, titulo, quando: log.timestamp, quando_texto: quandoEmTexto(log.timestamp),
      quem: log.usuario_nome || 'Sistema', origem: ORIGEM[log.origem ?? ''] ?? 'pelo sistema', alteracoes,
    });
  }
  return eventos.reverse();
}

function artigo(nome: string): string {
  const feminino = /^(conta|categoria|forma)/.test(nome);
  return `${feminino ? 'a' : 'o'} ${nome}`;
}

/**
 * E4 · Mudança de sistema — o contrato que as TELAS assumem das rotas da
 * parte A (servidor da mudança), num lugar só (05/11/2026).
 *
 * As telas do assistente "Mudar para o EnturOS" foram escritas ao mesmo
 * tempo que o servidor. Tudo o que elas pedem e esperam receber das rotas
 * `/api/mudanca/*` (docs/programa/e4-contratos.md, parte A) está declarado
 * aqui, e só aqui: na integração, se a parte A respondeu com outro formato,
 * o ajuste é neste arquivo (tipos e funções `api.*`), sem caçar fetch
 * espalhado pelas telas.
 *
 * Convenções assumidas (conferir na integração):
 *   · dinheiro em REAIS nas respostas (o banco guarda centavos; a rota
 *     converte na borda, como /api/contas-pagar-receber e /api/cobrancas);
 *   · datas AAAA-MM-DD (data de corte, vencimento), mês AAAA-MM, carimbos
 *     ISO completos (criado_em, atualizado_em);
 *   · erro = HTTP 4xx/5xx com `{ error: string, codigo?: string }`;
 *   · tudo que grava passa por dois passos quando há efeito grande:
 *     `modo: 'previa'` devolve `assinatura`; `modo: 'gravar'` exige a mesma
 *     assinatura e o cabeçalho `Idempotency-Key` (como POST /api/baixas);
 *   · só administrador chama (a rota responde 403 para os outros papéis).
 *
 * Nenhuma regra de negócio mora aqui: só formato e transporte.
 */

// ─── Listas que a v1 traz, na ordem em que entram ──────────────────────────

/**
 * Cada arquivo solto é de uma lista do sistema anterior. A ordem de
 * `ORDEM_DAS_LISTAS` é a ordem de aplicação (contrato E4, "O que entra na v1").
 */
export type TipoDeLista =
  | 'contas' | 'categorias' | 'centros_custo' | 'pessoas' | 'titulos' | 'saldos'
  // E7 (mudança v2): o histórico, opcional, depois dos saldos.
  | 'liquidados' | 'movimentos' | 'vendas' | 'faturas' | 'notas' | 'comissoes_pagas' | 'metas' | 'reembolsos' | 'creditos';

export const ORDEM_DAS_LISTAS: readonly TipoDeLista[] = [
  'contas', 'categorias', 'centros_custo', 'pessoas', 'titulos', 'saldos',
  'liquidados', 'movimentos', 'vendas', 'faturas', 'notas', 'comissoes_pagas', 'metas', 'reembolsos', 'creditos',
];

/** As listas do histórico (E7): opcionais, entram depois dos saldos de abertura. */
export const LISTAS_DO_HISTORICO: readonly TipoDeLista[] = ['liquidados', 'movimentos', 'vendas', 'faturas', 'notas', 'comissoes_pagas', 'metas', 'reembolsos', 'creditos'];

/** Formato lido pelo leitor de planilha da parte A. */
export type FormatoDoArquivo = 'xlsx' | 'xls' | 'csv' | 'txt';

/** Situação do lote inteiro (tabela de lotes da parte A). */
export type SituacaoDoLote =
  | 'rascunho'    // criado, recebendo arquivos e mapeamento
  | 'ensaiando'   // ensaio rodando
  | 'ensaiado'    // ensaio pronto, nada gravado
  | 'aplicando'   // gravando em blocos pela fila
  | 'aplicado'    // gravado; nada sai até concluir
  | 'desfazendo'
  | 'desfeito'
  | 'concluido'   // régua, cobrança, notas e avisos ligados de novo
  | 'falhou';

export const SITUACOES_DO_LOTE: readonly SituacaoDoLote[] = [
  'rascunho', 'ensaiando', 'ensaiado', 'aplicando', 'aplicado', 'desfazendo', 'desfeito', 'concluido', 'falhou',
];

// ─── Arquivos ──────────────────────────────────────────────────────────────

/** Avisos do leitor, por arquivo. O texto da tela vem de `regras` (telas/assistente.ts). */
export type CodigoDoAviso =
  | 'lista_cortada'        // o sistema anterior corta listas grandes: pedir um arquivo por mês
  | 'linha_de_total'       // linha de total do rodapé ignorada
  | 'codificacao_latin1'   // lido como Latin-1 (acentos conferidos)
  | 'colunas_desconhecidas'// colunas ignoradas (listadas no mapeamento)
  | 'linhas_vazias'
  | 'lista_nao_reconhecida'; // não deu para saber de qual lista é: a pessoa escolhe

export interface AvisoDoArquivo {
  codigo: CodigoDoAviso;
  /** Detalhe curto do servidor (ex.: "500 linhas"), em linguagem simples. */
  detalhe?: string;
}

export interface ArquivoDoLote {
  id: string;
  nome: string;
  /** Bytes. */
  tamanho: number;
  formato: FormatoDoArquivo;
  /** De qual lista o leitor achou que é; `null` = a pessoa precisa escolher. */
  tipo_lista: TipoDeLista | null;
  /** Linhas de dados lidas (sem cabeçalho nem total). */
  linhas: number;
  /** Datas mínima e máxima da coluna principal (vencimento nos títulos). */
  periodo: { de: string; ate: string } | null;
  avisos: AvisoDoArquivo[];
  /** Falha de leitura, em palavras simples (arquivo protegido, vazio...). */
  erro: string | null;
}

// ─── Lote ──────────────────────────────────────────────────────────────────

export interface ResumoPorLista {
  tipo_lista: TipoDeLista;
  criar: number;
  vincular: number;
  recusar: number;
}

export interface Lote {
  id: string;
  situacao: SituacaoDoLote;
  /** AAAA-MM-DD: saldos de abertura e títulos em aberto valem nesta data. */
  data_corte: string;
  arquivos: ArquivoDoLote[];
  /**
   * Muda a cada arquivo enviado/removido ou mapeamento salvo. O ensaio guarda
   * a versão em que rodou: se for menor, o ensaio está velho.
   */
  versao: number;
  /** Versão em que o último ensaio rodou (null = nunca rodou). */
  versao_do_ensaio: number | null;
  resumo_do_ensaio: ResumoPorLista[] | null;
  criado_em: string;
  criado_por_nome: string;
  aplicado_em: string | null;
  concluido_em: string | null;
  desfeito_em: string | null;
  /** Depois de desfazer: o que o lote criou e ficou, porque alguém mexeu depois (null antes). */
  nao_desfeitos: RegistroQueFica[] | null;
  /** Mensagem simples quando `falhou`. */
  erro: string | null;
}

// ─── Mapeamento por cabeçalho ──────────────────────────────────────────────

/** Um campo do EnturOS que pode receber uma coluna (dicionário de sinônimos da parte A). */
export interface CampoDeDestino {
  /** Chave estável (ex.: 'vencimento', 'cpf_cnpj', 'valor'). */
  campo: string;
  /** Como aparece na tela (ex.: "Vencimento", "CPF ou CNPJ"). */
  rotulo: string;
  obrigatorio: boolean;
  /** Uma frase de ajuda, opcional. */
  ajuda?: string;
}

export interface ColunaDoArquivo {
  /** Posição da coluna no arquivo, a partir de 0. */
  indice: number;
  /** Cabeçalho como veio. */
  cabecalho: string;
  /** Até 3 valores das primeiras linhas, para a pessoa reconhecer. */
  exemplos: string[];
  /** Campo escolhido (o sugerido, até a pessoa trocar); `null` = ignorar a coluna. */
  campo: string | null;
  /** O que o dicionário sugeriu e com que segurança. */
  sugerido: string | null;
  confianca: 'certa' | 'provavel' | 'nenhuma';
}

export interface MapeamentoDoArquivo {
  arquivo_id: string;
  arquivo_nome: string;
  tipo_lista: TipoDeLista;
  colunas: ColunaDoArquivo[];
  /** Campos que esta lista aceita, na ordem em que a tela mostra. */
  campos: CampoDeDestino[];
}

export interface RespostaDoMapeamento {
  arquivos: MapeamentoDoArquivo[];
}

/** PUT do mapeamento de um arquivo: a escolha da pessoa, coluna por coluna. */
export interface PedidoDeMapeamento {
  arquivo_id: string;
  tipo_lista: TipoDeLista;
  colunas: Array<{ indice: number; campo: string | null }>;
}

// ─── Ensaio (lê, mapeia, identifica e mostra; NÃO grava) ───────────────────

export type ResultadoDaLinha = 'criar' | 'vincular' | 'recusar';

export interface LinhaDoEnsaio {
  id: string;
  arquivo_nome: string;
  /** Número da linha na planilha (como a pessoa vê no Excel). */
  linha: number;
  tipo_lista: TipoDeLista;
  resultado: ResultadoDaLinha;
  /** O que a linha é, em palavras ("Cliente Maria Souza", "A receber R$ 1.200,00 vence 10/12"). */
  descricao: string;
  /** Valor em reais quando a linha tem dinheiro (títulos, saldos). */
  valor: number | null;
  /** Com o que já existe aqui a linha vai se ligar (resultado 'vincular'). */
  vinculo: { rotulo: string; href?: string } | null;
  /** Por que foi recusada (ou por que liga com o existente), em palavras simples. */
  motivo: string | null;
}

export interface FiltroDoEnsaio {
  resultado?: ResultadoDaLinha | 'todos';
  tipo_lista?: TipoDeLista | 'todas';
  busca?: string;
  pagina?: number;
  por_pagina?: number;
}

export interface RespostaDoEnsaio {
  /** Totais do lote inteiro (sem o filtro). */
  resumo: ResumoPorLista[];
  linhas: LinhaDoEnsaio[];
  /** Total do recorte filtrado (para "N de M"). */
  total: number;
  pagina: number;
  por_pagina: number;
  /**
   * Vale para gravar exatamente o que foi visto: o aplicar exige a mesma
   * assinatura (muda se um arquivo ou mapeamento mudar depois).
   */
  assinatura: string;
}

// ─── Aplicar e progresso ───────────────────────────────────────────────────

export interface EtapaDoProgresso {
  tipo_lista: TipoDeLista;
  feitos: number;
  total: number;
  situacao: 'aguardando' | 'fazendo' | 'feito' | 'falhou';
  erro?: string | null;
}

export interface ProgressoDoLote {
  situacao: SituacaoDoLote;
  feitos: number;
  total: number;
  etapas: EtapaDoProgresso[];
  atualizado_em: string;
  erro: string | null;
}

// ─── Provas ────────────────────────────────────────────────────────────────

/** Por que um número não bateu: cada diferença é explicada por linhas do ensaio. */
export interface ExplicacaoDaDiferenca {
  /** "Linha recusada", "Duplicada no arquivo", "Sem categoria"... em palavras simples. */
  motivo: string;
  /** Quantas linhas explicam. */
  linhas: number;
  /** Quanto explica, em reais (com sinal). */
  valor: number;
  /** Filtro do ensaio que mostra essas linhas. */
  filtro?: FiltroDoEnsaio;
}

export interface ProvaDaConta {
  conta: string;
  /** Saldo informado pelo sistema anterior na data de corte. */
  anterior: number;
  /** Saldo no EnturOS na data de corte, depois de aplicar. */
  enturos: number;
  diferenca: number;
  explicacoes: ExplicacaoDaDiferenca[];
}

export interface ProvaDaPessoa {
  pessoa: string;
  pagar_anterior: number;
  pagar_enturos: number;
  receber_anterior: number;
  receber_enturos: number;
  diferenca: number;
  explicacoes: ExplicacaoDaDiferenca[];
}

export interface ProvaDoMes {
  /** AAAA-MM */
  mes: string;
  categoria: string;
  tipo: 'pagar' | 'receber';
  anterior: number;
  enturos: number;
  diferenca: number;
  explicacoes: ExplicacaoDaDiferenca[];
}

export interface RespostaDasProvas {
  data_corte: string;
  contas: ProvaDaConta[];
  pessoas: ProvaDaPessoa[];
  meses: ProvaDoMes[];
  gerado_em: string;
  /** E7: as provas do histórico (vazias quando a mudança não trouxe histórico). */
  historico?: ProvasDoHistorico;
}

/** Uma linha das provas do histórico: sistema anterior × EnturOS, em reais. */
export interface LinhaDoHistorico {
  rotulo: string;
  anterior: number;
  enturos: number;
  diferenca: number;
  explicacoes: Array<{ motivo: string; linhas: number; valor: number; codigo: string }>;
  explicada: boolean;
}

export interface ProvasDoHistorico {
  /** Dinheiro em dobro: saldo na data de corte refeito aqui × o informado. */
  contas_no_corte: Array<LinhaDoHistorico & { conta_id: string; historico: number; saldo_hoje: number }>;
  /** Liquidado por mês (AAAA-MM) e lado. */
  liquidados: Array<LinhaDoHistorico & { mes: string; tipo: 'pagar' | 'receber' }>;
  /** Vendas e receita por mês. `receita` null = o arquivo não trouxe a coluna de receita. */
  receita: Array<{ mes: string; vendas: number; faturamento: LinhaDoHistorico; receita: LinhaDoHistorico | null }>;
  registros: { faturas: number; notas: number; comissoes_pagas: number; metas: number; reembolsos: number; creditos: number; movimentos_ligados: number; movimentos_criados: number };
}

// ─── Mês em paralelo (E7) ──────────────────────────────────────────────────

export type TipoDaComparacao = 'bate' | 'data' | 'valor' | 'so_la' | 'so_aqui';

export interface ItemComparado {
  ref: string;
  tabela: string | null;
  id: string | null;
  tipo: 'pagar' | 'receber';
  pessoa: string;
  valor: number;
  vencimento: string | null;
  liquidacao: string | null;
  conta: string;
  categoria: string;
  descricao: string;
}

export interface ParComparado {
  tipo: TipoDaComparacao;
  rotulo: string;
  anterior: ItemComparado | null;
  enturos: ItemComparado | null;
  diferenca: number;
  detalhe: string;
}

export interface GrupoComparado {
  chave: string;
  rotulo: string;
  anterior: number;
  enturos: number;
  diferenca: number;
  contagem: Record<TipoDaComparacao, number>;
}

export interface SecaoComparada {
  fonte: 'contas' | 'extrato';
  rotulo: string;
  pares: ParComparado[];
  contagem: Record<TipoDaComparacao, number>;
  total: { anterior: number; enturos: number; diferenca: number };
  por_conta: GrupoComparado[];
  por_pessoa: GrupoComparado[];
  por_categoria: GrupoComparado[];
}

export interface RelatorioDoMes {
  lote_id: string;
  mes: string;
  gerado_em: string;
  secoes: SecaoComparada[];
  fora: Array<{ arquivo: string; linha: number; motivo: string }>;
  tudo_bate: boolean;
}

/** A comparação do mês é um lote no modo "paralelo": arquivos e colunas pelas rotas de sempre. */
export type Comparacao = Lote & { mes: string };

// ─── Recriar (E7): plano de comissão e regras de faturamento ───────────────

export interface FuncaoDaComissao { id: string; nome: string; ativo: boolean }

// ─── Desfazer e concluir ───────────────────────────────────────────────────

/** Registro criado pelo lote que NÃO será apagado (alguém mexeu depois). */
export interface RegistroQueFica {
  tipo_lista: TipoDeLista;
  descricao: string;
  /** "Recebeu uma baixa em 12/11", "Foi editado por Ana em 13/11"... */
  motivo: string;
  href?: string;
}

export interface PreviaDoDesfazer {
  apagar: Array<{ tipo_lista: TipoDeLista; quantidade: number }>;
  ficam: RegistroQueFica[];
  assinatura: string;
}

export interface ResultadoDoDesfazer {
  lote: Lote;
  apagados: number;
  ficaram: RegistroQueFica[];
}

export interface PreviaDoConcluir {
  /** O que volta a funcionar, em frases ("Régua de cobrança pelo WhatsApp"...). */
  liga: string[];
  /** Pendências que não impedem concluir, mas a pessoa precisa ver. */
  avisos: string[];
  assinatura: string;
}

// ─── Erro ──────────────────────────────────────────────────────────────────

/** Sem propriedade no construtor: o teste roda este arquivo com --experimental-strip-types. */
export class ErroDaMudanca extends Error {
  readonly status: number;
  readonly codigo: string | null;
  constructor(mensagem: string, status: number, codigo: string | null) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

// ─── Transporte ────────────────────────────────────────────────────────────

/** Uma chave por gravação: repetir o clique não grava duas vezes. */
export function chaveDeIdempotencia(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function chamar<T>(url: string, init?: RequestInit & { chave?: string }): Promise<T> {
  const { chave, ...resto } = init ?? {};
  const corpoJson = typeof resto.body === 'string';
  let r: Response;
  try {
    r = await fetch(url, {
      ...resto,
      headers: {
        ...(corpoJson ? { 'Content-Type': 'application/json' } : {}),
        ...(chave ? { 'Idempotency-Key': chave } : {}),
        ...(resto.headers ?? {}),
      },
    });
  } catch {
    throw new ErroDaMudanca('Sem resposta do servidor. Nada foi gravado; tente de novo.', 0, null);
  }
  const corpo = (await r.json().catch(() => null)) as (T & { error?: string; codigo?: string }) | null;
  if (!r.ok) {
    const msg = corpo && typeof corpo.error === 'string' ? corpo.error : `Erro ${r.status}`;
    throw new ErroDaMudanca(msg, r.status, corpo && typeof corpo.codigo === 'string' ? corpo.codigo : null);
  }
  return corpo as T;
}

const BASE = '/api/mudanca/lotes';
const doLote = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

function consulta(f: FiltroDoEnsaio): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === '' || v === 'todos' || v === 'todas') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** As chamadas que as telas fazem às rotas da parte A. */
export const api = {
  /** GET: lotes da agência, o mais recente primeiro (para retomar o que está no meio). */
  lotes: (signal?: AbortSignal) => chamar<{ lotes: Lote[] }>(BASE, { signal }),

  /** POST: começa uma mudança. Só um lote aberto por agência (409 `LOTE_ABERTO` se já houver). */
  criar: (dataCorte: string, chave: string) =>
    chamar<Lote>(BASE, { method: 'POST', body: JSON.stringify({ data_corte: dataCorte }), chave }),

  lote: (id: string, signal?: AbortSignal) => chamar<Lote>(doLote(id), { signal }),

  /** PATCH: muda a data de corte (só antes de aplicar). */
  mudarDataDeCorte: (id: string, dataCorte: string) =>
    chamar<Lote>(doLote(id), { method: 'PATCH', body: JSON.stringify({ data_corte: dataCorte }) }),

  /**
   * POST multipart: um arquivo por chamada (campo `arquivo`). A tela manda
   * vários em sequência e mostra cada um chegando. Devolve o arquivo lido.
   */
  enviarArquivo: (id: string, arquivo: File, signal?: AbortSignal) => {
    const corpo = new FormData();
    corpo.append('arquivo', arquivo, arquivo.name);
    return chamar<ArquivoDoLote>(`${doLote(id)}/arquivos`, { method: 'POST', body: corpo, signal });
  },

  removerArquivo: (id: string, arquivoId: string) =>
    chamar<Lote>(`${doLote(id)}/arquivos/${encodeURIComponent(arquivoId)}`, { method: 'DELETE' }),

  /** PATCH: a pessoa diz de qual lista é o arquivo (quando o leitor não reconheceu ou errou). */
  escolherLista: (id: string, arquivoId: string, tipoLista: TipoDeLista) =>
    chamar<ArquivoDoLote>(`${doLote(id)}/arquivos/${encodeURIComponent(arquivoId)}`, {
      method: 'PATCH', body: JSON.stringify({ tipo_lista: tipoLista }),
    }),

  mapeamento: (id: string, signal?: AbortSignal) => chamar<RespostaDoMapeamento>(`${doLote(id)}/mapeamento`, { signal }),

  salvarMapeamento: (id: string, p: PedidoDeMapeamento) =>
    chamar<MapeamentoDoArquivo>(`${doLote(id)}/mapeamento`, { method: 'PUT', body: JSON.stringify(p) }),

  /** POST: roda o ensaio (não grava nada). Responde quando terminou. */
  ensaiar: (id: string) => chamar<Lote>(`${doLote(id)}/ensaio`, { method: 'POST' }),

  /** GET: linhas do ensaio, com filtros e página. */
  ensaio: (id: string, f: FiltroDoEnsaio, signal?: AbortSignal) =>
    chamar<RespostaDoEnsaio>(`${doLote(id)}/ensaio${consulta(f)}`, { signal }),

  /** POST: grava em blocos pela fila. Exige a assinatura do ensaio visto. */
  aplicar: (id: string, assinatura: string, chave: string) =>
    chamar<Lote>(`${doLote(id)}/aplicar`, { method: 'POST', body: JSON.stringify({ assinatura }), chave }),

  progresso: (id: string, signal?: AbortSignal) => chamar<ProgressoDoLote>(`${doLote(id)}/progresso`, { signal }),

  provas: (id: string, signal?: AbortSignal) => chamar<RespostaDasProvas>(`${doLote(id)}/provas`, { signal }),

  /** Link do PDF "Prova da mudança" (abre em outra aba; a rota devolve application/pdf). */
  urlDoPdf: (id: string) => `${doLote(id)}/provas/pdf`,

  previaDoDesfazer: (id: string) =>
    chamar<PreviaDoDesfazer>(`${doLote(id)}/desfazer`, { method: 'POST', body: JSON.stringify({ modo: 'previa' }) }),

  desfazer: (id: string, assinatura: string, chave: string) =>
    chamar<ResultadoDoDesfazer>(`${doLote(id)}/desfazer`, { method: 'POST', body: JSON.stringify({ modo: 'gravar', assinatura }), chave }),

  previaDoConcluir: (id: string) =>
    chamar<PreviaDoConcluir>(`${doLote(id)}/concluir`, { method: 'POST', body: JSON.stringify({ modo: 'previa' }) }),

  concluir: (id: string, assinatura: string, chave: string) =>
    chamar<Lote>(`${doLote(id)}/concluir`, { method: 'POST', body: JSON.stringify({ modo: 'gravar', assinatura }), chave }),

  // ── Mês em paralelo (E7): compara sem gravar ──
  comparacoes: (signal?: AbortSignal) => chamar<{ comparacoes: Comparacao[] }>('/api/mudanca/paralelo', { signal }),
  criarComparacao: (mes: string, chave: string) =>
    chamar<Comparacao>('/api/mudanca/paralelo', { method: 'POST', body: JSON.stringify({ mes }), chave }),
  comparar: (id: string, signal?: AbortSignal) => chamar<RelatorioDoMes>(`${doLote(id)}/paralelo`, { signal }),
  urlDoPdfDoMes: (id: string) => `${doLote(id)}/paralelo/pdf`,

  // ── Recriar (E7): plano de comissão pelas telas da E5 ──
  funcoesDaComissao: async (signal?: AbortSignal) => {
    const r = await chamar<{ funcoes?: FuncaoDaComissao[]; cadastro?: { funcoes?: FuncaoDaComissao[] } }>('/api/comissoes-por-funcao/cadastro', { signal });
    return (r.funcoes ?? r.cadastro?.funcoes ?? []).filter(f => f.ativo !== false);
  },
  salvarPlano: (plano: Record<string, unknown>) =>
    chamar<{ id: string; nome: string }>('/api/comissoes-por-funcao/planos', { method: 'PUT', body: JSON.stringify({ plano }) }),
};

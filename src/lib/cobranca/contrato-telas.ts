/**
 * E3 · Cobrança — o contrato que as TELAS assumem das rotas da parte A
 * (núcleo de cobrança no servidor), num lugar só (05/11/2026).
 *
 * As telas foram escritas ao mesmo tempo que o servidor. Tudo o que elas
 * pedem e esperam receber das rotas de `docs/programa/e3-contratos.md`
 * (seção A) está declarado aqui, e só aqui: na integração, se a parte A
 * respondeu com outro formato, o ajuste é neste arquivo (tipos e as funções
 * `api.*`), sem caçar fetch espalhado pelas telas.
 *
 * Convenções assumidas (conferir na integração):
 *   · dinheiro em REAIS nas respostas (o banco guarda centavos; a rota
 *     converte na borda, como /api/contas-pagar-receber);
 *   · datas AAAA-MM-DD (vencimento) e ISO completo (criado_em, pago_em);
 *   · erro = HTTP 4xx/5xx com `{ error: string, codigo?: CodigoDeErro }`;
 *   · escrita sempre em dois passos quando há prévia: `modo: 'previa'`
 *     devolve `assinatura`; `modo: 'gravar'` exige a mesma assinatura e o
 *     cabeçalho `Idempotency-Key` (como POST /api/baixas).
 *
 * Nenhuma regra de negócio mora aqui: só formato e transporte.
 */

// ─── Tipos do domínio, como chegam nas respostas ───────────────────────────

export type ProvedorDeCobranca = 'asaas' | 'pagarme';

/** Como a cobrança é paga. `boleto_pix` = boleto com QR do Pix no mesmo documento (Asaas). */
export type TipoDeCobranca = 'boleto' | 'pix' | 'boleto_pix' | 'link' | 'carne';

/** Status gravado em `cobrancas.status` (parte A). */
export type StatusDaCobranca = 'emitindo' | 'aberta' | 'vencida' | 'paga' | 'cancelada' | 'estornada' | 'falhou';

export const STATUS_DA_COBRANCA: readonly StatusDaCobranca[] = [
  'emitindo', 'aberta', 'vencida', 'paga', 'cancelada', 'estornada', 'falhou',
];

/** O que o provedor sabe fazer (`AdapterCobranca.capacidades`). */
export interface CapacidadesDoProvedor {
  boletoComPix: boolean;
  carne: boolean;
  jurosMulta: boolean;
  desconto: boolean;
  link: boolean;
}

export interface Cobranca {
  id: string;
  /** contas_receber.id */
  conta_id: string;
  cliente_id: string;
  cliente_nome: string;
  descricao: string;
  provedor: ProvedorDeCobranca;
  tipo: TipoDeCobranca;
  status: StatusDaCobranca;
  /** Valor cobrado, em reais. */
  valor: number;
  /** AAAA-MM-DD */
  vencimento: string;
  linha_digitavel: string | null;
  codigo_barras: string | null;
  pix_copia_cola: string | null;
  /** PDF do boleto (ou do carnê). */
  url_boleto: string | null;
  /** Página de pagamento do provedor (sempre com o valor atualizado). */
  url_fatura: string | null;
  /** Mesmo id para as parcelas de um carnê. */
  carne_id: string | null;
  /** Mensagem do provedor quando `falhou`, já em linguagem simples. */
  erro: string | null;
  /** Quanto entrou e quando (preenchido pelo aviso do provedor). */
  valor_pago: number | null;
  pago_em: string | null;
  criado_em: string;
  criado_por: string | null;
}

export interface TotaisDasCobrancas {
  /** Em aberto (aberta + vencida + emitindo). */
  aberto: { quantidade: number; valor: number };
  vencido: { quantidade: number; valor: number };
  /** Pagas no período do filtro. */
  pago: { quantidade: number; valor: number };
  falhou: { quantidade: number };
}

// ─── GET /api/cobrancas ────────────────────────────────────────────────────

export interface FiltroDasCobrancas {
  /** 'todas' ou um status; 'em_aberto' = emitindo + aberta + vencida. */
  status?: StatusDaCobranca | 'todas' | 'em_aberto';
  /** Período pelo vencimento (AAAA-MM-DD). */
  de?: string;
  ate?: string;
  provedor?: ProvedorDeCobranca | '';
  busca?: string;
  conta_id?: string;
  cliente_id?: string;
}

export interface RespostaDaListaDeCobrancas {
  cobrancas: Cobranca[];
  totais: TotaisDasCobrancas;
}

// ─── POST /api/cobrancas (emitir uma ou várias, com prévia) ────────────────

export interface PedidoDeEmissao {
  modo: 'previa' | 'gravar';
  /** contas_receber.id de cada conta. */
  contas: string[];
  /** Vazio = o padrão de /api/config/cobranca. */
  provedor?: ProvedorDeCobranca;
  tipo?: TipoDeCobranca;
  /** Só na gravação: a mesma da prévia. */
  assinatura?: string;
}

export interface ItemDaPreviaDeEmissao {
  conta_id: string;
  ok: boolean;
  /** Por que fica de fora (já tem boleto, sem CPF, conta paga...). */
  motivo: string | null;
  cliente_nome: string;
  descricao: string;
  valor: number;
  vencimento: string;
  tipo: TipoDeCobranca;
  /** Algo para a pessoa saber, sem impedir (ex.: vencimento ajustado para hoje). */
  aviso: string | null;
}

export interface RespostaDaPreviaDeEmissao {
  provedor: ProvedorDeCobranca;
  capacidades: CapacidadesDoProvedor;
  itens: ItemDaPreviaDeEmissao[];
  prontos: number;
  /** Soma das prontas, em reais. */
  total: number;
  assinatura: string;
}

export interface ItemDaGravacaoDeEmissao {
  conta_id: string;
  ok: boolean;
  cobranca_id: string | null;
  status: StatusDaCobranca | null;
  erro: string | null;
}

export interface RespostaDaGravacaoDeEmissao {
  itens: ItemDaGravacaoDeEmissao[];
  /** Mais de uma: vão pela fila (até 2 por segundo por agência). */
  na_fila: boolean;
  emitidas: number;
}

// ─── /api/cobrancas/[id] ───────────────────────────────────────────────────

/** PATCH = 2ª via (novo vencimento e/ou novo valor). */
export interface PedidoDeSegundaVia {
  vencimento?: string;
  valor?: number;
}

/** POST /api/cobrancas/[id]/enviar */
export type CanalDeEnvio = 'email' | 'whatsapp';

// ─── POST /api/cobrancas/carne ─────────────────────────────────────────────

export interface PedidoDeCarne {
  modo: 'previa' | 'gravar';
  /** Parcelas (contas a receber) do MESMO cliente. */
  contas: string[];
  assinatura?: string;
}

export interface RespostaDaPreviaDeCarne {
  provedor: ProvedorDeCobranca;
  cliente_nome: string;
  parcelas: Array<{ conta_id: string; numero: number; valor: number; vencimento: string; ok: boolean; motivo: string | null }>;
  total: number;
  assinatura: string;
}

export interface RespostaDaGravacaoDeCarne {
  carne_id: string;
  url_carne: string | null;
  cobrancas: string[];
}

// ─── GET/PUT /api/config/cobranca ──────────────────────────────────────────

/** Só em Configurações › Cobrança: leva o ?empresa= do endereço (E7). Fora dela, nada muda. */
function comEmpresaDaTela(url: string): string {
  if (typeof window === 'undefined' || !window.location.pathname.startsWith('/config/cobranca')) return url;
  const empresa = new URLSearchParams(window.location.search).get('empresa');
  return empresa && empresa !== 'principal' ? `${url}?empresa=${encodeURIComponent(empresa)}` : url;
}

export interface ReguaDeCobranca {
  ligada: boolean;
  /** Dias em relação ao vencimento: −5 = cinco dias antes, 0 = no dia, 3 = três dias depois. */
  dias: number[];
  canais: { email: boolean; whatsapp: boolean };
}

export interface ProvedorConectado {
  id: ProvedorDeCobranca;
  /** Credencial cadastrada em Configurações › Plataformas e integração ativa. */
  conectado: boolean;
  capacidades: CapacidadesDoProvedor;
  /** Conta bancária onde o dinheiro dessa integração cai. */
  conta_bancaria_id: string;
}

export interface ConfigDeCobranca {
  provedor_padrao: ProvedorDeCobranca | '';
  tipo_padrao: TipoDeCobranca;
  /** Conta bancária que recebe (vazio = a da integração). */
  conta_bancaria_id: string;
  juros_am_pct: number;
  multa_pct: number;
  desconto_pct: number;
  /** Desconto vale até N dias antes do vencimento. */
  desconto_dias: number;
  /** Os números acima vieram da política de /config/financeiro (nada gravado aqui ainda). */
  encargos_da_politica: boolean;
  regua: ReguaDeCobranca;
  /** Texto da descrição da cobrança; aceita {descricao}, {parcela}, {agencia}. */
  descricao_modelo: string;
  /** Só leitura: o que está conectado e o que cada um faz. */
  provedores: ProvedorConectado[];
}

export type ConfigDeCobrancaGravavel = Omit<ConfigDeCobranca, 'provedores' | 'encargos_da_politica'>;

// ─── Erros ─────────────────────────────────────────────────────────────────

/**
 * Códigos que a parte A pode mandar em `codigo` para a tela explicar sem
 * mostrar a mensagem crua do provedor. Código desconhecido cai no texto.
 */
export type CodigoDeErro =
  | 'SEM_PROVEDOR' | 'PROVEDOR_DESLIGADO' | 'CREDENCIAL_INVALIDA' | 'PROVEDOR_FORA' | 'LIMITE_DO_PROVEDOR'
  | 'CLIENTE_SEM_DOCUMENTO' | 'CLIENTE_SEM_CONTATO' | 'VALOR_MINIMO' | 'VENCIMENTO_INVALIDO'
  | 'JA_TEM_COBRANCA' | 'CONTA_QUITADA' | 'CONTA_CANCELADA' | 'SEM_CARNE' | 'NADA_SAI' | 'ASSINATURA_VENCIDA'
  | 'SEM_PERMISSAO';

export class ErroDaCobranca extends Error {
  constructor(mensagem: string, readonly status: number, readonly codigo: string | null) {
    super(mensagem);
  }
}

// ─── Transporte ────────────────────────────────────────────────────────────

/** Uma chave por gravação: repetir o clique não emite duas vezes. */
export function chaveDeIdempotencia(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function chamar<T>(url: string, init?: RequestInit & { chave?: string }): Promise<T> {
  const { chave, ...resto } = init ?? {};
  let r: Response;
  try {
    r = await fetch(url, {
      ...resto,
      headers: {
        ...(resto.body ? { 'Content-Type': 'application/json' } : {}),
        ...(chave ? { 'Idempotency-Key': chave } : {}),
        ...(resto.headers ?? {}),
      },
    });
  } catch {
    throw new ErroDaCobranca('Sem resposta do servidor. Nada foi alterado; tente de novo.', 0, null);
  }
  const corpo = (await r.json().catch(() => null)) as (T & { error?: string; codigo?: string }) | null;
  if (!r.ok) {
    const msg = corpo && typeof corpo.error === 'string' ? corpo.error : `Erro ${r.status}`;
    throw new ErroDaCobranca(msg, r.status, corpo && typeof corpo.codigo === 'string' ? corpo.codigo : null);
  }
  return corpo as T;
}

function consulta(f: FiltroDasCobrancas): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '' && v !== 'todas') p.set(k, String(v));
  return p.toString();
}

/** As chamadas que as telas fazem às rotas da parte A. */
export const api = {
  listar: (f: FiltroDasCobrancas, signal?: AbortSignal) =>
    chamar<RespostaDaListaDeCobrancas>(`/api/cobrancas?${consulta(f)}`, { signal }),

  /** Cobranças de uma conta a receber (a mais recente primeiro). */
  daConta: (contaId: string, signal?: AbortSignal) =>
    chamar<RespostaDaListaDeCobrancas>(`/api/cobrancas?${consulta({ conta_id: contaId })}`, { signal }),

  previaDeEmissao: (p: Omit<PedidoDeEmissao, 'modo' | 'assinatura'>) =>
    chamar<RespostaDaPreviaDeEmissao>('/api/cobrancas', { method: 'POST', body: JSON.stringify({ ...p, modo: 'previa' }) }),

  emitir: (p: Omit<PedidoDeEmissao, 'modo'> & { assinatura: string }, chave: string) =>
    chamar<RespostaDaGravacaoDeEmissao>('/api/cobrancas', { method: 'POST', body: JSON.stringify({ ...p, modo: 'gravar' }), chave }),

  detalhe: (id: string) => chamar<Cobranca>(`/api/cobrancas/${encodeURIComponent(id)}`),

  segundaVia: (id: string, p: PedidoDeSegundaVia, chave: string) =>
    chamar<Cobranca>(`/api/cobrancas/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(p), chave }),

  cancelar: (id: string, chave: string) =>
    chamar<{ ok: true; cobranca: Cobranca }>(`/api/cobrancas/${encodeURIComponent(id)}`, { method: 'DELETE', chave }),

  enviar: (id: string, canal: CanalDeEnvio, chave: string) =>
    chamar<{ ok: true; enviado?: boolean; na_fila?: boolean; motivo?: string }>(`/api/cobrancas/${encodeURIComponent(id)}/enviar`, { method: 'POST', body: JSON.stringify({ canal }), chave }),

  previaDeCarne: (contas: string[]) =>
    chamar<RespostaDaPreviaDeCarne>('/api/cobrancas/carne', { method: 'POST', body: JSON.stringify({ modo: 'previa', contas }) }),

  gerarCarne: (contas: string[], assinatura: string, chave: string) =>
    chamar<RespostaDaGravacaoDeCarne>('/api/cobrancas/carne', { method: 'POST', body: JSON.stringify({ modo: 'gravar', contas, assinatura }), chave }),

  // ?empresa= da tela de configuração (E7): a cobrança daquela empresa.
  config: () => chamar<ConfigDeCobranca>(comEmpresaDaTela('/api/config/cobranca')),

  salvarConfig: (c: ConfigDeCobrancaGravavel) =>
    chamar<ConfigDeCobranca>(comEmpresaDaTela('/api/config/cobranca'), { method: 'PUT', body: JSON.stringify(c) }),
};

// ─── Rotas desta parte (B), para as telas ──────────────────────────────────

/** Link do portal do cliente (rota /api/portal-links, desta parte). */
export interface EstadoDoLinkDoPortal {
  ativo: boolean;
  /** Só quando acabou de ser criado ou quando o cofre guarda o token. */
  url: string | null;
  criado_em: string | null;
  ultimo_acesso_em: string | null;
  acessos: number;
}

export const apiDoPortal = {
  estado: (clienteId: string) =>
    chamar<EstadoDoLinkDoPortal>(`/api/portal-links?cliente_id=${encodeURIComponent(clienteId)}`),
  criar: (clienteId: string) =>
    chamar<EstadoDoLinkDoPortal>('/api/portal-links', { method: 'POST', body: JSON.stringify({ cliente_id: clienteId }) }),
  revogar: (clienteId: string) =>
    chamar<EstadoDoLinkDoPortal>('/api/portal-links', { method: 'DELETE', body: JSON.stringify({ cliente_id: clienteId }) }),
};

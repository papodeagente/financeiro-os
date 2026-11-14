/**
 * Conexão Asaas unificada entre o CRM e o Financeiro (E7, 06/11/2026).
 *
 * Quando a agência tem o Asaas conectado nos dois sistemas, o Financeiro
 * passa a ser o DONO da conexão: guarda a chave e recebe o aviso (webhook).
 * O CRM deixa de usar a chave dele e pede ao Financeiro, por uma chamada
 * assinada (o mesmo HMAC dos eventos), o que precisa para as propostas:
 * criar o cliente e a cobrança (link de pagamento do sinal/saldo e da
 * cobrança avulsa), ler a cobrança, a linha do boleto, o Pix e cancelar.
 * Os avisos do Asaas das cobranças do CRM chegam aqui e são repassados ao
 * CRM pelo evento `ASAAS_AVISO`.
 *
 * Este arquivo é PURO: o que o CRM pode pedir (lista fechada), de quem é uma
 * referência e o plano da unificação. Rede e banco ficam em `servidor.ts`.
 * Desenho completo: docs/programa/e7-contratos.md, "Parte F".
 */
import { createHash } from 'node:crypto';

/** CRM → Financeiro: operação no Asaas da agência (resposta na hora, assinada). */
export const TIPO_ASAAS_OPERACAO = 'ASAAS_OPERACAO';
/** Financeiro → CRM: como está o Asaas do CRM (consulta). */
export const TIPO_ASAAS_CONEXAO = 'ASAAS_CONEXAO';
/** Financeiro → CRM: passe a usar a conexão do Financeiro (comando, resposta na hora). */
export const TIPO_ASAAS_UNIFICAR = 'ASAAS_UNIFICAR';
/** Financeiro → CRM: volte para a sua chave e o seu aviso (comando, resposta na hora). */
export const TIPO_ASAAS_DESUNIFICAR = 'ASAAS_DESUNIFICAR';
/** Financeiro → CRM: aviso do Asaas de uma cobrança do CRM (evento, pela fila). */
export const TIPO_ASAAS_AVISO = 'ASAAS_AVISO';

/** Os avisos que o CRM usa nas propostas (os mesmos do aviso que ele cadastra). */
export const EVENTOS_QUE_O_CRM_USA = [
  'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE',
  'PAYMENT_REFUNDED', 'PAYMENT_DELETED', 'PAYMENT_CHARGEBACK_REQUESTED',
] as const;

// ---------------------------------------------------------------------------
// Referências do CRM no Asaas

/**
 * As referências que o CRM grava em `externalReference`:
 * `p2;t=<empresa>;pp=<pagamento>` (sinal e saldo da proposta),
 * `p2;t=<empresa>;prop=<proposta>` (cliente da proposta) e
 * `c1;t=<empresa>;...` (cobrança avulsa e o cliente dela).
 * Devolve a empresa do CRM, ou null quando não é do CRM.
 */
export function empresaDaReferenciaDoCrm(ref: unknown): number | null {
  const m = /^(?:p2|c1);t=(\d{1,10})(?:;|$)/.exec(String(ref ?? '').trim());
  return m ? Number(m[1]) : null;
}

export function ehReferenciaDoCrm(ref: unknown): boolean {
  return empresaDaReferenciaDoCrm(ref) !== null;
}

/** A referência é do CRM e, quando a empresa do CRM é conhecida, é dela. */
export function referenciaDaEmpresa(ref: unknown, empresaCrm: number | null): boolean {
  const t = empresaDaReferenciaDoCrm(ref);
  if (t === null) return false;
  return empresaCrm === null || t === empresaCrm;
}

// ---------------------------------------------------------------------------
// O que o CRM pode pedir (lista fechada)

export type OperacaoAsaas =
  | { tipo: 'criar_cliente'; corpo: Record<string, unknown> }
  | { tipo: 'criar_cobranca'; corpo: Record<string, unknown> }
  | { tipo: 'ler_cobranca'; id: string }
  | { tipo: 'linha_do_boleto'; id: string }
  | { tipo: 'pix'; id: string }
  | { tipo: 'parcelas'; parcelamento: string }
  | { tipo: 'cancelar'; id: string };

/** Operações que criam algo no Asaas: param durante a mudança de sistema ("nada sai"). */
export const OPERACOES_QUE_CRIAM: ReadonlyArray<OperacaoAsaas['tipo']> = ['criar_cliente', 'criar_cobranca'];

const ID = /^[A-Za-z0-9_-]{4,64}$/;
const TIPOS_DE_COBRANCA = ['PIX', 'BOLETO', 'CREDIT_CARD'];

export type LeituraDaOperacao = { ok: true; op: OperacaoAsaas } | { ok: false; motivo: string };

/**
 * Traduz o pedido do CRM (`{ metodo, caminho, corpo }`, o mesmo formato da
 * chamada que ele faria ao Asaas) numa operação da lista. Qualquer outra
 * coisa é recusada: o CRM não ganha acesso livre à conta da agência
 * (saldo, transferências, chaves, avisos ficam de fora).
 */
export function lerOperacao(payload: unknown, empresaCrm: number | null): LeituraDaOperacao {
  const p = (payload ?? {}) as Record<string, unknown>;
  const metodo = String(p.metodo ?? 'GET').toUpperCase();
  const caminho = String(p.caminho ?? '');
  const recusa = (motivo: string): LeituraDaOperacao => ({ ok: false, motivo });
  const [rota, busca = ''] = caminho.split('?');
  const partes = rota.split('/').filter(Boolean);

  if (metodo === 'POST' && rota === '/customers') {
    const corpo = objeto(p.corpo);
    if (!corpo) return recusa('Pedido sem os dados do cliente.');
    if (!referenciaDaEmpresa(corpo.externalReference, empresaCrm)) return recusa('O cliente precisa levar a referência do CRM desta empresa.');
    if (!String(corpo.name ?? '').trim()) return recusa('O cliente precisa de nome.');
    if (!/^\d{11}$|^\d{14}$/.test(String(corpo.cpfCnpj ?? ''))) return recusa('O cliente precisa de CPF ou CNPJ.');
    return { ok: true, op: { tipo: 'criar_cliente', corpo } };
  }
  if (metodo === 'POST' && rota === '/payments') {
    const corpo = objeto(p.corpo);
    if (!corpo) return recusa('Pedido sem os dados da cobrança.');
    if (!referenciaDaEmpresa(corpo.externalReference, empresaCrm)) return recusa('A cobrança precisa levar a referência do CRM desta empresa.');
    if (!ID.test(String(corpo.customer ?? ''))) return recusa('A cobrança precisa do cliente.');
    if (!TIPOS_DE_COBRANCA.includes(String(corpo.billingType ?? ''))) return recusa('Forma de pagamento que o CRM não usa.');
    const valor = Number(corpo.value ?? corpo.totalValue ?? 0);
    if (!Number.isFinite(valor) || valor <= 0) return recusa('A cobrança precisa de valor.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(corpo.dueDate ?? ''))) return recusa('A cobrança precisa de vencimento.');
    return { ok: true, op: { tipo: 'criar_cobranca', corpo } };
  }
  if (partes[0] === 'payments' && partes.length >= 2 && !busca) {
    const id = partes[1];
    if (!ID.test(id)) return recusa('Cobrança inválida.');
    if (metodo === 'GET' && partes.length === 2) return { ok: true, op: { tipo: 'ler_cobranca', id } };
    if (metodo === 'DELETE' && partes.length === 2) return { ok: true, op: { tipo: 'cancelar', id } };
    if (metodo === 'GET' && partes.length === 3 && partes[2] === 'identificationField') return { ok: true, op: { tipo: 'linha_do_boleto', id } };
    if (metodo === 'GET' && partes.length === 3 && partes[2] === 'pixQrCode') return { ok: true, op: { tipo: 'pix', id } };
  }
  if (metodo === 'GET' && rota === '/payments' && busca) {
    const q = new URLSearchParams(busca);
    const chaves = [...q.keys()];
    const parcelamento = q.get('installment') ?? '';
    if (chaves.every(k => k === 'installment' || k === 'limit') && ID.test(parcelamento)) {
      return { ok: true, op: { tipo: 'parcelas', parcelamento } };
    }
  }
  return recusa('Operação que o CRM não faz pelo Financeiro.');
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Cobrança já criada que vale para o mesmo pedido (idempotência pela
 * referência do CRM: o Asaas não tem chave de idempotência). Mesma
 * referência, mesma forma, mesmo vencimento, viva e ainda em aberto.
 */
export function cobrancaQueJaAtende(achadas: unknown[], corpo: Record<string, unknown>): Record<string, unknown> | null {
  const ref = String(corpo.externalReference ?? '');
  const forma = String(corpo.billingType ?? '');
  const venc = String(corpo.dueDate ?? '');
  for (const a of achadas) {
    const c = objeto(a);
    if (!c) continue;
    if (c.deleted === true) continue;
    if (String(c.externalReference ?? '') !== ref) continue;
    if (String(c.billingType ?? '') !== forma) continue;
    if (String(c.dueDate ?? '') !== venc) continue;
    if (String(c.status ?? '').toUpperCase() !== 'PENDING') continue;
    return c;
  }
  return null;
}

/** Cliente já criado para a mesma referência do CRM (evita cliente duplicado no Asaas). */
export function clienteQueJaAtende(achados: unknown[], corpo: Record<string, unknown>): Record<string, unknown> | null {
  const ref = String(corpo.externalReference ?? '');
  for (const a of achados) {
    const c = objeto(a);
    if (!c || c.deleted === true) continue;
    if (String(c.externalReference ?? '') === ref && String(c.id ?? '')) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// O plano da unificação

export interface AvisoNoAsaas {
  id: string;
  url: string;
  ativo: boolean;
  interrompido: boolean;
  eventos: string[];
}

/** O lado do Financeiro: a conexão daqui e o aviso dela no Asaas. */
export interface LadoDoFinanceiro {
  conectado: boolean;
  ambiente: 'sandbox' | 'producao' | null;
  carteira: string | null;
  /** O aviso que aponta para o endereço do Financeiro desta agência (null = não achado). */
  aviso: AvisoNoAsaas | null;
  /** Não deu para ler a conta (credencial, rede): o motivo. */
  erro: string | null;
}

/** O lado do CRM, como ele respondeu à consulta. */
export interface LadoDoCrm {
  situacao: 'ok' | 'sem_integracao' | 'indisponivel' | 'crm_sem_suporte' | 'nao_e_a_conta_operadora';
  detalhe: string;
  conectado: boolean;
  ambiente: 'sandbox' | 'producao' | null;
  chave_final: string | null;
  carteira: string | null;
  /** O CRM cadastrou o aviso dele pela API (dá para desligar sem a pessoa entrar no Asaas). */
  aviso_automatico: boolean;
  /** O CRM já usa a conexão do Financeiro. */
  pelo_financeiro: boolean;
}

export interface EstadoDaUnificacao {
  ativo: boolean;
  desde: string | null;
  aplicado_por_nome: string | null;
  eventos_incluidos: string[];
  aviso_do_crm: string | null;
}

export type SituacaoDoPlano = 'unificado' | 'pode_unificar' | 'bloqueado' | 'nada_a_fazer';

export interface PlanoDaUnificacao {
  situacao: SituacaoDoPlano;
  /** Uma frase de cabeçalho. */
  resumo: string;
  /** O que impede (situacao = bloqueado). */
  bloqueios: string[];
  /** O que muda, na ordem, em frases. */
  passos: string[];
  eventos_a_incluir: string[];
  /** Muda quando qualquer coisa que o plano mostra muda: aplicar exige a mesma. */
  assinatura: string;
}

export function ambienteDaChave(chave: string): 'sandbox' | 'producao' {
  return String(chave ?? '').startsWith('$aact_hmlg_') ? 'sandbox' : 'producao';
}

/** O aviso desta agência no Asaas: o que aponta para o endereço do Financeiro dela. */
export function acharAvisoDoFinanceiro(lista: unknown[], tenantId: string): AvisoNoAsaas | null {
  const fim = `/api/v1/plataformas/asaas/${tenantId}`;
  for (const w of lista) {
    const o = objeto(w);
    if (!o) continue;
    let caminho = '';
    try { caminho = new URL(String(o.url ?? '')).pathname.replace(/\/+$/, ''); } catch { continue; }
    if (caminho !== fim) continue;
    return {
      id: String(o.id ?? ''),
      url: String(o.url ?? ''),
      ativo: o.enabled !== false,
      interrompido: o.interrupted === true,
      eventos: Array.isArray(o.events) ? o.events.map(String) : [],
    };
  }
  return null;
}

export function planoDaUnificacao(fin: LadoDoFinanceiro, crm: LadoDoCrm, estado: EstadoDaUnificacao | null): PlanoDaUnificacao {
  const eventosAIncluir = fin.aviso ? EVENTOS_QUE_O_CRM_USA.filter(e => !fin.aviso!.eventos.includes(e)) : [];
  const assinatura = createHash('sha256').update(JSON.stringify({
    a: estado?.ativo === true,
    fc: fin.conectado, fa: fin.ambiente, fw: fin.carteira, fv: fin.aviso?.id ?? null, fe: eventosAIncluir,
    cs: crm.situacao, cc: crm.conectado, ca: crm.ambiente, cw: crm.carteira, cp: crm.pelo_financeiro, cv: crm.aviso_automatico,
  })).digest('hex').slice(0, 24);
  const plano = (situacao: SituacaoDoPlano, resumo: string, bloqueios: string[], passos: string[]): PlanoDaUnificacao =>
    ({ situacao, resumo, bloqueios, passos, eventos_a_incluir: situacao === 'pode_unificar' ? [...eventosAIncluir] : [], assinatura });

  if (estado?.ativo) {
    return plano('unificado', 'O Asaas desta agência está unificado: o Financeiro guarda a chave e recebe os avisos, e o CRM usa esta conexão.', [], [
      'Desfazer devolve o CRM à chave e ao aviso dele (o aviso do CRM no Asaas é religado).',
      ...(estado.eventos_incluidos.length ? [`O aviso do Financeiro volta a avisar só o que avisava antes (sai: ${estado.eventos_incluidos.join(', ')}).`] : []),
      'As cobranças criadas enquanto estava unificado continuam no Asaas e o CRM segue acompanhando cada uma.',
    ]);
  }
  if (crm.situacao !== 'ok') {
    if (crm.situacao === 'sem_integracao') return plano('nada_a_fazer', 'Sem integração com o CRM ligada: não há o que unificar.', [], []);
    return plano('bloqueado', 'Não deu para saber como está o Asaas no CRM.', [crm.detalhe || 'O CRM não respondeu.'], []);
  }
  if (!crm.conectado) return plano('nada_a_fazer', 'O CRM não tem Asaas próprio conectado: não há o que unificar.', [], []);
  if (!fin.conectado) {
    return plano('nada_a_fazer', 'O Asaas está conectado só no CRM. Para unificar, conecte aqui a mesma conta Asaas.', [], []);
  }

  const bloqueios: string[] = [];
  if (fin.erro) bloqueios.push(`Não deu para ler a conta Asaas daqui: ${fin.erro}`);
  if (fin.ambiente && crm.ambiente && fin.ambiente !== crm.ambiente) {
    bloqueios.push(`O Financeiro usa a chave de ${fin.ambiente === 'sandbox' ? 'teste' : 'produção'} e o CRM a de ${crm.ambiente === 'sandbox' ? 'teste' : 'produção'}: precisam ser da mesma conta e do mesmo ambiente.`);
  }
  if (!fin.erro) {
    if (!fin.carteira || !crm.carteira) {
      bloqueios.push('Não deu para confirmar que é a mesma conta Asaas (a carteira de um dos lados não veio). Tente de novo em instantes.');
    } else if (fin.carteira !== crm.carteira) {
      bloqueios.push(`São contas Asaas diferentes (carteira ${fin.carteira} aqui, ${crm.carteira} no CRM). Unificar faria as cobranças do CRM caírem em outra conta: conecte a mesma conta nos dois antes.`);
    }
    if (!fin.aviso) {
      bloqueios.push('O aviso (webhook) do Financeiro não está cadastrado nesta conta Asaas. Cadastre o endereço do webhook mostrado acima no painel do Asaas e tente de novo.');
    } else {
      if (!fin.aviso.ativo) bloqueios.push('O aviso do Financeiro está desligado no Asaas. Ligue-o no painel do Asaas antes.');
      if (fin.aviso.interrompido) bloqueios.push('A fila do aviso do Financeiro está interrompida no Asaas. Reative a fila no painel do Asaas antes.');
    }
  }
  if (bloqueios.length) return plano('bloqueado', 'O Asaas está conectado nos dois sistemas, mas ainda não dá para unificar.', bloqueios, []);

  const passos = [
    `O CRM passa a criar as cobranças das propostas e os links avulsos por esta conexão (a mesma conta Asaas, carteira ${fin.carteira}).`,
    ...(eventosAIncluir.length ? [`O aviso do Financeiro no Asaas passa a avisar também: ${eventosAIncluir.join(', ')}.`] : []),
    crm.aviso_automatico
      ? 'O aviso próprio do CRM no Asaas é desligado (não apagado). Os avisos chegam aqui e o Financeiro repassa ao CRM os das cobranças dele.'
      : 'O aviso do CRM foi cadastrado à mão no Asaas: desligue-o no painel do Asaas depois. Enquanto estiver ligado, o CRM confere o mesmo pagamento duas vezes, sem efeito em dobro.',
    `A chave do Asaas guardada no CRM (final ${crm.chave_final ?? '----'}) fica guardada, sem uso, para você poder desfazer.`,
    'Se o Financeiro estiver fora do ar, o CRM mostra o erro e não cobra por outro caminho.',
    'Nada é apagado: Desfazer volta tudo como era.',
  ];
  return plano('pode_unificar', 'O Asaas está conectado no CRM e no Financeiro, na mesma conta. Dá para unificar.', [], passos);
}

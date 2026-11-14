/**
 * E3 · Cobrança — regras puras das telas (05/11/2026). Sem React e sem
 * banco: o que cada provedor faz, os rótulos da situação, quais ações cada
 * cobrança oferece (e por que alguma não está disponível), quem pode entrar
 * num lote de boletos ou num carnê, e o erro do provedor em palavras simples.
 *
 * Testado em scripts/test-cobranca-telas.ts.
 */
import { formatarLinhaDigitavel } from '../boleto-linha';
import type {
  CapacidadesDoProvedor, Cobranca, CodigoDeErro, ProvedorDeCobranca, StatusDaCobranca, TipoDeCobranca,
} from './contrato-telas';

// ─── O que cada provedor faz ───────────────────────────────────────────────

export interface DescricaoDoProvedor {
  id: ProvedorDeCobranca;
  nome: string;
  capacidades: CapacidadesDoProvedor;
  /** Tipos que a tela oferece para escolher. */
  tipos: TipoDeCobranca[];
  /** Uma frase: o que sai e por quê. */
  frase: string;
  /** O que o provedor aceita de juros, multa e desconto. */
  encargos: string;
}

/**
 * Lido na documentação oficial em 05/11/2026 (docs/programa/e3-contratos.md).
 * A tela nunca promete o que o provedor não faz.
 */
export const PROVEDORES: Record<ProvedorDeCobranca, DescricaoDoProvedor> = {
  asaas: {
    id: 'asaas',
    nome: 'Asaas',
    capacidades: { boletoComPix: true, carne: true, jurosMulta: true, desconto: true, link: true },
    tipos: ['boleto_pix', 'pix'],
    frase: 'O boleto já sai com o QR Code do Pix no mesmo documento: o cliente escolhe como pagar. Dá para gerar carnê com várias parcelas.',
    encargos: 'Juros em % ao mês, multa em % e desconto em % até alguns dias antes do vencimento.',
  },
  pagarme: {
    id: 'pagarme',
    nome: 'Pagar.me',
    capacidades: { boletoComPix: false, carne: false, jurosMulta: true, desconto: true, link: true },
    tipos: ['boleto', 'pix'],
    frase: 'Cada cobrança sai como boleto ou como Pix, um de cada vez: o Pagar.me não junta os dois no mesmo documento nem gera carnê.',
    encargos: 'Juros e multa só em %, e só em conta do Pagar.me que recebe direto (não na conta de intermediação). Desconto só em %.',
  },
};

export function nomeDoProvedor(p: string | null | undefined): string {
  return p === 'asaas' || p === 'pagarme' ? PROVEDORES[p].nome : 'Provedor';
}

export const ROTULO_DO_TIPO: Record<TipoDeCobranca, string> = {
  boleto: 'Boleto',
  pix: 'Pix',
  boleto_pix: 'Boleto com Pix',
  link: 'Link de pagamento',
  carne: 'Carnê',
};

// ─── Situação ──────────────────────────────────────────────────────────────

export type TomDaCobranca = 'neutro' | 'positivo' | 'negativo' | 'aviso' | 'info';

export const SITUACAO_DA_COBRANCA: Record<StatusDaCobranca, { rotulo: string; tom: TomDaCobranca }> = {
  emitindo: { rotulo: 'Emitindo', tom: 'info' },
  aberta: { rotulo: 'Aguardando pagamento', tom: 'neutro' },
  vencida: { rotulo: 'Vencida', tom: 'negativo' },
  paga: { rotulo: 'Paga', tom: 'positivo' },
  cancelada: { rotulo: 'Cancelada', tom: 'neutro' },
  estornada: { rotulo: 'Estornada', tom: 'aviso' },
  falhou: { rotulo: 'Não emitida', tom: 'negativo' },
};

/** Ainda pode ser paga pelo cliente. */
export function cobrancaViva(s: StatusDaCobranca): boolean {
  return s === 'emitindo' || s === 'aberta' || s === 'vencida';
}

/**
 * Situação da cobrança vista da CONTA a receber, para a coluna e o filtro da
 * lista Contas a Pagar/Receber. "Boleto não emitido" é a conta a receber em
 * aberto sem cobrança viva nem paga.
 */
export type SituacaoDaCobrancaNaConta = 'sem_boleto' | 'emitida' | 'vencida' | 'paga' | 'falhou' | 'nao_se_aplica';

export const ROTULO_NA_CONTA: Record<SituacaoDaCobrancaNaConta, string> = {
  sem_boleto: 'Boleto não emitido',
  emitida: 'Emitida',
  vencida: 'Cobrança vencida',
  paga: 'Paga pela cobrança',
  falhou: 'Não emitida (erro)',
  nao_se_aplica: '',
};

export function situacaoNaConta(conta: {
  tipo: 'pagar' | 'receber'; situacao: 'em_aberto' | 'em_atraso' | 'liquidado' | 'cancelado';
}, status: StatusDaCobranca | null | undefined): SituacaoDaCobrancaNaConta {
  if (conta.tipo !== 'receber') return 'nao_se_aplica';
  if (status === 'paga') return 'paga';
  const aberta = conta.situacao === 'em_aberto' || conta.situacao === 'em_atraso';
  if (!aberta) return 'nao_se_aplica';
  if (status === 'emitindo' || status === 'aberta') return 'emitida';
  if (status === 'vencida') return 'vencida';
  if (status === 'falhou') return 'falhou';
  return 'sem_boleto';
}

// ─── Ações de uma cobrança ─────────────────────────────────────────────────

export type IdDaAcao =
  | 'copiar_linha' | 'copiar_pix' | 'abrir_boleto' | 'abrir_fatura' | 'segunda_via' | 'enviar_email'
  | 'enviar_whatsapp' | 'cancelar' | 'emitir_de_novo';

export interface AcaoDaCobranca {
  id: IdDaAcao;
  rotulo: string;
  /** null = disponível; texto = por que não. */
  bloqueio: string | null;
  destrutiva?: boolean;
}

/**
 * As ações de uma cobrança, sempre na mesma ordem. Ação sem sentido para o
 * estado (copiar Pix de boleto puro) não aparece; ação que existe mas não
 * vale agora aparece com o motivo, para a pessoa entender.
 */
export function acoesDaCobranca(c: Pick<Cobranca, 'status' | 'tipo' | 'provedor' | 'linha_digitavel' | 'pix_copia_cola' | 'url_boleto' | 'url_fatura'>, pode: { emitir: boolean }): AcaoDaCobranca[] {
  const viva = cobrancaViva(c.status);
  const emitindo = c.status === 'emitindo';
  const semDireito = pode.emitir ? null : 'Seu acesso não inclui emitir boleto e Pix.';
  const acoes: AcaoDaCobranca[] = [];
  const temBoleto = c.tipo === 'boleto' || c.tipo === 'boleto_pix' || c.tipo === 'carne';
  const temPix = c.tipo === 'pix' || c.tipo === 'boleto_pix' || c.tipo === 'carne';

  if (temBoleto) {
    acoes.push({
      id: 'copiar_linha', rotulo: 'Copiar linha digitável',
      bloqueio: !viva ? 'A cobrança não está mais aberta.' : !c.linha_digitavel ? (emitindo ? 'O provedor ainda está gerando o boleto.' : 'O provedor não devolveu a linha digitável.') : null,
    });
  }
  if (temPix) {
    acoes.push({
      id: 'copiar_pix', rotulo: 'Copiar Pix copia e cola',
      bloqueio: !viva ? 'A cobrança não está mais aberta.' : !c.pix_copia_cola ? (emitindo ? 'O provedor ainda está gerando o Pix.' : 'Esta conta do provedor não tem chave Pix cadastrada.') : null,
    });
  }
  if (temBoleto || c.url_boleto) {
    acoes.push({ id: 'abrir_boleto', rotulo: c.tipo === 'carne' ? 'Abrir carnê (PDF)' : 'Abrir boleto (PDF)', bloqueio: c.url_boleto ? null : 'O PDF ainda não está pronto.' });
  }
  if (c.url_fatura) acoes.push({ id: 'abrir_fatura', rotulo: 'Abrir página de pagamento', bloqueio: null });

  acoes.push({
    id: 'segunda_via', rotulo: '2ª via (novo vencimento)',
    bloqueio: semDireito ?? (!viva || emitindo ? 'Só cobrança aberta ou vencida ganha 2ª via.' : null),
  });
  acoes.push({ id: 'enviar_email', rotulo: 'Enviar por e-mail', bloqueio: semDireito ?? (!viva || emitindo ? 'Só cobrança aberta ou vencida pode ser enviada.' : null) });
  acoes.push({ id: 'enviar_whatsapp', rotulo: 'Enviar por WhatsApp', bloqueio: semDireito ?? (!viva || emitindo ? 'Só cobrança aberta ou vencida pode ser enviada.' : null) });
  if (c.status === 'falhou' || c.status === 'cancelada') {
    acoes.push({ id: 'emitir_de_novo', rotulo: 'Emitir de novo', bloqueio: semDireito });
  }
  acoes.push({
    id: 'cancelar', rotulo: 'Cancelar cobrança', destrutiva: true,
    bloqueio: semDireito ?? (!viva ? 'A cobrança não está aberta.' : emitindo ? 'Espere o provedor terminar de emitir.' : null),
  });
  return acoes;
}

// ─── Quem entra num lote ou num carnê (filtro da tela, antes do servidor) ──

export interface ContaParaCobrar {
  id: string;
  tipo: 'pagar' | 'receber';
  situacao: 'em_aberto' | 'em_atraso' | 'liquidado' | 'cancelado';
  saldo: number;
  pessoa: string;
  /** cliente_id da conta a receber (vazio quando não há ficha). */
  cliente_id?: string;
  vencimento: string;
  cobranca?: SituacaoDaCobrancaNaConta;
}

/**
 * Separa as marcadas em "podem ganhar boleto" e "ficam de fora", com o
 * motivo. O servidor confere de novo na prévia; aqui é só para a tela dizer
 * cedo o óbvio (conta a pagar, paga, já com boleto).
 */
export function separarParaBoleto<T extends ContaParaCobrar>(contas: readonly T[]): { prontas: T[]; fora: Array<{ conta: T; motivo: string }> } {
  const prontas: T[] = [];
  const fora: Array<{ conta: T; motivo: string }> = [];
  for (const c of contas) {
    const motivo = c.tipo !== 'receber' ? 'É conta a pagar: boleto é só para o cliente pagar a agência.'
      : c.situacao === 'cancelado' ? 'Conta cancelada.'
      : c.situacao === 'liquidado' ? 'Já está recebida.'
      : c.saldo <= 0 ? 'Não tem saldo em aberto.'
      : c.cobranca === 'emitida' || c.cobranca === 'vencida' ? 'Já tem cobrança aberta. Use a 2ª via para mudar o vencimento.'
      : null;
    if (motivo) fora.push({ conta: c, motivo }); else prontas.push(c);
  }
  return { prontas, fora };
}

/**
 * Carnê: várias parcelas do MESMO cliente, num provedor que faz carnê.
 * Devolve o motivo quando não dá (para o botão explicar), ou null.
 */
export function motivoSemCarne(contas: readonly ContaParaCobrar[], provedor: ProvedorDeCobranca | '' | null): string | null {
  if (!provedor) return 'Conecte o Asaas em Configurações › Cobrança para gerar carnê.';
  if (!PROVEDORES[provedor].capacidades.carne) return `O ${PROVEDORES[provedor].nome} não gera carnê. Gere os boletos um a um.`;
  const { prontas } = separarParaBoleto(contas);
  if (prontas.length < 2) return 'Marque duas ou mais parcelas em aberto, sem boleto, do mesmo cliente.';
  const clientes = new Set(prontas.map(c => c.cliente_id || `nome:${c.pessoa.trim().toLowerCase()}`));
  if (clientes.size > 1) return 'O carnê é de um cliente só: as parcelas marcadas são de clientes diferentes.';
  const vencimentos = new Set(prontas.map(c => c.vencimento));
  if (vencimentos.size < prontas.length) return 'Duas parcelas vencem no mesmo dia: no carnê cada parcela tem o seu mês.';
  return null;
}

// ─── Erro do provedor em palavras simples ──────────────────────────────────

const MENSAGEM_DO_CODIGO: Record<CodigoDeErro, string> = {
  SEM_PROVEDOR: 'Nenhum provedor de cobrança está conectado. Conecte o Asaas ou o Pagar.me da agência em Configurações › Cobrança.',
  PROVEDOR_DESLIGADO: 'A integração com o provedor está desligada. Ligue em Configurações › Plataformas.',
  CREDENCIAL_INVALIDA: 'O provedor recusou a chave da agência. Confira a chave em Configurações › Plataformas.',
  PROVEDOR_FORA: 'O provedor não respondeu agora. Nada foi cobrado; tente de novo em alguns minutos.',
  LIMITE_DO_PROVEDOR: 'O provedor pediu uma pausa por excesso de pedidos. As cobranças seguem na fila sozinhas.',
  CLIENTE_SEM_DOCUMENTO: 'O cliente está sem CPF ou CNPJ válido. Boleto registrado exige o documento: complete a ficha do cliente.',
  CLIENTE_SEM_CONTATO: 'O cliente está sem e-mail e sem telefone. Complete a ficha para poder enviar a cobrança.',
  VALOR_MINIMO: 'O valor está abaixo do mínimo que o provedor aceita para boleto.',
  VENCIMENTO_INVALIDO: 'O vencimento já passou. Escolha uma data de hoje em diante.',
  JA_TEM_COBRANCA: 'Esta conta já tem uma cobrança aberta. Use a 2ª via para mudar o vencimento ou o valor.',
  CONTA_QUITADA: 'A conta já está recebida.',
  CONTA_CANCELADA: 'A conta está cancelada.',
  SEM_CARNE: 'O provedor conectado não gera carnê.',
  NADA_SAI: 'A agência está mudando de sistema: por enquanto nenhuma cobrança sai. Tente quando a mudança terminar.',
  ASSINATURA_VENCIDA: 'Algo mudou desde a prévia. Confira a prévia nova antes de confirmar.',
  SEM_PERMISSAO: 'Seu acesso não inclui emitir boleto e Pix.',
};

/** Texto para a tela a partir do código (preferido) ou da mensagem que veio. */
export function mensagemDeErro(codigo: string | null | undefined, texto: string | null | undefined, status?: number): string {
  if (codigo && codigo in MENSAGEM_DO_CODIGO) return MENSAGEM_DO_CODIGO[codigo as CodigoDeErro];
  if (status === 0) return 'Sem resposta do servidor. Nada foi alterado; tente de novo.';
  if (status === 403) return texto || MENSAGEM_DO_CODIGO.SEM_PERMISSAO;
  if (status === 404) return 'A cobrança não foi encontrada. Ela pode ter sido apagada; atualize a tela.';
  if (status === 409) return texto || MENSAGEM_DO_CODIGO.ASSINATURA_VENCIDA;
  if (status === 429) return MENSAGEM_DO_CODIGO.LIMITE_DO_PROVEDOR;
  const t = (texto ?? '').trim();
  // Mensagem técnica (JSON, pilha, código HTTP cru) nunca vai para a tela.
  if (!t || /^\s*[[{]|\bat\s+\S+\s+\(|ECONN|ETIMEDOUT|stack|undefined|null/i.test(t)) {
    return 'O provedor recusou o pedido. Nada foi cobrado; tente de novo ou fale com o suporte.';
  }
  return t;
}

// ─── Configuração ──────────────────────────────────────────────────────────

/** Régua sugerida: 5 dias antes, no dia, e 1, 3 e 7 dias depois. */
export const DIAS_DA_REGUA_PADRAO = [-5, 0, 1, 3, 7] as const;

export function rotuloDoDiaDaRegua(d: number): string {
  if (d === 0) return 'No dia do vencimento';
  const n = Math.abs(d);
  return `${n} ${n === 1 ? 'dia' : 'dias'} ${d < 0 ? 'antes' : 'depois'}`;
}

/** Ordena, tira repetido e fora da faixa (até 30 dias antes ou 60 depois). */
export function normalizarDiasDaRegua(dias: readonly number[]): number[] {
  return [...new Set(dias.filter(d => Number.isInteger(d) && d >= -30 && d <= 60))].sort((a, b) => a - b);
}

/** Erros da configuração antes de mandar ao servidor (null = ok). */
export function errosDaConfig(c: {
  provedor_padrao: string; tipo_padrao: TipoDeCobranca; juros_am_pct: number; multa_pct: number;
  desconto_pct: number; desconto_dias: number; descricao_modelo: string;
}): Record<string, string> {
  const e: Record<string, string> = {};
  if (c.provedor_padrao === 'asaas' || c.provedor_padrao === 'pagarme') {
    if (!PROVEDORES[c.provedor_padrao].tipos.includes(c.tipo_padrao)) {
      e.tipo_padrao = `O ${PROVEDORES[c.provedor_padrao].nome} não emite ${ROTULO_DO_TIPO[c.tipo_padrao].toLowerCase()}.`;
    }
  }
  if (!(c.juros_am_pct >= 0 && c.juros_am_pct <= 10)) e.juros_am_pct = 'Juros entre 0% e 10% ao mês.';
  if (!(c.multa_pct >= 0 && c.multa_pct <= 10)) e.multa_pct = 'Multa entre 0% e 10%.';
  if (!(c.desconto_pct >= 0 && c.desconto_pct <= 50)) e.desconto_pct = 'Desconto entre 0% e 50%.';
  if (!(Number.isInteger(c.desconto_dias) && c.desconto_dias >= 0 && c.desconto_dias <= 60)) e.desconto_dias = 'De 0 a 60 dias.';
  if (c.descricao_modelo.length > 200) e.descricao_modelo = 'Até 200 letras: o banco corta o resto.';
  return e;
}

/** Prévia da descrição como o cliente vai ver. */
export function descricaoDeExemplo(modelo: string, agencia: string): string {
  const base = modelo.trim() || '{descricao}';
  return base
    .replaceAll('{descricao}', 'Pacote Lisboa e Porto')
    .replaceAll('{parcela}', '2/6')
    .replaceAll('{agencia}', agencia || 'Sua agência')
    .slice(0, 200);
}

// ─── Pequenos formatos ─────────────────────────────────────────────────────

export function dataBR(iso: string | null | undefined): string {
  const s = String(iso ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : '';
}

/** Linha digitável em blocos, para ler e conferir (o formatador de src/lib/boleto-linha.ts). */
export function linhaEmBlocos(linha: string | null | undefined): string {
  const t = String(linha ?? '');
  const n = t.replace(/\D/g, '').length;
  return n === 47 || n === 48 ? formatarLinhaDigitavel(t) : t;
}

// ─── Emitir boletos da venda (E7, 06/11/2026) ─────────────────────────────

/**
 * As contas a receber da venda (como a ficha as lê do banco) no formato de
 * "Gerar boleto(s)". Ficam de fora a comissão a receber do fornecedor e o que
 * vai para a fatura do cliente (a fatura tem a cobrança dela). O servidor
 * confere tudo de novo na prévia.
 */
export function contasDaVendaParaCobrar(
  contas: ReadonlyArray<Record<string, unknown>>, hoje: string,
): Array<ContaParaCobrar & { descricao: string }> {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const saida: Array<ContaParaCobrar & { descricao: string }> = [];
  for (const c of contas) {
    const origem = String(c.origem ?? '');
    if (origem === 'COMISSAO_FORNECEDOR' || c.faturar === true || c.na_fatura) continue;
    const status = String(c.status ?? 'PENDENTE').toUpperCase();
    const vencimento = String(c.data_vencimento ?? '').slice(0, 10);
    const situacao: ContaParaCobrar['situacao'] = status === 'CANCELADO' ? 'cancelado'
      : status === 'RECEBIDO' ? 'liquidado'
        : vencimento && vencimento < hoje ? 'em_atraso' : 'em_aberto';
    const recebido = status === 'PARCIAL' ? n(c.valor_recebido) : 0;
    const saldo = Math.round((n(c.valor_final) - recebido) * 100) / 100;
    const cob = (c.cobranca ?? null) as { status?: StatusDaCobranca } | null;
    if (!c.id) continue;
    saida.push({
      id: String(c.id), tipo: 'receber', situacao, saldo, pessoa: String(c.cliente_nome ?? ''),
      cliente_id: String(c.cliente_id ?? ''), vencimento, descricao: String(c.descricao ?? ''),
      cobranca: situacaoNaConta({ tipo: 'receber', situacao }, cob?.status ?? null),
    });
  }
  return saida;
}

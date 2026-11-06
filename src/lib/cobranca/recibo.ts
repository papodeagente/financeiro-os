/**
 * Recibo de uma conta recebida ou de um recebimento (baixa) — regras puras
 * (05/11/2026). A página imprime; aqui se decide o que vai nela e se pode
 * haver recibo:
 *
 *   · recibo da CONTA: só quando está recebida por inteiro; valor = o que
 *     entrou (soma das baixas que valem, ou o valor recebido gravado);
 *   · recibo de uma BAIXA: o valor daquele recebimento, mesmo que a conta
 *     ainda tenha saldo; baixa estornada não tem recibo;
 *   · conta a pagar, cancelada ou sem nada recebido: sem recibo, com o
 *     motivo escrito.
 *
 * O número do recibo é estável (o mesmo documento sai igual quando
 * impresso de novo): derivado do id da conta ou da baixa.
 */
import { formatarDocumento } from '../cliente-documento';
import { comMaiuscula, valorPorExtenso } from './extenso';

export interface AgenciaDoRecibo {
  razao_social?: string;
  nome_fantasia?: string;
  /** Nome da agência no cadastro (Configurações › Dados da agência). */
  nome?: string;
  cnpj?: string;
  telefone?: string;
  email?: string;
  endereco?: { logradouro?: string; numero?: string; bairro?: string; cidade?: string; estado?: string; cep?: string };
  logo?: string;
}

export interface ContaDoRecibo {
  id: string;
  status: string;
  cliente_nome: string;
  descricao: string;
  valor_final: number;
  valor_recebido: number | null;
  data_recebimento: string | null;
  forma_recebimento: string;
  parcela_numero?: number;
  total_parcelas?: number;
}

export interface BaixaDoRecibo {
  id: string;
  tipo: 'baixa' | 'estorno' | 'anterior' | 'legada';
  data: string;
  forma: string;
  valor: number;
  juros: number;
  multa: number;
  desconto: number;
  estornada: boolean;
}

export interface Recibo {
  numero: string;
  emitente: { nome: string; documento: string; endereco: string; contato: string; logo: string };
  pagador: { nome: string; documento: string };
  valor: number;
  valor_por_extenso: string;
  referente: string;
  forma: string;
  /** AAAA-MM-DD */
  data: string;
  cidade: string;
  /** Detalhe dos encargos quando houve (juros, multa, desconto). */
  encargos: Array<{ rotulo: string; valor: number }>;
}

export type ResultadoDoRecibo = { ok: true; recibo: Recibo } | { ok: false; motivo: string };

const FORMAS: Record<string, string> = {
  PIX: 'Pix', TED: 'Transferência bancária', BOLETO: 'Boleto', CARTAO: 'Cartão', CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito', DINHEIRO: 'Dinheiro', CHEQUE: 'Cheque', DEPOSITO: 'Depósito em conta',
};

export function rotuloDaForma(f: string | null | undefined): string {
  const k = String(f ?? '').trim();
  if (!k) return 'Não informada';
  return FORMAS[k.toUpperCase()] ?? k.charAt(0).toUpperCase() + k.slice(1).toLowerCase().replace(/_/g, ' ');
}

/** "RC-" + 8 caracteres do id, em maiúsculas: curto, estável e sem informação sensível. */
export function numeroDoRecibo(id: string): string {
  const limpo = id.replace(/[^a-zA-Z0-9]/g, '');
  return `RC-${limpo.slice(-8).toUpperCase().padStart(8, '0')}`;
}

function emitenteDe(a: AgenciaDoRecibo | null) {
  const e = a?.endereco ?? {};
  const linha1 = [e.logradouro, e.numero].filter(Boolean).join(', ');
  const linha2 = [e.bairro, [e.cidade, e.estado].filter(Boolean).join('/')].filter(Boolean).join(' · ');
  return {
    nome: (a?.razao_social || a?.nome_fantasia || a?.nome || 'Agência').trim(),
    documento: a?.cnpj ? `CNPJ ${formatarDocumento(a.cnpj)}` : '',
    endereco: [linha1, linha2].filter(Boolean).join(' · '),
    contato: [a?.telefone, a?.email].filter(Boolean).join(' · '),
    logo: a?.logo || '',
  };
}

function referenteDe(c: ContaDoRecibo): string {
  const parcela = (c.total_parcelas ?? 0) > 1 ? ` (parcela ${c.parcela_numero}/${c.total_parcelas})` : '';
  return `${(c.descricao || 'Serviços de turismo').trim()}${parcela}`;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function montarRecibo(entrada: {
  agencia: AgenciaDoRecibo | null;
  conta: ContaDoRecibo;
  /** Documento do pagador (CPF/CNPJ) — o recibo interno mostra inteiro; o portal, mascarado. */
  documentoDoPagador?: string;
  baixas: readonly BaixaDoRecibo[];
  /** Recibo de UM recebimento; sem ele, da conta inteira. */
  baixaId?: string | null;
  /** Data de hoje (AAAA-MM-DD), quando a conta não tem data de recebimento. */
  hoje: string;
}): ResultadoDoRecibo {
  const { agencia, conta, baixas } = entrada;
  if (conta.status === 'CANCELADO') return { ok: false, motivo: 'A conta está cancelada: não há recibo.' };
  const valendo = baixas.filter(b => b.tipo !== 'estorno' && !b.estornada && b.valor > 0);
  const emitente = emitenteDe(agencia);
  const pagador = { nome: (conta.cliente_nome || 'Cliente').trim(), documento: entrada.documentoDoPagador ?? '' };
  const cidade = agencia?.endereco?.cidade ?? '';

  if (entrada.baixaId) {
    const b = baixas.find(x => x.id === entrada.baixaId);
    if (!b) return { ok: false, motivo: 'Este recebimento não foi encontrado nesta conta.' };
    if (b.tipo === 'estorno' || b.estornada) return { ok: false, motivo: 'Este recebimento foi estornado: não há recibo.' };
    if (!(b.valor > 0)) return { ok: false, motivo: 'Este recebimento não tem valor.' };
    const encargos = [
      b.juros > 0 ? { rotulo: 'Juros', valor: r2(b.juros) } : null,
      b.multa > 0 ? { rotulo: 'Multa', valor: r2(b.multa) } : null,
      b.desconto > 0 ? { rotulo: 'Desconto', valor: -r2(b.desconto) } : null,
    ].filter(Boolean) as Recibo['encargos'];
    return {
      ok: true,
      recibo: {
        numero: numeroDoRecibo(b.id), emitente, pagador,
        valor: r2(b.valor), valor_por_extenso: comMaiuscula(valorPorExtenso(r2(b.valor))),
        referente: referenteDe(conta), forma: rotuloDaForma(b.forma), data: b.data.slice(0, 10), cidade, encargos,
      },
    };
  }

  if (conta.status !== 'RECEBIDO') {
    return {
      ok: false,
      motivo: valendo.length
        ? 'A conta ainda tem saldo em aberto. Imprima o recibo de cada recebimento no histórico de baixas.'
        : 'A conta ainda não foi recebida.',
    };
  }
  const somaBaixas = r2(valendo.reduce((s, b) => s + b.valor, 0));
  const valor = somaBaixas > 0 ? somaBaixas : r2(Number(conta.valor_recebido) || Number(conta.valor_final) || 0);
  if (!(valor > 0)) return { ok: false, motivo: 'A conta não tem valor recebido.' };
  const ultima = [...valendo].sort((a, b) => b.data.localeCompare(a.data))[0];
  const formas = [...new Set(valendo.map(b => rotuloDaForma(b.forma)))];
  const soma = (k: 'juros' | 'multa' | 'desconto') => r2(valendo.reduce((s, b) => s + (b[k] || 0), 0));
  const encargos = [
    soma('juros') > 0 ? { rotulo: 'Juros', valor: soma('juros') } : null,
    soma('multa') > 0 ? { rotulo: 'Multa', valor: soma('multa') } : null,
    soma('desconto') > 0 ? { rotulo: 'Desconto', valor: -soma('desconto') } : null,
  ].filter(Boolean) as Recibo['encargos'];
  return {
    ok: true,
    recibo: {
      numero: numeroDoRecibo(conta.id), emitente, pagador,
      valor, valor_por_extenso: comMaiuscula(valorPorExtenso(valor)),
      referente: referenteDe(conta),
      forma: formas.length ? formas.join(' e ') : rotuloDaForma(conta.forma_recebimento),
      data: (ultima?.data || conta.data_recebimento || entrada.hoje).slice(0, 10),
      cidade, encargos,
    },
  };
}

/** "São Paulo, 5 de novembro de 2026" (ou só a data, sem cidade). */
export function dataPorExtenso(iso: string, cidade?: string): string {
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return cidade ?? '';
  const texto = `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
  return cidade ? `${cidade}, ${texto}` : texto;
}

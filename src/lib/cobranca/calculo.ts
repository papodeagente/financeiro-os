/**
 * Regras puras da cobrança (sem banco, sem rede), testadas com
 * scripts/run-tests.mjs em scripts/test-cobranca.ts.
 */
import { addMeses, num, paraCentavos } from '../money';
import { saldoEmAberto } from '../avisos-vencimento';
import { digitos } from '../plataformas/comum';
import type { TipoEventoPlataforma } from '../plataformas/tipos';
import type {
  CapacidadesCobranca, ClienteDaCobranca, CodigoErroCobranca, MudancaDeCobranca, StatusCobranca, TipoCobranca, TipoEmissao,
} from './tipos';

/**
 * Descrição da cobrança pelo modelo da agência (Configurações › Cobrança):
 * aceita {descricao}, {parcela} e {agencia}. Modelo sem marcador vira
 * prefixo ("Agência X · Pacote"). Sem modelo: a descrição da conta.
 */
export function descricaoPeloModelo(
  modelo: string, v: { descricao: string; parcela: string; agencia: string; pedida?: string },
): string {
  const base = (v.pedida ?? '').trim() || v.descricao.trim() || 'Cobrança';
  const m = modelo.trim();
  if (!m) return base.slice(0, 500);
  if (!/\{(descricao|parcela|agencia)\}/.test(m)) return `${m} · ${base}`.slice(0, 500);
  const texto = m
    .replace(/\{descricao\}/g, base)
    .replace(/\{parcela\}/g, v.parcela)
    .replace(/\{agencia\}/g, v.agencia)
    .replace(/\(\s*\)/g, '')
    .replace(/\s*[·–-]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return (texto || base).slice(0, 500);
}

/** O código que a tela entende para um motivo de recusa de uma conta. */
export function codigoDoMotivo(motivo: string | null | undefined): CodigoErroCobranca | null {
  const m = String(motivo ?? '');
  if (!m) return null;
  if (m.includes('já tem cobrança')) return 'JA_TEM_COBRANCA';
  if (m.includes('já foi recebida') || m.includes('Não há saldo')) return 'CONTA_QUITADA';
  if (m.includes('está cancelada')) return 'CONTA_CANCELADA';
  if (m.includes('CPF ou CNPJ')) return 'CLIENTE_SEM_DOCUMENTO';
  if (m.includes('Complete o cadastro') || m.includes('não está ligada a um cliente')) return 'CLIENTE_SEM_CONTATO';
  if (m.includes('vencimento')) return 'VENCIMENTO_INVALIDO';
  return null;
}

/** Dias de `de` até `ate` (datas AAAA-MM-DD; positivo quando `ate` é depois). */
export function diasEntre(de: string, ate: string): number {
  const a = Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10));
  const b = Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** O dia da régua que cai hoje para este vencimento, ou null. */
export function diaDaReguaHoje(vencimento: string, hoje: string, dias: readonly number[]): number | null {
  if (!DATA.test(String(vencimento ?? '').slice(0, 10))) return null;
  const d = diasEntre(vencimento.slice(0, 10), hoje);
  return dias.includes(d) ? d : null;
}

/** Nome do tipo para frases da tela. */
export function nomeDoTipo(tipo: TipoCobranca): string {
  return { boleto: 'boleto', pix: 'Pix', boleto_pix: 'boleto com Pix', link: 'link de pagamento', carne: 'carnê' }[tipo];
}

/** O que falta no cadastro do cliente para este provedor e tipo. Vazio = pronto. */
export function faltasDoCliente(c: ClienteDaCobranca, provedor: 'asaas' | 'pagarme', tipo: TipoCobranca): string[] {
  const faltas: string[] = [];
  const doc = digitos(c.documento);
  if (!c.nome.trim()) faltas.push('nome');
  if (doc.length !== 11 && doc.length !== 14) faltas.push('CPF ou CNPJ');
  if (provedor === 'pagarme') {
    if (tipo === 'pix') {
      if (!c.email.trim()) faltas.push('e-mail');
      if (digitos(c.telefone).length < 10) faltas.push('telefone com DDD');
    } else if (tipo !== 'link') {
      const e = c.endereco;
      if (!e || digitos(e.cep).length !== 8 || !e.logradouro || !e.cidade || !e.uf) faltas.push('endereço com CEP');
    }
  }
  return faltas;
}

/** O tipo pedido existe neste provedor? Devolve a frase de recusa ou null. */
export function tipoRecusado(caps: CapacidadesCobranca, nomeProvedor: string, tipo: TipoCobranca): string | null {
  if (tipo === 'boleto_pix' && !caps.boletoComPix) {
    return `O ${nomeProvedor} não emite boleto e Pix no mesmo documento. Escolha boleto ou Pix.`;
  }
  if (tipo === 'carne' && !caps.carne) return `O ${nomeProvedor} não emite carnê. Emita um boleto por parcela.`;
  if (tipo === 'link' && !caps.link) return `O ${nomeProvedor} não cria link de pagamento.`;
  if (tipo === 'boleto' && !caps.boleto) return `O ${nomeProvedor} não emite boleto.`;
  if (tipo === 'pix' && !caps.pix) return `O ${nomeProvedor} não emite Pix.`;
  return null;
}

export interface ContaParaCobrar {
  id: string;
  dados: Record<string, unknown>;
  /** Já tem cobrança valendo (emitindo/aberta/vencida). */
  cobranca_valendo: boolean;
}

export interface ItemPlanejado {
  conta_id: string;
  descricao: string;
  cliente_id: string;
  cliente_nome: string;
  /** "2/5" quando a conta é parcela de algo; vazio quando não é. */
  parcela: string;
  valor_centavos: number;
  vencimento: string;
  erros: string[];
  avisos: string[];
}

/**
 * A conta pode ser cobrada? Valor = o saldo em aberto. Vencimento = o pedido,
 * ou o da conta; vencimento no passado pede um novo (o provedor recusa).
 */
export function planejarItem(
  conta: ContaParaCobrar,
  hoje: string,
  opcoes: { vencimento?: string; vencimento_vencidas?: string },
): ItemPlanejado {
  const d = conta.dados;
  const erros: string[] = [];
  const avisos: string[] = [];
  const status = String(d.status ?? 'PENDENTE').toUpperCase();
  if (status === 'CANCELADO') erros.push('A conta está cancelada.');
  if (status === 'RECEBIDO') erros.push('A conta já foi recebida.');
  if (conta.cobranca_valendo) erros.push('Esta conta já tem cobrança emitida. Para mudar, faça a 2ª via ou cancele a atual.');
  const saldo = saldoEmAberto(d, 'contas_receber');
  if (saldo <= 0 && !erros.length) erros.push('Não há saldo em aberto nesta conta.');
  if (status === 'PARCIAL') avisos.push('A conta já tem parte recebida: a cobrança sai pelo que falta.');

  const daConta = String(d.data_vencimento ?? '').slice(0, 10);
  let vencimento = String(opcoes.vencimento ?? '').slice(0, 10) || daConta;
  if (!DATA.test(vencimento)) {
    erros.push('A conta não tem vencimento. Informe um.');
    vencimento = '';
  } else if (vencimento < hoje) {
    const novo = String(opcoes.vencimento_vencidas ?? '').slice(0, 10);
    if (!opcoes.vencimento && DATA.test(novo) && novo >= hoje) {
      avisos.push(`Venceu em ${formatarData(vencimento)}: a cobrança sai com vencimento em ${formatarData(novo)}.`);
      vencimento = novo;
    } else {
      erros.push(`O vencimento (${formatarData(vencimento)}) já passou. Escolha uma nova data.`);
    }
  }

  return {
    conta_id: conta.id,
    descricao: String(d.descricao ?? ''),
    cliente_id: String(d.cliente_id ?? ''),
    cliente_nome: String(d.cliente_nome ?? ''),
    parcela: Number(d.total_parcelas) > 1 ? `${Number(d.parcela_numero) || 1}/${Number(d.total_parcelas)}` : '',
    valor_centavos: paraCentavos(saldo),
    vencimento,
    erros,
    avisos,
  };
}

export function formatarData(iso: string): string {
  return DATA.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;
}

/**
 * Carnê (Asaas): as parcelas são do mesmo cliente, têm o MESMO valor e
 * vencem no mesmo dia de meses seguidos. É assim que o provedor monta o
 * parcelamento; outra combinação viraria um carnê diferente das contas.
 */
export function conferirCarne(itens: readonly ItemPlanejado[]): string[] {
  const erros: string[] = [];
  if (itens.length < 2) erros.push('O carnê precisa de pelo menos duas parcelas.');
  if (itens.length > 36) erros.push('O carnê vai até 36 parcelas.');
  const clientes = new Set(itens.map(i => i.cliente_id || i.cliente_nome));
  if (clientes.size > 1) erros.push('Todas as parcelas do carnê precisam ser do mesmo cliente.');
  const valores = new Set(itens.map(i => i.valor_centavos));
  if (valores.size > 1) erros.push('As parcelas do carnê precisam ter o mesmo valor. Para valores diferentes, emita um boleto por parcela.');
  const ordenados = [...itens].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const primeiro = ordenados[0]?.vencimento ?? '';
  if (primeiro && ordenados.some((it, i) => it.vencimento !== addMeses(primeiro, i))) {
    erros.push('As parcelas do carnê precisam vencer no mesmo dia de meses seguidos.');
  }
  return erros;
}

/** 2ª via: altera no provedor ou cancela e emite outra. */
export function comoAlterar(caps: CapacidadesCobranca, tipo: TipoCobranca, atual: { valor_centavos: number; vencimento: string }, m: MudancaDeCobranca): 'nada' | 'alterar' | 'reemitir' {
  const mudaValor = m.valor_centavos !== undefined && m.valor_centavos !== atual.valor_centavos;
  const mudaVenc = m.vencimento !== undefined && m.vencimento !== atual.vencimento;
  if (!mudaValor && !mudaVenc) return 'nada';
  if (tipo === 'carne' || tipo === 'link') return 'reemitir';
  if (mudaValor && !caps.alterarValor) return 'reemitir';
  if (mudaVenc && (tipo === 'pix' ? !caps.alterarVencimentoPix : !caps.alterarVencimento)) return 'reemitir';
  return 'alterar';
}

export interface EfeitoDoAviso {
  status: StatusCobranca;
  /** Registrar o recebimento (baixa) agora. */
  baixar: boolean;
  /** Desfazer o recebimento (estorno da baixa). */
  estornar: boolean;
  /** Pagamento confirmado, crédito ainda por vir (só anota). */
  aguardandoCredito: boolean;
  /** Nome curto do que aconteceu, para o histórico. */
  evento: string;
}

/**
 * O que um aviso do provedor faz com a nossa cobrança.
 *
 * Pago: quando o provedor avisa o crédito à parte (Asaas), a baixa espera o
 * "recebido" (o caixa só se move quando o dinheiro cai); quando não avisa
 * (Pagar.me), a baixa é no "pago". Estado final não volta: cobrança paga
 * não reabre por um aviso de vencido atrasado.
 */
export function efeitoDoAviso(
  atual: StatusCobranca,
  tipo: TipoEventoPlataforma,
  caps: Pick<CapacidadesCobranca, 'avisaCredito'>,
  o: { jaBaixada: boolean; estornoParcial?: boolean; vencimentoNoAviso?: string; hoje?: string },
): EfeitoDoAviso {
  const fica = (evento: string): EfeitoDoAviso => ({ status: atual, baixar: false, estornar: false, aguardandoCredito: false, evento });
  const final = atual === 'cancelada' || atual === 'estornada' || atual === 'falhou';
  switch (tipo) {
    case 'PAGAMENTO_RECEBIDO':
      if (atual === 'estornada' || atual === 'falhou') return fica('pagamento depois de encerrada');
      return { status: 'paga', baixar: !o.jaBaixada, estornar: false, aguardandoCredito: false, evento: 'recebida' };
    case 'PAGAMENTO_CONFIRMADO':
      if (atual === 'estornada' || atual === 'falhou') return fica('pagamento depois de encerrada');
      if (caps.avisaCredito) return { status: 'paga', baixar: false, estornar: false, aguardandoCredito: !o.jaBaixada, evento: 'paga' };
      return { status: 'paga', baixar: !o.jaBaixada, estornar: false, aguardandoCredito: false, evento: 'paga' };
    case 'PAGAMENTO_ATRASADO':
      if (atual === 'aberta' || atual === 'emitindo') return { ...fica('vencida'), status: 'vencida' };
      return fica('aviso de vencida ignorado');
    case 'PAGAMENTO_CANCELADO':
      if (atual === 'paga') return fica('cancelamento depois de paga');
      if (final) return fica('cancelada no provedor');
      return { ...fica('cancelada no provedor'), status: 'cancelada' };
    case 'REEMBOLSO':
    case 'CHARGEBACK':
      if (o.estornoParcial) return fica('estorno parcial no provedor');
      if (atual === 'estornada') return fica('estorno repetido');
      return { status: 'estornada', baixar: false, estornar: o.jaBaixada, aguardandoCredito: false, evento: tipo === 'CHARGEBACK' ? 'contestada' : 'estornada' };
    case 'PAGAMENTO_CRIADO': {
      // "Alterada" ou "restaurada": volta a valer se estava vencida e o novo
      // vencimento é hoje ou depois.
      if (atual === 'vencida' && o.vencimentoNoAviso && o.hoje && o.vencimentoNoAviso >= o.hoje) {
        return { ...fica('alterada'), status: 'aberta' };
      }
      return fica('alterada');
    }
    default:
      return fica('aviso sem efeito');
  }
}

/** Status da cobrança gravado na conta a receber (para listas e filtros). */
export function resumoParaConta(c: { id: string; status: StatusCobranca; tipo: TipoCobranca; provedor: string; vencimento: string; valor_centavos: number }) {
  return { id: c.id, status: c.status, tipo: c.tipo, provedor: c.provedor, vencimento: c.vencimento, valor: num(c.valor_centavos) / 100 };
}

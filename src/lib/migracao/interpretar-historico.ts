/**
 * Mudança v2 (E7, 06/11/2026): de linha da planilha a registro, para as
 * listas do histórico. Puro, sem banco. Mesmas regras de leitura da v1
 * (interpretar.ts): datas ISO, dinheiro em centavos, CPF/CNPJ só dígitos,
 * recusa com código e motivo em palavras.
 *
 * As contas liquidadas saem da MESMA lista de contas a pagar e a receber:
 * a linha liquidada até a data de corte vira histórico (conta + baixa na
 * data e na conta certas); a liquidada depois do corte entra em aberto,
 * como na v1; a que não foi liquidada também.
 */
import { TIPOS_PRODUTO, type TipoProduto } from '../venda-modelo';
import { CAMPOS_DOS_MESES } from './dicionario';
import type { Interpretacao, OpcoesDeLeitura, TituloLido } from './interpretar';
import { lerMovimento } from './interpretar';
import {
  dataBR, lerCentavos, lerData, lerDocumento, lerSimNao, normalizar, texto, type Celula,
} from './valores';

export interface BaixaLida {
  /** Data da liquidação (AAAA-MM-DD). */
  data: string;
  /** Conta da liquidação, como escrita no arquivo. */
  conta: string;
  /** Quanto entrou ou saiu, em centavos (sem a taxa). */
  valor: number;
  juros: number;
  multa: number;
  desconto: number;
  taxa: number;
  forma: string;
}

/** Conta já liquidada até a data de corte: a conta e a baixa dela. */
export interface LiquidadoLido extends TituloLido { baixa: BaixaLida }

/** Uma linha do extrato de conta ou das movimentações. */
export interface MovimentoLido {
  data: string;
  conta: string;
  /** Em centavos, sempre positivo; `entrada` diz o lado. */
  valor: number;
  entrada: boolean;
  pessoa: string;
  documento_pessoa: string;
  descricao: string;
  documento: string;
  numero: string;
  venda: string;
  fatura: string;
  forma: string;
  categoria: string;
  empresa: string;
}

/** Um produto vendido (uma linha da lista de vendas por produto). */
export interface ProdutoVendidoLido {
  venda: string;
  data_venda: string;
  tipo: TipoProduto;
  produto: string;
  pagante: string;
  documento_cliente: string;
  email: string;
  venda_cancelada: boolean;
  cancelado_em: string | null;
  empresa: string;
  vendedor: string;
  intermediario: string;
  fornecedor: string;
  representante: string;
  passageiros: string[];
  localizador: string;
  descricao: string;
  data_inicio: string;
  data_fim: string;
  quantidade: number;
  valor_unitario: number;
  tarifa: number;
  taxas: number;
  outras_taxas: number;
  taxa_du: number;
  rav: number;
  fee: number;
  markup: number;
  comissao: number;
  over: number;
  taxa_cc: number;
  desconto: number;
  /** Valor total do produto no sistema anterior (para conferir), centavos. */
  valor_total: number | null;
  /** Receita que o sistema anterior mostrava (para a prova da receita), centavos. */
  receita: number | null;
  moeda: string;
  cambio: number;
}

/** A venda montada com todos os produtos dela (as linhas com o mesmo Venda Nº). */
export interface VendaAgrupada {
  numero: string;
  data_venda: string;
  cliente: { nome: string; documento: string; email: string };
  vendedor: string;
  intermediario: string;
  empresa: string;
  produtos: ProdutoVendidoLido[];
  /** Linhas da planilha que formam a venda. */
  linhas: number[];
}

export interface FaturaLida {
  numero: string;
  pessoa: string;
  documento_pessoa: string;
  emissao: string | null;
  vencimento: string | null;
  liquidacao: string | null;
  valor: number;
  situacao: string;
  descricao: string;
}

export interface NotaLida {
  numero: string;
  serie: string;
  emissao: string;
  tomador: string;
  documento: string;
  valor: number;
  iss: number;
  situacao: string;
  codigo_verificacao: string;
  venda: string;
}

export interface ComissaoPagaLida {
  pessoa: string;
  funcao: string;
  data_venda: string;
  valor: number;
  retido: number;
  venda: string;
  pagante: string;
  descricao: string;
  documento: string;
  pago_em: string | null;
}

export interface MetaLida {
  pessoa: string;
  funcao: string;
  plano: string;
  ano: number;
  /** Janeiro a dezembro, em centavos (null = sem meta no mês). */
  meses: Array<number | null>;
}

export interface ReembolsoLido {
  tipo: 'CLIENTE' | 'FORNECEDOR';
  pessoa: string;
  documento_pessoa: string;
  valor: number;
  prazo: string | null;
  venda: string;
  descricao: string;
}

export interface CreditoLido {
  cliente: string;
  documento_pessoa: string;
  saldo: number;
  validade: string | null;
  venda: string;
  descricao: string;
}

export type RegistroDoHistorico =
  | { lista: 'liquidados'; dados: LiquidadoLido }
  | { lista: 'movimentos'; dados: MovimentoLido }
  | { lista: 'vendas'; dados: ProdutoVendidoLido; venda?: VendaAgrupada }
  | { lista: 'faturas'; dados: FaturaLida }
  | { lista: 'notas'; dados: NotaLida }
  | { lista: 'comissoes_pagas'; dados: ComissaoPagaLida }
  | { lista: 'metas'; dados: MetaLida }
  | { lista: 'reembolsos'; dados: ReembolsoLido }
  | { lista: 'creditos'; dados: CreditoLido };

const MOEDA_REAL = new Set(['', 'brl', 'r', 'real', 'reais']);
const ehReal = (v: string) => MOEDA_REAL.has(normalizar(v)) || texto(v) === 'R$';
const abs = (n: number | null) => (n === null ? 0 : Math.abs(n));

/** Nome do produto no arquivo → tipo de produto do EnturOS. */
export function tipoDoProduto(v: unknown): TipoProduto {
  const s = normalizar(v);
  const direto = s.toUpperCase().replace(/ /g, '_');
  if ((TIPOS_PRODUTO as readonly string[]).includes(direto)) return direto as TipoProduto;
  if (/aereo.*agencia|bilhete.*agencia/.test(s)) return 'AEREO_AGENCIA';
  if (/aere|passag|voo|bilhete|cia aerea/.test(s)) return 'AEREO';
  if (/hosped|hotel|pousada|resort|diaria/.test(s)) return 'HOSPEDAGEM';
  if (/pacote|package/.test(s)) return 'PACOTE';
  if (/cruzeir|navio|cabine/.test(s)) return 'CRUZEIRO';
  if (/seguro|assistencia/.test(s)) return 'SEGURO';
  if (/loca|carro|veicul|aluguel/.test(s)) return 'LOCACAO';
  if (/recept|transfer|passeio|tour|traslado/.test(s)) return 'RECEPTIVO';
  if (/ingress|ticket|parque|show/.test(s)) return 'INGRESSO';
  return 'OUTROS';
}

/** "Ana Souza, Bruno Lima; Carla" → ['Ana Souza', 'Bruno Lima', 'Carla']. */
export function lerPassageiros(v: unknown): string[] {
  return texto(v).split(/\s*[;,/|]\s*|\s+e\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/).map(x => x.trim()).filter(Boolean).slice(0, 50);
}

/** A situação diz que a linha está liquidada? */
export function situacaoLiquidada(v: unknown): boolean {
  return /liquidad|quitad|^pago|^paga$|^recebid/.test(normalizar(v));
}

/** A situação diz que a linha foi excluída ou cancelada no sistema anterior? */
export function situacaoExcluida(v: unknown): boolean {
  return /exclu|cancelad|estornad/.test(normalizar(v));
}

type Ler = (campo: string) => Celula;

/**
 * Interpreta uma linha de lista do histórico. `ler` devolve a célula do
 * campo (o mapeamento já aplicado, com o contexto do agrupamento). A
 * lista "liquidados" pode devolver um registro de "titulos" (a linha que
 * ainda estava em aberto, ou foi liquidada depois do corte): a v1 cuida dela.
 */
export function interpretarDoHistorico(
  lista: string, ler: Ler, opcoes: OpcoesDeLeitura, tituloDaV1: (semLiquidacao?: boolean) => Interpretacao,
): Interpretacao {
  const t = (campo: string) => texto(ler(campo));
  const vazio = (c: Celula) => c === null || c === '';
  const centavos = (campo: string) => lerCentavos(ler(campo));
  const fora = (empresa: string): Interpretacao | null =>
    opcoes.empresas?.length && !opcoes.empresas.some(e => normalizar(e) === normalizar(empresa))
      ? { ok: false, codigo: 'outra_empresa', motivo: `Da empresa "${empresa || 'sem empresa'}", que ficou de fora desta mudança.` }
      : null;

  switch (lista) {
    case 'liquidados': {
      const liqBruto = ler('liquidacao');
      const liquidacao = vazio(liqBruto) ? null : lerData(liqBruto);
      if (!vazio(liqBruto) && !liquidacao) return { ok: false, codigo: 'data_invalida', motivo: `A liquidação "${texto(liqBruto)}" não é uma data.` };
      // Sem liquidação, ou liquidada depois do corte: é conta em aberto (regra da v1).
      if (!liquidacao || (opcoes.dataCorte && liquidacao > opcoes.dataCorte)) return tituloDaV1();
      if (situacaoExcluida(ler('situacao'))) return { ok: false, codigo: 'excluido', motivo: 'Excluído no sistema anterior.' };
      // A v1 lê a conta (pessoa, valores, datas). A liquidação vem à parte.
      const comoTitulo = tituloDaV1(true);
      if (!comoTitulo.ok) return comoTitulo;
      if (comoTitulo.registro.lista !== 'titulos') return comoTitulo;
      const titulo = comoTitulo.registro.dados;
      const pagoBruto = centavos('valor_pago');
      const juros = abs(centavos('juros'));
      const multa = abs(centavos('multa'));
      const desconto = abs(centavos('desconto'));
      const taxa = abs(centavos('taxa'));
      const valorPago = pagoBruto !== null && pagoBruto !== 0 ? Math.abs(pagoBruto) : titulo.valor + juros + multa - desconto;
      if (valorPago <= 0) return { ok: false, codigo: 'sem_valor', motivo: 'Liquidada sem valor pago.' };
      const avisos = [...comoTitulo.avisos];
      if (!t('conta')) avisos.push('Sem a conta da liquidação: a baixa entra no Caixa Geral.');
      return {
        ok: true, avisos,
        registro: {
          lista: 'liquidados',
          dados: { ...titulo, liquidado_depois_do_corte: null, baixa: { data: liquidacao, conta: t('conta').slice(0, 80), valor: valorPago, juros, multa, desconto, taxa, forma: t('forma').slice(0, 60) } },
        },
      };
    }
    case 'movimentos': {
      const dataBruta = ler('data');
      const data = lerData(dataBruta);
      if (!data) return { ok: false, codigo: 'data_invalida', motivo: vazio(dataBruta) ? 'Sem data.' : `A data "${texto(dataBruta)}" não é uma data.` };
      const bruto = ler('valor');
      const v = lerCentavos(bruto);
      if (vazio(bruto)) return { ok: false, codigo: 'sem_valor', motivo: 'Sem valor.' };
      if (v === null) return { ok: false, codigo: 'valor_invalido', motivo: `O valor "${texto(bruto)}" não é um valor.` };
      if (v === 0) return { ok: false, codigo: 'sem_valor', motivo: 'Valor zero.' };
      const conta = t('conta');
      if (!conta) return { ok: false, codigo: 'falta_coluna', motivo: 'Movimento sem a conta.' };
      const moeda = t('moeda');
      if (moeda && !ehReal(moeda)) return { ok: false, codigo: 'moeda_estrangeira', motivo: `Movimento em ${moeda}: contas em outra moeda entram pela tela de câmbio.` };
      const empresa = t('empresa');
      const f = fora(empresa);
      if (f) return f;
      if (opcoes.dataCorte && data > opcoes.dataCorte) {
        return { ok: false, codigo: 'depois_do_corte', motivo: `De ${dataBR(data)}, depois da data de corte: o que aconteceu depois do corte se lança aqui (e se confere no mês em paralelo).` };
      }
      const mov = lerMovimento(ler('movimento'));
      const entrada = mov ? mov === 'receber' : v > 0;
      return {
        ok: true, avisos: [],
        registro: {
          lista: 'movimentos',
          dados: {
            data, conta: conta.slice(0, 80), valor: Math.abs(v), entrada, pessoa: t('pessoa').slice(0, 120), documento_pessoa: lerDocumento(ler('documento_pessoa')),
            descricao: t('descricao').slice(0, 300), documento: t('documento').slice(0, 60), numero: t('numero').slice(0, 40), venda: t('venda').slice(0, 40),
            fatura: t('fatura').slice(0, 40), forma: t('forma').slice(0, 60), categoria: t('categoria').slice(0, 80), empresa: empresa.slice(0, 80),
          },
        },
      };
    }
    case 'vendas': {
      const venda = t('venda');
      if (!venda) return { ok: false, codigo: 'sem_nome', motivo: 'Linha sem o número da venda.' };
      const dataBruta = ler('data_venda');
      const data_venda = lerData(dataBruta);
      if (!data_venda) return { ok: false, codigo: 'data_invalida', motivo: vazio(dataBruta) ? 'Sem a data da venda.' : `A data da venda "${texto(dataBruta)}" não é uma data.` };
      const pagante = t('pagante');
      if (!pagante) return { ok: false, codigo: 'sem_nome', motivo: `A venda ${venda} não diz quem é o cliente.` };
      const empresa = t('empresa');
      const f = fora(empresa);
      if (f) return f;
      const moedaTxt = t('moeda');
      const moeda = !moedaTxt || ehReal(moedaTxt) ? 'BRL' : (moedaTxt.toUpperCase().match(/[A-Z]{3}/)?.[0] ?? '');
      if (!moeda) return { ok: false, codigo: 'moeda_estrangeira', motivo: `Moeda "${moedaTxt}" desconhecida.` };
      const cambioTxt = t('cambio');
      const cambio = moeda === 'BRL' ? 1 : (lerCentavos(cambioTxt) ?? 0) / 100;
      const avisos: string[] = [];
      if (moeda !== 'BRL' && !(cambio > 0)) avisos.push(`Venda em ${moeda} sem câmbio: os valores ficam na moeda, com câmbio 1. Confira na ficha da venda.`);
      const quantidade = Math.max(1, Math.floor(Number(t('quantidade').replace(',', '.')) || 1));
      const unit = abs(centavos('valor_unitario'));
      const tarifaCol = centavos('tarifa');
      const tarifa = tarifaCol !== null ? Math.abs(tarifaCol) : unit * quantidade;
      const sit = normalizar(ler('situacao'));
      const cancelado = lerSimNao(ler('cancelado')) === true;
      const dataCanc = lerData(ler('data_cancelamento'));
      const doc = lerDocumento(ler('documento_cliente')) || lerDocumento(ler('cnpj')) || lerDocumento(ler('cpf'));
      const total = centavos('valor_total');
      const receita = centavos('receita');
      return {
        ok: true, avisos,
        registro: {
          lista: 'vendas',
          dados: {
            venda: venda.slice(0, 40), data_venda, tipo: tipoDoProduto(ler('produto')), produto: t('produto').slice(0, 80), pagante: pagante.slice(0, 120),
            documento_cliente: doc, email: t('email').toLowerCase().slice(0, 160), venda_cancelada: /cancelad|exclu/.test(sit),
            cancelado_em: cancelado || dataCanc ? (dataCanc ?? data_venda) : null, empresa: empresa.slice(0, 80), vendedor: t('vendedor').slice(0, 80),
            intermediario: t('intermediario').slice(0, 120), fornecedor: t('fornecedor').slice(0, 120), representante: t('representante').slice(0, 120),
            passageiros: lerPassageiros(ler('passageiros')), localizador: t('localizador').slice(0, 80), descricao: t('descricao').slice(0, 300),
            data_inicio: lerData(ler('data_inicio')) ?? '', data_fim: lerData(ler('data_fim')) ?? '', quantidade, valor_unitario: unit, tarifa,
            taxas: abs(centavos('taxas')), outras_taxas: abs(centavos('outras_taxas')), taxa_du: abs(centavos('taxa_du')), rav: abs(centavos('rav')),
            fee: abs(centavos('fee')), markup: abs(centavos('markup')), comissao: abs(centavos('comissao')), over: abs(centavos('over')),
            taxa_cc: abs(centavos('taxa_cc')), desconto: abs(centavos('desconto')), valor_total: total === null ? null : Math.abs(total),
            receita, moeda, cambio: moeda === 'BRL' ? 1 : cambio > 0 ? cambio : 1,
          },
        },
      };
    }
    case 'faturas': {
      const numero = t('fatura');
      if (!numero) return { ok: false, codigo: 'sem_nome', motivo: 'Linha sem o número da fatura.' };
      const pessoa = t('pessoa');
      if (!pessoa) return { ok: false, codigo: 'sem_nome', motivo: `A fatura ${numero} não diz o cliente.` };
      const v = centavos('valor');
      if (v === null || v === 0) return { ok: false, codigo: 'sem_valor', motivo: `A fatura ${numero} está sem valor.` };
      if (situacaoExcluida(ler('situacao'))) return { ok: false, codigo: 'excluido', motivo: 'Fatura cancelada no sistema anterior.' };
      return {
        ok: true, avisos: [],
        registro: {
          lista: 'faturas',
          dados: {
            numero: numero.slice(0, 40), pessoa: pessoa.slice(0, 120), documento_pessoa: lerDocumento(ler('documento_pessoa')), emissao: lerData(ler('emissao')),
            vencimento: lerData(ler('vencimento')), liquidacao: lerData(ler('liquidacao')), valor: Math.abs(v), situacao: t('situacao').slice(0, 60),
            descricao: t('descricao').slice(0, 300),
          },
        },
      };
    }
    case 'notas': {
      const numero = t('numero');
      if (!numero) return { ok: false, codigo: 'sem_nome', motivo: 'Nota sem número.' };
      const emissao = lerData(ler('emissao'));
      if (!emissao) return { ok: false, codigo: 'data_invalida', motivo: `A nota ${numero} está sem data de emissão.` };
      const v = centavos('valor');
      if (v === null) return { ok: false, codigo: 'sem_valor', motivo: `A nota ${numero} está sem valor.` };
      const sit = normalizar(ler('situacao'));
      // Só o que foi emitido de verdade (ou emitido e cancelado depois) vira registro:
      // "Não emitida", "Gerada", "Aguardando emissão", "Em processamento" ficam fora.
      if (sit && !/^(emitida|autorizada|cancelada)$/.test(sit)) {
        return { ok: false, codigo: 'nao_emitida', motivo: `A nota ${numero} não foi emitida lá ("${t('situacao')}"): só o que já foi emitido vira registro.` };
      }
      return {
        ok: true, avisos: /cancelad/.test(sit) ? ['Nota cancelada no sistema anterior: fica no registro como cancelada.'] : [],
        registro: {
          lista: 'notas',
          dados: {
            numero: numero.slice(0, 40), serie: t('serie').slice(0, 10), emissao, tomador: t('tomador').slice(0, 160), documento: lerDocumento(ler('documento')),
            valor: Math.abs(v), iss: abs(centavos('iss')), situacao: t('situacao').slice(0, 60) || 'Emitida', codigo_verificacao: t('codigo_verificacao').slice(0, 60),
            venda: t('venda').slice(0, 40),
          },
        },
      };
    }
    case 'comissoes_pagas': {
      const pessoa = t('pessoa');
      if (!pessoa) return { ok: false, codigo: 'sem_nome', motivo: 'Comissão sem a pessoa.' };
      const data_venda = lerData(ler('data_venda'));
      if (!data_venda) return { ok: false, codigo: 'data_invalida', motivo: 'Comissão sem a data da venda.' };
      const v = centavos('valor');
      if (v === null || v === 0) return { ok: false, codigo: 'sem_valor', motivo: 'Comissão sem valor.' };
      return {
        ok: true, avisos: [],
        registro: {
          lista: 'comissoes_pagas',
          dados: {
            pessoa: pessoa.slice(0, 120), funcao: t('funcao').slice(0, 60), data_venda, valor: v, retido: abs(centavos('retido')), venda: t('venda').slice(0, 40),
            pagante: t('pagante').slice(0, 120), descricao: t('descricao').slice(0, 300), documento: t('documento').slice(0, 60), pago_em: lerData(ler('pago_em')),
          },
        },
      };
    }
    case 'metas': {
      const pessoa = t('pessoa');
      if (!pessoa) return { ok: false, codigo: 'sem_nome', motivo: 'Meta sem a pessoa.' };
      const anoTxt = t('ano').replace(/\D/g, '');
      const ano = anoTxt.length === 4 ? Number(anoTxt) : Number((opcoes.dataCorte ?? '').slice(0, 4)) || new Date().getFullYear();
      const meses = CAMPOS_DOS_MESES.map(c => { const x = centavos(c); return x === null ? null : Math.abs(x); });
      if (!meses.some(m => m !== null && m > 0)) return { ok: false, codigo: 'sem_valor', motivo: `${pessoa}: nenhum mês com meta.` };
      const avisos = anoTxt.length === 4 ? [] : [`Sem a coluna Ano: usei ${ano}, o ano da data de corte.`];
      return { ok: true, avisos, registro: { lista: 'metas', dados: { pessoa: pessoa.slice(0, 120), funcao: t('funcao').slice(0, 60), plano: t('plano').slice(0, 120), ano, meses } } };
    }
    case 'reembolsos': {
      const pessoa = t('pessoa');
      if (!pessoa) return { ok: false, codigo: 'sem_nome', motivo: 'Reembolso sem a pessoa.' };
      const v = centavos('valor');
      if (v === null || v === 0) return { ok: false, codigo: 'sem_valor', motivo: 'Reembolso sem valor.' };
      const sit = normalizar(ler('situacao'));
      if (/pago|paga|liquidad|recebid/.test(sit)) return { ok: false, codigo: 'liquidado', motivo: 'Reembolso já pago no sistema anterior: fica fora (o pagamento dele está nas contas liquidadas).' };
      if (situacaoExcluida(ler('situacao'))) return { ok: false, codigo: 'excluido', motivo: 'Reembolso cancelado no sistema anterior.' };
      const tipoTxt = normalizar(ler('tipo'));
      let tipo: 'CLIENTE' | 'FORNECEDOR' | null = /fornec|operador|do forn|receber/.test(tipoTxt) ? 'FORNECEDOR' : /client|ao cli|pagar/.test(tipoTxt) ? 'CLIENTE' : null;
      if (!tipo) tipo = v < 0 ? 'FORNECEDOR' : 'CLIENTE';
      return {
        ok: true, avisos: tipoTxt ? [] : ['Sem a coluna Tipo: entra como reembolso ao cliente.'],
        registro: {
          lista: 'reembolsos',
          dados: { tipo, pessoa: pessoa.slice(0, 120), documento_pessoa: lerDocumento(ler('documento_pessoa')), valor: Math.abs(v), prazo: lerData(ler('prazo')), venda: t('venda').slice(0, 40), descricao: t('descricao').slice(0, 300) },
        },
      };
    }
    case 'creditos': {
      const cliente = t('cliente');
      if (!cliente) return { ok: false, codigo: 'sem_nome', motivo: 'Crédito sem o cliente.' };
      const v = centavos('saldo');
      if (v === null || v <= 0) return { ok: false, codigo: 'sem_valor', motivo: 'Crédito sem saldo: nada a usar.' };
      const validade = lerData(ler('validade'));
      const hoje = opcoes.hoje ?? new Date().toISOString().slice(0, 10);
      if (validade && validade < hoje) return { ok: false, codigo: 'vencido', motivo: `Crédito vencido em ${dataBR(validade)}: não há o que usar.` };
      return {
        ok: true, avisos: [],
        registro: { lista: 'creditos', dados: { cliente: cliente.slice(0, 120), documento_pessoa: lerDocumento(ler('documento_pessoa')), saldo: v, validade, venda: t('venda').slice(0, 40), descricao: t('descricao').slice(0, 300) } },
      };
    }
  }
  return { ok: false, codigo: 'falta_coluna', motivo: 'Lista desconhecida.' };
}

/** Agrupa as linhas de vendas por número: a primeira linha leva a venda inteira. */
export function agruparVendas(linhas: Array<{ linha: number; dados: ProdutoVendidoLido }>): Map<string, VendaAgrupada> {
  const m = new Map<string, VendaAgrupada>();
  for (const { linha, dados: p } of linhas) {
    const chave = normalizar(p.venda);
    let v = m.get(chave);
    if (!v) {
      v = {
        numero: p.venda, data_venda: p.data_venda, cliente: { nome: p.pagante, documento: p.documento_cliente, email: p.email },
        vendedor: p.vendedor, intermediario: p.intermediario, empresa: p.empresa, produtos: [], linhas: [],
      };
      m.set(chave, v);
    }
    v.produtos.push(p);
    v.linhas.push(linha);
    if (!v.cliente.documento && p.documento_cliente) v.cliente.documento = p.documento_cliente;
    if (!v.vendedor && p.vendedor) v.vendedor = p.vendedor;
    if (!v.intermediario && p.intermediario) v.intermediario = p.intermediario;
    if (p.data_venda < v.data_venda) v.data_venda = p.data_venda;
  }
  return m;
}


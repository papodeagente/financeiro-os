/**
 * Documentos da fatura (E5, parte B, 05/11/2026). Puro: monta o que a tela
 * imprime e o que a exportação grava, sem banco.
 *
 *  - `linhasDaExportacao`: a fatura em linhas para o sistema do cliente
 *    (CSV com ponto e vírgula e vírgula decimal, ou XLSX).
 *  - `colunasDoModelo`: o que cada modelo (Padrão, Personalizada,
 *    Simplificada) mostra por item.
 *  - `notaDeDebitoDaVenda`: o documento por venda que o cliente confere
 *    ANTES do faturamento (produtos, passageiros, taxas, formas de pagamento
 *    com vencimento, retenções e o valor a faturar).
 */
import { calcularRetencoes, CAMPOS_DA_FATURA, type CampoDaFatura, type ConfigRetencoes, type LinhaDeRetencao, type ModeloDeFatura } from './fatura-regras';
import { COMPONENTES, FORMAS, ROTULO_TIPO_PRODUTO, totaisDoProduto, type Venda } from './venda-modelo';
import { formatarDocumento } from './cliente-documento';

export type Centavos = number;

const dataBR = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
export const reaisBR = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Abertura da fatura Padrão (texto nosso). */
export const TEXTO_DE_ABERTURA = 'Segue a relação dos serviços de viagem prestados no período, para conferência e pagamento até o vencimento.';
/** Aviso da nota de débito (texto nosso). */
export const AVISO_DA_NOTA_DE_DEBITO = 'Confira os itens antes do faturamento. Se algo não estiver certo, avise a agência para corrigir antes de a fatura ser emitida.';

// ============================================================
// Cabeçalho: quem emite e quem paga
// ============================================================

export interface Emitente { nome: string; documento: string; endereco: string; contato: string; logo: string }
export interface Sacado { id: string; nome: string; documento: string; endereco: string; email: string }

/** A agência no cabeçalho do documento (Configurações › Dados da agência). */
export function emitenteDaAgencia(a: Record<string, unknown> | null | undefined): Emitente {
  const ag = (a ?? {}) as Record<string, unknown>;
  const e = (ag.endereco ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
  const linha1 = [s(e.logradouro), s(e.numero)].filter(Boolean).join(', ');
  const linha2 = [s(e.bairro), [s(e.cidade), s(e.estado)].filter(Boolean).join('/')].filter(Boolean).join(' · ');
  return {
    nome: s(ag.razao_social) || s(ag.nome_fantasia) || s(ag.nome) || 'Agência',
    documento: s(ag.cnpj) ? `CNPJ ${formatarDocumento(s(ag.cnpj))}` : '',
    endereco: [linha1, linha2].filter(Boolean).join(' · '),
    contato: [s(ag.telefone), s(ag.email)].filter(Boolean).join(' · '),
    logo: s(ag.logo),
  };
}

/** O pagante no cabeçalho (cadastro do cliente). */
export function sacadoDoCliente(id: string, nome: string, cpfCnpj: string, d: Record<string, unknown> | null | undefined): Sacado {
  const c = (d ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
  const e = (c.endereco && typeof c.endereco === 'object' ? c.endereco : c) as Record<string, unknown>;
  const linha = [s(e.logradouro), s(e.numero), s(e.bairro), [s(e.cidade), s(e.estado) || s(e.uf)].filter(Boolean).join('/'), s(e.cep)].filter(Boolean).join(', ');
  const doc = s(cpfCnpj) || s(c.cnpj) || s(c.cpf);
  return { id, nome: nome || s(c.razao_social) || s(c.nome_completo) || s(c.nome), documento: doc ? formatarDocumento(doc) : '', endereco: linha, email: s(c.email) };
}

// ============================================================
// Itens e colunas
// ============================================================

export interface ItemParaDocumento {
  conta_id: string;
  venda_numero: string;
  data_venda: string | null;
  descricao: string;
  valor_centavos: number;
  detalhes: {
    produtos: Array<{ tipo: string; descricao: string; fornecedor_nome: string; localizador: string; data_inicio: string; data_fim: string; passageiros: string[] }>;
    centro_custo: string;
    solicitante: string;
    /** Viagem corporativa (E7): só nos itens de venda que têm. */
    corporativo?: CorporativoDoItem;
  };
}

/** Os dados da viagem corporativa que a fatura mostra por item (E7). */
export interface CorporativoDoItem {
  cc_cliente?: string;
  aprovador?: string;
  matricula?: string;
  projeto?: string;
  motivo?: string;
  requisicao?: string;
}

/** Colunas da viagem corporativa, na ordem da exportação. */
export const COLUNAS_CORPORATIVAS = ['cc_cliente', 'aprovador', 'matricula', 'projeto', 'motivo', 'requisicao'] as const;

export interface NotaParaDocumento { tipo: 'CREDITO' | 'DEBITO'; valor_centavos: number; motivo: string }

/** O texto de cada coluna para um item (o que a tela e a exportação usam). */
export function valorDaColuna(item: ItemParaDocumento, campo: CampoDaFatura): string {
  const p = item.detalhes.produtos;
  switch (campo) {
    case 'venda': return item.venda_numero;
    case 'data_venda': return dataBR(item.data_venda);
    case 'produto': return p.length ? p.map(x => x.descricao || ROTULO_TIPO_PRODUTO[x.tipo as keyof typeof ROTULO_TIPO_PRODUTO] || x.tipo).join(' + ') : item.descricao;
    case 'fornecedor': return [...new Set(p.map(x => x.fornecedor_nome).filter(Boolean))].join(', ');
    case 'passageiros': return [...new Set(p.flatMap(x => x.passageiros))].join(', ');
    case 'localizador': return [...new Set(p.map(x => x.localizador).filter(Boolean))].join(', ');
    case 'viagem': {
      const ini = p.map(x => x.data_inicio).filter(Boolean).sort()[0];
      const fim = p.map(x => x.data_fim).filter(Boolean).sort().reverse()[0];
      return ini ? (fim && fim !== ini ? `${dataBR(ini)} a ${dataBR(fim)}` : dataBR(ini)) : '';
    }
    case 'centro_custo': return item.detalhes.centro_custo;
    case 'solicitante': return item.detalhes.solicitante;
    case 'cc_cliente': case 'aprovador': case 'matricula': case 'projeto': case 'motivo': case 'requisicao':
      return item.detalhes.corporativo?.[campo] ?? '';
    case 'valor': return reaisBR(item.valor_centavos);
  }
}

/** As colunas de cada modelo. Personalizada: as que a pessoa marcou (valor sempre por último). */
export function colunasDoModelo(modelo: ModeloDeFatura, campos: readonly CampoDaFatura[] = []): CampoDaFatura[] {
  if (modelo === 'SIMPLIFICADA') return ['produto', 'passageiros', 'valor'];
  if (modelo === 'PADRAO') return ['venda', 'data_venda', 'produto', 'passageiros', 'localizador', 'viagem', 'centro_custo', 'valor'];
  const escolhidas = CAMPOS_DA_FATURA.map(c => c.id).filter(id => campos.includes(id) && id !== 'valor') as CampoDaFatura[];
  return [...escolhidas, 'valor'];
}

export const ROTULO_DA_COLUNA: Record<CampoDaFatura, string> = Object.fromEntries(CAMPOS_DA_FATURA.map(c => [c.id, c.rotulo])) as Record<CampoDaFatura, string>;

// ============================================================
// Exportação
// ============================================================

export interface FaturaParaExportar {
  numero: number;
  pessoa_nome: string;
  vencimento: string;
  emissao: string | null;
  itens: ItemParaDocumento[];
  notas: NotaParaDocumento[];
  totais: { itens: number; creditos: number; debitos: number; bruto: number; total_retencoes: number; liquido: number; retencoes: LinhaDeRetencao[] };
}

export const CABECALHO_DA_EXPORTACAO = [
  'Fatura', 'Vencimento', 'Cliente', 'Tipo', 'Venda', 'Data da venda', 'Produto', 'Fornecedor', 'Passageiros', 'Localizador',
  'Período da viagem', 'Centro de custo', 'Solicitante', 'Descrição', 'Valor',
] as const;

/**
 * A fatura em linhas: um item por linha, as notas, as retenções e o total.
 * Valor como número (reais). As colunas da viagem corporativa (E7) entram
 * depois de "Solicitante" só quando algum item tem esses dados: a fatura de
 * quem não usa sai exatamente como sempre saiu.
 */
export function linhasDaExportacao(f: FaturaParaExportar): Array<Array<string | number>> {
  const base = (tipo: string) => [f.numero, dataBR(f.vencimento), f.pessoa_nome, tipo];
  const corp = f.itens.some(i => COLUNAS_CORPORATIVAS.some(c => i.detalhes.corporativo?.[c]));
  const vazioCorp = corp ? COLUNAS_CORPORATIVAS.map(() => '') : [];
  const cab = [...CABECALHO_DA_EXPORTACAO] as string[];
  if (corp) cab.splice(cab.indexOf('Solicitante') + 1, 0, ...COLUNAS_CORPORATIVAS.map(c => ROTULO_DA_COLUNA[c]));
  const linhas: Array<Array<string | number>> = [cab];
  for (const i of f.itens) {
    linhas.push([
      ...base('Item'), i.venda_numero, dataBR(i.data_venda), valorDaColuna(i, 'produto'), valorDaColuna(i, 'fornecedor'),
      valorDaColuna(i, 'passageiros'), valorDaColuna(i, 'localizador'), valorDaColuna(i, 'viagem'), i.detalhes.centro_custo,
      i.detalhes.solicitante, ...(corp ? COLUNAS_CORPORATIVAS.map(c => valorDaColuna(i, c)) : []), i.descricao, i.valor_centavos / 100,
    ]);
  }
  for (const n of f.notas) {
    linhas.push([...base(n.tipo === 'CREDITO' ? 'Nota de crédito' : 'Nota de débito'), '', '', '', '', '', '', '', '', '', ...vazioCorp, n.motivo, (n.tipo === 'CREDITO' ? -1 : 1) * n.valor_centavos / 100]);
  }
  for (const r of f.totais.retencoes) {
    linhas.push([...base('Retenção'), '', '', '', '', '', '', '', '', '', ...vazioCorp, `${r.nome} ${String(r.percentual).replace('.', ',')}%`, -r.valor_centavos / 100]);
  }
  linhas.push([...base('Total a pagar'), '', '', '', '', '', '', '', '', '', ...vazioCorp, '', f.totais.liquido / 100]);
  return linhas;
}

function celulaCsv(v: string | number): string {
  const s = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : String(v ?? '');
  // Fórmula vinda de dado (=, +, -, @) não vira fórmula no Excel do cliente.
  const seguro = /^[=+\-@]/.test(s) && typeof v !== 'number' ? `'${s}` : s;
  return /[";\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** CSV para o Excel brasileiro: ponto e vírgula, vírgula decimal e BOM (acentos certos). */
export function csvDe(linhas: ReadonlyArray<ReadonlyArray<string | number>>): string {
  return '﻿' + linhas.map(l => l.map(celulaCsv).join(';')).join('\r\n') + '\r\n';
}

// ============================================================
// Nota de débito por venda
// ============================================================

export interface NotaDeDebito {
  venda: { id: string; numero: string; data_venda: string; centro_custo: string };
  pagante: { id: string; nome: string; documento: string };
  produtos: Array<{
    tipo: string; descricao: string; fornecedor: string; localizador: string; data_inicio: string; data_fim: string; moeda: string;
    passageiros: Array<{ nome: string; tarifa_centavos: number; taxas_centavos: number }>;
    tarifa_centavos: number; taxas_centavos: number; servicos: Array<{ nome: string; valor_centavos: number }>; descontos_centavos: number; total_centavos: number;
  }>;
  pagamentos: Array<{ forma: string; valor_centavos: number; parcelas: number; vencimentos: string[]; pagante: string }>;
  totais: { produtos_centavos: number; taxas_centavos: number; servicos_centavos: number; descontos_centavos: number; total_centavos: number; a_faturar_centavos: number };
  retencoes: LinhaDeRetencao[];
  total_retencoes_centavos: number;
  a_faturar_liquido_centavos: number;
  solicitante: string;
  aviso: string;
}

const SERVICOS = ['TAXA_DU', 'RAV', 'FEE', 'MARKUP'] as const;

/**
 * A nota de débito da venda. `vencimentos` vem das contas a receber da venda
 * (por pagamento); `retencoes`, da regra de faturamento do pagante.
 */
export function notaDeDebitoDaVenda(
  venda: Venda,
  o: { vencimentos?: Record<string, string[]>; retencoes?: ConfigRetencoes | null; solicitante?: string; pagante_documento?: string } = {},
): NotaDeDebito {
  const produtos = venda.produtos.filter(p => !p.cancelado_em).map(p => {
    const t = totaisDoProduto(p);
    const fx = (c: number) => Math.round(c * (p.cambio || 1));
    const servicos = SERVICOS.map(tipo => ({ nome: COMPONENTES[tipo].rotulo, valor_centavos: t.brl.componentes[tipo] ?? 0 })).filter(s => s.valor_centavos > 0);
    return {
      tipo: ROTULO_TIPO_PRODUTO[p.tipo] ?? p.tipo, descricao: p.descricao, fornecedor: p.fornecedor?.nome ?? '', localizador: p.localizador,
      data_inicio: p.data_inicio, data_fim: p.data_fim, moeda: p.moeda,
      passageiros: p.passageiros.filter(x => !x.cancelado_em).map(x => ({ nome: x.nome, tarifa_centavos: fx(x.tarifa_centavos), taxas_centavos: fx(x.taxas_centavos + x.outras_taxas_centavos) })),
      tarifa_centavos: t.brl.tarifa, taxas_centavos: t.brl.taxas, servicos, descontos_centavos: t.brl.componentes.DESCONTO ?? 0, total_centavos: t.brl.valor_cliente,
    };
  });
  const pagamentos = venda.pagamentos.map(pg => ({
    forma: FORMAS[pg.forma]?.rotulo ?? pg.forma, valor_centavos: pg.valor_centavos, parcelas: pg.parcelas,
    vencimentos: o.vencimentos?.[pg.id] ?? [], pagante: pg.pagante?.nome || venda.cliente.nome,
  }));
  const soma = (f: (p: (typeof produtos)[number]) => number) => produtos.reduce((a, p) => a + f(p), 0);
  const servicos_centavos = soma(p => p.servicos.reduce((a, s) => a + s.valor_centavos, 0));
  const a_faturar = venda.pagamentos.filter(p => p.forma === 'FATURAR').reduce((a, p) => a + p.valor_centavos, 0);
  const servicosDaParteFaturada = (() => {
    const total = soma(p => p.total_centavos);
    return total > 0 ? Math.round(servicos_centavos * Math.min(1, a_faturar / total)) : 0;
  })();
  const retencoes = o.retencoes && a_faturar > 0 ? calcularRetencoes(a_faturar, servicosDaParteFaturada, o.retencoes) : [];
  const total_retencoes = retencoes.reduce((a, r) => a + r.valor_centavos, 0);
  return {
    venda: { id: venda.id, numero: venda.numero, data_venda: venda.data_venda, centro_custo: venda.centro_custo },
    pagante: { id: venda.cliente.id, nome: venda.cliente.nome, documento: o.pagante_documento ?? venda.cliente.documento ?? '' },
    produtos, pagamentos,
    totais: {
      produtos_centavos: soma(p => p.tarifa_centavos), taxas_centavos: soma(p => p.taxas_centavos), servicos_centavos,
      descontos_centavos: soma(p => p.descontos_centavos), total_centavos: soma(p => p.total_centavos), a_faturar_centavos: a_faturar,
    },
    retencoes, total_retencoes_centavos: total_retencoes, a_faturar_liquido_centavos: a_faturar - total_retencoes,
    solicitante: o.solicitante ?? '', aviso: AVISO_DA_NOTA_DE_DEBITO,
  };
}

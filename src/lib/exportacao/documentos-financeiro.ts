/**
 * Os documentos de exportação do Resultado do mês (DRE), do Fluxo de caixa e
 * da Visão geral (E7, fechamento). Arquivo puro.
 *
 * As telas montam o Excel/PDF no navegador com estas funções e o envio
 * agendado (src/lib/relatorios-agendados/financeiro-servidor.ts) monta o MESMO
 * documento no servidor: um só desenho de arquivo para os dois caminhos.
 */
import type { DREMesAMes, LinhaDRE, LinhaMesAMes, RegimeDRE } from '../resultado-dre';
import type { FiltroDeRateio } from '../dre-recorte';
import { rotuloDoDia, type Agrupamento, type Caderno, type Periodo } from '../caderno-caixa';
import type { GradeContaDia } from '../fluxo-comparativo';
import type { Agenda, MesAteHoje, PosicaoDeHoje } from '../visao-geral';
import { round2 } from '../money';
import { dataParaBR, type DocumentoExportado, type FiltroAplicado } from './documento';

// ============================================================
// Resultado do mês (DRE)
// ============================================================

/** O rótulo que a tela e o arquivo mostram para cada linha do DRE (a chave segue o nome). */
export const ROTULO_LINHA_DRE: Record<string, string> = {
  'VOLUME INTERMEDIADO (informativo)': 'Volume vendido (não é sua receita)',
  'RECEITA BRUTA (comissão + serviços)': 'Receita bruta (comissão e serviços)',
  '(-) IMPOSTOS SOBRE A RECEITA': '(-) Impostos sobre a receita',
  'RECEITA LÍQUIDA': 'Receita líquida',
  '(-) DESPESAS OPERACIONAIS': '(-) Despesas operacionais',
  'RESULTADO OPERACIONAL': 'Resultado operacional',
  '(-) DESPESAS FINANCEIRAS': '(-) Despesas financeiras',
  '(-) OUTRAS DESPESAS': '(-) Outras despesas',
  'LUCRO LÍQUIDO': 'Lucro líquido',
};

/** O que o modo resumido mantém (o resto só no completo). */
export const LINHAS_DO_DRE_RESUMIDO = [
  'RECEITA BRUTA',
  '(-) IMPOSTOS SOBRE A RECEITA',
  'RECEITA LÍQUIDA',
  '(-) DESPESAS OPERACIONAIS',
  '(-) DESPESAS FINANCEIRAS',
  // Só aparece quando há juros, multa ou desconto obtido na liquidação.
  '(+) RECEITAS FINANCEIRAS',
  '(-) OUTRAS DESPESAS',
  'LUCRO LÍQUIDO',
];

export const ROTULO_REGIME_DRE: Record<RegimeDRE, string> = { competencia: 'Competência', caixa: 'Caixa' };
export const ROTULO_RATEIO_DRE: Record<FiltroDeRateio, string> = { todas: 'Todas as contas', rateadas: 'Só contas rateadas', sem_rateio: 'Só contas sem rateio' };

const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** '2026-10' → 'Outubro 2026'. */
export function rotuloDoMesDRE(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MESES_LONGOS[parseInt(m) - 1]} ${y}`;
}

/** '2026-10' → 'out/26' (a coluna do mês a mês). */
export function rotuloCurtoDoMesDRE(ym: string): string {
  const [a, m] = ym.split('-');
  return `${MESES_CURTOS[Number(m) - 1] ?? m}/${a.slice(2)}`;
}

/** Margem: o rótulo do rodapé. */
export function rotuloDaNotaDRE(nome: string): string {
  return nome.startsWith('Margem líquida') ? 'Margem sobre a receita' : 'Margem sobre o volume vendido';
}

const ehLinhaResumida = (nome: string) => LINHAS_DO_DRE_RESUMIDO.some(k => nome.startsWith(k));

/** As linhas de um mês no detalhe escolhido (resumido mantém as chaves e as margens). */
export function linhasDoDREnoModo(linhas: readonly LinhaDRE[], simplificado: boolean): LinhaDRE[] {
  return simplificado ? linhas.filter(l => ehLinhaResumida(l.nome) || l.nome.startsWith('Margem')) : [...linhas];
}

/** As linhas do mês a mês no detalhe escolhido. */
export function linhasDoMesAMesNoModo(linhas: readonly LinhaMesAMes[], simplificado: boolean): LinhaMesAMes[] {
  return simplificado ? linhas.filter(l => ehLinhaResumida(l.nome) || l.percentual) : [...linhas];
}

const pctBR = (v: number) => `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)}%`;
const recuo = (n: number) => '   '.repeat(Math.max(0, n));
const rotuloDaLinha = (l: { indent: number; codigo: string; nome: string }) => `${recuo(l.indent)}${l.codigo ? `${l.codigo} ` : ''}${ROTULO_LINHA_DRE[l.nome] ?? l.nome}`;

export interface FiltrosDoDRE {
  /** "Outubro 2026" ou "Janeiro 2026 a Outubro 2026". */
  periodo: string;
  regime: RegimeDRE;
  centro?: string | null;
  rateio?: FiltroDeRateio;
  /** Tag escolhida (E7): só as contas com ela. */
  tag?: string | null;
  /** Só na visão de um mês. */
  comparadoCom?: string | null;
}

function filtrosDoDRE(f: FiltrosDoDRE): FiltroAplicado[] {
  const filtros: FiltroAplicado[] = [
    { rotulo: 'Período', valor: f.periodo },
    { rotulo: 'Regime', valor: ROTULO_REGIME_DRE[f.regime] },
  ];
  if (f.centro) filtros.push({ rotulo: 'Centro de custo', valor: f.centro });
  if (f.rateio && f.rateio !== 'todas') filtros.push({ rotulo: 'Rateio', valor: ROTULO_RATEIO_DRE[f.rateio] });
  if (f.tag) filtros.push({ rotulo: 'Tag', valor: f.tag });
  if (f.comparadoCom) filtros.push({ rotulo: 'Comparado com', valor: f.comparadoCom });
  return filtros;
}

/**
 * Um mês: as linhas já no detalhe escolhido (com as margens, que vão para o
 * rodapé). Comparativo casado pelo NOME da linha; orçado por nome também.
 */
export function documentoDoDREdoMes(e: {
  filtros: FiltrosDoDRE;
  /** O rótulo da coluna do mês ("Outubro 2026"). */
  rotuloMes: string;
  linhas: readonly LinhaDRE[];
  comparativo?: readonly LinhaDRE[] | null;
  orcado?: ReadonlyMap<string, number> | null;
}): DocumentoExportado {
  const compareByNome = new Map<string, LinhaDRE>();
  for (const l of e.comparativo ?? []) if (!compareByNome.has(l.nome)) compareByNome.set(l.nome, l);
  const orcado = e.orcado ?? new Map<string, number>();
  const temOrcado = orcado.size > 0;
  const rotuloComparativo = e.comparativo && e.filtros.comparadoCom ? e.filtros.comparadoCom : null;
  const colunas = [
    { id: 'linha', rotulo: 'Conta', tipo: 'texto' as const },
    { id: 'valor', rotulo: e.rotuloMes, tipo: 'dinheiro' as const },
    ...(temOrcado ? [{ id: 'orcado', rotulo: 'Orçado', tipo: 'dinheiro' as const }, { id: 'desvio', rotulo: 'Desvio', tipo: 'dinheiro' as const }] : []),
    ...(rotuloComparativo ? [{ id: 'comparativo', rotulo: rotuloComparativo, tipo: 'dinheiro' as const }, { id: 'variacao', rotulo: 'Variação', tipo: 'dinheiro' as const }] : []),
  ];
  const linhas = e.linhas.filter(l => !l.nome.startsWith('Margem')).map(l => {
    const c = compareByNome.get(l.nome);
    const o = orcado.get(l.nome);
    return {
      linha: rotuloDaLinha(l),
      valor: l.valor,
      orcado: o ?? null, desvio: o === undefined ? null : round2(l.valor - o),
      comparativo: c ? c.valor : null, variacao: c ? round2(l.valor - c.valor) : null,
    };
  });
  const nota = e.linhas.filter(l => l.nome.startsWith('Margem')).map(l => `${rotuloDaNotaDRE(l.nome)}: ${pctBR(l.valor)}`).join(' · ');
  return { titulo: 'Resultado do mês (DRE)', filtros: filtrosDoDRE({ ...e.filtros, comparadoCom: rotuloComparativo }), colunas, linhas, ...(nota ? { nota } : {}) };
}

/** Mês a mês: um mês por coluna, total e média; as margens no rodapé. */
export function documentoDoDREMesAMes(e: {
  filtros: FiltrosDoDRE;
  mesAMes: DREMesAMes;
  /** As linhas já no detalhe escolhido (linhasDoMesAMesNoModo). */
  linhas: readonly LinhaMesAMes[];
}): DocumentoExportado {
  const { mesAMes } = e;
  const colunas = [
    { id: 'linha', rotulo: 'Conta', tipo: 'texto' as const },
    ...mesAMes.meses.map(m => ({ id: m, rotulo: rotuloCurtoDoMesDRE(m), tipo: 'dinheiro' as const })),
    { id: 'total', rotulo: 'Total', tipo: 'dinheiro' as const },
    { id: 'media', rotulo: 'Média', tipo: 'dinheiro' as const },
  ];
  const linhas = e.linhas.filter(l => !l.percentual).map(l => {
    const r: Record<string, string | number> = { linha: rotuloDaLinha(l), total: l.total, media: l.media };
    mesAMes.meses.forEach((m, i) => { r[m] = l.valores[i]; });
    return r;
  });
  const margens = e.linhas.filter(l => l.percentual)
    .map(l => `${rotuloDaNotaDRE(l.nome)}: ${l.total.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% no período`).join(' · ');
  return {
    titulo: 'Resultado mês a mês (DRE)', filtros: filtrosDoDRE({ ...e.filtros, comparadoCom: null }), colunas, linhas, orientacao: 'paisagem',
    ...(margens ? { nota: margens } : {}),
  };
}

// ============================================================
// Fluxo de caixa
// ============================================================

export const ROTULO_AGRUPAMENTO_FLUXO: Record<Agrupamento, string> = { dia: 'Dia a dia', semana: 'Por semana', mes: 'Por mês' };
export type MedidaDaGradeDoFluxo = 'saldo' | 'movimento';

/** "1 out", "31 dez": a ponta do período no rótulo do saldo. */
export function diaEMesDoFluxo(iso: string): string {
  return rotuloDoDia(iso).split(', ')[1] ?? iso;
}

/** O caderno: uma linha por dia, semana ou mês, com o saldo do começo. */
export function documentoDoCadernoDoFluxo(e: {
  caderno: Caderno;
  periodo: Pick<Periodo, 'inicio' | 'rotulo'>;
  agrupamento: Agrupamento;
  /** Nome da conta escolhida (vazio = todas). */
  conta?: string | null;
  /** Centro de custo e tag escolhidos (E7): o caderno começa em zero e acumula o resultado do recorte. */
  centro?: string | null;
  tag?: string | null;
}): DocumentoExportado {
  const { caderno, periodo, agrupamento } = e;
  const recorte = [e.centro, e.tag].filter(Boolean).join(' · ');
  return {
    titulo: recorte ? `Fluxo de caixa · ${recorte}` : 'Fluxo de caixa',
    subtitulo: `${ROTULO_AGRUPAMENTO_FLUXO[agrupamento]} · previsto pelo vencimento, realizado pela data da baixa${recorte ? ' · começa em zero e acumula o resultado do recorte' : ''}`,
    filtros: [
      { rotulo: 'Período', valor: periodo.rotulo },
      ...(e.conta !== undefined && e.conta !== null ? [{ rotulo: 'Conta', valor: e.conta || 'Conta sem nome' }] : []),
      ...(e.centro ? [{ rotulo: 'Centro de custo', valor: e.centro }] : []),
      ...(e.tag ? [{ rotulo: 'Tag', valor: e.tag }] : []),
    ],
    colunas: [
      { id: 'rotulo', rotulo: agrupamento === 'dia' ? 'Dia' : agrupamento === 'semana' ? 'Semana' : 'Mês', tipo: 'texto' },
      { id: 'entradas', rotulo: 'Entrou', tipo: 'dinheiro' },
      { id: 'saidas', rotulo: 'Saiu', tipo: 'dinheiro' },
      { id: 'saldo', rotulo: recorte ? 'Acumulado no fim' : 'Saldo no fim', tipo: 'dinheiro' },
      { id: 'situacao', rotulo: 'Situação', tipo: 'texto' },
    ],
    linhas: [
      { rotulo: recorte ? 'Início do período' : `Saldo em ${diaEMesDoFluxo(periodo.inicio)}`, saldo: caderno.saldoInicial },
      ...caderno.linhas.map(l => ({
        rotulo: l.rotulo, entradas: l.entradas, saidas: l.saidas, saldo: l.saldo,
        situacao: l.contemHoje ? 'Hoje' : l.futura ? 'Previsto' : 'Realizado',
      })),
    ],
    totais: { entradas: caderno.entradas, saidas: caderno.saidas, saldo: caderno.saldoFinal },
  };
}

/** A grade conta × dia, em pé: um dia por linha, uma conta por coluna (cabe no papel). */
export function documentoDaGradeDoFluxo(e: { grade: GradeContaDia; periodo: Pick<Periodo, 'rotulo'>; medida: MedidaDaGradeDoFluxo }): DocumentoExportado {
  const { grade, medida: m } = e;
  const medida = m === 'saldo' ? 'Saldo no fim do dia' : 'Movimento do dia';
  const valores = (l: { saldos: number[]; movimentos: number[] }, i: number) => (m === 'saldo' ? l.saldos[i] : l.movimentos[i]);
  return {
    titulo: 'Fluxo de caixa por conta e dia',
    subtitulo: `${medida} · dias depois de hoje são previsão`,
    filtros: [{ rotulo: 'Período', valor: e.periodo.rotulo }, { rotulo: 'Mostrar', valor: medida }],
    colunas: [
      { id: 'dia', rotulo: 'Dia', tipo: 'data' },
      ...grade.linhas.map(l => ({ id: `c_${l.id}`, rotulo: l.nome, tipo: 'dinheiro' as const })),
      { id: 'total', rotulo: 'Total', tipo: 'dinheiro' },
    ],
    linhas: [
      ...(m === 'saldo'
        ? [{ dia: 'Saldo anterior', total: grade.total.saldoInicial, ...Object.fromEntries(grade.linhas.map(l => [`c_${l.id}`, l.saldoInicial])) }]
        : []),
      ...grade.dias.map((d, i) => ({
        dia: d, total: valores(grade.total, i),
        ...Object.fromEntries(grade.linhas.map(l => [`c_${l.id}`, valores(l, i)])),
      })),
    ],
    ...(m === 'movimento'
      ? { totais: { total: grade.total.movimentos.reduce((a, b) => round2(a + b), 0), ...Object.fromEntries(grade.linhas.map(l => [`c_${l.id}`, l.movimentos.reduce((a, b) => round2(a + b), 0)])) } }
      : {}),
    orientacao: grade.linhas.length > 5 ? 'paisagem' : 'retrato',
  };
}

// ============================================================
// Visão geral
// ============================================================

/** Quantas linhas da agenda vão no arquivo (a tela mostra 12; o arquivo, a janela toda até este teto). */
export const LINHAS_DA_AGENDA_NO_ARQUIVO = 300;

const ddmm = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

/**
 * A foto do dia: a posição (caixa, a receber, a pagar, previsto em 30 dias),
 * o mês até hoje e a agenda dos próximos 30 dias, num documento só.
 */
export function documentoDaVisaoGeral(e: { hoje: string; posicao: PosicaoDeHoje; mes: MesAteHoje; agenda: Agenda }): DocumentoExportado {
  const { posicao: p, mes, agenda } = e;
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  const linhas: Array<Record<string, string | number | null>> = [
    { secao: 'Posição do dia', item: 'Em caixa', valor: p.emCaixa, detalhe: 'Soma das contas bancárias, pelas baixas lançadas' },
    { secao: 'Posição do dia', item: 'A receber', valor: p.aReceber.total, detalhe: plural(p.aReceber.parcelas, 'parcela em aberto', 'parcelas em aberto') },
    { secao: 'Posição do dia', item: 'A receber vencido', valor: p.aReceber.vencido, detalhe: p.aReceber.vencido > 0 ? 'Cobrar' : 'Nada vencido' },
    { secao: 'Posição do dia', item: 'A pagar', valor: p.aPagar.total, detalhe: p.aPagar.contas === 0 ? 'Nenhuma conta em aberto' : `${plural(p.aPagar.contas, 'conta em aberto', 'contas em aberto')}${p.aPagar.proximoVencimento ? `, a próxima vence em ${ddmm(p.aPagar.proximoVencimento)}` : ''}` },
    { secao: 'Posição do dia', item: 'A pagar vencido', valor: p.aPagar.vencido, detalhe: p.aPagar.vencido > 0 ? 'Pagar' : 'Nada vencido' },
    { secao: 'Posição do dia', item: `Caixa previsto em ${ddmm(p.previsto.data)}`, valor: p.previsto.valor, detalhe: `${p.previsto.variacao < 0 ? '−' : '+'}${Math.abs(p.previsto.variacao).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em 30 dias (soma do lançado, não previsão)` },
    { secao: `${mes.nomeDoMes.charAt(0).toUpperCase()}${mes.nomeDoMes.slice(1)} até o dia`, item: 'Entrou', valor: mes.entrou, detalhe: 'Pela data da baixa' },
    { secao: `${mes.nomeDoMes.charAt(0).toUpperCase()}${mes.nomeDoMes.slice(1)} até o dia`, item: 'Saiu', valor: mes.saiu, detalhe: 'Pela data da baixa' },
    { secao: `${mes.nomeDoMes.charAt(0).toUpperCase()}${mes.nomeDoMes.slice(1)} até o dia`, item: 'Resultado', valor: mes.resultado, detalhe: `Nos mesmos dias de ${mes.nomeDoMesAnterior}: ${mes.anterior.resultado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` },
  ];
  const agendaNoArquivo = agenda.linhas.slice(0, LINHAS_DA_AGENDA_NO_ARQUIVO);
  for (const l of agendaNoArquivo) {
    linhas.push({
      secao: l.grupo === 'vencido' ? 'Vencidos' : `Próximos 30 dias`,
      item: l.quem,
      valor: l.lado === 'receber' ? l.valor : -l.valor,
      detalhe: [`${l.lado === 'receber' ? 'Receber' : 'Pagar'} em ${ddmm(l.vencimento)}`, l.atraso, l.detalhe].filter(Boolean).join(' · '),
    });
  }
  const nota = agenda.linhas.length > agendaNoArquivo.length
    ? `A agenda tem ${agenda.linhas.length} contas; o arquivo mostra as ${agendaNoArquivo.length} primeiras.`
    : `Agenda até ${ddmm(agenda.ate)}: ${plural(agenda.quantidade.receber, 'conta a receber', 'contas a receber')} e ${plural(agenda.quantidade.pagar, 'conta a pagar', 'contas a pagar')}. Valor negativo é saída.`;
  return {
    titulo: 'Visão geral do financeiro',
    subtitulo: `Posição em ${dataParaBR(e.hoje)}`,
    filtros: [{ rotulo: 'Posição em', valor: dataParaBR(e.hoje) }],
    colunas: [
      { id: 'secao', rotulo: 'Parte', tipo: 'texto' },
      { id: 'item', rotulo: 'Item', tipo: 'texto' },
      { id: 'valor', rotulo: 'Valor', tipo: 'dinheiro' },
      { id: 'detalhe', rotulo: 'Detalhe', tipo: 'texto' },
    ],
    linhas,
    nota,
  };
}

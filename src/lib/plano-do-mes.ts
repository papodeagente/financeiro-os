/**
 * ACOMPANHAMENTO DO PLANO DO MÊS: o que foi planejado, o que já aconteceu, o
 * que falta e quanto do caminho já foi feito, área por área (Bruno,
 * 20/10/2026).
 *
 * Duas metades, de donos diferentes:
 *
 *   PLANEJADO  sai do plano que a pessoa preencheu (calcRelatorio): metas de
 *              vendas, faturamento, comissão, atendimentos e lucro, e o teto
 *              de cada custo.
 *   REALIZADO  sai do que o sistema registrou no mês (RealizadoDoMes, montado
 *              no servidor com a mesma régua do relatório Lucro real) e, onde
 *              o sistema não enxerga (atendimentos), do que a pessoa registrou.
 *
 * As metades nunca se misturam no banco: o plano mora em planejamento_custos,
 * os registros de progresso em planejamento_progresso. Editar o plano refaz
 * as contas daqui na hora e não toca em registro nenhum.
 *
 * AS REGRAS DE SITUAÇÃO (as que a tela mostra e o teste cobra):
 *  - O realizado conta desde o dia 1, tenha o plano sido feito no dia 1 ou no
 *    dia 20: o mês é o mesmo.
 *  - O ritmo esperado é a meta vezes a fração dos dias úteis já passados. Item
 *    abaixo do ritmo está ATRASADO; no ritmo, PENDENTE; meta batida,
 *    CONCLUÍDO. Mês encerrado sem bater a meta: atrasado.
 *  - Registro manual vale na DATA em que foi feito: 30 atendimentos anotados
 *    no dia 10 são comparados com o ritmo do dia 10, não com o de hoje.
 *  - Sem dado não é zero: atendimento sem registro, custo sem conta lançada e
 *    variável sem venda ficam SEM DADOS, nunca concluídos.
 *  - Custo é teto, não meta: conta vencida sem pagamento é ATRASADA, gasto
 *    acima do planejado é ACIMA DO PLANO, e só é concluído o que foi pago.
 *
 * Só cálculo: nada de banco, nada de rede, nada de relógio (hoje entra).
 */
import type { CustosData, Relatorio } from './planejamento-custos';
import { divSegura, round2, somaPor } from './money';
import { formatBRL } from './utils';

// ============================================================
// O que chega do servidor
// ============================================================

/** Uma conta a pagar do custo do mês, já com o que foi pago. */
export interface ContaDoMes {
  id: string;
  descricao: string;
  fornecedor: string;
  valor: number;
  pago: number;
  vencimento: string;
  /** fixo: estrutura; marketing: custo comercial (categoria ou conta marcada). */
  grupo: 'fixo' | 'marketing';
}

/** Algo que a pessoa anotou porque o sistema não mede sozinho. */
export interface RegistroDeProgresso {
  id: string;
  /** Hoje só 'atendimentos'; a tabela aceita outros sem migração. */
  chave: string;
  valor: number;
  /** O dia a que o número se refere (YYYY-MM-DD). */
  data: string;
  observacao: string;
  autor: string;
  criado_em: string;
}

export interface RealizadoDoMes {
  mes: string;
  hoje: string;
  vendas: number;
  faturamento: number;
  comissao: number;
  comissao_vendedor: number;
  taxa_plataforma: number;
  impostos: number;
  impostos_estimados: boolean;
  /** Comissão menos o que varia com a venda. */
  contribuicao: number;
  /** Custo fixo do mês (estrutura + marketing), régua do Lucro real. */
  custo_fixo: number;
  lucro: number;
  equilibrio: { atingido: boolean; na_venda: number | null; data: string | null; faltam: number };
  contas: ContaDoMes[];
  registros: RegistroDeProgresso[];
}

// ============================================================
// O que a tela recebe
// ============================================================

export type Situacao = 'concluido' | 'pendente' | 'atrasado' | 'acima' | 'sem_dados' | 'sem_meta';


export type Formato = 'contagem' | 'dinheiro';

export interface ItemDoPlano {
  chave: 'vendas' | 'atendimentos' | 'faturamento' | 'comissao' | 'custos_fixos' | 'marketing' | 'custos_variaveis' | 'equilibrio' | 'lucro';
  titulo: string;
  formato: Formato;
  /** atingir: meta a alcançar; limitar: teto de gasto. */
  sentido: 'atingir' | 'limitar';
  planejado: number | null;
  realizado: number | null;
  /** O que falta para a meta (ou para pagar o planejado). null sem dado. */
  falta: number | null;
  /** Realizado em % do planejado; null quando não dá para dizer. */
  progresso: number | null;
  /** Onde o ritmo diz que o realizado deveria estar, em % do planejado. */
  esperadoPct: number | null;
  situacao: Situacao;
  /** Uma frase: por que esta situação. */
  porque: string;
  /** De onde veio o realizado. */
  fonte: string;
  /** Aceita registro manual (o sistema não mede sozinho). */
  registravel?: boolean;
  /** Custos: as contas do mês, separadas. */
  contas?: { pagas: ContaDoMes[]; aVencer: ContaDoMes[]; vencidas: ContaDoMes[]; emAberto: number; vencido: number };
}

export interface AreaDoPlano {
  id: 'comercial' | 'receita' | 'custos' | 'resultado';
  titulo: string;
  itens: ItemDoPlano[];
}

export interface IndicadorDoPlano {
  titulo: string;
  formato: Formato | 'percentual';
  planejado: number | null;
  realizado: number | null;
  /** O realizado está pior que o plano a ponto de mudar a conta. */
  desvio: boolean;
  nota: string;
}

export interface PontoDeAtencao {
  tom: 'negativo' | 'aviso';
  chave: ItemDoPlano['chave'] | 'indicador';
  /** O que é, curto: "Vendas abaixo do ritmo". */
  titulo: string;
  /** Os números e o que fazer. */
  detalhe: string;
  /** Título e detalhe numa frase só (exportação, leitor de tela). */
  texto: string;
  /** Para onde a ação leva (contas a pagar filtradas) ou 'registrar'. */
  acao?: { rotulo: string; href?: string; registrar?: string };
}

export interface Calendario {
  diasUteis: number;
  diasUteisPassados: number;
  diasUteisRestantes: number;
  /** 0 a 1: quanto do mês útil já passou. */
  fracao: number;
  aberto: boolean;
  futuro: boolean;
}

export interface AcompanhamentoDoMes {
  mes: string;
  hoje: string;
  calendario: Calendario;
  temPlano: boolean;
  /** O plano não tem ticket, margem e conversão: metas de venda não existem. */
  semMetasDeVenda: boolean;
  areas: AreaDoPlano[];
  indicadores: IndicadorDoPlano[];
  atencao: PontoDeAtencao[];
  contagem: Record<Situacao, number>;
  /** A leitura do mês em uma frase. */
  frase: string;
}

// ============================================================
// Calendário: dias úteis (segunda a sexta)
// ============================================================

function diaDaSemana(ano: number, mes: number, dia: number): number {
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Dias úteis do mês até o dia `ate` (inclusive). Sem feriados: é ritmo, não folha. */
export function diasUteisAte(mes: string, ate: number): number {
  const [ano, m] = mes.split('-').map(Number);
  const fim = Math.min(ate, diasNoMes(ano, m));
  let n = 0;
  for (let d = 1; d <= fim; d++) {
    const s = diaDaSemana(ano, m, d);
    if (s !== 0 && s !== 6) n++;
  }
  return n;
}

/** Onde o mês está no dia `data` (YYYY-MM-DD), em dias úteis. */
export function calendarioDoMes(mes: string, data: string): Calendario {
  const [ano, m] = mes.split('-').map(Number);
  const total = diasUteisAte(mes, diasNoMes(ano, m));
  const mesDaData = data.slice(0, 7);
  const futuro = mesDaData < mes;
  const aberto = mesDaData === mes;
  const passados = futuro ? 0 : aberto ? diasUteisAte(mes, Number(data.slice(8, 10))) : total;
  return {
    diasUteis: total,
    diasUteisPassados: passados,
    diasUteisRestantes: Math.max(0, total - passados),
    fracao: total > 0 ? passados / total : 0,
    aberto,
    futuro,
  };
}

// ============================================================
// Situação de uma meta
// ============================================================

const fmt = (v: number, f: Formato) => (f === 'dinheiro' ? formatBRL(v) : String(Math.round(v)));

/** Onde o ritmo diz que o realizado deveria estar. Contagem arredonda para baixo: 4,5 vendas exige 4. */
function esperadoAte(planejado: number, fracao: number, formato: Formato): number {
  const bruto = planejado * fracao;
  return formato === 'contagem' ? Math.floor(bruto + 1e-9) : round2(bruto);
}

/**
 * Meta a atingir: concluída, no ritmo (pendente) ou atrasada. Dinheiro tem 10%
 * de folga sobre o ritmo (uma venda grande no dia seguinte muda tudo);
 * contagem não tem folga além do arredondamento.
 */
export function situacaoDaMeta(e: {
  planejado: number;
  realizado: number;
  formato: Formato;
  cal: Calendario;
}): { situacao: Situacao; esperado: number; porque: string } {
  const { planejado, realizado, formato, cal } = e;
  const esperado = esperadoAte(planejado, cal.fracao, formato);
  if (realizado >= planejado) return { situacao: 'concluido', esperado, porque: 'Meta do mês atingida.' };
  if (cal.futuro || cal.diasUteisPassados === 0) {
    return { situacao: 'pendente', esperado: 0, porque: 'O mês ainda não começou.' };
  }
  if (!cal.aberto) {
    return { situacao: 'atrasado', esperado: planejado, porque: `O mês fechou com ${fmt(realizado, formato)} de ${fmt(planejado, formato)}.` };
  }
  const limiar = formato === 'dinheiro' ? esperado * 0.9 : esperado;
  if (realizado >= limiar) {
    return { situacao: 'pendente', esperado, porque: `No ritmo: até hoje o plano pedia ${fmt(esperado, formato)}.` };
  }
  return { situacao: 'atrasado', esperado, porque: `Abaixo do ritmo: até hoje o plano pedia ${fmt(esperado, formato)}.` };
}

function pct(realizado: number | null, planejado: number | null): number | null {
  if (realizado === null || planejado === null || planejado <= 0) return null;
  return round2((realizado / planejado) * 100);
}

// ============================================================
// Os itens
// ============================================================

function itemDeMeta(base: {
  chave: ItemDoPlano['chave'];
  titulo: string;
  formato: Formato;
  planejado: number;
  realizado: number | null;
  fonte: string;
  cal: Calendario;
  semMeta: string;
  semDados?: string;
  registravel?: boolean;
}): ItemDoPlano {
  const { chave, titulo, formato, planejado, realizado, fonte, cal, registravel } = base;
  const comum = { chave, titulo, formato, sentido: 'atingir' as const, fonte, registravel };
  if (!(planejado > 0)) {
    return {
      ...comum, planejado: null, realizado, falta: null, progresso: null, esperadoPct: null,
      situacao: 'sem_meta', porque: base.semMeta,
    };
  }
  if (realizado === null) {
    return {
      ...comum, planejado, realizado: null, falta: null, progresso: null,
      esperadoPct: round2(cal.fracao * 100),
      situacao: 'sem_dados', porque: base.semDados ?? 'Sem dado para medir.',
    };
  }
  const s = situacaoDaMeta({ planejado, realizado, formato, cal });
  return {
    ...comum,
    planejado,
    realizado,
    falta: Math.max(0, round2(planejado - realizado)),
    progresso: pct(realizado, planejado),
    esperadoPct: pct(s.esperado, planejado),
    situacao: s.situacao,
    porque: s.porque,
  };
}

function itemDeCusto(base: {
  chave: 'custos_fixos' | 'marketing';
  titulo: string;
  planejado: number;
  contas: ContaDoMes[];
  hoje: string;
  cal: Calendario;
}): ItemDoPlano {
  const { chave, titulo, planejado, contas, hoje, cal } = base;
  const aberto = (c: ContaDoMes) => Math.max(0, round2(c.valor - c.pago));
  const pagas = contas.filter(c => aberto(c) <= 0.005);
  const vencidas = contas.filter(c => aberto(c) > 0.005 && c.vencimento < hoje);
  const aVencer = contas.filter(c => aberto(c) > 0.005 && c.vencimento >= hoje);
  const lancado = round2(somaPor(contas, c => c.valor));
  const pago = round2(somaPor(contas, c => c.pago));
  const emAberto = round2(somaPor(contas, aberto));
  const vencido = round2(somaPor(vencidas, aberto));
  const detalhe = { pagas, aVencer, vencidas, emAberto, vencido };
  const comum = {
    chave, titulo, formato: 'dinheiro' as const, sentido: 'limitar' as const,
    fonte: contas.length === 0
      ? 'Contas a pagar do mês'
      : `${contas.length} ${contas.length === 1 ? 'conta' : 'contas'} a pagar do mês, ${formatBRL(lancado)} lançados`,
    contas: detalhe,
  };

  if (!(planejado > 0) && contas.length === 0) {
    return { ...comum, planejado: null, realizado: null, falta: null, progresso: null, esperadoPct: null, situacao: 'sem_meta', porque: 'Nada planejado e nada lançado.' };
  }
  if (contas.length === 0) {
    return {
      ...comum, planejado, realizado: null, falta: null, progresso: null, esperadoPct: null,
      situacao: 'sem_dados',
      porque: 'Nenhuma conta deste custo lançada para o mês: não dá para dizer se foi paga.',
    };
  }

  const planejadoOuNulo = planejado > 0 ? planejado : null;
  const falta = planejadoOuNulo !== null ? Math.max(0, round2(planejado - pago)) : emAberto;
  const progresso = pct(pago, planejadoOuNulo);
  const acima = planejado > 0 && lancado > round2(planejado * 1.0) + 0.005;

  let situacao: Situacao;
  let porque: string;
  if (vencidas.length > 0) {
    situacao = 'atrasado';
    porque = `${vencidas.length} ${vencidas.length === 1 ? 'conta vencida' : 'contas vencidas'} sem pagamento: ${formatBRL(vencido)}.`;
  } else if (acima) {
    situacao = 'acima';
    porque = `${formatBRL(lancado)} lançados para ${formatBRL(planejado)} planejados.`;
  } else if (emAberto > 0.005) {
    situacao = 'pendente';
    porque = `${formatBRL(emAberto)} a pagar, nada vencido.`;
  } else if (planejado > 0 && lancado < planejado - 0.005 && cal.aberto) {
    situacao = 'pendente';
    porque = `Tudo o que foi lançado está pago; ainda faltam ${formatBRL(round2(planejado - lancado))} do planejado para lançar.`;
  } else {
    situacao = 'concluido';
    porque = 'Tudo o que foi lançado no mês está pago.';
  }
  return { ...comum, planejado: planejadoOuNulo, realizado: pago, falta, progresso, esperadoPct: null, situacao, porque };
}

// ============================================================
// Montagem
// ============================================================

/** O último registro de uma chave (pela data a que se refere, depois pela hora em que foi feito). */
export function ultimoRegistro(registros: readonly RegistroDeProgresso[], chave: string): RegistroDeProgresso | null {
  const daChave = registros.filter(r => r.chave === chave);
  if (daChave.length === 0) return null;
  return [...daChave].sort((a, b) => b.data.localeCompare(a.data) || b.criado_em.localeCompare(a.criado_em))[0];
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}` : iso;
}

export function montarAcompanhamento(e: {
  plano: CustosData | null;
  rel: Relatorio | null;
  realizado: RealizadoDoMes;
}): AcompanhamentoDoMes {
  const { plano, rel, realizado: r } = e;
  const hoje = r.hoje;
  const cal = calendarioDoMes(r.mes, hoje);
  const temPlano = !!plano && !!rel;
  const semMetasDeVenda = !temPlano || !!rel?.premissasIncompletas || !(rel!.vendasMeta > 0);
  const semMetaTexto = temPlano
    ? 'O plano ainda não tem ticket médio, margem e conversão: sem eles não há meta de vendas.'
    : 'Ainda não há plano para este mês.';
  const fonteVendas = `${r.vendas} ${r.vendas === 1 ? 'venda' : 'vendas'} com lançamento no mês`;

  // ── Comercial ───────────────────────────────────────────────────────────
  const vendas = itemDeMeta({
    chave: 'vendas', titulo: 'Vendas fechadas', formato: 'contagem',
    planejado: semMetasDeVenda ? 0 : rel!.vendasMeta, realizado: r.vendas,
    fonte: fonteVendas, cal, semMeta: semMetaTexto,
  });

  const registro = ultimoRegistro(r.registros, 'atendimentos');
  let atendimentos = itemDeMeta({
    chave: 'atendimentos', titulo: 'Leads atendidos', formato: 'contagem',
    planejado: semMetasDeVenda ? 0 : rel!.atendimentosMeta,
    realizado: registro ? registro.valor : null,
    fonte: registro
      ? `Registrado em ${dataBR(registro.data)}${registro.autor ? ` por ${registro.autor}` : ''}`
      : 'O financeiro não recebe os leads do CRM: registre quantos foram atendidos.',
    // O registro é comparado com o ritmo do DIA em que foi feito.
    cal: registro ? calendarioDoMes(r.mes, registro.data < hoje ? registro.data : hoje) : cal,
    semMeta: semMetaTexto,
    semDados: 'Nenhum registro de atendimentos neste mês.',
    registravel: true,
  });
  // O ritmo é o do dia do registro: a frase diz qual dia.
  if (registro && registro.data < hoje && cal.aberto) {
    atendimentos = { ...atendimentos, porque: atendimentos.porque.replace('até hoje', `até ${dataBR(registro.data)}`) };
  }

  // ── Receita ─────────────────────────────────────────────────────────────
  const faturamento = itemDeMeta({
    chave: 'faturamento', titulo: 'Faturamento (volume vendido)', formato: 'dinheiro',
    planejado: semMetasDeVenda ? 0 : rel!.faturamentoMeta, realizado: r.faturamento,
    fonte: fonteVendas, cal, semMeta: semMetaTexto,
  });
  const comissao = itemDeMeta({
    chave: 'comissao', titulo: 'Receita de comissões', formato: 'dinheiro',
    planejado: semMetasDeVenda ? 0 : rel!.receitaMeta, realizado: r.comissao,
    fonte: 'Venda menos o custo dos fornecedores, venda a venda', cal, semMeta: semMetaTexto,
  });

  // ── Custos ──────────────────────────────────────────────────────────────
  const fixos = itemDeCusto({
    chave: 'custos_fixos', titulo: 'Custos fixos', planejado: temPlano ? rel!.custoFixoTotal : 0,
    contas: r.contas.filter(c => c.grupo === 'fixo'), hoje, cal,
  });
  const marketing = itemDeCusto({
    chave: 'marketing', titulo: 'Marketing', planejado: temPlano ? rel!.marketingTotal : 0,
    contas: r.contas.filter(c => c.grupo === 'marketing'), hoje, cal,
  });

  const variavelReal = round2(r.comissao_vendedor + r.taxa_plataforma + r.impostos);
  const variavelPlanejadoPorVenda = temPlano ? rel!.custoVarPorVenda : 0;
  let variaveis: ItemDoPlano;
  if (!temPlano || !(variavelPlanejadoPorVenda > 0)) {
    variaveis = {
      chave: 'custos_variaveis', titulo: 'Custos variáveis por venda', formato: 'dinheiro', sentido: 'limitar',
      planejado: null, realizado: r.vendas > 0 ? round2(variavelReal / r.vendas) : null, falta: null, progresso: null, esperadoPct: null,
      situacao: 'sem_meta', porque: temPlano ? 'O plano não tem custos variáveis.' : semMetaTexto,
      fonte: 'Comissão do vendedor, taxa da plataforma e impostos',
    };
  } else if (r.vendas === 0) {
    variaveis = {
      chave: 'custos_variaveis', titulo: 'Custos variáveis por venda', formato: 'dinheiro', sentido: 'limitar',
      planejado: variavelPlanejadoPorVenda, realizado: null, falta: null, progresso: null, esperadoPct: null,
      situacao: 'sem_dados', porque: 'Sem venda no mês, não há custo por venda para comparar.',
      fonte: 'Comissão do vendedor, taxa da plataforma e impostos',
    };
  } else {
    const porVenda = round2(variavelReal / r.vendas);
    const acima = porVenda > round2(variavelPlanejadoPorVenda * 1.05);
    variaveis = {
      chave: 'custos_variaveis', titulo: 'Custos variáveis por venda', formato: 'dinheiro', sentido: 'limitar',
      planejado: variavelPlanejadoPorVenda, realizado: porVenda, falta: null,
      progresso: pct(porVenda, variavelPlanejadoPorVenda), esperadoPct: null,
      situacao: acima ? 'acima' : cal.aberto ? 'pendente' : 'concluido',
      porque: acima
        ? `Cada venda custou ${formatBRL(porVenda)} em comissão, plataforma e imposto; o plano previa ${formatBRL(variavelPlanejadoPorVenda)}.`
        : porVenda > variavelPlanejadoPorVenda
          ? `${formatBRL(porVenda)} por venda: um pouco acima dos ${formatBRL(variavelPlanejadoPorVenda)} previstos (até 5%).`
          : `Dentro do previsto: ${formatBRL(porVenda)} por venda.`,
      fonte: `Comissão do vendedor, taxa da plataforma e impostos${r.impostos_estimados ? ' (imposto estimado pela alíquota de ISS)' : ''}`,
    };
  }

  // ── Resultado ───────────────────────────────────────────────────────────
  let equilibrio: ItemDoPlano;
  const vendasParaCobrir = temPlano && !semMetasDeVenda ? rel!.vendasBreakEven : 0;
  const custoPlanejado = temPlano ? rel!.custoFixoMaisMarketing : 0;
  if (!(r.custo_fixo > 0)) {
    // Sem custo lançado não há o que cobrir: dizer "coberto" seria presumir.
    equilibrio = {
      chave: 'equilibrio', titulo: 'Cobrir os custos do mês', formato: 'contagem', sentido: 'atingir',
      planejado: vendasParaCobrir > 0 ? vendasParaCobrir : null, realizado: null, falta: null, progresso: null, esperadoPct: null,
      situacao: custoPlanejado > 0 || vendasParaCobrir > 0 ? 'sem_dados' : 'sem_meta',
      porque: custoPlanejado > 0
        ? 'Nenhum custo do mês lançado nas contas a pagar: não dá para dizer se as vendas já os cobriram.'
        : 'Nenhum custo planejado nem lançado para o mês.',
      fonte: 'Contribuição das vendas contra o custo fixo lançado',
    };
  } else if (r.equilibrio.atingido) {
    equilibrio = {
      chave: 'equilibrio', titulo: 'Cobrir os custos do mês', formato: 'contagem', sentido: 'atingir',
      planejado: vendasParaCobrir > 0 ? vendasParaCobrir : null, realizado: r.equilibrio.na_venda,
      falta: 0, progresso: 100, esperadoPct: null, situacao: 'concluido',
      porque: r.equilibrio.na_venda
        ? `Os custos do mês foram pagos pela ${r.equilibrio.na_venda}ª venda${r.equilibrio.data ? `, em ${dataBR(r.equilibrio.data)}` : ''}.`
        : 'As vendas do mês já cobriram os custos lançados.',
      fonte: 'Contribuição das vendas contra o custo fixo lançado',
    };
  } else if (!(vendasParaCobrir > 0)) {
    equilibrio = {
      chave: 'equilibrio', titulo: 'Cobrir os custos do mês', formato: 'contagem', sentido: 'atingir',
      planejado: null, realizado: r.vendas, falta: null, progresso: null, esperadoPct: null,
      situacao: 'sem_meta', porque: semMetaTexto, fonte: 'Contribuição das vendas contra o custo fixo lançado',
    };
  } else {
    const s = situacaoDaMeta({ planejado: vendasParaCobrir, realizado: Math.min(r.vendas, vendasParaCobrir - 1), formato: 'contagem', cal });
    equilibrio = {
      chave: 'equilibrio', titulo: 'Cobrir os custos do mês', formato: 'contagem', sentido: 'atingir',
      planejado: vendasParaCobrir, realizado: r.vendas,
      falta: Math.max(0, vendasParaCobrir - r.vendas),
      progresso: pct(r.vendas, vendasParaCobrir), esperadoPct: pct(s.esperado, vendasParaCobrir),
      situacao: s.situacao,
      porque: `Faltam ${formatBRL(r.equilibrio.faltam)} de contribuição para pagar os custos do mês.`,
      fonte: 'Contribuição das vendas contra o custo fixo lançado',
    };
  }

  const lucroPlanejado = temPlano ? plano!.lucro_desejado : 0;
  let lucro: ItemDoPlano;
  if (!(lucroPlanejado > 0)) {
    lucro = {
      chave: 'lucro', titulo: 'Lucro do mês', formato: 'dinheiro', sentido: 'atingir',
      planejado: null, realizado: r.lucro, falta: null, progresso: null, esperadoPct: null,
      situacao: 'sem_meta', porque: temPlano ? 'O plano não tem lucro desejado.' : semMetaTexto,
      fonte: 'Comissão menos vendedor, plataforma, impostos e custo fixo',
    };
  } else {
    // Sem custo lançado o lucro é a comissão inteira: bater a meta assim é
    // presumir que a estrutura não custou nada.
    // Vale também quando o plano não tem custo: agência sem estrutura nenhuma
    // não existe, e o mais provável é a conta ainda não ter sido lançada.
    const semEstrutura = !(r.custo_fixo > 0);
    const batido = r.lucro >= lucroPlanejado && !semEstrutura;
    lucro = {
      chave: 'lucro', titulo: 'Lucro do mês', formato: 'dinheiro', sentido: 'atingir',
      planejado: lucroPlanejado, realizado: r.lucro,
      falta: Math.max(0, round2(lucroPlanejado - r.lucro)),
      progresso: r.lucro > 0 ? pct(r.lucro, lucroPlanejado) : 0,
      esperadoPct: null,
      // O lucro só fecha no fim: o custo fixo é do mês inteiro e pesa desde o dia 1.
      situacao: batido ? 'concluido' : cal.aberto || cal.futuro ? 'pendente' : semEstrutura ? 'sem_dados' : 'atrasado',
      porque: batido
        ? 'Lucro desejado alcançado.'
        : semEstrutura
          ? 'Nenhum custo do mês lançado nas contas a pagar: o lucro está alto porque falta descontar a estrutura.'
          : cal.aberto || cal.futuro
            ? 'O lucro só fecha no último dia: o custo fixo é do mês inteiro e pesa desde o dia 1.'
            : `O mês fechou com ${formatBRL(r.lucro)} de lucro.`,
      fonte: 'Comissão menos vendedor, plataforma, impostos e custo fixo',
    };
  }

  const areas: AreaDoPlano[] = [
    { id: 'comercial', titulo: 'Comercial', itens: [vendas, atendimentos] },
    { id: 'receita', titulo: 'Receita', itens: [comissao, faturamento] },
    { id: 'custos', titulo: 'Custos', itens: [fixos, marketing, variaveis] },
    { id: 'resultado', titulo: 'Resultado', itens: [equilibrio, lucro] },
  ];

  // ── Indicadores: as premissas do plano contra o que está acontecendo ────
  const indicadores: IndicadorDoPlano[] = [];
  if (temPlano) {
    const ticketReal = r.vendas > 0 ? round2(r.faturamento / r.vendas) : null;
    const margemReal = r.faturamento > 0 ? round2(divSegura(r.comissao, r.faturamento) * 100) : null;
    const conversaoReal = registro && registro.valor > 0 ? round2((r.vendas / registro.valor) * 100) : null;
    const sobraReal = r.vendas > 0 ? round2(r.contribuicao / r.vendas) : null;
    const abaixo = (real: number | null, plan: number, folga: number) => real !== null && plan > 0 && real < plan * (1 - folga);
    indicadores.push(
      {
        titulo: 'Ticket médio', formato: 'dinheiro', planejado: plano!.ticket_medio || null, realizado: ticketReal,
        desvio: abaixo(ticketReal, plano!.ticket_medio, 0.15),
        nota: ticketReal === null ? 'Sem venda no mês.' : 'Faturamento dividido pelas vendas.',
      },
      {
        titulo: 'Margem de comissão', formato: 'percentual', planejado: plano!.margem_comissao || null, realizado: margemReal,
        desvio: margemReal !== null && plano!.margem_comissao > 0 && margemReal < plano!.margem_comissao - 3,
        nota: margemReal === null ? 'Sem venda no mês.' : 'Comissão sobre o faturamento.',
      },
      {
        titulo: 'Taxa de conversão', formato: 'percentual', planejado: plano!.taxa_conversao || null, realizado: conversaoReal,
        desvio: abaixo(conversaoReal, plano!.taxa_conversao, 0.2),
        nota: conversaoReal === null ? 'Precisa do registro de atendimentos.' : `Vendas sobre os ${registro!.valor} atendimentos registrados.`,
      },
      {
        titulo: 'Sobra por venda', formato: 'dinheiro', planejado: rel!.lucroPorVenda || null, realizado: sobraReal,
        desvio: abaixo(sobraReal, rel!.lucroPorVenda, 0.15),
        nota: sobraReal === null ? 'Sem venda no mês.' : 'Comissão menos vendedor, plataforma e impostos, por venda.',
      },
    );
  }

  // ── Pontos de atenção ───────────────────────────────────────────────────
  const atencao: PontoDeAtencao[] = [];
  const ponto = (p: Omit<PontoDeAtencao, 'texto'>) => atencao.push({ ...p, texto: `${p.titulo}: ${p.detalhe}` });
  const restantes = cal.diasUteisRestantes;
  for (const it of [vendas, comissao, faturamento, atendimentos, equilibrio]) {
    if (it.situacao !== 'atrasado' || it.planejado === null || it.realizado === null) continue;
    const ritmo = cal.aberto && restantes > 0 && it.falta
      ? ` Para fechar o mês: ${it.formato === 'dinheiro' ? formatBRL(round2(it.falta / restantes)) : (it.falta / restantes).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} por dia útil nos ${restantes} que restam.`
      : '';
    ponto({
      tom: 'negativo', chave: it.chave,
      titulo: cal.aberto ? `${it.titulo} abaixo do ritmo` : `${it.titulo} abaixo da meta`,
      detalhe: `${fmt(it.realizado, it.formato)} de ${fmt(it.planejado, it.formato)}. ${maiuscula(it.porque.replace(/^Abaixo do ritmo: /, ''))}${ritmo}`,
      ...(it.chave === 'atendimentos' ? { acao: { rotulo: 'Registrar', registrar: 'atendimentos' } } : {}),
    });
  }
  for (const it of [fixos, marketing]) {
    if (it.situacao === 'atrasado') {
      ponto({ tom: 'negativo', chave: it.chave, titulo: `${it.titulo}: conta vencida`, detalhe: it.porque, acao: { rotulo: 'Ver vencidas', href: '/financeiro-ag/pagar?status=VENCIDO' } });
    } else if (it.situacao === 'acima') {
      ponto({ tom: 'aviso', chave: it.chave, titulo: `${it.titulo} acima do plano`, detalhe: it.porque });
    }
  }
  if (variaveis.situacao === 'acima') ponto({ tom: 'aviso', chave: 'custos_variaveis', titulo: 'Custo por venda acima do plano', detalhe: variaveis.porque });
  if (atendimentos.situacao === 'sem_dados') {
    ponto({
      tom: 'aviso', chave: 'atendimentos',
      titulo: 'Atendimentos sem registro',
      detalhe: 'O financeiro não recebe os leads do CRM. Anote quantos foram atendidos para acompanhar a conversão.',
      acao: { rotulo: 'Registrar', registrar: 'atendimentos' },
    });
  } else if (registro && cal.aberto && diasEntre(registro.data, hoje) > 7) {
    ponto({
      tom: 'aviso', chave: 'atendimentos',
      titulo: 'Registro de atendimentos antigo',
      detalhe: `O último registro de atendimentos é de ${dataBR(registro.data)}. Atualize para o ritmo refletir hoje.`,
      acao: { rotulo: 'Atualizar', registrar: 'atendimentos' },
    });
  }
  for (const ind of indicadores) {
    if (ind.desvio) {
      const v = (x: number) => (ind.formato === 'percentual' ? `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : formatBRL(x));
      ponto({ tom: 'aviso', chave: 'indicador', titulo: `${ind.titulo} abaixo do plano`, detalhe: `${v(ind.realizado!)} contra ${v(ind.planejado!)}. As metas do plano partem desse número.` });
    }
  }
  atencao.sort((a, b) => (a.tom === b.tom ? 0 : a.tom === 'negativo' ? -1 : 1));

  // ── Contagem e frase ────────────────────────────────────────────────────
  const todos = areas.flatMap(a => a.itens);
  const contagem = { concluido: 0, pendente: 0, atrasado: 0, acima: 0, sem_dados: 0, sem_meta: 0 } as Record<Situacao, number>;
  for (const it of todos) contagem[it.situacao]++;

  let frase: string;
  if (!temPlano) {
    frase = `Ainda não há plano para este mês. O que já aconteceu está abaixo: ${r.vendas} ${r.vendas === 1 ? 'venda' : 'vendas'} e ${formatBRL(r.comissao)} em comissões.`;
  } else if (cal.futuro) {
    frase = 'O mês ainda não começou: o plano está pronto para ser acompanhado.';
  } else {
    const momento = cal.aberto
      ? `${cal.diasUteisPassados} de ${cal.diasUteis} dias úteis`
      : 'Mês encerrado';
    const atrasados = contagem.atrasado;
    const leitura = atrasados > 0
      ? `${atrasados} ${atrasados === 1 ? 'item precisa' : 'itens precisam'} de atenção`
      : contagem.acima > 0
        ? `${contagem.acima} ${contagem.acima === 1 ? 'custo está' : 'custos estão'} acima do plano`
        : cal.aberto ? 'tudo no ritmo do plano' : 'o plano foi cumprido';
    frase = `${momento}: ${leitura}.`;
  }

  return {
    mes: r.mes, hoje, calendario: cal, temPlano, semMetasDeVenda,
    areas, indicadores, atencao, contagem, frase,
  };
}

function maiuscula(t: string): string {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function diasEntre(de: string, ate: string): number {
  const a = Date.parse(`${de}T12:00:00Z`);
  const b = Date.parse(`${ate}T12:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : 0;
}

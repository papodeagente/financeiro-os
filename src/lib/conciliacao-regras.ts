/**
 * CONCILIAÇÃO COM REGRAS APRENDIDAS (E6, 05/11/2026): a regra, sem banco.
 *
 * Cada vez que alguém concilia uma linha do extrato com UMA conta, o sistema
 * guarda o que aprendeu: "nesta conta bancária, uma entrada com esta
 * descrição (ou este CNPJ) é da Maria, conta a receber, categoria X". Na
 * próxima linha parecida ele SUGERE. Conciliar sozinho só acontece quando:
 *
 *   1. a agência LIGOU a regra (nada é automático por padrão);
 *   2. a regra tem certeza alta (3 confirmações, nenhuma desfeita);
 *   3. existe UMA conta em aberto da MESMA pessoa com o MESMO valor, em
 *      centavos, perto da data do banco (ou, para a regra que cria a conta,
 *      o valor é o mesmo de sempre).
 *
 * Valor diferente ou pessoa diferente nunca conciliam sozinhos: viram
 * sugestão com o motivo escrito. Duas contas iguais (ambíguo) também.
 *
 * Tarifa de banco que se repete todo mês vira sugestão de conta a pagar.
 *
 * Sem imports de servidor: a tela usa as mesmas funções para explicar.
 */
import { addMeses, mesDe, paraCentavos } from './money';
import { diasEntre } from './resultado-financeiro';
import { normalizarNome } from './conciliacao-plano';

export type Sentido = 'ENTRADA' | 'SAIDA';
/** TITULO: casa com uma conta já lançada. CRIAR: lança a conta que faltava (tarifa, imposto). */
export type DestinoDaRegra = 'TITULO' | 'CRIAR';
export type TabelaDoTitulo = 'contas_receber' | 'contas_pagar';

export interface RegraDeConciliacao {
  id: string;
  /** Vazio vale para qualquer conta bancária. */
  conta_bancaria_id: string;
  sentido: Sentido;
  /** Descrição do banco sem números, datas e palavras de operação. */
  padrao: string;
  /** CNPJ ou CPF lido da descrição (só dígitos), quando o banco escreve. */
  documento: string;
  destino: DestinoDaRegra;
  titulo_tabela: TabelaDoTitulo;
  pessoa_id: string;
  pessoa_nome: string;
  categoria_id: string;
  /** Os últimos valores vistos, em centavos, do mais recente ao mais antigo. */
  valores_centavos: number[];
  confirmacoes: number;
  desfeitas: number;
  auto_ligada: boolean;
  /** Por que a regra parou de conciliar sozinha (vazio quando não parou). */
  auto_suspensa_motivo: string;
}

/** Uma linha do extrato, como a regra enxerga. */
export interface LinhaParaRegra {
  id: string;
  conta_bancaria_id: string;
  data: string;
  /** Com sinal: entrada +, saída −. */
  valor: number;
  descricao: string;
}

/** Uma conta (a pagar ou a receber) em aberto, candidata. */
export interface TituloCandidato {
  id: string;
  tabela: TabelaDoTitulo;
  pessoa_id: string;
  pessoa_nome: string;
  /** O que falta receber/pagar, em centavos. */
  aberto_centavos: number;
  data_vencimento: string;
  descricao: string;
}

/** Quantas vezes a regra precisa ter sido confirmada para conciliar sozinha. */
export const CONFIRMACOES_PARA_CERTEZA = 3;
/** Distância máxima entre a data do banco e o vencimento para conciliar sozinho. */
export const JANELA_AUTO_DIAS = 10;
/** Distância máxima para sugerir. */
export const JANELA_SUGESTAO_DIAS = 60;
/** Quantos valores a regra lembra. */
const VALORES_LEMBRADOS = 6;

// ── A descrição do banco, sem o que muda de uma linha para outra ──────────

/** Palavras de operação: dizem COMO o dinheiro andou, não DE QUEM. */
const PALAVRAS_DE_OPERACAO = new Set([
  'pix', 'ted', 'doc', 'tef', 'transf', 'transferencia', 'recebido', 'recebida', 'enviado', 'enviada',
  'pagamento', 'pgto', 'pag', 'deposito', 'credito', 'debito', 'cred', 'deb', 'de', 'da', 'do', 'das', 'dos',
  'para', 'a', 'o', 'e', 'em', 'cp', 'qr', 'code', 'qrcode', 'via', 'ref', 'referente', 'conta', 'ag', 'cc',
  'remetente', 'favorecido', 'origem', 'destino', 'mesma', 'titularidade', 'outra', 'instituicao', 'id', 'nsu', 'aut', 'autenticacao',
]);

/**
 * "PIX RECEBIDO - MARIA DA SILVA 12/10 ID E1234" → "maria silva".
 * Sem palavra com dígito (datas, códigos, contas) e sem as palavras da
 * operação. Se não sobrar nada (ex.: "TARIFA 123"), fica o que tinha letra.
 */
export function assinaturaDaDescricao(descricao: string): string {
  const palavras = normalizarNome(descricao).split(' ').filter(p => p && !/\d/.test(p));
  const nucleo = palavras.filter(p => !PALAVRAS_DE_OPERACAO.has(p) && p.length > 1);
  const escolhidas = (nucleo.length > 0 ? nucleo : palavras).slice(0, 6);
  return escolhidas.join(' ');
}

function digitos(s: string): string {
  return String(s ?? '').replace(/\D+/g, '');
}

/** Dígitos verificadores do CNPJ (14) ou CPF (11). */
export function documentoValido(d: string): boolean {
  if (d.length === 14) {
    if (/^(\d)\1+$/.test(d)) return false;
    const calc = (base: string, pesos: number[]) => {
      const s = base.split('').reduce((a, c, i) => a + Number(c) * pesos[i], 0);
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const p2 = [6, ...p1];
    return calc(d.slice(0, 12), p1) === Number(d[12]) && calc(d.slice(0, 13), p2) === Number(d[13]);
  }
  if (d.length === 11) {
    if (/^(\d)\1+$/.test(d)) return false;
    const calc = (n: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
  }
  return false;
}

/**
 * CNPJ ou CPF escrito na descrição do banco. CNPJ com ou sem pontuação;
 * CPF só pontuado (11 dígitos soltos costumam ser número de conta). Só vale
 * com os dígitos verificadores certos.
 */
export function documentoDaDescricao(descricao: string): string {
  const texto = String(descricao ?? '');
  for (const m of texto.matchAll(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g)) {
    const d = digitos(m[0]);
    if (documentoValido(d)) return d;
  }
  for (const m of texto.matchAll(/\d{3}\.\d{3}\.\d{3}-\d{2}/g)) {
    const d = digitos(m[0]);
    if (documentoValido(d)) return d;
  }
  return '';
}

export function sentidoDe(valor: number): Sentido {
  return valor >= 0 ? 'ENTRADA' : 'SAIDA';
}

/** Identidade da regra: a conta bancária, o sentido e o CNPJ (ou a descrição). */
export function chaveDaRegra(r: { conta_bancaria_id: string; sentido: Sentido; documento: string; padrao: string }): string {
  return `${r.conta_bancaria_id}|${r.sentido}|${r.documento ? `doc:${r.documento}` : `txt:${r.padrao}`}`;
}

// ── Aprender ──────────────────────────────────────────────────────────────

/** O que aconteceu numa conciliação feita por uma pessoa. */
export interface FatoDaConciliacao {
  linha: LinhaParaRegra;
  destino: DestinoDaRegra;
  titulo_tabela: TabelaDoTitulo;
  pessoa_id: string;
  pessoa_nome: string;
  categoria_id: string;
}

function mesmaPessoa(a: { pessoa_id: string; pessoa_nome: string }, b: { pessoa_id: string; pessoa_nome: string }): boolean {
  if (a.pessoa_id && b.pessoa_id) return a.pessoa_id === b.pessoa_id;
  const na = normalizarNome(a.pessoa_nome);
  const nb = normalizarNome(b.pessoa_nome);
  return !!na && na === nb;
}

/**
 * A regra depois de mais uma conciliação. Nova, se não havia. Se a pessoa
 * mudou (a mesma descrição foi conciliada com outra pessoa), a regra recomeça
 * do zero com a pessoa nova e deixa de conciliar sozinha: certeza alta não
 * sobrevive a uma contradição.
 */
export function aprender(existente: RegraDeConciliacao | null, fato: FatoDaConciliacao, novoId: string): RegraDeConciliacao {
  const centavos = Math.abs(paraCentavos(fato.linha.valor));
  const base = {
    conta_bancaria_id: fato.linha.conta_bancaria_id,
    sentido: sentidoDe(fato.linha.valor),
    padrao: assinaturaDaDescricao(fato.linha.descricao),
    documento: documentoDaDescricao(fato.linha.descricao),
  };
  if (!existente) {
    return {
      id: novoId, ...base,
      destino: fato.destino, titulo_tabela: fato.titulo_tabela,
      pessoa_id: fato.pessoa_id, pessoa_nome: fato.pessoa_nome, categoria_id: fato.categoria_id,
      valores_centavos: [centavos], confirmacoes: 1, desfeitas: 0, auto_ligada: false, auto_suspensa_motivo: '',
    };
  }
  const contradiz = !mesmaPessoa(existente, fato) || existente.titulo_tabela !== fato.titulo_tabela || existente.destino !== fato.destino;
  if (contradiz) {
    return {
      ...existente,
      destino: fato.destino, titulo_tabela: fato.titulo_tabela,
      pessoa_id: fato.pessoa_id, pessoa_nome: fato.pessoa_nome, categoria_id: fato.categoria_id,
      valores_centavos: [centavos], confirmacoes: 1, desfeitas: 0,
      auto_ligada: false,
      auto_suspensa_motivo: existente.auto_ligada
        ? `A última linha com esta descrição foi conciliada com ${fato.pessoa_nome || 'outra pessoa'}, não com ${existente.pessoa_nome || 'a pessoa da regra'}. A regra recomeçou e não concilia mais sozinha até ser ligada de novo.`
        : '',
    };
  }
  return {
    ...existente,
    // A categoria mais recente vale: a agência pode ter corrigido.
    categoria_id: fato.categoria_id || existente.categoria_id,
    pessoa_id: existente.pessoa_id || fato.pessoa_id,
    pessoa_nome: fato.pessoa_nome || existente.pessoa_nome,
    valores_centavos: [centavos, ...existente.valores_centavos].slice(0, VALORES_LEMBRADOS),
    confirmacoes: existente.confirmacoes + 1,
  };
}

/** Uma conciliação feita pela regra (ou ensinada por ela) foi desfeita. */
export function registrarDesfeita(r: RegraDeConciliacao, foiAutomatica: boolean): RegraDeConciliacao {
  return {
    ...r,
    desfeitas: r.desfeitas + 1,
    auto_ligada: false,
    auto_suspensa_motivo: r.auto_ligada || foiAutomatica
      ? 'Uma conciliação desta regra foi desfeita. Ela voltou a só sugerir; ligue de novo quando quiser.'
      : r.auto_suspensa_motivo,
  };
}

// ── Certeza ───────────────────────────────────────────────────────────────

export type NivelDeCerteza = 'alta' | 'media' | 'baixa';

/** Os valores são sempre o mesmo (regra que cria conta: tarifa fixa, mensalidade). */
export function valorFixo(r: Pick<RegraDeConciliacao, 'valores_centavos'>): number | null {
  const v = r.valores_centavos;
  if (v.length < 2) return null;
  return v.every(x => x === v[0]) ? v[0] : null;
}

export function certezaDaRegra(r: RegraDeConciliacao): { nivel: NivelDeCerteza; texto: string } {
  const vezes = r.confirmacoes === 1 ? '1 vez' : `${r.confirmacoes} vezes`;
  if (r.desfeitas > 0 && r.confirmacoes < CONFIRMACOES_PARA_CERTEZA + r.desfeitas * CONFIRMACOES_PARA_CERTEZA) {
    return { nivel: r.confirmacoes >= 2 ? 'media' : 'baixa', texto: `Conciliada ${vezes}, desfeita ${r.desfeitas === 1 ? '1 vez' : `${r.desfeitas} vezes`}. Só sugere até ganhar mais confirmações.` };
  }
  if (r.confirmacoes >= CONFIRMACOES_PARA_CERTEZA) {
    if (r.destino === 'CRIAR' && valorFixo(r) === null) {
      return { nivel: 'media', texto: `Conciliada ${vezes}, mas com valores diferentes. Só sugere: o valor muda de um mês para outro.` };
    }
    return { nivel: 'alta', texto: `Conciliada ${vezes} do mesmo jeito.` };
  }
  return {
    nivel: r.confirmacoes >= 2 ? 'media' : 'baixa',
    texto: `Conciliada ${vezes}. Com ${CONFIRMACOES_PARA_CERTEZA} confirmações ela pode passar a conciliar sozinha.`,
  };
}

/** A agência só liga a regra que já tem certeza alta. */
export function podeLigar(r: RegraDeConciliacao): { ok: boolean; motivo: string } {
  const c = certezaDaRegra(r);
  if (c.nivel !== 'alta') return { ok: false, motivo: c.texto };
  return { ok: true, motivo: '' };
}

// ── Achar a regra de uma linha ────────────────────────────────────────────

/**
 * A regra que vale para a linha. CNPJ igual vence descrição igual; regra da
 * própria conta bancária vence a de qualquer conta. Duas regras empatadas
 * com pessoas diferentes = ambíguo: nenhuma vale.
 */
export function regraDaLinha(linha: LinhaParaRegra, regras: readonly RegraDeConciliacao[]): RegraDeConciliacao | null {
  const sentido = sentidoDe(linha.valor);
  const doc = documentoDaDescricao(linha.descricao);
  const padrao = assinaturaDaDescricao(linha.descricao);
  const pontuadas: { r: RegraDeConciliacao; pts: number }[] = [];
  for (const r of regras) {
    if (r.sentido !== sentido) continue;
    if (r.conta_bancaria_id && r.conta_bancaria_id !== linha.conta_bancaria_id) continue;
    let pts = 0;
    if (r.documento && doc && r.documento === doc) pts = 20;
    else if (!r.documento && r.padrao && r.padrao === padrao) pts = 10;
    else continue;
    if (r.conta_bancaria_id) pts += 1;
    pontuadas.push({ r, pts });
  }
  if (pontuadas.length === 0) return null;
  pontuadas.sort((a, b) => b.pts - a.pts || b.r.confirmacoes - a.r.confirmacoes || a.r.id.localeCompare(b.r.id));
  const topo = pontuadas.filter(p => p.pts === pontuadas[0].pts);
  if (topo.some(p => !mesmaPessoa(p.r, topo[0].r))) return null;
  return topo[0].r;
}

// ── Decidir ───────────────────────────────────────────────────────────────

export type Decisao =
  | { tipo: 'sozinha'; regra: RegraDeConciliacao; titulo: TituloCandidato | null; explicacao: string }
  | { tipo: 'sugerir'; regra: RegraDeConciliacao; titulo: TituloCandidato | null; explicacao: string; por_que_nao_sozinha: string }
  | { tipo: 'nada'; regra: RegraDeConciliacao | null; motivo: string };

const fmt = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * O que fazer com a linha, dada a regra e as contas em aberto. Pura: a mesma
 * decisão aparece na tela (sugestão) e é refeita no servidor antes de gravar.
 */
export function decidir(linha: LinhaParaRegra, regra: RegraDeConciliacao | null, candidatas: readonly TituloCandidato[]): Decisao {
  if (!regra) return { tipo: 'nada', regra: null, motivo: 'Nenhuma regra aprendida para esta descrição.' };
  const centavos = Math.abs(paraCentavos(linha.valor));
  const certeza = certezaDaRegra(regra);
  const ligada = regra.auto_ligada;
  const naoSozinha = (motivo: string) => (ligada ? motivo : 'A regra não está ligada para conciliar sozinha.');

  if (regra.destino === 'CRIAR') {
    const fixo = valorFixo(regra);
    const igual = regra.valores_centavos.includes(centavos);
    const explicacao = `Lançar ${regra.titulo_tabela === 'contas_pagar' ? 'conta paga a' : 'recebimento de'} ${regra.pessoa_nome || 'quem a regra aprendeu'}, como nas outras ${regra.confirmacoes} vezes.`;
    if (ligada && certeza.nivel === 'alta' && fixo !== null && fixo === centavos) {
      return { tipo: 'sozinha', regra, titulo: null, explicacao };
    }
    const motivo = certeza.nivel !== 'alta'
      ? certeza.texto
      : !igual || (fixo !== null && fixo !== centavos)
        ? `O valor (${fmt(centavos)}) é diferente do que a regra conhece${fixo !== null ? ` (${fmt(fixo)})` : ''}.`
        : 'Os valores desta descrição variam: confira antes.';
    return { tipo: 'sugerir', regra, titulo: null, explicacao, por_que_nao_sozinha: naoSozinha(motivo) };
  }

  // TITULO: só contas da MESMA pessoa e do mesmo lado.
  const daPessoa = candidatas.filter(c => c.tabela === regra.titulo_tabela && mesmaPessoa(c, regra) && c.aberto_centavos > 0);
  if (daPessoa.length === 0) {
    return { tipo: 'nada', regra, motivo: `Nenhuma conta em aberto de ${regra.pessoa_nome || 'a pessoa da regra'}.` };
  }
  const perto = daPessoa
    .filter(c => !c.data_vencimento || Math.abs(diasEntre(c.data_vencimento, linha.data)) <= JANELA_SUGESTAO_DIAS)
    .sort((a, b) =>
      Number(b.aberto_centavos === centavos) - Number(a.aberto_centavos === centavos)
      || Math.abs(diasEntre(a.data_vencimento || linha.data, linha.data)) - Math.abs(diasEntre(b.data_vencimento || linha.data, linha.data))
      || a.id.localeCompare(b.id));
  if (perto.length === 0) {
    return { tipo: 'nada', regra, motivo: `As contas de ${regra.pessoa_nome} em aberto vencem longe desta data.` };
  }
  const exatas = perto.filter(c => c.aberto_centavos === centavos);
  const exatasNaJanela = exatas.filter(c => !c.data_vencimento || Math.abs(diasEntre(c.data_vencimento, linha.data)) <= JANELA_AUTO_DIAS);
  const melhor = exatas[0] ?? perto[0];
  const explicacao = `${regra.pessoa_nome || 'A pessoa da regra'}: ${melhor.descricao || 'conta em aberto'}, ${fmt(melhor.aberto_centavos)}${melhor.data_vencimento ? `, vence em ${melhor.data_vencimento.split('-').reverse().join('/')}` : ''}.`;

  if (exatas.length === 0) {
    return {
      tipo: 'sugerir', regra, titulo: melhor, explicacao,
      por_que_nao_sozinha: `O banco tem ${fmt(centavos)} e a conta em aberto tem ${fmt(melhor.aberto_centavos)}: valor diferente nunca concilia sozinho.`,
    };
  }
  if (exatasNaJanela.length > 1) {
    return {
      tipo: 'sugerir', regra, titulo: exatasNaJanela[0], explicacao,
      por_que_nao_sozinha: `${exatasNaJanela.length} contas de ${regra.pessoa_nome} têm o mesmo valor perto desta data. Escolha qual.`,
    };
  }
  if (exatasNaJanela.length === 0) {
    return {
      tipo: 'sugerir', regra, titulo: melhor, explicacao,
      por_que_nao_sozinha: naoSozinha(`O vencimento está a mais de ${JANELA_AUTO_DIAS} dias da data do banco.`),
    };
  }
  if (ligada && certeza.nivel === 'alta') {
    return { tipo: 'sozinha', regra, titulo: exatasNaJanela[0], explicacao };
  }
  return { tipo: 'sugerir', regra, titulo: exatasNaJanela[0], explicacao, por_que_nao_sozinha: naoSozinha(certeza.texto) };
}

// ── Tarifas que se repetem ────────────────────────────────────────────────

const TARIFA = /\b(tarifa|tarifas|tar|cesta|pacote de servicos|pacote servicos|manutencao de conta|manut conta|anuidade|taxa de manutencao|mensalidade pacote|tarifa bancaria|iof)\b/;

export function pareceTarifa(descricao: string): boolean {
  return TARIFA.test(normalizarNome(descricao));
}

export interface LinhaParaTarifa {
  id: string;
  conta_bancaria_id: string;
  data: string;
  valor: number;
  descricao: string;
}

export interface TarifaRecorrente {
  /** Estável: conta bancária + assinatura. Marca a conta a pagar criada. */
  chave: string;
  conta_bancaria_id: string;
  descricao: string;
  assinatura: string;
  meses: string[];
  valor_tipico_centavos: number;
  dia_tipico: number;
  ultima_data: string;
  proximo_vencimento: string;
  linhas: string[];
}

function mediana(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Saídas com cara de tarifa de banco que aparecem em pelo menos dois meses
 * diferentes, na mesma conta e com a mesma descrição. A sugestão é a conta a
 * pagar do próximo mês, no dia em que costuma cair, pelo valor típico.
 */
export function tarifasRecorrentes(linhas: readonly LinhaParaTarifa[]): TarifaRecorrente[] {
  const grupos = new Map<string, LinhaParaTarifa[]>();
  for (const l of linhas) {
    if (!(l.valor < 0) || !pareceTarifa(l.descricao)) continue;
    const assinatura = assinaturaDaDescricao(l.descricao) || normalizarNome(l.descricao);
    const chave = `${l.conta_bancaria_id}|${assinatura}`;
    const g = grupos.get(chave);
    if (g) g.push(l); else grupos.set(chave, [l]);
  }
  const saida: TarifaRecorrente[] = [];
  for (const [chave, g] of grupos) {
    const meses = [...new Set(g.map(l => mesDe(l.data)).filter(Boolean))].sort();
    if (meses.length < 2) continue;
    const ordenadas = [...g].sort((a, b) => b.data.localeCompare(a.data) || a.id.localeCompare(b.id));
    const ultima = ordenadas[0];
    const dia = mediana(g.map(l => Number(l.data.slice(8, 10)) || 1));
    const proximoMes = addMeses(`${ultima.data.slice(0, 8)}01`, 1);
    const ultimoDia = new Date(Number(proximoMes.slice(0, 4)), Number(proximoMes.slice(5, 7)), 0).getDate();
    saida.push({
      chave,
      conta_bancaria_id: ultima.conta_bancaria_id,
      descricao: ultima.descricao,
      assinatura: chave.slice(chave.indexOf('|') + 1),
      meses,
      valor_tipico_centavos: mediana(g.map(l => Math.abs(paraCentavos(l.valor)))),
      dia_tipico: dia,
      ultima_data: ultima.data,
      proximo_vencimento: `${proximoMes.slice(0, 8)}${String(Math.min(dia, ultimoDia)).padStart(2, '0')}`,
      linhas: ordenadas.map(l => l.id),
    });
  }
  return saida.sort((a, b) => b.valor_tipico_centavos - a.valor_tipico_centavos || a.chave.localeCompare(b.chave));
}

/**
 * E4 · Mudança — as regras puras do assistente "Mudar para o EnturOS"
 * (05/11/2026). Sem React e sem rede: a tela pergunta aqui em que passo
 * abrir, se dá para seguir (e, se não dá, por quê, numa frase), o que cada
 * aviso do leitor quer dizer, quais meses faltam e se cada prova bateu.
 *
 * Os 7 passos: exportar → arquivos → colunas → ensaio → aplicar → provas →
 * concluir (ou desfazer). Depois de aplicado, arquivos, colunas e ensaio
 * ficam só para consulta: para mudar alguma coisa, desfaz e começa de novo.
 */
import {
  ORDEM_DAS_LISTAS,
  type ArquivoDoLote, type AvisoDoArquivo, type ExplicacaoDaDiferenca, type Lote, type MapeamentoDoArquivo,
  type ResumoPorLista, type TipoDeLista,
} from '../contrato-telas';
import { GUIA_DE_EXPORTACAO, ROTULO_DA_LISTA } from './listas';

// ─── Passos ────────────────────────────────────────────────────────────────

export type IdDaEtapa = 'exportar' | 'arquivos' | 'colunas' | 'ensaio' | 'aplicar' | 'provas' | 'concluir' | 'recriar' | 'paralelo';

export const ETAPAS: ReadonlyArray<{ id: IdDaEtapa; rotulo: string; titulo: string }> = [
  { id: 'exportar', rotulo: 'Exportar', titulo: 'O que exportar do sistema anterior' },
  { id: 'arquivos', rotulo: 'Arquivos', titulo: 'Solte os arquivos' },
  { id: 'colunas', rotulo: 'Colunas', titulo: 'Confira as colunas' },
  { id: 'ensaio', rotulo: 'Ensaio', titulo: 'Ensaio: o que vai acontecer' },
  { id: 'aplicar', rotulo: 'Aplicar', titulo: 'Aplicar a mudança' },
  { id: 'provas', rotulo: 'Provas', titulo: 'Provas de que bateu' },
  { id: 'concluir', rotulo: 'Concluir', titulo: 'Concluir ou desfazer' },
  // E7: o que vem depois de aplicar.
  { id: 'recriar', rotulo: 'Regras e planos', titulo: 'Recriar regras de faturamento e planos de comissão' },
  { id: 'paralelo', rotulo: 'Mês em paralelo', titulo: 'Mês em paralelo: o sistema anterior e o EnturOS lado a lado' },
];

export function indiceDaEtapa(id: IdDaEtapa): number {
  return ETAPAS.findIndex(e => e.id === id);
}

const APLICADO: ReadonlySet<Lote['situacao']> = new Set(['aplicando', 'aplicado', 'desfazendo', 'desfeito', 'concluido']);

/** O lote já gravou alguma coisa (ou está gravando)? */
export function jaAplicou(lote: Lote | null): boolean {
  if (!lote) return false;
  return APLICADO.has(lote.situacao) || (lote.situacao === 'falhou' && lote.aplicado_em !== null);
}

/** O lote acabou (concluído ou desfeito): a próxima mudança começa do zero. */
export function loteEncerrado(lote: Lote | null): boolean {
  return lote?.situacao === 'concluido' || lote?.situacao === 'desfeito';
}

/** O ensaio está valendo para os arquivos e colunas de agora? */
export function ensaioEmDia(lote: Lote | null): boolean {
  return Boolean(lote && lote.versao_do_ensaio !== null && lote.versao_do_ensaio === lote.versao && lote.resumo_do_ensaio);
}

/** Em que passo abrir o assistente, pelo estado do lote. */
export function etapaInicial(lote: Lote | null): IdDaEtapa {
  if (!lote || lote.arquivos.length === 0) return lote ? 'arquivos' : 'exportar';
  switch (lote.situacao) {
    case 'rascunho':
      if (lote.arquivos.some(a => a.erro || !a.tipo_lista)) return 'arquivos';
      return ensaioEmDia(lote) ? 'ensaio' : 'colunas';
    case 'ensaiando':
    case 'ensaiado':
      return ensaioEmDia(lote) ? 'ensaio' : 'colunas';
    case 'aplicando':
      return 'aplicar';
    case 'aplicado':
      return 'provas';
    case 'falhou':
      return lote.aplicado_em ? 'aplicar' : 'ensaio';
    case 'desfazendo':
    case 'desfeito':
    case 'concluido':
      return 'concluir';
  }
}

/**
 * Por que este passo não pode ser aberto agora (null = pode).
 * Antes de aplicar, provas e concluir não existem; depois de aplicar,
 * arquivos e colunas ficam travados (o ensaio continua para consulta).
 */
export function travaDaEtapa(id: IdDaEtapa, lote: Lote | null): string | null {
  const aplicou = jaAplicou(lote);
  switch (id) {
    case 'exportar':
      return null;
    case 'arquivos':
    case 'colunas':
      if (aplicou) return 'A mudança já foi aplicada. Para trocar arquivos ou colunas, desfaça a mudança e comece de novo.';
      if (!lote) return 'Escolha a data de corte para começar.';
      if (id === 'colunas' && lote.arquivos.length === 0) return 'Solte os arquivos primeiro.';
      return null;
    case 'ensaio':
      if (!lote || lote.arquivos.length === 0) return 'Solte os arquivos primeiro.';
      return null;
    case 'aplicar':
      if (aplicou) return null;
      if (!ensaioEmDia(lote)) return 'Rode o ensaio antes de aplicar.';
      return null;
    case 'provas':
    case 'concluir':
      if (!aplicou) return 'As provas e a conclusão aparecem depois de aplicar.';
      return null;
    case 'recriar':
      // Recriar não depende dos arquivos: dá para fazer antes, durante ou depois.
      return null;
    case 'paralelo':
      if (!aplicou || lote?.situacao === 'desfeito' || lote?.situacao === 'desfazendo') return 'O mês em paralelo vem depois de aplicar a mudança: ele compara o que foi lançado aqui com o que foi lançado lá.';
      return null;
  }
}

// ─── Arquivos ──────────────────────────────────────────────────────────────

/** Arquivos na ordem de aplicação (contas → categorias → ... → saldos), depois pelo nome. */
export function ordenarArquivos(arquivos: readonly ArquivoDoLote[]): ArquivoDoLote[] {
  const pos = (t: TipoDeLista | null) => (t ? ORDEM_DAS_LISTAS.indexOf(t) : ORDEM_DAS_LISTAS.length);
  return [...arquivos].sort((a, b) => pos(a.tipo_lista) - pos(b.tipo_lista) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

const EXTENSOES = ['xlsx', 'xls', 'csv', 'txt'] as const;
/** 20 MB por arquivo: um mês de contas em aberto fica bem abaixo disso. */
export const TAMANHO_MAXIMO = 20 * 1024 * 1024;

/** Recusa na hora o que o leitor não abre, antes de enviar. */
export function problemaDoArquivoLocal(nome: string, tamanho: number): string | null {
  const ext = nome.toLowerCase().split('.').pop() ?? '';
  if (!(EXTENSOES as readonly string[]).includes(ext)) return 'Este tipo de arquivo não é lido. Exporte em Excel (.xlsx ou .xls), CSV ou texto (.txt).';
  if (tamanho === 0) return 'O arquivo está vazio.';
  if (tamanho > TAMANHO_MAXIMO) return 'O arquivo passa de 20 MB. Exporte um mês por arquivo.';
  return null;
}

/** O que cada aviso do leitor quer dizer, em palavras simples. */
export function textoDoAviso(a: AvisoDoArquivo): { tom: 'aviso' | 'info'; texto: string } {
  const d = a.detalhe ? ` (${a.detalhe})` : '';
  switch (a.codigo) {
    case 'lista_cortada':
      return { tom: 'aviso', texto: `Esta lista parece cortada${d}: o sistema anterior mostra só as primeiras linhas quando a lista é grande. Exporte um arquivo por mês.` };
    case 'linha_de_total':
      return { tom: 'info', texto: 'A linha de total do rodapé foi deixada de fora.' };
    case 'codificacao_latin1':
      return { tom: 'info', texto: 'Arquivo em codificação antiga; os acentos foram convertidos. Confira os nomes no ensaio.' };
    case 'colunas_desconhecidas':
      return { tom: 'info', texto: `Algumas colunas não foram reconhecidas${d}. Elas aparecem no passo Colunas para você escolher.` };
    case 'linhas_vazias':
      return { tom: 'info', texto: `Linhas em branco foram puladas${d}.` };
    case 'lista_nao_reconhecida':
      return { tom: 'aviso', texto: 'Não deu para saber de qual lista é este arquivo. Escolha ao lado.' };
  }
}

/** Por que não dá para seguir dos arquivos para as colunas (null = pode). */
export function bloqueioDosArquivos(arquivos: readonly ArquivoDoLote[]): string | null {
  if (arquivos.length === 0) return 'Solte pelo menos um arquivo.';
  const comErro = arquivos.find(a => a.erro);
  if (comErro) return `O arquivo "${comErro.nome}" não foi lido. Tire ou troque por outro.`;
  const semLista = arquivos.find(a => !a.tipo_lista);
  if (semLista) return `Diga de qual lista é o arquivo "${semLista.nome}".`;
  return null;
}

/** Listas obrigatórias que ainda não têm arquivo (aviso, não bloqueio: dá para trazer por partes). */
export function listasSemArquivo(arquivos: readonly ArquivoDoLote[]): TipoDeLista[] {
  const tem = new Set(arquivos.map(a => a.tipo_lista).filter(Boolean));
  return GUIA_DE_EXPORTACAO.filter(g => !g.opcional && !tem.has(g.tipo)).map(g => g.tipo);
}

function mesDe(data: string): string {
  return data.slice(0, 7);
}

function proximoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * Meses sem arquivo entre o primeiro e o último mês das contas a pagar e
 * a receber. Um buraco no meio quase sempre é um mês esquecido.
 */
export function mesesFaltando(arquivos: readonly ArquivoDoLote[]): string[] {
  const cobertos = new Set<string>();
  for (const a of arquivos) {
    if (a.tipo_lista !== 'titulos' || !a.periodo || a.erro) continue;
    let m = mesDe(a.periodo.de);
    const fim = mesDe(a.periodo.ate);
    for (let guarda = 0; m <= fim && guarda < 600; guarda++) { cobertos.add(m); m = proximoMes(m); }
  }
  if (cobertos.size < 2) return [];
  const ordenados = [...cobertos].sort();
  const faltam: string[] = [];
  let m = ordenados[0];
  const ultimo = ordenados[ordenados.length - 1];
  for (let guarda = 0; m <= ultimo && guarda < 600; guarda++) {
    if (!cobertos.has(m)) faltam.push(m);
    m = proximoMes(m);
  }
  return faltam;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** '2026-11' → 'nov/2026' */
export function nomeDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  if (!a || !m || m < 1 || m > 12) return mes;
  return `${MESES[m - 1]}/${a}`;
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA' */
export function dataBR(data: string | null | undefined): string {
  if (!data) return '';
  const [a, m, d] = data.slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : data;
}

/** A data de corte vale? Precisa ser um dia de verdade, até hoje. */
export function erroDaDataDeCorte(data: string, hoje: string): string | null {
  if (!data) return 'Escolha a data de corte.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return 'Use uma data no formato dia, mês e ano.';
  const d = new Date(`${data}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== data) return 'Esta data não existe.';
  if (data > hoje) return 'A data de corte não pode ser no futuro: os saldos precisam já existir no sistema anterior.';
  return null;
}

// ─── Colunas ───────────────────────────────────────────────────────────────

/** Rótulos dos campos obrigatórios que nenhuma coluna recebeu. */
export function camposFaltando(m: MapeamentoDoArquivo): string[] {
  const usados = new Set(m.colunas.map(c => c.campo).filter(Boolean));
  return m.campos.filter(c => c.obrigatorio && !usados.has(c.campo)).map(c => c.rotulo);
}

/** Campos escolhidos para mais de uma coluna do mesmo arquivo. */
export function camposRepetidos(m: MapeamentoDoArquivo): string[] {
  const vistos = new Map<string, number>();
  for (const c of m.colunas) if (c.campo) vistos.set(c.campo, (vistos.get(c.campo) ?? 0) + 1);
  return m.campos.filter(c => (vistos.get(c.campo) ?? 0) > 1).map(c => c.rotulo);
}

/** Colunas que o dicionário não reconheceu e que continuam sem destino. */
export function colunasIgnoradas(m: MapeamentoDoArquivo): string[] {
  return m.colunas.filter(c => !c.campo).map(c => c.cabecalho || `Coluna ${c.indice + 1}`);
}

/** Por que não dá para seguir das colunas para o ensaio (null = pode). */
export function bloqueioDasColunas(mapas: readonly MapeamentoDoArquivo[]): string | null {
  for (const m of mapas) {
    const falta = camposFaltando(m);
    if (falta.length) return `No arquivo "${m.arquivo_nome}", falta dizer qual coluna é ${listaEmFrase(falta)}.`;
    const rep = camposRepetidos(m);
    if (rep.length) return `No arquivo "${m.arquivo_nome}", mais de uma coluna foi para ${listaEmFrase(rep)}. Escolha uma só.`;
  }
  return null;
}

/** ['A','B','C'] → 'A, B e C' */
export function listaEmFrase(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

// ─── Ensaio ────────────────────────────────────────────────────────────────

export interface TotaisDoEnsaio { criar: number; vincular: number; recusar: number; total: number }

export function totaisDoEnsaio(resumo: readonly ResumoPorLista[] | null | undefined): TotaisDoEnsaio {
  const t = { criar: 0, vincular: 0, recusar: 0, total: 0 };
  for (const r of resumo ?? []) { t.criar += r.criar; t.vincular += r.vincular; t.recusar += r.recusar; }
  t.total = t.criar + t.vincular + t.recusar;
  return t;
}

/** Por que não dá para aplicar o ensaio (null = pode). */
export function bloqueioDoEnsaio(lote: Lote | null): string | null {
  if (!lote) return 'Comece pela data de corte.';
  if (lote.situacao === 'ensaiando') return 'O ensaio ainda está rodando.';
  if (!ensaioEmDia(lote)) return 'Um arquivo ou uma coluna mudou depois do último ensaio. Rode o ensaio de novo.';
  const t = totaisDoEnsaio(lote.resumo_do_ensaio);
  if (t.criar + t.vincular === 0) return 'O ensaio não achou nada para trazer. Confira os arquivos e as colunas.';
  return null;
}

/** Resumo por lista na ordem de aplicação, só as listas que vieram. */
export function resumoNaOrdem(resumo: readonly ResumoPorLista[] | null | undefined): ResumoPorLista[] {
  return ORDEM_DAS_LISTAS.map(t => (resumo ?? []).find(r => r.tipo_lista === t)).filter((r): r is ResumoPorLista => Boolean(r));
}

// ─── Aplicar ───────────────────────────────────────────────────────────────

/** 0 a 100, arredondado para baixo (100 só quando terminou de verdade). */
export function percentual(feitos: number, total: number): number {
  if (!(total > 0)) return 0;
  const p = Math.floor((Math.max(0, Math.min(feitos, total)) / total) * 100);
  return feitos >= total ? 100 : Math.min(p, 99);
}

/** De quanto em quanto tempo perguntar o progresso: rápido no começo, mais espaçado depois. */
export function intervaloDoProgresso(tentativa: number): number {
  return tentativa < 10 ? 1500 : tentativa < 40 ? 3000 : 6000;
}

// ─── Provas ────────────────────────────────────────────────────────────────

export type SituacaoDaProva = 'bate' | 'explicada' | 'sem_explicacao';

const CENTAVO = 0.005;

/** Bateu, a diferença está toda explicada pelas linhas, ou sobra diferença sem explicação. */
export function situacaoDaProva(diferenca: number, explicacoes: readonly ExplicacaoDaDiferenca[]): SituacaoDaProva {
  if (Math.abs(diferenca) < CENTAVO) return 'bate';
  const explicado = explicacoes.reduce((s, e) => s + e.valor, 0);
  return Math.abs(diferenca - explicado) < CENTAVO ? 'explicada' : 'sem_explicacao';
}

export function contarProvas(linhas: ReadonlyArray<{ diferenca: number; explicacoes: readonly ExplicacaoDaDiferenca[] }>): Record<SituacaoDaProva, number> {
  const c: Record<SituacaoDaProva, number> = { bate: 0, explicada: 0, sem_explicacao: 0 };
  for (const l of linhas) c[situacaoDaProva(l.diferenca, l.explicacoes)]++;
  return c;
}

// ─── Erros ─────────────────────────────────────────────────────────────────

/** Mensagem do servidor por código conhecido, senão a do próprio servidor. */
export function mensagemDeErro(codigo: string | null, mensagem: string, status = 0): string {
  switch (codigo) {
    case 'LOTE_ABERTO': return 'Já existe uma mudança em andamento nesta agência. Ela foi aberta para você continuar.';
    case 'ASSINATURA_VENCIDA': return 'Algo mudou depois do ensaio. Rode o ensaio de novo e confira antes de aplicar.';
    case 'JA_APLICADO': return 'Esta mudança já foi aplicada. Veja as provas ou desfaça.';
    case 'PERIODO_FECHADO': return 'A data de corte cai num período com o caixa fechado. Reabra o período em Fechar Caixa ou escolha outra data.';
  }
  if (status === 403) return 'Só o administrador da agência pode fazer a mudança.';
  if (status === 413) return 'O arquivo é grande demais. Exporte um mês por arquivo.';
  return mensagem || 'Algo deu errado. Nada foi gravado; tente de novo.';
}

/** Nome da lista para mostrar (com o "não reconhecida" quando falta). */
export function rotuloDaLista(t: TipoDeLista | null): string {
  return t ? ROTULO_DA_LISTA[t] : 'Lista não reconhecida';
}

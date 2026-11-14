/**
 * Mudança de sistema (E4, 05/11/2026): o formato que as telas do assistente
 * esperam (contrato da parte B, `contrato-telas.ts` no ramo das telas).
 * Converte o que o servidor sabe (centavos, códigos internos) no que a tela
 * mostra (reais, situações e avisos do contrato). Só formato: nenhuma regra.
 *
 * Os objetos levam também alguns campos a mais (nome, progresso, resumo
 * completo do ensaio): a tela ignora o que não conhece.
 */
import { createHash } from 'node:crypto';
import type { ExecutorSQL } from '../caixa-atomico';
import { deCentavos } from '../money';
import { camposDoCabecalho, definicaoDaLista, ORDEM_DAS_LISTAS, sugerirMapeamento, type ListaId } from './dicionario';
import type { ResultadoDoDesfazer } from './desfazer';
import type { RegistroLido } from './interpretar';
import type { LinhaDaProva, ProvaDaMudanca } from './provas';
import {
  listarArquivos, rotuloDoCodigo, type ArquivoDoLote, type Lote, type LinhaDoLote, type ResumoDoEnsaio,
} from './servidor';
import { dataBR, reais } from './valores';

export type SituacaoParaTela = 'rascunho' | 'ensaiando' | 'ensaiado' | 'aplicando' | 'aplicado' | 'desfazendo' | 'desfeito' | 'concluido' | 'falhou';

export interface AvisoParaTela { codigo: string; detalhe?: string }

export interface ArquivoParaTela {
  id: string;
  nome: string;
  tamanho: number;
  formato: 'xlsx' | 'xls' | 'csv' | 'txt';
  tipo_lista: ListaId | null;
  linhas: number;
  periodo: { de: string; ate: string } | null;
  avisos: AvisoParaTela[];
  erro: string | null;
  aba: string;
  mapeamento_confirmado: boolean;
}

export interface RegistroQueFica { tipo_lista: ListaId; descricao: string; motivo: string }

export interface ResumoPorLista { tipo_lista: ListaId; criar: number; vincular: number; recusar: number }

export interface LoteParaTela {
  id: string;
  nome: string;
  situacao: SituacaoParaTela;
  data_corte: string;
  arquivos: ArquivoParaTela[];
  versao: number;
  versao_do_ensaio: number | null;
  resumo_do_ensaio: ResumoPorLista[] | null;
  criado_em: string;
  criado_por_nome: string;
  aplicado_em: string | null;
  concluido_em: string | null;
  desfeito_em: string | null;
  nao_desfeitos: RegistroQueFica[] | null;
  erro: string | null;
  progresso: Lote['progresso'];
  /** Resumo completo do ensaio (motivos, totais em reais, problemas, avisos). */
  ensaio: ReturnType<typeof resumoParaTela> | null;
}

const LISTA_DA_TABELA: Record<string, ListaId> = {
  contas_bancarias: 'contas', plano_contas: 'categorias', centros_custo: 'centros_custo', clientes: 'pessoas',
  fornecedores_crm: 'pessoas', contas_pagar: 'titulos', contas_receber: 'titulos',
  baixas: 'liquidados', vendas_crm: 'vendas', migracao_historico: 'faturas', comissao_metas: 'metas', reembolsos: 'reembolsos', creditos_cliente: 'creditos',
};

export function situacaoParaTela(status: string): SituacaoParaTela {
  if (status === 'desfeito_em_parte') return 'desfeito';
  return status as SituacaoParaTela;
}

export function arquivoParaTela(a: ArquivoDoLote): ArquivoParaTela {
  const avisos: AvisoParaTela[] = [];
  for (const av of a.avisos) {
    if (av.codigo === 'lista_cortada' || av.codigo === 'lista_pode_estar_cortada') avisos.push({ codigo: 'lista_cortada', detalhe: av.mensagem });
    else if (av.codigo === 'total_do_rodape') avisos.push({ codigo: 'linha_de_total', detalhe: av.mensagem });
  }
  if (a.codificacao === 'latin-1') avisos.push({ codigo: 'codificacao_latin1', detalhe: 'Lido como Latin-1 (acentos do Windows).' });
  if (a.ignoradas.length) avisos.push({ codigo: 'colunas_desconhecidas', detalhe: a.ignoradas.map(c => c.cabecalho).join(', ') });
  if (!a.lista_reconhecida) avisos.push({ codigo: 'lista_nao_reconhecida', detalhe: `Parece ser "${a.lista_rotulo}", mas confirme.` });
  const formato = a.formato === 'html' ? 'xls' : a.formato === 'ods' ? 'xlsx' : (a.formato as ArquivoParaTela['formato']);
  return {
    id: a.id, nome: a.aba && a.aba !== a.nome.replace(/\.[^.]+$/, '') ? `${a.nome} › ${a.aba}` : a.nome, tamanho: a.tamanho, formato,
    tipo_lista: a.lista_reconhecida ? a.lista : null, linhas: a.linhas, periodo: a.periodo, avisos, erro: null, aba: a.aba,
    mapeamento_confirmado: a.mapeamento_confirmado,
  };
}

export function resumoParaTela(r: ResumoDoEnsaio) {
  return {
    ...r,
    titulos: {
      pagar: { quantidade: r.titulos.pagar.quantidade, valor: deCentavos(r.titulos.pagar.centavos) },
      receber: { quantidade: r.titulos.receber.quantidade, valor: deCentavos(r.titulos.receber.centavos) },
    },
    saldos: { contas: r.saldos.contas, valor: deCentavos(r.saldos.centavos) },
  };
}

export function resumoPorLista(r: ResumoDoEnsaio | null): ResumoPorLista[] | null {
  if (!r) return null;
  return (Object.entries(r.por_lista) as Array<[ListaId, { criar: number; vincular: number; recusar: number }]>)
    .map(([tipo_lista, c]) => ({ tipo_lista, criar: c.criar, vincular: c.vincular, recusar: c.recusar }));
}

async function naoDesfeitos(exec: ExecutorSQL, tenantId: string, loteId: string): Promise<RegistroQueFica[] | null> {
  const { rows } = await exec.query(
    `SELECT v.tabela, v.registro_id, v.mantido_motivo, v.linha, COALESCE(a.nome, '') AS arquivo
       FROM migracao_vinculos v LEFT JOIN migracao_arquivos a ON a.id = v.arquivo_id
      WHERE v.tenant_id = $1 AND v.lote_id = $2 AND v.mantido_motivo IS NOT NULL AND NOT v.desfeito ORDER BY v.id`,
    [tenantId, loteId],
  );
  return rows.map(r => ({
    tipo_lista: LISTA_DA_TABELA[String(r.tabela)] ?? 'titulos',
    descricao: `${String(r.arquivo)}${r.linha != null ? `, linha ${Number(r.linha)}` : ''}`,
    motivo: String(r.mantido_motivo),
  }));
}

export async function loteParaTela(exec: ExecutorSQL, tenantId: string, lote: Lote): Promise<LoteParaTela> {
  const arquivos = await listarArquivos(exec, tenantId, lote.id);
  const desfeito = lote.status === 'desfeito' || lote.status === 'desfeito_em_parte';
  return {
    id: lote.id, nome: lote.nome, situacao: situacaoParaTela(lote.status), data_corte: lote.data_corte ?? '',
    arquivos: arquivos.map(arquivoParaTela), versao: lote.versao, versao_do_ensaio: lote.versao_do_ensaio,
    resumo_do_ensaio: resumoPorLista(lote.resumo), criado_em: lote.criado_em, criado_por_nome: lote.criado_por_nome,
    aplicado_em: lote.aplicado_em, concluido_em: lote.concluido_em, desfeito_em: lote.desfeito_em,
    nao_desfeitos: desfeito ? await naoDesfeitos(exec, tenantId, lote.id) : null, erro: lote.erro, progresso: lote.progresso,
    ensaio: lote.resumo ? resumoParaTela(lote.resumo) : null,
  };
}

// ---------------------------------------------------------------------------
// Mapeamento

export function mapeamentoParaTela(a: ArquivoDoLote) {
  const def = definicaoDaLista(a.lista)!;
  const cabecalhos = a.colunas.map(c => c.cabecalho);
  const sugestao = sugerirMapeamento(cabecalhos, a.lista).mapeamento;
  const sugeridoDaColuna = new Map<number, string>();
  for (const [campo, i] of Object.entries(sugestao)) sugeridoDaColuna.set(i, campo);
  return {
    arquivo_id: a.id, arquivo_nome: arquivoParaTela(a).nome, tipo_lista: a.lista, mapeamento_confirmado: a.mapeamento_confirmado,
    faltando: a.faltando,
    colunas: a.colunas.map(c => {
      const sugerido = sugeridoDaColuna.get(c.indice) ?? null;
      const candidatos = camposDoCabecalho(c.cabecalho, a.lista).length;
      return {
        indice: c.indice, cabecalho: c.cabecalho, exemplos: c.exemplos, campo: c.campo, sugerido,
        confianca: (sugerido ? (candidatos === 1 ? 'certa' : 'provavel') : 'nenhuma') as 'certa' | 'provavel' | 'nenhuma',
      };
    }),
    campos: def.campos.map(c => ({ campo: c.id, rotulo: c.rotulo, obrigatorio: Boolean(c.obrigatorio), ...(c.dica ? { ajuda: c.dica } : {}) })),
  };
}

/** PUT da tela (colunas: [{indice, campo|null}]) → mapeamento campo → coluna. */
export function mapeamentoDoPedido(colunas: unknown): Record<string, number> | null {
  if (!Array.isArray(colunas)) return null;
  const m: Record<string, number> = {};
  for (const c of colunas) {
    const o = (c ?? {}) as { indice?: unknown; campo?: unknown };
    if (o.campo == null || o.campo === '') continue;
    if (typeof o.campo !== 'string') return null;
    if (m[o.campo] !== undefined) return null;
    m[o.campo] = Number(o.indice);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Ensaio

function descricaoDaLinha(l: LinhaDoLote, registro: RegistroLido | undefined): { descricao: string; valor: number | null } {
  if (!registro) {
    const partes = Object.values(l.valores).filter(Boolean).slice(0, 4);
    return { descricao: partes.join(' · ') || `Linha ${l.linha}`, valor: null };
  }
  switch (registro.lista) {
    case 'contas': return { descricao: `Conta ${registro.dados.nome}`, valor: registro.dados.saldo == null ? null : deCentavos(registro.dados.saldo) };
    case 'categorias': return { descricao: `${registro.dados.tipo === 'RECEITA' ? 'Receita' : 'Despesa'}: ${registro.dados.grupo ? `${registro.dados.grupo} › ` : ''}${registro.dados.nome}`, valor: null };
    case 'centros_custo': return { descricao: `Centro de custo ${registro.dados.nome}`, valor: null };
    case 'pessoas': return { descricao: `${registro.dados.nome}${registro.dados.documento ? ` (${registro.dados.documento})` : ''}`, valor: null };
    case 'saldos': return { descricao: `Saldo da conta ${registro.dados.conta}`, valor: deCentavos(registro.dados.saldo) };
    case 'titulos': {
      const t = registro.dados;
      return { descricao: `${t.movimento === 'receber' ? 'A receber de' : 'A pagar a'} ${t.pessoa} · ${reais(t.valor)} vence ${dataBR(t.vencimento)}`, valor: deCentavos(t.valor) };
    }
    // Histórico (E7)
    case 'liquidados': {
      const t = registro.dados;
      return { descricao: `${t.movimento === 'receber' ? 'Recebido de' : 'Pago a'} ${t.pessoa} · ${reais(t.baixa.valor)} em ${dataBR(t.baixa.data)}${t.baixa.conta ? ` (${t.baixa.conta})` : ''}`, valor: deCentavos(t.baixa.valor) };
    }
    case 'movimentos': {
      const m = registro.dados;
      return { descricao: `${m.entrada ? 'Entrada' : 'Saída'} em ${m.conta} · ${dataBR(m.data)}${m.pessoa ? ` · ${m.pessoa}` : ''}${m.descricao ? ` · ${m.descricao}` : ''}`, valor: deCentavos(m.entrada ? m.valor : -m.valor) };
    }
    case 'vendas': {
      const p = registro.dados;
      const v = registro.venda;
      return v
        ? { descricao: `Venda Nº ${v.numero} de ${dataBR(v.data_venda)} · ${v.cliente.nome} · ${v.produtos.length} produto(s)`, valor: deCentavos(v.produtos.reduce((a, x) => a + (x.valor_total ?? 0), 0)) }
        : { descricao: `Venda Nº ${p.venda} · produto ${p.produto}`, valor: p.valor_total === null ? null : deCentavos(p.valor_total) };
    }
    case 'faturas': return { descricao: `Fatura Nº ${registro.dados.numero} · ${registro.dados.pessoa}`, valor: deCentavos(registro.dados.valor) };
    case 'notas': return { descricao: `Nota Nº ${registro.dados.numero} de ${dataBR(registro.dados.emissao)} · ${registro.dados.tomador}`, valor: deCentavos(registro.dados.valor) };
    case 'comissoes_pagas': return { descricao: `Comissão de ${registro.dados.pessoa}${registro.dados.venda ? ` · venda ${registro.dados.venda}` : ''}`, valor: deCentavos(registro.dados.valor) };
    case 'metas': return { descricao: `Metas de ${registro.dados.pessoa} em ${registro.dados.ano}${registro.dados.funcao ? ` (${registro.dados.funcao})` : ''}`, valor: null };
    case 'reembolsos': return { descricao: `Reembolso ${registro.dados.tipo === 'CLIENTE' ? 'ao cliente' : 'do fornecedor'} ${registro.dados.pessoa}`, valor: deCentavos(registro.dados.valor) };
    case 'creditos': return { descricao: `Crédito de ${registro.dados.cliente}`, valor: deCentavos(registro.dados.saldo) };
  }
}

export function linhaParaTela(l: LinhaDoLote & { registro?: RegistroLido }) {
  const { descricao, valor } = descricaoDaLinha(l, l.registro);
  return {
    id: `${l.arquivo_id}:${l.linha}`, arquivo_nome: l.arquivo, linha: l.linha, tipo_lista: l.lista,
    resultado: l.resultado as 'criar' | 'vincular' | 'recusar', descricao, valor,
    vinculo: l.resultado === 'vincular' ? { rotulo: l.motivo } : null,
    motivo: l.resultado === 'recusar' ? l.motivo : l.resultado === 'vincular' ? l.motivo : null,
    codigo: l.codigo, avisos: l.avisos, aplicada: l.aplicada,
  };
}

// ---------------------------------------------------------------------------
// Provas

function explicacoesParaTela(l: LinhaDaProva, tipo_lista: ListaId) {
  return l.explicacoes.map(e => ({
    motivo: e.motivo, linhas: e.quantidade, valor: deCentavos(e.centavos), codigo: e.codigo,
    ...(/_depois$|^apagado$|^nao_aplicado$|^sem_motivo$|^movimento_depois$/.test(e.codigo) ? {} : { filtro: { resultado: 'recusar' as const, tipo_lista } }),
  }));
}

export function provasParaTela(p: ProvaDaMudanca) {
  const pessoas = new Map<string, {
    pessoa: string; pagar_anterior: number; pagar_enturos: number; receber_anterior: number; receber_enturos: number;
    diferenca: number; explicacoes: ReturnType<typeof explicacoesParaTela>; explicada: boolean;
  }>();
  for (const mov of ['pagar', 'receber'] as const) {
    for (const l of p.pessoas[mov]) {
      const x = pessoas.get(l.chave) ?? {
        pessoa: l.rotulo, pagar_anterior: 0, pagar_enturos: 0, receber_anterior: 0, receber_enturos: 0, diferenca: 0, explicacoes: [], explicada: true,
      };
      x[`${mov}_anterior`] = deCentavos(l.anterior_centavos);
      x[`${mov}_enturos`] = deCentavos(l.enturos_centavos);
      x.diferenca = deCentavos(Math.round(x.diferenca * 100) + l.diferenca_centavos);
      x.explicacoes.push(...explicacoesParaTela(l, 'titulos').map(e => ({ ...e, motivo: `${mov === 'pagar' ? 'A pagar' : 'A receber'}: ${e.motivo}` })));
      x.explicada = x.explicada && l.explicada;
      pessoas.set(l.chave, x);
    }
  }
  return {
    data_corte: p.data_corte ?? '', gerado_em: p.gerada_em,
    contas: p.contas.map(c => ({
      conta: c.rotulo, conta_id: c.conta_id, anterior: deCentavos(c.anterior_centavos), enturos: deCentavos(c.enturos_centavos),
      razao: c.razao_centavos == null ? null : deCentavos(c.razao_centavos), diferenca: deCentavos(c.diferenca_centavos),
      explicacoes: explicacoesParaTela(c, 'saldos'), explicada: c.explicada,
    })),
    pessoas: [...pessoas.values()].sort((a, b) => a.pessoa.localeCompare(b.pessoa, 'pt-BR')),
    meses: p.meses.map(m => ({
      mes: m.mes, categoria: m.categoria, tipo: m.movimento, anterior: deCentavos(m.anterior_centavos), enturos: deCentavos(m.enturos_centavos),
      diferenca: deCentavos(m.diferenca_centavos), explicacoes: explicacoesParaTela(m, 'titulos'), explicada: m.explicada,
    })),
    arquivos: p.arquivos.map(a => ({ ...a, soma: deCentavos(a.soma_centavos), total_rodape: a.total_rodape_centavos == null ? null : deCentavos(a.total_rodape_centavos) })),
    fora: p.fora, resumo: p.resumo, diferencas_sem_explicacao: p.diferencas_sem_explicacao,
    historico: historicoParaTela(p.historico),
  };
}

function linhaEmReais(l: LinhaDaProva) {
  return {
    rotulo: l.rotulo, anterior: deCentavos(l.anterior_centavos), enturos: deCentavos(l.enturos_centavos), diferenca: deCentavos(l.diferenca_centavos),
    explicacoes: l.explicacoes.map(e => ({ motivo: e.motivo, linhas: e.quantidade, valor: deCentavos(e.centavos), codigo: e.codigo })), explicada: l.explicada,
  };
}

/** As provas do histórico (E7) em reais, para a tela. */
export function historicoParaTela(h: ProvaDaMudanca['historico']) {
  return {
    contas_no_corte: h.contas_no_corte.map(c => ({
      ...linhaEmReais(c), conta_id: c.conta_id, historico: deCentavos(c.historico_centavos), saldo_hoje: deCentavos(c.saldo_hoje_centavos),
    })),
    liquidados: h.liquidados.map(l => ({ ...linhaEmReais(l), mes: l.mes, tipo: l.movimento })),
    receita: h.receita.map(r => ({ mes: r.mes, vendas: r.vendas, faturamento: linhaEmReais(r.faturamento), receita: r.receita ? linhaEmReais(r.receita) : null })),
    registros: h.registros,
  };
}

// ---------------------------------------------------------------------------
// Desfazer e concluir

export function previaDoDesfazerParaTela(r: ResultadoDoDesfazer) {
  const porLista = new Map<ListaId, number>();
  for (const [tabela, n] of Object.entries(r.apagados)) {
    const l = LISTA_DA_TABELA[tabela] ?? 'titulos';
    porLista.set(l, (porLista.get(l) ?? 0) + n);
  }
  if (r.saldos_estornados) porLista.set('saldos', (porLista.get('saldos') ?? 0) + r.saldos_estornados);
  return {
    apagar: [...porLista.entries()].map(([tipo_lista, quantidade]) => ({ tipo_lista, quantidade })),
    ficam: r.mantidos.map(m => ({
      tipo_lista: LISTA_DA_TABELA[m.tabela] ?? 'titulos',
      descricao: `${m.rotulo}${m.arquivo ? ` (${m.arquivo}${m.linha != null ? `, linha ${m.linha}` : ''})` : ''}`, motivo: m.motivo,
    })),
    vinculos_soltos: r.vinculos_soltos, assinatura: r.assinatura,
  };
}

export const O_QUE_LIGA = [
  'Lembretes da régua de cobrança (e-mail e WhatsApp)',
  'Avisos de vencimento das contas a pagar e a receber',
  'Emissão e envio de boletos e cobranças',
];

export { rotuloDoCodigo };

/** Assinatura do "Concluir": muda se o lote mudar entre a prévia e a confirmação. */
export function assinaturaDoConcluir(l: Lote): string {
  return createHash('sha256').update(JSON.stringify([l.id, l.status, l.versao, l.aplicado_em])).digest('hex').slice(0, 32);
}

/** Prévia do "Concluir mudança": o que volta a funcionar e o que a pessoa precisa ver antes. */
export async function previaDoConcluir(exec: ExecutorSQL, tenantId: string, lote: Lote) {
  const avisos: string[] = [];
  if (lote.status !== 'aplicado' && lote.status !== 'concluido') avisos.push('A mudança ainda não terminou de ser aplicada.');
  const { rows } = await exec.query(
    `SELECT COUNT(*) FILTER (WHERE resultado = 'recusar')::int AS recusadas,
            COUNT(*) FILTER (WHERE resultado = 'criar' AND alvo_tabela IN ('contas_pagar','contas_receber')
                               AND (dados->'registro'->'dados'->>'vencimento') < to_char((NOW() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD'))::int AS vencidos
       FROM migracao_linhas WHERE tenant_id = $1 AND lote_id = $2 AND tipo = 'dado'`,
    [tenantId, lote.id],
  );
  const recusadas = Number(rows[0]?.recusadas ?? 0);
  const vencidos = Number(rows[0]?.vencidos ?? 0);
  if (recusadas) avisos.push(`${recusadas} linha(s) ficaram de fora, cada uma com o motivo no ensaio e nas provas.`);
  if (vencidos) avisos.push(`${vencidos} lançamento(s) trazido(s) já estão vencidos: entram nos avisos de vencimento a partir de amanhã.`);
  return { liga: O_QUE_LIGA, avisos, assinatura: assinaturaDoConcluir(lote) };
}

// ---------------------------------------------------------------------------
// Progresso

export async function progressoParaTela(exec: ExecutorSQL, tenantId: string, lote: Lote) {
  const { rows } = await exec.query(
    `SELECT a.lista, COUNT(*) FILTER (WHERE m.aplicada)::int AS feitos,
            COUNT(*) FILTER (WHERE m.aplicada OR m.resultado IN ('criar','vincular'))::int AS total,
            COUNT(*) FILTER (WHERE m.aplicada AND m.codigo = 'erro')::int AS erros
       FROM migracao_linhas m JOIN migracao_arquivos a ON a.id = m.arquivo_id
      WHERE m.tenant_id = $1 AND m.lote_id = $2
      GROUP BY a.lista`,
    [tenantId, lote.id],
  );
  const { rows: at } = await exec.query(`SELECT atualizado_em FROM migracao_lotes WHERE tenant_id = $1 AND id = $2`, [tenantId, lote.id]);
  const porLista = new Map(rows.map(r => [String(r.lista), { feitos: Number(r.feitos), total: Number(r.total), erros: Number(r.erros) }]));
  const ordem: ListaId[] = ORDEM_DAS_LISTAS;
  const aplicando = lote.status === 'aplicando';
  let achouAtual = false;
  const etapas = ordem.filter(l => porLista.has(l) && porLista.get(l)!.total > 0).map(l => {
    const c = porLista.get(l)!;
    let situacao: 'aguardando' | 'fazendo' | 'feito' | 'falhou' = 'aguardando';
    if (c.feitos >= c.total) situacao = 'feito';
    else if (aplicando && !achouAtual) { situacao = lote.erro ? 'falhou' : 'fazendo'; achouAtual = true; }
    return { tipo_lista: l, feitos: c.feitos, total: c.total, situacao, erro: c.erros ? `${c.erros} linha(s) não gravaram (veja no ensaio, motivo "Erro ao gravar").` : null };
  });
  const feitos = etapas.reduce((s, e) => s + e.feitos, 0);
  const total = etapas.reduce((s, e) => s + e.total, 0);
  const quando = at[0]?.atualizado_em;
  return {
    situacao: situacaoParaTela(lote.status), feitos, total, etapas,
    atualizado_em: quando instanceof Date ? quando.toISOString() : String(quando ?? ''), erro: lote.erro,
  };
}

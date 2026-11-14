/**
 * Mês em paralelo (E7, 06/11/2026). Depois da mudança, a agência ainda
 * trabalha um mês nos dois sistemas: reenvia as listas do mês do sistema
 * anterior (contas a pagar e a receber, liquidadas ou não, e o extrato) e o
 * EnturOS compara SEM GRAVAR NADA com o que foi lançado aqui no mesmo mês.
 *
 * Cada linha de lá encontra (ou não) a sua de cá:
 *   bate       mesma pessoa, movimento, valor, vencimento e liquidação;
 *   data       mesma pessoa, movimento e valor, mas outra data (vencimento ou
 *              liquidação: "liquidado lá, em aberto aqui" cai aqui);
 *   valor      mesma pessoa e movimento, mesmo vencimento ou documento, outro valor;
 *   so_la      existe só no sistema anterior;
 *   so_aqui    existe só no EnturOS (no mês comparado).
 * E os totais por conta, por pessoa e por categoria.
 *
 * A comparação é pura (`compararMes`); o servidor só lê os arquivos do lote
 * e o banco (`compararMesEmParalelo`). Nenhuma tabela do financeiro é tocada.
 */
import type { ExecutorSQL } from '../caixa-atomico';
import { num, paraCentavos } from '../money';
import { compararMes, ROTULO_DA_COMPARACAO, janelaDoMes, type ItemDoMes, type RelatorioDoMes, type SecaoDoMes, type TotalDoGrupo } from './comparar-mes';
import { definicaoDaLista, camposFaltando, type ListaId } from './dicionario';
import { interpretarLinhas } from './interpretar';
import type { LinhaPreparada } from './leitor';
import { ehParalelo, ErroMudanca, lerLote, listarArquivos, rotuloDoCodigo, type Lote } from './servidor';
import { type Celula } from './valores';

export * from './comparar-mes';
// ---------------------------------------------------------------------------
// Servidor: lê os arquivos do lote e o banco. NÃO grava.

const txt = (v: unknown) => (v == null ? '' : String(v));

/** As linhas de lá, lidas dos arquivos do lote de comparação. */
async function linhasDeLa(exec: ExecutorSQL, tenantId: string, lote: Lote): Promise<{ contas: ItemDoMes[]; extrato: ItemDoMes[]; fora: RelatorioDoMes['fora'] }> {
  const arquivos = await listarArquivos(exec, tenantId, lote.id);
  const contas: ItemDoMes[] = [];
  const extrato: ItemDoMes[] = [];
  const fora: RelatorioDoMes['fora'] = [];
  for (const arq of arquivos) {
    // As contas do mês saem da lista de contas a pagar e a receber: abertas e liquidadas juntas.
    const lista: ListaId | null = arq.lista === 'titulos' || arq.lista === 'liquidados' ? 'liquidados' : arq.lista === 'movimentos' ? 'movimentos' : null;
    if (!lista) {
      fora.push({ arquivo: arq.nome, linha: 0, motivo: `"${arq.lista_rotulo}" não entra no mês em paralelo: solte as contas a pagar e a receber e o extrato do mês.` });
      continue;
    }
    const falta = camposFaltando(definicaoDaLista(lista)!, arq.mapeamento).filter(f => f !== 'liquidacao');
    if (falta.length) {
      fora.push({ arquivo: arq.nome, linha: 0, motivo: 'Faltam colunas obrigatórias: confira o mapeamento.' });
      continue;
    }
    const { rows } = await exec.query(
      `SELECT linha, tipo, celulas, agrupamento FROM migracao_linhas WHERE tenant_id = $1 AND arquivo_id = $2 ORDER BY linha`, [tenantId, arq.id],
    );
    const preparadas: LinhaPreparada[] = rows.map(r => ({
      numero: Number(r.linha), tipo: txt(r.tipo) as LinhaPreparada['tipo'], celulas: (r.celulas ?? []) as Celula[],
      ...(r.agrupamento ? { agrupamento: r.agrupamento as { rotulo: string; valor: string } } : {}),
    }));
    // Sem data de corte: tudo que veio liquidado é liquidado (é o mês todo).
    for (const li of interpretarLinhas(lista, preparadas, arq.mapeamento, { movimento: arq.opcoes.movimento ?? null })) {
      if (li.tipo !== 'dado') continue;
      const onde = `linha ${li.numero} de "${arq.nome}"`;
      if (!li.resultado.ok) {
        if (li.resultado.codigo !== 'excluido') fora.push({ arquivo: arq.nome, linha: li.numero, motivo: li.resultado.motivo || rotuloDoCodigo(li.resultado.codigo) });
        continue;
      }
      const r = li.resultado.registro;
      if (r.lista === 'titulos' || r.lista === 'liquidados') {
        const t = r.dados;
        contas.push({
          ref: onde, movimento: t.movimento, pessoa: t.pessoa, documento: t.documento_pessoa, valor: t.valor, vencimento: t.vencimento,
          liquidacao: r.lista === 'liquidados' ? r.dados.baixa.data : null, conta: r.lista === 'liquidados' ? r.dados.baixa.conta : t.conta,
          categoria: t.categoria, descricao: t.descricao, numero_documento: t.documento,
        });
      } else if (r.lista === 'movimentos') {
        const m = r.dados;
        extrato.push({
          ref: onde, movimento: m.entrada ? 'receber' : 'pagar', pessoa: m.pessoa, documento: m.documento_pessoa, valor: m.valor, vencimento: m.data,
          liquidacao: m.data, conta: m.conta, categoria: m.categoria, descricao: m.descricao, numero_documento: m.documento,
        });
      }
    }
  }
  return { contas, extrato, fora };
}

/** As contas e as liquidações de cá, na janela do mês. */
async function linhasDeCa(exec: ExecutorSQL, tenantId: string, mes: string): Promise<{ contas: ItemDoMes[]; extrato: ItemDoMes[] }> {
  const { de, ate } = janelaDoMes(mes);
  const { rows: cbs } = await exec.query(`SELECT id, data->>'nome' AS nome FROM contas_bancarias WHERE tenant_id = $1`, [tenantId]);
  const nomeDaConta = new Map(cbs.map(r => [txt(r.id), txt(r.nome)]));
  const { rows: cats } = await exec.query(`SELECT id, COALESCE(NULLIF(data->>'nome', ''), descricao) AS nome FROM plano_contas WHERE tenant_id = $1`, [tenantId]);
  const nomeDaCategoria = new Map(cats.map(r => [txt(r.id), txt(r.nome)]));
  const contas: ItemDoMes[] = [];
  for (const [tabela, mov, campoData, quitado, pessoa, doc] of [
    ['contas_receber', 'receber', 'data_recebimento', 'RECEBIDO', 'cliente_nome', 'cliente_documento'],
    ['contas_pagar', 'pagar', 'data_pagamento', 'PAGO', 'fornecedor_nome', 'fornecedor_cnpj'],
  ] as const) {
    const { rows } = await exec.query(
      `SELECT id, data FROM ${tabela}
        WHERE tenant_id = $1 AND COALESCE(data->>'status', '') <> 'CANCELADO'
          AND ((LEFT(COALESCE(data->>'data_vencimento', ''), 10) >= $2 AND LEFT(COALESCE(data->>'data_vencimento', ''), 10) < $3)
            OR (LEFT(COALESCE(data->>'${campoData}', ''), 10) >= $2 AND LEFT(COALESCE(data->>'${campoData}', ''), 10) < $3))`,
      [tenantId, de, ate],
    );
    for (const r of rows) {
      const d = (r.data ?? {}) as Record<string, unknown>;
      const liquidado = txt(d.status) === quitado;
      contas.push({
        ref: txt(r.id), tabela, id: txt(r.id), movimento: mov, pessoa: txt(d[pessoa]), documento: txt(d[doc]).replace(/\D/g, ''),
        valor: paraCentavos(num(d.valor_final)), vencimento: txt(d.data_vencimento).slice(0, 10) || null,
        liquidacao: liquidado ? txt(d[campoData]).slice(0, 10) || null : null, conta: nomeDaConta.get(txt(d.conta_bancaria_id)) ?? '',
        categoria: nomeDaCategoria.get(txt(d.categoria_id)) ?? '', descricao: txt(d.descricao), numero_documento: txt(d.numero_documento),
      });
    }
  }
  const extrato: ItemDoMes[] = [];
  const { rows: tem } = await exec.query(`SELECT to_regclass('public.baixas') IS NOT NULL AS ok`);
  if (tem[0]?.ok) {
    const { rows } = await exec.query(
      `SELECT b.id, b.titulo_tabela, b.titulo_id, b.data_baixa::text AS data, b.caixa_centavos, COALESCE(b.conta_bancaria_id, '') AS conta,
              COALESCE(r.data->>'cliente_nome', p.data->>'fornecedor_nome', '') AS pessoa, COALESCE(r.data->>'descricao', p.data->>'descricao', '') AS descricao,
              COALESCE(r.data->>'categoria_id', p.data->>'categoria_id', '') AS categoria
         FROM baixas b
         LEFT JOIN contas_receber r ON b.titulo_tabela = 'contas_receber' AND r.tenant_id = b.tenant_id AND r.id = b.titulo_id
         LEFT JOIN contas_pagar p ON b.titulo_tabela = 'contas_pagar' AND p.tenant_id = b.tenant_id AND p.id = b.titulo_id
        WHERE b.tenant_id = $1 AND b.tipo = 'baixa' AND b.data_baixa >= $2::date AND b.data_baixa < $3::date
          AND NOT EXISTS (SELECT 1 FROM baixas e WHERE e.tenant_id = b.tenant_id AND e.estorna_baixa_id = b.id)`,
      [tenantId, de, ate],
    );
    for (const r of rows) {
      const data = txt(r.data).slice(0, 10);
      extrato.push({
        ref: txt(r.id), tabela: 'baixas', id: txt(r.id), movimento: txt(r.titulo_tabela) === 'contas_receber' ? 'receber' : 'pagar', pessoa: txt(r.pessoa), documento: '',
        valor: Math.abs(Number(r.caixa_centavos ?? 0)), vencimento: data, liquidacao: data, conta: nomeDaConta.get(txt(r.conta)) ?? '',
        categoria: nomeDaCategoria.get(txt(r.categoria)) ?? '', descricao: txt(r.descricao), numero_documento: '',
      });
    }
  }
  return { contas, extrato };
}

/** Compara o mês do lote de comparação com o que existe aqui. Só lê. */
export async function compararMesEmParalelo(exec: ExecutorSQL, tenantId: string, loteId: string): Promise<RelatorioDoMes> {
  const lote = await lerLote(exec, tenantId, loteId);
  if (!ehParalelo(lote) || !lote.opcoes.mes) throw new ErroMudanca('Esta não é uma comparação do mês em paralelo.', 409, 'NAO_E_PARALELO');
  const mes = lote.opcoes.mes;
  const la = await linhasDeLa(exec, tenantId, lote);
  const ca = await linhasDeCa(exec, tenantId, mes);
  const secoes: SecaoDoMes[] = [];
  if (la.contas.length) secoes.push(compararMes(la.contas, ca.contas, mes, 'contas'));
  if (la.extrato.length) secoes.push(compararMes(la.extrato, ca.extrato, mes, 'extrato'));
  const { rows: agora } = await exec.query(`SELECT NOW() AS t`);
  const t = agora[0]?.t;
  return {
    lote_id: loteId, mes, gerado_em: t instanceof Date ? t.toISOString() : txt(t), secoes, fora: la.fora,
    tudo_bate: secoes.length > 0 && secoes.every(s => s.contagem.bate === s.pares.length) && la.fora.length === 0,
  };
}

/** O relatório em reais, para a tela. */
export function relatorioParaTela(r: RelatorioDoMes) {
  const item = (i: ItemDoMes | null) => (i ? {
    ref: i.ref, tabela: i.tabela ?? null, id: i.id ?? null, tipo: i.movimento, pessoa: i.pessoa, valor: i.valor / 100, vencimento: i.vencimento,
    liquidacao: i.liquidacao, conta: i.conta, categoria: i.categoria, descricao: i.descricao,
  } : null);
  const grupo = (g: TotalDoGrupo) => ({ ...g, anterior: g.anterior / 100, enturos: g.enturos / 100, diferenca: g.diferenca / 100 });
  return {
    ...r,
    secoes: r.secoes.map(s => ({
      ...s,
      pares: s.pares.map(p => ({ tipo: p.tipo, rotulo: ROTULO_DA_COMPARACAO[p.tipo], anterior: item(p.anterior), enturos: item(p.enturos), diferenca: p.diferenca / 100, detalhe: p.detalhe })),
      total: { anterior: s.total.anterior / 100, enturos: s.total.enturos / 100, diferenca: s.total.diferenca / 100 },
      por_conta: s.por_conta.map(grupo), por_pessoa: s.por_pessoa.map(grupo), por_categoria: s.por_categoria.map(grupo),
    })),
  };
}


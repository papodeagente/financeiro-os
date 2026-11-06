/**
 * Mudança de sistema (E4, 05/11/2026): desfazer um lote.
 *
 * Só sai o que o lote CRIOU e que ninguém mudou depois. "Mudou" é o retrato
 * (md5 dos dados) diferente do que a mudança deixou, uma baixa, uma
 * cobrança, ou o registro estar sendo usado por algo que não é do lote (um
 * lançamento novo no cliente importado, por exemplo). O que fica aparece na
 * lista com o motivo. Nada recalcula o passado em silêncio: o saldo de
 * abertura volta por um movimento de caixa explícito (que entra no razão).
 *
 * O que o lote só VINCULOU (cadastro que já existia) nunca é apagado: o
 * vínculo é solto e pronto.
 */
import { createHash } from 'node:crypto';
import { emTransacao, moverCaixaOuFalhar, type ExecutorSQL } from '../caixa-atomico';
import { comNadaSai } from '../nada-sai';
import { ErroMudanca, lerLote, type StatusDoLote } from './servidor';

export interface ItemMantido {
  tabela: string;
  registro_id: string;
  rotulo: string;
  motivo: string;
  arquivo: string;
  linha: number | null;
}

export interface ResultadoDoDesfazer {
  modo: 'previa' | 'gravar';
  /** Registros apagados (ou a apagar, na prévia), por tabela. */
  apagados: Record<string, number>;
  saldos_estornados: number;
  vinculos_soltos: number;
  mantidos: ItemMantido[];
  status: StatusDoLote;
  /** Retrato do que a prévia mostrou: gravar exige a mesma (algo mudou no meio = 409). */
  assinatura: string;
}

const ROTULO_DA_TABELA: Record<string, string> = {
  contas_bancarias: 'Conta bancária', plano_contas: 'Categoria', centros_custo: 'Centro de custo',
  clientes: 'Cliente', fornecedores_crm: 'Fornecedor', contas_pagar: 'Conta a pagar', contas_receber: 'Conta a receber',
};

interface Vinculo {
  id: number;
  tabela: string;
  registro_id: string;
  acao: 'criado' | 'vinculado' | 'saldo';
  hash: string | null;
  dados: Record<string, unknown>;
  arquivo: string;
  linha: number | null;
}

interface Atual { h: string; data: Record<string, unknown> }

const txt = (v: unknown) => (v == null ? '' : String(v));

async function existe(exec: ExecutorSQL, tabela: string): Promise<boolean> {
  const { rows } = await exec.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${tabela}`]);
  return Boolean(rows[0]?.ok);
}

async function estadoAtual(exec: ExecutorSQL, tenantId: string, tabela: string, ids: string[]): Promise<Map<string, Atual>> {
  const m = new Map<string, Atual>();
  if (!ids.length) return m;
  const { rows } = await exec.query(`SELECT id, md5(data::text) AS h, data FROM ${tabela} WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, ids]);
  for (const r of rows) m.set(txt(r.id), { h: txt(r.h), data: (r.data ?? {}) as Record<string, unknown> });
  return m;
}

function rotuloDe(tabela: string, d: Record<string, unknown>): string {
  const nome = txt(d.nome) || txt(d.nome_completo) || txt(d.nome_fantasia) || txt(d.razao_social) || txt(d.descricao);
  return `${ROTULO_DA_TABELA[tabela] ?? tabela}${nome ? `: ${nome}` : ''}`;
}

/** Ids referenciados por linhas da tabela que NÃO estão em `fora`. */
async function referenciados(exec: ExecutorSQL, tenantId: string, sql: string, fora: string[]): Promise<Set<string>> {
  const { rows } = await exec.query(sql, [tenantId, fora]);
  return new Set(rows.map(r => txt(r.ref)).filter(Boolean));
}

/**
 * Desfaz (gravar = true) ou só mostra o que seria desfeito (prévia). Roda
 * numa transação própria, dentro de nadaSai.
 */
export async function desfazerLote(tenantId: string, loteId: string, gravar: boolean, assinaturaDaPrevia?: string | null): Promise<ResultadoDoDesfazer> {
  return comNadaSai('desfazer a mudança de sistema', () => emTransacao(async exec => {
    const lote = await lerLote(exec, tenantId, loteId, true);
    if (lote.status === 'aplicando') throw new ErroMudanca('A mudança ainda está sendo aplicada. Espere terminar para desfazer.', 409, 'APLICANDO');
    if (lote.status === 'rascunho' || lote.status === 'ensaiado') {
      throw new ErroMudanca('Esta mudança ainda não foi aplicada: não há nada a desfazer.', 409, 'NADA_A_DESFAZER');
    }
    const { rows } = await exec.query(
      `SELECT v.id, v.tabela, v.registro_id, v.acao, v.hash, v.dados, v.linha, COALESCE(a.nome, '') AS arquivo
         FROM migracao_vinculos v LEFT JOIN migracao_arquivos a ON a.id = v.arquivo_id
        WHERE v.tenant_id = $1 AND v.lote_id = $2 AND NOT v.desfeito ORDER BY v.id`,
      [tenantId, loteId],
    );
    const vinculos: Vinculo[] = rows.map(r => ({
      id: Number(r.id), tabela: txt(r.tabela), registro_id: txt(r.registro_id), acao: txt(r.acao) as Vinculo['acao'],
      hash: r.hash == null ? null : txt(r.hash), dados: (r.dados ?? {}) as Record<string, unknown>, arquivo: txt(r.arquivo),
      linha: r.linha == null ? null : Number(r.linha),
    }));
    const criados = (tabelas: string[]) => vinculos.filter(v => v.acao === 'criado' && tabelas.includes(v.tabela));
    const mantidos: Array<ItemMantido & { vinculo: number }> = [];
    const apagar = new Map<string, Vinculo[]>();
    const soltar: number[] = [];
    const manter = (v: Vinculo, d: Record<string, unknown>, motivo: string) =>
      mantidos.push({ vinculo: v.id, tabela: v.tabela, registro_id: v.registro_id, rotulo: rotuloDe(v.tabela, d), motivo, arquivo: v.arquivo, linha: v.linha });
    const marcarApagar = (v: Vinculo) => { const l = apagar.get(v.tabela) ?? []; l.push(v); apagar.set(v.tabela, l); };
    const vaiApagar = (tabela: string) => (apagar.get(tabela) ?? []).map(v => v.registro_id);

    // 1. Saldos de abertura.
    const estornos: Vinculo[] = [];
    const contasPresas = new Set<string>();
    const saldoVs = vinculos.filter(v => v.acao === 'saldo');
    const contasAtuais = await estadoAtual(exec, tenantId, 'contas_bancarias', [...new Set(vinculos.filter(v => v.tabela === 'contas_bancarias').map(v => v.registro_id))]);
    for (const v of saldoVs) {
      const atual = contasAtuais.get(v.registro_id);
      if (!atual) { soltar.push(v.id); continue; }
      if (atual.h === v.hash) estornos.push(v);
      else { manter(v, atual.data, 'A conta teve movimento depois da mudança: o saldo de abertura ficou.'); contasPresas.add(v.registro_id); }
    }

    // 2. Títulos.
    const temBaixas = await existe(exec, 'baixas');
    const temCobrancas = await existe(exec, 'cobrancas');
    for (const tabela of ['contas_receber', 'contas_pagar']) {
      const vs = criados([tabela]);
      const atuais = await estadoAtual(exec, tenantId, tabela, vs.map(v => v.registro_id));
      const ids = vs.map(v => v.registro_id);
      const comBaixa = temBaixas && ids.length
        ? new Set((await exec.query(`SELECT DISTINCT titulo_id FROM baixas WHERE tenant_id = $1 AND titulo_tabela = $2 AND titulo_id = ANY($3::text[])`, [tenantId, tabela, ids])).rows.map(r => txt(r.titulo_id)))
        : new Set<string>();
      const comCobranca = temCobrancas && ids.length
        ? new Set((await exec.query(`SELECT DISTINCT titulo_id FROM cobrancas WHERE tenant_id = $1 AND titulo_tabela = $2 AND titulo_id = ANY($3::text[])`, [tenantId, tabela, ids])).rows.map(r => txt(r.titulo_id)))
        : new Set<string>();
      for (const v of vs) {
        const atual = atuais.get(v.registro_id);
        if (!atual) { soltar.push(v.id); continue; }
        const status = txt(atual.data.status);
        if (comBaixa.has(v.registro_id) || ['RECEBIDO', 'PAGO', 'PARCIAL'].includes(status)) manter(v, atual.data, 'Recebeu baixa depois da mudança.');
        else if (status === 'CANCELADO') manter(v, atual.data, 'Foi cancelado depois da mudança.');
        else if (comCobranca.has(v.registro_id)) manter(v, atual.data, 'Tem cobrança emitida depois da mudança.');
        else if (atual.h !== v.hash) manter(v, atual.data, 'Foi alterado depois da mudança.');
        else marcarApagar(v);
      }
    }

    // 3. Pessoas.
    for (const [tabela, col, titulos] of [['clientes', 'cliente_id', 'contas_receber'], ['fornecedores_crm', 'fornecedor_id', 'contas_pagar']] as const) {
      const vs = criados([tabela]);
      if (!vs.length) continue;
      const atuais = await estadoAtual(exec, tenantId, tabela, vs.map(v => v.registro_id));
      const usados = await referenciados(exec, tenantId,
        `SELECT DISTINCT COALESCE(NULLIF(${col}, ''), data->>'${col}') AS ref FROM ${titulos} WHERE tenant_id = $1 AND NOT (id = ANY($2::text[]))`,
        vaiApagar(titulos));
      if (tabela === 'clientes' && await existe(exec, 'vendas_crm')) {
        for (const r of (await exec.query(`SELECT DISTINCT cliente_id AS ref FROM vendas_crm WHERE tenant_id = $1`, [tenantId])).rows) usados.add(txt(r.ref));
      }
      for (const v of vs) {
        const atual = atuais.get(v.registro_id);
        if (!atual) { soltar.push(v.id); continue; }
        if (atual.h !== v.hash) manter(v, atual.data, 'Cadastro alterado depois da mudança.');
        else if (usados.has(v.registro_id)) manter(v, atual.data, 'Usado em lançamentos ou vendas que não são desta mudança.');
        else marcarApagar(v);
      }
    }

    // 4. Centros de custo.
    {
      const vs = criados(['centros_custo']);
      const atuais = await estadoAtual(exec, tenantId, 'centros_custo', vs.map(v => v.registro_id));
      const usados = new Set<string>();
      for (const t of ['contas_receber', 'contas_pagar']) {
        for (const id of await referenciados(exec, tenantId, `SELECT DISTINCT data->>'centro_custo_id' AS ref FROM ${t} WHERE tenant_id = $1 AND NOT (id = ANY($2::text[]))`, vaiApagar(t))) usados.add(id);
      }
      for (const v of vs) {
        const atual = atuais.get(v.registro_id);
        if (!atual) { soltar.push(v.id); continue; }
        if (atual.h !== v.hash) manter(v, atual.data, 'Alterado depois da mudança.');
        else if (usados.has(v.registro_id)) manter(v, atual.data, 'Usado em lançamentos que não são desta mudança.');
        else marcarApagar(v);
      }
    }

    // 5. Categorias (as de baixo primeiro: o grupo só sai se os filhos saírem).
    {
      const vs = criados(['plano_contas']);
      const atuais = await estadoAtual(exec, tenantId, 'plano_contas', vs.map(v => v.registro_id));
      const usados = new Set<string>();
      for (const t of ['contas_receber', 'contas_pagar']) {
        for (const id of await referenciados(exec, tenantId, `SELECT DISTINCT data->>'categoria_id' AS ref FROM ${t} WHERE tenant_id = $1 AND NOT (id = ANY($2::text[]))`, vaiApagar(t))) usados.add(id);
      }
      const nivel = (v: Vinculo) => txt(atuais.get(v.registro_id)?.data.codigo).split('.').length;
      const ordenados = [...vs].sort((a, b) => nivel(b) - nivel(a));
      const saem = new Set<string>();
      for (const v of ordenados) {
        const atual = atuais.get(v.registro_id);
        if (!atual) { soltar.push(v.id); continue; }
        const { rows: filhos } = await exec.query(
          `SELECT id FROM plano_contas WHERE tenant_id = $1 AND data->>'categoria_pai_id' = $2`, [tenantId, v.registro_id],
        );
        const filhoFica = filhos.some(f => !saem.has(txt(f.id)));
        if (atual.h !== v.hash) manter(v, atual.data, 'Alterada depois da mudança.');
        else if (usados.has(v.registro_id)) manter(v, atual.data, 'Usada em lançamentos que não são desta mudança.');
        else if (filhoFica) manter(v, atual.data, 'Tem categorias abaixo dela que ficam.');
        else { marcarApagar(v); saem.add(v.registro_id); }
      }
    }

    // 6. Contas bancárias.
    {
      const vs = criados(['contas_bancarias']);
      const usados = new Set<string>();
      for (const t of ['contas_receber', 'contas_pagar']) {
        for (const id of await referenciados(exec, tenantId, `SELECT DISTINCT data->>'conta_bancaria_id' AS ref FROM ${t} WHERE tenant_id = $1 AND NOT (id = ANY($2::text[]))`, vaiApagar(t))) usados.add(id);
      }
      if (await existe(exec, 'transferencias')) {
        const { rows: tr } = await exec.query(
          `SELECT data->>'conta_origem_id' AS a, data->>'conta_destino_id' AS b FROM transferencias WHERE tenant_id = $1`, [tenantId],
        );
        for (const r of tr) { usados.add(txt(r.a)); usados.add(txt(r.b)); }
      }
      if (temBaixas) {
        for (const r of (await exec.query(`SELECT DISTINCT conta_bancaria_id AS ref FROM baixas WHERE tenant_id = $1`, [tenantId])).rows) usados.add(txt(r.ref));
      }
      for (const v of vs) {
        const atual = contasAtuais.get(v.registro_id);
        if (!atual) { soltar.push(v.id); continue; }
        if (contasPresas.has(v.registro_id) || atual.h !== v.hash) manter(v, atual.data, 'A conta teve movimento ou foi alterada depois da mudança.');
        else if (usados.has(v.registro_id)) manter(v, atual.data, 'Usada em lançamentos que não são desta mudança.');
        else marcarApagar(v);
      }
    }

    // 7. Vínculos com o que já existia: só soltam.
    for (const v of vinculos) if (v.acao === 'vinculado') soltar.push(v.id);

    const apagados: Record<string, number> = {};
    for (const [t, vs] of apagar) apagados[t] = vs.length;
    const assinatura = createHash('sha256').update(JSON.stringify({
      lote: loteId,
      apagar: [...apagar.values()].flat().map(v => v.id).sort((a, b) => a - b),
      estornos: estornos.map(v => v.id).sort((a, b) => a - b),
      mantidos: mantidos.map(m => `${m.vinculo}:${m.motivo}`).sort(),
    })).digest('hex').slice(0, 32);
    if (gravar && assinaturaDaPrevia && assinaturaDaPrevia !== assinatura) {
      throw new ErroMudanca('Algo mudou desde a prévia. Veja de novo o que vai ser desfeito antes de confirmar.', 409, 'ASSINATURA_VENCIDA');
    }
    let status: StatusDoLote = lote.status;
    if (gravar) {
      for (const v of estornos) {
        const delta = Number(v.dados.delta_centavos ?? 0);
        const antes = (v.dados.antes ?? {}) as Record<string, unknown>;
        if (delta) {
          await moverCaixaOuFalhar(tenantId, v.registro_id, -delta / 100, exec, {
            tipo: 'abertura', tabela: 'contas_bancarias', id: v.registro_id, descricao: 'Saldo de abertura desfeito (mudança de sistema)',
          });
        }
        await exec.query(
          `UPDATE contas_bancarias SET data = jsonb_set(jsonb_set(data, '{saldo_inicial}', to_jsonb($3::numeric), true),
                  '{data_saldo_inicial}', COALESCE(to_jsonb($4::text), 'null'::jsonb), true), updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2`,
          [tenantId, v.registro_id, Number(antes.saldo_inicial ?? 0), antes.data_saldo_inicial == null ? null : txt(antes.data_saldo_inicial)],
        );
      }
      for (const tabela of ['contas_receber', 'contas_pagar', 'clientes', 'fornecedores_crm', 'centros_custo']) {
        const ids = vaiApagar(tabela);
        if (ids.length) await exec.query(`DELETE FROM ${tabela} WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, ids]);
      }
      // Categorias uma a uma, de baixo para cima (na ordem em que foram marcadas).
      for (const v of apagar.get('plano_contas') ?? []) {
        await exec.query(`DELETE FROM plano_contas WHERE tenant_id = $1 AND id = $2`, [tenantId, v.registro_id]);
      }
      const contas = vaiApagar('contas_bancarias');
      if (contas.length) await exec.query(`DELETE FROM contas_bancarias WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, contas]);
      const feitos = [...soltar, ...estornos.map(v => v.id), ...[...apagar.values()].flat().map(v => v.id)];
      // O vínculo "criado" de uma conta cujo saldo ficou também fica.
      if (feitos.length) {
        await exec.query(`UPDATE migracao_vinculos SET desfeito = true, desfeito_em = NOW(), mantido_motivo = NULL WHERE tenant_id = $1 AND id = ANY($2::bigint[])`, [tenantId, feitos]);
      }
      for (const m of mantidos) {
        await exec.query(`UPDATE migracao_vinculos SET mantido_motivo = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, m.vinculo, m.motivo]);
      }
      status = mantidos.length ? 'desfeito_em_parte' : 'desfeito';
      await exec.query(
        `UPDATE migracao_lotes SET status = $3, desfeito_em = NOW(), atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, loteId, status],
      );
    }
    return {
      modo: gravar ? 'gravar' : 'previa', apagados, saldos_estornados: estornos.length, vinculos_soltos: soltar.length,
      mantidos: mantidos.map(({ vinculo: _v, ...m }) => m), status, assinatura,
    };
  }));
}

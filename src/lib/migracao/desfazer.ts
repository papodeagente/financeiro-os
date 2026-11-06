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
import { estornarBaixa } from '../baixas-servidor';
import { USUARIO_DA_MUDANCA } from './gravador-historico';
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
  baixas: 'Liquidação', vendas_crm: 'Venda', migracao_historico: 'Registro do sistema anterior', comissao_metas: 'Meta',
  reembolsos: 'Reembolso', creditos_cliente: 'Crédito do cliente',
};

interface Vinculo {
  id: number;
  tabela: string;
  registro_id: string;
  acao: 'criado' | 'vinculado' | 'saldo' | 'historico';
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

function dataBRCurta(d: string): string {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `de ${m[3]}/${m[2]}/${m[1]}` : '';
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

    // 1b. Histórico (E7): as liquidações que o lote trouxe, por título.
    const historicas = vinculos.filter(v => v.acao === 'historico' && v.tabela === 'baixas');
    const baixasDoLote = new Set(historicas.map(v => v.registro_id));
    const historicasDoTitulo = new Map<string, Vinculo[]>();
    for (const v of historicas) {
      const k = `${txt(v.dados.titulo_tabela)}:${txt(v.dados.titulo_id)}`;
      historicasDoTitulo.set(k, [...(historicasDoTitulo.get(k) ?? []), v]);
    }

    // 1c. Vendas trazidas: saem se ninguém mexeu nelas (nem fechou, cancelou, reembolsou ou comissionou).
    const vendasVs = criados(['vendas_crm']);
    const vendasAtuais = await estadoAtual(exec, tenantId, 'vendas_crm', vendasVs.map(v => v.registro_id));
    for (const v of vendasVs) {
      const atual = vendasAtuais.get(v.registro_id);
      if (!atual) { soltar.push(v.id); continue; }
      const usos: string[] = [];
      const conferir = async (tabela: string, sql: string, motivo: string) => {
        if (!(await existe(exec, tabela))) return;
        const { rows: r } = await exec.query(sql, [tenantId, v.registro_id]);
        if (r.length) usos.push(motivo);
      };
      await conferir('vendas_modelo', `SELECT 1 FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = $2 AND situacao = 'FECHADA'`, 'A venda foi fechada depois da mudança.');
      await conferir('venda_cancelamentos', `SELECT 1 FROM venda_cancelamentos WHERE tenant_id = $1 AND venda_id = $2 LIMIT 1`, 'A venda teve cancelamento depois da mudança.');
      await conferir('comissao_lancamentos', `SELECT 1 FROM comissao_lancamentos WHERE tenant_id = $1 AND venda_id = $2 AND (fechado_centavos <> 0 OR fechado_retido_centavos <> 0) LIMIT 1`, 'A venda tem comissão fechada depois da mudança.');
      await conferir('reembolsos', `SELECT 1 FROM reembolsos WHERE tenant_id = $1 AND venda_id = $2 AND vinculado_a NOT LIKE 'mudanca:%' LIMIT 1`, 'A venda tem reembolso lançado depois da mudança.');
      if (usos.length) manter(v, atual.data, usos[0]);
      else if (atual.h !== v.hash) manter(v, atual.data, 'A venda foi alterada depois da mudança.');
      else marcarApagar(v);
    }

    // 1d. Reembolsos e créditos trazidos.
    if (await existe(exec, 'reembolsos')) {
      for (const v of criados(['reembolsos'])) {
        const { rows: r } = await exec.query(`SELECT situacao, pessoa_nome FROM reembolsos WHERE tenant_id = $1 AND id = $2`, [tenantId, v.registro_id]);
        if (!r.length) { soltar.push(v.id); continue; }
        const d = { nome: txt(r[0].pessoa_nome) };
        if (txt(r[0].situacao) !== txt(v.dados.situacao)) manter(v, d, 'O reembolso andou depois da mudança (aprovado, pago ou cancelado aqui).');
        else marcarApagar(v);
      }
    }
    if (await existe(exec, 'creditos_cliente')) {
      for (const v of criados(['creditos_cliente'])) {
        const { rows: r } = await exec.query(
          `SELECT c.cliente_nome, c.saldo_centavos, (SELECT COUNT(*)::int FROM creditos_cliente_movimentos m WHERE m.tenant_id = c.tenant_id AND m.credito_id = c.id) AS movs
             FROM creditos_cliente c WHERE c.tenant_id = $1 AND c.id = $2`, [tenantId, v.registro_id]);
        if (!r.length) { soltar.push(v.id); continue; }
        const d = { nome: txt(r[0].cliente_nome) };
        if (Number(r[0].movs) > 1 || Number(r[0].saldo_centavos) !== Number(v.dados.valor_centavos ?? -1)) manter(v, d, 'O crédito foi usado ou ajustado depois da mudança.');
        else marcarApagar(v);
      }
    }

    // 1e. Metas: voltam ao que eram, se ninguém mudou depois.
    const metasVoltar: Vinculo[] = [];
    if (await existe(exec, 'comissao_metas')) {
      for (const v of criados(['comissao_metas'])) {
        const { rows: r } = await exec.query(`SELECT valor_centavos FROM comissao_metas WHERE tenant_id = $1 AND pessoa_funcao_id = $2 AND mes = $3`,
          [tenantId, txt(v.dados.pessoa_funcao_id), txt(v.dados.mes)]);
        const atual = r.length ? Number(r[0].valor_centavos) : null;
        if (atual !== Number(v.dados.depois)) manter(v, { nome: txt(v.dados.mes) }, 'A meta foi mudada depois da mudança.');
        else metasVoltar.push(v);
      }
    }

    // 1f. Registros do sistema anterior (faturas, notas, comissões pagas): só consulta, sempre saem.
    for (const v of criados(['migracao_historico'])) marcarApagar(v);

    // 2. Títulos.
    const temBaixas = await existe(exec, 'baixas');
    const temCobrancas = await existe(exec, 'cobrancas');
    for (const tabela of ['contas_receber', 'contas_pagar']) {
      const vs = criados([tabela]);
      const atuais = await estadoAtual(exec, tenantId, tabela, vs.map(v => v.registro_id));
      const ids = vs.map(v => v.registro_id);
      // Baixa que NÃO é a liquidação trazida pelo próprio lote (nem o estorno dela).
      const comBaixa = temBaixas && ids.length
        ? new Set((await exec.query(
          `SELECT DISTINCT titulo_id FROM baixas WHERE tenant_id = $1 AND titulo_tabela = $2 AND titulo_id = ANY($3::text[])
              AND NOT (id = ANY($4::text[])) AND NOT (COALESCE(estorna_baixa_id, '') = ANY($4::text[]))`,
          [tenantId, tabela, ids, [...baixasDoLote]])).rows.map(r => txt(r.titulo_id)))
        : new Set<string>();
      const comCobranca = temCobrancas && ids.length
        ? new Set((await exec.query(`SELECT DISTINCT titulo_id FROM cobrancas WHERE tenant_id = $1 AND titulo_tabela = $2 AND titulo_id = ANY($3::text[])`, [tenantId, tabela, ids])).rows.map(r => txt(r.titulo_id)))
        : new Set<string>();
      for (const v of vs) {
        const atual = atuais.get(v.registro_id);
        if (!atual) { soltar.push(v.id); continue; }
        const status = txt(atual.data.status);
        // A conta liquidada trazida do histórico chega liquidada: só baixa de fora do lote a segura.
        const doHistorico = historicasDoTitulo.has(`${tabela}:${v.registro_id}`);
        if (comBaixa.has(v.registro_id) || (!doHistorico && ['RECEBIDO', 'PAGO', 'PARCIAL'].includes(status))) manter(v, atual.data, 'Recebeu baixa depois da mudança.');
        else if (status === 'CANCELADO') manter(v, atual.data, 'Foi cancelado depois da mudança.');
        else if (comCobranca.has(v.registro_id)) manter(v, atual.data, 'Tem cobrança emitida depois da mudança.');
        else if (atual.h !== v.hash) manter(v, atual.data, 'Foi alterado depois da mudança.');
        else marcarApagar(v);
      }
    }

    // 2b. Cada liquidação trazida sai junto com a conta dela (estorno explícito, no razão).
    const historicasEstornar: Vinculo[] = [];
    for (const v of historicas) {
      const tabela = txt(v.dados.titulo_tabela);
      if (vaiApagar(tabela).includes(txt(v.dados.titulo_id))) historicasEstornar.push(v);
      else manter(v, { nome: dataBRCurta(txt(v.dados.data)) }, 'A conta desta liquidação ficou (alguém mexeu nela).');
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
        for (const r of (await exec.query(`SELECT DISTINCT cliente_id AS ref FROM vendas_crm WHERE tenant_id = $1 AND NOT (id = ANY($2::text[]))`, [tenantId, vaiApagar('vendas_crm')])).rows) usados.add(txt(r.ref));
      }
      if (tabela === 'fornecedores_crm' && await existe(exec, 'venda_produtos')) {
        for (const r of (await exec.query(
          `SELECT fornecedor_id AS a, representante_id AS b FROM venda_produtos WHERE tenant_id = $1 AND NOT (venda_id = ANY($2::text[]))`, [tenantId, vaiApagar('vendas_crm')])).rows) {
          usados.add(txt(r.a)); usados.add(txt(r.b));
        }
      }
      if (await existe(exec, 'reembolsos')) {
        for (const r of (await exec.query(`SELECT DISTINCT pessoa_id AS ref FROM reembolsos WHERE tenant_id = $1 AND NOT (id = ANY($2::text[]))`, [tenantId, vaiApagar('reembolsos')])).rows) usados.add(txt(r.ref));
      }
      if (tabela === 'clientes' && await existe(exec, 'creditos_cliente')) {
        for (const r of (await exec.query(`SELECT DISTINCT cliente_id AS ref FROM creditos_cliente WHERE tenant_id = $1 AND NOT (id = ANY($2::text[]))`, [tenantId, vaiApagar('creditos_cliente')])).rows) usados.add(txt(r.ref));
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
        const fora = historicasEstornar.map(v => v.registro_id);
        for (const r of (await exec.query(
          `SELECT DISTINCT conta_bancaria_id AS ref FROM baixas WHERE tenant_id = $1 AND NOT (id = ANY($2::text[])) AND NOT (COALESCE(estorna_baixa_id, '') = ANY($2::text[]))`,
          [tenantId, fora])).rows) usados.add(txt(r.ref));
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
      historico: historicasEstornar.map(v => v.id).sort((a, b) => a - b),
      metas: metasVoltar.map(v => v.id).sort((a, b) => a - b),
      mantidos: mantidos.map(m => `${m.vinculo}:${m.motivo}`).sort(),
    })).digest('hex').slice(0, 32);
    if (gravar && assinaturaDaPrevia && assinaturaDaPrevia !== assinatura) {
      throw new ErroMudanca('Algo mudou desde a prévia. Veja de novo o que vai ser desfeito antes de confirmar.', 409, 'ASSINATURA_VENCIDA');
    }
    let status: StatusDoLote = lote.status;
    if (gravar) {
      // Histórico: estorna a liquidação trazida (o dinheiro volta pelo razão) e
      // devolve a abertura para onde estava (o saldo da data de corte não muda).
      for (const v of historicasEstornar) {
        await estornarBaixa(exec, { tenantId, usuarioNome: USUARIO_DA_MUDANCA }, v.registro_id, { motivo: 'Mudança de sistema desfeita', data: txt(v.dados.data) || undefined });
        const caixa = Number(v.dados.caixa_centavos ?? 0);
        const conta = txt(v.dados.conta_id);
        if (caixa && conta) {
          await moverCaixaOuFalhar(tenantId, conta, caixa / 100, exec, {
            tipo: 'abertura', tabela: 'baixas', id: v.registro_id, descricao: 'Histórico desfeito: a abertura volta para a data de corte (mudança de sistema)',
          });
          await exec.query(
            `UPDATE contas_bancarias SET data = jsonb_set(data, '{saldo_inicial}', to_jsonb(ROUND((CASE WHEN data->>'saldo_inicial' ~ '^-?[0-9]+([.][0-9]+)?$' THEN (data->>'saldo_inicial')::numeric ELSE 0 END) + $3::numeric, 2)), true), updated_at = NOW()
              WHERE tenant_id = $1 AND id = $2`,
            [tenantId, conta, (caixa / 100).toFixed(2)],
          );
        }
      }
      for (const v of metasVoltar) {
        const antes = v.dados.antes;
        if (antes === null || antes === undefined) {
          await exec.query(`DELETE FROM comissao_metas WHERE tenant_id = $1 AND pessoa_funcao_id = $2 AND mes = $3`, [tenantId, txt(v.dados.pessoa_funcao_id), txt(v.dados.mes)]);
        } else {
          await exec.query(`UPDATE comissao_metas SET valor_centavos = $4 WHERE tenant_id = $1 AND pessoa_funcao_id = $2 AND mes = $3`, [tenantId, txt(v.dados.pessoa_funcao_id), txt(v.dados.mes), Number(antes)]);
        }
      }
      const vendasSaem = vaiApagar('vendas_crm');
      if (vendasSaem.length) {
        for (const t of ['venda_componentes', 'venda_passageiros', 'venda_produtos', 'venda_pagamentos', 'venda_pendencias', 'itens_venda', 'vendas_modelo']) {
          if (await existe(exec, t)) await exec.query(`DELETE FROM ${t} WHERE tenant_id = $1 AND venda_id = ANY($2::text[])`, [tenantId, vendasSaem]);
        }
        await exec.query(`DELETE FROM vendas_crm WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, vendasSaem]);
        // Conta que fica (alguém mexeu) deixa de apontar para a venda que saiu.
        for (const t of ['contas_receber', 'contas_pagar']) {
          await exec.query(
            `UPDATE ${t} SET data = data - 'origem_venda_id' - 'venda_id' - 'origem_venda_numero', updated_at = NOW()
              WHERE tenant_id = $1 AND data->>'origem_venda_id' = ANY($2::text[])`, [tenantId, vendasSaem]);
        }
      }
      const reembolsosSaem = vaiApagar('reembolsos');
      if (reembolsosSaem.length) await exec.query(`DELETE FROM reembolsos WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, reembolsosSaem]);
      const creditosSaem = vaiApagar('creditos_cliente');
      if (creditosSaem.length) {
        await exec.query(`DELETE FROM creditos_cliente_movimentos WHERE tenant_id = $1 AND credito_id = ANY($2::text[])`, [tenantId, creditosSaem]);
        await exec.query(`DELETE FROM creditos_cliente WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, creditosSaem]);
      }
      const registrosSaem = vaiApagar('migracao_historico');
      if (registrosSaem.length) await exec.query(`DELETE FROM migracao_historico WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, registrosSaem]);
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
      const feitos = [...soltar, ...estornos.map(v => v.id), ...historicasEstornar.map(v => v.id), ...metasVoltar.map(v => v.id), ...[...apagar.values()].flat().map(v => v.id)];
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

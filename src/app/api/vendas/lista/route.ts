import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { pode } from '@/lib/permissoes-servidor';
import { podeVerTodasVendas } from '@/lib/permissoes';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { lerVendas } from '@/lib/vendas-leitura';
import { lerConfigVenda } from '@/lib/venda-servidor';
import { csvDaMatriz, matrizParaExportar } from '@/lib/relatorios-vendas';
import {
  colunasDaExportacao, filtrarLinhas, linhaDaVenda, linhaParaTela, linhasParaExportar, opcoesDaLista,
  type FiltroDaLista,
} from '@/lib/vendas-lista';

/**
 * A lista de vendas (/vendas).
 *   GET /api/vendas/lista?de=AAAA-MM-DD&ate=AAAA-MM-DD&canceladas=1
 *       &busca=&fornecedor=&tipo=&vendedor=&unidade=&situacao=&formato=json|csv|xlsx
 * JSON: { linhas (todas do período; a tela filtra na hora com o mesmo
 * filtrarLinhas), opcoes, ver_receita, so_as_suas, pode_exportar }.
 * CSV/XLSX: as linhas já filtradas pelos mesmos parâmetros.
 * Direitos: quem não vê as vendas da equipe vê só as suas; a receita da
 * agência só com "ver o ganho da agência nas vendas" (o número nem sai);
 * baixar só com "baixar em Excel e PDF". Orçamento não é venda (tem lista própria).
 */
export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const exec = pool as unknown as ExecutorSQL;
  const u = new URL(req.url).searchParams;
  const formato = u.get('formato') === 'csv' || u.get('formato') === 'xlsx' ? u.get('formato')! : 'json';
  const podeExportar = await pode(sessao, 'exportar', { exec });
  if (formato !== 'json' && !podeExportar) {
    return NextResponse.json({ error: 'Seu acesso não inclui baixar a lista em planilha.', codigo: 'SEM_DIREITO' }, { status: 403 });
  }
  const de = u.get('de') ?? '';
  const ate = u.get('ate') ?? '';
  if ((de && !ISO.test(de)) || (ate && !ISO.test(ate))) return NextResponse.json({ error: 'Data inválida.', codigo: 'DADOS' }, { status: 400 });
  const verReceita = await pode(sessao, 'ver_colunas_comissao', { exec });
  const soAsSuas = !podeVerTodasVendas(sessao);
  try {
    const tenantId = await getTenantId();
    const [lidas, cfg] = await Promise.all([
      lerVendas(exec, tenantId, {
        de: de || undefined, ate: ate || undefined, incluir_canceladas: u.get('canceladas') !== '0',
        vendedor_id: soAsSuas ? sessao.userId : undefined,
      }),
      lerConfigVenda(exec, tenantId),
    ]);
    const todas = lidas.map(l => linhaParaTela(linhaDaVenda(l, cfg.receita, verReceita), verReceita))
      .sort((a, b) => (b.data_venda.localeCompare(a.data_venda) || b.numero.localeCompare(a.numero, 'pt-BR', { numeric: true })));

    if (formato !== 'json') {
      const filtro: FiltroDaLista = {
        busca: u.get('busca') ?? '', fornecedor: u.get('fornecedor') ?? '', tipo: u.get('tipo') ?? '',
        vendedor: u.get('vendedor') ?? '', unidade: u.get('unidade') ?? '', situacao: u.get('situacao') ?? '',
      };
      const colunas = colunasDaExportacao(verReceita);
      const matriz = matrizParaExportar(colunas, linhasParaExportar(filtrarLinhas(todas, filtro), verReceita));
      const nome = `vendas${de ? `-${de}` : ''}${ate ? `-a-${ate}` : ''}`;
      if (formato === 'csv') {
        return new NextResponse(csvDaMatriz(matriz), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}.csv"` } });
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matriz), 'Vendas');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      return new NextResponse(new Uint8Array(buf), {
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${nome}.xlsx"` },
      });
    }
    return NextResponse.json({
      linhas: todas, opcoes: opcoesDaLista(todas), ver_receita: verReceita, so_as_suas: soAsSuas, pode_exportar: podeExportar,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro interno', codigo: 'ERRO' }, { status: 500 });
  }
}

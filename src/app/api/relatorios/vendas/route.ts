import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { pode } from '@/lib/permissoes-servidor';
import { podeVerTodasVendas } from '@/lib/permissoes';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { lerVendas } from '@/lib/vendas-leitura';
import { escopoDaSessao, type ExecutorEmpresas } from '@/lib/empresas-servidor';
import { lerConfigVenda } from '@/lib/venda-servidor';
import {
  COLUNAS_POR_FORMA, COLUNAS_POR_PRODUTO, COLUNAS_RANKING, MEDIDAS_DA_DINAMICA, RELATORIOS, ROTULO_RELATORIO,
  colunasAgrupadas, colunasPermitidas, csvDaMatriz, linhasPorForma, linhasPorProduto, linhasPorUnidade, linhasPorVendedor,
  matrizParaExportar, rankingDeClientes, semColunasSensiveis, totaisDasLinhas,
  type ColunaDoRelatorio, type LinhaDoRelatorio, type TipoDeRelatorio,
} from '@/lib/relatorios-vendas';

/**
 * Relatórios de vendas (E5, parte F).
 *   GET /api/relatorios/vendas?relatorio=produto|vendedor|unidade|forma|clientes|dinamica
 *       &de=AAAA-MM-DD&ate=AAAA-MM-DD&situacao=todas|abertas|fechadas&canceladas=1
 *       &colunas=a,b,c&formato=json|csv|xlsx
 * JSON: { relatorio, titulo, colunas (as permitidas), catalogo (para escolher), linhas, totais, ver_receita, so_as_suas }.
 * Direitos: abrir relatórios; o ganho da agência (componentes, custo, receita) só com
 * "ver o ganho da agência nas vendas"; exportar só com "baixar em Excel e PDF";
 * quem não vê as vendas da equipe vê só as suas.
 */
export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function catalogoDe(r: TipoDeRelatorio): ColunaDoRelatorio[] {
  if (r === 'vendedor') return colunasAgrupadas('Vendedor');
  if (r === 'unidade') return colunasAgrupadas('Unidade');
  if (r === 'forma') return COLUNAS_POR_FORMA;
  if (r === 'clientes') return COLUNAS_RANKING;
  return COLUNAS_POR_PRODUTO;
}

export async function GET(req: Request) {
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const exec = pool as unknown as ExecutorSQL;
  if (!(await pode(sessao, 'acessar_relatorios', { exec }))) {
    return NextResponse.json({ error: 'Seu acesso não inclui relatórios.', codigo: 'SEM_DIREITO' }, { status: 403 });
  }
  const u = new URL(req.url).searchParams;
  const relatorio = (RELATORIOS as readonly string[]).includes(u.get('relatorio') ?? '') ? (u.get('relatorio') as TipoDeRelatorio) : 'produto';
  const formato = u.get('formato') === 'csv' || u.get('formato') === 'xlsx' ? u.get('formato')! : 'json';
  if (formato !== 'json' && !(await pode(sessao, 'exportar', { exec }))) {
    return NextResponse.json({ error: 'Seu acesso não inclui baixar relatórios.', codigo: 'SEM_DIREITO' }, { status: 403 });
  }
  const de = u.get('de') ?? '';
  const ate = u.get('ate') ?? '';
  if ((de && !ISO.test(de)) || (ate && !ISO.test(ate))) return NextResponse.json({ error: 'Data inválida.', codigo: 'DADOS' }, { status: 400 });
  const situacao = u.get('situacao') ?? 'todas';
  const verReceita = await pode(sessao, 'ver_colunas_comissao', { exec });
  const soAsSuas = !podeVerTodasVendas(sessao);
  try {
    const tenantId = await getTenantId();
    const [lidasTodas, cfg] = await Promise.all([
      lerVendas(exec, tenantId, {
        de: de || undefined, ate: ate || undefined, incluir_canceladas: u.get('canceladas') === '1', vendedor_id: soAsSuas ? sessao.userId : undefined,
        // Empresas marcadas e liberadas (E7). Uma empresa só: todas.
        empresas: (await escopoDaSessao(sessao, exec as unknown as ExecutorEmpresas)).visiveis,
      }),
      lerConfigVenda(exec, tenantId),
    ]);
    const lidas = lidasTodas.filter(v => situacao === 'abertas' ? v.situacao === 'ABERTA' && !v.cancelada : situacao === 'fechadas' ? v.situacao === 'FECHADA' : true);
    const produtos = linhasPorProduto(lidas, cfg.receita);
    let linhas: LinhaDoRelatorio[];
    if (relatorio === 'vendedor') linhas = linhasPorVendedor(produtos);
    else if (relatorio === 'unidade') linhas = linhasPorUnidade(produtos);
    else if (relatorio === 'clientes') linhas = rankingDeClientes(produtos);
    else if (relatorio === 'forma') linhas = linhasPorForma(lidas);
    else linhas = produtos;
    const catalogo = relatorio === 'dinamica' ? [...COLUNAS_POR_PRODUTO] : catalogoDe(relatorio);
    const escolhidas = (u.get('colunas') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const colunas = colunasPermitidas(catalogo, verReceita, escolhidas);
    linhas = semColunasSensiveis(linhas, catalogo, verReceita);
    const titulo = ROTULO_RELATORIO[relatorio];
    if (formato !== 'json') {
      const matriz = matrizParaExportar(colunas, linhas);
      const nome = `${titulo.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}${de ? `-${de}` : ''}${ate ? `-a-${ate}` : ''}`;
      if (formato === 'csv') {
        return new NextResponse(csvDaMatriz(matriz), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}.csv"` } });
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matriz), titulo.slice(0, 31));
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      return new NextResponse(new Uint8Array(buf), {
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${nome}.xlsx"` },
      });
    }
    return NextResponse.json({
      relatorio, titulo, colunas,
      catalogo: catalogo.filter(c => verReceita || !c.sensivel),
      medidas: relatorio === 'dinamica' ? MEDIDAS_DA_DINAMICA.filter(c => verReceita || !c.sensivel) : [],
      linhas, totais: totaisDasLinhas(linhas, colunas), ver_receita: verReceita, so_as_suas: soAsSuas,
      quantidade_vendas: lidas.length,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro interno', codigo: 'ERRO' }, { status: 500 });
  }
}

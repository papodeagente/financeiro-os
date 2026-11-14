import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { pode } from '@/lib/permissoes-servidor';
import { podeVerTodasVendas } from '@/lib/permissoes';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { csvDaMatriz, matrizParaExportar } from '@/lib/relatorios-vendas';
import { documentoDoRelatorio, lerConsulta, montarRelatorioDeVendas } from '@/lib/relatorios-vendas-servidor';
import { formatoDaConsulta } from '@/lib/exportacao/arquivo';
import { nomeDoArquivo } from '@/lib/exportacao/documento';
import { responderExportacao } from '@/lib/exportacao/servidor';
import { registrarEventoAuditoria } from '@/lib/audit';
import { escopoDaSessao, type ExecutorEmpresas } from '@/lib/empresas-servidor';
import { recusaModulo } from '@/lib/guarda-rota';

/**
 * Relatórios de vendas (E5, parte F; filtros, pagamentos e exportação na E7).
 *   GET /api/relatorios/vendas?relatorio=produto|vendedor|unidade|empresa|fornecedor|forma|pagamentos|clientes|dinamica|cartao_corporativo
 *       &de=AAAA-MM-DD&ate=AAAA-MM-DD&data_base=venda|inicio|fim&situacao=todas|abertas|fechadas&canceladas=1
 *       &fornecedor=&vendedor=&tipo=&produto=&unidade=&empresa=&situacao_produto=todos|ativos|cancelados
 *       &ordem=faturamento|receita&so_liquidados=1&colunas=a,b,c
 *       &din_linhas=Vendedor,Mês&din_coluna=Ano&din_medida=faturamento
 *       &formato=json|csv|xlsx|pdf|imprimir
 * JSON: { relatorio, titulo, colunas (as permitidas), catalogo, medidas, linhas, totais, opcoes (dos filtros),
 *         serie (por mês), ver_receita, so_as_suas, ordem, quantidade_vendas, multiempresa }.
 * Empresa (E7): relatório, filtro, coluna e campo da dinâmica só com duas ou mais empresas.
 * cartao_corporativo: uma linha por bilhete pago com o cartão corporativo do cliente, para a
 * conciliação da administradora (só os 4 últimos dígitos do cartão, nunca o número).
 * Direitos: abrir relatórios; o ganho da agência (componentes, custo, receita) só com
 * "ver o ganho da agência nas vendas" (e só ele ordena pela receita); exportar só com
 * "baixar em Excel e PDF"; quem não vê as vendas da equipe vê só as suas.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const semModulo = await recusaModulo('relatorios');
  if (semModulo) return semModulo;
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const exec = pool as unknown as ExecutorSQL;
  if (!(await pode(sessao, 'acessar_relatorios', { exec }))) {
    return NextResponse.json({ error: 'Seu acesso não inclui relatórios.', codigo: 'SEM_DIREITO' }, { status: 403 });
  }
  const u = new URL(req.url).searchParams;
  const formato = formatoDaConsulta(u.get('formato'));
  if (formato && !(await pode(sessao, 'exportar', { exec }))) {
    return NextResponse.json({ error: 'Seu acesso não inclui baixar relatórios.', codigo: 'SEM_DIREITO' }, { status: 403 });
  }
  const lida = lerConsulta(u);
  if (!lida.ok) return NextResponse.json({ error: lida.erro, codigo: 'DADOS' }, { status: 400 });
  const consulta = lida.consulta;
  const verReceita = await pode(sessao, 'ver_colunas_comissao', { exec });
  const soAsSuas = !podeVerTodasVendas(sessao);
  try {
    const tenantId = await getTenantId();
    // Empresas marcadas e liberadas (E7). Uma empresa só: todas, e nada de empresa na tela.
    const escopo = await escopoDaSessao(sessao, exec as unknown as ExecutorEmpresas);
    const r = await montarRelatorioDeVendas(exec, tenantId, consulta, {
      verReceita, vendedorId: soAsSuas ? sessao.userId : undefined,
      empresas: escopo.visiveis, multiempresa: escopo.multi,
      nomesDasEmpresas: new Map(escopo.empresas.map(e => [e.id, e.nome])),
    });
    if (formato === 'csv') {
      // O CSV de sempre: cabeçalho na primeira linha, total no fim.
      const doc = documentoDoRelatorio(r, consulta);
      await registrarEventoAuditoria({ session: sessao, acao: 'EXPORTAR', modulo: 'Financeiro', entidade: 'relatorios_vendas', descricao: `Exportou "${r.titulo}" (CSV).` }).catch(() => undefined);
      const csv = r.relatorio === 'dinamica'
        ? csvDaMatriz([doc.colunas.map(c => c.rotulo), ...doc.linhas.map(l => doc.colunas.map(c => (c.tipo === 'dinheiro' ? Number(l[c.id] ?? 0) / 100 : String(l[c.id] ?? ''))))])
        : csvDaMatriz(matrizParaExportar(r.colunas, r.linhas));
      return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nomeDoArquivo(doc, 'csv')}"` } });
    }
    if (formato) {
      return responderExportacao(sessao, documentoDoRelatorio(r, consulta), formato, { exec, entidade: 'relatorios_vendas', direitoConferido: true, sensiveisConferidas: true });
    }
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro interno', codigo: 'ERRO' }, { status: 500 });
  }
}

import { apurarMes, gerarComissoesMrr, listarMetasMrr } from '@/lib/comissao-mrr-servidor';
import { consultarMrrVendido, upsertVendedorByExternalId } from '@/lib/crm-integration';
import { contextoDoEcossistema, respostaJson as json } from '@/lib/rota-do-ecossistema';
import { hojeISO } from '@/lib/money';
import { AVISO_COMISSAO_VEM_DO_CRM, ComissaoVemDoCrm } from '@/lib/comissao-do-crm';
import { fonteDaComissao, trocarFonteDaComissao } from '@/lib/comissao-do-crm-servidor';
import { recusaModulo } from '@/lib/guarda-rota';

export const dynamic = 'force-dynamic';

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * O painel da comissão por MRR do mês: as metas, o que o CRM diz que foi
 * vendido, a apuração (meta × realizado × faixa) e as comissões já gravadas.
 * Sem resposta do CRM, a apuração não sai: comissão nunca é calculada sobre
 * número que não veio.
 *
 * `fonte` diz de onde vem a comissão da conta: 'mrr' (padrão) são as faixas;
 * 'crm' faz a tela mostrar o aviso, esconder o "Gerar" e somar os extratos do
 * mês que chegaram do CRM (`comissoes_crm`). Quem troca é o PUT abaixo.
 */
export async function GET(req: Request) {
  const semModulo = await recusaModulo('comissoes');
  if (semModulo) return semModulo;
  try {
    const ctx = await contextoDoEcossistema('ler');
    if ('response' in ctx) return ctx.response;
    const mes = new URL(req.url).searchParams.get('mes') ?? '';
    if (!MES.test(mes)) return json({ error: 'Mês de referência inválido.' }, 400);
    const [metas, crm, gravadas, fonte, doCrm] = await Promise.all([
      listarMetasMrr(ctx.exec, ctx.tenantId, mes),
      consultarMrrVendido(ctx.tenantId, mes),
      ctx.exec.query(
        `SELECT id, status, data FROM comissoes WHERE tenant_id = $1 AND data->>'origem' = 'mrr' AND data->'mrr'->>'mes' = $2`,
        [ctx.tenantId, mes],
      ),
      fonteDaComissao(ctx.exec, ctx.tenantId),
      ctx.exec.query(
        `SELECT id, status, data->>'vendedor_nome' AS vendedor_nome, data->>'valor_comissao' AS valor_comissao
           FROM comissoes WHERE tenant_id = $1 AND data->>'origem' = 'crm' AND data->'crm'->>'competencia' = $2
          ORDER BY id`,
        [ctx.tenantId, mes],
      ),
    ]);
    const apuracao = crm.situacao === 'ok' ? await apurarMes(ctx.exec, ctx.tenantId, mes, crm.mrr.vendas) : null;
    return json({
      mes, metas, crm, apuracao,
      comissoes: gravadas.rows.map(r => ({ ...(r.data as object), id: r.id, status: r.status })),
      fonte,
      comissoes_crm: doCrm.rows.map(r => ({ id: String(r.id), status: String(r.status), vendedor_nome: String(r.vendedor_nome ?? ''), valor_comissao: Number(r.valor_comissao) || 0 })),
    });
  } catch (error) {
    console.error('[comissao-mrr] Falha ao montar:', error instanceof Error ? error.message : 'Erro');
    return json({ error: 'Não foi possível carregar a comissão por MRR.' }, 500);
  }
}

/** { acao: 'gerar', mes }: grava a comissão do mês de cada vendedor e a conta a pagar. */
export async function POST(req: Request) {
  const semModulo = await recusaModulo('comissoes');
  if (semModulo) return semModulo;
  try {
    const ctx = await contextoDoEcossistema('escrever');
    if ('response' in ctx) return ctx.response;
    let corpo: Record<string, unknown>;
    try { corpo = await req.json(); } catch { return json({ error: 'Pedido inválido.' }, 400); }
    const mes = String(corpo?.mes ?? '');
    if (corpo?.acao !== 'gerar' || !MES.test(mes)) return json({ error: 'Pedido inválido.' }, 400);
    if (mes > hojeISO().slice(0, 7)) return json({ error: 'O mês ainda não começou.' }, 400);
    // D31: com a comissão vindo do CRM, as faixas não geram comissão.
    if ((await fonteDaComissao(ctx.exec, ctx.tenantId)) === 'crm') return json({ error: AVISO_COMISSAO_VEM_DO_CRM }, 409);
    const crm = await consultarMrrVendido(ctx.tenantId, mes);
    if (crm.situacao !== 'ok') return json({ error: `Sem o MRR vendido do CRM não há comissão: ${crm.detalhe}` }, 409);

    // Vendedor do CRM sem cadastro aqui entra como cadastro pendente, igual às
    // vendas de viagem: aparece em Vendedores e planos esperando o plano.
    let apuracao = await apurarMes(ctx.exec, ctx.tenantId, mes, crm.mrr.vendas);
    if (apuracao.semCadastro.length) {
      for (const s of apuracao.semCadastro) await upsertVendedorByExternalId(s.id, { nome: s.nome, email: s.email }, ctx.tenantId);
      apuracao = await apurarMes(ctx.exec, ctx.tenantId, mes, crm.mrr.vendas);
    }
    const r = await gerarComissoesMrr(ctx.exec, ctx.tenantId, apuracao, hojeISO());
    return json(r);
  } catch (error) {
    if (error instanceof ComissaoVemDoCrm) return json({ error: error.message }, error.status);
    console.error('[comissao-mrr] Falha ao gerar:', error instanceof Error ? error.message : 'Erro');
    return json({ error: 'Não foi possível gerar a comissão por MRR.' }, 500);
  }
}

/** { fonte: 'mrr' | 'crm' }: de onde vem a comissão da conta (as faixas ou o extrato do CRM). */
export async function PUT(req: Request) {
  const semModulo = await recusaModulo('comissoes');
  if (semModulo) return semModulo;
  try {
    const ctx = await contextoDoEcossistema('escrever');
    if ('response' in ctx) return ctx.response;
    let corpo: Record<string, unknown>;
    try { corpo = await req.json(); } catch { return json({ error: 'Pedido inválido.' }, 400); }
    const fonte = corpo?.fonte;
    if (fonte !== 'mrr' && fonte !== 'crm') return json({ error: 'Pedido inválido.' }, 400);
    await trocarFonteDaComissao(ctx.exec, ctx.tenantId, fonte);
    return json({ ok: true, fonte });
  } catch (error) {
    console.error('[comissao-mrr] Falha ao trocar a fonte:', error instanceof Error ? error.message : 'Erro');
    return json({ error: 'Não foi possível trocar a fonte da comissão.' }, 500);
  }
}

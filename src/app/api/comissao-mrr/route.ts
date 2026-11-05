import { apurarMes, gerarComissoesMrr, listarMetasMrr } from '@/lib/comissao-mrr-servidor';
import { consultarMrrVendido, upsertVendedorByExternalId } from '@/lib/crm-integration';
import { contextoDoEcossistema, respostaJson as json } from '@/lib/rota-do-ecossistema';
import { hojeISO } from '@/lib/money';

export const dynamic = 'force-dynamic';

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * O painel da comissão por MRR do mês: as metas, o que o CRM diz que foi
 * vendido, a apuração (meta × realizado × faixa) e as comissões já gravadas.
 * Sem resposta do CRM, a apuração não sai: comissão nunca é calculada sobre
 * número que não veio.
 */
export async function GET(req: Request) {
  try {
    const ctx = await contextoDoEcossistema('ler');
    if ('response' in ctx) return ctx.response;
    const mes = new URL(req.url).searchParams.get('mes') ?? '';
    if (!MES.test(mes)) return json({ error: 'Mês de referência inválido.' }, 400);
    const [metas, crm, gravadas] = await Promise.all([
      listarMetasMrr(ctx.exec, ctx.tenantId, mes),
      consultarMrrVendido(ctx.tenantId, mes),
      ctx.exec.query(
        `SELECT id, status, data FROM comissoes WHERE tenant_id = $1 AND data->>'origem' = 'mrr' AND data->'mrr'->>'mes' = $2`,
        [ctx.tenantId, mes],
      ),
    ]);
    const apuracao = crm.situacao === 'ok' ? await apurarMes(ctx.exec, ctx.tenantId, mes, crm.mrr.vendas) : null;
    return json({
      mes, metas, crm, apuracao,
      comissoes: gravadas.rows.map(r => ({ ...(r.data as object), id: r.id, status: r.status })),
    });
  } catch (error) {
    console.error('[comissao-mrr] Falha ao montar:', error instanceof Error ? error.message : 'Erro');
    return json({ error: 'Não foi possível carregar a comissão por MRR.' }, 500);
  }
}

/** { acao: 'gerar', mes }: grava a comissão do mês de cada vendedor e a conta a pagar. */
export async function POST(req: Request) {
  try {
    const ctx = await contextoDoEcossistema('escrever');
    if ('response' in ctx) return ctx.response;
    let corpo: Record<string, unknown>;
    try { corpo = await req.json(); } catch { return json({ error: 'Pedido inválido.' }, 400); }
    const mes = String(corpo?.mes ?? '');
    if (corpo?.acao !== 'gerar' || !MES.test(mes)) return json({ error: 'Pedido inválido.' }, 400);
    if (mes > hojeISO().slice(0, 7)) return json({ error: 'O mês ainda não começou.' }, 400);
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
    console.error('[comissao-mrr] Falha ao gerar:', error instanceof Error ? error.message : 'Erro');
    return json({ error: 'Não foi possível gerar a comissão por MRR.' }, 500);
  }
}

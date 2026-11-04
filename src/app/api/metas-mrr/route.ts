import { apagarMetaMrr, copiarMetasDoMes, gravarMetaMrr, listarMetasMrr } from '@/lib/comissao-mrr-servidor';
import { contextoDoEcossistema, respostaJson as json } from '@/lib/rota-do-ecossistema';

export const dynamic = 'force-dynamic';

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Metas de MRR do mês (só na conta do ecossistema). */
export async function GET(req: Request) {
  try {
    const ctx = await contextoDoEcossistema('ler');
    if ('response' in ctx) return ctx.response;
    const mes = new URL(req.url).searchParams.get('mes') ?? '';
    if (!MES.test(mes)) return json({ error: 'Mês de referência inválido.' }, 400);
    return json(await listarMetasMrr(ctx.exec, ctx.tenantId, mes));
  } catch (error) {
    console.error('[metas-mrr] Falha ao listar:', error instanceof Error ? error.message : 'Erro');
    return json({ error: 'Não foi possível carregar as metas de MRR.' }, 500);
  }
}

/** { acao: 'gravar', meta } ou { acao: 'copiar', de, para }. */
export async function POST(req: Request) {
  try {
    const ctx = await contextoDoEcossistema('escrever');
    if ('response' in ctx) return ctx.response;
    let corpo: Record<string, unknown>;
    try { corpo = await req.json(); } catch { return json({ error: 'Pedido inválido.' }, 400); }
    if (corpo?.acao === 'copiar') {
      const r = await copiarMetasDoMes(ctx.exec, ctx.tenantId, String(corpo.de ?? ''), String(corpo.para ?? ''));
      return r.ok ? json(r, 201) : json({ error: r.erro }, 400);
    }
    const meta = (corpo?.meta ?? {}) as Record<string, unknown>;
    const r = await gravarMetaMrr(ctx.exec, ctx.tenantId, {
      id: meta.id, mes: meta.mes, nome: meta.nome, produtos: meta.produtos, produtos_nomes: meta.produtos_nomes, valores: meta.valores,
    });
    return r.ok ? json(r.meta, 201) : json({ error: r.erro }, 400);
  } catch (error) {
    console.error('[metas-mrr] Falha ao gravar:', error instanceof Error ? error.message : 'Erro');
    return json({ error: 'Não foi possível gravar a meta de MRR.' }, 500);
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await contextoDoEcossistema('escrever');
    if ('response' in ctx) return ctx.response;
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) return json({ error: 'Meta não informada.' }, 400);
    return (await apagarMetaMrr(ctx.exec, ctx.tenantId, id)) ? json({ ok: true }) : json({ error: 'Meta não encontrada.' }, 404);
  } catch (error) {
    console.error('[metas-mrr] Falha ao apagar:', error instanceof Error ? error.message : 'Erro');
    return json({ error: 'Não foi possível apagar a meta de MRR.' }, 500);
  }
}

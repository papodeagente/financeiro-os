import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { podeEditarFinanceiro } from '@/lib/permissoes';
import { cofreDisponivel } from '@/lib/cofre';
import { PLATAFORMAS, acharAdapter } from '@/lib/plataformas';
import { listarConfigs, salvarConfig, carregarCredenciais, ErroPlataforma } from '@/lib/plataformas/servico';

/** Configuração das plataformas. Exige permissão de financeiro: quem
 *  configura pode mudar para onde o dinheiro é lançado. */
export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });
    const session = await getSession();
    if (!podeEditarFinanceiro(session ?? {})) {
      return NextResponse.json({ error: 'Sem permissao' }, { status: 403 });
    }
    const tenantId = await getTenantId();

    const [configs, eventos] = await Promise.all([
      listarConfigs(tenantId),
      pool.query(
        `SELECT plataforma, id_externo, tipo, status, erro, created_at,
                data->>'descricao' AS descricao,
                data->>'valor_bruto' AS valor
           FROM plataformas_eventos
          WHERE tenant_id = $1
          ORDER BY created_at DESC LIMIT 40`,
        [tenantId],
      ),
    ]);

    return NextResponse.json({
      // O tenant vai na resposta porque a tela monta a URL do webhook com
      // ele, e a agência cola essa URL no painel da plataforma.
      tenantId,
      cofre_disponivel: cofreDisponivel(),
      plataformas: PLATAFORMAS,
      configs,
      eventos: eventos.rows,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await initDB();
    const session = await getSession();
    if (!podeEditarFinanceiro(session ?? {})) {
      return NextResponse.json({ error: 'Sem permissao' }, { status: 403 });
    }
    const tenantId = await getTenantId();
    const body = await req.json();
    const plataforma = String(body.plataforma ?? '');
    const adapter = acharAdapter(plataforma);
    if (!adapter) return NextResponse.json({ error: 'Plataforma desconhecida' }, { status: 400 });

    if (String(body.acao ?? '') === 'testar') {
      const conf = await carregarCredenciais(tenantId, plataforma);
      if (!conf) return NextResponse.json({ error: 'Configure a plataforma antes de testar.' }, { status: 400 });
      try {
        const r = await adapter.testarCredencial(conf.cred);
        return NextResponse.json({ ok: true, conta: r.conta });
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'A plataforma recusou a credencial.' },
          { status: 400 },
        );
      }
    }

    await salvarConfig(tenantId, plataforma, {
      ativo: body.ativo === true,
      conta_bancaria_id: String(body.conta_bancaria_id ?? ''),
      emitir_nota: body.emitir_nota === true,
      credencial: {
        api_key: String(body.api_key ?? ''),
        segredo_webhook: String(body.segredo_webhook ?? ''),
        extras: (body.extras ?? {}) as Record<string, string>,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof ErroPlataforma ? 400 : 500;
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status });
  }
}

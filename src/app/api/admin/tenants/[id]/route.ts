import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { acessoDaPlataforma } from '@/lib/plataforma-servidor';
import { TENANT_DA_PLATAFORMA } from '@/lib/plataforma';
import { registrarEventoAuditoria } from '@/lib/audit';
import { erroDoPedidoDaConta, lerPedidoDaConta, modulosDosDados, mudancasDaConta } from '@/lib/modulos';
import { esquecerModulos, liberadosDaPlataforma } from '@/lib/modulos-servidor';
import type { ExecutorSQL } from '@/lib/caixa-atomico';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Ficha da agência: super admin e CS (só leitura; editar é do super admin).
    const acesso = await acessoDaPlataforma('ver_agencias');
    if (acesso instanceof NextResponse) return acesso;

    await initDB();
    if (!pool) {
      return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
    }

    const { id } = await params;

    const { rows } = await pool.query('SELECT data FROM tenants WHERE id = $1', [id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Tenant nao encontrado' }, { status: 404 });
    }

    const tenant = rows[0].data;

    // Get stats in parallel
    const [usersRes, gruposRes, vendasRes, liberados] = await Promise.all([
      pool.query('SELECT COUNT(*) as cnt FROM usuarios WHERE tenant_id = $1', [id]),
      pool.query('SELECT COUNT(*) as cnt FROM grupos WHERE tenant_id = $1', [id]),
      pool.query('SELECT COUNT(*) as cnt FROM vendas_crm WHERE tenant_id = $1', [id]),
      liberadosDaPlataforma(pool as unknown as ExecutorSQL),
    ]);

    return NextResponse.json({
      ...tenant,
      stats: {
        userCount: parseInt(usersRes.rows[0].cnt, 10),
        grupoCount: parseInt(gruposRes.rows[0].cnt, 10),
        vendaCount: parseInt(vendasRes.rows[0].cnt, 10),
      },
      // Versão e módulos (src/lib/modulos.ts): o que vale hoje e o que está liberado para todas.
      modulos_da_conta: modulosDosDados(tenant, liberados),
      modulos_liberados: liberados,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Editar a agência é do super admin; o CS só consulta a ficha.
    const acesso = await acessoDaPlataforma('gerir_agencias');
    if (acesso instanceof NextResponse) return acesso;

    await initDB();
    if (!pool) {
      return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
    }

    const { rows } = await pool.query('SELECT data FROM tenants WHERE id = $1', [id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Tenant nao encontrado' }, { status: 404 });
    }

    const existing = rows[0].data;
    // O perfil da conta (perfil-da-conta.ts) só aceita os dois valores combinados.
    if ('perfil' in body && body.perfil !== 'agencia' && body.perfil !== 'ecossistema') {
      return NextResponse.json({ error: 'Perfil da conta inválido.' }, { status: 400 });
    }

    // Versão e módulos (14/11/2026): conferidos e normalizados antes de gravar.
    // `modulos` substitui as escolhas da agência (módulo fora da lista = padrão).
    const mexeNosModulos = 'fin_versao' in body || 'modulos' in body;
    const extra: Record<string, unknown> = {};
    if (mexeNosModulos) {
      const erro = erroDoPedidoDaConta(body);
      if (erro) return NextResponse.json({ error: erro }, { status: 400 });
      const pedido = lerPedidoDaConta({
        fin_versao: 'fin_versao' in body ? body.fin_versao : existing.fin_versao,
        modulos: 'modulos' in body ? body.modulos : existing.modulos,
      })!;
      extra.fin_versao = pedido.fin_versao;
      extra.modulos = pedido.modulos;
    }
    const updated = { ...existing, ...body, ...extra, id, updated_at: new Date().toISOString() };

    await pool.query(
      `UPDATE tenants SET
        nome = $2,
        cnpj = $3,
        plano = $4,
        status = $5,
        data = $6,
        updated_at = NOW()
       WHERE id = $1`,
      [
        id,
        updated.nome || existing.nome,
        updated.cnpj || existing.cnpj,
        updated.plano || existing.plano,
        updated.status || existing.status,
        JSON.stringify(updated),
      ]
    );

    if (mexeNosModulos) {
      // A agência passa a ver a versão nova na próxima leitura, sem esperar o cache.
      esquecerModulos(id);
      const mudou = mudancasDaConta(existing, updated);
      if (mudou.length) {
        await registrarEventoAuditoria({
          tenantId: TENANT_DA_PLATAFORMA,
          session: acesso.session,
          acao: 'EDITAR',
          modulo: 'Agências',
          entidade: 'tenants',
          entidadeId: id,
          descricao: `Versão e módulos de ${String(existing.nome ?? id)}: ${mudou.join('; ')}.`,
        });
      }
    }

    return NextResponse.json({ ok: true, tenant: updated });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

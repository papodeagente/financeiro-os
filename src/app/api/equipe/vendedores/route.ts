import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { generateId } from '@/lib/utils';
import { round2, num } from '@/lib/money';

/** Pessoa do CRM que fecha venda mas ainda nao tem membro da equipe
 *  vinculado. Enquanto estiver nesta lista, a venda dela nao gera
 *  comissao: e a fila que o Bruno resolve com um clique. */
interface UsuarioPendente {
  usuario_id: string;
  nome: string;
  email: string;
  external_id: string;
  vendas: number;
  valor_vendido: number;
  ultima_venda: string | null;
  membro_sugerido_id: string | null;
  membro_sugerido_nome: string | null;
}

export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });
    const tenantId = await getTenantId();

    const [membrosRes, pendentesRes] = await Promise.all([
      pool.query(
        `SELECT m.id, m.data, u.data AS usuario
           FROM membros m
           LEFT JOIN usuarios u
             ON u.id = m.data->>'usuario_id' AND u.tenant_id = m.tenant_id
          WHERE m.tenant_id = $1
          ORDER BY m.nome ASC`,
        [tenantId],
      ),
      // Usuario que veio do CRM, ja vendeu, e nenhum membro aponta para ele.
      // O LEFT JOIN por email sugere o casamento obvio sem efetiva-lo.
      pool.query(
        `SELECT u.id,
                u.data                                   AS usuario,
                COUNT(v.id)                              AS vendas,
                COALESCE(SUM(
                  CASE WHEN v.data->>'valor_total' ~ '^-?[0-9]+(\\.[0-9]+)?$'
                       THEN (v.data->>'valor_total')::numeric ELSE 0 END
                ), 0)                                    AS valor,
                MAX(v.data->>'data_venda')               AS ultima,
                s.id                                     AS sugerido_id,
                s.nome                                   AS sugerido_nome
           FROM usuarios u
           JOIN vendas_crm v
             ON v.vendedor_id = u.id AND v.tenant_id = u.tenant_id
           LEFT JOIN membros s
             ON s.tenant_id = u.tenant_id
            AND LOWER(TRIM(s.email)) = LOWER(TRIM(u.email))
            AND LOWER(TRIM(u.email)) <> ''
            AND COALESCE(s.data->>'usuario_id', '') = ''
          WHERE u.tenant_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM membros m
               WHERE m.tenant_id = u.tenant_id
                 AND m.data->>'usuario_id' = u.id
            )
          GROUP BY u.id, u.data, s.id, s.nome
          ORDER BY COUNT(v.id) DESC`,
        [tenantId],
      ),
    ]);

    const membros = membrosRes.rows.map(r => {
      const u = (r.usuario ?? null) as Record<string, unknown> | null;
      return {
        ...(r.data as Record<string, unknown>),
        id: r.id as string,
        // Espelho do usuario vinculado, so leitura, para a tela mostrar de
        // onde a pessoa veio sem fazer uma segunda chamada.
        crm: u
          ? { nome: String(u.nome ?? ''), email: String(u.email ?? ''), external_id: String(u.external_id ?? ''), ativo: u.ativo !== false }
          : null,
      };
    });

    const pendentes: UsuarioPendente[] = pendentesRes.rows.map(r => {
      const u = (r.usuario ?? {}) as Record<string, unknown>;
      return {
        usuario_id: r.id as string,
        nome: String(u.nome ?? ''),
        email: String(u.email ?? ''),
        external_id: String(u.external_id ?? ''),
        vendas: Number(r.vendas) || 0,
        valor_vendido: round2(num(r.valor)),
        ultima_venda: (r.ultima as string) || null,
        membro_sugerido_id: (r.sugerido_id as string) || null,
        membro_sugerido_nome: (r.sugerido_nome as string) || null,
      };
    });

    return NextResponse.json({ membros, pendentes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });
    const tenantId = await getTenantId();
    const body = await req.json();
    const acao = String(body.acao || '');

    if (acao === 'vincular') {
      const membroId = String(body.membro_id || '');
      const usuarioId = String(body.usuario_id || '');
      if (!membroId || !usuarioId) {
        return NextResponse.json({ error: 'membro_id e usuario_id são obrigatórios' }, { status: 400 });
      }

      // Um usuario nunca pode pagar comissao para dois membros.
      const dup = await pool.query(
        `SELECT id, nome FROM membros
          WHERE tenant_id = $1 AND data->>'usuario_id' = $2 AND id <> $3 LIMIT 1`,
        [tenantId, usuarioId, membroId],
      );
      if (dup.rows.length > 0) {
        return NextResponse.json(
          { error: `Este usuário do CRM já está vinculado a ${dup.rows[0].nome}. Desvincule antes de ligar a outra pessoa.` },
          { status: 409 },
        );
      }

      const upd = await pool.query(
        `UPDATE membros
            SET data = jsonb_set(data, '{usuario_id}', to_jsonb($1::text), true),
                updated_at = NOW()
          WHERE id = $2 AND tenant_id = $3`,
        [usuarioId, membroId, tenantId],
      );
      if (upd.rowCount === 0) {
        return NextResponse.json({ error: 'Membro não encontrado' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, membro_id: membroId, usuario_id: usuarioId });
    }

    if (acao === 'desvincular') {
      const membroId = String(body.membro_id || '');
      const upd = await pool.query(
        `UPDATE membros
            SET data = jsonb_set(data, '{usuario_id}', '""'::jsonb, true),
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        [membroId, tenantId],
      );
      if (upd.rowCount === 0) {
        return NextResponse.json({ error: 'Membro não encontrado' }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }

    // Cria a ficha de membro a partir do usuario do CRM, ja vinculada.
    // Continua sem plano: quem decide quanto essa pessoa ganha e o Bruno,
    // na propria tela. Sem plano, nenhuma comissao e gerada.
    if (acao === 'criar_membro') {
      const usuarioId = String(body.usuario_id || '');
      if (!usuarioId) return NextResponse.json({ error: 'usuario_id é obrigatório' }, { status: 400 });

      const dup = await pool.query(
        `SELECT id FROM membros WHERE tenant_id = $1 AND data->>'usuario_id' = $2 LIMIT 1`,
        [tenantId, usuarioId],
      );
      if (dup.rows.length > 0) {
        return NextResponse.json({ ok: true, membro_id: dup.rows[0].id, ja_existia: true });
      }

      const uRes = await pool.query(
        `SELECT data FROM usuarios WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [usuarioId, tenantId],
      );
      if (uRes.rows.length === 0) {
        return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
      }
      const u = (uRes.rows[0].data ?? {}) as Record<string, unknown>;

      const id = generateId();
      const membro = {
        id,
        nome: String(u.nome ?? ''),
        cpf: '',
        email: String(u.email ?? ''),
        telefone: '',
        cargo: 'vendedor',
        data_admissao: '',
        meta_mensal_vendas: 0,
        meta_mensal_quantidade: 0,
        plano_comissao_id: '',
        usuario_id: usuarioId,
        status: 'ATIVO' as const,
      };
      await pool.query(
        `INSERT INTO membros (id, nome, cargo, email, data, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE
            SET nome = EXCLUDED.nome, cargo = EXCLUDED.cargo,
                email = EXCLUDED.email, data = EXCLUDED.data, updated_at = NOW()
          WHERE membros.tenant_id = EXCLUDED.tenant_id`,
        [id, membro.nome, membro.cargo, membro.email, JSON.stringify(membro), tenantId],
      );
      return NextResponse.json({ ok: true, membro_id: id });
    }

    if (acao === 'definir_plano') {
      const membroId = String(body.membro_id || '');
      const planoId = String(body.plano_comissao_id ?? '');
      const upd = await pool.query(
        `UPDATE membros
            SET data = jsonb_set(data, '{plano_comissao_id}', to_jsonb($1::text), true),
                updated_at = NOW()
          WHERE id = $2 AND tenant_id = $3`,
        [planoId, membroId, tenantId],
      );
      if (upd.rowCount === 0) {
        return NextResponse.json({ error: 'Membro não encontrado' }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: `Ação desconhecida: ${acao}` }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

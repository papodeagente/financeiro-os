import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { num } from '@/lib/money';
import type { Membro, PerfilUsuario } from '@/lib/crm-types';

/** Cargo exibido a partir do perfil de acesso. O perfil manda no que a
 *  pessoa PODE fazer; quem recebe comissão é quem tem plano. */
const CARGO: Record<PerfilUsuario, string> = {
  ADMIN: 'Administrador',
  GERENTE: 'Gerente',
  OPERADOR: 'Operador',
  FINANCEIRO: 'Financeiro',
  VENDEDOR: 'Vendedor',
  VISUALIZADOR: 'Visualizador',
};

export interface MembroDaEquipe extends Membro {
  /** Ids do cadastro antigo absorvidos por esta pessoa. Venda histórica
   *  gravada com id de membro resolve por aqui. */
  membro_ids_legado: string[];
  perfil: PerfilUsuario;
  origem: string;
}

/** Órfão do cadastro antigo: existia em `membros` e não achou usuário de
 *  mesmo email. Não some calado, aparece na tela para o Bruno decidir. */
export interface OrfaoEquipe {
  id: string;
  nome: string;
  email: string;
  cargo: string;
  plano_comissao_id: string;
  meta_mensal_vendas: number;
}

export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });
    const tenantId = await getTenantId();

    const [usuariosRes, orfaosRes] = await Promise.all([
      pool.query(
        `SELECT id, nome, email, data, external_id
           FROM usuarios WHERE tenant_id = $1 ORDER BY nome ASC`,
        [tenantId],
      ),
      pool.query(
        `SELECT id, nome, email, cargo, data FROM membros m
          WHERE m.tenant_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM usuarios u
               WHERE u.tenant_id = m.tenant_id
                 AND u.data->'membro_ids_legado' ? m.id)
          ORDER BY nome ASC`,
        [tenantId],
      ),
    ]);

    const equipe: MembroDaEquipe[] = usuariosRes.rows.map(r => {
      const d = (r.data ?? {}) as Record<string, unknown>;
      const perfil = (String(d.perfil ?? 'VENDEDOR') as PerfilUsuario);
      return {
        id: r.id as string,
        nome: (r.nome as string) || String(d.nome ?? ''),
        email: (r.email as string) || String(d.email ?? ''),
        cpf: String(d.cpf ?? ''),
        telefone: String(d.telefone ?? ''),
        cargo: CARGO[perfil] ?? 'Vendedor',
        data_admissao: String(d.data_admissao ?? ''),
        meta_mensal_vendas: num(d.meta_mensal_vendas),
        meta_mensal_quantidade: num(d.meta_mensal_quantidade),
        plano_comissao_id: String(d.plano_comissao_id ?? ''),
        // Mantido por compatibilidade: agora a pessoa É o usuário.
        usuario_id: r.id as string,
        status: d.ativo === false ? 'INATIVO' : 'ATIVO',
        membro_ids_legado: Array.isArray(d.membro_ids_legado)
          ? (d.membro_ids_legado as string[])
          : [],
        perfil,
        origem: String(d.origem ?? (r.external_id ? 'crm' : 'local')),
      };
    });

    const orfaos: OrfaoEquipe[] = orfaosRes.rows.map(r => {
      const d = (r.data ?? {}) as Record<string, unknown>;
      return {
        id: r.id as string,
        nome: (r.nome as string) || String(d.nome ?? ''),
        email: (r.email as string) || String(d.email ?? ''),
        cargo: (r.cargo as string) || '',
        plano_comissao_id: String(d.plano_comissao_id ?? ''),
        meta_mensal_vendas: num(d.meta_mensal_vendas),
      };
    });

    return NextResponse.json({ equipe, orfaos });
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

    // Grava plano e metas na pessoa. Um caminho só, para a tela de
    // comissões e a de metas nunca divergirem de fonte.
    if (acao === 'definir_comercial') {
      const usuarioId = String(body.usuario_id || '');
      if (!usuarioId) return NextResponse.json({ error: 'usuario_id é obrigatório' }, { status: 400 });

      const campos: Record<string, unknown> = {};
      if (body.plano_comissao_id !== undefined) campos.plano_comissao_id = String(body.plano_comissao_id ?? '');
      if (body.meta_mensal_vendas !== undefined) campos.meta_mensal_vendas = num(body.meta_mensal_vendas);
      if (body.meta_mensal_quantidade !== undefined) campos.meta_mensal_quantidade = num(body.meta_mensal_quantidade);
      if (Object.keys(campos).length === 0) {
        return NextResponse.json({ error: 'nada a alterar' }, { status: 400 });
      }

      const upd = await pool.query(
        `UPDATE usuarios SET data = data || $1::jsonb, updated_at = NOW()
          WHERE id = $2 AND tenant_id = $3`,
        [JSON.stringify(campos), usuarioId, tenantId],
      );
      if (upd.rowCount === 0) {
        return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }

    // Descarta a ficha órfã do cadastro antigo. Não apaga: marca como
    // absorvida por ninguém, para o histórico continuar auditável.
    if (acao === 'descartar_orfao') {
      const membroId = String(body.membro_id || '');
      const upd = await pool.query(
        `UPDATE membros
            SET data = jsonb_set(data, '{descartado_em}', to_jsonb(NOW()::date::text), true),
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        [membroId, tenantId],
      );
      if (upd.rowCount === 0) return NextResponse.json({ error: 'Ficha não encontrada' }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: `Ação desconhecida: ${acao}` }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

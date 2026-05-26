import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';

// ============================================================
// Reset categorizado de dados do tenant
// ============================================================
// Cada categoria mapeia para um conjunto de tabelas que serão zeradas
// com filtro WHERE tenant_id = $1 (multi-tenant safe). Tudo roda numa
// transação — se qualquer DELETE falhar, faz ROLLBACK e o estado
// permanece inalterado.
//
// Tabelas de pessoas (clientes, fornecedores, equipe, usuarios) NUNCA
// são tocadas aqui — reset é de dados operacionais/transacionais, não
// de cadastros relacionais. Configurações da agência também são
// preservadas.

export const CATEGORIES = {
  financeiro: [
    'contas_receber',
    'contas_pagar',
    'plano_contas',
    'contas_bancarias',
    'cartoes_corp',
    'transferencias',
    'extrato_bancario',
    'cac_mensal',
    'cenarios_cac',
    'planos_comissao',
    'comissoes',
    'metas',
    'centros_custo',
    'planejamento_custos',
    'planejamento_projetos',
  ],
  produtos: [
    'grupos',
    'templates_proposta',
    'orcamentos',
    'propostas',
    'itens_venda',
    'vendas_crm',
    'destinos',
  ],
  grupos: [
    'gestao_grupos',
    'grupo_periodos_vagas',
    'grupo_reservas',
    'grupo_materiais',
    'grupo_passageiros',
    'grupo_quartos',
    'grupo_documentos',
    'grupo_tarefas',
    'grupo_eventos',
  ],
  mapas_mentais: ['mapas_mentais'],
  funis_simulacoes: ['funis_simulacoes'],
  fluxogramas: ['fluxogramas', 'fluxograma_categorias'],
} as const;

export type ResetCategory = keyof typeof CATEGORIES;

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session || !session.tenantId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    // Restringe a ADMIN do tenant (super admin também passa pelo flag).
    if (session.perfil !== 'ADMIN' && !session.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Apenas administradores podem resetar dados' },
        { status: 403 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const categories = Array.isArray(body.categories) ? (body.categories as string[]) : [];
    const confirm = typeof body.confirm === 'string' ? body.confirm : '';

    if (categories.length === 0) {
      return NextResponse.json(
        { error: 'Selecione pelo menos uma categoria pra resetar' },
        { status: 400 },
      );
    }

    if (confirm !== 'RESETAR') {
      return NextResponse.json(
        { error: 'Confirmação inválida — digite RESETAR pra prosseguir' },
        { status: 400 },
      );
    }

    // Filtra somente categorias válidas
    const validCats = categories.filter(
      (c): c is ResetCategory => Object.prototype.hasOwnProperty.call(CATEGORIES, c),
    );
    if (validCats.length === 0) {
      return NextResponse.json(
        { error: 'Nenhuma categoria válida informada' },
        { status: 400 },
      );
    }

    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });

    const tenantId = session.tenantId;
    const summary: Record<string, number> = {};
    let total = 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const cat of validCats) {
        for (const table of CATEGORIES[cat]) {
          // CRÍTICO: WHERE tenant_id = $1 obrigatório. Não tocar sem
          // o filtro — apagaria dados de outros clientes.
          const res = await client.query(
            `DELETE FROM ${table} WHERE tenant_id = $1`,
            [tenantId],
          );
          const n = res.rowCount || 0;
          summary[table] = (summary[table] || 0) + n;
          total += n;
        }
      }
      await client.query('COMMIT');
      return NextResponse.json({ ok: true, total, summary, categories: validCats });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Erro durante reset (rollback aplicado)' },
        { status: 500 },
      );
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}

// Preview: conta quantos registros existem por tabela em cada categoria
// pra mostrar o impacto antes do usuário confirmar.
export async function GET() {
  try {
    const session = await getSession();
    if (!session || !session.tenantId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    if (session.perfil !== 'ADMIN' && !session.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Apenas administradores podem ver o preview' },
        { status: 403 },
      );
    }

    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });

    const tenantId = session.tenantId;
    const counts: Record<string, number> = {};

    for (const cat of Object.keys(CATEGORIES) as ResetCategory[]) {
      let sum = 0;
      for (const table of CATEGORIES[cat]) {
        try {
          const res = await pool.query(
            `SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
            [tenantId],
          );
          sum += res.rows[0]?.n || 0;
        } catch {
          // tabela pode não existir em ambientes muito antigos — ignora
        }
      }
      counts[cat] = sum;
    }

    return NextResponse.json({ counts });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro' },
      { status: 500 },
    );
  }
}

import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json(null);
    const tenantId = await getTenantId();
    // ORDER BY explícito: sem ele, um tenant que herdou duas linhas (a
    // 'default' antiga e a do signup) recebia ora uma ora outra entre
    // requisições, e a tela de configurações piscava dados diferentes.
    const { rows } = await pool.query(
      'SELECT data FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1',
      [tenantId],
    );
    return NextResponse.json(rows.length > 0 ? rows[0].data : null);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Aceita "proposta.minhaagencia.com.br" ou "https://proposta.minhaagencia.com.br".
// Retorna o host normalizado (lowercase, sem protocolo/slashes) ou null se inválido.
function normalizeProposalDomain(raw: unknown): { ok: true; host: string | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, host: null };
  const s = String(raw).trim();
  if (!s) return { ok: true, host: null };
  // Remove protocolo e trailing slash
  const stripped = s.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  // Permite letras, dígitos, hifens e pontos. Exige pelo menos um ponto (TLD).
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(stripped)) {
    return { ok: false, error: 'Domínio inválido. Use formato tipo "proposta.minhaagencia.com.br".' };
  }
  // Bloqueia uso de hosts canônicos do sistema
  const BLOCKED = ['fin.enturos.com', 'localhost', '127.0.0.1', '0.0.0.0', 'enturos.com'];
  if (BLOCKED.includes(stripped)) {
    return { ok: false, error: `${stripped} é um domínio reservado do sistema.` };
  }
  return { ok: true, host: stripped };
}

export async function POST(req: Request) {
  try {
    await initDB();
    const data = await req.json();
    if (!pool) return NextResponse.json(data);
    const tenantId = await getTenantId();

    // Valida + normaliza dominio personalizado (1 por tenant). Sobrescreve
    // o valor no payload pra gravar sempre normalizado.
    const norm = normalizeProposalDomain(data?.custom_proposta_domain);
    if (!norm.ok) {
      return NextResponse.json({ error: norm.error }, { status: 400 });
    }
    if (norm.host) {
      // Unicidade entre tenants — UNIQUE INDEX no banco também garante
      // mas damos uma mensagem clara antes do erro de constraint.
      const { rows: dup } = await pool.query(
        `SELECT tenant_id FROM agencia
         WHERE LOWER(TRIM(BOTH '/' FROM REGEXP_REPLACE(data->>'custom_proposta_domain', '^https?://', '', 'i'))) = $1
           AND tenant_id <> $2
         LIMIT 1`,
        [norm.host, tenantId],
      );
      if (dup.length > 0) {
        return NextResponse.json(
          { error: `O domínio ${norm.host} já está em uso por outra agência.` },
          { status: 409 },
        );
      }
      data.custom_proposta_domain = norm.host;
    } else {
      data.custom_proposta_domain = '';
    }

    // O id era a constante 'default' com PK só em id: uma linha de agencia
    // para o banco inteiro. Toda tela de Configurações escrevia nela, o
    // tenant_id continuava do primeiro que salvou, e razão social, CNPJ,
    // CADASTUR e domínio de proposta vazavam entre agências.
    //
    // Reaproveitamos o id que o tenant já tem ('default' herdado, ou o
    // 'singleton-<tenant>' criado pelo signup). Gravar um id novo criaria
    // uma segunda linha para o mesmo tenant e o GET passaria a escolher
    // entre duas ao acaso.
    const { rows: atual } = await pool.query(
      `SELECT id FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
      [tenantId],
    );
    const agenciaId = atual.length > 0 ? (atual[0].id as string) : `agencia-${tenantId}`;
    // Atualiza e, se não existir, insere — em vez de ON CONFLICT. A cláusula
    // de conflito precisa casar exatamente com a chave única existente, então
    // ela amarraria esta rota ao sucesso da promoção de PK para (id, tenant_id).
    // Assim a tela salva em qualquer um dos dois estados do schema.
    const atualizado = await pool.query(
      `UPDATE agencia SET data = $3, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [agenciaId, tenantId, JSON.stringify(data)]
    );
    if ((atualizado.rowCount ?? 0) === 0) {
      await pool.query(
        `INSERT INTO agencia (id, tenant_id, data, updated_at) VALUES ($1, $2, $3, NOW())`,
        [agenciaId, tenantId, JSON.stringify(data)]
      );
    }
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    // Captura erro de unique constraint do índice expressional
    if (msg.includes('uq_agencia_custom_proposta_domain') || msg.includes('duplicate key')) {
      return NextResponse.json(
        { error: 'Esse domínio já está em uso por outra agência.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

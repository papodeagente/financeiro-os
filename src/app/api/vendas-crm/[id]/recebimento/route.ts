import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { registrarEventoAuditoria } from '@/lib/audit';
import { emTransacao, STATUS_BAIXADOS } from '@/lib/caixa-atomico';
import {
  aplicarRecebimento, lerEscolha, precisaEscolherRecebimento, type ContaDoRecebimento,
} from '@/lib/recebimento-parcelado';

/**
 * Venda parcelada no cartão ou no boleto: receber mês a mês ou antecipar
 * tudo (13/11/2026, ver src/lib/recebimento-parcelado.ts).
 *
 *   POST { modo: 'mensal', taxa_pct }
 *   POST { modo: 'antecipado', taxa_pct, data_antecipacao: 'YYYY-MM-DD' }
 *
 * Grava a escolha na venda (o reenvio do CRM a respeita) e refaz, na mesma
 * transação, as contas a receber da venda que ainda não movimentaram
 * dinheiro. Parcela já recebida fica como está e não entra na antecipação.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await getSession();
  const bloqueio = bloqueioFinanceiro(sessao, 'escrever');
  if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
  const escolha = lerEscolha(await req.json().catch(() => ({})));
  if (!escolha.ok) return NextResponse.json({ error: escolha.erro }, { status: 400 });

  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await params;
  const tenantId = await getTenantId();

  try {
    const resultado = await emTransacao(async exec => {
      const { rows } = await exec.query(
        `SELECT data FROM vendas_crm WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      const venda = rows[0]?.data as Record<string, unknown> | undefined;
      if (!venda) return { status: 404 as const, corpo: { error: 'Venda não encontrada.' } };
      if (!precisaEscolherRecebimento(venda.forma_pagamento, venda.parcelas)) {
        return { status: 400 as const, corpo: { error: 'Esta venda não é parcelada no cartão nem no boleto.' } };
      }

      const decisao = {
        ...escolha.valor,
        decidido_em: new Date().toISOString(),
        decidido_por: String(sessao?.nome || sessao?.email || ''),
      };
      await exec.query(
        `UPDATE vendas_crm SET data = jsonb_set(data, '{recebimento}', $3::jsonb, true), updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId, JSON.stringify(decisao)],
      );

      // As contas da venda que ainda não movimentaram dinheiro.
      const { rows: contas } = await exec.query(
        `SELECT id, data FROM contas_receber
          WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2
            AND COALESCE(data->>'origem', 'VENDA') = 'VENDA'
            AND NOT (COALESCE(data->>'status', '') = ANY($3::text[]))
          FOR UPDATE`,
        [tenantId, id, [...STATUS_BAIXADOS]],
      );
      const atuais = contas.map(r => ({ ...(r.data as ContaDoRecebimento), id: String(r.id) }));
      const novas = aplicarRecebimento(atuais, decisao, venda.forma_pagamento);

      if (atuais.length > 0) {
        await exec.query(`DELETE FROM contas_receber WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, atuais.map(c => c.id)]);
      }
      const clienteId = String(venda.cliente_id ?? '');
      for (const c of novas) {
        const dado = c as ContaDoRecebimento & Record<string, unknown>;
        await exec.query(
          `INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())`,
          [c.id, tenantId, id, String(dado.cliente_id ?? '') || clienteId, String(dado.status ?? 'PENDENTE'), JSON.stringify(c)],
        );
      }
      return {
        status: 200 as const,
        corpo: { ok: true, recebimento: decisao, contas: novas.length },
        resumo: escolha.valor.modo === 'antecipado'
          ? `antecipar tudo para ${escolha.valor.data_antecipacao}, taxa de ${escolha.valor.taxa_pct}%`
          : `receber mês a mês, taxa de ${escolha.valor.taxa_pct}% por parcela`,
        numero: String(venda.numero ?? id),
      };
    });

    if (resultado.status === 200 && 'resumo' in resultado) {
      await registrarEventoAuditoria({
        tenantId,
        session: sessao,
        acao: 'EDITAR',
        modulo: 'Vendas',
        entidade: 'vendas_crm',
        entidadeId: id,
        descricao: `Venda ${resultado.numero}: escolheu ${resultado.resumo}.`,
      });
    }
    return NextResponse.json(resultado.corpo, { status: resultado.status });
  } catch (e) {
    console.error('[recebimento] falhou:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível gravar a escolha. Nada foi alterado.' }, { status: 500 });
  }
}

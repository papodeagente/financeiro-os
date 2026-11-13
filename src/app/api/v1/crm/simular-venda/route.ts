import { NextRequest, NextResponse } from 'next/server';
import { getTenantId } from '@/lib/tenant';
import { processarEventoCRM } from '@/lib/crm-integration';

// Sends a mock VENDA_FECHADA payload through the real handler so we can
// validate the end-to-end flow (CR/CP creation + JSONB shape) without a
// CRM round-trip. Bypasses HMAC because it's a same-app call protected
// by session.
export async function POST(req: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const body = await req.json().catch(() => ({}));

    const stamp = Date.now();
    const payload = body.payload ?? {
      cliente_id: body.cliente_id ?? `crm_contact_test_${stamp}`,
      cliente_nome: body.cliente_nome ?? 'Cliente Teste Simulado',
      cliente_cpf: '00000000000',
      cliente_email: 'teste@example.com',
      cliente_telefone: '+5511999999999',
      vendedor_id: body.vendedor_id ?? 'crm_user_test_1',
      vendedor_nome: 'Vendedor Teste',
      vendedor_email: 'vendedor@example.com',
      crm_venda_id: body.crm_venda_id ?? `crm_deal_simulado_${stamp}`,
      entur_grupo_id: body.entur_grupo_id ?? '',
      entur_proposta_id: body.entur_proposta_id ?? '',
      valor_total: body.valor_total ?? 10000,
      moeda: 'BRL',
      custo_total: body.custo_total ?? 8000,
      comissao: body.comissao ?? 1500,
      condicoes_pagamento: body.condicoes_pagamento ?? [
        { parcela: 1, valor: 5000, vencimento: '2026-06-15', forma_pagamento: 'pix' },
        { parcela: 2, valor: 5000, vencimento: '2026-07-15', forma_pagamento: 'pix' },
      ],
      fornecedores: body.fornecedores ?? [
        {
          fornecedor_id: 'crm_supplier_test_a',
          fornecedor_nome: 'Hotel Simulado A',
          servico: 'Hospedagem 7 noites',
          valor_custo: 6000,
          vencimento_pagamento: '2026-06-15',
        },
        {
          fornecedor_id: 'crm_supplier_test_b',
          fornecedor_nome: 'Cia Aerea Simulada B',
          servico: 'Voo SP-Lisboa-SP',
          valor_custo: 2000,
          vencimento_pagamento: '2026-06-20',
        },
      ],
      _teste: true,
    };

    const idempotencyKey = body.idempotency_key ?? `simular-${stamp}-${Math.random().toString(36).slice(2, 8)}`;

    const resultado = await processarEventoCRM(
      'VENDA_FECHADA',
      payload as Record<string, unknown>,
      idempotencyKey,
      tenantId,
    );

    return NextResponse.json({
      ok: resultado.processado,
      tenant_id: tenantId,
      idempotency_key: idempotencyKey,
      acao: resultado.acao,
      erro: resultado.erro ?? null,
      payload_enviado: payload,
    }, { status: resultado.processado ? 200 : 500 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

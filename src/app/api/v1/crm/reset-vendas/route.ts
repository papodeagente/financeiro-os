import { NextResponse } from 'next/server';
import { resetarDadosVendas } from '@/lib/crm-integration';
import { getTenantId } from '@/lib/tenant';

// Apaga TODAS vendas + contas a receber/pagar + itens_venda + eventos CRM
// do tenant. PRESERVA configuração da integração, contas bancárias, cartões,
// clientes, fornecedores, grupos, propostas, metas, equipe. NÃO REVERSÍVEL.
// Exige header x-confirm-reset: SIM para evitar acidente.
export async function POST(req: Request) {
  try {
    const confirm = req.headers.get('x-confirm-reset');
    if (confirm !== 'SIM') {
      return NextResponse.json(
        { error: 'Confirmação ausente. Envie header x-confirm-reset: SIM.' },
        { status: 400 },
      );
    }
    const tenantId = await getTenantId();
    const r = await resetarDadosVendas(tenantId);
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

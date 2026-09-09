import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import {
  carregarConfigFiscal,
  carregarEmitente,
  configParaCliente,
  salvarConfigFiscal,
} from '@/lib/nfse-servico';
import type { ConfigFiscal } from '@/lib/nfse-tipos';

/**
 * Configuração fiscal da agência.
 *
 * O token do gateway NUNCA volta para o navegador: o GET devolve só os
 * últimos dígitos, e o POST com token vazio preserva o que já está gravado.
 * Sem isso, abrir a tela de configuração entregaria a chave de emissão de
 * notas para qualquer um com acesso à sessão.
 */
export async function GET() {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const tenantId = await getTenantId();
    const [config, emitente] = await Promise.all([
      carregarConfigFiscal(tenantId),
      carregarEmitente(tenantId),
    ]);
    return NextResponse.json({ config: configParaCliente(config), emitente });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const tenantId = await getTenantId();
    const recebido = (await req.json()) as Partial<ConfigFiscal>;

    const atual = await carregarConfigFiscal(tenantId);
    // O certificado só muda pela rota de upload, e o token só quando vem
    // preenchido. Salvar a tela de configuração não pode apagar nenhum dos
    // dois — a tela nunca recebeu os valores para devolver.
    const novo: ConfigFiscal = {
      ...atual,
      ...recebido,
      id: atual.id,
      token: String(recebido.token ?? '').trim() || atual.token,
      token_mascarado: undefined,
      certificado: atual.certificado,
    };
    await salvarConfigFiscal(tenantId, novo);
    return NextResponse.json({ config: configParaCliente(novo) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

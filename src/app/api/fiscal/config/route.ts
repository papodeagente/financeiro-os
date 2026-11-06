import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import {
  carregarConfigFiscal,
  configFiscalPadrao,
  carregarEmitente,
  configParaCliente,
  salvarConfigFiscal,
} from '@/lib/nfse-servico';
import type { ConfigFiscal } from '@/lib/nfse-tipos';
import { empresaDoPedido } from '@/lib/empresas-rota';

/**
 * Configuração fiscal da agência.
 *
 * O token do gateway NUNCA volta para o navegador: o GET devolve só os
 * últimos dígitos, e o POST com token vazio preserva o que já está gravado.
 * Sem isso, abrir a tela de configuração entregaria a chave de emissão de
 * notas para qualquer um com acesso à sessão.
 */
export async function GET(req: Request) {
  try {
    // Configuração fiscal por empresa (E7): ?empresa=<id>; sem ele, a de sempre.
    const { empresa: empresaFiscal, recusa: recusaEmpresa } = await empresaDoPedido(req);
    if (recusaEmpresa) return recusaEmpresa;
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const tenantId = await getTenantId();
    const [config, emitente] = await Promise.all([
      carregarConfigFiscal(tenantId, empresaFiscal),
      carregarEmitente(tenantId, empresaFiscal),
    ]);
    return NextResponse.json({ config: configParaCliente(config), emitente });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // Configuração fiscal por empresa (E7): ?empresa=<id>; sem ele, a de sempre.
    const { empresa: empresaFiscal, recusa: recusaEmpresa } = await empresaDoPedido(req);
    if (recusaEmpresa) return recusaEmpresa;
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const tenantId = await getTenantId();
    const recebido = (await req.json()) as Partial<ConfigFiscal>;

    const atual = await carregarConfigFiscal(tenantId, empresaFiscal);
    // O certificado só muda pela rota de upload, e o token só quando vem
    // preenchido. Salvar a tela de configuração não pode apagar nenhum dos
    // dois — a tela nunca recebeu os valores para devolver.
    //
    // Só entram os campos que a configuração conhece, e nunca o vínculo com
    // o emissor (empresa_id) nem o certificado (FIN2-08). O `...recebido`
    // antigo deixava gravar o empresa_id de outra agência e, no passo
    // seguinte, regenerar o token dela.
    const PROTEGIDOS = new Set(['id', 'empresa_id', 'certificado', 'token', 'token_mascarado']);
    const permitidos = new Set(Object.keys(configFiscalPadrao()));
    const filtrado: Record<string, unknown> = {};
    for (const [campo, valor] of Object.entries(recebido ?? {})) {
      if (permitidos.has(campo) && !PROTEGIDOS.has(campo)) filtrado[campo] = valor;
    }
    const novo: ConfigFiscal = {
      ...atual,
      ...(filtrado as Partial<ConfigFiscal>),
      id: atual.id,
      token: String(recebido?.token ?? '').trim() || atual.token,
      token_mascarado: undefined,
      certificado: atual.certificado,
      empresa_id: atual.empresa_id,
    };
    await salvarConfigFiscal(tenantId, novo, empresaFiscal);
    return NextResponse.json({ config: configParaCliente(novo) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

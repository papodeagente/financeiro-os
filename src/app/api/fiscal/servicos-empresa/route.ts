import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { carregarConfigFiscal, salvarConfigFiscal } from '@/lib/nfse-servico';
import { num, round2 } from '@/lib/money';
import { generateId } from '@/lib/utils';
import type { ServicoFiscalCadastrado } from '@/lib/nfse-tipos';

/** Normaliza o que chega do formulário. Serviço sem código não é serviço. */
function sanear(bruto: unknown): ServicoFiscalCadastrado[] {
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set<string>();
  const saida: ServicoFiscalCadastrado[] = [];
  for (const item of bruto) {
    const codigo = String((item as any)?.codigo_tributacao ?? '').replace(/\D+/g, '').slice(0, 6);
    const descricao = String((item as any)?.descricao ?? '').trim().slice(0, 200);
    if (!codigo || !descricao) continue;
    const id = String((item as any)?.id ?? '').trim() || generateId();
    if (vistos.has(id)) continue;
    vistos.add(id);
    const aliquota = round2(num((item as any)?.aliquota_iss));
    saida.push({
      id,
      codigo_tributacao: codigo,
      cnae: String((item as any)?.cnae ?? '').replace(/\D+/g, '').slice(0, 7),
      descricao,
      // Alíquota fora da faixa possível é erro de digitação, não escolha.
      aliquota_iss: aliquota >= 0 && aliquota <= 100 ? aliquota : 0,
      nbs: String((item as any)?.nbs ?? '').trim().slice(0, 20) || undefined,
      descricao_padrao: String((item as any)?.descricao_padrao ?? '').trim().slice(0, 500) || undefined,
    });
  }
  return saida;
}

export async function GET() {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const config = await carregarConfigFiscal(await getTenantId());
    return NextResponse.json({ servicos: config.servicos ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Grava a lista inteira. A tela envia o catálogo completo a cada salvar. */
export async function POST(req: Request) {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const tenantId = await getTenantId();
    const corpo = await req.json();
    const config = await carregarConfigFiscal(tenantId);
    const servicos = sanear(corpo?.servicos);
    await salvarConfigFiscal(tenantId, { ...config, servicos });
    return NextResponse.json({ servicos });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

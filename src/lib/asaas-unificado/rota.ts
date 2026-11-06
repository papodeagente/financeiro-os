/**
 * Conexão Asaas unificada (E7, 06/11/2026): a resposta ao pedido
 * `ASAAS_OPERACAO` do CRM, pelas mesmas rotas assinadas dos eventos
 * (/api/v1/crm/webhook[/<tenant>]). A rota já conferiu a assinatura; aqui:
 *
 * - o pedido precisa vir com carimbo de tempo (`x-crm-timestamp`, assinatura
 *   de "<carimbo>.<corpo>", janela de 5 minutos): pedido que cria cobrança não
 *   pode ser repetido por quem capturou a chamada;
 * - não passa pela caixa de eventos (é pedido com resposta na hora, como as
 *   consultas): a idempotência é a da referência do CRM no Asaas;
 * - a resposta vai assinada (`x-entur-signature`) com o mesmo segredo.
 */
import { NextResponse } from 'next/server';
import { assinarRespostaAoCrm } from '../crm-integration';
import { executarOperacaoDoCrm } from './servidor';

export async function responderOperacaoDoCrm(tenantId: string, payload: unknown, carimbo: string | null): Promise<NextResponse> {
  if (!carimbo) {
    return NextResponse.json({ ok: false, erro: 'Pedido ao Asaas sem carimbo de tempo assinado.' }, { status: 401 });
  }
  let http = 200;
  let corpo: Record<string, unknown>;
  try {
    const r = await executarOperacaoDoCrm(tenantId, payload);
    http = r.http;
    corpo = r.corpo;
  } catch (e) {
    http = 500;
    corpo = { ok: false, codigo: 'ERRO_INTERNO', erro: e instanceof Error ? e.message : 'Erro interno no Financeiro.', status: 0 };
  }
  const texto = JSON.stringify(corpo);
  const assinatura = await assinarRespostaAoCrm(tenantId, texto).catch(() => '');
  return new NextResponse(texto, {
    status: http,
    headers: { 'Content-Type': 'application/json', 'x-entur-signature': assinatura },
  });
}

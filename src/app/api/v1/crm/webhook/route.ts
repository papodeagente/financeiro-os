import { NextRequest, NextResponse } from 'next/server';
import { TIPO_ASAAS_OPERACAO } from '@/lib/asaas-unificado/regras';
import { responderOperacaoDoCrm } from '@/lib/asaas-unificado/rota';
import {
  processarEventoCRM,
  resolverTenantPorAssinaturaCRM,
  versoesDaVendaDaConta,
} from '@/lib/crm-integration';
import { temModulo } from '@/lib/modulos-servidor';

// Legacy tenant-less webhook. Kept for backward compatibility — new
// integrations must use /api/v1/crm/webhook/<tenantId>. Resolves the
// tenant by reverse-lookup of the HMAC signature against every active
// crm_config row.
export async function POST(req: NextRequest) {
  try {
    const bodyText = await req.text();
    const signature = req.headers.get('x-crm-signature') || '';

    const tenantId = await resolverTenantPorAssinaturaCRM(bodyText, signature, req.headers.get('x-crm-timestamp'));
    if (!tenantId) {
      return NextResponse.json({ error: 'Assinatura invalida' }, { status: 401 });
    }

    // JSON quebrado não melhora com nova tentativa: 400, e não 500.
    let body: { id?: string; tipo?: string; payload?: Record<string, unknown> };
    try {
      body = JSON.parse(bodyText);
    } catch {
      return NextResponse.json({ error: 'Corpo nao e JSON valido' }, { status: 400 });
    }
    const { id, tipo, payload } = body ?? {};

    // Conexão Asaas unificada (E7): o CRM pede uma operação no Asaas da
    // agência e espera a resposta na hora (não é evento, não entra na fila).
    // Só na agência com o módulo; sem ele, segue como evento comum (versão simples).
    if (tipo === TIPO_ASAAS_OPERACAO && await temModulo(tenantId, 'asaas_unificado')) {
      return responderOperacaoDoCrm(tenantId, payload, req.headers.get('x-crm-timestamp'));
    }

    if (!id || !tipo || !payload) {
      return NextResponse.json({ error: 'Campos obrigatorios: id, tipo, payload' }, { status: 400 });
    }

    const resultado = await processarEventoCRM(tipo, payload, id, tenantId);

    // O evento que responde no corpo (COMISSAO_DO_MES: criada, atualizada, já
    // existia ou recusada com o motivo; docs/integracao-crm.md) volta com o
    // corpo e o status do processamento. Os outros seguem como antes.
    if (resultado.resposta) {
      return NextResponse.json(resultado.resposta.corpo, { status: resultado.resposta.status });
    }

    // Evento que FALHOU responde 5xx: é o que faz o CRM tentar de novo com o
    // backoff dele. Antes a falha voltava 200, o CRM dava o evento por
    // entregue e a venda nunca entrava. Duplicata e tipo ignorado continuam
    // 200 (processado=true). O reprocessamento é seguro: o evento com ERRO é
    // refeito pelo mesmo caminho idempotente.
    return NextResponse.json({
      recebido: true,
      processado: resultado.processado,
      evento_id: id,
      acao: resultado.acao,
      // Versões da VENDA_FECHADA que esta agência entende (E5): o CRM passa
      // a mandar a v2 quando vê o 2 aqui (ou pela chave da empresa). O 2 só
      // com o módulo "Venda completa" (14/11/2026); sem ele, [1].
      versoes_venda: await versoesDaVendaDaConta(tenantId),
      ...(resultado.processado ? {} : { erro: resultado.erro ?? resultado.acao }),
    }, { status: resultado.processado ? 200 : 500 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ recebido: false, error: msg }, { status: 500 });
  }
}

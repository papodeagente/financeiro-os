import { NextRequest, NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { acharAdapter } from '@/lib/plataformas';
import { carregarCredenciais, processarEvento } from '@/lib/plataformas/servico';

/**
 * Webhook das plataformas de venda.
 *
 * A URL carrega a agência: cada tenant recebe um endereço próprio por
 * plataforma. Isso evita a busca reversa por assinatura, que obriga a
 * testar o segredo de todas as agências a cada aviso recebido.
 *
 * Três decisões que vêm de fila de webhook quebrada em produção:
 *
 * 1. Evento válido que não interessa responde 200. Asaas PAUSA a fila da
 *    conta depois de falhas repetidas, e aí a agência para de receber
 *    tudo, inclusive o que importa.
 * 2. Erro nosso responde 500 de propósito: é o que faz a plataforma
 *    reenviar, e a idempotência garante que reenvio não duplica.
 * 3. Recusa de autenticação responde 401 sem dizer o motivo. O motivo vai
 *    para o registro de eventos, que só a agência vê: quem forja não
 *    recebe pista de qual parte errou.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ plataforma: string; tenantId: string }> },
) {
  const { plataforma, tenantId } = await params;
  try {
    await initDB();

    const adapter = acharAdapter(plataforma);
    if (!adapter || !tenantId) {
      return NextResponse.json({ error: 'Endereço inválido' }, { status: 404 });
    }

    // Corpo CRU: assinatura se confere sobre os bytes recebidos, e
    // reserializar o JSON mudaria espaços e quebraria a conta.
    const corpoCru = await req.text();

    const cabecalhos: Record<string, string> = {};
    req.headers.forEach((v, k) => { cabecalhos[k.toLowerCase()] = v; });

    const conf = await carregarCredenciais(tenantId, plataforma);
    if (!conf || !conf.config.ativo) {
      return NextResponse.json({ error: 'Integração não habilitada' }, { status: 404 });
    }

    const verificacao = await adapter.verificar(corpoCru, cabecalhos, conf.cred);
    if (!verificacao.valido) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    let corpo: unknown;
    try {
      corpo = corpoCru ? JSON.parse(corpoCru) : {};
    } catch {
      // Corpo quebrado não melhora com reenvio: 400 encerra em vez de
      // manter a plataforma tentando para sempre.
      return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 });
    }

    const evento = await adapter.normalizar(corpo, conf.cred);
    const r = await processarEvento(tenantId, plataforma, evento);

    return NextResponse.json({ recebido: true, ...r });
  } catch (e) {
    // 500 é deliberado: a plataforma reenvia, e a chave única impede que o
    // reenvio vire segunda venda.
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ recebido: false, error: msg }, { status: 500 });
  }
}

/** A plataforma costuma validar a URL com um GET antes de salvar. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ plataforma: string; tenantId: string }> },
) {
  const { plataforma, tenantId } = await params;
  const adapter = acharAdapter(plataforma);
  if (!adapter || !tenantId) {
    return NextResponse.json({ error: 'Endereço inválido' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, plataforma: adapter.nome });
}

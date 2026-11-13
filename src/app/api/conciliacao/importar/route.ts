import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { importarExtrato, type LinhaImportada } from '@/lib/extrato-importacao';

/**
 * Importa um extrato inteiro numa única transação.
 *  - Idempotente: linha já existente na conta (FITID, ou data+valor+descrição)
 *    é ignorada, então reimportar o mesmo arquivo não duplica nada.
 *  - Atômico: falha no meio faz ROLLBACK — nunca fica importação parcial.
 *
 * Duas formas de resposta. Quem pede `Accept: application/x-ndjson` recebe o
 * andamento linha a linha (é o que a tela usa para a barra de progresso):
 *   {"fase":"conferindo","total":N}
 *   {"fase":"gravando","feitas":n,"total":N,"inseridas":i,"duplicadas":d}
 *   {"fase":"pronto","inseridas":i,"duplicadas":d,"total":N}
 *   {"fase":"erro","error":"...","gravou":false}
 * Quem não pede recebe o JSON de sempre, só no fim.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> | null;
  try {
    await initDB();
    // Extrato é dado de tesouraria: a mesma guarda das outras rotas dele.
    const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    body = await req.json();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const contaId = String(body?.conta_bancaria_id ?? '');
  const arquivoOrigem = String(body?.arquivo_origem ?? '');
  const linhas: LinhaImportada[] = Array.isArray(body?.linhas) ? (body.linhas as LinhaImportada[]) : [];

  if (!contaId) return NextResponse.json({ error: 'conta_bancaria_id é obrigatório' }, { status: 400 });
  if (linhas.length === 0) return NextResponse.json({ inseridas: 0, duplicadas: 0, total: 0 });
  if (!pool) return NextResponse.json({ inseridas: 0, duplicadas: 0, total: linhas.length });
  const db = pool;

  let tenantId: string;
  try {
    tenantId = await getTenantId();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  async function emTransacao(aoAndar?: Parameters<typeof importarExtrato>[5]) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const r = await importarExtrato(client, tenantId, contaId, arquivoOrigem, linhas, aoAndar);
      await client.query('COMMIT');
      return r;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  const querAndamento = (req.headers.get('accept') ?? '').includes('application/x-ndjson');
  if (!querAndamento) {
    try {
      return NextResponse.json(await emTransacao());
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const codificador = new TextEncoder();
  const fluxo = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Quem fechou a aba não desfaz a importação: o envio do andamento
      // falha em silêncio e a transação segue até o COMMIT.
      const enviar = (evento: Record<string, unknown>) => {
        try { controller.enqueue(codificador.encode(`${JSON.stringify(evento)}\n`)); } catch { /* conexão fechada */ }
      };
      enviar({ fase: 'conferindo', total: linhas.length });
      try {
        const r = await emTransacao(a => enviar({ fase: 'gravando', ...a }));
        enviar({ fase: 'pronto', ...r });
      } catch (e) {
        // O ROLLBACK já rodou: nada deste arquivo ficou gravado.
        enviar({ fase: 'erro', error: e instanceof Error ? e.message : 'Erro', gravou: false });
      } finally {
        try { controller.close(); } catch { /* já fechada */ }
      }
    },
  });

  return new Response(fluxo, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      // no-transform impede a compressão de segurar os pedaços até o fim,
      // e X-Accel-Buffering faz o mesmo com o proxy na frente da app.
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

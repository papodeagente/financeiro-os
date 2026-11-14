import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { ExecutorPermissoes } from '@/lib/permissoes-servidor';
import { validarDocumento } from '@/lib/exportacao/documento';
import { formatoDaConsulta } from '@/lib/exportacao/arquivo';
import { responderExportacao } from '@/lib/exportacao/servidor';
import { recusaModulo } from '@/lib/guarda-rota';

/**
 * Exportação das telas que montam o relatório no navegador (E7, G3).
 *   POST /api/exportacao  { formato: 'xlsx'|'pdf'|'imprimir'|'csv', origem: 'dre', documento: DocumentoExportado }
 * Devolve o arquivo. O servidor confere o direito "exportar", tira as colunas
 * do ganho da agência de quem não pode vê-las e registra na auditoria.
 * O documento é o que a pessoa já vê na tela (nenhum dado novo sai daqui).
 */
export const dynamic = 'force-dynamic';

const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: Request) {
  const semModulo = await recusaModulo('relatorios');
  if (semModulo) return semModulo;
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessão necessária.' }, { status: 401 });
  const tamanho = Number(req.headers.get('content-length') ?? 0);
  if (tamanho > MAX_BYTES) return NextResponse.json({ error: 'O relatório é grande demais para um arquivo. Escolha um período menor.' }, { status: 413 });
  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 }); }
  const formato = formatoDaConsulta(typeof corpo.formato === 'string' ? corpo.formato : null);
  if (!formato) return NextResponse.json({ error: 'Formato inválido.' }, { status: 400 });
  const v = validarDocumento(corpo.documento);
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 422 });
  await initDB();
  const exec = (pool ?? undefined) as unknown as ExecutorPermissoes | undefined;
  const origem = typeof corpo.origem === 'string' ? corpo.origem.replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || 'tela' : 'tela';
  return responderExportacao(sessao, v.documento, formato, { exec, entidade: origem });
}

import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { estaNoLimite, ipDaRequisicao, permitirChamada } from '@/lib/limite-publico';
import { acharLeitura } from '@/lib/relatorios-agendados/servidor';
import { bytesDoDocumento, cabecalhosDoArquivo, formatoDaConsulta } from '@/lib/exportacao/arquivo';
import { nomeDoArquivo } from '@/lib/exportacao/documento';

/**
 * Link de leitura de relatório (E7, G3), PÚBLICO: sem login, só aquele
 * relatório, na cópia de quando foi enviado. Token sorteado (o banco guarda
 * o hash), com validade e revogável. Limite por IP e por token errado; a
 * mesma resposta 404 para token inexistente, vencido ou desligado.
 *   GET /api/leitura/[token]                 { titulo, agencia, criado_em, expira_em, documento }
 *   GET /api/leitura/[token]?formato=xlsx    baixa (xlsx, pdf, imprimir)
 */
export const dynamic = 'force-dynamic';

const CABECALHOS = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive' } as const;
const NAO_ABRE = 'Este link não abre mais. Peça um link novo a quem mandou o relatório.';
const DEVAGAR = 'Muitas tentativas em pouco tempo. Espere alguns minutos e abra o link de novo.';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = ipDaRequisicao(req);
  if (estaNoLimite(`leitura-falha:${ip}`, 10)) return NextResponse.json({ error: DEVAGAR }, { status: 429, headers: CABECALHOS });
  if (!permitirChamada(`leitura-ip:${ip}`, 60, 10 * 60_000)) return NextResponse.json({ error: DEVAGAR }, { status: 429, headers: CABECALHOS });
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Indisponível no momento.' }, { status: 503, headers: CABECALHOS });
  const formato = formatoDaConsulta(new URL(req.url).searchParams.get('formato'));
  const leitura = await acharLeitura(pool as unknown as ExecutorSQL, token, new Date(), !formato);
  if (!leitura) {
    permitirChamada(`leitura-falha:${ip}`, 10, 60 * 60_000);
    return NextResponse.json({ error: NAO_ABRE }, { status: 404, headers: CABECALHOS });
  }
  if (!permitirChamada(`leitura-link:${leitura.id}`, 300, 24 * 3600_000)) return NextResponse.json({ error: DEVAGAR }, { status: 429, headers: CABECALHOS });
  if (formato && formato !== 'csv') {
    const bytes = await bytesDoDocumento(leitura.documento, formato, { agencia: leitura.agencia });
    return new Response(new Uint8Array(bytes), { headers: { ...cabecalhosDoArquivo(nomeDoArquivo(leitura.documento, formato), formato), ...CABECALHOS } });
  }
  return NextResponse.json({
    titulo: leitura.titulo, agencia: leitura.agencia, criado_em: leitura.criado_em, expira_em: leitura.expira_em, documento: leitura.documento,
  }, { headers: CABECALHOS });
}

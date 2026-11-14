// Mês em paralelo (E7, 06/11/2026): as comparações da agência. Só administrador.
//   GET  → { comparacoes: Lote[] } (a mais recente primeiro)
//   POST { mes: 'AAAA-MM', nome? } + Idempotency-Key → Lote (modo paralelo)
// Os arquivos e as colunas usam as rotas de sempre do lote
// (/api/mudanca/lotes/[id]/arquivos e /mapeamento); a comparação sai em
// GET /api/mudanca/lotes/[id]/paralelo (e /pdf). Nada disso grava no financeiro.
import { NextResponse } from 'next/server';
import { emTransacao } from '@/lib/caixa-atomico';
import { chaveDeIdempotencia, corpoJson, naRota } from '@/lib/migracao/rota';
import { criarLote, listarLotes } from '@/lib/migracao/servidor';
import { loteParaTela } from '@/lib/migracao/telas';
import { recusaModulo } from '@/lib/guarda-rota';

export const dynamic = 'force-dynamic';

export async function GET() {
  const semModulo = await recusaModulo('mudanca');
  if (semModulo) return semModulo;
  return naRota(async ({ exec, tenantId }) => {
    const lotes = await listarLotes(exec, tenantId, 'paralelo');
    const out = [];
    for (const l of lotes) out.push({ ...(await loteParaTela(exec, tenantId, l)), mes: l.opcoes.mes ?? '' });
    return NextResponse.json({ comparacoes: out });
  });
}

export async function POST(req: Request) {
  const semModulo = await recusaModulo('mudanca');
  if (semModulo) return semModulo;
  return naRota(async ({ tenantId, quem }) => {
    const corpo = await corpoJson(req);
    const chave = chaveDeIdempotencia(req);
    const lote = await emTransacao(async exec => {
      const l = await criarLote(exec, tenantId, { nome: corpo.nome, opcoes: { modo: 'paralelo', mes: corpo.mes } }, quem, chave ? `paralelo:${chave}` : null);
      return { ...(await loteParaTela(exec, tenantId, l)), mes: l.opcoes.mes ?? '' };
    });
    return NextResponse.json(lote);
  });
}

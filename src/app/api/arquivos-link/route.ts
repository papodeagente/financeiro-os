import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getCanonicalBaseUrl } from '@/lib/canonical-hosts';
import { assinarUrl, documentoPrivadoDaUrl, PRAZO_LINK_COMPARTILHADO_S } from '@/lib/arquivos';
import { donoDoArquivoPrivado, podeAbrir, type Consulta } from '@/lib/arquivos-acesso';

/**
 * Link para mandar um documento privado a quem não tem login (o passageiro,
 * um fornecedor): URL assinada que vale 90 dias. Só a agência dona do
 * documento gera (auditoria 04/11/2026, FIN-08).
 *
 * POST { url: "/api/arquivos/<nome>" } → { url: "https://.../api/arquivos/<nome>?exp=…&sig=…" }
 * Qualquer outra URL volta como veio (link externo ou imagem pública).
 */
export async function POST(req: Request) {
  try {
    const sessao = await getSession();
    if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url) return NextResponse.json({ error: 'Informe a url' }, { status: 400 });
    const nome = documentoPrivadoDaUrl(url);
    if (!nome) return NextResponse.json({ url });
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
    const dono = await donoDoArquivoPrivado(pool as unknown as Consulta, nome);
    if (!dono || !podeAbrir(sessao, dono, false)) {
      return NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 404 });
    }
    const base = getCanonicalBaseUrl().replace(/\/+$/, '');
    return NextResponse.json({ url: `${base}${assinarUrl(url, PRAZO_LINK_COMPARTILHADO_S)}`, expira_em_dias: 90 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

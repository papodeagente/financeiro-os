// Anexo livre em qualquer conta a pagar/receber (E7, frente D).
//   POST   (multipart, campo "arquivo") → { anexos, _versao }
//   DELETE ?url=/api/comprovantes/<arquivo>  → { anexos, _versao }
// Tamanho e tipo conferidos AQUI, pelo conteúdo do arquivo (nunca pelo nome
// nem pelo que o navegador diz). O arquivo vai para a pasta privada da
// agência e é servido só com sessão. Vale também para conta nascida de venda
// ou fatura (anexo não muda valor, pessoa nem vencimento).
import { NextResponse } from 'next/server';
import { unlink, writeFile } from 'fs/promises';
import path from 'path';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { recusaFinanceira, respostaPeriodoFechado } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { pastaComprovantes } from '@/lib/comprovantes';
import { generateId } from '@/lib/utils';
import { ANEXO_MAX_BYTES, conferirArquivoDoAnexo, nomeDoAnexo, type Anexo } from '@/lib/anexos-do-titulo';
import { anexarAoTitulo, ErroDoAnexo, tirarAnexoDoTitulo } from '@/lib/titulo-origem-servidor';
import { naoAchado, tabelaDoEndereco, tituloEscondido } from '@/lib/titulo-rota';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ tabela: string; id: string }> };

function falha(e: unknown) {
  if (e instanceof ErroDoAnexo) return NextResponse.json({ error: e.message }, { status: e.status });
  const fechado = respostaPeriodoFechado(e);
  if (fechado) return fechado;
  console.error('[anexos-do-titulo]', e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'Não foi possível concluir. Nada foi alterado.' }, { status: 500 });
}

export async function POST(req: Request, { params }: Params) {
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  const { tabela: t, id } = await params;
  const tabela = tabelaDoEndereco(t);
  if (!tabela) return NextResponse.json({ error: 'Tabela inválida' }, { status: 400 });
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  // Antes de ler o corpo: um arquivo enorme é recusado pelo tamanho declarado.
  const declarado = Number(req.headers.get('content-length') ?? 0);
  if (declarado > ANEXO_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: `O arquivo passa de ${ANEXO_MAX_BYTES / 1024 / 1024} MB.` }, { status: 413 });
  const tenantId = await getTenantId();
  if (await tituloEscondido(tabela, id)) return naoAchado();
  let arquivo: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get('arquivo');
    arquivo = f instanceof File ? f : null;
  } catch {
    return NextResponse.json({ error: 'Envie o arquivo no campo "arquivo".' }, { status: 400 });
  }
  if (!arquivo) return NextResponse.json({ error: 'Envie o arquivo no campo "arquivo".' }, { status: 400 });
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const { rows } = await pool.query(`SELECT jsonb_array_length(COALESCE(data->'anexos', '[]'::jsonb)) AS n FROM ${tabela} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!rows[0]) return naoAchado();
  const conferido = conferirArquivoDoAnexo(bytes, arquivo.name, Number(rows[0].n ?? 0));
  if (!conferido.ok) return NextResponse.json({ error: conferido.erro }, { status: 400 });

  const dir = await pastaComprovantes(tenantId);
  const nomeNoDisco = `anexo-${generateId()}.${conferido.ext}`;
  const caminho = path.join(dir, nomeNoDisco);
  await writeFile(caminho, Buffer.from(bytes), { flag: 'wx' });
  const sessao = await getSession();
  const anexo: Anexo = {
    nome: nomeDoAnexo(arquivo.name), url: `/api/comprovantes/${nomeNoDisco}`,
    enviado_em: new Date().toISOString(), enviado_por: sessao?.nome ?? '', tamanho: bytes.length,
  };
  try {
    return NextResponse.json(await emTransacao(exec => anexarAoTitulo(exec, tenantId, tabela, id, anexo)), { status: 201 });
  } catch (e) {
    // Nada gravado no título: o arquivo também não fica.
    await unlink(caminho).catch(() => undefined);
    return falha(e);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  const { tabela: t, id } = await params;
  const tabela = tabelaDoEndereco(t);
  if (!tabela) return NextResponse.json({ error: 'Tabela inválida' }, { status: 400 });
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const url = new URL(req.url).searchParams.get('url') ?? '';
  if (!url) return NextResponse.json({ error: 'Diga qual anexo tirar.' }, { status: 400 });
  const tenantId = await getTenantId();
  if (await tituloEscondido(tabela, id)) return naoAchado();
  try {
    return NextResponse.json(await emTransacao(exec => tirarAnexoDoTitulo(exec, tenantId, tabela, id, url)));
  } catch (e) {
    return falha(e);
  }
}

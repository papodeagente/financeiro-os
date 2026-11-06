// Mudança de sistema (E4, 05/11/2026): soltar um arquivo exportado do
// sistema anterior. Só administrador.
//   POST multipart, campo `arquivo` (um por chamada) → ArquivoDoLote
//        (+ `outras_abas` quando a planilha tem mais de uma aba com dados)
import { NextResponse } from 'next/server';
import { emTransacao } from '@/lib/caixa-atomico';
import { naRota } from '@/lib/migracao/rota';
import { adicionarArquivo, ErroMudanca, MAX_BYTES } from '@/lib/migracao/servidor';
import { arquivoParaTela } from '@/lib/migracao/telas';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return naRota(async ({ tenantId }) => {
    const { id } = await params;
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ErroMudanca('Envie o arquivo exportado do sistema anterior.', 400, 'SEM_ARQUIVO');
    }
    const arquivo = form.get('arquivo') ?? form.get('file');
    if (!(arquivo instanceof File) || arquivo.size === 0) throw new ErroMudanca('Envie o arquivo exportado do sistema anterior.', 400, 'SEM_ARQUIVO');
    if (arquivo.size > MAX_BYTES) throw new ErroMudanca('O arquivo passa de 15 MB. Exporte em partes (um arquivo por mês).', 413, 'ARQUIVO_GRANDE');
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const lidos = await emTransacao(exec => adicionarArquivo(exec, tenantId, id, arquivo.name || 'arquivo', bytes));
    const [primeiro, ...outros] = lidos.map(arquivoParaTela);
    return NextResponse.json({ ...primeiro, ...(outros.length ? { outras_abas: outros } : {}) });
  });
}

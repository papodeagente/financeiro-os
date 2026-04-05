import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { generateId } from '@/lib/utils';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

// Persistent volume mounted at /app/data by Coolify
const UPLOAD_DIR_PROD = '/app/data/uploads';

async function getUploadDir(): Promise<string> {
  if (process.env.NODE_ENV !== 'production') {
    const dir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(dir, { recursive: true });
    return dir;
  }
  await mkdir(UPLOAD_DIR_PROD, { recursive: true });
  return UPLOAD_DIR_PROD;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    }

    const UPLOAD_DIR = await getUploadDir();

    const results: { url: string; nome: string; tamanho: number }[] = [];

    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json({ error: `Tipo nao permitido: ${file.type}` }, { status: 400 });
      }
      if (file.size > MAX_SIZE) {
        return NextResponse.json({ error: `Arquivo muito grande: ${file.name} (max 10MB)` }, { status: 400 });
      }

      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `${generateId()}.${ext}`;
      const filePath = path.join(UPLOAD_DIR, fileName);
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(filePath, buffer);

      results.push({
        url: `/api/uploads/${fileName}`,
        nome: file.name,
        tamanho: file.size,
      });
    }

    return NextResponse.json(results);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro no upload' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { generateId } from '@/lib/utils';

const MAX_SIZE = 15 * 1024 * 1024; // 15MB per image
const MAX_BATCH = 24;
const FETCH_TIMEOUT_MS = 15000;
const UPLOAD_DIR_PROD = '/app/data/uploads';

const EXT_BY_CT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

async function getUploadDir(): Promise<string> {
  if (process.env.NODE_ENV !== 'production') {
    const dir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(dir, { recursive: true });
    return dir;
  }
  await mkdir(UPLOAD_DIR_PROD, { recursive: true });
  return UPLOAD_DIR_PROD;
}

async function downloadOne(url: string, dir: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TravelBot/1.0)',
        'Accept': 'image/*,*/*;q=0.8',
        'Referer': '',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const ct = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
    const ext = EXT_BY_CT[ct] || 'jpg';

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_SIZE) return null;

    const fileName = `${generateId()}.${ext}`;
    await writeFile(path.join(dir, fileName), buf);
    return `/api/uploads/${fileName}`;
  } catch {
    return null;
  }
}

/**
 * POST /api/import-images
 * Body: { urls: string[] }
 * Response: { urls: (string | null)[] }
 *
 * Downloads each remote image to local storage and returns the local URL
 * in the same order. Items that fail download return null so the client
 * can keep the original URL or skip it.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const inputUrls: unknown = body.urls;
    if (!Array.isArray(inputUrls) || inputUrls.length === 0) {
      return NextResponse.json({ urls: [] });
    }

    const valid = inputUrls
      .filter((u): u is string => typeof u === 'string' && u.length > 0)
      .slice(0, MAX_BATCH);

    if (valid.length === 0) return NextResponse.json({ urls: [] });

    const dir = await getUploadDir();

    // Skip URLs that are already local
    const results = await Promise.all(
      valid.map(async (u) => {
        if (u.startsWith('/api/uploads/') || u.startsWith('/uploads/')) return u;
        return downloadOne(u, dir);
      })
    );

    return NextResponse.json({ urls: results });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao importar imagens' },
      { status: 500 }
    );
  }
}

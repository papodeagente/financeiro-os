import { NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import path from 'path';

// Persistent volume at /app/data/uploads in production
const UPLOAD_DIRS = process.env.NODE_ENV === 'production'
  ? ['/app/data/uploads']
  : [path.join(process.cwd(), 'public', 'uploads')];

const MIME_TYPES: Record<string, string> = {
  // imagens
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  // documentos
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // texto
  txt: 'text/plain',
  csv: 'text/csv',
  // compactados
  zip: 'application/zip',
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;

    // Sanitize: only allow alphanumeric, hyphens, dots
    if (!/^[\w\-]+\.\w+$/.test(filename)) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }

    for (const dir of UPLOAD_DIRS) {
      const filePath = path.join(dir, filename);

      // Prevent path traversal
      if (!filePath.startsWith(dir)) continue;

      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) continue;

        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const buffer = await readFile(filePath);

        return new NextResponse(buffer, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Content-Length': String(buffer.length),
          },
        });
      } catch {
        continue;
      }
    }

    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}

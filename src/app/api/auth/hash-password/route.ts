import { NextResponse } from 'next/server';
import { hashPassword, getSession } from '@/lib/auth';

export async function POST(req: Request) {
  // Only authenticated admins can hash passwords
  const session = await getSession();
  if (!session || session.perfil !== 'ADMIN') {
    return NextResponse.json({ error: 'Nao autorizado' }, { status: 403 });
  }

  const { password } = await req.json();
  if (!password || password.length < 6) {
    return NextResponse.json({ error: 'Senha deve ter no minimo 6 caracteres' }, { status: 400 });
  }

  const hash = await hashPassword(password);
  return NextResponse.json({ hash });
}

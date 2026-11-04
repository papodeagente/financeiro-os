import { responderUsuarios, lerCorpo } from '@/lib/usuarios-rota';
import { lerUsuario, atualizarUsuario, excluirUsuario } from '@/lib/usuarios-servico';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return responderUsuarios((db, sessao, tenantId) => lerUsuario(db, sessao, tenantId, id));
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  return responderUsuarios(async (db, sessao, tenantId) =>
    atualizarUsuario(db, sessao, tenantId, id, await lerCorpo(req)));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return responderUsuarios((db, sessao, tenantId) => excluirUsuario(db, sessao, tenantId, id));
}

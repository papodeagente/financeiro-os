import { responderUsuarios, lerCorpo } from '@/lib/usuarios-rota';
import { listarUsuarios, criarUsuario } from '@/lib/usuarios-servico';

export async function GET() {
  return responderUsuarios((db, sessao, tenantId) => listarUsuarios(db, sessao, tenantId));
}

export async function POST(req: Request) {
  return responderUsuarios(async (db, sessao, tenantId) => criarUsuario(db, sessao, tenantId, await lerCorpo(req)));
}

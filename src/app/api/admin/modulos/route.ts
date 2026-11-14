import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { acessoDaPlataforma } from '@/lib/plataforma-servidor';
import { TENANT_DA_PLATAFORMA } from '@/lib/plataforma';
import { registrarEventoAuditoria } from '@/lib/audit';
import {
  MODULOS, agenciasQueMudam, ehModulo, liberadosCom, liberadosParaTodas, moduloLigado, modulosDosDados, nomesDasDependencias,
  type ModuloId,
} from '@/lib/modulos';
import { esquecerModulos } from '@/lib/modulos-servidor';

/**
 * Módulos da versão completa na plataforma (14/11/2026).
 *   GET  → cada módulo com o resumo, as dependências, se está liberado para
 *          todas, quantas agências têm hoje e quantas mudam ao liberar/retirar.
 *          Super admin e CS (só leitura).
 *   POST { modulo, liberar: boolean } → grava saas_config 'modulos_liberados'.
 *          Só super admin. A exceção de cada agência (ficha) continua valendo.
 */
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

async function lerEstado() {
  const [{ rows: config }, { rows: contas }] = await Promise.all([
    pool!.query(`SELECT data FROM saas_config WHERE key = 'modulos_liberados' LIMIT 1`),
    pool!.query(`SELECT id, data FROM tenants`),
  ]);
  const liberados = liberadosParaTodas(config[0]?.data);
  const datas = contas.map(r => r.data);
  const modulos = MODULOS.map(m => ({
    id: m.id,
    nome: m.nome,
    resumo: m.resumo,
    depende: nomesDasDependencias(m.id),
    liberado: liberados.includes(m.id),
    agencias_com: datas.filter(d => moduloLigado(modulosDosDados(d, liberados), m.id)).length,
    mudam_se_liberar: agenciasQueMudam(datas, liberados, liberadosCom(liberados, m.id, true), m.id),
    mudam_se_retirar: agenciasQueMudam(datas, liberados, liberadosCom(liberados, m.id, false), m.id),
  }));
  return { liberados, total_agencias: datas.length, modulos };
}

export async function GET() {
  const acesso = await acessoDaPlataforma('ver_agencias');
  if (acesso instanceof NextResponse) return acesso;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco de dados indisponível.' }, { status: 503, headers: HEADERS });
  return NextResponse.json({ ...(await lerEstado()), pode_editar: acesso.papel === 'SUPER_ADMIN' }, { headers: HEADERS });
}

export async function POST(req: Request) {
  const acesso = await acessoDaPlataforma('gerir_agencias');
  if (acesso instanceof NextResponse) return acesso;
  const corpo = (await req.json().catch(() => null)) as { modulo?: unknown; liberar?: unknown } | null;
  if (!corpo || !ehModulo(corpo.modulo) || typeof corpo.liberar !== 'boolean') {
    return NextResponse.json({ error: 'Diga o módulo e se libera ou retira.' }, { status: 400, headers: HEADERS });
  }
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco de dados indisponível.' }, { status: 503, headers: HEADERS });
  const id = corpo.modulo as ModuloId;
  const antes = await lerEstado();
  const depois = liberadosCom(antes.liberados, id, corpo.liberar);
  const item = antes.modulos.find(m => m.id === id)!;
  const mudam = corpo.liberar ? item.mudam_se_liberar : item.mudam_se_retirar;
  await pool.query(
    `INSERT INTO saas_config (key, data) VALUES ('modulos_liberados', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET data = $1::jsonb, updated_at = NOW()`,
    [JSON.stringify({ modulos: depois })],
  );
  // Todas as agências leem a liberação nova na próxima chamada, sem esperar o cache.
  esquecerModulos();
  await registrarEventoAuditoria({
    tenantId: TENANT_DA_PLATAFORMA,
    session: acesso.session,
    acao: 'EDITAR',
    modulo: 'Agências',
    entidade: 'saas_config',
    entidadeId: 'modulos_liberados',
    descricao: `${corpo.liberar ? 'Liberou para todas' : 'Retirou de todas'}: ${item.nome} (${mudam} ${mudam === 1 ? 'agência mudou' : 'agências mudaram'}).`,
  });
  return NextResponse.json({ ...(await lerEstado()), pode_editar: true, mudaram: mudam }, { headers: HEADERS });
}

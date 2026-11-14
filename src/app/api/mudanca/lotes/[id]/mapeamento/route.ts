// Mudança de sistema (E4, 05/11/2026): conferir o mapeamento coluna → campo.
// Só administrador.
//   GET → { arquivos: MapeamentoDoArquivo[] }
//   PUT { arquivo_id, tipo_lista, colunas: [{ indice, campo|null }], movimento?: 'pagar'|'receber'|null }
//       → MapeamentoDoArquivo. Salvar com todos os obrigatórios ligados CONFIRMA o arquivo.
import { NextResponse } from 'next/server';
import { emTransacao } from '@/lib/caixa-atomico';
import { corpoJson, naRota } from '@/lib/migracao/rota';
import { atualizarArquivo, ErroMudanca, listarArquivos } from '@/lib/migracao/servidor';
import { mapeamentoDoPedido, mapeamentoParaTela } from '@/lib/migracao/telas';
import { recusaModulo } from '@/lib/guarda-rota';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('mudanca');
  if (semModulo) return semModulo;
  return naRota(async ({ exec, tenantId }) => {
    const { id } = await params;
    return NextResponse.json({ arquivos: (await listarArquivos(exec, tenantId, id)).map(mapeamentoParaTela) });
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('mudanca');
  if (semModulo) return semModulo;
  return naRota(async ({ tenantId }) => {
    const { id } = await params;
    const corpo = await corpoJson(req);
    const arquivoId = typeof corpo.arquivo_id === 'string' ? corpo.arquivo_id : '';
    if (!arquivoId) throw new ErroMudanca('Diga qual arquivo.', 400, 'FORMATO_INVALIDO');
    const mapeamento = mapeamentoDoPedido(corpo.colunas);
    if (!mapeamento) throw new ErroMudanca('Cada campo pode ser ligado a uma coluna só.', 400, 'MAPEAMENTO_INVALIDO');
    const a = await emTransacao(async exec => {
      const salvo = await atualizarArquivo(exec, tenantId, id, arquivoId, {
        ...(corpo.tipo_lista !== undefined ? { lista: corpo.tipo_lista } : {}),
        mapeamento,
        ...(corpo.movimento !== undefined ? { opcoes: { movimento: corpo.movimento } } : {}),
      });
      return salvo.faltando.length ? salvo : atualizarArquivo(exec, tenantId, id, arquivoId, { confirmar: true });
    });
    return NextResponse.json(mapeamentoParaTela(a));
  });
}

/**
 * Uma série de recorrência (05/11/2026).
 * GET: a série e os títulos dela.
 * PUT: altera títulos em aberto e sem baixa. Corpo:
 *   { modo: 'previa' | 'gravar', escopo: 'so_esta' | 'esta_e_proximas' | 'todas',
 *     titulo_id, alteracoes, versao? }. Título pago ou com baixa parcial nunca muda.
 * DELETE ?a_partir_de=AAAA-MM-DD&previa=1: encerra a repetição e exclui só os
 *   títulos em aberto, sem baixa, com vencimento a partir da data (padrão: hoje).
 *   Sem previa=1 exige o perfil que exclui, como a exclusão de uma conta.
 */
import { ehDataValida } from '@/lib/recorrencia';
import { ehPrevia, lerCorpo, rodarRota } from '@/lib/recorrencia-rota';
import {
  carregarSerie, editarSerieNoExecutor, encerrarSerieNoExecutor, ErroRecorrencia, resumoDaSerie, titulosDaSerie,
  type PedidoDeEdicao,
} from '@/lib/recorrencia-servidor';

type Contexto = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Contexto) {
  return rodarRota('ler', async ({ tenantId, tx }) => {
    const { id } = await params;
    return tx(async exec => {
      const s = await carregarSerie(exec, tenantId, id);
      if (!s) throw new ErroRecorrencia('Repetição não encontrada.', 404);
      const titulos = await titulosDaSerie(exec, s.tabela, tenantId, s.id);
      return {
        serie: resumoDaSerie(s),
        titulos: titulos.map(t => ({
          id: t.id, ordem: Number(t.data.serie_ordem ?? 0), vencimento: String(t.data.data_vencimento ?? ''),
          valor: Number(t.data.valor_final ?? 0), status: String(t.data.status ?? ''), descricao: String(t.data.descricao ?? ''),
        })),
      };
    });
  });
}

export async function PUT(req: Request, { params }: Contexto) {
  return rodarRota('escrever', async ({ tenantId, tx }) => {
    const { id } = await params;
    const corpo = await lerCorpo(req);
    const pedido: PedidoDeEdicao = {
      escopo: corpo.escopo as PedidoDeEdicao['escopo'],
      titulo_id: String(corpo.titulo_id ?? ''),
      alteracoes: (corpo.alteracoes ?? {}) as Record<string, unknown>,
      versao: corpo.versao === undefined || corpo.versao === null ? undefined : Number(corpo.versao),
      previa: ehPrevia(corpo),
    };
    return tx(exec => editarSerieNoExecutor(exec, tenantId, id, pedido));
  });
}

export async function DELETE(req: Request, { params }: Contexto) {
  const url = new URL(req.url);
  const previa = url.searchParams.get('previa') === '1';
  return rodarRota(previa ? 'escrever' : 'excluir', async ({ tenantId, hoje, tx }) => {
    const { id } = await params;
    const pedida = url.searchParams.get('a_partir_de') ?? '';
    const aPartirDe = ehDataValida(pedida) ? pedida : hoje;
    return tx(exec => encerrarSerieNoExecutor(exec, tenantId, id, { aPartirDe, previa }));
  });
}

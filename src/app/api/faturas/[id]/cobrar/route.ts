import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { gravarEmissao, hojeEmBrasilia, previaDaEmissao, type PedidoDeEmissao } from '@/lib/cobranca/servidor';
import { cobrancaParaTela, gravacaoParaTela } from '@/lib/cobranca/rota';
import { ehProvedorCobranca, type TipoEmissao } from '@/lib/cobranca/tipos';
import { carregarFatura, desfazerFechamento, fecharFatura, registrarEventoDaFatura, ErroFatura } from '@/lib/fatura-servidor';
import { chaveDeIdempotencia, lerJson, montarFichaDaFatura, respostaDeErroDaFatura, usuarioDaFatura } from '@/lib/fatura-rota';

// "Fechar e cobrar": fecha a fatura (se aberta) e emite o boleto+Pix da conta
// da fatura pelo provedor da agência (E3). Idempotency-Key: repetir o mesmo
// pedido devolve a mesma cobrança. Sem a chave, a conta com cobrança valendo
// recusa a segunda (nunca cobra em dobro).
export const dynamic = 'force-dynamic';

const TIPOS: TipoEmissao[] = ['boleto_pix', 'boleto', 'pix'];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusaFechar = await recusaAcao('fechar_fatura');
  if (recusaFechar) return recusaFechar;
  const recusa = await recusaAcao('gerar_boletos');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await ctx.params;
  const corpo = (await lerJson<{ provedor?: string; tipo?: string }>(req)) ?? {};
  const sessao = await getSession();
  const tenantId = await getTenantId();
  const usuario = usuarioDaFatura(sessao);
  const exec = pool as unknown as ExecutorSQL;
  // Se a fatura foi fechada AGORA e a cobrança não sair, ela volta a ficar aberta (com o motivo no histórico).
  let fechouAgora = false;
  const desfazer = async (motivo: string) => {
    if (!fechouAgora) return;
    await emTransacao(e => desfazerFechamento(e, tenantId, id, motivo, usuario)).catch(() => false);
  };
  try {
    const antes = await carregarFatura(exec, tenantId, id);
    fechouAgora = antes?.situacao === 'ABERTA';
    await emTransacao(e => fecharFatura(e, tenantId, id, { usuario }));
    const f = await carregarFatura(exec, tenantId, id);
    if (!f?.titulo_id) throw new ErroFatura('NAO_ACHOU', 'Fatura não encontrada.', 404);
    const pedido: PedidoDeEmissao = {
      itens: [{ conta_id: f.titulo_id }],
      provedor: ehProvedorCobranca(corpo.provedor) ? corpo.provedor : undefined,
      tipo: TIPOS.includes(corpo.tipo as TipoEmissao) ? (corpo.tipo as TipoEmissao) : undefined,
      descricao: `Fatura Nº ${f.numero}`,
    };
    const idempotencia = chaveDeIdempotencia(req);
    // A conta bancária onde a baixa vai cair precisa estar liberada para quem cobra.
    const previa = await previaDaEmissao(exec, tenantId, pedido, hojeEmBrasilia());
    const recusaConta = await recusaAcao('gerar_boletos', { contaBancariaId: previa.conta_bancaria_id });
    if (recusaConta) { await desfazer('a conta bancária da cobrança não está liberada para quem pediu.'); return recusaConta; }
    const r = await gravarEmissao(tenantId, pedido, { quem: { usuarioId: usuario.id, usuarioNome: usuario.nome }, idempotencia });
    const valendo = r.cobrancas.find(c => ['emitindo', 'aberta', 'vencida', 'paga'].includes(c.status));
    if (!valendo) await desfazer(r.cobrancas[0]?.erro || r.puladas[0]?.motivo || 'o provedor não emitiu.');
    if (!r.repetido && valendo) {
      await registrarEventoDaFatura(exec, tenantId, id, 'cobranca_emitida', { usuario, detalhe: { cobranca_id: valendo.id, tipo: valendo.tipo, status: valendo.status } });
    }
    return NextResponse.json({
      ficha: await montarFichaDaFatura(exec, tenantId, id, sessao),
      cobranca: r.cobrancas[0] ? cobrancaParaTela(r.cobrancas[0]) : null,
      emissao: gravacaoParaTela(r),
    });
  } catch (e) {
    await desfazer(e instanceof Error ? e.message : 'erro ao emitir.');
    return respostaDeErroDaFatura(e);
  }
}

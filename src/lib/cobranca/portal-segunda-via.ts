/**
 * 2ª via pedida pelo próprio cliente no portal (E7, 06/11/2026).
 *
 * Quando o boleto venceu e o provedor NÃO dá o link que já cobra o valor
 * atualizado, o cliente gera a 2ª via sozinho, sem esperar a agência. O
 * caminho é o MESMO da 2ª via da tela (`alterarCobranca`): onde o provedor
 * altera, altera; onde não altera, cancela e emite outra ligada à anterior.
 *
 * Regras:
 *   · só a cobrança viva de uma conta do MESMO cliente e da MESMA agência do
 *     link; só quando `segundaViaPossivel` diz que há 2ª via (vencida, sem o
 *     link atualizado do provedor, nunca link de pagamento);
 *   · valor = o do documento + juros e multa da política da agência até o
 *     novo vencimento (o próximo dia útil), a mesma conta da liquidação;
 *     juros e multa ficam guardados na cobrança para a baixa entrar com eles
 *     separados (aviso.ts);
 *   · idempotente: a cobrança é "reservada" para o dia antes de ir ao
 *     provedor (duplo clique, duas abas: uma só 2ª via); se o provedor falha,
 *     a reserva é desfeita e o cliente pode tentar de novo;
 *   · limite por link: até `SEGUNDAS_VIAS_POR_LINK_POR_DIA` em 24 horas
 *     (um link vazado não vira gerador de boletos);
 *   · "nada sai" (mudança de sistema) vale: `alterarCobranca` recusa.
 *
 * Testado em scripts/test-sql-portal-e7b.mjs.
 */
import type { ExecutorSQL } from '../caixa-atomico';
import { paraCentavos } from '../money';
import { ErroCobranca } from './tipos';
import { segundaViaPossivel, type SegundaViaNoPortal } from './portal-regras';
import { encargosDoPortal, type LinkAtivo } from './portal-servidor';
import { alterarCobranca, carregarCobranca, registrarEvento, type LinhaCobranca } from './servidor';
import { contaReceberDoTenant } from './recibo-servidor';

export const SEGUNDAS_VIAS_POR_LINK_POR_DIA = 3;
export const QUEM_PELO_PORTAL = 'Cliente pelo portal';

export interface ResultadoDaSegundaVia {
  /** true: gerada agora; false: já pedida hoje (devolve a que vale). */
  gerada: boolean;
  vencimento: string;
  valor: number;
}

async function cobrancaVivaDaConta(exec: ExecutorSQL, tenantId: string, contaId: string): Promise<LinhaCobranca | null> {
  const { rows } = await exec.query(
    `SELECT id FROM cobrancas WHERE tenant_id = $1 AND titulo_tabela = 'contas_receber' AND titulo_id = $2
        AND status IN ('emitindo','aberta','vencida') ORDER BY criado_em DESC LIMIT 1`,
    [tenantId, contaId],
  );
  return rows.length ? carregarCobranca(exec, tenantId, String(rows[0].id)) : null;
}

async function segundasViasDoLink(exec: ExecutorSQL, link: LinkAtivo): Promise<number> {
  const { rows } = await exec.query(
    `SELECT COUNT(*)::int AS n FROM cobranca_eventos
      WHERE tenant_id = $1 AND tipo = 'segunda_via_portal' AND detalhe->>'link_id' = $2 AND criado_em > NOW() - INTERVAL '24 hours'`,
    [link.tenant_id, link.id],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Gera a 2ª via de uma conta do cliente do link. `exec` é o pool (a 2ª via
 * chama o provedor fora de transação, como na tela).
 */
export async function segundaViaPeloPortal(
  exec: ExecutorSQL, link: LinkAtivo, contaRef: unknown, hoje: string,
): Promise<ResultadoDaSegundaVia> {
  if (typeof contaRef !== 'string' || !contaRef || contaRef.length > 100) throw new ErroCobranca('Conta não encontrada.', 404);
  const conta = await contaReceberDoTenant(exec, link.tenant_id, contaRef);
  if (!conta || conta.cliente_id !== link.cliente_id || String(conta.data.origem ?? '') === 'COMISSAO_FORNECEDOR') {
    throw new ErroCobranca('Conta não encontrada.', 404);
  }
  const c = await cobrancaVivaDaConta(exec, link.tenant_id, conta.id);
  if (!c) throw new ErroCobranca('Esta conta não tem boleto para atualizar. Fale com a agência.', 409, 'SEM_SEGUNDA_VIA');

  // Já pedida hoje pelo portal (e já trocada): devolve a que vale, sem gerar outra.
  if (c.dados?.portal_2via === hoje && c.vencimento >= hoje) {
    return { gerada: false, vencimento: c.vencimento, valor: c.valor_centavos / 100 };
  }
  const plano: SegundaViaNoPortal | null = segundaViaPossivel(
    { tipo: c.tipo, status: c.status, valor_centavos: c.valor_centavos, vencimento: c.vencimento, url_fatura: c.url_fatura || null },
    hoje, await encargosDoPortal(exec, link.tenant_id),
  );
  if (!plano) throw new ErroCobranca('Este boleto ainda vale ou já tem o link para pagar com o valor atualizado.', 409, 'SEM_SEGUNDA_VIA');
  if (await segundasViasDoLink(exec, link) >= SEGUNDAS_VIAS_POR_LINK_POR_DIA) {
    throw new ErroCobranca('Muitas 2ª vias pedidas hoje por este link. Fale com a agência.', 429, 'LIMITE_DO_PORTAL');
  }

  // Reserva do dia: só um pedido passa (duplo clique, duas abas).
  const { rows: reservou } = await exec.query(
    `UPDATE cobrancas SET dados = dados || jsonb_build_object('portal_2via', $3::text), atualizado_em = NOW()
      WHERE tenant_id = $1 AND id = $2 AND status IN ('aberta','vencida') AND COALESCE(dados->>'portal_2via', '') <> $3
      RETURNING id`,
    [link.tenant_id, c.id, hoje],
  );
  if (!reservou.length) {
    const atual = await cobrancaVivaDaConta(exec, link.tenant_id, conta.id);
    return { gerada: false, vencimento: atual?.vencimento ?? c.vencimento, valor: (atual?.valor_centavos ?? c.valor_centavos) / 100 };
  }

  const quem = { usuarioNome: QUEM_PELO_PORTAL };
  let nova: LinhaCobranca;
  try {
    nova = await alterarCobranca(link.tenant_id, c.id, { vencimento: plano.vencimento, valor_centavos: paraCentavos(plano.valor) }, { quem, hoje });
  } catch (e) {
    // Desfaz a reserva: o cliente (ou a agência) pode tentar de novo.
    await exec.query(
      `UPDATE cobrancas SET dados = dados - 'portal_2via' WHERE tenant_id = $1 AND id = $2 AND dados->>'portal_2via' = $3`,
      [link.tenant_id, c.id, hoje],
    ).catch(() => undefined);
    throw e;
  }
  const encargos = { juros_centavos: paraCentavos(plano.juros), multa_centavos: paraCentavos(plano.multa), base_centavos: c.valor_centavos };
  await exec.query(
    `UPDATE cobrancas SET dados = dados || jsonb_build_object('portal_2via', $3::text, 'encargos_segunda_via', $4::jsonb), atualizado_em = NOW()
      WHERE tenant_id = $1 AND id = $2`,
    [link.tenant_id, nova.id, hoje, JSON.stringify(encargos)],
  );
  await registrarEvento(exec, link.tenant_id, nova.id, 'segunda_via_portal', c.status, nova.status, {
    link_id: link.id, de: c.id, vencimento: plano.vencimento, valor: plano.valor, juros: plano.juros, multa: plano.multa,
  }, quem);
  return { gerada: true, vencimento: nova.vencimento, valor: nova.valor_centavos / 100 };
}

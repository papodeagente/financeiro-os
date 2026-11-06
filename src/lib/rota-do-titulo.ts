/**
 * Rotas de UMA conta a pagar ou a receber (GET, PUT, DELETE e Restaurar),
 * iguais para as duas tabelas (06/11/2026, E7). Antes eram dois arquivos
 * copiados; o comportamento de cada passo é o mesmo de antes, mais:
 *   - GET devolve `_versao` (aviso de edição simultânea);
 *   - PUT recusa com 409 a versão velha (`conflito: true`) e a mudança de
 *     pessoa, valor ou vencimento de conta nascida de venda (`venda_id`);
 *   - DELETE é exclusão lógica (a conta vai para Excluídas, com o mesmo
 *     estorno de caixa de sempre) e pode devolver `aviso`;
 *   - POST .../restaurar traz a conta de volta, em aberto.
 *
 * PUT detecta a transição de status para sincronizar o saldo (ver
 * src/lib/baixa-de-conta.ts): baixa move o caixa na conta escolhida; desfazer
 * estorna na conta que pagou/recebeu (a gravada, nunca a do pedido); trocar a
 * conta de uma baixa devolve na antiga e move na nova. Duplo clique move uma
 * vez só (linha travada).
 */
import { NextResponse } from 'next/server';
import pool, { initDB } from './db';
import { getTenantId } from './tenant';
import { getSession } from './auth';
import { recusaFinanceira, recusaExclusao, respostaPeriodoFechado } from './guarda-rota';
import { emTransacao, ErroMovimentoCaixa, type ExecutorSQL } from './caixa-atomico';
import { editarConta, ErroEdicaoConta } from './baixa-de-conta';
import { prepararDimensoesDaConta } from './dimensoes';
import { conferirEdicaoDoTitulo, type SessaoDaBaixa } from './baixas-porteiro';
import { SQL_VERSAO } from './versao-do-registro';
import { sanearCamposPersonalizadosDoItem } from './campos-personalizados';
import { conferirEmissaoDaConta } from './lancamento-titulo';
import { ErroDaLixeira, excluirTitulo, lerExcluida, restaurarTitulo, type TabelaDoTitulo } from './contas-excluidas';
import { tituloGeradoPeloSistema } from './recorrencia';
import { pode } from './permissoes-servidor';
import { escopoDaSessao, tituloForaDasEmpresas, type ExecutorEmpresas } from './empresas-servidor';
import { empresasDoRegistro } from './empresas';

type Params = { params: Promise<{ id: string }> };

const NAO_ACHADO = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

/** Título de empresa não liberada para a pessoa (E7, várias empresas): como se não existisse. */
async function foraDasEmpresas(tabela: TabelaDoTitulo, id: string): Promise<boolean> {
  if (!pool) return false;
  return tituloForaDasEmpresas(pool as unknown as ExecutorEmpresas, await getSession(), tabela, id);
}

const COLUNAS: Record<TabelaDoTitulo, string[]> = {
  contas_pagar: ['fornecedor_id', 'status'],
  contas_receber: ['venda_id', 'cliente_id', 'status'],
};

function erroGenerico(e: unknown) {
  const fechado = respostaPeriodoFechado(e);
  if (fechado) return fechado;
  const msg = e instanceof Error ? e.message : 'Erro';
  return NextResponse.json({ error: msg }, { status: 500 });
}

/**
 * Confere e arruma o título antes de gravar pelo POST (cadastro) — o mesmo
 * que o PUT confere: rateio, campos personalizados e emissão.
 */
export function validarCadastroDoTitulo(tabela: TabelaDoTitulo) {
  return (item: Record<string, unknown>): string | null =>
    sanearCamposPersonalizadosDoItem(item) ?? prepararDimensoesDaConta(item) ?? conferirEmissaoDaConta(tabela, item);
}

export function rotasDoTitulo(tabela: TabelaDoTitulo) {
  const campo = tabela === 'contas_receber' ? 'valor_recebido' : 'valor_pago';
  const sinal = tabela === 'contas_receber' ? 1 : -1;

  async function GET(_req: Request, { params }: Params) {
    try {
      const recusa = await recusaFinanceira('ler');
      if (recusa) return recusa;
      await initDB();
      const { id } = await params;
      if (!pool) return NextResponse.json(null);
      const tenantId = await getTenantId();
      if (await foraDasEmpresas(tabela, id)) return NAO_ACHADO();
      const { rows } = await pool.query(`SELECT data, ${SQL_VERSAO} AS v FROM ${tabela} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
      if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ ...(rows[0].data as Record<string, unknown>), _versao: String(rows[0].v ?? '') });
    } catch (e) {
      return erroGenerico(e);
    }
  }

  async function PUT(req: Request, { params }: Params) {
    try {
      const recusa = await recusaFinanceira('escrever');
      if (recusa) return recusa;
      await initDB();
      const { id } = await params;
      const item = await req.json();
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return NextResponse.json({ error: 'Formato inválido' }, { status: 400 });
      }
      // Campos personalizados e rateio conferidos antes de tudo (05-06/11/2026).
      const invalido = sanearCamposPersonalizadosDoItem(item as Record<string, unknown>)
        ?? prepararDimensoesDaConta(item as Record<string, unknown>);
      if (invalido) return NextResponse.json({ error: invalido }, { status: 400 });
      if (!pool) return NextResponse.json(item);
      const tenantId = await getTenantId();
      if (await foraDasEmpresas(tabela, id)) return NAO_ACHADO();
      // Perfis de acesso (05/11/2026): baixa pela edição segue as mesmas regras da liquidação.
      const barrado = await conferirEdicaoDoTitulo(
        pool as unknown as ExecutorSQL, ((await getSession()) ?? {}) as SessaoDaBaixa, tenantId, tabela, id, item as Record<string, unknown>);
      if (barrado) return NextResponse.json({ error: barrado.message, ...(barrado.pedir ? { pedir_aprovacao: barrado.pedir } : {}) }, { status: barrado.status });
      const gravado = await editarConta({
        tabela, colunasIndice: COLUNAS[tabela], campo, sinal, id, tenantId, item: item as Record<string, unknown>,
      });
      return NextResponse.json(gravado);
    } catch (e) {
      if (e instanceof ErroEdicaoConta) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
      if (e instanceof ErroMovimentoCaixa) return NextResponse.json({ error: e.message }, { status: e.status });
      return erroGenerico(e);
    }
  }

  // Exclusão lógica: o que já foi pago/recebido volta para a conta bancária
  // que pagou/recebeu, como sempre. O DELETE ... RETURNING garante que dois
  // DELETEs concorrentes estornem uma vez só (o segundo não acha a linha).
  async function DELETE(_req: Request, { params }: Params) {
    try {
      const recusa = (await recusaExclusao()) ?? (await recusaFinanceira('escrever'));
      if (recusa) return recusa;
      await initDB();
      const { id } = await params;
      if (!pool) return NextResponse.json({ ok: true });
      const tenantId = await getTenantId();
      if (await foraDasEmpresas(tabela, id)) return NAO_ACHADO();
      const sessao = await getSession();
      const r = await emTransacao(exec => excluirTitulo(exec, tenantId, tabela, id, { id: sessao?.userId, nome: sessao?.nome }));
      return NextResponse.json(r?.aviso ? { ok: true, aviso: r.aviso } : { ok: true });
    } catch (e) {
      return erroGenerico(e);
    }
  }

  // Restaurar: o mesmo perfil que exclui. Conta nascida de venda ou fatura
  // pede também "Excluir lançamento ligado a venda ou fatura" (como no lote).
  async function RESTAURAR(_req: Request, { params }: Params) {
    try {
      const recusa = (await recusaExclusao()) ?? (await recusaFinanceira('escrever'));
      if (recusa) return recusa;
      await initDB();
      const { id } = await params;
      if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
      const tenantId = await getTenantId();
      const sessao = await getSession();
      const excluida = await lerExcluida(pool as unknown as ExecutorSQL, tenantId, tabela, id);
      if (!excluida) return NextResponse.json({ error: 'Esta conta não está entre as excluídas. Recarregue a lista.' }, { status: 404 });
      // Várias empresas (E7): conta de empresa não liberada para a pessoa não se restaura.
      if (sessao) {
        const escopo = await escopoDaSessao(sessao, pool as unknown as ExecutorEmpresas);
        if (escopo.multi && escopo.permitidas !== null && !empresasDoRegistro(excluida.data).some(e => escopo.permitidas!.includes(e))) {
          return NextResponse.json({ error: 'Esta conta não está entre as excluídas. Recarregue a lista.' }, { status: 404 });
        }
      }
      if (tituloGeradoPeloSistema(tabela, excluida.data) && !(await pode(sessao, 'excluir_com_vinculo'))) {
        return NextResponse.json({ error: 'Esta conta nasceu de uma venda ou fatura, e seu acesso não inclui excluir ou restaurar lançamento ligado a venda ou fatura.' }, { status: 403 });
      }
      const r = await emTransacao(exec => restaurarTitulo(exec, tenantId, tabela, id));
      return NextResponse.json(r.aviso ? { ok: true, aviso: r.aviso } : { ok: true });
    } catch (e) {
      if (e instanceof ErroDaLixeira) return NextResponse.json({ error: e.message }, { status: e.status });
      return erroGenerico(e);
    }
  }

  return { GET, PUT, DELETE, RESTAURAR };
}

/**
 * O pagamento de uma cobrança virando baixa (E7, 06/11/2026): a parte que é
 * comum ao aviso do provedor (aviso.ts) e à pendência resolvida por uma
 * pessoa (rota /api/cobrancas/[id]/pendencia).
 *
 * - `itensDoPagamento`: o que entrou vira a baixa da conta da cobrança e,
 *   quando o boleto levou a taxa de boleto do cliente, a baixa de uma conta
 *   própria da taxa (taxa-boleto.ts explica o efeito no resultado).
 * - `planoDaPendenciaNoBanco` / `resolverPendencia`: as 3 escolhas da
 *   pendência (pendencia.ts), com o porteiro de baixas de sempre.
 * - `avisarPendencia`: o aviso no sino, uma vez por cobrança e evento.
 */
import pool from '../db';
import { emTransacao, type ExecutorSQL } from '../caixa-atomico';
import { registrarBaixas, tituloParaBaixa, type ContextoBaixa, type ItemBaixa, type ResultadoItem } from '../baixas-servidor';
import { saldoDoTitulo } from '../baixa-calculo';
// O porteiro entra só aqui (import dinâmico): o aviso do provedor não precisa dele, e os testes
// que leem o aviso rodam sem compilar (o porteiro usa sintaxe que o Node não lê sozinho).
import type { SessaoDaBaixa } from '../baixas-porteiro';
import { dataForaDoFechamento } from '../periodo-fechado';
import { categoriasDosEncargos, garantirCategoriasDeEncargos } from '../encargos-servidor';
import { deCentavos, round2 } from '../money';
import { criarNotificacao } from '../notificacoes';
import { idDaContaDaTaxa } from './taxa-boleto';
import {
  conferirMotivo, planejarPendencia, type ContaDaPendencia, type EscolhaDaPendencia, type PagamentoDaPendencia, type PlanoDaPendencia,
} from './pendencia';
import {
  COLUNAS_DA_COBRANCA, hojeEmBrasilia, lerLinha, marcarNaConta, nomeDoProvedor, registrarEvento,
  type LinhaCobranca, type QuemFez,
} from './servidor';
import { ErroCobranca } from './tipos';

const txt = (v: unknown) => String(v ?? '').trim();

/** Uma conta a receber nova, no formato JSONB de sempre (valores em reais). */
async function novaContaAReceber(
  exec: ExecutorSQL, tenantId: string, id: string,
  campos: { descricao: string; valor: number; data: string; cliente_id: string; cliente_nome: string; origem: string; categoria_id: string; observacoes: string; extra?: Record<string, unknown> },
): Promise<void> {
  const conta = {
    id, descricao: campos.descricao, valor_original: campos.valor, valor_final: campos.valor, juros: 0, multa: 0, desconto: 0,
    data_emissao: campos.data, data_vencimento: campos.data, status: 'PENDENTE', categoria_id: campos.categoria_id, centro_custo: '',
    rateio: [], anexos: [], observacoes: campos.observacoes, origem: campos.origem, venda_id: null, grupo_id: null, auto_gerado: true,
    parcela_numero: 1, total_parcelas: 1, conta_bancaria_id: null, cliente_id: campos.cliente_id, cliente_nome: campos.cliente_nome,
    fornecedor_id: '', fornecedor_nome: '', data_recebimento: null, valor_recebido: null, forma_recebimento: '', taxa: 0, taxa_plataforma: '',
    boleto_emitido: false, boleto_codigo: '', boleto_url: '', ...(campos.extra ?? {}),
  };
  await exec.query(
    `INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data, created_at, updated_at)
     VALUES ($1, $2, '', $3, 'PENDENTE', $4::jsonb, NOW(), NOW())`,
    [id, tenantId, campos.cliente_id, JSON.stringify(conta)],
  );
}

async function dadosDaConta(exec: ExecutorSQL, tenantId: string, id: string): Promise<Record<string, unknown> | null> {
  const { rows } = await exec.query(`SELECT data FROM contas_receber WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return rows.length ? ((rows[0].data ?? {}) as Record<string, unknown>) : null;
}

/** A conta da taxa de boleto desta cobrança (cria na primeira vez; id fixo). */
export async function garantirContaDaTaxa(exec: ExecutorSQL, tenantId: string, c: LinhaCobranca, taxaCentavos: number, data: string): Promise<string> {
  const id = idDaContaDaTaxa(c.id);
  if (await dadosDaConta(exec, tenantId, id)) return id;
  const conta = await dadosDaConta(exec, tenantId, c.titulo_id);
  const categorias = await categoriasDosEncargos(exec, tenantId).catch(() => ({} as Record<string, string>));
  await novaContaAReceber(exec, tenantId, id, {
    descricao: `Taxa de boleto · ${txt(conta?.descricao) || c.descricao || 'cobrança'}`.slice(0, 200),
    valor: deCentavos(taxaCentavos), data, cliente_id: c.cliente_id ?? txt(conta?.cliente_id), cliente_nome: txt(conta?.cliente_nome),
    origem: 'OUTROS', categoria_id: (categorias as Record<string, string>).taxas ?? '',
    observacoes: 'Taxa de boleto repassada ao cliente (Configurações › Cobrança). Paga junto com o boleto.',
    extra: { taxa_boleto_de: c.id, conta_da_cobranca_id: c.titulo_id },
  });
  return id;
}

/** Conta que recebe o pagamento que chegou sem conta em aberto (vira crédito do cliente). */
async function contaDoPagamentoSemConta(exec: ExecutorSQL, tenantId: string, c: LinhaCobranca, valorCentavos: number, data: string): Promise<string> {
  const id = `credito-cobranca-${c.id}`;
  if (await dadosDaConta(exec, tenantId, id)) return id;
  const conta = await dadosDaConta(exec, tenantId, c.titulo_id);
  await novaContaAReceber(exec, tenantId, id, {
    descricao: `Pagamento recebido sem conta em aberto · ${txt(conta?.descricao) || c.descricao || 'cobrança'}`.slice(0, 200),
    valor: deCentavos(valorCentavos), data, cliente_id: c.cliente_id ?? txt(conta?.cliente_id), cliente_nome: txt(conta?.cliente_nome),
    // Não é receita: é dinheiro do cliente guardado como crédito.
    origem: 'CREDITO_CLIENTE', categoria_id: '',
    observacoes: 'O cliente pagou a cobrança depois que a conta já estava fechada. O valor ficou como crédito dele.',
    extra: { credito_da_cobranca: c.id, conta_da_cobranca_id: c.titulo_id },
  });
  return id;
}

/**
 * Os itens da baixa de um pagamento: a conta da cobrança (`principal`) e,
 * quando há, a conta da taxa de boleto. Valores em centavos na entrada.
 */
export async function itensDoPagamento(
  exec: ExecutorSQL, tenantId: string, c: LinhaCobranca,
  p: { tituloPrincipal?: string; contaCentavos: number; taxaBoletoCentavos: number; taxaProvedorCentavos: number; juros: number; multa?: number; desconto: number; data: string; conta_bancaria_id: string | null; forma: string; tratamento?: ItemBaixa['tratamento_diferenca'] },
): Promise<ItemBaixa[]> {
  const nome = nomeDoProvedor(c.provedor);
  const taxa = deCentavos(p.taxaProvedorCentavos);
  const itens: ItemBaixa[] = [{
    titulo_tabela: 'contas_receber', titulo_id: p.tituloPrincipal ?? c.titulo_id, data: p.data, conta_bancaria_id: p.conta_bancaria_id,
    forma: p.forma, valor: deCentavos(p.contaCentavos), juros: round2(p.juros), ...(p.multa ? { multa: round2(p.multa) } : {}), desconto: round2(p.desconto), taxa,
    taxa_plataforma: taxa > 0 ? c.provedor : undefined, observacao: `Recebido pelo ${nome} (cobrança ${c.id}).`,
    ...(p.tratamento ? { tratamento_diferenca: p.tratamento } : {}),
  }];
  if (p.taxaBoletoCentavos > 0) {
    const idTaxa = await garantirContaDaTaxa(exec, tenantId, c, p.taxaBoletoCentavos, p.data);
    itens.push({
      titulo_tabela: 'contas_receber', titulo_id: idTaxa, data: p.data, conta_bancaria_id: p.conta_bancaria_id, forma: p.forma,
      valor: deCentavos(p.taxaBoletoCentavos), observacao: `Taxa de boleto paga junto com a cobrança ${c.id}.`,
    });
  }
  return itens;
}

/** Depois de criar a conta da taxa: categoria de taxa de cobrança garantida (fora da transação do aviso). */
export async function completarCategoriaDaTaxa(tenantId: string, cobrancaId: string): Promise<void> {
  if (!pool) return;
  const mapa = await emTransacao(tx => garantirCategoriasDeEncargos(tx, tenantId));
  if (!mapa.taxas) return;
  await (pool as unknown as ExecutorSQL).query(
    `UPDATE contas_receber SET data = jsonb_set(data, '{categoria_id}', to_jsonb($3::text), true), updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2 AND COALESCE(data->>'categoria_id', '') = ''`,
    [tenantId, idDaContaDaTaxa(cobrancaId), mapa.taxas],
  );
}

/** Aviso no sino: uma vez por cobrança e evento (repetir o aviso do provedor não repete o sino). */
export async function avisarPendencia(tenantId: string, c: LinhaCobranca, pendencia: string, evento: string): Promise<void> {
  await criarNotificacao({
    tenantId, tipo: 'COBRANCA_PENDENCIA',
    titulo: 'Pagamento que não baixou sozinho',
    descricao: `${c.descricao || 'Cobrança'}: ${pendencia}`,
    link: `/financeiro-ag/cobrancas?pendencia=1&abrir=${encodeURIComponent(c.id)}`,
    data: { cobranca_id: c.id, conta_id: c.titulo_id },
    chaveDeduplicacao: `cobranca-pendencia:${c.id}:${evento}`,
  });
}

// ---------------------------------------------------------------------------
// Pendência: plano e resolução

async function contaDaPendencia(exec: ExecutorSQL, tenantId: string, c: LinhaCobranca): Promise<ContaDaPendencia | null> {
  const d = await dadosDaConta(exec, tenantId, c.titulo_id);
  if (!d) return null;
  const status = txt(d.status) || 'PENDENTE';
  return { status, saldo: saldoDoTitulo(tituloParaBaixa('contas_receber', d)), cliente_id: txt(d.cliente_id) || txt(c.cliente_id) };
}

export interface PendenciaNaTela extends PlanoDaPendencia {
  cobranca_id: string;
  pendencia: string;
  conta: ContaDaPendencia | null;
}

export async function planoDaPendenciaNoBanco(exec: ExecutorSQL, tenantId: string, id: string): Promise<PendenciaNaTela> {
  const { rows } = await exec.query(`SELECT ${COLUNAS_DA_COBRANCA} FROM cobrancas WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!rows.length) throw new ErroCobranca('Cobrança não encontrada.', 404);
  const c = lerLinha(rows[0]);
  const pendencia = txt(c.dados.pendencia);
  if (!pendencia) throw new ErroCobranca('Esta cobrança não tem pendência.', 409);
  const conta = await contaDaPendencia(exec, tenantId, c);
  return { cobranca_id: c.id, pendencia, conta, ...planejarPendencia(c, conta) };
}

export interface ResultadoDaPendencia {
  escolha: EscolhaDaPendencia;
  cobranca_id: string;
  baixa_id: string | null;
  credito_id: string | null;
  repetido?: boolean;
}

/**
 * Resolve a pendência numa transação: lança o que a escolha pede (baixa pelo
 * porteiro, crédito na carteira), tira a marca e grava no histórico. Repetir
 * com a mesma chave devolve o que foi feito.
 */
export async function resolverPendencia(
  tenantId: string, id: string, pedido: { escolha: EscolhaDaPendencia; motivo?: string },
  o: { sessao: SessaoDaBaixa; quem: QuemFez; idempotencia?: string; hoje?: string },
): Promise<ResultadoDaPendencia> {
  const escolha = pedido.escolha;
  if (escolha !== 'corrigir' && escolha !== 'credito' && escolha !== 'ignorar') throw new ErroCobranca('Escolha corrigir, crédito ou resolvida.');
  const faltaMotivo = conferirMotivo(escolha, pedido.motivo);
  if (faltaMotivo) throw new ErroCobranca(faltaMotivo);
  const motivo = txt(pedido.motivo).slice(0, 500);
  const chave = o.idempotencia?.slice(0, 150);

  return emTransacao(async exec => {
    const { rows } = await exec.query(`SELECT ${COLUNAS_DA_COBRANCA} FROM cobrancas WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
    if (!rows.length) throw new ErroCobranca('Cobrança não encontrada.', 404);
    const c = lerLinha(rows[0]);
    const resolvida = (c.dados.pendencia_resolvida ?? null) as Record<string, unknown> | null;
    if (!txt(c.dados.pendencia)) {
      if (chave && resolvida && resolvida.idempotencia === chave) {
        return { escolha, cobranca_id: c.id, baixa_id: (resolvida.baixa_id as string) ?? null, credito_id: (resolvida.credito_id as string) ?? null, repetido: true };
      }
      throw new ErroCobranca('Esta pendência já foi resolvida.', 409);
    }
    const conta = await contaDaPendencia(exec, tenantId, c);
    const plano = planejarPendencia(c, conta);
    const opcao = plano.escolhas[escolha];
    if (!opcao.pode) throw new ErroCobranca(opcao.frase, 409);

    let baixaId: string | null = null;
    let creditoId: string | null = null;
    if (escolha !== 'ignorar') {
      const p = plano.pagamento as PagamentoDaPendencia;
      const contaBancaria = p.conta_bancaria_id || c.conta_bancaria_id || null;
      const data = await dataForaDoFechamento(exec, tenantId, contaBancaria, p.data || o.hoje || hojeEmBrasilia());
      const semConta = escolha === 'credito' && !plano.conta_aberta;
      const principal = semConta ? await contaDoPagamentoSemConta(exec, tenantId, c, plano.divisao.conta, data) : c.titulo_id;
      const itens = await itensDoPagamento(exec, tenantId, c, {
        tituloPrincipal: principal, contaCentavos: plano.divisao.conta, taxaBoletoCentavos: plano.divisao.taxa_boleto,
        taxaProvedorCentavos: p.taxa_centavos, juros: semConta ? 0 : p.juros, desconto: semConta ? 0 : p.desconto, data,
        conta_bancaria_id: contaBancaria, forma: p.forma, tratamento: escolha === 'credito' && !semConta ? 'credito' : undefined,
      });
      const ctx: ContextoBaixa = {
        tenantId, usuarioId: o.quem.usuarioId ?? undefined, usuarioNome: o.quem.usuarioNome ?? undefined, origem: 'tela',
        idempotencia: `cobranca-pendencia:${c.id}`,
      };
      const previa = await registrarBaixas(exec, ctx, itens, { gravar: false });
      const erros = previa.itens.flatMap(i => i.plano.erros);
      if (erros.length) throw new ErroCobranca(erros[0], 409);
      const { conferirBaixa } = await import('../baixas-porteiro');
      await conferirBaixa(exec, o.sessao, tenantId, itens, previa.itens as ResultadoItem[]);
      const r = await registrarBaixas(exec, ctx, itens, { gravar: true });
      baixaId = r.itens[0]?.baixa_id ?? null;
      if (semConta) {
        const { criarCredito } = await import('../credito-cliente-servidor');
        const d = await dadosDaConta(exec, tenantId, c.titulo_id);
        const cr = await criarCredito(exec, tenantId, {
          cliente_id: conta?.cliente_id || txt(c.cliente_id), cliente_nome: txt(d?.cliente_nome),
          origem: 'SOBRA_DE_PAGAMENTO', valor_centavos: plano.divisao.conta,
          descricao: `Pagamento da cobrança depois da conta fechada · ${txt(d?.descricao) || c.descricao}`.slice(0, 300),
          origem_venda_id: txt(d?.origem_venda_id) || txt(d?.venda_id), origem_ref: `cobranca:${c.id}`,
        }, o.quem.usuarioNome || o.quem.usuarioId || '');
        creditoId = cr.id;
      } else if (escolha === 'credito' && baixaId) {
        const { rows: cr } = await exec.query(
          `SELECT id FROM creditos_cliente WHERE tenant_id = $1 AND origem = 'SOBRA_DE_PAGAMENTO' AND origem_ref = $2`, [tenantId, `baixa:${baixaId}`],
        );
        creditoId = cr[0] ? String(cr[0].id) : null;
      }
    }

    const marca = {
      escolha, motivo, por: o.quem.usuarioNome ?? null, em: new Date().toISOString(), pendencia: txt(c.dados.pendencia),
      baixa_id: baixaId, credito_id: creditoId, ...(chave ? { idempotencia: chave } : {}),
    };
    const { rows: novas } = await exec.query(
      `UPDATE cobrancas SET dados = (dados - 'pendencia') || jsonb_build_object('pendencia_resolvida', $3::jsonb),
              baixa_id = COALESCE($4, baixa_id), atualizado_em = NOW()
        WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUNAS_DA_COBRANCA}`,
      [tenantId, c.id, JSON.stringify(marca), escolha === 'corrigir' || (escolha === 'credito' && plano.conta_aberta) ? baixaId : null],
    );
    const nova = lerLinha(novas[0]);
    const tipoEvento = escolha === 'corrigir' ? 'pendencia_baixa' : escolha === 'credito' ? 'pendencia_credito' : 'pendencia_resolvida';
    await registrarEvento(exec, tenantId, c.id, tipoEvento, c.status, nova.status, { ...marca }, o.quem);
    await marcarNaConta(exec, nova);
    return { escolha, cobranca_id: c.id, baixa_id: baixaId, credito_id: creditoId };
  });
}

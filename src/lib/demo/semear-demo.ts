/**
 * Dados de demonstração (14/11/2026) da agência de teste do Fernando.
 *
 * Só roda em agência com `tenants.data.demo = true`: qualquer outra é
 * recusada antes de qualquer leitura de dados. Usa as PRÓPRIAS funções do
 * sistema (venda, liquidação, cancelamento, fatura, comissões, notas...); só
 * os cadastros que no sistema não têm função de servidor (conta bancária,
 * cartão, cliente, fornecedor, transferência) seguem o mesmo SQL e as mesmas
 * validações das rotas deles.
 *
 * Datas relativas a hoje: três meses de histórico e três à frente. Nada sai
 * (./saidas.ts): sem CRM, sem emissor de nota; cobrança só pelo Asaas em
 * sandbox, quando a chave estiver cadastrada.
 *
 * Idempotente: com os dados já criados, "criar" não faz nada. "Apagar" tira
 * tudo o que é da agência de demonstração (menos o administrador, o cadastro
 * da agência e a chave do Asaas) e "criar" de novo recomeça do zero.
 */
import { createHash } from 'node:crypto';
import pool from '../db';
import { emTransacao, aplicarMovimentoCaixaAtomico, type ExecutorSQL } from '../caixa-atomico';
import { hojeISO, addDias } from '../money';
import { generateId } from '../utils';
import { esquecerDemo } from './saidas';
import { cnpjComDigitos, cpfComDigitos, CNPJ_DA_FILIAL, EMAIL_DA_DEMO } from './agencia-demo';
import { aplicarAssistente } from '../assistente-inicial-servidor';
import { salvarEmpresa } from '../empresas-servidor';
import { salvarMoedaDaAgencia, lerCatalogoDaAgencia } from '../moedas-servidor';
import { conferirMoedaDoCadastro } from '../moedas';
import { normalizarDadosDaConta } from '../contas-bancarias-dados';
import { abrirRazaoNoExecutor, garantirAberturaDaConta } from '../razao-servidor';
import { salvarCentro, salvarRegra as salvarRegraDeRateio } from '../centros-custo-servidor';
import { salvarAcordo, salvarRegraDoFornecedor, aplicarAcordosDaAgencia, gerarFatura, itensAFaturar } from '../fornecedor-servidor';
import { salvarRegra as salvarRegraDeFaturamento, fecharFatura } from '../fatura-servidor';
import { criarUsuario } from '../usuarios-servico';
import { salvarGrupo } from '../permissoes-servidor';
import { prepararSerie, criarSerieNoExecutor } from '../recorrencia-servidor';
import { registrarBaixas, type ItemBaixa } from '../baixas-servidor';
import { fecharPeriodo } from '../periodo-fechado';
import { normalizarVenda, totaisDaVenda, type Venda } from '../venda-modelo';
import { salvarVenda } from '../venda-servidor';
import { executarCancelamento } from '../cancelamento-servidor';
import { criarConferencia } from '../conferencia-operadora-servidor';
import { registrarNotaEmitidaFora } from '../nota-externa';
import { salvarRegra as salvarRegraDaNota } from '../nota-regras-servidor';
import { regraSugerida } from '../nota-regras';
import {
  salvarConfigComissao, salvarPlano, salvarFuncao, salvarGradeDeMetas, fecharComissoes, pagarComissoes,
} from '../comissao-funcoes-servidor';
import { emitirChequeDoTitulo } from '../cheques-servidor';
import { salvarAgendamento } from '../relatorios-agendados/servidor';
import { validarAgendamento } from '../relatorios-agendados/regras';
import { salvarAlcadas, pedirAprovacaoDoPagamento } from '../aprovacoes-servidor';
import { criarLote, adicionarArquivo, atualizarArquivo, ensaiarLote } from '../migracao/servidor';
import { carregarCredenciais } from '../plataformas/servico';
import { chaveDeSandboxDoAsaas } from './saidas';
import { lerConfigCobranca, normalizarConfigCobranca } from '../cobranca/config';
import { gravarChaveDaAgencia } from '../encargos-servidor';
import { gravarEmissao } from '../cobranca/servidor';
import { RAZAO_LIMPEZA_DA_AGENCIA_SQL } from '../razao-schema';

export class ErroDeDemonstracao extends Error {
  status: number;
  constructor(mensagem: string, status = 400) {
    super(mensagem);
    this.name = 'ErroDeDemonstracao';
    this.status = status;
  }
}

export interface PassoDaSemeadura { passo: string; ok: boolean; detalhe: string }
export interface ResultadoDaSemeadura {
  ja_estava: boolean;
  passos: PassoDaSemeadura[];
  cobrancas: { emitidas: number; aviso: string | null };
  contagens: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Guarda: só a agência de demonstração

export async function exigirAgenciaDemo(exec: ExecutorSQL, tenantId: string): Promise<Record<string, unknown>> {
  const { rows } = await exec.query(`SELECT data FROM tenants WHERE id = $1`, [tenantId]);
  const data = (rows[0]?.data ?? null) as Record<string, unknown> | null;
  if (!data) throw new ErroDeDemonstracao('Agência não encontrada.', 404);
  if (data.demo !== true) {
    throw new ErroDeDemonstracao('Esta agência não é de demonstração: nada foi criado nem apagado.', 403);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Datas relativas a hoje

const doisDig = (n: number) => String(n).padStart(2, '0');
function mesDe(iso: string, delta: number): string {
  const [a, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${doisDig(d.getUTCMonth() + 1)}-01`;
}
function dia(inicioDoMes: string, d: number): string {
  return `${inicioDoMes.slice(0, 8)}${doisDig(Math.min(d, 28))}`;
}
function fimDoMes(inicioDoMes: string): string {
  return addDias(mesDe(inicioDoMes, 1), -1);
}

// ---------------------------------------------------------------------------
// Contagens (a tela e o teste conferem)

const TABELAS_CONTADAS: Record<string, string> = {
  empresas: 'empresas', contas_bancarias: 'contas_bancarias', cartoes: 'cartoes_corp', clientes: 'clientes',
  fornecedores: 'fornecedores_crm', vendas: 'vendas_modelo', contas_receber: 'contas_receber',
  contas_pagar: 'contas_pagar', baixas: 'baixas', transferencias: 'transferencias', faturas: 'faturas',
  faturas_fornecedor: 'faturas_fornecedor', notas: 'notas_fiscais', cheques: 'cheques_emitidos',
  cobrancas: 'cobrancas', usuarios: 'usuarios', centros_custo: 'centros_custo',
};

export async function contarDados(exec: ExecutorSQL, tenantId: string): Promise<Record<string, number>> {
  const saida: Record<string, number> = {};
  for (const [nome, tabela] of Object.entries(TABELAS_CONTADAS)) {
    try {
      const { rows } = await exec.query(`SELECT COUNT(*)::int AS n FROM ${tabela} WHERE tenant_id = $1`, [tenantId]);
      saida[nome] = Number(rows[0]?.n ?? 0);
    } catch {
      saida[nome] = 0;
    }
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Apagar

/** Tabelas que ficam: o cadastro da agência, quem entra e a chave do Asaas. */
const FICAM = new Set(['tenants', 'agencia', 'usuarios', 'plataformas_config', 'audit_log', 'audit_config', 'tenant_usage', 'assinaturas']);

/**
 * Apaga tudo o que é da agência de demonstração (só dela). O histórico de
 * auditoria é imutável e fica; as cobranças já criadas no Asaas sandbox
 * ficam no sandbox.
 */
export async function apagarDadosDaDemo(tenantId: string): Promise<{ linhas: number }> {
  if (!pool) throw new ErroDeDemonstracao('Banco indisponível.', 503);
  await exigirAgenciaDemo(pool as unknown as ExecutorSQL, tenantId);
  const r = await emTransacao(async exec => {
    await exigirAgenciaDemo(exec, tenantId);
    let linhas = 0;
    // O fechamento trava a exclusão de título baixado: sai primeiro.
    for (const t of ['periodos_fechados', 'periodos_eventos']) {
      const { rowCount } = await exec.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId]);
      linhas += rowCount ?? 0;
    }
    for (const sql of RAZAO_LIMPEZA_DA_AGENCIA_SQL) {
      const { rowCount } = await exec.query(sql, sql.includes('$1') ? [tenantId] : []);
      if (sql.startsWith('DELETE')) linhas += rowCount ?? 0;
    }
    const { rows: tabelas } = await exec.query(
      `SELECT c.table_name AS t FROM information_schema.columns c
         JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND x.table_type = 'BASE TABLE'
        ORDER BY 1`,
    );
    // Várias passadas: uma tabela que depende de outra só sai depois dela.
    let pendentes = tabelas.map(t => String(t.t)).filter(t => !FICAM.has(t));
    for (let passada = 0; passada < 6 && pendentes.length; passada++) {
      const falharam: string[] = [];
      for (const t of pendentes) {
        await exec.query('SAVEPOINT demo_apagar');
        try {
          const { rows: q } = await exec.query(`SELECT quote_ident($1) AS t`, [t]);
          const { rowCount } = await exec.query(`DELETE FROM public.${String(q[0].t)} WHERE tenant_id = $1`, [tenantId]);
          linhas += rowCount ?? 0;
          await exec.query('RELEASE SAVEPOINT demo_apagar');
        } catch {
          await exec.query('ROLLBACK TO SAVEPOINT demo_apagar');
          falharam.push(t);
        }
      }
      if (falharam.length === pendentes.length) break;
      pendentes = falharam;
    }
    if (pendentes.length) throw new ErroDeDemonstracao(`Não foi possível apagar: ${pendentes.join(', ')}.`, 500);
    // Usuários: fica só o administrador da demonstração.
    const { rowCount: us } = await exec.query(
      `DELETE FROM usuarios WHERE tenant_id = $1 AND LOWER(COALESCE(data->>'email', '')) <> $2`, [tenantId, EMAIL_DA_DEMO],
    );
    linhas += us ?? 0;
    // Configurações gravadas na agência pelo semeador e pelo assistente.
    await exec.query(
      `UPDATE agencia SET data = data - 'cobranca' WHERE tenant_id = $1`, [tenantId],
    );
    await exec.query(
      `UPDATE tenants SET data = (data - 'demo_semeado_em') - 'demo_resumo', updated_at = NOW() WHERE id = $1`, [tenantId],
    );
    return { linhas };
  });
  esquecerDemo(tenantId);
  return r;
}

// ---------------------------------------------------------------------------
// Criar

interface Contexto {
  t: string;
  hoje: string;
  M3: string; M2: string; M1: string; M0: string;
  admin: { id: string; nome: string };
  vendedor: { id: string; nome: string };
  financeiro: { id: string; nome: string };
  cat: { receita: string; despesa: string; aluguel: string; software: string };
  contas: Record<'itau' | 'inter' | 'caixa' | 'usd' | 'pesos', string>;
  clientes: Record<string, { id: string; nome: string; documento: string; tipo: 'PF' | 'PJ'; email: string }>;
  fornecedores: Record<string, { id: string; nome: string; tipo: string }>;
  vendas: Record<string, string>;
}

const CLIENTES: Array<[chave: string, tipo: 'PF' | 'PJ', nome: string, base: string]> = [
  ['ana', 'PF', 'Ana Ribeiro', '123456780'],
  ['bruno', 'PF', 'Bruno Carvalho', '234567891'],
  ['carla', 'PF', 'Carla Mendes', '345678912'],
  ['diego', 'PF', 'Diego Santos', '456789123'],
  ['elisa', 'PF', 'Elisa Prado', '567891234'],
  ['atlas', 'PJ', 'Atlas Engenharia Ltda', '112233440001'],
  ['verde', 'PJ', 'Verde Agro S.A.', '556677880001'],
];

const FORNECEDORES: Array<[chave: string, tipo: string, nome: string, base: string]> = [
  ['solmar', 'OPERADORA', 'Sol & Mar Operadora', '210987650001'],
  ['rota', 'OPERADORA', 'Rota Global Turismo', '321098760001'],
  ['ceu', 'CONSOLIDADORA', 'Céu Aberto Consolidadora', '432109870001'],
  ['seguro', 'SEGURADORA', 'Viaje Seguro Assistência', '543210980001'],
  ['mirante', 'HOTEL', 'Hotel Mirante da Serra', '654321090001'],
  ['oceano', 'CRUZEIRO', 'Oceano Azul Cruzeiros', '765432100001'],
];

async function categorias(exec: ExecutorSQL, t: string): Promise<Contexto['cat']> {
  const { rows } = await exec.query(
    `SELECT id, COALESCE(descricao, data->>'descricao', '') AS d, UPPER(COALESCE(tipo, data->>'tipo', '')) AS tipo
       FROM plano_contas WHERE tenant_id = $1 ORDER BY COALESCE(codigo, data->>'codigo', ''), id`, [t],
  );
  const acha = (re: RegExp, tipo?: string) =>
    String(rows.find(r => re.test(String(r.d)) && (!tipo || String(r.tipo).startsWith(tipo)))?.id ?? '');
  const receita = acha(/./, 'RECEITA') || String(rows[0]?.id ?? '');
  const despesa = acha(/./, 'DESPESA') || String(rows[0]?.id ?? '');
  return {
    receita, despesa,
    aluguel: acha(/aluguel/i) || despesa,
    software: acha(/software|sistema|tecnologia|internet/i) || despesa,
  };
}

/** Conta bancária pelo mesmo caminho do cadastro (api/contas-bancarias). */
async function gravarContaBancaria(exec: ExecutorSQL, t: string, item: Record<string, unknown>): Promise<string> {
  const erro = normalizarDadosDaConta(item);
  if (erro) throw new Error(erro);
  const moeda = conferirMoedaDoCadastro(item.moeda, await lerCatalogoDaAgencia(exec, t));
  if ('erro' in moeda) throw new Error(moeda.erro);
  item.moeda = moeda.moeda;
  item.saldo_atual = item.saldo_inicial;
  await exec.query(
    `INSERT INTO contas_bancarias (id, tenant_id, data, nome, banco, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
    [item.id, t, JSON.stringify(item), item.nome, item.banco ?? ''],
  );
  return String(item.id);
}

/** Valor em aberto do título. */
async function emAberto(exec: ExecutorSQL, t: string, tabela: 'contas_receber' | 'contas_pagar', id: string): Promise<number> {
  const campo = tabela === 'contas_receber' ? 'valor_recebido' : 'valor_pago';
  const { rows } = await exec.query(
    `SELECT COALESCE((data->>'valor_final')::numeric, 0) - COALESCE(NULLIF(data->>'${campo}', '')::numeric, 0) AS a
       FROM ${tabela} WHERE tenant_id = $1 AND id = $2`, [t, id],
  );
  return Math.round(Number(rows[0]?.a ?? 0) * 100) / 100;
}

/** Liquida os títulos (pelo motor de baixas), cada um na data dele. */
async function liquidar(
  c: Contexto, tabela: 'contas_receber' | 'contas_pagar', ids: Array<{ id: string; data: string }>, conta: string, forma: string,
): Promise<number> {
  let feitas = 0;
  for (const x of ids) {
    if (x.data > c.hoje) continue;
    await emTransacao(async exec => {
      const valor = await emAberto(exec, c.t, tabela, x.id);
      if (valor <= 0) return;
      const item: ItemBaixa = { titulo_tabela: tabela, titulo_id: x.id, data: x.data, conta_bancaria_id: conta, forma, valor };
      await registrarBaixas(exec, { tenantId: c.t, usuarioId: c.admin.id, usuarioNome: c.admin.nome, origem: 'api' }, [item], { gravar: true });
      feitas++;
    });
  }
  return feitas;
}

async function titulosDaVenda(exec: ExecutorSQL, t: string, tabela: 'contas_receber' | 'contas_pagar', vendaId: string, filtro = '') {
  const { rows } = await exec.query(
    `SELECT id, data->>'data_vencimento' AS v, data FROM ${tabela}
      WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 ${filtro}
      ORDER BY data->>'data_vencimento', id`, [t, vendaId],
  );
  return rows.map(r => ({ id: String(r.id), data: String(r.v ?? ''), dados: (r.data ?? {}) as Record<string, unknown> }));
}

// --- vendas ---------------------------------------------------------------

type Pag = { forma: string; parte?: number; parcelas?: number; fornecedor?: string; primeiro_vencimento?: string };
interface PedidoDeVenda {
  chave: string; data: string; cliente: string; produtos: Array<Record<string, unknown>>; pagamentos: Pag[];
  corporativo?: Record<string, string>; receber?: boolean; pagarFornecedor?: boolean;
}

function pax(id: string, nome: string, tarifa: number, taxas = 0, tipo = 'ADT') {
  return { id, nome, tipo, documento: '', tarifa_centavos: tarifa, taxas_centavos: taxas, outras_taxas_centavos: 0, cancelado_em: null };
}
function comp(id: string, tipo: string, valor: number, extra: Record<string, unknown> = {}) {
  return { id, tipo, valor_centavos: valor, percentual: null, passageiro_id: null, descricao: '', ...extra };
}

async function gravarVenda(c: Contexto, p: PedidoDeVenda): Promise<string> {
  const cli = c.clientes[p.cliente];
  const id = `vm-demo-${p.chave}`;
  // Ids de produto, passageiro e componente são únicos na agência: prefixo da venda.
  const pre = (x: unknown) => `${p.chave}-${String(x)}`;
  const produtos = p.produtos.map(pr => ({
    ...pr, id: pre(pr.id),
    passageiros: ((pr.passageiros ?? []) as Array<Record<string, unknown>>).map(x => ({ ...x, id: pre(x.id) })),
    componentes: ((pr.componentes ?? []) as Array<Record<string, unknown>>).map(x => ({ ...x, id: pre(`${String(pr.id)}-${String(x.id)}`) })),
  }));
  const base = {
    id, numero: '', data_venda: p.data, cliente: { id: cli.id, nome: cli.nome, documento: cli.documento },
    vendedor: c.vendedor, intermediario: null, grupo_id: null, centro_custo: '', origem: 'manual', situacao: '',
    observacoes: 'Venda de demonstração.', crm_venda_id: '', produtos, pagamentos: [],
    ...(p.corporativo ? { corporativo: p.corporativo } : {}),
  };
  const semPag = normalizarVenda(base);
  if (semPag.erros.length) throw new Error(`venda ${p.chave}: ${semPag.erros[0].mensagem}`);
  const tot = totaisDaVenda(semPag.venda);
  const total = tot.valor_cliente - tot.cobrado_pelo_fornecedor;
  let resto = total;
  const pagamentos = p.pagamentos.map((g, i) => {
    const valor = i === p.pagamentos.length - 1 ? resto : Math.round(total * (g.parte ?? 1));
    resto -= valor;
    const f = g.fornecedor ? c.fornecedores[g.fornecedor] : null;
    return {
      id: `pg-${p.chave}-${i + 1}`, forma: g.forma, valor_centavos: valor, parcelas: g.parcelas ?? 1,
      primeiro_vencimento: g.primeiro_vencimento ?? p.data, intervalo_dias: 0,
      pagante: null, fornecedor: f ? { id: f.id, nome: f.nome } : null,
      conta_bancaria_id: g.forma === 'PIX' ? c.contas.itau : null,
      cartao_tipo: 'credito', detalhe: '', venda_origem_credito: '',
    };
  });
  const { venda, erros } = normalizarVenda({ ...base, pagamentos });
  if (erros.length) throw new Error(`venda ${p.chave}: ${erros[0].mensagem}`);
  venda.origem = 'manual';
  await emTransacao(async exec => {
    const comAcordos = (await aplicarAcordosDaAgencia(exec, c.t, venda)).venda as Venda;
    await salvarVenda(exec, c.t, comAcordos, { usuario: c.admin, origem: 'manual' });
  });
  c.vendas[p.chave] = id;

  if (p.receber) {
    const contas = await titulosDaVenda(pool as unknown as ExecutorSQL, c.t, 'contas_receber', id);
    await liquidar(c, 'contas_receber', contas.map(x => ({ id: x.id, data: x.data < p.data ? p.data : x.data })), c.contas.itau, 'pix');
  }
  if (p.pagarFornecedor) {
    const contas = await titulosDaVenda(pool as unknown as ExecutorSQL, c.t, 'contas_pagar', id,
      `AND COALESCE(data->>'moeda', 'BRL') = 'BRL'`);
    await liquidar(c, 'contas_pagar', contas.map(x => ({ id: x.id, data: x.data < p.data ? p.data : x.data })), c.contas.itau, 'pix');
  }
  return id;
}

function vendasDaDemo(c: Contexto): PedidoDeVenda[] {
  const f = (k: string) => ({ id: c.fornecedores[k].id, nome: c.fornecedores[k].nome });
  const prod = (id: string, tipo: string, descricao: string, forn: string, o: Record<string, unknown>) => ({
    id, tipo, descricao, fornecedor: f(forn), representante: null, quem_cobra: 'AGENCIA', moeda: 'BRL', cambio: 1,
    localizador: '', data_inicio: '', data_fim: '', data_pagamento_fornecedor: '', quantidade: 1,
    valor_unitario_centavos: 0, taxas_centavos: 0, passageiros: [], componentes: [], detalhes: {},
    cancelado_em: null, produto_crm_id: '', ...o,
  });
  const { M3, M2, M1, M0, hoje } = c;
  const futuro = (meses: number, d: number) => dia(mesDe(hoje, meses), d);
  return [
    { chave: '01', data: dia(M3, 6), cliente: 'ana', receber: true, pagarFornecedor: true, pagamentos: [{ forma: 'PIX' }], produtos: [
      prod('p1', 'AEREO', 'São Paulo → Lisboa ida e volta', 'ceu', { localizador: 'HZ7Q2A', data_inicio: dia(M2, 10), data_fim: dia(M2, 24),
        detalhes: { cia: 'TAP', trechos: 'GRU-LIS-GRU', destino: 'Lisboa' },
        passageiros: [pax('a1', 'Ana Ribeiro', 420000, 38000), pax('a2', 'Marcos Ribeiro', 420000, 38000)],
        componentes: [comp('c1', 'TAXA_DU', 9000), comp('c2', 'RAV', 30000), comp('c3', 'COMISSAO', 25200)] })] },
    { chave: '02', data: dia(M3, 12), cliente: 'bruno', receber: true, pagarFornecedor: true, pagamentos: [{ forma: 'CARTAO', parcelas: 6 }], produtos: [
      prod('p1', 'PACOTE', 'Pacote Nordeste 7 noites', 'solmar', { localizador: 'SM-10231', data_inicio: dia(M2, 3), data_fim: dia(M2, 10),
        passageiros: [pax('b1', 'Bruno Carvalho', 650000), pax('b2', 'Luiza Carvalho', 650000)],
        componentes: [comp('c1', 'COMISSAO', 156000), comp('c2', 'OVER', 26000, { base: 'TARIFA' })] })] },
    { chave: '03', data: dia(M3, 20), cliente: 'atlas', receber: false, pagamentos: [{ forma: 'FATURAR' }],
      corporativo: { centro_custo: 'Obras SP', solicitante: 'Rita Lopes', aprovador: 'Paulo Atlas', matricula: '', motivo: 'Visita técnica', projeto: 'Ponte Sul', requisicao: 'RQ-311' },
      produtos: [prod('p1', 'AEREO', 'São Paulo → Recife', 'ceu', { localizador: 'AT3KQ9', data_inicio: dia(M3, 27), data_fim: dia(M3, 29),
        detalhes: { cia: 'LATAM', trechos: 'GRU-REC-GRU', destino: 'Recife' },
        passageiros: [pax('t1', 'Rita Lopes', 180000, 12000)], componentes: [comp('c1', 'TAXA_DU', 5000), comp('c2', 'FEE', 8000)] }),
      prod('p2', 'HOSPEDAGEM', 'Hotel em Recife, 2 diárias', 'mirante', { localizador: 'MR-5520', data_inicio: dia(M3, 27), data_fim: dia(M3, 29),
        detalhes: { hotel: 'Mirante Recife', checkin: dia(M3, 27), checkout: dia(M3, 29) }, quantidade: 2, valor_unitario_centavos: 42000,
        componentes: [comp('c1', 'COMISSAO', 8400)] })] },
    { chave: '04', data: dia(M2, 4), cliente: 'carla', receber: true, pagarFornecedor: true, pagamentos: [{ forma: 'PIX', parte: 0.3 }, { forma: 'CARTAO', parcelas: 10 }], produtos: [
      prod('p1', 'PACOTE', 'Pacote Europa clássica 12 dias', 'rota', { localizador: 'RG-88412', data_inicio: futuro(1, 15), data_fim: futuro(1, 27),
        passageiros: [pax('k1', 'Carla Mendes', 1450000)], componentes: [comp('c1', 'COMISSAO', 174000), comp('c2', 'RAV', 40000)] }),
      prod('p2', 'SEGURO', 'Seguro viagem Europa', 'seguro', { data_inicio: futuro(1, 15), data_fim: futuro(1, 27), quantidade: 1, valor_unitario_centavos: 38000,
        componentes: [comp('c1', 'COMISSAO', 11400)] })] },
    { chave: '05', data: dia(M2, 9), cliente: 'diego', receber: true, pagamentos: [{ forma: 'PAGO_DIRETO_FORNECEDOR', fornecedor: 'mirante' }], produtos: [
      prod('p1', 'HOSPEDAGEM', 'Mirante da Serra, 3 diárias', 'mirante', { localizador: 'MR-6001', data_inicio: dia(M2, 20), data_fim: dia(M2, 23),
        detalhes: { hotel: 'Hotel Mirante da Serra', checkin: dia(M2, 20), checkout: dia(M2, 23) }, quantidade: 3, valor_unitario_centavos: 68000,
        componentes: [comp('c1', 'COMISSAO', 20400)] })] },
    { chave: '06', data: dia(M2, 15), cliente: 'elisa', receber: true, pagamentos: [{ forma: 'PIX' }], produtos: [
      prod('p1', 'CRUZEIRO', 'Cruzeiro pelo Caribe, 7 noites', 'oceano', { moeda: 'USD', cambio: 5.4, localizador: 'OA-77120', data_inicio: futuro(2, 5), data_fim: futuro(2, 12),
        detalhes: { navio: 'Oceano Star', cabine: 'Varanda 8120' },
        passageiros: [pax('e1', 'Elisa Prado', 120000), pax('e2', 'Rafael Prado', 120000)],
        componentes: [comp('c1', 'COMISSAO', 28800), comp('c2', 'FEE', 6000)] })] },
    { chave: '07', data: dia(M2, 22), cliente: 'verde', receber: true, pagarFornecedor: true, pagamentos: [{ forma: 'PIX' }],
      corporativo: { centro_custo: 'Comercial', solicitante: 'Joana Verde', aprovador: '', matricula: '', motivo: 'Feira agro', projeto: '', requisicao: '' },
      produtos: [prod('p1', 'AEREO', 'Campinas → Cuiabá', 'ceu', { localizador: 'VG2M7P', data_inicio: dia(M1, 2), data_fim: dia(M1, 5),
        detalhes: { cia: 'Azul', trechos: 'VCP-CGB-VCP', destino: 'Cuiabá' },
        passageiros: [pax('v1', 'Joana Verde', 98000, 9000), pax('v2', 'Caio Verde', 98000, 9000)], componentes: [comp('c1', 'TAXA_DU', 6000)] })] },
    { chave: '08', data: dia(M1, 3), cliente: 'ana', receber: true, pagamentos: [{ forma: 'PIX' }], produtos: [
      prod('p1', 'SEGURO', 'Seguro viagem anual', 'seguro', { quantidade: 1, valor_unitario_centavos: 52000, data_inicio: dia(M1, 10), data_fim: futuro(10, 10),
        componentes: [comp('c1', 'COMISSAO', 15600)] })] },
    { chave: '09', data: dia(M1, 8), cliente: 'atlas', receber: false, pagamentos: [{ forma: 'FATURAR' }],
      corporativo: { centro_custo: 'Diretoria', solicitante: 'Paulo Atlas', aprovador: 'Paulo Atlas', matricula: '', motivo: 'Reunião com cliente', projeto: '', requisicao: 'RQ-402' },
      produtos: [prod('p1', 'AEREO', 'São Paulo → Brasília', 'ceu', { localizador: 'AT9ZX1', data_inicio: dia(M1, 14), data_fim: dia(M1, 15),
        detalhes: { cia: 'GOL', trechos: 'CGH-BSB-CGH', destino: 'Brasília' },
        passageiros: [pax('t1', 'Paulo Atlas', 140000, 9000)], componentes: [comp('c1', 'TAXA_DU', 5000), comp('c2', 'FEE', 8000)] })] },
    { chave: '10', data: dia(M1, 12), cliente: 'bruno', receber: true, pagamentos: [{ forma: 'CARTAO', parcelas: 3 }], produtos: [
      prod('p1', 'PACOTE', 'Pacote Bariloche 5 noites', 'solmar', { localizador: 'SM-11002', data_inicio: futuro(2, 18), data_fim: futuro(2, 23),
        passageiros: [pax('b1', 'Bruno Carvalho', 520000), pax('b2', 'Luiza Carvalho', 520000), pax('b3', 'Theo Carvalho', 260000, 0, 'CHD')],
        componentes: [comp('c1', 'COMISSAO', 156000), comp('c2', 'RAV', 25000)] })] },
    { chave: '11', data: dia(M1, 18), cliente: 'carla', receber: true, pagarFornecedor: true, pagamentos: [{ forma: 'PIX' }], produtos: [
      prod('p1', 'HOSPEDAGEM', 'Pousada em Paraty, 2 diárias', 'mirante', { localizador: 'MR-7044', data_inicio: dia(M1, 25), data_fim: dia(M1, 27),
        detalhes: { hotel: 'Pousada Mirante Paraty', checkin: dia(M1, 25), checkout: dia(M1, 27) }, quantidade: 2, valor_unitario_centavos: 55000,
        componentes: [comp('c1', 'COMISSAO', 11000)] })] },
    { chave: '12', data: dia(M1, 24), cliente: 'diego', receber: true, pagamentos: [{ forma: 'PIX' }], produtos: [
      prod('p1', 'PACOTE', 'Pacote Chile 6 noites', 'rota', { localizador: 'RG-90310', data_inicio: futuro(1, 8), data_fim: futuro(1, 14),
        passageiros: [pax('d1', 'Diego Santos', 610000), pax('d2', 'Paula Santos', 610000)],
        componentes: [comp('c1', 'COMISSAO', 146400), comp('c2', 'RAV', 30000)] }),
      prod('p2', 'SEGURO', 'Seguro viagem Chile', 'seguro', { quantidade: 2, valor_unitario_centavos: 21000, data_inicio: futuro(1, 8), data_fim: futuro(1, 14),
        componentes: [comp('c1', 'COMISSAO', 12600)] })] },
    { chave: '13', data: dia(M0, 2), cliente: 'elisa', receber: true, pagamentos: [{ forma: 'PIX', parte: 0.5 }, { forma: 'BOLETO', parcelas: 2, primeiro_vencimento: futuro(1, 10) }], produtos: [
      prod('p1', 'AEREO', 'Rio → Buenos Aires', 'ceu', { localizador: 'EP4R8T', data_inicio: futuro(1, 20), data_fim: futuro(1, 27),
        detalhes: { cia: 'Aerolíneas', trechos: 'GIG-AEP-GIG', destino: 'Buenos Aires' },
        passageiros: [pax('e1', 'Elisa Prado', 210000, 26000)], componentes: [comp('c1', 'TAXA_DU', 6000), comp('c2', 'RAV', 15000)] })] },
    { chave: '14', data: dia(M0, 6), cliente: 'verde', receber: false, pagamentos: [{ forma: 'BOLETO', parcelas: 3, primeiro_vencimento: futuro(1, 5) }], produtos: [
      prod('p1', 'PACOTE', 'Convenção de vendas em Gramado', 'solmar', { localizador: 'SM-12400', data_inicio: futuro(3, 4), data_fim: futuro(3, 7),
        quantidade: 12, valor_unitario_centavos: 310000, componentes: [comp('c1', 'COMISSAO', 446400), comp('c2', 'FEE', 60000)] })] },
    { chave: '15', data: dia(M0, Math.max(1, Math.min(Number(hoje.slice(8, 10)) - 1, 28))), cliente: 'carla', receber: false,
      pagamentos: [{ forma: 'BOLETO', parcelas: 2, primeiro_vencimento: futuro(1, 15) }], produtos: [
      prod('p1', 'CRUZEIRO', 'Cruzeiro pela costa brasileira', 'oceano', { localizador: 'OA-80015', data_inicio: futuro(3, 1), data_fim: futuro(3, 6),
        passageiros: [pax('k1', 'Carla Mendes', 480000), pax('k2', 'Sérgio Mendes', 480000)], componentes: [comp('c1', 'COMISSAO', 115200)] })] },
  ];
}

// --- os passos ------------------------------------------------------------

type Passo = [nome: string, fazer: (c: Contexto) => Promise<string>];

const PASSOS: Passo[] = [
  ['Plano de contas padrão', async c => {
    const r = await emTransacao(exec => aplicarAssistente(exec, c.t));
    c.cat = await categorias(pool as unknown as ExecutorSQL, c.t);
    return `${r.categorias_criadas} categorias criadas e ligadas às contas que o sistema gera.`;
  }],
  ['Empresas', async c => {
    await emTransacao(exec => salvarEmpresa(exec as never, c.t, {
      nome: 'Horizonte Campinas', razao_social: 'Horizonte Viagens e Turismo Ltda (teste) - Filial', cnpj: CNPJ_DA_FILIAL,
    }));
    return 'Matriz e filial de Campinas.';
  }],
  ['Moeda extra', async c => {
    await emTransacao(exec => salvarMoedaDaAgencia(exec, c.t, { codigo: 'ARS', nome: 'Peso argentino', simbolo: '$', casas: 2 }));
    return 'Peso argentino (ARS) além das oito do sistema.';
  }],
  ['Contas bancárias e cartão', async c => {
    await emTransacao(async exec => {
      c.contas.itau = await gravarContaBancaria(exec, c.t, { id: 'demo-cb-itau', nome: 'Itaú Empresas', tipo: 'CORRENTE', banco_codigo: '341', agencia: '1234', conta: '56789', conta_digito: '0', saldo_inicial: 85000, ativo: true });
      c.contas.inter = await gravarContaBancaria(exec, c.t, { id: 'demo-cb-inter', nome: 'Inter PJ', tipo: 'CORRENTE', banco_codigo: '077', agencia: '0001', conta: '9988776', conta_digito: '1', saldo_inicial: 32000, ativo: true });
      c.contas.caixa = await gravarContaBancaria(exec, c.t, { id: 'demo-cb-caixa', nome: 'Caixa Geral', tipo: 'CAIXA', banco: '', saldo_inicial: 1500, ativo: true });
      c.contas.usd = await gravarContaBancaria(exec, c.t, { id: 'demo-cb-usd', nome: 'Conta em dólar', tipo: 'CORRENTE', banco: 'Conta internacional', moeda: 'USD', saldo_inicial: 4000, ativo: true });
      c.contas.pesos = await gravarContaBancaria(exec, c.t, { id: 'demo-cb-ars', nome: 'Caixa em pesos', tipo: 'CAIXA', banco: '', moeda: 'ARS', saldo_inicial: 250000, ativo: true });
      const cartao = {
        id: 'demo-cartao-corp', apelido: 'Cartão corporativo Itaú', bandeira: 'VISA', ultimos_digitos: '4321', titular: 'Horizonte Viagens',
        banco_emissor: 'Itaú', limite_total: 40000, dia_fechamento: 25, dia_vencimento: 5, taxa_antecipacao: 0, taxa_parcelamento: 0,
        taxa_anuidade: 0, ativo: true, observacoes: '',
      };
      await exec.query(
        `INSERT INTO cartoes_corp (id, tenant_id, data, apelido, bandeira, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [cartao.id, c.t, JSON.stringify(cartao), cartao.apelido, cartao.bandeira],
      );
    });
    return 'Itaú, Inter, Caixa Geral, conta em dólar, caixa em pesos e o cartão corporativo.';
  }],
  ['Razão aberto', async c => {
    const r = await emTransacao(exec => abrirRazaoNoExecutor(exec, c.t));
    for (const id of Object.values(c.contas)) await garantirAberturaDaConta(pool as unknown as ExecutorSQL, c.t, id);
    return `Razão aberto com ${r.contas} contas: todo dinheiro daqui em diante passa por ele.`;
  }],
  ['Centros de custo e rateio', async c => {
    await emTransacao(async exec => {
      await salvarCentro(exec, c.t, { id: 'demo-cc-comercial', nome: 'Comercial' });
      await salvarCentro(exec, c.t, { id: 'demo-cc-lazer', nome: 'Lazer', centro_pai_id: 'demo-cc-comercial' });
      await salvarCentro(exec, c.t, { id: 'demo-cc-corp', nome: 'Corporativo', centro_pai_id: 'demo-cc-comercial' });
      await salvarCentro(exec, c.t, { id: 'demo-cc-adm', nome: 'Administrativo' });
      await salvarCentro(exec, c.t, { id: 'demo-cc-fin', nome: 'Financeiro', centro_pai_id: 'demo-cc-adm' });
      await salvarRegraDeRateio(exec, c.t, {
        id: 'demo-rateio-estrutura', nome: 'Estrutura dividida',
        linhas: [{ centro_custo_id: 'demo-cc-comercial', percentual: 60 }, { centro_custo_id: 'demo-cc-adm', percentual: 40 }],
      });
    });
    return 'Comercial (Lazer, Corporativo) e Administrativo (Financeiro); rateio 60/40.';
  }],
  ['Clientes', async c => {
    for (const [chave, tipo, nome, base] of CLIENTES) {
      const doc = tipo === 'PF' ? cpfComDigitos(base) : cnpjComDigitos(base);
      const email = `${chave}@exemplo.com.br`;
      const id = `demo-cli-${chave}`;
      const item: Record<string, unknown> = {
        id, tipo, status: 'ATIVO', email, telefone_principal: '(11) 90000-0000', whatsapp: '(11) 90000-0000',
        cep: '01310-100', logradouro: 'Avenida Paulista', numero: '1000', bairro: 'Bela Vista', cidade: 'São Paulo', estado: 'SP',
        ...(tipo === 'PF' ? { nome_completo: nome, cpf: doc } : { razao_social: nome, nome_fantasia: nome, cnpj: doc }),
        nome, cpf_cnpj: doc,
      };
      await pool!.query(
        `INSERT INTO clientes (id, tenant_id, data, nome, tipo, cpf_cnpj, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [id, c.t, JSON.stringify(item), nome, tipo, doc],
      );
      c.clientes[chave] = { id, nome, documento: doc, tipo, email };
    }
    return `${CLIENTES.length} clientes (5 pessoas e 2 empresas), e-mails @exemplo.com.br.`;
  }],
  ['Fornecedores, acordos e regras de faturamento', async c => {
    for (const [chave, tipo, nome, base] of FORNECEDORES) {
      const id = `demo-forn-${chave}`;
      const cnpj = cnpjComDigitos(base);
      const item = {
        id, tipo, razao_social: `${nome} Ltda`, nome_fantasia: nome, cnpj, email: `${chave}@exemplo.com.br`, status: 'ATIVO',
        categoria: tipo, recebe_direto_do_cliente: false,
        regras_faturamento: { prazo_pagamento_dias: 15, dia_corte: 0, dia_vencimento: 0, comissao_padrao: 0, moeda_padrao: 'BRL' },
      };
      await pool!.query(
        `INSERT INTO fornecedores_crm (id, tenant_id, data, nome_fantasia, cnpj, categoria, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [id, c.t, JSON.stringify(item), nome, cnpj, tipo],
      );
      c.fornecedores[chave] = { id, nome, tipo };
    }
    const forn = (k: string) => ({ id: c.fornecedores[k].id, nome: c.fornecedores[k].nome });
    await emTransacao(async exec => {
      const acordo = (k: string, o: Record<string, unknown>) => salvarAcordo(exec, c.t, {
        id: '', fornecedor: forn(k), representante: null, tipo_produto: null, produto_crm_id: '', produto_nome: '',
        comissao_percentual: null, comissao_valor_centavos: null, over_percentual: null, over_valor_centavos: null,
        taxa_cc_du_percentual: null, taxa_cc_rav_percentual: null, vigencia_inicio: c.M3, vigencia_fim: null,
        observacoes: 'Acordo de demonstração.', ...o,
      }, c.admin);
      await acordo('solmar', { comissao_percentual: 12, over_percentual: 2 });
      await acordo('rota', { comissao_percentual: 12 });
      await acordo('seguro', { comissao_percentual: 30 });
      await salvarRegraDoFornecedor(exec, c.t, c.fornecedores.solmar.id, {
        periodicidade: 'MENSAL', prazo_dias: 10, dia_corte: 25, dia_vencimento: 10, data_base: 'venda', gerar_sozinha: false,
      });
      await salvarRegraDeFaturamento(exec, c.t, {
        pessoa_tipo: 'CLIENTE', pessoa_id: c.clientes.atlas.id, pessoa_nome: c.clientes.atlas.nome,
        periodo: 'MENSAL', faturar_por: 'VENDA', sentido: 'DEPOIS', prazo_dias: 15, descricao: 'Atlas mensal', ativa: true,
      }, c.admin);
    });
    return `${FORNECEDORES.length} fornecedores (operadoras, consolidadora, seguradora, hotel, cruzeiro), 3 acordos, regra mensal da operadora e do cliente corporativo.`;
  }],
  ['Equipe', async c => {
    const sessao = { isSuperAdmin: true, perfil: 'ADMIN' };
    // Sem login real: senha aleatória que ninguém conhece, e-mail @exemplo.com.br.
    const senha = () => `${generateId()}${generateId()}Aa1!`;
    const fin = await criarUsuario(pool as never, sessao, c.t, { nome: 'Paula Nogueira', email: 'paula.financeiro@exemplo.com.br', perfil: 'OPERADOR', senha: senha() }) as Record<string, unknown>;
    const ven = await criarUsuario(pool as never, sessao, c.t, { nome: 'Lucas Andrade', email: 'lucas.vendas@exemplo.com.br', perfil: 'VENDEDOR', senha: senha() }) as Record<string, unknown>;
    c.financeiro = { id: String(fin.id), nome: 'Paula Nogueira' };
    c.vendedor = { id: String(ven.id), nome: 'Lucas Andrade' };
    await emTransacao(exec => salvarGrupo(exec as never, c.t, {
      nome: 'Financeiro', acesso_total: false,
      acoes: ['ver_financeiro', 'editar_financeiro', 'liquidar_pagar', 'transferir'],
      contas: [c.contas.itau, c.contas.inter, c.contas.caixa], membros: [c.financeiro.id],
    }, c.admin.id));
    return 'Paula (financeiro, perfil "Financeiro") e Lucas (vendedor), sem login real.';
  }],
  ['Contas fixas, parceladas e liquidações', async c => {
    const series: Array<Record<string, unknown>> = [
      { tabela: 'contas_pagar', tipo: 'recorrente', inicio: dia(c.M3, 5), valor: 4500,
        regra: { frequencia: 'MES', intervalo: 1, feriado: 'postergar', fim: { tipo: 'ocorrencias', ocorrencias: 7 } },
        modelo: { descricao: 'Aluguel da loja', fornecedor_nome: 'Imobiliária Exemplo', categoria_id: c.cat.aluguel, rateio: [], tags: ['fixo', 'estrutura'], centro_custo_id: 'demo-cc-adm' } },
      { tabela: 'contas_pagar', tipo: 'recorrente', inicio: dia(c.M3, 10), valor: 349.9,
        regra: { frequencia: 'MES', intervalo: 1, feriado: 'postergar', fim: { tipo: 'ocorrencias', ocorrencias: 7 } },
        modelo: { descricao: 'Sistema de reservas', fornecedor_nome: 'Software Exemplo', categoria_id: c.cat.software, tags: ['fixo'] } },
      { tabela: 'contas_pagar', tipo: 'parcelado', inicio: dia(c.M2, 15), valor: 12000,
        regra: { frequencia: 'MES', intervalo: 1, feriado: 'postergar', fim: { tipo: 'ocorrencias', ocorrencias: 6 } },
        modelo: { descricao: 'Notebooks da equipe', fornecedor_nome: 'Loja de informática', categoria_id: c.cat.despesa, tags: ['equipamento'] } },
      { tabela: 'contas_receber', tipo: 'recorrente', inicio: dia(c.M3, 20), valor: 2000,
        regra: { frequencia: 'MES', intervalo: 1, feriado: 'postergar', fim: { tipo: 'ocorrencias', ocorrencias: 7 } },
        modelo: { descricao: 'Gestão de viagens corporativas', cliente_id: c.clientes.atlas.id, cliente_nome: c.clientes.atlas.nome, categoria_id: c.cat.receita, tags: ['contrato'] } },
    ];
    let titulos = 0;
    let pagos = 0;
    for (const s of series) {
      const r = await emTransacao(exec => criarSerieNoExecutor(exec, c.t, prepararSerie(s), c.hoje));
      titulos += r.titulos.length;
      const tabela = s.tabela as 'contas_pagar' | 'contas_receber';
      pagos += await liquidar(c, tabela, r.titulos.map(x => ({ id: x.id, data: x.vencimento })), tabela === 'contas_pagar' ? c.contas.itau : c.contas.inter, 'pix');
    }
    return `${titulos} títulos de 4 séries (aluguel, sistema, notebooks em 6x, contrato mensal); ${pagos} liquidados até hoje.`;
  }],
  ['Transferências', async c => {
    const transferir = async (id: string, de: string, para: string, valor: number, data: string, descricao: string) => {
      const nome = async (x: string) => String((await pool!.query(`SELECT data->>'nome' AS n FROM contas_bancarias WHERE tenant_id = $1 AND id = $2`, [c.t, x])).rows[0]?.n ?? '');
      const item = {
        id, conta_origem_id: de, conta_origem_nome: await nome(de), conta_destino_id: para, conta_destino_nome: await nome(para),
        valor, data, descricao, status: 'EFETIVADA', data_efetivacao: data,
      };
      // Mesmo caminho do "Efetivar" (api/transferencias/[id]): registro e as duas pernas numa transação.
      await emTransacao(async exec => {
        await exec.query(
          `INSERT INTO transferencias (id, tenant_id, data, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
          [id, c.t, JSON.stringify(item)],
        );
        const origem = { tipo: 'transferencia' as const, tabela: 'transferencias', id, descricao, naMoedaDaConta: true };
        await aplicarMovimentoCaixaAtomico(c.t, de, -valor, exec, origem);
        await aplicarMovimentoCaixaAtomico(c.t, para, valor, exec, origem);
      });
    };
    await transferir('demo-tr-1', c.contas.itau, c.contas.inter, 5000, dia(c.M2, 2), 'Reserva para fornecedores');
    await transferir('demo-tr-2', c.contas.itau, c.contas.caixa, 800, dia(c.M1, 6), 'Troco do caixa');
    return 'Itaú → Inter e Itaú → Caixa Geral.';
  }],
  ['Vendas', async c => {
    for (const v of vendasDaDemo(c)) await gravarVenda(c, v);
    return `${Object.keys(c.vendas).length} vendas: aéreo, hotel, pacote, seguro e cruzeiro; Pix, cartão parcelado, boleto, faturar e pago direto ao fornecedor.`;
  }],
  ['Cancelamento com reembolso e crédito', async c => {
    const venda = c.vendas['04'];
    await emTransacao(exec => executarCancelamento(exec, c.t, venda, {
      data: c.hoje, motivo: 'Cliente desistiu do seguro', itens: [{ produto_id: '04-p2', passageiro_ids: null }],
      multas: [], zerar_fornecedor: true, zerar_cliente: true, sobra: 'reembolso', prazo_reembolso: addDias(c.hoje, 10),
    }, c.admin));
    const outra = c.vendas['12'];
    await emTransacao(exec => executarCancelamento(exec, c.t, outra, {
      data: c.hoje, motivo: 'Uma passageira não vai mais', itens: [{ produto_id: '12-p1', passageiro_ids: ['12-d2'] }],
      multas: [{ produto_id: '12-p1', fornecedor_centavos: 30000, cliente_centavos: 45000 }],
      zerar_fornecedor: true, zerar_cliente: true, sobra: 'credito', validade_credito: addDias(c.hoje, 365),
    }, c.admin));
    return 'Seguro da venda 04 cancelado com reembolso; uma passageira da venda 12 cancelada com multa e o resto em crédito do cliente.';
  }],
  ['Fatura do cliente corporativo', async c => {
    const { rows } = await pool!.query(
      `SELECT DISTINCT fatura_id FROM fatura_itens WHERE tenant_id = $1 AND venda_id = ANY($2::text[]) AND fatura_id IS NOT NULL`,
      [c.t, [c.vendas['03'], c.vendas['09']]],
    );
    let fechadas = 0;
    for (const r of rows) {
      await emTransacao(exec => fecharFatura(exec, c.t, String(r.fatura_id), { usuario: c.admin, hoje: c.hoje }));
      fechadas++;
    }
    return `${fechadas} fatura(s) da Atlas Engenharia fechada(s).`;
  }],
  ['Fatura do fornecedor', async c => {
    const ex = pool as unknown as ExecutorSQL;
    const itens = await itensAFaturar(ex, c.t, { parte_id: c.fornecedores.solmar.id }, c.hoje);
    if (!itens.length) return 'Nada a faturar da operadora.';
    await emTransacao(exec => gerarFatura(exec, c.t, {
      parte_id: c.fornecedores.solmar.id, conta_ids: itens.map(i => i.conta_id),
      automatica: true, observacoes: 'Fatura de demonstração',
    }, c.admin, c.hoje));
    return `Fatura da Sol & Mar com ${itens.length} item(ns).`;
  }],
  ['Conferência de operadora', async c => {
    const linha = (localizador: string, passageiro: string, bruto: number, comissao: number) => ({
      data: dia(c.M1, 28), localizador, passageiro, descricao: 'Pacote', tipo: 'venda', bruto_centavos: bruto, taxas_centavos: 0,
      comissao_centavos: comissao, liquido_centavos: bruto - comissao,
    });
    const linhas = [linha('SM-10231', 'Bruno Carvalho', 1300000, 156000), linha('SM-11002', 'Bruno Carvalho', 1300000, 150000), linha('SM-99999', 'Passageiro desconhecido', 90000, 9000)];
    const soma = (k: 'bruto_centavos' | 'comissao_centavos' | 'liquido_centavos') => linhas.reduce((s, l) => s + l[k], 0);
    await emTransacao(exec => criarConferencia(exec, c.t, {
      hash: createHash('sha256').update(`demo-extrato-${c.t}`).digest('hex'),
      extrato: {
        operadora_nome: c.fornecedores.solmar.nome, operadora_cnpj: '', periodo_de: c.M2, periodo_ate: fimDoMes(c.M1),
        total_bruto_centavos: soma('bruto_centavos'), total_comissao_centavos: soma('comissao_centavos'), total_liquido_centavos: soma('liquido_centavos'),
        linhas,
      } as never,
      arquivo_nome: 'extrato-sol-e-mar-exemplo.pdf', origem: 'pdf', fornecedor_id: c.fornecedores.solmar.id, fornecedor_nome: c.fornecedores.solmar.nome,
      periodo_de: c.M2, periodo_ate: fimDoMes(c.M1), quem: { usuarioId: c.admin.id, usuarioNome: c.admin.nome },
    }));
    return 'Extrato de exemplo da Sol & Mar: duas linhas casam com vendas, uma não.';
  }],
  ['Notas e regras da nota', async c => {
    await emTransacao(async exec => {
      await salvarRegraDaNota(exec, c.t, { ...regraSugerida(), descricao: 'Receita da agência para quem paga' }, c.admin);
      const nota = (numero: string, venda: string, cliente: string, data: string, valor: number) => registrarNotaEmitidaFora(exec, c.t, {
        numero, serie: '1', data_emissao: data, valor_centavos: valor, aliquota_iss: 5, iss_centavos: Math.round(valor * 0.05),
        tomador: { nome: c.clientes[cliente].nome, cpf_cnpj: c.clientes[cliente].documento, email: c.clientes[cliente].email },
        discriminacao: 'Serviços de intermediação de viagem (demonstração).', venda_id: c.vendas[venda], cliente_id: c.clientes[cliente].id,
      }, c.admin, { hoje: c.hoje });
      await nota('1001', '01', 'ana', dia(c.M3, 8), 64200);
      await nota('1002', '02', 'bruno', dia(c.M3, 14), 182000);
    });
    return 'Regra da nota e duas notas registradas como emitidas fora do sistema.';
  }],
  ['Comissões', async c => {
    const ex = pool as unknown as ExecutorSQL;
    await emTransacao(exec => salvarConfigComissao(exec, c.t, { regra: 'FUNCOES', liberar: 'VENDA', meta_sobre: ['RECEITA'], data_inicial: c.M3 }, c.admin, c.hoje));
    const plano = await salvarPlano(ex, c.t, { nome: 'Plano vendedores', modo_faixa: 'DEGRAU', faixas: [
      { percentual_meta: 0, regras: [{ produto: '*', funcao_id: '*', calculo: { tipo: 'PERCENTUAL', percentual: 10, sobre: ['RECEITA'] } }] },
      { percentual_meta: 100, regras: [{ produto: '*', funcao_id: '*', calculo: { tipo: 'PERCENTUAL', percentual: 15, sobre: ['RECEITA'] } }] },
    ] });
    await emTransacao(exec => salvarFuncao(exec, c.t, { funcao: { id: 'fn-vendedor' }, pessoas: [
      { pessoa_id: c.vendedor.id, pessoa_nome: c.vendedor.nome, plano_id: plano.id, data_inicio: c.M3 },
    ] }));
    const anos = [...new Set([c.M3, c.M2, c.M1, c.M0, mesDe(c.hoje, 3)].map(m => Number(m.slice(0, 4))))];
    for (const ano of anos) {
      await emTransacao(exec => salvarGradeDeMetas(exec, c.t, ano, [{ pessoa_funcao_id: `fn-vendedor:${c.vendedor.id}`, meses: Array(12).fill(1500000) }]));
    }
    const ate = fimDoMes(c.M1);
    const fechado = await fecharComissoes(emTransacao, ex, c.t, { ate, participantes: [`fn-vendedor:${c.vendedor.id}`] }, c.admin);
    const r = await pagarComissoes(emTransacao, ex, c.t, { modo: 'TOTAL', pessoas: [c.vendedor.id] }, c.admin, c.hoje);
    const contas = (r as unknown as { pagos: Array<{ conta_id: string; conta_tabela: string; vencimento: string }> }).pagos
      .filter(p => p.conta_tabela === 'contas_pagar');
    await liquidar(c, 'contas_pagar', contas.map(p => ({ id: p.conta_id, data: c.hoje })), c.contas.itau, 'pix');
    const fechados = (fechado as unknown as { fechados: unknown[] }).fechados.length;
    return `Função Vendedor, plano em duas faixas, metas do ano; ${fechados} fechamento até ${ate.split('-').reverse().join('/')}, pago.`;
  }],
  ['Cheques', async c => {
    const { rows } = await pool!.query(
      `SELECT id FROM contas_pagar WHERE tenant_id = $1 AND COALESCE(data->>'status', 'PENDENTE') = 'PENDENTE'
          AND data->>'descricao' ILIKE 'Aluguel%' AND data->>'data_vencimento' > $2 ORDER BY data->>'data_vencimento' LIMIT 1`,
      [c.t, c.hoje],
    );
    if (!rows[0]) return 'Nenhum aluguel em aberto para pagar com cheque.';
    await emTransacao(exec => emitirChequeDoTitulo(exec, c.t, {
      titulo_id: String(rows[0].id), conta_bancaria_id: c.contas.itau, numero: '000101', emissao: c.hoje, bom_para: null,
      favorecido: 'Imobiliária Exemplo', cidade: 'São Paulo', valor_centavos: null,
    }, c.admin, null));
    return 'Cheque 000101 do Itaú para o próximo aluguel.';
  }],
  ['Relatório agendado', async c => {
    const v = validarAgendamento({
      nome: 'Vendas da semana', relatorio: 'vendas', consulta: '', frequencia: 'semanal', dia_semana: 1, dia_mes: 1, hora: 8,
      periodo: 'mes_atual', formato: 'xlsx', destinatarios: [EMAIL_DA_DEMO], validade_dias: 7, ativo: true,
    });
    if (!v.ok) throw new Error(Object.values(v.erros)[0]);
    await emTransacao(exec => salvarAgendamento(exec, c.t, null, v.dados, { ...c.admin, verReceita: true, vendedorId: null }, new Date()));
    return 'Toda segunda às 8h. Sem CRM, o envio fica só como link.';
  }],
  ['Pedido de aprovação', async c => {
    await emTransacao(exec => salvarAlcadas(exec, c.t, [
      { nome: 'Acima de R$ 10 mil', valor_min_centavos: 1000000, aprovadores: ['papel:ADMIN'], niveis: 1 },
    ]));
    const id = 'demo-cp-evento';
    const conta = {
      id, origem: 'OUTROS', descricao: 'Patrocínio de evento de vendas', fornecedor_id: '', fornecedor_nome: 'Eventos Exemplo',
      categoria_id: c.cat.despesa, valor_original: 18000, juros: 0, multa: 0, desconto: 0, valor_final: 18000, moeda: 'BRL', cambio: 1,
      valor_brl: 18000, data_emissao: c.hoje, data_vencimento: addDias(c.hoje, 20), data_pagamento: null, valor_pago: null,
      conta_bancaria_id: null, forma_pagamento: '', status: 'PENDENTE', parcela_numero: 1, total_parcelas: 1, rateio: [], anexos: [], observacoes: '',
    };
    // Mesmo INSERT do cadastro de conta a pagar (api/contas-pagar).
    await pool!.query(
      `INSERT INTO contas_pagar (id, tenant_id, data, fornecedor_id, status, created_at, updated_at) VALUES ($1, $2, $3, '', 'PENDENTE', NOW(), NOW())`,
      [id, c.t, JSON.stringify(conta)],
    );
    await pedirAprovacaoDoPagamento({ tenantId: c.t, contaPagarId: id, solicitante: c.financeiro, motivo: 'Evento de lançamento' });
    return 'Pagamento de R$ 18 mil esperando a aprovação do administrador.';
  }],
  ['Mudança de sistema (parada no ensaio)', async c => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const corte = c.hoje.split('-').reverse().join('/');
    const arquivos: Array<[string, string]> = [
      ['contas.csv', 'Descrição;Tipo;Banco;Agência;Conta;Saldo\r\nBanco antigo;Conta Corrente;001;1111;22222-3;1.000,00\r\n'],
      ['pessoas.csv', 'Nome;CPF/CNPJ;E-mail;Telefone\r\nMaria Souza;' + cpfComDigitos('987654321') + ';maria@exemplo.com.br;(11) 98888-1111\r\n'],
      ['titulos.csv', `Pessoa;CPF/CNPJ;Documento;Vencimento;Movimento;Valor Final;Descrição\r\nMaria Souza;${cpfComDigitos('987654321')};NF 10;${addDias(c.hoje, 30).split('-').reverse().join('/')};Receber;1.200,00;Saldo do sistema anterior\r\n`],
    ];
    const lote = await emTransacao(exec => criarLote(exec, c.t, { nome: 'Planilhas de exemplo', data_corte: corte }, c.admin));
    const loteId = String((lote as unknown as { id: string }).id);
    for (const [nome, texto] of arquivos) {
      const lista = await emTransacao(exec => adicionarArquivo(exec, c.t, loteId, nome, enc(texto)));
      const arq = lista.find(a => (a as unknown as { nome: string }).nome === nome) as unknown as { id: string } | undefined;
      if (arq) await emTransacao(exec => atualizarArquivo(exec, c.t, loteId, arq.id, { confirmar: true }));
    }
    await emTransacao(exec => ensaiarLote(exec, c.t, loteId));
    return 'Lote com três planilhas de exemplo, ensaiado e parado antes de aplicar.';
  }],
];

/** Fechar caixa: por último, porque trava qualquer dinheiro com data até lá. */
const FECHAR_CAIXA: Passo = ['Caixa fechado', async c => {
  const ate = fimDoMes(c.M3);
  await emTransacao(exec => fecharPeriodo(exec, { tenantId: c.t, contaId: null, ate, usuarioId: c.admin.id, usuarioNome: c.admin.nome }));
  return `Período fechado até ${ate.split('-').reverse().join('/')} em todas as contas.`;
}];

/** Cobranças de teste: só com o Asaas em sandbox. */
async function emitirCobrancas(c: Contexto): Promise<ResultadoDaSemeadura['cobrancas']> {
  let conf: Awaited<ReturnType<typeof carregarCredenciais>> = null;
  try {
    conf = await carregarCredenciais(c.t, 'asaas');
  } catch {
    conf = null;
  }
  if (!conf || !conf.config.ativo || !chaveDeSandboxDoAsaas(conf.cred.api_key)) {
    return { emitidas: 0, aviso: 'Cobranças puladas: cadastre a chave do Asaas sandbox em Configurações › Plataformas e rode de novo.' };
  }
  await emTransacao(async exec => {
    const { config } = await lerConfigCobranca(exec, c.t);
    if (!config.provedor_padrao) {
      await gravarChaveDaAgencia(exec, c.t, 'cobranca', normalizarConfigCobranca({ ...config, provedor_padrao: 'asaas', tipo_padrao: 'boleto', conta_bancaria_id: c.contas.inter }));
    }
  });
  const { rows } = await pool!.query(
    `SELECT id FROM contas_receber WHERE tenant_id = $1 AND COALESCE(data->>'status', 'PENDENTE') = 'PENDENTE'
        AND COALESCE(data->>'cliente_id', '') <> '' AND data->>'data_vencimento' > $2
      ORDER BY data->>'data_vencimento', id LIMIT 3`,
    [c.t, c.hoje],
  );
  const tipos = ['boleto', 'pix', 'boleto'] as const;
  let emitidas = 0;
  const erros: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const r = await gravarEmissao(c.t, { itens: [{ conta_id: String(rows[i].id) }], provedor: 'asaas', tipo: tipos[i] },
        { quem: { usuarioId: c.admin.id, usuarioNome: c.admin.nome }, hoje: c.hoje, idempotencia: `demo-cobranca-${rows[i].id}` });
      emitidas += r.cobrancas.length;
    } catch (e) {
      erros.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { emitidas, aviso: erros.length ? `Algumas cobranças não saíram: ${erros[0]}` : null };
}

/**
 * Cria os dados de demonstração. Com os dados já criados, não faz nada. Sem
 * eles, começa de uma agência limpa (tira restos de uma tentativa que parou
 * no meio) e para no primeiro passo que falhar, dizendo qual.
 */
export async function semearDemo(tenantId: string, hoje = hojeISO()): Promise<ResultadoDaSemeadura> {
  if (!pool) throw new ErroDeDemonstracao('Banco indisponível.', 503);
  const ex = pool as unknown as ExecutorSQL;
  const dados = await exigirAgenciaDemo(ex, tenantId);
  if (typeof dados.demo_semeado_em === 'string') {
    return { ja_estava: true, passos: [], cobrancas: { emitidas: 0, aviso: null }, contagens: await contarDados(ex, tenantId) };
  }
  await apagarDadosDaDemo(tenantId);

  const { rows: adm } = await ex.query(
    `SELECT id, COALESCE(data->>'nome', nome) AS nome FROM usuarios WHERE tenant_id = $1 AND LOWER(data->>'email') = $2 LIMIT 1`,
    [tenantId, EMAIL_DA_DEMO],
  );
  if (!adm[0]) throw new ErroDeDemonstracao('O administrador da demonstração não foi encontrado. Crie a agência de novo.', 409);
  const M0 = mesDe(hoje, 0);
  const c: Contexto = {
    t: tenantId, hoje, M3: mesDe(hoje, -3), M2: mesDe(hoje, -2), M1: mesDe(hoje, -1), M0,
    admin: { id: String(adm[0].id), nome: String(adm[0].nome) }, vendedor: { id: '', nome: '' }, financeiro: { id: '', nome: '' },
    cat: { receita: '', despesa: '', aluguel: '', software: '' },
    contas: { itau: '', inter: '', caixa: '', usd: '', pesos: '' }, clientes: {}, fornecedores: {}, vendas: {},
  };

  const passos: PassoDaSemeadura[] = [];
  for (const [nome, fazer] of [...PASSOS, FECHAR_CAIXA]) {
    try {
      passos.push({ passo: nome, ok: true, detalhe: await fazer(c) });
    } catch (e) {
      passos.push({ passo: nome, ok: false, detalhe: e instanceof Error ? e.message : String(e) });
      return { ja_estava: false, passos, cobrancas: { emitidas: 0, aviso: null }, contagens: await contarDados(ex, tenantId) };
    }
  }
  const cobrancas = await emitirCobrancas(c);
  const contagens = await contarDados(ex, tenantId);
  await ex.query(
    `UPDATE tenants SET data = data || jsonb_build_object('demo_semeado_em', $2::text, 'demo_resumo', $3::jsonb), updated_at = NOW() WHERE id = $1`,
    [tenantId, new Date().toISOString(), JSON.stringify({ contagens, cobrancas })],
  );
  return { ja_estava: false, passos, cobrancas, contagens };
}

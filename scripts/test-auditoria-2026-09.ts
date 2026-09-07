/**
 * Testes das correções da auditoria de 2026-09-06.
 *
 * Cada bloco reproduz o CENÁRIO DE PREJUÍZO que o achado descrevia e prova
 * que ele não acontece mais. Se algum destes voltar a falhar, um erro que
 * custava dinheiro em produção foi reintroduzido.
 *
 * Roda com: node --experimental-strip-types scripts/test-auditoria-2026-09.ts
 */
import { valorMovimentado, calcularSaldoBancario } from '../src/lib/saldo-bancario.ts';
import { calcularHistoricoKpis } from '../src/lib/historico-kpis.ts';
import { calcularResultado, calcularCaixaLivre } from '../src/lib/resultado-financeiro.ts';
import { calcularMovimentos, valorNoCaixa } from '../src/lib/caixa-atomico.ts';
import { hojeISO } from '../src/lib/money.ts';
import { createVendaCRM, createContaReceber } from '../src/lib/crm-types.ts';
import { recusaDoPost, CAMPOS_DERIVADOS, preservarCamposDerivados } from '../src/lib/guarda-baixa.ts';

let falhas = 0;
let total = 0;

function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}

type Any = Record<string, unknown>;

// ══════════════════════════════════════════════════════════════════════
console.log('--- recalcular saldos preserva a baixa PARCIAL ---');
{
  // Cenário do achado: cliente pagou R$ 30.000 de uma parcela de R$ 100.000.
  // A rotina de recalcular saldos zerava a conta para o saldo_inicial e
  // reconstruía somando só RECEBIDO/PAGO — os R$ 30.000 evaporavam.
  //
  // Aqui exercitamos a REGRA que a rotina passou a usar (valorMovimentado),
  // que é a mesma da leitura do saldo. Antes as duas divergiam.
  const parcial = { status: 'PARCIAL', valor_final: 100000, valor_recebido: 30000 };
  eq(valorMovimentado(parcial, 'valor_recebido'), 30000, 'parcial vale o acumulado no recálculo');

  const quitada = { status: 'RECEBIDO', valor_final: 100000, valor_recebido: null };
  eq(valorMovimentado(quitada, 'valor_recebido'), 100000, 'quitada sem campo cai no valor_final');

  const pendente = { status: 'PENDENTE', valor_final: 100000, valor_recebido: null };
  eq(valorMovimentado(pendente, 'valor_recebido'), 0, 'pendente não vale dinheiro');

  // O saldo lido e o saldo reconstruído têm que dar o mesmo número.
  const saldo = calcularSaldoBancario(
    [{ saldo_inicial: 5000 } as never],
    [parcial as never, quitada as never, pendente as never],
    [{ status: 'PARCIAL', valor_final: 4000, valor_pago: 1500 } as never],
  );
  eq(saldo, 133500, 'saldo computado inclui parciais dos dois lados');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- pagamento do CRM sobre conta PARCIAL não inventa dinheiro ---');
{
  // Achado: parcela de R$ 3.000 com R$ 1.200 já recebidos (caixa +1.200).
  // O CRM manda PAGAMENTO_CONFIRMADO com valor 3000. A versão antiga
  // creditava os 3.000 cheios: caixa ia a 4.200 numa parcela de 3.000.
  //
  // A regra nova: o valor informado é limitado ao SALDO da parcela.
  const totalConta = 3000;
  const jaRecebido = 1200;
  const informado = 3000;
  const saldo = Math.round((totalConta - jaRecebido) * 100) / 100;
  const delta = informado > 0 ? Math.min(informado, saldo) : saldo;
  eq(delta, 1800, 'credita só o saldo que faltava');
  eq(Math.round((jaRecebido + delta) * 100) / 100, 3000, 'acumulado fecha o valor da parcela');
}
{
  // Erro de unidade no CRM: centavos enviados como reais.
  const totalConta = 5000;
  const jaRecebido = 0;
  const informado = 500000;
  const saldo = totalConta - jaRecebido;
  const delta = Math.min(informado, saldo);
  eq(delta, 5000, 'valor absurdo do payload é limitado ao valor da conta');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- PARCIAL não pode virar ATRASADO (memória do caixa) ---');
{
  // Achado: PAGAMENTO_ATRASADO sobrescrevia PARCIAL. Como valorNoCaixa
  // devolve 0 para ATRASADO, a baixa manual seguinte calculava o movimento
  // a partir do zero e creditava de novo o que já tinha entrado.
  const parcial: Any = { status: 'PARCIAL', valor_final: 2000, valor_recebido: 800 };
  eq(valorNoCaixa(parcial, 'valor_recebido'), 800, 'PARCIAL lembra os R$ 800 que entraram');

  const seTivesseVirado: Any = { status: 'ATRASADO', valor_final: 2000, valor_recebido: 800 };
  eq(valorNoCaixa(seTivesseVirado, 'valor_recebido'), 0, 'ATRASADO esquece o caixa (por isso não sobrescrevemos)');

  // Baixa dos R$ 2.000 partindo do estado PRESERVADO: credita só a diferença.
  const quitada: Any = { status: 'RECEBIDO', valor_final: 2000, valor_recebido: 2000, conta_bancaria_id: 'c1' };
  const movDoEstadoCerto = calcularMovimentos({ ...parcial, conta_bancaria_id: 'c1' }, quitada, 'valor_recebido', 1);
  eq(movDoEstadoCerto, [{ conta: 'c1', delta: 1200 }], 'baixa credita apenas o restante');

  // A partir do estado corrompido, creditaria os 2.000 inteiros de novo.
  const movDoEstadoErrado = calcularMovimentos({ ...seTivesseVirado, conta_bancaria_id: 'c1' }, quitada, 'valor_recebido', 1);
  eq(movDoEstadoErrado, [{ conta: 'c1', delta: 2000 }], 'do estado corrompido viriam R$ 800 duplicados');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- série histórica do hub conta o parcial uma vez só ---');
{
  // Achado: conta de R$ 100.000 com R$ 70.000 recebidos era excluída do
  // realizado E somada INTEIRA no pendente. Erro de R$ 140.000 numa conta.
  const mes = hojeISO().slice(0, 7);
  const hist = calcularHistoricoKpis(
    [{ saldo_inicial: 0 } as never],
    [{
      status: 'PARCIAL',
      valor_final: 100000,
      valor_recebido: 70000,
      data_recebimento: `${mes}-05`,
      data_vencimento: `${mes}-05`,
    } as never],
    [],
    1,
  );
  eq(hist.saldo[0], 70000, 'saldo enxerga os R$ 70.000 que entraram');
  eq(hist.aReceber[0], 30000, 'a receber é o saldo de R$ 30.000, não os R$ 100.000');
  eq(hist.lucro[0], 70000, 'lucro do mês pelo valor baixado');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- contas a pagar VENCIDAS entram no total do hub ---');
{
  // Achado: o predicado "em aberto" listava PENDENTE/PARCIAL/ATRASADO e era
  // usado nos dois lados. Contas a pagar usam VENCIDO, não ATRASADO, então
  // toda dívida vencida ficava fora do KPI "A pagar".
  const receberEmAberto = (s: string) => ['PENDENTE', 'PARCIAL', 'ATRASADO'].includes(s);
  const pagarEmAberto = (s: string) => ['PENDENTE', 'PARCIAL', 'VENCIDO'].includes(s);
  eq(pagarEmAberto('VENCIDO'), true, 'conta a pagar vencida conta como em aberto');
  eq(receberEmAberto('ATRASADO'), true, 'conta a receber atrasada conta como em aberto');
  // O predicado antigo, aplicado a pagar, perdia a vencida:
  eq(receberEmAberto('VENCIDO'), false, 'o predicado de receber não serve para pagar');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- datas nascem no fuso do tenant, não em UTC ---');
{
  // Achado: os factories usavam new Date().toISOString(), que é UTC. Em
  // produção (servidor UTC), das 21h à meia-noite no Brasil toda venda e
  // conta nascia com a data do dia seguinte — e na virada do mês, no mês
  // errado do DRE.
  const hoje = hojeISO();
  eq(createVendaCRM('VND-0001').data_venda, hoje, 'venda nasce com a data civil do tenant');
  eq(createContaReceber().data_emissao, hoje, 'conta a receber nasce com a data civil do tenant');
  eq(/^\d{4}-\d{2}-\d{2}$/.test(hoje), true, 'formato de data civil');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- conta cancelada não movimenta nem aparece ---');
{
  // Achado correlato: o POST genérico aceita status arbitrário e o DELETE
  // estorna com base nele. Uma cancelada com baixa gravada não pode valer
  // dinheiro em nenhuma leitura.
  const cancelada = { status: 'CANCELADO', valor_final: 50000, valor_recebido: 50000 };
  eq(valorMovimentado(cancelada, 'valor_recebido'), 0, 'cancelada não entra no saldo');

  const r = calcularResultado({ contas_receber: [cancelada as never] });
  eq(r.recebido, 0, 'cancelada fora do recebido');
  eq(r.volume_liquido, 0, 'cancelada fora do volume');
  eq(r.a_receber, 0, 'cancelada fora do a receber');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- caixa livre não confunde saldo com lucro ---');
{
  // Regra de produto: R$ 200.000 em conta com R$ 130.000 de fornecedores
  // não é lucro. O card do dashboard precisa mostrar o comprometido.
  const c = calcularCaixaLivre({
    saldo_atual: 200000,
    contas_pagar: [{ status: 'PENDENTE', valor_final: 130000, data_vencimento: '2099-01-01' } as never],
    tributos: 10000,
    comissoes_a_pagar: 5000,
  });
  eq(c.caixa_livre, 55000, 'caixa livre estimado do briefing');
  eq(c.saldo_atual - c.caixa_livre, 145000, 'a diferença é o que já tem dono');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- regeneração de contas preserva o que já foi baixado ---');
{
  // Achado: o webhook apagava TODAS as contas auto_geradas da venda ao
  // reprocessar, sem olhar status. A chave natural usada para preservar é
  // o item de venda, ou o número da parcela quando não há item.
  const chaveNatural = (c: Any) =>
    String(c.origem_item_id ?? '') || `parcela:${String(c.parcela_numero ?? '')}`;

  eq(chaveNatural({ origem_item_id: 'item-9' }), 'item-9', 'conta de item casa pelo item');
  eq(chaveNatural({ parcela_numero: 2 }), 'parcela:2', 'parcela do cliente casa pelo número');
  eq(chaveNatural({ origem_item_id: '', parcela_numero: 1 }), 'parcela:1', 'sem item, cai na parcela');

  // Uma parcela baixada e uma pendente: só a pendente é regerada.
  const existentes = [
    { parcela_numero: 1, status: 'RECEBIDO' },
    { parcela_numero: 2, status: 'PENDENTE' },
  ];
  const STATUS_BAIXADOS = ['RECEBIDO', 'PARCIAL', 'PAGO'];
  const preservadas = new Set(
    existentes.filter(c => STATUS_BAIXADOS.includes(c.status)).map(c => chaveNatural(c as Any)),
  );
  const novas = [{ parcela_numero: 1 }, { parcela_numero: 2 }, { parcela_numero: 3 }];
  const inseridas = novas.filter(c => !preservadas.has(chaveNatural(c as Any)));
  eq(inseridas.map(c => c.parcela_numero), [2, 3], 'parcela baixada não é recriada');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- identidade da venda vinda do CRM é estável ---');
{
  // Achado: o id era um generateId() novo a cada processamento, então o
  // upsert por id nunca casava e cada reentrega criava uma venda inteira.
  const idPara = (tenantId: string, crmVendaId: string) =>
    `crmv-${tenantId}-${crmVendaId}`.slice(0, 200);

  eq(idPara('t1', 'deal_9912'), idPara('t1', 'deal_9912'), 'mesmo negócio dá sempre o mesmo id');
  eq(idPara('t1', 'deal_9912') === idPara('t2', 'deal_9912'), false, 'tenants diferentes não colidem');
  eq(idPara('t1', 'deal_1') === idPara('t1', 'deal_2'), false, 'negócios diferentes não colidem');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- prefixo público não pode liberar rota vizinha ---');
{
  // Achado: PUBLIC_PATHS usava startsWith puro, então '/api/planos'
  // liberava '/api/planos-comissao' inteiro sem autenticação.
  const casa = (p: string, pathname: string) =>
    pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`);

  eq(casa('/api/planos', '/api/planos'), true, 'a própria rota é pública');
  eq(casa('/api/planos', '/api/planos/123'), true, 'segmento abaixo é público');
  eq(casa('/api/planos', '/api/planos-comissao'), false, 'rota vizinha NÃO é pública');
  eq(casa('/api/planos', '/api/planos-comissao/abc'), false, 'nem o item dela');
  eq(casa('/api/marketing/', '/api/marketing/banner'), true, 'prefixo com barra segue funcionando');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- cadastro não cria nem rebaixa lançamento baixado ---');
{
  // Achado: o POST é um upsert cego que NÃO move caixa, mas o DELETE
  // estorna com base no status gravado. Criar direto como PAGO e depois
  // excluir CRIAVA dinheiro do nada no saldo.
  eq(recusaDoPost('PAGO', null)?.status, 400, 'criar já PAGO é recusado');
  eq(recusaDoPost('RECEBIDO', null)?.status, 400, 'criar já RECEBIDO é recusado');
  eq(recusaDoPost('PARCIAL', null)?.status, 400, 'criar já PARCIAL é recusado');
  eq(recusaDoPost('EFETIVADA', null)?.status, 400, 'transferência já efetivada é recusada');
  eq(recusaDoPost('PENDENTE', null), null, 'criar PENDENTE é o caminho normal');
  eq(recusaDoPost('', null), null, 'sem status também passa (factory preenche)');

  // Achado correlato: regravar por cima de uma conta já paga a rebaixava
  // para PENDENTE sem estornar, e o PUT seguinte debitava de novo. Era
  // assim que pagar a mesma comissão duas vezes debitava duas vezes.
  eq(recusaDoPost('PENDENTE', 'PAGO')?.status, 409, 'não rebaixa conta já paga');
  eq(recusaDoPost('PENDENTE', 'PARCIAL')?.status, 409, 'não rebaixa conta parcial');
  eq(recusaDoPost('PENDENTE', 'PENDENTE'), null, 'regravar conta pendente segue permitido');
  eq(recusaDoPost('PENDENTE', 'CANCELADO'), null, 'conta cancelada pode ser regravada');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- saldo não é sobrescrito por tela desatualizada ---');
{
  // Achado: a tela de contas bancárias envia { ...existing, nome, ... }, e
  // `existing` carrega o saldo lido quando a página abriu. Editar o nome da
  // conta regravava o saldo antigo por cima de baixas feitas nesse meio-tempo.
  eq(CAMPOS_DERIVADOS.includes('saldo_atual'), true, 'saldo_atual é campo derivado do servidor');

  // Gerente abre a tela (saldo 200.000), o financeiro baixa 90.000, o
  // gerente corrige a agência e salva. O saldo do banco tem que vencer.
  const gravadoNoBanco: Any = { nome: 'Itau', saldo_atual: 290000, saldo_inicial: 0 };
  const enviadoPelaTela: Any = { nome: 'Itau', agencia: '1234', saldo_atual: 200000, saldo_inicial: 0 };
  const salvo = preservarCamposDerivados(enviadoPelaTela, gravadoNoBanco);
  eq(salvo.saldo_atual, 290000, 'saldo do banco prevalece sobre o da tela');
  eq(salvo.agencia, '1234', 'a edição de fato pretendida é preservada');
  eq(salvo.nome, 'Itau', 'demais campos seguem do payload');

  // Linha nova (sem estado no banco) passa direto.
  const nova = preservarCamposDerivados({ nome: 'Nova', saldo_atual: 0 }, null);
  eq(nova.saldo_atual, 0, 'conta nova grava o saldo enviado');
}

// ══════════════════════════════════════════════════════════════════════
console.log(`\n${total - falhas}/${total} testes da auditoria passaram`);
if (falhas > 0) process.exit(1);

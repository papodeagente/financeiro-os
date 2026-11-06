/**
 * Comissão do mês que vem do CRM (src/lib/comissao-do-crm.ts), decisões D31 a
 * D40 de 05/11/2026: a Área Comercial manda UM extrato por pessoa e
 * competência (COMISSAO_DO_MES) e o financeiro da Entur paga.
 *
 * O que se prova (só regra, sem banco):
 *   (a) a leitura do extrato: o que é recusado e por quê, com o motivo;
 *   (b) a conta fecha: bruto menos compensado é o total, e a soma das linhas
 *       é o bruto, em centavos inteiros;
 *   (c) nomes e datas: id da comissão, descrição, vencimento no dia 10 do mês
 *       seguinte (inclusive na virada do ano), mês por extenso;
 *   (d) a linha em comissões, com as linhas e o eventId;
 *   (e) versão nova do mesmo mês: o que grava, o que já existia e o que é recusado;
 *   (f) o aviso COMISSAO_PAGA e a fonte da comissão da conta.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-comissao-do-crm.ts
 */
import {
  AVISO_COMISSAO_VEM_DO_CRM, ComissaoVemDoCrm, avisoDeComissaoPaga, decidirVersao, descricaoDaComissaoDoCrm, detalheDaComissaoDoCrm,
  ehComissaoDoCrm, fonteDosDados, idDaComissaoDoCrm, idDoAvisoDeComissaoPaga, lerExtratoDoCrm, linhaDaComissaoDoCrm, mesPorExtenso,
  vencimentoDaComissaoDoCrm, type ExtratoDoMes,
} from '../src/lib/comissao-do-crm.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}
const motivo = (r: ReturnType<typeof lerExtratoDoCrm>) => (r.ok ? null : r.motivo);

const extrato = (o: Record<string, unknown> = {}) => ({
  tipo: 'COMISSAO_DO_MES', eventId: 'ev-1', versao: 1, competencia: '2026-11',
  beneficiario: { usuarioId: 420008, nome: 'Luan Amador', email: 'Luan@Entur.com.br' },
  brutoCents: 35000, compensadoCents: 5000, totalCents: 30000,
  linhas: [
    { contaId: 9001, conta: 'Agência A', modelo: 'novo', papel: 'vendedor', parcela: 1, tipo: 'comissao', valorCents: 20000, gatilho: '1º recebimento', gatilhoEm: '2026-11-08T12:00:00Z' },
    { contaId: 9002, conta: 'Agência B', modelo: 'novo', papel: 'vendedor', parcela: 2, tipo: 'comissao', valorCents: 20000, gatilho: '2º recebimento', gatilhoEm: '2026-11-20T12:00:00Z' },
    { contaId: 9003, conta: 'Agência C', modelo: 'novo', papel: 'vendedor', parcela: 1, tipo: 'estorno', valorCents: -5000, gatilho: 'estorno', gatilhoEm: '2026-11-25T12:00:00Z' },
  ],
  geradoEm: '2026-12-01T03:00:00.000Z',
  ...o,
});
const ler = (o: Record<string, unknown> = {}, eventId = 'ev-1', mesAtual = '2026-12') => lerExtratoDoCrm(extrato(o), { eventId, mesAtual });

// ══════════════════════════════════════════════════════════════════════
console.log('--- (a) a leitura do extrato ---');
{
  const r = ler();
  eq(r.ok, true, 'o extrato do contrato é aceito');
  const e = (r as { ok: true; valor: ExtratoDoMes }).valor;
  eq([e.eventId, e.competencia, e.usuarioId, e.beneficiario.usuarioId, e.beneficiario.email, e.totalCents, e.linhas.length],
    ['ev-1', '2026-11', '420008', 420008, 'luan@entur.com.br', 30000, 3], 'campos lidos: o usuarioId fica como veio e em texto, o e-mail em minúsculas');
  eq(ler({ eventId: undefined }).ok, true, 'sem eventId no payload vale o id do evento');
  eq(motivo(ler({ eventId: 'outro' })), 'O eventId do extrato (outro) não é o id do evento (ev-1): os dois precisam ser iguais.', 'eventId diferente do id do evento é recusado');
  eq(motivo(ler({ tipo: 'COMISSAO_APURADA' })), 'O payload diz ser "COMISSAO_APURADA", e não COMISSAO_DO_MES.', 'outro tipo no payload é recusado');
  eq(motivo(ler({ versao: 2 })), 'Versão do extrato não suportada (2): este financeiro entende a versão 1.', 'versão desconhecida é recusada');
  eq(motivo(lerExtratoDoCrm(null, { eventId: 'x' })), 'O extrato não veio: o payload precisa ser um objeto.', 'payload vazio é recusado');
  eq(motivo(lerExtratoDoCrm([1, 2], { eventId: 'x' })), 'O extrato não veio: o payload precisa ser um objeto.', 'lista não é extrato');
  eq(motivo(ler({ competencia: '2026-13' })), 'A competência precisa estar no formato AAAA-MM (ex.: 2026-11).', 'competência inválida');
  eq(motivo(ler({ competencia: '2026-11-01' })), 'A competência precisa estar no formato AAAA-MM (ex.: 2026-11).', 'competência com dia não é competência');
  eq(motivo(ler({ competencia: '2027-01' })), 'A competência 2027-01 ainda não começou.', 'competência no futuro é recusada');
  eq(ler({ competencia: '2026-12' }).ok, true, 'a competência do mês corrente passa');
  eq(motivo(ler({ beneficiario: undefined })), 'Falta o beneficiário (usuarioId, nome e email).', 'sem beneficiário');
  eq(motivo(ler({ beneficiario: { usuarioId: 'com espaço', nome: 'X', email: '' } })), 'O usuarioId do beneficiário precisa ser o id do usuário no CRM.', 'usuarioId com espaço não entra no id');
  eq(motivo(ler({ beneficiario: { usuarioId: -3, nome: 'X', email: '' } })), 'O usuarioId do beneficiário precisa ser o id do usuário no CRM.', 'usuarioId negativo');
  eq(motivo(ler({ beneficiario: { usuarioId: 1, nome: '  ', email: '' } })), 'Falta o nome do beneficiário.', 'sem nome');
  const prefixado = ler({ beneficiario: { usuarioId: 'crm_user_420008', nome: 'Luan', email: '' } });
  eq(prefixado.ok && prefixado.valor.usuarioId, '420008', 'o usuarioId no formato crm_user_<id> vira o id puro');
  eq(motivo(ler({ geradoEm: 'ontem' })), 'Falta geradoEm (data e hora em que o CRM gerou o extrato, ISO 8601).', 'geradoEm que não é data');
  eq(motivo(ler({ linhas: 'nada' })), 'linhas precisa ser uma lista (pode ser vazia).', 'linhas que não são lista');
  eq(motivo(ler({ linhas: [{ valorCents: 10.5 }], brutoCents: 1050, compensadoCents: 0, totalCents: 1050 })), 'A linha 1 do extrato não tem valorCents inteiro.', 'centavos quebrados na linha');
  eq(motivo(ler({ linhas: [7] })), 'A linha 1 do extrato não é um objeto.', 'linha que não é objeto');
  eq(motivo(ler({ linhas: new Array(2001).fill({ valorCents: 0 }), brutoCents: 0, compensadoCents: 0, totalCents: 0 })), 'Linhas demais no extrato (até 2000).', 'limite de linhas');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (b) a conta fecha, em centavos ---');
{
  eq(motivo(ler({ brutoCents: 350.5 })), 'brutoCents precisa ser um número inteiro de centavos.', 'bruto quebrado');
  eq(motivo(ler({ compensadoCents: '5000' })), 'compensadoCents precisa ser um número inteiro de centavos.', 'centavos em texto não passam');
  eq(motivo(ler({ totalCents: null })), 'totalCents precisa ser um número inteiro de centavos.', 'sem total');
  eq(motivo(ler({ compensadoCents: -5000, totalCents: 40000 })), 'compensadoCents não pode ser negativo: é o quanto do bruto cobriu saldo negativo de mês anterior.', 'compensado negativo');
  eq(motivo(ler({ totalCents: 29999 })), 'Os números não fecham: brutoCents menos compensadoCents precisa dar totalCents.', 'bruto menos compensado diferente do total');
  eq(motivo(ler({ brutoCents: 5000, compensadoCents: 10000, totalCents: -5000 })), 'totalCents não pode ser negativo.', 'total negativo');
  const soma = motivo(ler({ brutoCents: 40000, compensadoCents: 10000, totalCents: 30000 })) ?? '';
  eq(/^A soma das linhas \(R\$\s350,00\) não é o bruto do extrato \(R\$\s400,00\)\.$/.test(soma), true, 'a soma das linhas precisa ser o bruto');
  const tostoes = ler({
    linhas: [{ valorCents: 10 }, { valorCents: 20 }, { valorCents: 1 }], brutoCents: 31, compensadoCents: 0, totalCents: 31,
  });
  eq(tostoes.ok, true, 'R$ 0,10 + R$ 0,20 + R$ 0,01 fecha com R$ 0,31 (sem erro de vírgula flutuante)');
  eq(ler({ linhas: [], brutoCents: 0, compensadoCents: 0, totalCents: 0 }).ok, true, 'extrato zerado e sem linhas é lido (é a versão que cancela)');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (c) nomes e datas ---');
{
  eq(idDaComissaoDoCrm('2026-11', '420008'), 'comissao-crm-2026-11-420008', 'id da comissão: comissao-crm-<AAAA-MM>-<usuarioId>');
  eq([ehComissaoDoCrm('comissao-crm-2026-11-1'), ehComissaoDoCrm('comissao-mrr-u-2026-11'), ehComissaoDoCrm(null)], [true, false, false], 'reconhece a comissão do CRM pelo id');
  eq([mesPorExtenso('2026-03'), mesPorExtenso('2026-12')], ['março/2026', 'dezembro/2026'], 'mês por extenso');
  eq(descricaoDaComissaoDoCrm('2026-11', 'Luan Amador'), 'Comissão de novembro/2026, Luan Amador', 'descrição da conta a pagar');
  eq([vencimentoDaComissaoDoCrm('2026-11'), vencimentoDaComissaoDoCrm('2026-12'), vencimentoDaComissaoDoCrm('2027-01')], ['2026-12-10', '2027-01-10', '2027-02-10'], 'vence no dia 10 do mês seguinte, inclusive na virada do ano');
  eq(idDoAvisoDeComissaoPaga('t1', 'cp-comissao-comissao-crm-2026-11-1'), 'comissao-paga:t1:cp-comissao-comissao-crm-2026-11-1', 'um aviso por conta a pagar');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (d) a linha em comissões ---');
const lido = (ler() as { ok: true; valor: ExtratoDoMes }).valor;
{
  const l = linhaDaComissaoDoCrm(lido, { vendedorId: 'u-luan', recebidoEm: '2026-12-01T03:01:00.000Z' });
  eq([l.id, l.origem, l.vendedor_id, l.vendedor_nome, l.status, l.valor_base, l.valor_comissao, l.data_venda, l.venda_id],
    ['comissao-crm-2026-11-420008', 'crm', 'u-luan', 'Luan Amador', 'CALCULADA', 350, 300, '2026-11-30', 'crm-2026-11'], 'origem crm, pessoa, bruto e total em reais, fim da competência');
  eq([l.crm.evento_id, l.crm.competencia, l.crm.bruto_cents, l.crm.compensado_cents, l.crm.total_cents, l.crm.linhas.length, l.crm.versoes],
    ['ev-1', '2026-11', 35000, 5000, 30000, 3, ['ev-1']], 'o JSON guarda competência, bruto, compensado, total, as linhas e o eventId');
  const zero = linhaDaComissaoDoCrm({ ...lido, eventId: 'ev-2', brutoCents: 0, compensadoCents: 0, totalCents: 0, linhas: [] }, { vendedorId: 'u-luan', recebidoEm: 'x', versoesAnteriores: ['ev-1'] });
  eq([zero.status, zero.valor_comissao, zero.crm.versoes], ['CANCELADA', 0, ['ev-1', 'ev-2']], 'total zero: a linha nasce cancelada e guarda as versões aceitas');
  const lida = detalheDaComissaoDoCrm(JSON.parse(JSON.stringify(l)));
  eq([lida?.evento_id, lida?.total_cents, lida?.beneficiario.usuarioId], ['ev-1', 30000, 420008], 'o detalhe gravado é lido de volta');
  eq([detalheDaComissaoDoCrm({ origem: 'mrr' }), detalheDaComissaoDoCrm(null)], [null, null], 'linha que não é do CRM não tem detalhe');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (e) versão nova do mesmo mês ---');
{
  const gravada = linhaDaComissaoDoCrm(lido, { vendedorId: 'u-luan', recebidoEm: 'x' });
  const atual = { status: 'CALCULADA', detalhe: gravada.crm };
  const pendente = { status: 'PENDENTE', aprovacao: '' };
  const v2 = { ...lido, eventId: 'ev-2', brutoCents: 45000, totalCents: 40000, geradoEm: '2026-12-01T09:00:00.000Z' };
  eq(decidirVersao(null, null, lido).acao, 'gravar', 'nada gravado: grava (cria)');
  eq(decidirVersao(atual, pendente, lido).acao, 'ja_existia', 'o mesmo eventId: já existia');
  eq(decidirVersao({ ...atual, detalhe: { ...gravada.crm, evento_id: 'ev-3', versoes: ['ev-1', 'ev-3'] } }, pendente, lido).acao, 'ja_existia', 'um eventId já aceito antes: já existia');
  eq(decidirVersao(atual, pendente, v2).acao, 'gravar', 'eventId novo com a conta pendente: atualiza');
  eq(decidirVersao(atual, { status: 'CANCELADO', aprovacao: '' }, v2).acao, 'gravar', 'conta cancelada (versão zerada antes) volta a valer com a versão nova');
  eq(decidirVersao(atual, null, v2).acao, 'gravar', 'conta que sumiu é refeita');
  const paga = decidirVersao(atual, { status: 'PAGO', aprovacao: '' }, v2);
  eq([paga.acao, paga.acao === 'recusar' && /já foi paga .*Nada foi alterado/.test(paga.motivo)], ['recusar', true], 'conta paga com outro total: recusa e diz o porquê');
  eq(decidirVersao(atual, { status: 'PARCIAL', aprovacao: '' }, v2).acao, 'recusar', 'conta paga em parte também');
  eq(decidirVersao(atual, { status: 'PAGO', aprovacao: '' }, { ...v2, brutoCents: 35000, totalCents: 30000 }).acao, 'ja_existia', 'conta paga e a versão nova com o mesmo total: já existia, nada muda');
  const aprovada = decidirVersao(atual, { status: 'PENDENTE', aprovacao: 'APROVADO' }, v2);
  eq([aprovada.acao, aprovada.acao === 'recusar' && /aprovada para pagamento/.test(aprovada.motivo)], ['recusar', true], 'pagamento aprovado com outro total: recusa');
  eq(decidirVersao({ ...atual, status: 'APROVADA' }, pendente, v2).acao, 'recusar', 'comissão aprovada na tela de comissões: recusa');
  eq(decidirVersao(atual, { status: 'PENDENTE', aprovacao: 'PENDENTE' }, v2).acao, 'gravar', 'pedido de aprovação ainda aberto não trava (a aprovação confere o valor de novo)');
  const antiga = decidirVersao({ ...atual, detalhe: { ...gravada.crm, evento_id: 'ev-9', versoes: ['ev-9'], gerado_em: '2026-12-02T00:00:00.000Z' } }, pendente, v2);
  eq([antiga.acao, antiga.acao === 'recusar' && /mais nova/.test(antiga.motivo)], ['recusar', true], 'versão mais antiga que a que vale não passa por cima');
  const zero = { ...lido, eventId: 'ev-0', brutoCents: 0, compensadoCents: 0, totalCents: 0, linhas: [] };
  eq(decidirVersao(atual, pendente, { ...zero, geradoEm: '2026-12-02T00:00:00.000Z' }).acao, 'gravar', 'total zero com comissão pendente: grava (cancela)');
  const nada = decidirVersao(null, null, zero);
  eq([nada.acao, nada.acao === 'recusar' && /não há comissão deste mês para cancelar/.test(nada.motivo)], ['recusar', true], 'total zero sem comissão gravada: recusa');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (f) o aviso de volta e a fonte da comissão ---');
{
  const d = linhaDaComissaoDoCrm(lido, { vendedorId: 'u', recebidoEm: 'x' }).crm;
  eq(avisoDeComissaoPaga(d, { data_pagamento: '2026-12-10', valor_pago: 300, valor_final: 300 }),
    { competencia: '2026-11', usuarioId: 420008, eventIdOrigem: 'ev-1', pagoEm: '2026-12-10', valorPagoCents: 30000 }, 'COMISSAO_PAGA: competência, usuarioId como veio, eventId de origem, data e valor pago em centavos');
  eq(avisoDeComissaoPaga(d, { data_pagamento: '2026-12-10T15:00:00', valor_pago: null, valor_final: 300.1 }).valorPagoCents, 30010, 'sem valor pago gravado vale o valor final, em centavos');
  eq([fonteDosDados({}), fonteDosDados(null), fonteDosDados({ fonte_da_comissao: 'mrr' }), fonteDosDados({ fonte_da_comissao: 'qualquer' })], ['crm', 'crm', 'mrr', 'crm'], 'a fonte da comissão: CRM por padrão; só "mrr" gravado volta às faixas');
  const e = new ComissaoVemDoCrm();
  eq([e.message, e.status, AVISO_COMISSAO_VEM_DO_CRM], ['A comissão agora vem do CRM (Área Comercial). As metas de MRR seguem só para acompanhamento.', 409, e.message], 'a recusa das faixas, com o texto combinado');
}

console.log(`\n${total - falhas}/${total} testes da comissão do CRM passaram`);
if (falhas > 0) process.exit(1);

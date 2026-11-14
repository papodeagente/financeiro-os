/**
 * "Perguntar em texto" (E7, fechamento): a orquestração com a IA dublada
 * (src/lib/perguntar/orquestrar.ts) e as partes puras das ferramentas.
 *
 * Prova: a IA só pede ferramentas da lista fixa; quem roda é o servidor; o
 * que volta para a IA é só o resultado (recusa vai como erro, sem número);
 * várias ferramentas numa rodada voltam numa mensagem só; o raciocínio volta
 * inteiro; o limite de rodadas para o laço; erro, recusa e resposta vazia da
 * IA viram frases nossas.
 *
 * Uso: node --experimental-strip-types scripts/run-tests.mjs scripts/test-perguntar.ts
 */
import { responderPergunta, MAX_RODADAS, INSTRUCAO_DA_PERGUNTA } from '../src/lib/perguntar/orquestrar.ts';
import { filtrosDoEndereco } from '../src/app/financeiro-ag/contas/filtro-do-endereco.ts';
import {
  DEFINICOES_DAS_FERRAMENTAS, NOMES_DAS_FERRAMENTAS, dataBR, ehFerramenta, resultadoParaIa, temAlgumDireito, type ResultadoDaFerramenta,
} from '../src/lib/perguntar/definicoes.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

console.log('--- Ferramentas fixas ---');
eq(DEFINICOES_DAS_FERRAMENTAS.map(d => d.name), [...NOMES_DAS_FERRAMENTAS], 'cada ferramenta da lista tem definição');
eq(DEFINICOES_DAS_FERRAMENTAS.every(d => d.input_schema.additionalProperties === false), true, 'nenhuma aceita parâmetro fora do esquema');
eq(DEFINICOES_DAS_FERRAMENTAS.some(d => JSON.stringify(d).toLowerCase().includes('sql')), false, 'nenhuma ferramenta recebe SQL');
eq([ehFerramenta('cobrancas'), ehFerramenta('executar_sql'), ehFerramenta(5)], [true, false, false], 'só nomes da lista');
eq(dataBR('2026-11-06'), '06/11/2026', 'data por extenso');
eq(temAlgumDireito({ verFinanceiro: false, verSaldos: false, relatorios: false, verReceita: true, vendedorId: 'u', contasLiberadas: null, empresas: null }), false,
  'sem financeiro, saldos nem relatórios: a caixa não serve');
const recusado: ResultadoDaFerramenta = { ferramenta: 'saldos_das_contas', titulo: 'Saldos', recusado: 'Seu acesso não inclui ver o saldo das contas bancárias.', numeros: [], filtro: [], link: null, linhas: [] };
eq(JSON.parse(resultadoParaIa(recusado)), { recusado: true, motivo: 'Seu acesso não inclui ver o saldo das contas bancárias.' }, 'recusa vai para a IA sem número');
eq(INSTRUCAO_DA_PERGUNTA.includes('Nunca invente'), true, 'a instrução proíbe inventar número');

// --- A IA dublada --------------------------------------------------------------
type Pedido = { system: string; tools: Array<{ name: string }>; messages: Array<{ role: string; content: unknown }>; model: string };
function iaFalsa(respostas: Array<{ status?: number; corpo: unknown } | (() => { status?: number; corpo: unknown })>) {
  const pedidos: Pedido[] = [];
  let i = 0;
  const fetcher = (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
    pedidos.push(JSON.parse(init.body));
    const r0 = respostas[Math.min(i++, respostas.length - 1)];
    const r = typeof r0 === 'function' ? r0() : r0;
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetcher, pedidos };
}
const pedeFerramenta = (...usos: Array<{ id: string; name: string; input: unknown }>) => ({
  corpo: { model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '', signature: 'x' }, ...usos.map(u => ({ type: 'tool_use', ...u }))] },
});
const responde = (texto: string) => ({ corpo: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: texto }] } });

const executadas: Array<{ nome: string; entrada: unknown }> = [];
async function executar(nome: string, entrada: unknown): Promise<ResultadoDaFerramenta> {
  executadas.push({ nome, entrada });
  if (nome === 'saldos_das_contas') return recusado;
  return {
    ferramenta: 'contas_a_pagar_e_receber', titulo: 'Contas a pagar e a receber',
    numeros: [{ rotulo: 'Em aberto a receber', valor: 1234.5, tipo: 'dinheiro' }], filtro: ['A receber'], link: '/financeiro-ag/contas?tipo=receber', linhas: [],
  };
}
const base = { apiKey: 'sk-teste', modelo: 'claude-opus-5-5', hoje: '2026-11-06', executar };

console.log('--- Uma ferramenta e a resposta ---');
{
  const { fetcher, pedidos } = iaFalsa([
    pedeFerramenta({ id: 'tu1', name: 'contas_a_pagar_e_receber', input: { tipo: 'receber', situacao: 'em_aberto', data: 'vencimento', pessoa: 'Sol' } }),
    responde('Você tem R$ 1.234,50 a receber da Sol.'),
  ]);
  executadas.length = 0;
  const r = await responderPergunta({ ...base, pergunta: 'quanto tenho a receber da Sol este mês?', fetcher });
  eq(r.ok && r.texto, 'Você tem R$ 1.234,50 a receber da Sol.', 'texto da IA');
  eq(r.ok && r.resultados.map(x => x.numeros[0].valor), [1234.5], 'os números vêm da ferramenta');
  eq(executadas, [{ nome: 'contas_a_pagar_e_receber', entrada: { tipo: 'receber', situacao: 'em_aberto', data: 'vencimento', pessoa: 'Sol' } }], 'quem roda é o servidor');
  eq([pedidos.length, pedidos[0].tools.map(t => t.name).join(','), pedidos[0].model], [2, NOMES_DAS_FERRAMENTAS.join(','), 'claude-opus-5-5'], 'duas idas, com as ferramentas fixas');
  eq(String(pedidos[0].messages[0].content).includes('Hoje é 2026-11-06'), true, 'a data de hoje vai na mensagem');
  eq(pedidos[0].system, INSTRUCAO_DA_PERGUNTA, 'a instrução vai como sistema');
  const volta = pedidos[1].messages;
  eq([volta[1].role, (volta[1].content as Array<{ type: string }>)[0].type], ['assistant', 'thinking'], 'o que a IA mandou volta inteiro, com o raciocínio');
  const resultado = (volta[2].content as Array<{ type: string; tool_use_id: string; content: string; is_error?: boolean }>)[0];
  eq([resultado.type, resultado.tool_use_id, JSON.parse(resultado.content).numeros[0].valor, resultado.is_error], ['tool_result', 'tu1', 1234.5, undefined], 'resultado da ferramenta volta para a IA');
}

console.log('--- Duas ferramentas na mesma rodada; uma recusada ---');
{
  const { fetcher, pedidos } = iaFalsa([
    pedeFerramenta(
      { id: 'a', name: 'contas_a_pagar_e_receber', input: { tipo: 'pagar', situacao: 'em_aberto', data: 'vencimento' } },
      { id: 'b', name: 'saldos_das_contas', input: {} },
    ),
    responde('Seu acesso não inclui o saldo das contas.'),
  ]);
  const r = await responderPergunta({ ...base, pergunta: 'quanto tenho a pagar e qual o saldo?', fetcher });
  const msg = pedidos[1].messages[2].content as Array<{ tool_use_id: string; is_error?: boolean; content: string }>;
  eq(msg.map(m => m.tool_use_id), ['a', 'b'], 'as duas respostas numa mensagem só');
  eq([msg[1].is_error, JSON.parse(msg[1].content).recusado, JSON.parse(msg[1].content).numeros], [true, true, undefined], 'a recusada volta como erro, sem número');
  eq(r.ok && r.resultados.map(x => Boolean(x.recusado)), [false, true], 'a tela recebe os dois cartões, um recusado');
}

console.log('--- Sem ferramenta: a IA diz que não dá ---');
{
  const { fetcher } = iaFalsa([responde('Não tenho uma consulta para isso. Pergunte sobre contas, saldos, DRE ou vendas.')]);
  const r = await responderPergunta({ ...base, pergunta: 'qual a previsão do tempo?', fetcher });
  eq([r.ok, r.ok && r.resultados.length], [true, 0], 'resposta sem cartões');
}

console.log('--- Falhas da IA ---');
{
  let r = await responderPergunta({ ...base, pergunta: 'x?', fetcher: iaFalsa([{ status: 500, corpo: { error: { message: 'detalhe do provedor' } } }]).fetcher });
  eq([r.ok, !r.ok && r.status, !r.ok && /código 500/.test(r.erro), !r.ok && /detalhe/.test(r.erro)], [false, 502, true, false], 'erro do provedor: frase nossa');
  r = await responderPergunta({ ...base, pergunta: 'x?', fetcher: iaFalsa([{ status: 401, corpo: {} }]).fetcher });
  eq(!r.ok && r.erro.includes('chave de IA da agência foi recusada'), true, 'chave recusada');
  r = await responderPergunta({ ...base, pergunta: 'x?', fetcher: iaFalsa([{ corpo: { stop_reason: 'refusal', content: [] } }]).fetcher });
  eq(!r.ok && r.status, 422, 'IA recusou');
  r = await responderPergunta({ ...base, pergunta: 'x?', fetcher: iaFalsa([{ corpo: { stop_reason: 'end_turn', content: [{ type: 'text', text: '   ' }] } }]).fetcher });
  eq(!r.ok && r.status, 502, 'resposta vazia');
  r = await responderPergunta({ ...base, pergunta: 'x?', fetcher: iaFalsa([{ corpo: { stop_reason: 'end_turn', content: 'lixo' } }]).fetcher });
  eq(!r.ok && r.status, 502, 'resposta malformada (content não é lista)');
  r = await responderPergunta({ ...base, pergunta: 'x?', fetcher: iaFalsa([{ corpo: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'cobrancas' }] } }]).fetcher });
  eq(!r.ok && r.status, 502, 'pedido de ferramenta sem id é ignorado');
  const erroDeRede = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
  r = await responderPergunta({ ...base, pergunta: 'x?', fetcher: erroDeRede });
  eq(!r.ok && r.status, 504, 'sem rede: 504 com frase nossa');
}

console.log('--- Limite de rodadas ---');
{
  let n = 0;
  const { fetcher, pedidos } = iaFalsa([() => pedeFerramenta({ id: `t${++n}`, name: 'contas_a_pagar_e_receber', input: { tipo: 'ambos', situacao: 'todas', data: 'vencimento' } })]);
  const r = await responderPergunta({ ...base, pergunta: 'laço', fetcher });
  eq([pedidos.length, r.ok, r.ok && r.resultados.length, r.rodadas], [MAX_RODADAS, true, MAX_RODADAS, MAX_RODADAS], 'para depois de MAX_RODADAS, com os cartões que já tem');
}

console.log('--- Pedidos demais numa rodada ---');
{
  const usos = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, name: 'contas_a_pagar_e_receber', input: { tipo: 'receber', situacao: 'todas', data: 'vencimento' } }));
  const { fetcher, pedidos } = iaFalsa([pedeFerramenta(...usos), responde('ok')]);
  executadas.length = 0;
  await responderPergunta({ ...base, pergunta: 'muitas', fetcher });
  const volta = pedidos[1].messages[2].content as Array<{ is_error?: boolean }>;
  eq([executadas.length, volta.length, volta.filter(v => v.is_error).length], [5, 7, 2], 'roda até 5; as outras voltam como erro, todas respondidas');
}

console.log('--- O link abre a lista de contas com o filtro ---');
{
  const padrao = {
    periodo: 'MES_ATUAL', de: '2026-11-01', ate: '2026-11-30', data: 'vencimento' as const, situacao: 'todas' as const, tipo: 'ambos' as const,
    busca: '', em: 'tudo' as const, categoria: '', centro: '', conta: '', cobranca: 'todas' as const,
  };
  eq(filtrosDoEndereco('', padrao), padrao, 'sem parâmetro: a tela de sempre (congelado)');
  eq(filtrosDoEndereco('?outra=1', padrao), padrao, 'parâmetro desconhecido: a tela de sempre');
  eq(filtrosDoEndereco('?cobranca=sem_boleto', padrao), { ...padrao, periodo: 'TUDO', de: '', ate: '', cobranca: 'sem_boleto' },
    'atalho da tela Cobranças: a cobrança em todo o período, como antes (congelado)');
  eq(filtrosDoEndereco('?cobranca=todas', padrao), padrao, 'atalho com "todas": nada muda, como antes (congelado)');
  eq(filtrosDoEndereco('?cobranca=xyz', padrao), padrao, 'atalho inválido: nada muda, como antes (congelado)');
  eq(
    filtrosDoEndereco('?tipo=receber&situacao=em_aberto&data=vencimento&de=2026-11-01&ate=2026-11-30&busca=sol&em=pessoa', padrao),
    { ...padrao, periodo: 'PERSONALIZADO', tipo: 'receber', situacao: 'em_aberto', busca: 'sol', em: 'pessoa' },
    'link da resposta: tipo, situação, período e pessoa',
  );
  eq(filtrosDoEndereco('?tipo=pagar&situacao=liquidado&data=liquidacao&conta=cb1', padrao),
    { ...padrao, periodo: 'TUDO', de: '', ate: '', tipo: 'pagar', situacao: 'liquidado', data: 'liquidacao', conta: 'cb1' }, 'sem período: todo o período');
  eq(filtrosDoEndereco('?tipo=x&situacao=y&data=z&de=ontem', padrao), { ...padrao, periodo: 'TUDO', de: '', ate: '' }, 'valores inválidos ficam no padrão');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);

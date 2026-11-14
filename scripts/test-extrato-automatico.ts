/**
 * Extrato automático (06/11/2026, E6 parte B): regras puras, leitor de
 * arquivo (comportamento congelado), conferência do certificado e o
 * adaptador do Inter contra um cliente HTTP simulado com as respostas da
 * documentação oficial. Nenhuma chamada de verdade ao banco.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-extrato-automatico.ts
 */
import { parseCSV, parseOFX, lerArquivoDeExtrato } from '../src/lib/extrato-arquivo.ts';
import { adaptadorArquivo } from '../src/lib/extrato-automatico/adaptador-arquivo.ts';
import {
  adaptadorInter, normalizarTransacaoInter, lerSaldoInter, dataDoInter, limparEspacamentoInter,
  INTER_HOSTS, INTER_INTERVALO_BANKING_MS,
} from '../src/lib/extrato-automatico/adaptador-inter.ts';
import { conferirCertificadoEChave } from '../src/lib/extrato-automatico/material-certificado.ts';
import { FalhaColeta, ehFalhaColeta } from '../src/lib/extrato-automatico/contrato.ts';
import type { PedidoBanco, RespostaBanco, CredencialDecifrada } from '../src/lib/extrato-automatico/contrato.ts';
import { adaptadorDe, provedoresDeColeta } from '../src/lib/extrato-automatico/registro.ts';
import {
  janelaDaSincronizacao, dividirJanela, decidirAposFalha, saudeDaConexao, avisoDoCertificado, quandoFoi,
  proximaLeituraAposSucesso, quandoSera,
} from '../src/lib/extrato-automatico/regras.ts';
import { gerarParPemDeTeste } from './cert-pem-de-teste.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}
async function falhaDe(fn: () => unknown): Promise<FalhaColeta | null> {
  try { await fn(); return null; } catch (e) { return ehFalhaColeta(e) ? e : (() => { throw e; })(); }
}

// Nada sai para a internet neste teste.
globalThis.fetch = (async () => { throw new Error('o teste não pode chamar a internet'); }) as typeof fetch;

console.log('--- Leitor de arquivo (saiu da tela sem mudar comportamento) ---');
{
  const csv = 'Data;Histórico;Valor\n05/10/2026;Pix recebido;1.234,56\n06/10/26;Tarifa;-12,90\nlixo\n';
  eq(parseCSV(csv), [
    { data: '2026-10-05', descricao: 'Pix recebido', valor: 1234.56 },
    { data: '2026-10-06', descricao: 'Tarifa', valor: -12.9 },
  ], 'CSV brasileiro: data, histórico e valor com vírgula');
  eq(parseCSV('date,memo,amount\n2026-10-05,Deposit,1234.56'), [{ data: '2026-10-05', descricao: 'Deposit', valor: 1234.56 }], 'CSV com ponto decimal não vira 100x');
  const ofx = '<OFX><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005120000<TRNAMT>150.00<FITID>ABC1<MEMO>PIX MARIA</STMTTRN><STMTTRN><DTPOSTED>20261006<TRNAMT>-9.90<FITID>ABC2<NAME>TARIFA</STMTTRN>';
  eq(parseOFX(ofx), [
    { data: '2026-10-05', descricao: 'PIX MARIA', valor: 150, fitid: 'ABC1' },
    { data: '2026-10-06', descricao: 'TARIFA', valor: -9.9, fitid: 'ABC2' },
  ], 'OFX com FITID');
  eq(lerArquivoDeExtrato(ofx, 'extrato.OFX').length, 2, 'decide pelo nome: .OFX');
  eq(lerArquivoDeExtrato(ofx, 'extrato.qfx').length, 2, '.qfx também é OFX');
  eq(lerArquivoDeExtrato(csv, 'extrato.csv').length, 2, '.csv é CSV');
  eq(lerArquivoDeExtrato(ofx, 'ofx').length, 0, 'sem a extensão, CSV (como a tela sempre fez)');

  const r = await adaptadorArquivo.importar!(ofx, 'extrato.ofx');
  eq(r.transacoes.map(t => [t.idExterno, t.valorCentavos, t.tipo]), [['ABC1', 15000, 'CREDITO'], ['ABC2', -990, 'DEBITO']], 'adaptador de arquivo: centavos e FITID como identificador');
  eq(r.janelaCoberta, { de: '2026-10-05', ate: '2026-10-06' }, 'janela coberta = datas do arquivo');
  eq(adaptadorArquivo.capacidades.coletaAutomatica, false, 'arquivo não coleta sozinho');
}

console.log('--- Registro: o domínio decide por capacidade, não por nome ---');
eq(provedoresDeColeta().map(p => p.id), ['inter'], 'só quem coleta sozinho aparece para conectar');
eq(adaptadorDe('nao-existe'), null, 'provedor desconhecido = nenhum adaptador');
eq(provedoresDeColeta()[0].campos.map(c => c.chave), ['clientId', 'clientSecret', 'certificadoPem', 'chavePrivadaPem', 'extra:contaCorrente'], 'campos da tela vêm do adaptador');
eq(provedoresDeColeta()[0].campos.every(c => c.ajuda.length > 20), true, 'cada campo diz onde a agência pega a informação');

console.log('--- Período, divisão e nova tentativa ---');
eq(janelaDaSincronizacao({ ultimaJanelaAte: null, hoje: '2026-11-06' }), { de: '2026-08-09', ate: '2026-11-06' }, 'primeira leitura: os últimos 90 dias');
eq(janelaDaSincronizacao({ ultimaJanelaAte: '2026-11-05', hoje: '2026-11-06' }), { de: '2026-11-02', ate: '2026-11-06' }, 'depois: relê 3 dias antes do fim da última');
eq(janelaDaSincronizacao({ ultimaJanelaAte: '2025-01-01', hoje: '2026-11-06' }), { de: '2025-11-07', ate: '2026-11-06' }, 'parada há mais de um ano: volta no máximo 365 dias');
eq(dividirJanela({ de: '2026-01-01', ate: '2026-06-30' }, 90), [
  { de: '2026-01-01', ate: '2026-03-31' }, { de: '2026-04-01', ate: '2026-06-29' }, { de: '2026-06-30', ate: '2026-06-30' },
], 'divide em blocos de 90 dias, do mais antigo ao mais novo, sem buraco');
eq(dividirJanela({ de: '2026-11-02', ate: '2026-11-06' }, 90).length, 1, 'janela curta é um bloco só');
const agora = new Date('2026-11-06T12:00:00Z');
const h = (d: Date | null) => (d ? (d.getTime() - agora.getTime()) / 3_600_000 : null);
{
  const f1 = decidirAposFalha({ motivo: 'INDISPONIVEL', falhasAntes: 0, aguardarSegundos: 900, agora });
  const f2 = decidirAposFalha({ motivo: 'INDISPONIVEL', falhasAntes: 1, aguardarSegundos: 900, agora });
  const f3 = decidirAposFalha({ motivo: 'INDISPONIVEL', falhasAntes: 2, aguardarSegundos: 900, agora });
  const f4 = decidirAposFalha({ motivo: 'INDISPONIVEL', falhasAntes: 3, aguardarSegundos: 900, agora });
  eq([h(f1.proximaEm), f1.status, f1.avisar], [1, 'ATIVA', false], '1ª falha: tenta em 1 hora');
  eq([h(f2.proximaEm), f2.status], [4, 'ATIVA'], '2ª falha: em 4 horas');
  eq([h(f3.proximaEm), f3.status, f3.avisar], [24, 'ATENCAO', true], '3ª falha: em 24 horas, Atenção e aviso no sino');
  eq([h(f4.proximaEm), f4.status, f4.avisar], [24, 'ATENCAO', false], '4ª falha: não avisa de novo');
  const exp = decidirAposFalha({ motivo: 'CERTIFICADO_EXPIRADO', falhasAntes: 0, aguardarSegundos: null, agora });
  eq([exp.status, exp.proximaEm, exp.avisar], ['EXPIRADA', null, true], 'certificado vencido: para de agendar e avisa');
  const cred = decidirAposFalha({ motivo: 'CREDENCIAL_INVALIDA', falhasAntes: 0, aguardarSegundos: null, agora });
  eq(cred.status, 'EXPIRADA', 'credencial recusada: expirada até reconectar');
  const rl = decidirAposFalha({ motivo: 'RATE_LIMIT', falhasAntes: 1, aguardarSegundos: 60, agora });
  eq([rl.falhasConsecutivas, h(rl.proximaEm)! * 60], [1, 1], 'pausa pedida pelo banco não conta como falha');
  eq(h(proximaLeituraAposSucesso(agora, 1)), 24, 'uma leitura por dia');
  eq(h(proximaLeituraAposSucesso(agora, 4)), 6, 'quatro leituras por dia');
  eq(h(proximaLeituraAposSucesso(agora, 9)), 6, 'no máximo quatro');
}

console.log('--- Saúde da conexão em palavras ---');
{
  eq(quandoFoi('2026-11-06T09:12:00Z', agora), 'hoje às 06:12', 'horário de Brasília, nunca UTC');
  eq(quandoFoi('2026-11-05T13:00:00Z', agora), 'ontem às 10:00', 'ontem');
  eq(quandoFoi('2026-11-03T11:00:00Z', agora), 'em 03/11 às 08:00', 'outro dia');
  eq(quandoSera('2026-11-07T12:00:00Z', agora), 'amanhã às 09:00', 'próxima leitura amanhã, em Brasília');
  eq(quandoSera('2026-11-06T18:00:00Z', agora), 'hoje às 15:00', 'próxima leitura hoje');
  eq(quandoSera('2026-11-06T11:00:00Z', agora), 'em instantes', 'atrasada: em instantes');
  const base = { status: 'ATIVA' as const, ultimaSincronizacaoEm: '2026-11-06T09:12:00Z', falhasConsecutivas: 0, ultimoErro: null, expiraEm: '2027-06-01', proximaSincronizacaoEm: null };
  const ok = saudeDaConexao(base, agora);
  eq([ok.nivel, ok.titulo, ok.certificado], ['ok', 'Conectada, lida hoje às 06:12', null], 'conectada e lida');
  const at = saudeDaConexao({ ...base, status: 'ATENCAO', falhasConsecutivas: 3, ultimoErro: { motivo: 'INDISPONIVEL', mensagem: 'O Inter está fora do ar.' } }, agora);
  eq([at.nivel, at.titulo], ['atencao', 'Atenção, 3 falhas seguidas'], 'atenção com o número de falhas');
  eq(at.frase.startsWith('O Inter está fora do ar.'), true, 'erro em palavras simples');
  const ex = saudeDaConexao({ ...base, status: 'EXPIRADA', ultimoErro: { motivo: 'CREDENCIAL_INVALIDA', mensagem: 'O Inter recusou o ClientId.' } }, agora);
  eq([ex.nivel, ex.titulo, ex.frase.includes('importação por arquivo continua')], ['critico', 'Expirada, reconecte', true], 'expirada lembra que o arquivo continua valendo');
  eq(saudeDaConexao(null, agora).titulo, 'Sem conexão automática', 'conta sem conexão');
  const v30 = saudeDaConexao({ ...base, expiraEm: '2026-11-30' }, agora);
  eq([v30.nivel, v30.certificado?.nivel, v30.certificado?.dias], ['atencao', 'aviso', 24], 'certificado vencendo em 24 dias: aviso');
  eq(avisoDoCertificado('2026-12-07', '2026-11-06')?.nivel ?? null, null, '31 dias: ainda sem aviso');
  eq(avisoDoCertificado('2026-12-06', '2026-11-06')?.nivel, 'aviso', '30 dias: aviso');
  eq(avisoDoCertificado('2026-11-13', '2026-11-06')?.nivel, 'urgente', '7 dias: urgente');
  eq(avisoDoCertificado('2026-11-07', '2026-11-06')?.frase.includes('amanhã'), true, 'vence amanhã');
  eq(avisoDoCertificado('2026-11-05', '2026-11-06')?.nivel, 'vencido', 'venceu ontem');
}

console.log('--- Conferência do certificado e da chave (sem chamar o banco) ---');
const par = gerarParPemDeTeste({ inicio: new Date('2026-01-10T12:00:00Z'), dias: 365 });
const outro = gerarParPemDeTeste();
const vencido = gerarParPemDeTeste({ inicio: new Date('2025-01-01T12:00:00Z'), dias: 300 });
{
  const ok = conferirCertificadoEChave(par.certificadoPem, par.chavePrivadaPem, '2026-11-06', 'Inter');
  eq(ok.expiraEm, '2027-01-10', 'validade lida do certificado');
  const f = (c: string | null, k: string | null) => { try { conferirCertificadoEChave(c, k, '2026-11-06', 'Inter'); return null; } catch (e) { return e as FalhaColeta; } };
  const trocados = f(par.chavePrivadaPem, par.certificadoPem);
  eq([trocados?.motivo, trocados?.mensagemUsuario.includes('trocados')], ['CERTIFICADO_INVALIDO', true], 'certificado e chave trocados');
  const zip = f('PK\u0003\u0004\u0014\u0000conteudo', par.chavePrivadaPem);
  eq(zip?.mensagemUsuario.includes('não o arquivo compactado'), true, 'ZIP enviado inteiro');
  const mist = f(par.certificadoPem, outro.chavePrivadaPem);
  eq(mist?.mensagemUsuario.includes('integrações diferentes'), true, 'chave de outra integração');
  const venc = f(vencido.certificadoPem, vencido.chavePrivadaPem);
  eq([venc?.motivo, venc?.mensagemUsuario.includes('venceu em')], ['CERTIFICADO_EXPIRADO', true], 'certificado vencido com a data');
  eq(f('', par.chavePrivadaPem)?.mensagemUsuario.includes('.crt'), true, 'sem certificado: pede o .crt');
  eq(f('texto qualquer', par.chavePrivadaPem)?.mensagemUsuario.includes('não foi reconhecido'), true, 'certificado ilegível');
  eq(adaptadorInter.expiraEm!({ clientId: 'x', clientSecret: 'y', certificadoPem: par.certificadoPem, chavePrivadaPem: par.chavePrivadaPem, extras: {} }), '2027-01-10', 'expiraEm do adaptador');
}

console.log('--- Normalização do extrato do Inter (formato da documentação) ---');
eq(dataDoInter('01/01/2024'), '2024-01-01', 'data dd/mm/aaaa do saldo');
eq(dataDoInter('2026-11-03'), '2026-11-03', 'data ISO do extrato');
eq(normalizarTransacaoInter({
  idTransacao: 'tx-1', dataInclusao: '2026-11-03 10:00:00', dataTransacao: '2026-11-03', tipoTransacao: 'PIX', tipoOperacao: 'C',
  valor: '1500.00', titulo: 'Pix recebido', descricao: 'PIX RECEBIDO - Cp :00000000-MARIA SILVA', numeroDocumento: '123',
  detalhes: { endToEndId: 'E00416968202211031000abc', nomePagador: 'MARIA SILVA' },
}), {
  idExterno: 'tx-1', data: '2026-11-03', valorCentavos: 150000, tipo: 'CREDITO', descricao: 'PIX RECEBIDO - Cp :00000000-MARIA SILVA',
  saldoAposCentavos: null, pendente: false, categoriaOrigem: 'PIX',
}, 'Pix recebido: identificador, centavos e descrição sem repetir o título');
eq(normalizarTransacaoInter({ dataTransacao: '2026-11-04', tipoOperacao: 'D', valor: '12.9', titulo: 'Tarifa', descricao: 'Manutenção', tipoTransacao: 'TARIFA', detalhes: { endToEndId: 'E-2' } }),
  { idExterno: 'E-2', data: '2026-11-04', valorCentavos: -1290, tipo: 'DEBITO', descricao: 'Tarifa - Manutenção', saldoAposCentavos: null, pendente: false, categoriaOrigem: 'TARIFA' },
  'débito sai negativo; sem idTransacao, o endToEndId identifica');
eq(normalizarTransacaoInter({ tipoOperacao: 'C', valor: '10' }), null, 'sem data, a linha é ignorada');
eq(lerSaldoInter({ disponivel: 2850.55, bloqueadoCheque: 240.25, bloqueadoJudicialmente: 0, limite: 510.35 }, '2026-11-06'),
  { disponivelCentavos: 285055, bloqueadoCentavos: 24025, limiteCentavos: 51035, apuradoEm: '2026-11-06' }, 'saldo em centavos');

console.log('--- Adaptador do Inter contra o banco simulado ---');
interface Simulado {
  pedidos: PedidoBanco[];
  token: () => RespostaBanco;
  extrato: (q: URLSearchParams) => RespostaBanco;
  saldo: () => RespostaBanco;
}
function banco(): Simulado & { http: (p: PedidoBanco) => Promise<RespostaBanco> } {
  const s: Simulado = {
    pedidos: [],
    token: () => ({ status: 200, texto: JSON.stringify({ access_token: 'tok-abc', token_type: 'Bearer', expires_in: 3600, scope: 'extrato.read' }) }),
    extrato: () => ({ status: 200, texto: JSON.stringify({ totalPaginas: 1, ultimaPagina: true, primeiraPagina: true, transacoes: [] }) }),
    saldo: () => ({ status: 200, texto: JSON.stringify({ disponivel: 1000.5 }) }),
  };
  const http = async (p: PedidoBanco) => {
    s.pedidos.push(p);
    const u = new URL(p.url);
    if (u.pathname === '/oauth/v2/token') return s.token();
    if (u.pathname === '/banking/v2/extrato/completo') return s.extrato(u.searchParams);
    if (u.pathname === '/banking/v2/saldo') return s.saldo();
    return { status: 404, texto: '{}' };
  };
  return Object.assign(s, { http });
}
let relogio = Date.parse('2026-11-06T12:00:00Z');
const esperas: number[] = [];
const amb = (b: ReturnType<typeof banco>) => ({ http: b.http, agora: () => relogio, esperar: async (ms: number) => { esperas.push(ms); relogio += ms; } });
const cred: CredencialDecifrada = { clientId: 'cli-1', clientSecret: 'segredo-muito-secreto', certificadoPem: par.certificadoPem, chavePrivadaPem: par.chavePrivadaPem, extras: {} };
{
  limparEspacamentoInter();
  const b = banco();
  const tx = (i: number) => ({ idTransacao: `t${i}`, dataTransacao: '2026-11-05', tipoOperacao: i % 2 ? 'D' : 'C', valor: `${i}.00`, titulo: 'Pix', descricao: `Linha ${i}`, tipoTransacao: 'PIX' });
  b.extrato = q => {
    const pg = Number(q.get('pagina'));
    return { status: 200, texto: JSON.stringify({ totalPaginas: 2, ultimaPagina: pg === 1, transacoes: pg === 0 ? [tx(1), tx(2)] : [tx(3)] }) };
  };
  const r = await adaptadorInter.coletar!(cred, { de: '2026-11-01', ate: '2026-11-06' }, amb(b));
  eq(r.transacoes.map(t => [t.idExterno, t.valorCentavos]), [['t1', -100], ['t2', 200], ['t3', -300]], 'junta as duas páginas');
  eq([r.paginasLidas, r.saldo?.disponivelCentavos], [2, 100050], 'conta as páginas e traz o saldo');
  const tokenPedido = b.pedidos[0];
  eq([tokenPedido.metodo, tokenPedido.url], ['POST', `${INTER_HOSTS.producao}/oauth/v2/token`], 'token no endereço oficial');
  const corpo = new URLSearchParams(tokenPedido.corpo);
  eq([corpo.get('grant_type'), corpo.get('scope'), corpo.get('client_id'), tokenPedido.headers['Content-Type']],
    ['client_credentials', 'extrato.read', 'cli-1', 'application/x-www-form-urlencoded'], 'client credentials com o escopo extrato.read, em formulário');
  eq(b.pedidos.every(p => p.certificadoPem === par.certificadoPem && p.chavePrivadaPem === par.chavePrivadaPem), true, 'toda chamada leva o certificado e a chave (mTLS)');
  const ext = new URL(b.pedidos[1].url);
  eq([ext.pathname, ext.searchParams.get('dataInicio'), ext.searchParams.get('dataFim'), ext.searchParams.get('pagina'), ext.searchParams.get('tamanhoPagina')],
    ['/banking/v2/extrato/completo', '2026-11-01', '2026-11-06', '0', '10000'], 'extrato enriquecido com período e página');
  eq([b.pedidos[1].headers.Authorization, 'x-conta-corrente' in b.pedidos[1].headers], ['Bearer tok-abc', false], 'token reaproveitado; sem conta extra, sem cabeçalho de conta');
  eq(b.pedidos.filter(p => p.url.includes('/oauth/')).length, 1, 'um token só para a leitura inteira');
  eq(esperas.every(ms => ms <= INTER_INTERVALO_BANKING_MS) && esperas.length >= 2, true, 'espaça as chamadas (10 por minuto)');
}
{
  limparEspacamentoInter();
  const b = banco();
  await adaptadorInter.coletar!({ ...cred, extras: { contaCorrente: '00012345-6' } }, { de: '2026-06-01', ate: '2026-11-06' }, amb(b));
  const ext = new URL(b.pedidos[1].url);
  eq([b.pedidos[1].headers['x-conta-corrente'], ext.searchParams.get('dataInicio')], ['123456', '2026-08-09'], 'conta só com números, sem zeros à esquerda; período cortado em 90 dias');
}
{
  const casos: [string, () => RespostaBanco, string, string][] = [
    ['token recusado', () => ({ status: 401, texto: '{"error":"invalid_client"}' }), 'token', 'CREDENCIAL_INVALIDA'],
    ['escopo faltando no token', () => ({ status: 400, texto: '{"error":"invalid_scope","error_description":"scope not allowed"}' }), 'token', 'ESCOPO_INSUFICIENTE'],
    ['403 no extrato', () => ({ status: 403, texto: '{"title":"Acesso Negado"}' }), 'extrato', 'ESCOPO_INSUFICIENTE'],
    ['429 do banco', () => ({ status: 429, texto: '' }), 'extrato', 'RATE_LIMIT'],
    ['503 do banco', () => ({ status: 503, texto: '{"title":"Serviço indisponível"}' }), 'extrato', 'INDISPONIVEL'],
    ['400 de período', () => ({ status: 400, texto: '{"title":"Dados inválidos.","violacoes":[{"razao":"O valor não pode ser nulo.","propriedade":"dataInicio"}]}' }), 'extrato', 'JANELA_INVALIDA'],
  ];
  for (const [nome, resp, onde, motivo] of casos) {
    limparEspacamentoInter();
    const b = banco();
    if (onde === 'token') b.token = resp; else b.extrato = resp;
    const f = await falhaDe(() => adaptadorInter.coletar!(cred, { de: '2026-11-01', ate: '2026-11-06' }, amb(b)));
    eq(f?.motivo, motivo, `${nome} → ${motivo}`);
    eq(JSON.stringify(f).includes('segredo-muito-secreto') || String(f?.mensagemUsuario).includes('BEGIN'), false, `${nome}: a mensagem não carrega segredo`);
  }
  limparEspacamentoInter();
  const b = banco();
  b.http = async () => { throw Object.assign(new Error('write EPROTO SSL alert bad certificate'), { code: 'EPROTO' }); };
  const tls = await falhaDe(() => adaptadorInter.coletar!(cred, { de: '2026-11-01', ate: '2026-11-06' }, amb(b)));
  eq([tls?.motivo, tls?.mensagemUsuario.includes('EPROTO')], ['CERTIFICADO_INVALIDO', false], 'banco recusou o certificado no aperto de mão: frase simples, sem código técnico');
  b.http = async () => { throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }); };
  limparEspacamentoInter();
  eq((await falhaDe(() => adaptadorInter.coletar!(cred, { de: '2026-11-01', ate: '2026-11-06' }, amb(b))))?.motivo, 'INDISPONIVEL', 'sem resposta: indisponível');
  const venc = await falhaDe(() => adaptadorInter.coletar!({ ...cred, certificadoPem: vencido.certificadoPem, chavePrivadaPem: vencido.chavePrivadaPem }, { de: '2026-11-01', ate: '2026-11-06' }, amb(banco())));
  eq(venc?.motivo, 'CERTIFICADO_EXPIRADO', 'certificado vencido nem chama o banco');
}
{
  limparEspacamentoInter();
  const b = banco();
  const v = await adaptadorInter.validarCredencial!(cred, amb(b));
  eq([v.ok, v.saldo?.disponivelCentavos, b.pedidos.map(p => new URL(p.url).pathname)], [true, 100050, ['/oauth/v2/token', '/banking/v2/saldo']], 'validação: token e saldo, sem ler extrato');
  limparEspacamentoInter();
  const sem = banco();
  sem.token = () => ({ status: 200, texto: JSON.stringify({ access_token: 't', scope: 'pagamento-boleto.read' }) });
  eq((await falhaDe(() => adaptadorInter.validarCredencial!(cred, amb(sem))))?.motivo, 'ESCOPO_INSUFICIENTE', 'token sem extrato.read: avisa da permissão');
  eq((await falhaDe(() => adaptadorInter.validarCredencial!({ ...cred, clientSecret: '' }, amb(banco()))))?.motivo, 'CREDENCIAL_INVALIDA', 'sem ClientSecret');
}

console.log(`\n${total - falhas}/${total} testes do extrato automático passaram`);
process.exit(falhas > 0 ? 1 : 0);

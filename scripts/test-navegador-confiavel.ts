/**
 * Navegador confiável (src/lib/navegador-confiavel.ts, 12/11/2026).
 *
 * O selo pula SÓ o código do aplicativo, por 30 dias, no navegador onde a
 * pessoa digitou o código. Estes testes fixam o que não pode afrouxar: o
 * selo morre com a troca de senha ou de 2FA, não serve para outra pessoa
 * nem para o outro login, não vale como sessão e vence em 30 dias.
 */
process.env.JWT_SECRET = 'segredo-de-teste-do-navegador-confiavel-0123456789';

import { jwtVerify } from 'jose';
import {
  emitirSeloDoNavegador, navegadorConfiavel, impressaoDoCadastro, seloDoPedido, seloDepoisDoCodigo,
  COOKIE_NAVEGADOR, NAVEGADOR_CONFIAVEL_SEGUNDOS,
} from '../src/lib/navegador-confiavel.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const ana = { id: 'u-ana', senha_hash: 'pbkdf2$abc', totp_cofre: 'v1:cifrado-ana' };
const DIA = 24 * 60 * 60 * 1000;
const agora = Date.UTC(2026, 10, 12, 12);

console.log('--- selo vale ---');
const selo = await emitirSeloDoNavegador('usuarios', ana, agora);
eq(typeof selo, 'string', 'emite selo para quem tem 2FA');
eq(await navegadorConfiavel(selo, 'usuarios', ana, agora), true, 'mesmo cadastro, mesmo navegador: pula o código');
eq(await navegadorConfiavel(selo, 'usuarios', ana, agora + 29 * DIA), true, 'ainda vale no 29º dia');
eq(NAVEGADOR_CONFIAVEL_SEGUNDOS >= 15 * 24 * 60 * 60, true, 'janela de pelo menos 15 dias');

console.log('--- selo não vale ---');
eq(await navegadorConfiavel(selo, 'usuarios', ana, agora + 31 * DIA), false, 'vencido depois de 30 dias');
eq(await navegadorConfiavel(selo, 'usuarios', { ...ana, senha_hash: 'pbkdf2$nova' }, agora), false, 'trocou a senha: pede o código');
eq(await navegadorConfiavel(selo, 'usuarios', { ...ana, totp_cofre: 'v1:outro' }, agora), false, 'recadastrou o 2FA: pede o código');
eq(await navegadorConfiavel(selo, 'usuarios', { id: ana.id, senha_hash: ana.senha_hash }, agora), false, '2FA zerado: precisa cadastrar de novo');
eq(await navegadorConfiavel(selo, 'usuarios', { ...ana, id: 'u-bia' }, agora), false, 'outra pessoa no mesmo navegador');
eq(await navegadorConfiavel(selo, 'super_admins', ana, agora), false, 'selo da agência não vale no login da plataforma');
eq(await navegadorConfiavel(selo!.slice(0, -2) + 'xx', 'usuarios', ana, agora), false, 'selo adulterado');
eq(await navegadorConfiavel(null, 'usuarios', ana, agora), false, 'sem selo');
eq(await navegadorConfiavel('lixo', 'usuarios', ana, agora), false, 'lixo não lança');

console.log('--- selo não é sessão ---');
{
  let virouSessao = true;
  try { await jwtVerify(selo!, new TextEncoder().encode(process.env.JWT_SECRET)); } catch { virouSessao = false; }
  eq(virouSessao, false, 'a chave da sessão não aceita o selo');
}

console.log('--- sem 2FA, nada a lembrar ---');
eq(impressaoDoCadastro({ id: 'x', senha_hash: 'h' }), null, 'sem segredo não há impressão');
eq(await emitirSeloDoNavegador('usuarios', { id: 'x', senha_hash: 'h' }, agora), null, 'sem segredo não há selo');
eq(impressaoDoCadastro({ id: 'x', senha_hash: 'h', totp_cofre: 's' })?.includes('h'), false, 'impressão não carrega a senha');

console.log('--- cookie ---');
eq(seloDoPedido(new Headers({ cookie: `a=1; ${COOKIE_NAVEGADOR}=${selo}; b=2` })), selo, 'lê o selo no meio dos cookies');
eq(seloDoPedido(new Headers({ cookie: `${COOKIE_NAVEGADOR}=%E0%A4%A` })), null, 'cookie malformado não lança');
eq(seloDoPedido(new Headers()), null, 'sem cookie');

console.log('--- releitura depois do primeiro cadastro ---');
{
  const db = { query: async () => ({ rows: [{ data: ana }] }) };
  const novo = await seloDepoisDoCodigo(db, 'usuarios', 'u-ana', 't1');
  eq(await navegadorConfiavel(novo, 'usuarios', ana), true, 'selo do segredo recém-gravado vale');
  const quebrado = { query: async () => { throw new Error('banco fora'); } };
  eq(await seloDepoisDoCodigo(quebrado, 'usuarios', 'u-ana', 't1'), null, 'banco fora: sem selo, sem erro');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);

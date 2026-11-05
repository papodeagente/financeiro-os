/**
 * Com qual conta do CRM a conta do ecossistema pode se integrar
 * (src/lib/crm-do-ecossistema.ts). Bruno, 05/11/2026: "o financeiro tem que
 * estar integrado apenas com a tenant 150002 do CRM".
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-crm-do-ecossistema.ts
 */
import { contaDoCrmNaUrl, CRM_DO_ECOSSISTEMA, motivoDaRecusa, urlDoCrmDoEcossistema } from '../src/lib/crm-do-ecossistema.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

eq(CRM_DO_ECOSSISTEMA, 150002, 'a conta da Entur no CRM é a 150002');
eq(urlDoCrmDoEcossistema(), 'https://crm.enturos.com/api/integracao-financeiro/webhook/150002', 'o endereço sugerido aponta para a 150002');
eq([
  contaDoCrmNaUrl('https://crm.enturos.com/api/integracao-financeiro/webhook/150002'),
  contaDoCrmNaUrl('https://crm.enturos.com/api/integracao-financeiro/webhook/150002/'),
  contaDoCrmNaUrl('https://stagingcrm.enturos.com/api/integracao-financeiro/webhook/420533'),
  contaDoCrmNaUrl('https://crm.enturos.com/api/integracao-financeiro/webhook/150002?x=1'),
  contaDoCrmNaUrl('https://crm.enturos.com/outra/rota/150002'),
  contaDoCrmNaUrl('não é endereço'),
  contaDoCrmNaUrl(''),
], [150002, 150002, 420533, 150002, null, null, null], 'a conta sai do fim do caminho do webhook; outra rota ou texto quebrado não é conta');
eq(motivoDaRecusa('ecossistema', 'https://crm.enturos.com/api/integracao-financeiro/webhook/150002'), null, 'ecossistema com a 150002: vale');
const recusa = motivoDaRecusa('ecossistema', 'https://crm.enturos.com/api/integracao-financeiro/webhook/420533');
eq([recusa?.includes('só se integra com a conta 150002'), recusa?.includes('aponta para a conta 420533'), recusa?.includes(urlDoCrmDoEcossistema())], [true, true, true], 'ecossistema com outra conta: recusa dizendo qual é a certa e para qual aponta');
eq(motivoDaRecusa('ecossistema', 'https://crm.enturos.com/qualquer'), `O financeiro da Entur só se integra com a conta 150002 do CRM. Use ${urlDoCrmDoEcossistema()}.`, 'endereço sem conta também é recusado');
eq(motivoDaRecusa('ecossistema', ''), null, 'sem endereço ainda não há integração a recusar');
eq(motivoDaRecusa('agencia', 'https://crm.enturos.com/api/integracao-financeiro/webhook/420533'), null, 'agência segue livre para se integrar com a conta dela');

console.log(`\n${total - falhas}/${total} testes da integração do ecossistema passaram`);
if (falhas > 0) process.exit(1);

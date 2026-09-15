/**
 * Quem pode servir uma proposta pública, e como o link dela é montado.
 *
 * POR QUE ESTE TESTE EXISTE. O domínio personalizado por agência foi removido
 * do produto, e com ele a única exceção em que um host desconhecido chegava a
 * servir conteúdo. A guarda que sobrou é curta — e justamente por ser curta
 * ninguém olha para ela de novo. Uma inversão de sinal aqui abriria as sete
 * rotas públicas de proposta para qualquer host que aponte para o servidor.
 *
 * Roda com: node --experimental-strip-types scripts/test-host-proposta.ts
 */
import { isHostAuthorizedForProposta } from '../src/lib/tenant-host.ts';
import { isCanonicalHost } from '../src/lib/canonical-hosts.ts';
import { buildPropostaLink, getDefaultPublicBase, normalizarPropostaLink } from '../src/lib/proposta-link.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}
/** Um Request com o host pedido, como o proxy entrega. */
const req = (host?: string, header: 'host' | 'x-forwarded-host' = 'host') =>
  new Request('https://exemplo/api/propostas/public/abc', {
    headers: host ? { [header]: host } : {},
  });

// ══════════════════════════════════════════════════════════════════════
console.log('--- só o host canônico serve proposta ---');
eq(isHostAuthorizedForProposta(req('fin.enturos.com')), true, 'o domínio de produção serve');
eq(isHostAuthorizedForProposta(req('localhost')), true, 'localhost serve, para o desenvolvimento');
eq(isHostAuthorizedForProposta(req('127.0.0.1')), true, 'e o laço local também');
// Este é o caso que a remoção fechou: antes, um host de terceiro configurado
// por uma agência servia a proposta sem passar por autenticação.
eq(isHostAuthorizedForProposta(req('proposta.agenciax.com.br')), false, 'domínio de agência NÃO serve mais');
eq(isHostAuthorizedForProposta(req('site-qualquer.com')), false, 'nem qualquer host apontado para nós');
eq(isHostAuthorizedForProposta(req('fin.enturos.com.br')), false, 'nem um parecido com o nosso');
eq(isHostAuthorizedForProposta(req('evil.fin.enturos.com')), false, 'nem um subdomínio não cadastrado');

console.log('\n--- as bordas do header ---');
// Sem header de host é chamada interna (CLI, worker): negar aqui quebraria
// caminho legítimo sem fechar brecha nenhuma, porque quem chega assim já está
// dentro do servidor.
eq(isHostAuthorizedForProposta(req(undefined)), true, 'sem header de host, autorizado');
eq(isHostAuthorizedForProposta(req('')), true, 'header vazio conta como ausente');
eq(isHostAuthorizedForProposta(req('FIN.ENTUROS.COM')), true, 'maiúsculas não mudam o host');
eq(isHostAuthorizedForProposta(req('fin.enturos.com:3000')), true, 'a porta é ignorada');
// O proxy da frente manda o host original aqui; ignorá-lo faria a guarda
// julgar o host INTERNO e liberar tudo.
eq(isHostAuthorizedForProposta(req('proposta.agenciax.com.br', 'x-forwarded-host')), false,
   'x-forwarded-host tem precedência: host de terceiro continua recusado');
eq(isHostAuthorizedForProposta(req('fin.enturos.com, proxy.interno', 'x-forwarded-host')), true,
   'cadeia de proxy usa o primeiro host');

console.log('\n--- a lista canônica ---');
eq(isCanonicalHost('fin.enturos.com'), true, 'o domínio de produção é canônico');
eq(isCanonicalHost(''), false, 'string vazia não é host canônico');
eq(isCanonicalHost('proposta.agenciax.com.br'), false, 'domínio de agência não é canônico');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- o link público ---');
{
  // A guarda de resolução recusa slug com menos de 10 caracteres, e
  // generateId produz ~15. O link truncado em 8 que ia para o CRM nunca abria.
  const id = 'mu2q9h68abcdefg';
  eq(buildPropostaLink(id, 'https://fin.enturos.com'), `https://fin.enturos.com/p/${id}`, 'monta com o id inteiro');
  eq(buildPropostaLink(id, 'https://fin.enturos.com/'), `https://fin.enturos.com/p/${id}`, 'barra sobrando na base não duplica');
  eq(buildPropostaLink(id).startsWith('https://'), true, 'sem base explícita cai no padrão do ambiente');
  eq(getDefaultPublicBase().endsWith('/'), false, 'a base padrão nunca termina em barra');
}

console.log('\n--- links antigos se consertam sozinhos ---');
{
  const id = 'mu2q9h68abcdefg';
  const canonico = 'https://fin.enturos.com';
  // O caso real: proposta criada enquanto o domínio personalizado existia.
  // Copiar o campo gravado entregaria ao cliente um endereço que morre junto
  // com o certificado.
  eq(normalizarPropostaLink(`https://proposta.agenciax.com.br/p/${id}`, id, canonico),
     `${canonico}/p/${id}`, 'link no domínio removido é reescrito');
  eq(normalizarPropostaLink(`${canonico}/p/${id}`, id, canonico),
     `${canonico}/p/${id}`, 'link já correto passa intacto');
  eq(normalizarPropostaLink('', id, canonico), `${canonico}/p/${id}`, 'link vazio é construído');
  eq(normalizarPropostaLink(null, id, canonico), `${canonico}/p/${id}`, 'link nulo também');
  eq(normalizarPropostaLink('nao-e-uma-url', id, canonico), `${canonico}/p/${id}`, 'link fora de forma é reconstruído');
  // Em desenvolvimento a origem é outra e continua sendo a certa.
  eq(normalizarPropostaLink('http://localhost:3000/p/x', id, 'http://localhost:3000'),
     'http://localhost:3000/p/x', 'a origem atual é que manda, não uma lista fixa');
}

console.log(`\n${total - falhas}/${total} testes da guarda de host passaram`);
if (falhas > 0) process.exit(1);

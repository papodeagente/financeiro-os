import assert from 'node:assert/strict';
import {
  nomeArquivoMapa,
  normalizarMapaPublico,
  normalizarShareState,
  redirectSeguroDaCopia,
  urlCompartilhamento,
} from '../src/lib/mapa-mental-sharing.ts';
import {
  redirectImportacaoMapaSeguro,
  redirectInternoSeguro,
} from '../src/lib/redirect-interno.ts';

const origin = 'https://fin.enturos.com';
const tokenCompartilhamento = 'A'.repeat(43);

console.log('--- compartilhamento de mapas mentais ---');

assert.equal(
  urlCompartilhamento('/mapas-mentais/publico/abc', origin),
  'https://fin.enturos.com/mapas-mentais/publico/abc',
);
assert.equal(urlCompartilhamento('javascript:alert(1)', origin), null);

assert.deepEqual(
  normalizarShareState({
    publicUrl: `/mapas-mentais/publico/${tokenCompartilhamento}`,
    allowCopy: true,
    token: tokenCompartilhamento,
    createdAt: '2026-09-13T10:00:00.000Z',
  }, origin),
  {
    publicUrl: `https://fin.enturos.com/mapas-mentais/publico/${tokenCompartilhamento}`,
    copyUrl: `https://fin.enturos.com/planejamento/mapas-mentais/importar/${tokenCompartilhamento}`,
    allowCopy: true,
    token: tokenCompartilhamento,
    createdAt: '2026-09-13T10:00:00.000Z',
  },
  'tolera copyUrl e token opcionais, derivando quando possível',
);

assert.deepEqual(
  normalizarShareState({
    publicUrl: `https://share.example/mapas-mentais/publico/${tokenCompartilhamento}`,
    copyUrl: `/planejamento/mapas-mentais/importar/${tokenCompartilhamento}`,
    allowCopy: false,
  }, origin),
  null,
  'recusa links que apontam para uma origem diferente do app',
);

const mapa = {
  id: 'map-1',
  nome: 'Campanha Europa',
  rootId: 'root',
  nodes: { root: { id: 'root', text: 'Europa', parentId: null, ordem: 0 } },
};
assert.ok(normalizarMapaPublico({
  mapa,
  allowCopy: true,
  publicUrl: `/mapas-mentais/publico/${tokenCompartilhamento}`,
}, origin));
assert.equal(normalizarMapaPublico({ mapa: { ...mapa, rootId: 'missing' } }, origin), null);

assert.equal(
  redirectSeguroDaCopia('/planejamento/mapas-mentais/map-2', 'fallback'),
  '/planejamento/mapas-mentais/map-2',
);
assert.equal(
  redirectSeguroDaCopia('https://evil.example/phishing', 'map/seguro'),
  null,
);
assert.equal(
  redirectSeguroDaCopia('/planejamento/mapas-mentais//evil.example', 'map-3'),
  '/planejamento/mapas-mentais/map-3',
);
assert.equal(
  redirectSeguroDaCopia('/planejamento/mapas-mentais/../fora', 'map-4'),
  '/planejamento/mapas-mentais/map-4',
);
assert.equal(
  redirectSeguroDaCopia('/planejamento/mapas-mentais/%2Ffora', 'map-5'),
  '/planejamento/mapas-mentais/map-5',
);
assert.equal(
  redirectSeguroDaCopia('/planejamento/mapas-mentais/map-6\\@evil.example', 'map-6'),
  '/planejamento/mapas-mentais/map-6',
);
assert.equal(redirectSeguroDaCopia('/dashboard', '..'), null);
assert.equal(redirectSeguroDaCopia('/dashboard', '__proto__'), null);
assert.equal(redirectSeguroDaCopia('/planejamento/mapas-mentais/__proto__', 'map-7'), '/planejamento/mapas-mentais/map-7');
assert.equal(redirectSeguroDaCopia('/dashboard', null), null);

assert.equal(
  redirectInternoSeguro('/planejamento/mapas-mentais/importar/token-1?origem=link'),
  '/planejamento/mapas-mentais/importar/token-1?origem=link',
);
assert.equal(redirectInternoSeguro('https://evil.example/phishing'), '/dashboard');
assert.equal(redirectInternoSeguro('//evil.example/phishing'), '/dashboard');
assert.equal(redirectInternoSeguro('/%2e%2e//evil.example'), '/dashboard');
assert.equal(redirectInternoSeguro('/a/..//evil.example'), '/dashboard');
assert.equal(redirectInternoSeguro('/login'), '/dashboard');
assert.equal(redirectInternoSeguro('/dashboard\\@evil.example'), '/dashboard');

const tokenImportacao = 'A'.repeat(43);
assert.equal(
  redirectImportacaoMapaSeguro(`/planejamento/mapas-mentais/importar/${tokenImportacao}?origem=link`),
  `/planejamento/mapas-mentais/importar/${tokenImportacao}?origem=link`,
);
assert.equal(redirectImportacaoMapaSeguro('/api/support/tickets'), '/dashboard');
assert.equal(redirectImportacaoMapaSeguro('/planejamento/mapas-mentais/importar/token-curto'), '/dashboard');
assert.equal(redirectImportacaoMapaSeguro('/%2e%2e//evil.example'), '/dashboard');

assert.equal(nomeArquivoMapa('  Mapa: Europa / 2027  '), 'Mapa Europa 2027.pdf');
assert.equal(nomeArquivoMapa(''), 'mapa-mental.pdf');

console.log('PASS  URLs, payload público, redirect local e nome de arquivo');

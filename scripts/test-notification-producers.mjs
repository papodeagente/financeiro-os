import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const requireNative = createRequire(import.meta.url);

function ambiente(opcoes = {}) {
  const notificacoes = [];
  const ordem = [];
  const proposta = {
    status: 'ENVIADO',
    numero: 'P-42',
    cliente_nome: 'Cliente Teste',
    vendedor_id: 'vendedor-7',
    visualizacoes: [],
    leads: [],
    feedbacks: [],
  };
  const resultadoEvento = opcoes.resultadoEvento || {
    eventoId: 'evento-1',
    vendaId: '',
    vendaNumero: '',
    tarefaId: '',
    clienteId: '',
    valorTotal: 100,
    matchedExisting: false,
    duplicado: false,
    syncStatus: 'error',
    syncError: 'CRM indisponível',
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/db': {
      __esModule: true,
      default: {
        query: async sql => {
          if (/^\s*SELECT/.test(sql)) {
            return { rows: [{ id: 'proposta-12345', tenant_id: 'tenant-1', data: proposta }] };
          }
          ordem.push('persistiu');
          return { rows: [] };
        },
      },
      initDB: async () => {},
    },
    '@/lib/notificacoes': {
      criarNotificacao: async input => {
        ordem.push('notificou');
        notificacoes.push(input);
      },
    },
    // Síncrona, como a real: um mock async passaria pelo `if (!...)` porque
    // Promise é sempre verdadeiro, escondendo uma quebra de contrato.
    '@/lib/tenant-host': { isHostAuthorizedForProposta: () => true },
    '@/lib/proposta-aceite-crm': {
      processarEventoPropostaPublica: async () => {
        ordem.push('evento-local');
        return resultadoEvento;
      },
    },
  };

  function carregar(rota) {
    const filename = path.join(root, 'src/app/api/propostas/public/[slug]', rota, 'route.ts');
    const source = readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: filename,
    });
    const loadedModule = { exports: {} };
    vm.runInNewContext(outputText, {
      module: loadedModule,
      exports: loadedModule.exports,
      require: name => mocks[name] || requireNative(name),
      Response,
      Request,
      console,
    }, { filename });
    return loadedModule.exports;
  }

  return { carregar, notificacoes, ordem };
}

function requisicao(method, body) {
  return new Request('https://fin.enturos.com/api/propostas/public/proposta-12345', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const contexto = { params: Promise.resolve({ slug: 'proposta-12345' }) };

{
  const a = ambiente();
  const handler = a.carregar('view').POST;
  await handler(requisicao('POST', { tempo_segundos: 0 }), contexto);
  await handler(requisicao('POST', { tempo_segundos: 30 }), contexto);
  assert.equal(a.notificacoes.length, 2);
  assert.equal(a.notificacoes[0].vendedorId, 'vendedor-7');
  assert.equal(a.notificacoes[0].chaveDeduplicacao, a.notificacoes[1].chaveDeduplicacao);
  assert.match(a.notificacoes[0].chaveDeduplicacao, /^proposta:proposta-12345:visualizada:\d{4}-\d{2}-\d{2}$/);
}

{
  const a = ambiente();
  const handler = a.carregar('lead').POST;
  await handler(requisicao('POST', {
    nome: '  ANA   SILVA ', email: ' ANA@EXAMPLE.TEST ', telefone: '(85) 99999-0000', mensagem: 'Oi',
  }), contexto);
  await handler(requisicao('POST', {
    nome: 'ana silva', email: 'ana@example.test', telefone: '85999990000', mensagem: 'Outra mensagem',
  }), contexto);
  const [primeira, segunda] = a.notificacoes;
  assert.equal(primeira.chaveDeduplicacao, segunda.chaveDeduplicacao);
  assert.match(primeira.chaveDeduplicacao, /^proposta:proposta-12345:lead:[a-f0-9]{64}$/);
  assert.ok(!primeira.chaveDeduplicacao.includes('ana'));
  assert.ok(!primeira.chaveDeduplicacao.includes('example'));
  assert.ok(!primeira.chaveDeduplicacao.includes('85999990000'));
  assert.equal(primeira.vendedorId, 'vendedor-7');
  const payload = JSON.stringify(primeira.data);
  for (const pii of ['ANA', 'ana', 'example', '85999990000', 'Oi', primeira.chaveDeduplicacao.split(':').at(-1)]) {
    assert.ok(!payload.includes(pii), `payload não repete dado sensível: ${pii}`);
  }
}

for (const [rota, method, tipo, trechoChave] of [
  ['aceitar', 'PUT', 'PROPOSTA_ACEITA', 'aceite'],
  ['solicitar-alteracao', 'POST', 'PROPOSTA_FEEDBACK', 'alteracao'],
]) {
  const a = ambiente();
  const body = {
    nome: 'Ana Silva', telefone: '85999990000', email: 'ana@example.test',
    anotacao: 'Alterar hotel', request_id: 'request-1',
  };
  await a.carregar(rota)[method](requisicao(method, body), contexto);
  assert.equal(a.notificacoes.length, 1, `${rota} notifica mesmo com CRM pendente`);
  assert.equal(a.notificacoes[0].tipo, tipo);
  assert.equal(
    a.notificacoes[0].chaveDeduplicacao,
    `proposta:proposta-12345:${trechoChave}:evento-1`,
  );
  assert.match(a.notificacoes[0].descricao, /sincronização com o CRM ficou pendente/);
  assert.equal(a.notificacoes[0].link, '/propostas/proposta-12345');
  assert.equal(a.notificacoes[0].data.sync_pendente, true);
  const payload = JSON.stringify(a.notificacoes[0].data);
  for (const pii of ['Ana Silva', '85999990000', 'ana@example.test', 'Alterar hotel']) {
    assert.ok(!payload.includes(pii), `${rota} não duplica PII no payload auditável`);
  }
  assert.ok(a.ordem.indexOf('evento-local') < a.ordem.indexOf('notificou'));

  const duplicado = ambiente({
    resultadoEvento: { ...a.notificacoes[0].data, eventoId: 'evento-1', duplicado: true, syncStatus: 'error' },
  });
  await duplicado.carregar(rota)[method](requisicao(method, body), contexto);
  assert.equal(duplicado.notificacoes.length, 0, `${rota} não renotifica evento duplicado`);
}

{
  const a = ambiente();
  await a.carregar('feedback').POST(
    requisicao('POST', { nome: 'Ana', mensagem: 'Gostaria de outra opção' }),
    contexto,
  );
  assert.equal(a.notificacoes.length, 1);
  assert.equal(a.notificacoes[0].data.feedback_id, a.notificacoes[0].chaveDeduplicacao.split(':').at(-1));
  assert.ok(!JSON.stringify(a.notificacoes[0].data).includes('Gostaria de outra opção'));
  assert.deepEqual(a.ordem, ['persistiu', 'notificou']);
}

console.log('PASS produtores de notificações das propostas públicas');

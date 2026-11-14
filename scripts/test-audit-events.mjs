/** Executa os handlers reais com I/O isolado: identidade, segredos e atomicidade dos eventos explícitos. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const requireNative = createRequire(import.meta.url);
let checks = 0;
// Administrador e superadmin entram com senha e código do aplicativo
// (FIN-12): o cadastro de teste já tem o aplicativo, e o login manda o código
// do momento. Quem não é administrador e não cadastrou entra só com a senha.
const SEGREDO_TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const usuario = {
  id: 'usuario-1', nome: 'Pessoa', email: 'pessoa@example.test', perfil: 'ADMIN',
  ativo: true, permissoes: {}, senha_hash: 'hash-que-nao-pode-ir-para-o-log', totp_segredo: SEGREDO_TOTP,
};
const sessao = {
  userId: usuario.id, nome: usuario.nome, email: usuario.email, perfil: 'ADMIN',
  permissoes: {}, tenantId: 'agencia-1', tenantSlug: 'agencia',
};
const registroUsuario = { data: usuario, tenant_id: 'agencia-1', tenant_slug: 'agencia', tenant_status: 'ativo' };

// Imagem PNG de verdade (cabeçalho): as rotas conferem o tipo pelos bytes.
const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');

function ambiente(opcoes = {}) {
  const buscar = opcoes.fetch ?? (async () => new Response(PNG, { headers: { 'content-type': 'image/png' } }));
  const eventos = [];
  const arquivos = new Map();
  const ordem = [];
  let ids = 0;
  const mocks = {
    'next/server': {
      NextResponse: {
        json(body, init) {
          const response = Response.json(body, init);
          response.cookies = { set(...args) { ordem.push(['cookie', ...args]); } };
          return response;
        },
      },
    },
    '@/lib/db': {
      __esModule: true,
      // UPDATE (ex.: o passo do código do aplicativo já usado) afeta uma linha.
      default: { query: opcoes.query ?? (async (sql) => (/^\s*UPDATE/i.test(String(sql))
        ? { rows: [], rowCount: 1 }
        : { rows: opcoes.rows ?? [registroUsuario] })) },
      initDB: async () => {},
    },
    '@/lib/auth': {
      COOKIE_NAME: 'entur-session',
      duracaoDaSessao: p => (p?.lembrar === true ? 15 * 24 * 60 * 60 : 12 * 60 * 60),
      getSession: async () => Object.hasOwn(opcoes, 'session') ? opcoes.session : sessao,
      verifyPassword: async () => opcoes.senhaValida ?? true,
      createSession: async () => 'jwt-que-nao-pode-ir-para-o-log',
    },
    '@/lib/tenant': { getTenantId: async () => 'agencia-1' },
    '@/lib/audit': {
      registrarEventoAuditoria: async (evento) => {
        ordem.push(['audit', evento.acao]);
        if (opcoes.auditFalha) throw new Error('Auditoria indisponível');
        if (evento.entidade === 'arquivos' || evento.entidade === 'imagens' || evento.entidade === 'comprovantes') {
          assert.ok([...arquivos.keys()].some(nome => nome.endsWith(evento.entidadeId)), 'arquivo existe ao auditar');
        }
        eventos.push(evento);
      },
    },
    '@/lib/utils': { generateId: () => `arquivo-${++ids}` },
    // A guarda de saída (só https, sem rede interna) consulta o DNS: aqui o
    // download vai direto ao fetch isolado do teste.
    '@/lib/saida-segura': {
      baixarImagemSegura: async url => {
        const r = await buscar(url);
        if (!r.ok) throw new Error('falhou');
        return { bytes: Buffer.from(await r.arrayBuffer()), final: url };
      },
    },
    '@/lib/comprovantes': {
      pastaComprovantes: async () => '/isolado/comprovantes/agencia-1',
      TIPOS_COMPROVANTE: { 'application/pdf': 'pdf' },
      MAX_COMPROVANTE: 10 * 1024 * 1024,
    },
    'fs/promises': {
      mkdir: async () => {},
      writeFile: async (nome, bytes, options) => {
        assert.equal(options?.flag, 'wx', 'não sobrescreve arquivo existente');
        arquivos.set(nome, bytes);
        ordem.push(['write', nome]);
      },
      unlink: async nome => { arquivos.delete(nome); ordem.push(['unlink', nome]); },
    },
    path,
  };
  // Módulos de src/lib sem mock próprio (permissões, segundo fator, limite de
  // login...) carregam o código real, com as MESMAS trocas de I/O: banco,
  // sessão, auditoria e arquivos continuam isolados. Antes, cada import novo
  // numa rota exigia um mock à mão e o teste quebrava com "Mock ausente".
  const carregados = new Map();
  const DIR_LIB = path.join(root, 'src/lib');
  function resolverNome(nome, deQuem) {
    if (nome in mocks) return { mock: mocks[nome] };
    let alvo = null;
    if (nome.startsWith('@/')) alvo = path.join(root, 'src', nome.slice(2));
    else if (nome.startsWith('.')) alvo = path.resolve(path.dirname(deQuem), nome);
    if (!alvo) return { mock: requireNative(nome) };
    // './db' dentro de src/lib é o mesmo '@/lib/db' que o teste trocou.
    const relLib = path.relative(DIR_LIB, alvo);
    if (!relLib.startsWith('..') && `@/lib/${relLib}` in mocks) return { mock: mocks[`@/lib/${relLib}`] };
    for (const ext of ['.ts', '.tsx', '/index.ts']) if (existsSync(alvo + ext)) return { arquivo: alvo + ext };
    throw new Error(`Módulo não encontrado: ${nome}`);
  }
  function executar(filename) {
    if (carregados.has(filename)) return carregados.get(filename).exports;
    const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    });
    const loadedModule = { exports: {} };
    carregados.set(filename, loadedModule);
    vm.runInNewContext(outputText, {
      module: loadedModule, exports: loadedModule.exports,
      require: nome => {
        const r = resolverNome(nome, filename);
        return 'mock' in r ? r.mock : executar(r.arquivo);
      },
      Response, Request, File, Buffer, AbortController, setTimeout, clearTimeout, console, URL, TextEncoder, TextDecoder,
      process: { env: { NODE_ENV: 'test' }, cwd: () => '/isolado' },
      fetch: buscar,
    }, { filename });
    return loadedModule.exports;
  }
  function carregar(rota) {
    return executar(path.join(root, 'src/app/api', rota, 'route.ts'));
  }
  const carregarLib = nome => executar(path.join(root, 'src/lib', `${nome}.ts`));
  return { carregar, carregarLib, eventos, arquivos, ordem };
}

const json = (rota, body) => new Request(`https://example.test/api/${rota}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Real-IP': '10.0.0.1' }, body: JSON.stringify(body),
});
// O código do aplicativo do momento, calculado pelo próprio módulo de produção.
const { codigoDoPasso } = ambiente().carregarLib('segundo-fator');
const codigoAgora = () => codigoDoPasso(SEGREDO_TOTP, Math.floor(Date.now() / 30000));
const login = () => json('auth/login', { email: usuario.email, senha: 'senha-confidencial', nome: 'Ator forjado', codigo: codigoAgora() });
function semSegredos(eventos) {
  const texto = JSON.stringify(eventos);
  for (const proibido of ['senha-confidencial', usuario.senha_hash, 'jwt-que-nao-pode-ir-para-o-log', 'chave-confidencial']) {
    assert.ok(!texto.includes(proibido), `log omite ${proibido}`);
  }
}
async function testar(nome, fn) {
  await fn();
  checks++;
  console.log(`PASS ${nome}`);
}

await testar('login identifica a sessão validada e audita antes do cookie', async () => {
  const a = ambiente();
  const resposta = await a.carregar('auth/login').POST(login());
  assert.equal(resposta.status, 200);
  assert.equal(a.eventos[0].acao, 'LOGIN');
  assert.equal(a.eventos[0].session.userId, usuario.id);
  assert.equal(a.eventos[0].session.nome, usuario.nome);
  assert.equal(a.eventos[0].tenantId, 'agencia-1');
  assert.deepEqual(a.ordem.map(x => x[0]), ['audit', 'cookie']);
  semSegredos(a.eventos);
});

await testar('quem paga sem ser administrador: código só depois de cadastrar o aplicativo (E7)', async () => {
  const semAplicativo = { ...usuario, perfil: 'OPERADOR', totp_segredo: undefined };
  const a = ambiente({ rows: [{ ...registroUsuario, data: semAplicativo }] });
  const semCodigo = json('auth/login', { email: usuario.email, senha: 'senha-confidencial' });
  assert.equal((await a.carregar('auth/login').POST(semCodigo)).status, 200, 'sem aplicativo: entra só com a senha');
  const b = ambiente({ rows: [{ ...registroUsuario, data: { ...usuario, perfil: 'OPERADOR' } }] });
  const resposta = await b.carregar('auth/login').POST(json('auth/login', { email: usuario.email, senha: 'senha-confidencial' }));
  assert.equal(resposta.status, 401, 'com aplicativo cadastrado: pede o código');
  assert.equal((await resposta.json()).precisa_codigo, true);
  const c = ambiente({ rows: [{ ...registroUsuario, data: { ...usuario, perfil: 'OPERADOR' } }] });
  assert.equal((await c.carregar('auth/login').POST(login())).status, 200, 'com o código, entra');
});

await testar('senha incorreta não atribui tentativa ao usuário autenticado', async () => {
  const a = ambiente({ senhaValida: false });
  assert.equal((await a.carregar('auth/login').POST(login())).status, 401);
  assert.equal(a.eventos[0].acao, 'LOGIN_FALHOU');
  assert.equal(a.eventos[0].session, null);
  assert.equal(a.eventos[0].origem, 'PUBLICO');
  assert.equal(a.eventos[0].entidadeId, usuario.id);
  assert.ok(!a.ordem.some(x => x[0] === 'cookie'));
  semSegredos(a.eventos);
});

await testar('conta desconhecida e conta sem agência não inventam tenant', async () => {
  for (const rows of [[], [{ ...registroUsuario, tenant_id: '' }]]) {
    const a = ambiente({ rows });
    assert.ok((await a.carregar('auth/login').POST(login())).status >= 400);
    assert.equal(a.eventos.length, 0);
  }
});

await testar('login não entrega sessão quando a auditoria falha', async () => {
  const a = ambiente({ auditFalha: true });
  assert.equal((await a.carregar('auth/login').POST(login())).status, 500);
  assert.ok(!a.ordem.some(x => x[0] === 'cookie'));
});

await testar('admin registra sucesso e falha no escopo da plataforma', async () => {
  for (const senhaValida of [true, false]) {
    const a = ambiente({ rows: [{ data: usuario }], senhaValida });
    const resposta = await a.carregar('admin/auth/login').POST(login());
    assert.equal(resposta.status, senhaValida ? 200 : 401);
    assert.equal(a.eventos[0].tenantId, '__platform__');
    assert.equal(a.eventos[0].entidade, 'super_admins');
    assert.equal(a.eventos[0].session?.perfil ?? null, senhaValida ? 'SUPER_ADMIN' : null);
    semSegredos(a.eventos);
  }
});

await testar('logout registra identidade antes de expirar cookie; anônimo não gera evento', async () => {
  const a = ambiente();
  assert.equal((await a.carregar('auth/logout').POST()).status, 200);
  assert.equal(a.eventos[0].acao, 'LOGOUT');
  assert.equal(a.eventos[0].session.userId, usuario.id);
  assert.deepEqual(a.ordem.map(x => x[0]), ['audit', 'cookie']);
  const anonimo = ambiente({ session: null });
  assert.equal((await anonimo.carregar('auth/logout').POST()).status, 200);
  assert.equal(anonimo.eventos.length, 0);
  const falha = ambiente({ auditFalha: true });
  assert.equal((await falha.carregar('auth/logout').POST()).status, 503);
  assert.ok(!falha.ordem.some(x => x[0] === 'cookie'));
});

await testar('impersonação preserva ator superadmin e identifica agência alvo', async () => {
  const superadmin = { ...sessao, userId: 'suporte-1', tenantId: '__platform__', isSuperAdmin: true, perfil: 'SUPER_ADMIN' };
  let consultas = 0;
  const a = ambiente({ session: superadmin, query: async () => ({ rows: [{ data: consultas++ === 0
    ? { slug: 'alvo', nome: 'Agência alvo', status: 'ativo' } : usuario }] }) });
  const resposta = await a.carregar('admin/tenants/[id]/impersonate').POST(login(), { params: Promise.resolve({ id: 'agencia-alvo' }) });
  assert.equal(resposta.status, 200);
  assert.equal(a.eventos[0].acao, 'IMPERSONAR');
  assert.equal(a.eventos[0].tenantId, 'agencia-alvo');
  assert.equal(a.eventos[0].session.userId, 'suporte-1');
  assert.deepEqual(a.ordem.map(x => x[0]), ['audit', 'cookie']);
  const fim = ambiente({ session: { ...superadmin, impersonatingTenantId: 'agencia-alvo' } });
  assert.equal((await fim.carregar('admin/impersonate/stop').POST()).status, 200);
  assert.equal(fim.eventos[0].acao, 'ENCERRAR_IMPERSONACAO');
  assert.equal(fim.eventos[0].tenantId, 'agencia-alvo');
});

await testar('visualização da chave registra intenção sem copiar segredo e falha fechada', async () => {
  for (const auditFalha of [false, true]) {
    const a = ambiente({ auditFalha, rows: [{ data: { api_key_crm: 'chave-confidencial' } }] });
    const resposta = await a.carregar('v1/crm/config/secret').GET();
    const body = await resposta.json();
    assert.equal(resposta.status, auditFalha ? 500 : 200);
    if (auditFalha) assert.equal(body.secret, undefined);
    else {
      assert.equal(body.secret, 'chave-confidencial');
      assert.equal(a.eventos[0].acao, 'VISUALIZAR');
    }
    semSegredos(a.eventos);
  }
});

await testar('uploads e comprovantes auditam metadados e compensam falha de persistência', async () => {
  for (const rota of ['upload', 'comprovantes']) {
    for (const auditFalha of [false, true]) {
      const a = ambiente({ auditFalha });
      const form = new FormData();
      // O conteúdo começa como PDF de verdade: a rota confere o tipo pelos bytes.
      form.append('files', new File(['%PDF-1.4\n% CONTEUDO-NAO-AUDITAVEL'], 'recibo.pdf', { type: 'application/pdf' }));
      const resposta = await a.carregar(rota).POST(new Request(`https://example.test/api/${rota}`, { method: 'POST', body: form }));
      assert.equal(resposta.status, auditFalha ? 500 : 200);
      assert.equal(a.arquivos.size, auditFalha ? 0 : 1);
      if (!auditFalha) {
        assert.equal(a.eventos.length, 1);
        assert.equal(a.eventos[0].tenantId, 'agencia-1');
        assert.equal(a.eventos[0].acao, 'ENVIAR');
        assert.ok(!JSON.stringify(a.eventos).includes('CONTEUDO-NAO-AUDITAVEL'));
        assert.deepEqual(a.ordem.map(x => x[0]), ['write', 'audit']);
      }
    }
  }
});

await testar('importação audita cada novo arquivo; ignora local e omite URL remota', async () => {
  const a = ambiente();
  const resposta = await a.carregar('import-images').POST(json('import-images', {
    urls: ['/api/uploads/existente.png', 'https://example.test/imagem?token=chave-confidencial'],
  }));
  assert.equal(resposta.status, 200);
  assert.equal(a.eventos.length, 1);
  assert.equal(a.arquivos.size, 1);
  semSegredos(a.eventos);
  const falha = ambiente({ auditFalha: true });
  const resultado = await falha.carregar('import-images').POST(json('import-images', { urls: ['https://example.test/imagem'] }));
  assert.deepEqual((await resultado.json()).urls, [null]);
  assert.equal(falha.arquivos.size, 0);
});

await testar('imagem gerada registra arquivo salvo sem prompt ou credenciais', async () => {
  const a = ambiente({
    rows: [{ data: { openai: { ativo: true, api_key: 'chave-confidencial' } } }],
    fetch: async () => Response.json({ data: [{ b64_json: PNG.toString('base64') }] }),
  });
  const resposta = await a.carregar('ai/imagem').POST(json('ai/imagem', { prompt: 'PROMPT-PRIVADO' }));
  assert.equal(resposta.status, 200);
  assert.equal(a.eventos.length, 1);
  assert.equal(a.arquivos.size, 1);
  assert.ok(!JSON.stringify(a.eventos).includes('PROMPT-PRIVADO'));
  semSegredos(a.eventos);
});

console.log(`\n${checks} cenários de eventos explícitos passaram.`);

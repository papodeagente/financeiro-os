/**
 * Substituto de src/lib/db.ts nos testes (ver db-de-teste-hook.mjs).
 * O pool precisa estar em globalThis.__POOL_DE_TESTE__ antes do primeiro
 * import de qualquer módulo que use o banco.
 *
 * Versão por agência (14/11/2026): as rotas e tarefas dos módulos da versão
 * completa conferem tenants.data (src/lib/modulos-servidor.ts). Os testes
 * escritos para a versão completa ligam `globalThis.__VERSAO_DE_TESTE__ =
 * 'completa'`: aí toda agência do teste está na versão completa, a não ser
 * que o próprio teste grave `fin_versao` ou `modulos` no tenants.data dela
 * (e a tabela tenants nem precisa existir). Sem o sinal, vale o banco do
 * teste, como em produção.
 */
const base = globalThis.__POOL_DE_TESTE__ ?? null;

const LER_DA_CONTA = /^SELECT data FROM tenants WHERE id = \$1 LIMIT 1$/;
const LER_TODAS = /^SELECT id, data FROM tenants$/;
const LER_LIBERADOS = /^SELECT data FROM saas_config WHERE key = 'modulos_liberados' LIMIT 1$/;

async function existe(query, tabela) {
  const r = await query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${tabela}`]);
  return r.rows[0]?.ok === true;
}

/** A agência que o teste não marcou fica na versão completa. */
function completaSeNaoMarcada(data) {
  const d = data && typeof data === 'object' ? data : (typeof data === 'string' ? JSON.parse(data) : {});
  return 'fin_versao' in d || 'modulos' in d ? d : { ...d, fin_versao: 'completa' };
}

function comModulos(query) {
  return async (text, values) => {
    const sql = typeof text === 'string' ? text.trim() : '';
    if (globalThis.__VERSAO_DE_TESTE__ === 'completa') {
      if (LER_DA_CONTA.test(sql)) {
        const r = (await existe(query, 'tenants')) ? await query(text, values) : { rows: [] };
        return { rows: [{ data: completaSeNaoMarcada(r.rows[0]?.data) }], rowCount: 1 };
      }
      if (LER_TODAS.test(sql)) {
        if (!(await existe(query, 'tenants'))) return { rows: [], rowCount: 0 };
        const r = await query(text, values);
        return { ...r, rows: r.rows.map(x => ({ ...x, data: completaSeNaoMarcada(x.data) })) };
      }
      if (LER_LIBERADOS.test(sql) && !(await existe(query, 'saas_config'))) return { rows: [], rowCount: 0 };
    }
    return query(text, values);
  };
}

const pool = base ? new Proxy(base, {
  get(alvo, chave) {
    if (chave === 'query') return comModulos(alvo.query.bind(alvo));
    if (chave === 'connect') {
      return async (...args) => {
        const cliente = await alvo.connect(...args);
        return new Proxy(cliente, {
          get(c, k) { return k === 'query' ? comModulos(c.query.bind(c)) : (typeof c[k] === 'function' ? c[k].bind(c) : c[k]); },
        });
      };
    }
    const v = alvo[chave];
    return typeof v === 'function' ? v.bind(alvo) : v;
  },
}) : null;
export default pool;
export async function initDB() {}

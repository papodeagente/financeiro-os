/**
 * Leads e vendas do mês vindos do CRM (Bruno, 20/10/2026): a consulta
 * assinada que o acompanhamento do plano faz (consultarMetricasComerciais),
 * contra um Postgres real (PGlite, pool trocado por scripts/db-de-teste-hook.mjs)
 * e um CRM de mentira num servidor HTTP local que confere a assinatura como o
 * CRM de verdade (server/routes/integracaoFinanceiroRoutes.ts) e assina a
 * resposta do mesmo jeito.
 *
 * O que se prova:
 *   (a) a leitura da resposta: totais, um número por dia, mês errado ou total
 *       ausente não viram zero;
 *   (b) sem integração ligada, nem chama o CRM;
 *   (c) o pedido vai assinado com o segredo da empresa, com o mês, e a
 *       resposta assinada vira os números; repetir em seguida usa o cache;
 *   (d) CRM antigo (ainda sem a consulta), resposta sem assinatura válida,
 *       segredo recusado e CRM fora do ar: cada um com o seu motivo;
 *   (e) uma empresa nunca usa a integração da outra.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/test-sql-metricas-crm.mjs
 */
import { register } from 'node:module';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const pg = new PGlite();
await pg.exec(`CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { consultarMetricasComerciais, consultarMrrVendido } = await import('../src/lib/crm-integration.ts');
const { lerMetricasDoCrm } = await import('../src/lib/metricas-comerciais.ts');

const assinar = (corpo, segredo) => createHmac('sha256', segredo).update(corpo).digest('hex');

// ── O CRM de mentira ─────────────────────────────────────────────────────
const SEGREDO = 'segredo-da-agencia-a';
let modo = 'ok';
const pedidos = [];
const servidor = createServer((req, res) => {
  let corpo = '';
  req.on('data', c => { corpo += c; });
  req.on('end', () => {
    const json = JSON.parse(corpo);
    pedidos.push({ caminho: req.url, tipo: json.tipo, mes: json.payload?.mes, assinaturaOk: req.headers['x-entur-signature'] === assinar(corpo, SEGREDO) });
    if (req.headers['x-entur-signature'] !== assinar(corpo, SEGREDO) || modo === 'recusa') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'assinatura inválida' }));
    }
    if (modo === 'antigo') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ recebido: true, processado: true, acao: 'tipo desconhecido: METRICAS_COMERCIAIS' }));
    }
    if (modo === 'erro') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end('{"recebido":true,"processado":false}');
    }
    const mes = json.payload.mes;
    if (json.tipo === 'MRR_VENDIDO') {
      // O CRM de verdade só responde à conta operadora (403 para as outras).
      if (modo === 'nao-operadora') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'o MRR vendido só é enviado ao Financeiro da conta operadora' }));
      }
      const corpoMrr = JSON.stringify({
        recebido: true, processado: true, acao: 'mrr vendido',
        mrr: {
          versao: 1, mes, apurado_em: '2026-11-04T12:00:00Z',
          produtos: [{ chave: 'plano:essencial', nome: 'Essencial', classe: 'plano' }],
          vendas: [{ conta_id: 10, conta_nome: 'Agência A', dia: `${mes}-03`, tipo: 'nova', mrr: 297,
            itens: [{ chave: 'plano:essencial', nome: 'Essencial', classe: 'plano', mrr: 297 }],
            vendedor: { id: 'crm_user_7', nome: 'Karen', email: 'karen@entur.com.br' }, negociacao_id: 'crm_deal_55' }],
          resumo: { mrr: 297, contas: 1, sem_vendedor: 0, mrr_sem_vendedor: 0 },
        },
      });
      res.writeHead(200, { 'Content-Type': 'application/json', 'x-crm-signature': assinar(corpoMrr, SEGREDO) });
      return res.end(corpoMrr);
    }
    const resposta = JSON.stringify({
      recebido: true, processado: true, acao: 'métricas comerciais',
      metricas: {
        versao: 1, mes, fonte: 'Análises do CRM, funis de vendas',
        negociacoes: 12, ganhas: 6, perdidas: 2, abertas: 4, valor_ganho: 118990.63, taxa_decididas: 75,
        por_dia: [
          { dia: `${mes}-02`, negociacoes: 3, ganhas: 1, perdidas: 0 },
          { dia: `${mes}-15`, negociacoes: 2, ganhas: 2, perdidas: 1 },
        ],
      },
    });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'x-crm-signature': modo === 'forjado' ? assinar(resposta, 'outro-segredo') : assinar(resposta, SEGREDO),
    });
    res.end(resposta);
  });
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const porta = servidor.address().port;

const T1 = 'agencia-a', T2 = 'agencia-b';
async function configurar(tenant, data) {
  await query(
    `INSERT INTO crm_config (id, tenant_id, data) VALUES ('singleton', $1, $2::jsonb)
     ON CONFLICT (id, tenant_id) DO UPDATE SET data = EXCLUDED.data`,
    [tenant, JSON.stringify(data)],
  );
}
const configA = { ativo: true, webhook_url_crm: `http://127.0.0.1:${porta}/api/integracao-financeiro/webhook/420533`, api_key_crm: SEGREDO, api_key_entur: SEGREDO };

// ══════════════════════════════════════════════════════════════════════
console.log('--- (a) a leitura da resposta ---');
{
  const m = lerMetricasDoCrm({ mes: '2026-10', negociacoes: 12, ganhas: 6, perdidas: 2, abertas: 4, valor_ganho: 118990.634, taxa_decididas: 75,
    por_dia: [{ dia: '2026-10-02', negociacoes: 3, ganhas: 1 }, { dia: '2026-10-02', negociacoes: 1, ganhas: 0 }, { dia: '2026-09-30', negociacoes: 9, ganhas: 9 }, { dia: '2026-10-32', negociacoes: 9 }] }, '2026-10');
  eq([m.negociacoes, m.ganhas, m.perdidas, m.abertas, m.valor_ganho, m.taxa_decididas], [12, 6, 2, 4, 118990.63, 75], 'os totais das Análises');
  eq([m.por_dia.negociacoes.length, m.por_dia.negociacoes[1], m.por_dia.ganhas[1], m.por_dia.negociacoes.reduce((a, b) => a + b, 0)], [31, 4, 1, 4], 'um número por dia do mês; dia repetido soma; outro mês e dia 32 ficam de fora');
  eq(lerMetricasDoCrm({ mes: '2026-09', negociacoes: 12, ganhas: 6 }, '2026-10'), null, 'resposta de outro mês não vale');
  eq(lerMetricasDoCrm({ mes: '2026-10', ganhas: 6 }, '2026-10'), null, 'sem o total de negociações não vira zero: não veio');
  eq(lerMetricasDoCrm({ mes: '2026-10', negociacoes: -3, ganhas: 6 }, '2026-10'), null, 'total negativo é número que não se sabe ler');
  eq(lerMetricasDoCrm('nada', '2026-10'), null, 'resposta que não é objeto');
  const semDias = lerMetricasDoCrm({ mes: '2026-02', negociacoes: 0, ganhas: 0, perdidas: 'x', taxa_decididas: -1 }, '2026-02');
  eq([semDias.por_dia.ganhas.length, semDias.perdidas, semDias.taxa_decididas], [28, 0, 0], 'sem dias: fevereiro com 28 zeros; campo quebrado vira zero');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (b) sem integração ---');
{
  const r = await consultarMetricasComerciais(T1, '2026-10');
  eq([r.situacao, pedidos.length], ['sem_integracao', 0], 'sem configuração: diz que a integração não está ligada e nem chama o CRM');
  await configurar(T1, { ...configA, ativo: false });
  eq([(await consultarMetricasComerciais(T1, '2026-10')).situacao, pedidos.length], ['sem_integracao', 0], 'integração desligada: idem');
  await configurar(T1, { ...configA, api_key_crm: '' });
  eq((await consultarMetricasComerciais(T1, '2026-10')).situacao, 'sem_integracao', 'sem segredo: idem');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (c) a consulta assinada ---');
{
  await configurar(T1, configA);
  const r = await consultarMetricasComerciais(T1, '2026-10');
  const p = pedidos.at(-1);
  eq([p.caminho, p.tipo, p.mes, p.assinaturaOk], ['/api/integracao-financeiro/webhook/420533', 'METRICAS_COMERCIAIS', '2026-10', true], 'o pedido vai ao webhook da empresa, assinado com o segredo dela, com o mês');
  eq([r.situacao, r.metricas?.negociacoes, r.metricas?.ganhas, r.metricas?.por_dia.negociacoes[1], r.metricas?.por_dia.ganhas[14]], ['ok', 12, 6, 3, 2], 'a resposta assinada vira os números');
  const antes = pedidos.length;
  const deNovo = await consultarMetricasComerciais(T1, '2026-10');
  eq([deNovo.situacao, pedidos.length], ['ok', antes], 'repetir em seguida não pergunta de novo');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (d) quando não vem ---');
{
  modo = 'antigo';
  const r = await consultarMetricasComerciais(T1, '2026-09');
  eq([r.situacao, /falta atualizar o CRM/.test(r.detalhe)], ['crm_sem_suporte', true], 'CRM que ainda não conhece a consulta (responde 200 sem números)');
  modo = 'forjado';
  const f = await consultarMetricasComerciais(T1, '2026-08');
  eq([f.situacao, /sem assinatura válida/.test(f.detalhe)], ['indisponivel', true], 'resposta assinada com outro segredo é descartada');
  modo = 'recusa';
  const x = await consultarMetricasComerciais(T1, '2026-07');
  eq([x.situacao, /recusou a assinatura/.test(x.detalhe)], ['indisponivel', true], 'CRM recusou o segredo: diz para conferir');
  modo = 'erro';
  const e = await consultarMetricasComerciais(T1, '2026-06');
  eq([e.situacao, /HTTP 500/.test(e.detalhe)], ['indisponivel', true], 'CRM com erro: diz o código');
  await configurar(T1, { ...configA, webhook_url_crm: 'http://127.0.0.1:1/api/integracao-financeiro/webhook/420533' });
  const fora = await consultarMetricasComerciais(T1, '2026-05');
  eq(fora.situacao, 'indisponivel', 'CRM fora do ar: indisponível, sem derrubar nada');
  await configurar(T1, configA);
  modo = 'ok';
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (e) uma empresa, uma integração ---');
{
  await configurar(T2, { ...configA, api_key_crm: 'segredo-da-agencia-b' });
  const antes = pedidos.length;
  const r = await consultarMetricasComerciais(T2, '2026-10');
  eq([r.situacao, pedidos.at(-1).assinaturaOk, pedidos.length - antes], ['indisponivel', false, 1], 'a agência B assina com o segredo dela (o CRM da A recusa), e não herda o cache da A');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (f) o MRR vendido (comissão por MRR da Entur) ---');
{
  await configurar(T1, configA);
  modo = 'ok';
  const r = await consultarMrrVendido(T1, '2026-11');
  const p = pedidos.at(-1);
  eq([p.tipo, p.mes, p.assinaturaOk], ['MRR_VENDIDO', '2026-11', true], 'o pedido do MRR vai assinado, com o mês');
  eq([r.situacao, r.mrr?.vendas[0]?.vendedor?.id, r.mrr?.vendas[0]?.itens[0]?.mrr, r.mrr?.produtos.length], ['ok', 'crm_user_7', 297, 1], 'a resposta assinada vira as vendas, com vendedor e produtos');
  modo = 'nao-operadora';
  const n = await consultarMrrVendido(T1, '2026-10');
  eq([n.situacao, /só responde isto à conta da Entur/.test(n.detalhe)], ['nao_e_a_conta_operadora', true], 'CRM que recusa por não ser a conta operadora: o motivo certo, sem número');
  modo = 'ok';
}

servidor.close();
console.log(`\n${total - falhas}/${total} testes das métricas do CRM passaram`);
if (falhas > 0) process.exit(1);

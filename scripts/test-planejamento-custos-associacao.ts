import assert from 'node:assert/strict';
import type { FunilPayload } from '../src/lib/funil-types.ts';
import {
  aplicarInvestimentoDosFunis,
  canalMarketingDoTipo,
  normalizarMarketing,
  resumirFunisAssociaveis,
} from '../src/lib/planejamento-custos-associacao.ts';

function funil(
  status: FunilPayload['status'],
  nodes: Array<{ tipo: string; investimento: unknown; categoria?: string }>,
  receita = 0,
): FunilPayload {
  return {
    id: `${status}-${Math.random()}`,
    nome: status,
    status,
    data: {
      nodes: nodes.map((node, index) => ({
        id: `node-${index}`,
        type: 'funilNode',
        position: { x: 0, y: 0 },
        data: {
          tipo: node.tipo,
          categoria: node.categoria ?? 'trafego',
          label: node.tipo,
          config: { investimento: node.investimento },
        },
      })),
      edges: [],
      config: { moeda: 'BRL', periodo_simulacao: 'mensal', usar_dados_reais: false },
      cenarios: [{
        id: 'baseline',
        nome: 'Base',
        multiplicadores: { taxa_conversao: 1, investimento: 1, ticket_medio: 1 },
        kpis: { receita_bruta: receita },
      }],
      ultimo_simulado_at: null,
    },
  } as unknown as FunilPayload;
}

console.log('--- associação de custos de marketing com funis ---');

assert.equal(canalMarketingDoTipo('ads_meta'), 'Instagram Ads');
assert.equal(canalMarketingDoTipo('facebook_ads'), 'Instagram Ads');
assert.equal(canalMarketingDoTipo('ads_google'), 'Google Ads');
assert.equal(canalMarketingDoTipo('afiliados'), 'Afiliados');
assert.equal(canalMarketingDoTipo('ads_tiktok'), 'Outros');
assert.equal(canalMarketingDoTipo(undefined), 'Outros');

const resumo = resumirFunisAssociaveis([
  funil('rascunho', [{ tipo: 'ads_meta', investimento: 99_000 }], 999_000),
  funil('simulado', [
    { tipo: 'ads_meta', investimento: 1_200 },
    { tipo: 'ads_google', investimento: '2.500,50' },
    { tipo: 'ads_tiktok', investimento: 300 },
    { tipo: 'ads_meta', investimento: -50 },
    { tipo: 'ads_meta', investimento: 800, categoria: 'captura' },
  ], 25_000),
  funil('em_execucao', [
    { tipo: 'ads_meta', investimento: 800 },
    { tipo: 'afiliados', investimento: 400 },
  ], 10_000),
]);

assert.deepEqual(
  {
    count: resumo.count,
    simulados: resumo.simulados,
    emExecucao: resumo.emExecucao,
    investimentoTotal: resumo.investimentoTotal,
    volumeVendasProjetado: resumo.volumeVendasProjetado,
  },
  {
    count: 2,
    simulados: 1,
    emExecucao: 1,
    investimentoTotal: 5_200.5,
    volumeVendasProjetado: 35_000,
  },
);
assert.deepEqual(resumo.porCanal, {
  'Instagram Ads': 2_000,
  'Google Ads': 2_500.5,
  Outros: 300,
  Afiliados: 400,
});

const normalizado = normalizarMarketing([
  { canal: 'Instagram Ads', valor: 100 },
  { canal: 'Meta Ads', valor: '250,50' },
  { canal: 'instagram ads', valor: 50 },
  { canal: 'Canal parceiro', valor: 30 },
  { canal: 'canal parceiro', valor: 20 },
  { canal: 'Valor inválido', valor: 'não-numérico' },
  { canal: '', valor: 100 },
  null,
]);

assert.deepEqual(
  normalizado.slice(0, 6).map(item => item.canal),
  ['Instagram Ads', 'Google Ads', 'Influenciadores', 'Eventos', 'Afiliados', 'Outros'],
  'recompõe todos os canais canônicos na ordem da tela',
);
assert.equal(normalizado.find(item => item.canal === 'Instagram Ads')?.valor, 400.5);
assert.equal(normalizado.filter(item => item.canal === 'Instagram Ads').length, 1);
assert.deepEqual(
  normalizado.find(item => item.canal === 'Canal parceiro'),
  { canal: 'Canal parceiro', valor: 50 },
  'preserva e consolida canal customizado legado',
);

const aplicado = aplicarInvestimentoDosFunis([
  { canal: 'Instagram Ads', valor: 10 },
  { canal: 'Instagram Ads', valor: 20 },
  { canal: 'Google Ads', valor: 777 },
], {
  porCanal: { 'Instagram Ads': 2_000, Outros: 300 },
});

assert.equal(aplicado.find(item => item.canal === 'Instagram Ads')?.valor, 2_000);
assert.equal(aplicado.filter(item => item.canal === 'Instagram Ads').length, 1);
assert.equal(aplicado.find(item => item.canal === 'Google Ads')?.valor, 777);
assert.equal(aplicado.find(item => item.canal === 'Outros')?.valor, 300);

console.log('PASS  mapeamento, elegibilidade, normalização e aplicação dos investimentos');

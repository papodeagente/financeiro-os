/**
 * Ranking e metas da equipe (src/lib/ranking-equipe.ts).
 *
 * A tela ficava em branco porque só lia a tabela `metas`, do mês. Agora a
 * meta do cadastro da pessoa serve de padrão. Estes testes fixam as regras
 * que decidem número na tela: o que conta como realizado, de onde vem a
 * meta, como se ordena e o que acontece com venda de gente de fora.
 */
import { montarRanking, pessoaDaVenda } from '../src/lib/ranking-equipe.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const pessoa = (id: string, nome: string, meta = 0, extra = {}) => ({
  id, nome, cpf: '', email: `${id}@ag.com`, telefone: '', cargo: 'Vendedor',
  data_admissao: '', meta_mensal_vendas: meta, meta_mensal_quantidade: 0,
  plano_comissao_id: '', usuario_id: id, status: 'ATIVO', ...extra,
}) as never;

const venda = (id: string, vend: string, valor: number, data: string, status = 'CONFIRMADO') => ({
  id, numero: id, data_venda: data, vendedor_id: vend, valor_final: valor, status,
}) as never;

const comissao = (id: string, vend: string, valor: number, data: string, status = 'CALCULADA') => ({
  id, vendedor_id: vend, valor_comissao: valor, data_venda: data, status,
}) as never;

const MES = '2026-09';
const base = { metas: [], vendas: [], comissoes: [], mes: MES };

console.log('--- de onde vem a meta ---');
{
  const r = montarRanking({ ...base, equipe: [pessoa('u1', 'Ana', 10000)] });
  eq([r.linhas[0].meta_valor, r.linhas[0].origem_meta], [10000, 'CADASTRO'],
     'sem meta do mês, herda a do cadastro da pessoa');
}
{
  const metas = [{ vendedor_id: 'u1', mes_referencia: MES, meta_valor: 25000, meta_quantidade: 5 }] as never[];
  const r = montarRanking({ ...base, metas, equipe: [pessoa('u1', 'Ana', 10000)] });
  eq([r.linhas[0].meta_valor, r.linhas[0].origem_meta], [25000, 'MES'],
     'meta do mês vence a do cadastro');
}
{
  const r = montarRanking({ ...base, equipe: [pessoa('u1', 'Ana', 0)] });
  eq([r.linhas[0].meta_valor, r.linhas[0].origem_meta, r.linhas[0].posicao], [0, 'SEM_META', null],
     'sem meta em lugar nenhum não entra no ranking');
}

console.log('\n--- realizado ---');
{
  const vendas = [
    venda('v1', 'u1', 1000, '2026-09-03'),
    venda('v2', 'u1', 2000.5, '2026-09-20', 'CONCLUIDO'),
    venda('v3', 'u1', 9999, '2026-08-31'),            // mês anterior
    venda('v4', 'u1', 8888, '2026-09-10', 'CANCELADO'),
    venda('v5', 'u1', 7777, '2026-09-11', 'ORCAMENTO'),
  ];
  const r = montarRanking({ ...base, vendas, equipe: [pessoa('u1', 'Ana', 10000)] });
  eq([r.linhas[0].realizado_valor, r.linhas[0].realizado_quantidade], [3000.5, 2],
     'conta só CONFIRMADO e CONCLUIDO do mês');
  eq(r.linhas[0].pct_valor, 30.01, 'percentual sobre a meta');
}

console.log('\n--- ordenação ---');
{
  const equipe = [pessoa('u1', 'Ana', 10000), pessoa('u2', 'Bia', 10000), pessoa('u3', 'Caio', 0)];
  const vendas = [venda('v1', 'u1', 3000, '2026-09-01'), venda('v2', 'u2', 9000, '2026-09-01')];
  const r = montarRanking({ ...base, equipe, vendas });
  eq(r.linhas.map(l => [l.vendedor_nome, l.posicao]),
     [['Bia', 1], ['Ana', 2], ['Caio', null]],
     'ordena por percentual e quem não participa fica sem posição, no fim');
}
{
  const equipe = [pessoa('u1', 'Ana', 10000), pessoa('u2', 'Bia', 10000)];
  const vendas = [venda('v1', 'u1', 5000, '2026-09-01'), venda('v2', 'u2', 5000, '2026-09-01')];
  const r = montarRanking({ ...base, equipe, vendas });
  eq(r.linhas.map(l => l.vendedor_nome), ['Ana', 'Bia'], 'empate desempata por nome');
}

console.log('\n--- totais da equipe ---');
{
  const equipe = [pessoa('u1', 'Ana', 10000), pessoa('u2', 'Bia', 30000)];
  const vendas = [venda('v1', 'u1', 5000, '2026-09-01'), venda('v2', 'u2', 15000, '2026-09-02')];
  const comissoes = [comissao('c1', 'u1', 250, '2026-09-01'), comissao('c2', 'u2', 750, '2026-09-02'),
                     comissao('c3', 'u2', 999, '2026-09-02', 'CANCELADA')];
  const r = montarRanking({ ...base, equipe, vendas, comissoes });
  eq([r.meta_total, r.realizado_total, r.pct_equipe], [40000, 20000, 50],
     'soma meta e realizado da equipe');
  eq(r.comissoes_mes, 1000, 'comissão cancelada não entra no total do mês');
}

console.log('\n--- venda de quem não está na equipe ---');
{
  const r = montarRanking({
    ...base, equipe: [pessoa('u1', 'Ana', 10000)],
    vendas: [venda('v1', 'u1', 1000, '2026-09-01'), venda('v2', 'fantasma', 5000, '2026-09-02')],
  });
  eq([r.realizado_total, r.vendas_sem_vendedor], [1000, 1],
     'venda de vendedor fora da equipe não some: é contada à parte');
}

console.log('\n--- vendedor com id antigo ---');
{
  const ana = pessoa('u1', 'Ana', 10000, { membro_ids_legado: ['memb-antigo'] });
  const r = montarRanking({ ...base, equipe: [ana], vendas: [venda('v1', 'memb-antigo', 4000, '2026-09-01')] });
  eq([r.linhas[0].realizado_valor, r.vendas_sem_vendedor], [4000, 0],
     'venda histórica gravada com id antigo continua contando para a pessoa');
  eq(pessoaDaVenda([ana], 'memb-antigo')?.nome, 'Ana', 'a resolução por id antigo é explícita');
}

console.log('\n--- equipe vazia ---');
{
  const r = montarRanking({ ...base, equipe: [] });
  eq([r.linhas.length, r.meta_total, r.pct_equipe], [0, 0, 0], 'equipe vazia não divide por zero');
}

console.log('\n--- quem vendeu mas não tem meta ---');
{
  // Caso real da tela: Luan vendeu R$ 15.997 e não tem meta. Não pode
  // aparecer como 0% crítico nem como "fora do ranking".
  const equipe = [pessoa('u1', 'Bruno', 500), pessoa('u2', 'Luan', 0), pessoa('u3', 'Karen', 0)];
  const vendas = [venda('v1', 'u1', 61500, '2026-09-01'), venda('v2', 'u2', 15997, '2026-09-02')];
  const r = montarRanking({ ...base, equipe, vendas });

  eq(r.linhas.find(l => l.vendedor_nome === 'Luan')!.tem_meta, false, 'Luan não tem meta');
  eq(r.linhas.find(l => l.vendedor_nome === 'Luan')!.posicao, 2, 'mas participa do ranking porque vendeu');
  eq(r.fora_do_ranking, ['Karen'], 'fora do ranking é só quem não tem meta NEM venda');
  eq(r.sem_meta_com_venda, 1, 'conta quem vendeu sem ter meta');
  eq(r.linhas.find(l => l.vendedor_nome === 'Karen')!.posicao, null, 'Karen fica sem posição');
}
{
  // Quem tem meta vem antes de quem não tem, e entre os sem meta ordena
  // por quanto vendeu. Ordenar todos pelo percentual colocaria quem vendeu
  // R$ 15.000 sem meta atrás de quem vendeu R$ 100 batendo meta de R$ 90.
  const equipe = [pessoa('u1', 'ComMeta', 90), pessoa('u2', 'SemMetaGrande', 0), pessoa('u3', 'SemMetaPequeno', 0)];
  const vendas = [
    venda('v1', 'u1', 100, '2026-09-01'),
    venda('v2', 'u2', 15000, '2026-09-01'),
    venda('v3', 'u3', 300, '2026-09-01'),
  ];
  const r = montarRanking({ ...base, equipe, vendas });
  eq(r.linhas.map(l => l.vendedor_nome), ['ComMeta', 'SemMetaGrande', 'SemMetaPequeno'],
     'com meta primeiro; sem meta ordena por quanto vendeu');
}

console.log(`\n${total - falhas}/${total} testes do ranking passaram`);
process.exit(falhas > 0 ? 1 : 0);

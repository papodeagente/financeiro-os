/**
 * Comissão por MRR (src/lib/comissao-mrr.ts e src/lib/mrr-vendido.ts), só na
 * conta do ecossistema. Decisões do Bruno (04/11/2026): produtos do Entur OS,
 * MRR NOVO vendido, anual ÷ 12 (o CRM já manda assim), faixas pelo quanto a
 * meta foi batida, e a comissão por MRR substitui a do dinheiro recebido.
 *
 * O que se prova:
 *   (a) a leitura da resposta do CRM: mês errado e número quebrado não entram;
 *   (b) faixas: ordem, limpeza, a faixa do percentual, acima da última;
 *   (c) metas: produto em duas metas é barrado, nome e produto obrigatórios;
 *   (d) quem vendeu: pelo external_id do CRM, senão pelo e-mail;
 *   (e) apuração: realizado por meta, faixa, comissão; o que não se presume
 *       (sem meta, sem plano, sem vendedor, fora das metas, sem cadastro);
 *   (f) a linha em comissões e o que fazer com a gravada (aprovada não muda).
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-comissao-mrr.ts
 */
import {
  apurarComissaoMrr, copiarMetas, decidirComissaoMrr, faixaPelaMeta, faixasEmPalavras, idDaComissaoMrr, linhaDaComissaoMrr,
  normalizarFaixas, validarFaixas, validarMeta, vendedorDaVenda,
  type MetaMrr, type PlanoComFaixasDeMrr, type VendedorDoFinanceiro,
} from '../src/lib/comissao-mrr.ts';
import { lerMrrVendido, type VendaMrr } from '../src/lib/mrr-vendido.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const MES = '2026-11';
const FAIXAS = [{ ate_pct: 70, percentual: 20 }, { ate_pct: 100, percentual: 40 }, { ate_pct: null, percentual: 60 }];
const vendedores: VendedorDoFinanceiro[] = [
  { id: 'u-karen', nome: 'Karen', email: 'karen@entur.com.br', external_id: 'crm_user_7', plano_comissao_id: 'p-mrr' },
  { id: 'u-joao', nome: 'João', email: 'joao@entur.com.br', external_id: '', plano_comissao_id: 'p-mrr' },
  { id: 'u-ana', nome: 'Ana', email: 'ana@entur.com.br', external_id: 'crm_user_9', plano_comissao_id: '' },
];
const planos: PlanoComFaixasDeMrr[] = [{ id: 'p-mrr', nome: 'SDR MRR', ativo: true, mrr: { faixas: FAIXAS } }];
const metaPlanos: MetaMrr = {
  id: 'm1', mes: MES, nome: 'Planos', produtos: ['plano:essencial', 'plano:performance'],
  produtos_nomes: { 'plano:essencial': 'Essencial', 'plano:performance': 'Performance' },
  valores: { 'u-karen': 1000, 'u-joao': 500 },
};
const venda = (o: Partial<VendaMrr> & { itens?: VendaMrr['itens'] }): VendaMrr => ({
  conta_id: 1, conta_nome: 'Agência A', dia: '2026-11-04', tipo: 'nova', mrr: 297,
  itens: [{ chave: 'plano:essencial', nome: 'Essencial', classe: 'plano', mrr: 297 }],
  vendedor: { id: 'crm_user_7', nome: 'Karen', email: 'karen@entur.com.br' }, negociacao_id: 'crm_deal_1', ...o,
});

console.log('--- (a) a resposta do CRM ---');
{
  const r = lerMrrVendido({
    mes: MES, apurado_em: 'x',
    produtos: [{ chave: 'plano:essencial', nome: 'Essencial', classe: 'plano' }, { chave: 'plano:essencial', nome: 'Repetido', classe: 'plano' }, { nome: 'sem chave' }],
    vendas: [
      { conta_id: 1, conta_nome: 'A', dia: '2026-11-03', tipo: 'nova', mrr: 346, itens: [{ chave: 'plano:essencial', nome: 'Essencial', classe: 'plano', mrr: 297 }, { chave: 'adicional:whatsapp_number', nome: 'Número de WhatsApp', classe: 'adicional', mrr: 49 }, { chave: 'x', mrr: -5 }], vendedor: { id: 'crm_user_7', nome: 'Karen', email: 'KAREN@entur.com.br' }, negociacao_id: 'crm_deal_1' },
      { conta_id: 2, conta_nome: 'B', dia: '2026-10-31', mrr: 100, itens: [] },
      { conta_id: 3, conta_nome: 'C', dia: '2026-11-05', mrr: 'muito', itens: [] },
      { conta_id: 4, conta_nome: 'D', dia: '2026-11-06', tipo: 'reativada', mrr: 99, itens: [], vendedor: null },
    ],
  }, MES)!;
  eq([r.vendas.length, r.vendas[0].itens.length, r.vendas[0].vendedor?.email, r.vendas[1].tipo, r.vendas[1].vendedor], [2, 2, 'karen@entur.com.br', 'reativada', null], 'vendas do mês; item quebrado, venda de outro mês e MRR quebrado ficam de fora; e-mail em minúsculas');
  eq(r.produtos.map(p => p.nome), ['Essencial'], 'produto repetido ou sem chave não entra duas vezes');
  eq(lerMrrVendido({ mes: '2026-10', vendas: [] }, MES), null, 'resposta de outro mês não vale');
  eq(lerMrrVendido({ mes: MES }, MES), null, 'sem a lista de vendas não é resposta');
}

console.log('\n--- (b) faixas ---');
{
  const f = normalizarFaixas([{ ate_pct: null, percentual: 60 }, { ate_pct: 100, percentual: 40 }, { ate_pct: 70, percentual: 20 }, { ate_pct: 70, percentual: 99 }, { ate_pct: 50, percentual: -1 }]);
  eq(f, FAIXAS, 'em ordem de teto, sem teto no fim, teto repetido e percentual negativo saem');
  eq([faixaPelaMeta(f, 50)?.percentual, faixaPelaMeta(f, 70)?.percentual, faixaPelaMeta(f, 70.01)?.percentual, faixaPelaMeta(f, 100)?.percentual, faixaPelaMeta(f, 180)?.percentual], [20, 20, 40, 40, 60], 'até 70% paga 20; de 70 a 100, 40; acima, 60');
  eq(faixaPelaMeta([{ ate_pct: 100, percentual: 30 }], 150)?.percentual, 30, 'acima da última faixa vale a última');
  eq(faixaPelaMeta([], 50), null, 'sem faixa, sem faixa');
  eq([validarFaixas(FAIXAS), validarFaixas([]), validarFaixas([{ ate_pct: 70, percentual: 'x' }]) !== null, validarFaixas([{ ate_pct: null, percentual: 1 }, { ate_pct: null, percentual: 2 }]) !== null], [null, null, true, true], 'validação: faixa quebrada e duas sem teto barram; sem faixa é permitido');
  eq(faixasEmPalavras(FAIXAS), 'até 70% da meta: 20% do MRR · até 100% da meta: 40% do MRR · acima de 100% da meta: 60% do MRR', 'as faixas em palavras');
}

console.log('\n--- (c) metas ---');
{
  eq(validarMeta(metaPlanos, []), null, 'meta certa passa');
  eq(validarMeta({ ...metaPlanos, nome: ' ' }, []) !== null, true, 'sem nome barra');
  eq(validarMeta({ ...metaPlanos, produtos: [] }, []) !== null, true, 'sem produto barra');
  eq(validarMeta({ ...metaPlanos, valores: { 'u-karen': -1 } }, []) !== null, true, 'meta negativa barra');
  eq(validarMeta({ ...metaPlanos, mes: '2026-13' }, []) !== null, true, 'mês quebrado barra');
  const erro = validarMeta({ ...metaPlanos, id: 'm2', nome: 'Upsell', produtos: ['plano:performance'] }, [metaPlanos]);
  eq(erro, 'Um produto só pode contar para uma meta do mês: ele já está na meta "Planos".', 'produto que já está noutra meta do mês barra (a venda pagaria duas vezes)');
  const copia = copiarMetas([metaPlanos], '2026-12', () => 'novo');
  eq([copia[0].id, copia[0].mes, copia[0].valores, copia[0].produtos], ['novo', '2026-12', metaPlanos.valores, metaPlanos.produtos], 'copiar para o mês seguinte: mesmos produtos e valores, id novo');
}

console.log('\n--- (d) quem vendeu ---');
{
  eq(vendedorDaVenda({ id: 'crm_user_7', nome: 'K', email: 'outro@x.com' }, vendedores)?.id, 'u-karen', 'pelo external_id do CRM');
  eq(vendedorDaVenda({ id: 'crm_user_99', nome: 'João', email: 'JOAO@entur.com.br' }, vendedores)?.id, 'u-joao', 'sem external_id, pelo e-mail');
  eq(vendedorDaVenda({ id: 'crm_user_99', nome: 'X', email: '' }, vendedores), null, 'sem nenhum dos dois, ninguém');
  eq(vendedorDaVenda(null, vendedores), null, 'venda sem vendedor no CRM');
}

console.log('\n--- (e) apuração ---');
{
  const a = apurarComissaoMrr({
    mes: MES, metas: [metaPlanos], vendedores, planos,
    vendas: [
      venda({ conta_id: 1, mrr: 346, itens: [{ chave: 'plano:essencial', nome: 'Essencial', classe: 'plano', mrr: 297 }, { chave: 'adicional:whatsapp_number', nome: 'Número de WhatsApp', classe: 'adicional', mrr: 49 }] }),
      venda({ conta_id: 2, conta_nome: 'Agência B', mrr: 497, itens: [{ chave: 'plano:performance', nome: 'Performance', classe: 'plano', mrr: 497 }] }),
      venda({ conta_id: 3, conta_nome: 'Agência C', mrr: 200, vendedor: { id: 'crm_user_55', nome: 'João', email: 'joao@entur.com.br' }, itens: [{ chave: 'plano:essencial', nome: 'Essencial', classe: 'plano', mrr: 200 }] }),
      venda({ conta_id: 4, conta_nome: 'Agência D', mrr: 150, vendedor: null }),
      venda({ conta_id: 5, conta_nome: 'Agência E', mrr: 300, vendedor: { id: 'crm_user_77', nome: 'Pedro', email: 'pedro@entur.com.br' } }),
      venda({ conta_id: 6, conta_nome: 'Agência F', mrr: 297, vendedor: { id: 'crm_user_9', nome: 'Ana', email: 'ana@entur.com.br' } }),
      venda({ conta_id: 7, dia: '2026-10-30', mrr: 999 }),
    ],
  });
  const karen = a.vendedores.find(v => v.vendedor_id === 'u-karen')!;
  eq([karen.metas[0].realizado, karen.metas[0].alvo, karen.metas[0].pct, karen.metas[0].percentual, karen.metas[0].comissao], [794, 1000, 79.4, 40, 317.6], 'Karen: R$ 794 de R$ 1.000 (79,4%) cai na faixa de 40%: R$ 317,60');
  eq(karen.metas[0].contas.map(c => [c.conta_id, c.mrr]), [[1, 297], [2, 497]], 'só o MRR dos produtos da meta conta (o WhatsApp da conta 1 não está na meta)');
  const joao = a.vendedores.find(v => v.vendedor_id === 'u-joao')!;
  eq([joao.metas[0].realizado, joao.metas[0].pct, joao.metas[0].percentual, joao.comissao], [200, 40, 20, 40], 'João (achado pelo e-mail): 40% da meta, faixa de 20%: R$ 40');
  const ana = a.vendedores.find(v => v.vendedor_id === 'u-ana')!;
  eq([ana.comissao, ana.pendencias.length >= 2], [0, true], 'Ana: sem plano e sem meta, nada se presume: comissão zero com as pendências à vista');
  eq([a.foraDasMetas.mrr, a.foraDasMetas.itens[0]?.chave], [49, 'adicional:whatsapp_number'], 'produto vendido fora das metas aparece à parte');
  eq([a.semVendedor.mrr, a.semVendedor.contas.length], [150, 1], 'venda sem negociação ligada aparece à parte');
  eq(a.semCadastro.map(s => [s.id, s.mrr]), [['crm_user_77', 300]], 'vendedor do CRM sem cadastro aqui aparece à parte');
  eq([a.total.mrr, a.total.mrr_nas_metas, a.total.comissao], [1790, 1291, 357.6], 'totais: o mês de outubro não entra');
  const semVenda = apurarComissaoMrr({ mes: MES, metas: [metaPlanos], vendedores, planos, vendas: [] });
  eq(semVenda.vendedores.map(v => [v.nome, v.metas[0].realizado, v.metas[0].pct]), [['João', 0, 0], ['Karen', 0, 0]], 'quem tem meta aparece mesmo sem venda, a 0%');
  const planoInativo = apurarComissaoMrr({ mes: MES, metas: [metaPlanos], vendedores, planos: [{ ...planos[0], ativo: false }], vendas: [venda({})] });
  eq([planoInativo.vendedores[0].comissao, planoInativo.vendedores[0].pendencias[0].startsWith('Sem plano de comissão ativo')], [0, true], 'plano inativo não paga');
  const semFaixa = apurarComissaoMrr({ mes: MES, metas: [metaPlanos], vendedores, planos: [{ ...planos[0], mrr: null }], vendas: [venda({})] });
  eq(semFaixa.vendedores[0].pendencias[0], 'O plano "SDR MRR" não tem faixas de MRR.', 'plano sem faixas de MRR: pendência, não comissão');
  const duasMetas = apurarComissaoMrr({
    mes: MES, vendedores, planos,
    metas: [metaPlanos, { ...metaPlanos, id: 'm-dup', nome: 'Duplicada', produtos: ['plano:essencial'] }],
    vendas: [venda({})],
  });
  eq(duasMetas.vendedores[0].metas.map(m => [m.nome, m.realizado]), [['Planos', 297], ['Duplicada', 0]], 'produto em duas metas no banco: a venda conta só na primeira (nunca paga duas vezes); a outra fica a zero');
}

console.log('\n--- (f) a linha em comissões ---');
{
  const a = apurarComissaoMrr({ mes: MES, metas: [metaPlanos], vendedores, planos, vendas: [venda({ mrr: 794, itens: [{ chave: 'plano:essencial', nome: 'Essencial', classe: 'plano', mrr: 794 }] })] });
  const l = linhaDaComissaoMrr(a.vendedores[0], MES);
  eq([l.id, l.venda_id, l.venda_numero, l.data_venda, l.valor_base, l.percentual_aplicado, l.valor_comissao, l.origem, l.status], [idDaComissaoMrr('u-karen', MES), 'mrr-2026-11', 'MRR 11/2026', '2026-11-30', 794, 40, 317.6, 'mrr', 'CALCULADA'], 'uma linha por vendedor e mês, com origem mrr');
  eq(decidirComissaoMrr(null, l).acao, 'gravar', 'nada gravado: grava');
  eq(decidirComissaoMrr({ status: 'CALCULADA', valor_comissao: 100 }, l).acao, 'gravar', 'calculada: regrava com o número novo');
  eq(decidirComissaoMrr({ status: 'CALCULADA', valor_comissao: 100 }, { ...l, valor_comissao: 0 }).acao, 'cancelar', 'calculada que zerou: cancela');
  eq(decidirComissaoMrr({ status: 'APROVADA', valor_comissao: 317.6 }, l).acao, 'nada', 'aprovada com o mesmo valor: nada');
  const mudou = decidirComissaoMrr({ status: 'PAGA', valor_comissao: 300 }, l);
  eq([mudou.acao, mudou.acao === 'manter' && /já foi paga/.test(mudou.motivo)], ['manter', true], 'paga com valor diferente: não reescreve, avisa');
  eq(decidirComissaoMrr({ status: 'CANCELADA', valor_comissao: 0 }, l).acao, 'gravar', 'cancelada que voltou a ter comissão: volta a valer');
  eq(decidirComissaoMrr(null, { ...l, valor_comissao: 0 }).acao, 'nada', 'sem comissão e nada gravado: nada');
}

console.log(`\n${total - falhas}/${total} testes da comissão por MRR passaram`);
if (falhas > 0) process.exit(1);

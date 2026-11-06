/**
 * Várias empresas dentro da agência (06/11/2026, E7 G2), só a lógica pura.
 *
 * Prova, antes de tudo, a REGRA DE OURO: com uma empresa só não há recorte
 * nenhum (escopo `null`) e rateio, fatias e relatórios dão exatamente o que
 * davam. Depois: escopo com seletor e permissão, rateio entre empresas
 * fechando 100%, fatias por empresa e a cópia de configuração que nunca leva
 * o que é da própria empresa.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-empresas.ts
 */
import {
  EMPRESA_PRINCIPAL_ID, cnpjValido, configParaCopiar, contaBancariaVisivel, contaDisponivelNaEmpresa, empresaDoRegistro,
  empresasDaContaBancaria, empresasDoRegistro, empresasLiberadasPor, escopoVisivel, filtrarPorEmpresa, formatarCnpj,
  normalizarEmpresa, ordenarEmpresas, principalDaAgencia, recusaDoRateioEntreEmpresas, registroVisivel, rotuloDaSelecao,
} from '../src/lib/empresas.ts';
import { dimensoesDoLancamento, fatiasDasEmpresas, validarRateio, prepararDimensoesDaConta } from '../src/lib/dimensoes.ts';
import { montarLinhas, totalizar, lerFiltros } from '../src/lib/lancamentos-por-dimensao.ts';
import { contasNoRecorte, parteNasEmpresas } from '../src/lib/empresas.ts';
import { ratearPorEmpresa, registrosDoDemonstrativo, camposDoDemonstrativo, CAMPOS_DO_DEMONSTRATIVO } from '../src/lib/resultado-por-categoria.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}

console.log('--- regra de ouro: uma empresa só, nenhum recorte ---');
{
  eq(escopoVisivel({ todas: ['principal'], permitidas: null, selecao: [] }), null, 'uma empresa: sem recorte');
  eq(escopoVisivel({ todas: ['principal'], permitidas: null, selecao: ['principal'] }), null, 'uma empresa marcada: sem recorte');
  eq(escopoVisivel({ todas: ['principal'], permitidas: ['principal'], selecao: [] }), null, 'uma empresa com perfil restrito: sem recorte');
  const itens = [{ id: 'a' }, { id: 'b', empresa_id: 'principal' }, { id: 'c', rateio: [{ centro_custo_id: 'x', percentual: 100 }] }];
  eq(filtrarPorEmpresa(itens, { tipo: 'registro' }, null), itens, 'sem recorte a lista volta igual (mesmo objeto)');
  eq(empresaDoRegistro({}), EMPRESA_PRINCIPAL_ID, 'registro de antes (sem empresa) é da principal');
  // Rateio sem empresa: mesma saída de sempre (congelada).
  const r = validarRateio(100, [
    { centro_custo_id: 'sp', percentual: 33.34, valor: 0 },
    { centro_custo_id: 'rj', categoria_id: 'c1', percentual: 33.33, valor: 0 },
    { centro_custo_id: 'bh', percentual: 33.33, valor: 0 },
  ]);
  eq(r, { ok: true, linhas: [
    { centro_custo_id: 'sp', percentual: 33.34, valor: 33.34 },
    { centro_custo_id: 'rj', categoria_id: 'c1', percentual: 33.33, valor: 33.33 },
    { centro_custo_id: 'bh', percentual: 33.33, valor: 33.33 },
  ] }, 'rateio sem empresa: as mesmas linhas de antes, sem campo novo');
  eq(validarRateio(10, [{ centro_custo_id: '', percentual: 100, valor: 0 }]), { ok: false, erro: 'Escolha o centro de custo da linha 1 do rateio.' }, 'sem empresa, o centro continua obrigatório (mesma mensagem)');
  const d = dimensoesDoLancamento({ valor_final: 1000, categoria_id: 'cat', centro_custo_id: 'sp', status: 'PAGO', valor_pago: 1000, data_pagamento: '2026-11-01' }, { lado: 'pagar' });
  eq(d.fatias.map(f => [f.valor, f.valor_caixa, f.empresa_id]), [[1000, 1000, 'principal']], 'conta sem empresa: uma fatia, da principal');
  eq(fatiasDasEmpresas(d.fatias, null), d.fatias, 'sem recorte, todas as fatias');
}

console.log('--- cadastro ---');
{
  eq(cnpjValido('11.222.333/0001-81'), true, 'CNPJ válido');
  eq(cnpjValido('11.222.333/0001-82'), false, 'dígito errado');
  eq(cnpjValido('11111111111111'), false, 'repetido');
  eq(formatarCnpj('11222333000181'), '11.222.333/0001-81', 'formata CNPJ');
  eq(normalizarEmpresa({ nome: '  ' }), { ok: false, erro: 'Dê um nome à empresa (como ela aparece nas listas).' }, 'nome obrigatório');
  eq(normalizarEmpresa({ nome: 'Loja Centro', cnpj: '123' }), { ok: false, erro: 'O CNPJ não confere. Revise os números.' }, 'CNPJ inválido recusado');
  const ok = normalizarEmpresa({ nome: ' Loja   Centro ', cnpj: '11.222.333/0001-81', razao_social: 'Centro Viagens LTDA' });
  eq(ok.ok && ok.empresa, { nome: 'Loja Centro', razao_social: 'Centro Viagens LTDA', cnpj: '11222333000181', ativa: true, ordem: undefined }, 'normaliza espaços e CNPJ');
  eq(principalDaAgencia({ nome_fantasia: 'Viaje Bem', razao_social: 'VB Turismo LTDA', cnpj: '11.222.333/0001-81' }),
    { id: 'principal', nome: 'Viaje Bem', razao_social: 'VB Turismo LTDA', cnpj: '11222333000181', principal: true, ativa: true, ordem: 0 },
    'a principal nasce dos dados da agência');
  eq(principalDaAgencia(null).nome, 'Empresa principal', 'agência sem nome: "Empresa principal"');
  eq(ordenarEmpresas([
    { nome: 'Zeta', principal: false }, { nome: 'Alfa', principal: false }, { nome: 'Matriz', principal: true },
  ]).map(e => e.nome), ['Matriz', 'Alfa', 'Zeta'], 'principal primeiro, depois por nome');
}

console.log('--- escopo: seletor e permissão ---');
{
  const todas = ['principal', 'emp_b', 'emp_c'];
  eq(escopoVisivel({ todas, permitidas: null, selecao: [] }), null, 'nada marcado: todas, sem recorte');
  eq(escopoVisivel({ todas, permitidas: null, selecao: ['emp_b'] }), ['emp_b'], 'uma marcada');
  eq(escopoVisivel({ todas, permitidas: null, selecao: ['emp_c', 'principal'] }), ['emp_c', 'principal'], 'várias marcadas ao mesmo tempo');
  eq(escopoVisivel({ todas, permitidas: null, selecao: todas }), null, 'todas marcadas = sem recorte');
  eq(escopoVisivel({ todas, permitidas: ['emp_b'], selecao: [] }), ['emp_b'], 'perfil só da B: vê só a B');
  eq(escopoVisivel({ todas, permitidas: ['emp_b'], selecao: ['principal'] }), ['emp_b'], 'marcar empresa não liberada não abre nada');
  eq(escopoVisivel({ todas, permitidas: [], selecao: [] }), [], 'perfil sem empresa ativa liberada: nada');
  eq(rotuloDaSelecao([], [{ id: 'a', nome: 'A' }, { id: 'b', nome: 'B' }]), 'Todas as empresas', 'rótulo: todas');
  eq(rotuloDaSelecao(['b'], [{ id: 'a', nome: 'A' }, { id: 'b', nome: 'Loja B' }]), 'Loja B', 'rótulo: uma');
  eq(rotuloDaSelecao(['a', 'b'], [{ id: 'a', nome: 'A' }, { id: 'b', nome: 'B' }, { id: 'c', nome: 'C' }]), '2 empresas', 'rótulo: várias');

  eq(empresasLiberadasPor(true, [{ acesso_total: false, empresas: ['b'] }], null), null, 'administrador nunca é restringido');
  eq(empresasLiberadasPor(false, [], null), null, 'sem perfil e sem restrição: todas');
  eq(empresasLiberadasPor(false, [{ acesso_total: true, empresas: ['b'] }], null), ['b'], 'acesso completo SÓ na loja B');
  eq(empresasLiberadasPor(false, [{ acesso_total: false, empresas: ['b'] }, { acesso_total: false, empresas: [] }], null), null, 'um perfil sem empresa marcada libera todas');
  eq(empresasLiberadasPor(false, [{ acesso_total: false, empresas: ['b'] }, { acesso_total: false, empresas: ['c'] }], null), ['b', 'c'], 'dois perfis: a soma');
  eq(empresasLiberadasPor(false, [{ acesso_total: false, empresas: ['b', 'c'] }], { empresas_liberadas: ['c', 'd'] }), ['c'], 'a restrição própria corta por cima');
}

console.log('--- registros, contas bancárias e linhas por conta ---');
{
  const daB = { id: '1', empresa_id: 'emp_b' };
  const rateada = { id: '2', empresa_id: 'principal', rateio: [{ empresa_id: 'principal', percentual: 60 }, { empresa_id: 'emp_b', percentual: 40 }] };
  const rateadaParcial = { id: '3', empresa_id: 'emp_c', rateio: [{ centro_custo_id: 'x', percentual: 50 }, { empresa_id: 'emp_b', percentual: 50 }] };
  eq(empresasDoRegistro(rateada), ['emp_b', 'principal'], 'rateio entre empresas: as duas');
  eq(empresasDoRegistro(rateadaParcial), ['emp_b', 'emp_c'], 'linha sem empresa fica na empresa do registro');
  eq(registroVisivel(daB, ['principal']), false, 'registro da B some de quem vê só a principal');
  eq(registroVisivel(rateada, ['emp_b']), true, 'rateado aparece em quem vê a B');
  eq(registroVisivel({ id: '4' }, ['principal']), true, 'registro de antes aparece na principal');

  const conta = { id: 'cb1', empresa_id: 'principal', empresas_disponiveis: ['emp_b'] };
  eq(empresasDaContaBancaria(conta), ['emp_b', 'principal'], 'conta disponível na B também');
  eq(contaBancariaVisivel(conta, ['emp_b']), true, 'conta da principal disponível na B aparece na B');
  eq(contaBancariaVisivel({ id: 'cb2', empresa_id: 'principal' }, ['emp_b']), false, 'conta só da principal some na B');
  eq(contaDisponivelNaEmpresa({ id: 'cb2' }, 'principal'), true, 'conta de antes está na principal');
  const extrato = [{ id: 'e1', conta_bancaria_id: 'cb1' }, { id: 'e2', conta_bancaria_id: 'cb2' }, { id: 'e3', conta_bancaria_id: '' }];
  eq(filtrarPorEmpresa(extrato, { tipo: 'por_conta' }, ['emp_b'], new Set(['cb1'])).map(e => e.id), ['e1', 'e3'], 'extrato: só das contas visíveis (linha sem conta fica)');
  eq(recusaDoRateioEntreEmpresas([{ empresa_id: 'emp_x', percentual: 100 }], ['principal', 'emp_b']), 'A empresa da linha 1 do rateio não existe ou está inativa.', 'rateio para empresa que não existe');
  eq(recusaDoRateioEntreEmpresas([{ empresa_id: 'emp_b', percentual: 100 }], ['principal', 'emp_b']), null, 'rateio para empresa ativa');
}

console.log('--- rateio entre empresas fecha 100% ---');
{
  const r = validarRateio(1000, [
    { centro_custo_id: '', empresa_id: 'principal', percentual: 60, valor: 0 },
    { centro_custo_id: '', empresa_id: 'emp_b', percentual: 40, valor: 0 },
  ]);
  eq(r, { ok: true, linhas: [
    { centro_custo_id: '', empresa_id: 'principal', percentual: 60, valor: 600 },
    { centro_custo_id: '', empresa_id: 'emp_b', percentual: 40, valor: 400 },
  ] }, 'linha só de empresa (sem centro) vale; 60/40 fecha os centavos');
  eq(validarRateio(1000, [
    { centro_custo_id: '', empresa_id: 'principal', percentual: 60, valor: 0 },
    { centro_custo_id: '', empresa_id: 'emp_b', percentual: 30, valor: 0 },
  ]), { ok: false, erro: 'O rateio soma 90%. Faltam 10% para fechar 100%.' }, 'entre empresas também precisa fechar 100%');
  eq(validarRateio(1000, [
    { centro_custo_id: 'sp', empresa_id: 'emp_b', percentual: 50, valor: 0 },
    { centro_custo_id: 'sp', empresa_id: 'emp_b', percentual: 50, valor: 0 },
  ]), { ok: false, erro: 'A linha 2 repete empresa, centro e categoria de outra linha. Junte as duas.' }, 'empresa+centro repetidos');
  eq(validarRateio(1000, [
    { centro_custo_id: 'sp', empresa_id: 'principal', percentual: 50, valor: 0 },
    { centro_custo_id: 'sp', empresa_id: 'emp_b', percentual: 50, valor: 0 },
  ]).ok, true, 'mesmo centro em empresas diferentes vale');
  const terco = validarRateio(100, [
    { centro_custo_id: '', empresa_id: 'a', percentual: 33.34, valor: 0 },
    { centro_custo_id: '', empresa_id: 'b', percentual: 33.33, valor: 0 },
    { centro_custo_id: '', empresa_id: 'c', percentual: 33.33, valor: 0 },
  ]);
  eq(terco.ok && terco.linhas.reduce((s, l) => s + Math.round(l.valor * 100), 0), 10000, 'três empresas: os centavos fecham o total');

  const item: Record<string, unknown> = { valor_final: 250, rateio: [{ empresa_id: 'principal', centro_custo_id: '', percentual: 50, valor: 1 }, { empresa_id: 'emp_b', centro_custo_id: '', percentual: 50, valor: 1 }] };
  eq(prepararDimensoesDaConta(item), null, 'conta com rateio entre empresas grava');
  eq((item.rateio as Array<{ valor: number }>).map(l => l.valor), [125, 125], 'valor de cada empresa refeito no servidor');
}

console.log('--- fatias por empresa (DRE, resultado, relatórios) ---');
{
  const conta = {
    valor_final: 1000, categoria_id: 'aluguel', centro_custo_id: 'sp', empresa_id: 'principal', status: 'PARCIAL', valor_pago: 500, data_pagamento: '2026-11-03',
    rateio: [{ empresa_id: 'principal', centro_custo_id: '', percentual: 60 }, { empresa_id: 'emp_b', centro_custo_id: 'rj', percentual: 40 }],
  };
  const d = dimensoesDoLancamento(conta, { lado: 'pagar', centros: [{ id: 'sp', nome: 'SP' }, { id: 'rj', nome: 'RJ' }] });
  eq(d.fatias.map(f => [f.empresa_id, f.centro_custo_nome, f.valor, f.valor_caixa]), [['principal', 'SP', 600, 300], ['emp_b', 'RJ', 400, 200]],
    'cada empresa com a sua parte; linha sem centro herda o da conta; caixa proporcional');
  eq(fatiasDasEmpresas(d.fatias, ['emp_b']).map(f => f.valor), [400], 'quem vê só a B soma 40%');
  eq(fatiasDasEmpresas(d.fatias, ['principal', 'emp_b']).map(f => f.valor), [600, 400], 'as duas: 100%');

  const contas = [
    { id: 'p1', lado: 'pagar' as const, data: { ...conta, data_vencimento: '2026-11-10', data_emissao: '2026-11-01' } },
    { id: 'p2', lado: 'pagar' as const, data: { valor_final: 300, categoria_id: 'aluguel', empresa_id: 'emp_b', status: 'PENDENTE', data_vencimento: '2026-11-12', data_emissao: '2026-11-01' } },
    { id: 'p3', lado: 'pagar' as const, data: { valor_final: 50, categoria_id: 'aluguel', status: 'PENDENTE', data_vencimento: '2026-11-12', data_emissao: '2026-11-01' } },
  ];
  const ctx = { categorias: [{ id: 'aluguel', nome: 'Aluguel', tipo: 'DESPESA' }], centros: [], contasBancarias: new Map(), vendas: new Map() };
  const f = lerFiltros(new URLSearchParams({ visao: 'categoria', data_de: 'VENCIMENTO', de: '2026-11-01', ate: '2026-11-30' }), '2026-11-05');
  const todas = montarLinhas(contas, ctx, f, '2026-11-05');
  eq(totalizar(todas).valor, 1350, 'sem recorte: o total de sempre (1000 + 300 + 50)');
  eq(totalizar(montarLinhas(contas, { ...ctx, empresas: null }, f, '2026-11-05')).valor, 1350, 'empresas = null é o mesmo que antes');
  eq(totalizar(montarLinhas(contas, { ...ctx, empresas: ['emp_b'] }, f, '2026-11-05')).valor, 700, 'só a B: 40% do rateado + a conta da B');
  eq(totalizar(montarLinhas(contas, { ...ctx, empresas: ['principal'] }, f, '2026-11-05')).valor, 650, 'só a principal: 60% do rateado + a conta de antes');
  const rateio = lerFiltros(new URLSearchParams({ visao: 'rateio', data_de: 'VENCIMENTO', de: '2026-11-01', ate: '2026-11-30' }), '2026-11-05');
  eq(montarLinhas(contas, ctx, rateio, '2026-11-05').map(l => [l.empresa_id, l.valor]), [['principal', 600], ['emp_b', 400]], 'relatório por rateio mostra a empresa de cada linha');
}

console.log('--- copiar de outra empresa ---');
{
  const origem = { provedor: 'aceleraapi', aliquota_iss: 2, item_lista_servico: '9.02', token: 'ace_x', empresa_id: 77, certificado: { referencia_gateway: 'r' }, cnpj: '1', id: 'cfg' };
  const destino = { token: 'ace_b', empresa_id: 88, id: 'cfg:b' };
  eq(configParaCopiar('notas', origem, destino), { provedor: 'aceleraapi', aliquota_iss: 2, item_lista_servico: '9.02', token: 'ace_b', empresa_id: 88, id: 'cfg:b' },
    'notas: copia o enquadramento, nunca o token, o certificado nem o número do emissor');
  eq(configParaCopiar('vendas', { venda_config: { receita: { componentes: { OVER: false } } } }), { venda_config: { receita: { componentes: { OVER: false } } } }, 'vendas: copia tudo');
}

console.log('--- DRE e fluxo (somam no navegador) e resultado por categoria ---');
{
  const contas = [
    { id: 'a', valor_final: 1000, valor_pago: 500, status: 'PARCIAL', empresa_id: 'principal', rateio: [{ empresa_id: 'principal', percentual: 60 }, { empresa_id: 'emp_b', percentual: 40 }] },
    { id: 'b', valor_final: 300, empresa_id: 'emp_b' },
    { id: 'c', valor_final: 50 },
  ];
  eq(contasNoRecorte(contas, null), contas, 'sem recorte: a mesma lista (regra de ouro)');
  eq(contasNoRecorte(contas, ['emp_b']).map(c => [c.id, c.valor_final, (c as { valor_pago?: number }).valor_pago ?? null]), [['a', 400, 200], ['b', 300, null]],
    'só a B: 40% do rateado (valor e pago) e a conta da B');
  eq(contasNoRecorte(contas, ['principal']).map(c => [c.id, c.valor_final]), [['a', 600], ['c', 50]], 'só a principal: 60% e a conta de antes');
  eq(contas[0].valor_final, 1000, 'a lista original não é alterada');
  eq(parteNasEmpresas({ empresa_id: 'emp_c', rateio: [{ centro_custo_id: 'x', percentual: 50 }, { empresa_id: 'emp_b', percentual: 50 }] }, ['emp_c']), 0.5, 'linha sem empresa conta para a do título');

  eq(ratearPorEmpresa(-100001, [{ empresa_id: 'principal', percentual: 60 }, { empresa_id: 'emp_b', percentual: 40 }], 'principal'),
    [{ empresa: 'principal', centavos: -60000 }, { empresa: 'emp_b', centavos: -40001 }], 'rateio por empresa fecha os centavos');
  eq(ratearPorEmpresa(500, [{ percentual: 100 }], 'emp_b'), [{ empresa: 'emp_b', centavos: 500 }], 'sem linha de empresa: tudo na da conta');

  const base = {
    receber: [], pagar: [
      { id: 'a', status: 'PENDENTE', valor_final: 1000, data_vencimento: '2026-11-10', categoria_id: 'x', empresa_id: 'principal', rateio: [{ empresa_id: 'principal', percentual: 60 }, { empresa_id: 'emp_b', percentual: 40 }] },
      { id: 'b', status: 'PENDENTE', valor_final: 300, data_vencimento: '2026-11-11', categoria_id: 'x', empresa_id: 'emp_b' },
    ],
    planoContas: [], contasBancarias: [], regime: 'competencia' as const, incluirRepasse: true, usarRateio: false,
  } as unknown as Parameters<typeof registrosDoDemonstrativo>[0];
  const antes = registrosDoDemonstrativo(base);
  eq(antes.every(r => !('empresa' in r.campos)), true, 'uma empresa só: nenhum campo Empresa nos registros');
  eq(camposDoDemonstrativo(false), CAMPOS_DO_DEMONSTRATIVO, 'uma empresa só: os campos de sempre');
  eq(camposDoDemonstrativo(true).includes('empresa'), true, 'duas ou mais: o campo Empresa');
  const nomes = new Map([['principal', 'Matriz'], ['emp_b', 'Loja B']]);
  const comRateio = registrosDoDemonstrativo({ ...base, usarRateio: true, multiempresa: { nomes, visiveis: null } });
  eq(comRateio.map(r => [r.campos.empresa, r.centavos]), [['Matriz', -60000], ['Loja B', -40000], ['Loja B', -30000]], 'dividir pelo rateio: cada empresa com a sua parte');
  const soB = registrosDoDemonstrativo({ ...base, usarRateio: true, multiempresa: { nomes, visiveis: ['emp_b'] } });
  eq(soB.reduce((s, r) => s + r.centavos, 0), -70000, 'só a B: 40% do rateado + a conta da B');
  const semDividir = registrosDoDemonstrativo({ ...base, multiempresa: { nomes, visiveis: ['emp_b'] } });
  eq(semDividir.reduce((s, r) => s + r.centavos, 0), -30000, 'sem dividir pelo rateio: a conta conta inteira na empresa dela');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);

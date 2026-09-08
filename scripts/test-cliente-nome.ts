/**
 * Testes do caminho único de nome/tipo do cliente (src/lib/cliente-nome.ts).
 *
 * Estes casos reproduzem o incidente de 2026-09-08: a página /vendas caía com
 * "Algo deu errado" porque a derivação do nome devolvia undefined para todo
 * cliente vindo do CRM, e a tela chamava .toLowerCase() no resultado.
 *
 * Roda com: node --experimental-strip-types scripts/test-cliente-nome.ts
 */
import {
  nomeDoCliente,
  nomeDoClienteOuTraco,
  tipoPessoa,
  tipoPessoaLabel,
  documentoDoCliente,
} from '../src/lib/cliente-nome.ts';

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

// ══════════════════════════════════════════════════════════════════════
console.log('--- o incidente: cliente vindo do CRM ---');
{
  // Shape exato gravado por upsertClienteByExternalId em crm-integration.ts:
  // tipo 'fisica' e SÓ o campo `nome`. Sem nome_completo, sem nome_fantasia,
  // sem razao_social.
  const doCrm = {
    id: 'c1',
    nome: 'Maria Souza',
    cpf_cnpj: '12345678900',
    tipo: 'fisica',
    email: 'maria@exemplo.com',
    telefone: '11999999999',
    origem: 'crm',
    external_id: 'crm_contact_42',
  };

  eq(nomeDoCliente(doCrm), 'Maria Souza', 'nome do cliente do CRM é encontrado');
  eq(tipoPessoa(doCrm.tipo), 'PF', "tipo 'fisica' é pessoa física, não jurídica");
  eq(tipoPessoaLabel(doCrm.tipo), 'Pessoa Física', 'rótulo correto na tela');
  eq(documentoDoCliente(doCrm), '12345678900', 'documento vem do campo unificado');

  // A regressão que derrubava a página: a expressão antiga devolvia undefined.
  const derivacaoAntiga = doCrm.tipo === 'PF'
    ? (doCrm as Record<string, unknown>).nome_completo
    : ((doCrm as Record<string, unknown>).nome_fantasia || (doCrm as Record<string, unknown>).razao_social);
  eq(derivacaoAntiga, undefined, 'a derivação antiga devolvia undefined (causa do erro)');
  eq(typeof nomeDoCliente(doCrm), 'string', 'a nova nunca devolve undefined');
  // O que a tela faz com o resultado precisa ser seguro.
  eq(nomeDoCliente(doCrm).toLowerCase(), 'maria souza', 'toLowerCase no resultado não lança');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- normalização do tipo de pessoa ---');
{
  eq(tipoPessoa('PF'), 'PF', 'PF');
  eq(tipoPessoa('PJ'), 'PJ', 'PJ');
  eq(tipoPessoa('fisica'), 'PF', 'fisica (default da coluna)');
  eq(tipoPessoa('juridica'), 'PJ', 'juridica');
  eq(tipoPessoa('jurídica'), 'PJ', 'jurídica com acento');
  eq(tipoPessoa('JURIDICA'), 'PJ', 'caixa alta');
  eq(tipoPessoa('  Jurídica  '), 'PJ', 'com espaços em volta');
  eq(tipoPessoa('pj'), 'PJ', 'minúscula');
  eq(tipoPessoa(''), 'PF', 'vazio cai em pessoa física');
  eq(tipoPessoa(null), 'PF', 'nulo cai em pessoa física');
  eq(tipoPessoa(undefined), 'PF', 'ausente cai em pessoa física');
  eq(tipoPessoa('qualquer coisa'), 'PF', 'desconhecido cai em pessoa física');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- ordem de preferência do nome ---');
{
  eq(
    nomeDoCliente({ tipo: 'PF', nome_completo: 'Ana Lima', nome: 'ignorado' }),
    'Ana Lima',
    'pessoa física prefere nome_completo',
  );
  eq(
    nomeDoCliente({ tipo: 'PJ', nome_fantasia: 'Loja X', razao_social: 'Loja X Ltda' }),
    'Loja X',
    'pessoa jurídica prefere nome fantasia',
  );
  eq(
    nomeDoCliente({ tipo: 'PJ', nome_fantasia: '', razao_social: 'Loja X Ltda' }),
    'Loja X Ltda',
    'sem nome fantasia cai na razão social',
  );
  eq(
    nomeDoCliente({ tipo: 'PJ', nome: 'Empresa do CRM' }),
    'Empresa do CRM',
    'pessoa jurídica do CRM cai no campo nome',
  );
  eq(
    nomeDoCliente({ tipo: 'PF', nome_completo: '   ', nome: 'Real' }),
    'Real',
    'campo só com espaços não conta como preenchido',
  );
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- nunca lança, nunca devolve undefined ---');
{
  eq(nomeDoCliente(null), '', 'cliente nulo');
  eq(nomeDoCliente(undefined), '', 'cliente ausente');
  eq(nomeDoCliente({}), '', 'objeto vazio');
  eq(nomeDoCliente({ tipo: 'PF' }), '', 'sem nenhum campo de nome');
  eq(nomeDoClienteOuTraco(null), '—', 'traço quando não há cliente');
  eq(nomeDoClienteOuTraco({}), '—', 'traço quando não há nome');
  eq(nomeDoClienteOuTraco({ nome: 'Tem nome' }), 'Tem nome', 'nome vence o traço');
  eq(nomeDoClienteOuTraco(null, 'Cliente'), 'Cliente', 'marcador customizável');
  eq(documentoDoCliente(null), '', 'documento de cliente nulo');
  eq(documentoDoCliente({}), '', 'documento ausente');

  // O uso real na tela: filtrar e ordenar sem quebrar.
  const lista = [
    { id: '1', tipo: 'fisica', nome: 'Zeca' },
    { id: '2', tipo: 'PJ', razao_social: 'Alfa Ltda' },
    { id: '3' },
    { id: '4', tipo: 'PF', nome_completo: 'Bruno' },
  ];
  const nomes = lista.map(c => nomeDoClienteOuTraco(c).toLowerCase());
  eq(nomes, ['zeca', 'alfa ltda', '—', 'bruno'], 'a lista inteira passa por toLowerCase sem lançar');
  const ordenada = [...nomes].sort((a, b) => a.localeCompare(b));
  eq(ordenada[0], '—', 'ordenação também é segura');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- documento por tipo de pessoa ---');
{
  eq(documentoDoCliente({ tipo: 'PF', cpf: '111', cnpj: '222' }), '111', 'pessoa física mostra CPF');
  eq(documentoDoCliente({ tipo: 'PJ', cpf: '111', cnpj: '222' }), '222', 'pessoa jurídica mostra CNPJ');
  eq(documentoDoCliente({ tipo: 'fisica', cpf_cnpj: '333' }), '333', 'cliente do CRM usa o campo unificado');
  eq(documentoDoCliente({ tipo: 'PF', cpf: '', cpf_cnpj: '444' }), '444', 'CPF vazio cai no unificado');
}

// ══════════════════════════════════════════════════════════════════════
console.log(`\n${total - falhas}/${total} testes de nome do cliente passaram`);
if (falhas > 0) process.exit(1);

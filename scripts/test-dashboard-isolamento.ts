/**
 * O porteiro do isolamento entre agências.
 *
 * POR QUE ISTO É TESTE DE TEXTO-FONTE. Este banco não tem foreign key e não
 * tem RLS: a única barreira entre o dinheiro de duas agências é o
 * `WHERE tenant_id = $1`. Uma consulta nova sem ele não quebra nada, não erra
 * no console e não aparece em revisão distraída — ela só mostra o caixa de uma
 * agência para outra.
 *
 * O teste de payload já prova que os números não vazam no cenário que ele monta.
 * Este aqui prova outra coisa: que NENHUMA consulta dos módulos do dashboard
 * existe sem a cláusula, inclusive as que ainda vão ser escritas.
 *
 * Roda com: node --experimental-strip-types scripts/test-dashboard-isolamento.ts
 */
import { readFileSync } from 'node:fs';

let falhas = 0;
let total = 0;
function ok(condicao: boolean, label: string, detalhe = '') {
  total++;
  if (condicao) console.log(`PASS  ${label}`);
  else {
    falhas++;
    console.log(`FAIL  ${label}${detalhe ? `\n        ${detalhe}` : ''}`);
  }
}

const MODULOS = [
  'src/lib/dashboard-financeiro.ts',
  'src/lib/dashboard-detalhe.ts',
];

/**
 * Extrai o argumento inteiro de cada chamada `exec.query(...)`.
 *
 * Regex sobre crases NÃO serve aqui: as consultas interpolam expressões que
 * elas próprias contêm crases (`${numerico(\`data->>'x'\`)}`), e um
 * `[^\`]*` corta a consulta ao meio, criando falso positivo. A unidade certa
 * é a chamada, e ela se acha por balanceamento de parênteses.
 */
function consultas(fonte: string): string[] {
  const achadas: string[] = [];
  const marca = 'exec.query(';
  let i = fonte.indexOf(marca);
  while (i !== -1) {
    let profundidade = 0;
    let j = i + marca.length - 1;
    for (; j < fonte.length; j++) {
      if (fonte[j] === '(') profundidade++;
      else if (fonte[j] === ')') {
        profundidade--;
        if (profundidade === 0) break;
      }
    }
    const trecho = fonte.slice(i, j + 1);
    if (/SELECT/i.test(trecho)) achadas.push(trecho);
    i = fonte.indexOf(marca, j + 1);
  }
  return achadas;
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- toda consulta filtra por agência ---');
for (const caminho of MODULOS) {
  const fonte = readFileSync(caminho, 'utf8');
  const lista = consultas(fonte);
  ok(lista.length > 0, `${caminho} tem consultas para conferir`, 'se isto falhar, o extrator quebrou');

  for (const [i, q] of lista.entries()) {
    const primeiraLinha = q.trim().split('\n')[0].trim().slice(0, 70);
    ok(/tenant_id/.test(q), `${caminho} · consulta ${i + 1} filtra tenant_id`, primeiraLinha);
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- o tenant vai como PARÂMETRO, nunca interpolado ---');
for (const caminho of MODULOS) {
  const fonte = readFileSync(caminho, 'utf8');
  // `tenant_id = '${algo}'` ou `tenant_id = ${algo}` é injeção esperando
  // acontecer. O certo é sempre `tenant_id = $1`.
  const interpolado = [...fonte.matchAll(/tenant_id\s*=\s*'?\$\{/g)].map(m => m[0]);
  ok(interpolado.length === 0, `${caminho} não interpola o tenant no SQL`, interpolado.join(', '));
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- subconsultas e junções também filtram ---');
{
  const fonte = readFileSync('src/lib/dashboard-financeiro.ts', 'utf8');

  // O EXISTS de "venda sem lastro" varre outra tabela: sem a cláusula ele
  // casaria a venda de uma agência com a conta de outra e o indicador diria
  // que a venda tem lastro quando não tem.
  const existe = [...fonte.matchAll(/EXISTS\s*\(SELECT[\s\S]*?\)/gi)].map(m => m[0]);
  ok(existe.length > 0, 'há subconsulta EXISTS para conferir');
  for (const [i, sub] of existe.entries()) {
    ok(/tenant_id/.test(sub), `subconsulta EXISTS ${i + 1} amarra o tenant`, sub.slice(0, 80));
  }

  // Todo JOIN precisa casar o tenant dos DOIS lados. Só o WHERE da tabela
  // principal não basta: a linha da outra tabela entra pelo ON.
  const joins = [...fonte.matchAll(/\bJOIN\s+(\w+)\s+(\w+)\s+ON\s+([^\n]*(?:\n\s+AND[^\n]*)*)/gi)];
  ok(joins.length > 0, 'há JOIN para conferir');
  for (const j of joins) {
    const [, tabela, alias, condicao] = j;
    // Um JOIN entre CTEs que JÁ filtraram o tenant não precisa repetir a
    // cláusula: os dois lados já são de uma agência só. A dispensa exige
    // `tenant-ok:` na linha anterior, com a razão — pelo mesmo motivo das
    // outras exceções do projeto: dispensa invisível vira regra.
    // A dispensa vale para a CONSULTA inteira, não para a linha: o marcador
    // fica junto do SELECT e o JOIN pode vir muitas linhas depois.
    const inicioDaConsulta = fonte.lastIndexOf('exec.query(', j.index ?? 0);
    const dispensado = fonte.slice(inicioDaConsulta, j.index ?? 0).includes('tenant-ok:');
    ok(
      /tenant_id/.test(condicao) || dispensado,
      `o JOIN com ${tabela} (${alias}) casa o tenant dos dois lados`,
      condicao.trim().slice(0, 90),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- as rotas exigem permissão de financeiro ---');
{
  // Saldo em caixa, margem e posição de fornecedor são dados de dono. As rotas
  // de CRUD de contas não exigem essa permissão hoje (quem tem sessão lê tudo);
  // as rotas novas exigem, e este teste impede que alguém remova a guarda.
  for (const rota of ['src/app/api/dashboard/route.ts', 'src/app/api/dashboard/lancamentos/route.ts']) {
    const fonte = readFileSync(rota, 'utf8');
    ok(fonte.includes('bloqueioFinanceiro'), `${rota} chama bloqueioFinanceiro`);
    ok(fonte.includes('getTenantId'), `${rota} resolve o tenant da sessão`);
    // O tenant NUNCA pode vir da query string: seria trocar de agência pela URL.
    ok(
      !/searchParams\.get\(['"]tenant/i.test(fonte),
      `${rota} não aceita tenant pela URL`,
      'trocar de agência pela query string seria acesso a outra empresa',
    );
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- o recorte do drill-down é fechado ---');
{
  const fonte = readFileSync('src/lib/dashboard-detalhe.ts', 'utf8');
  // O recorte é um enum e a referência vai como parâmetro. Se alguém um dia
  // montar a condição concatenando o que veio do navegador, este teste cai.
  ok(/const RECORTES/.test(fonte), 'a lista de recortes é fechada e exportada');
  const condicoes = fonte.slice(fonte.indexOf('const condicoes'), fonte.indexOf('const condicao'));
  ok(
    !/\$\{(?!aberto|feito|venc|colunaDaContraparte|dataDoCaixa|origemReceber|vendaDeOrigem|ehRepasse|e\.lado)/.test(
      condicoes.replace(/\$\{e\.lado === 'receber' \? [^}]*\}/g, ''),
    ),
    'as condições só interpolam expressões do próprio módulo, nunca entrada do usuário',
  );
  const rota = readFileSync('src/app/api/dashboard/lancamentos/route.ts', 'utf8');
  ok(rota.includes('RECORTES.includes'), 'a rota valida o recorte contra a lista fechada');
}

console.log(`\n${total - falhas}/${total} testes de isolamento passaram`);
if (falhas > 0) process.exit(1);

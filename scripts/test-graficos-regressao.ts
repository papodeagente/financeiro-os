/**
 * Porteiro dos gráficos do pilar Equipe.
 *
 * POR QUE ISTO É UM TESTE DE TEXTO-FONTE. As regras que este trabalho
 * estabeleceu não quebram typecheck e não quebram render: elas só desenham
 * errado, e o erro chega ao usuário parecendo um fato. Um piso de 3px numa
 * barra compila perfeitamente e transforma cinco meses sem faturamento em
 * cinco meses de venda pequena.
 *
 * O QUE ESTE TESTE NÃO FAZ: não prova que o desenho está certo. Prova que os
 * defeitos NOMEADOS, que já estiveram no código e foram removidos, não
 * voltaram. A regra de negócio de verdade mora em src/lib/escala.ts e tem
 * testes próprios em scripts/test-escala.ts.
 *
 * Roda com: node --experimental-strip-types scripts/test-graficos-regressao.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let falhas = 0;
let total = 0;

function ok(condicao: boolean, label: string, detalhe = '') {
  total++;
  if (condicao) {
    console.log(`PASS  ${label}`);
  } else {
    falhas++;
    console.log(`FAIL  ${label}${detalhe ? `\n        ${detalhe}` : ''}`);
  }
}

const DIR_FIN = 'src/components/fin';

/** Os componentes que desenham. São estes que as regras governam. */
const GRAFICOS = [
  'BarraDeParte.tsx',
  'BarrasNomeadas.tsx',
  'Cascata.tsx',
  'EscadaAcumulada.tsx',
  'EscadaDeFaixas.tsx',
  'PainelDeSaude.tsx',
  'ProjecaoDeCaixa.tsx',
  'ReguaDeRazao.tsx',
  'SerieFinanceira.tsx',
  'Unidades.tsx',
];

const TELAS = [
  'src/app/dashboard/page.tsx',
  'src/app/equipe/folha/page.tsx',
  'src/app/equipe/metas/page.tsx',
  'src/app/equipe/comissoes/page.tsx',
  'src/app/equipe/vendedores/page.tsx',
];

function ler(caminho: string): string {
  return readFileSync(caminho, 'utf8');
}

/** Remove comentários de linha e de bloco: a regra é sobre o que EXECUTA. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const fontes = new Map<string, string>();
for (const arquivo of GRAFICOS) fontes.set(arquivo, semComentarios(ler(join(DIR_FIN, arquivo))));
for (const tela of TELAS) fontes.set(tela, semComentarios(ler(tela)));

// ══════════════════════════════════════════════════════════════════════
console.log('--- todos os gráficos existem ---');
{
  const presentes = readdirSync(DIR_FIN);
  for (const arquivo of GRAFICOS) {
    ok(presentes.includes(arquivo), `${arquivo} está no lugar`);
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- nenhum componente inventa a própria escala ---');
{
  // A régua é a única porta. Seis componentes com seis réguas divergem em um
  // mês: uma arredonda a ponta, outra não; uma trata zero, outra desenha piso.
  for (const arquivo of GRAFICOS) {
    const fonte = fontes.get(arquivo)!;
    const usaRegua = fonte.includes("from '@/lib/escala'");
    const desenhaBarra = /larguraDaMarca|escalaLinear|ticksArredondados|RAIO_PONTA|TRACEJADO_AUSENCIA/.test(fonte);
    ok(
      usaRegua || !desenhaBarra,
      `${arquivo} tira escala de src/lib/escala.ts`,
      'importe de @/lib/escala em vez de recalcular aqui',
    );
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- não existe piso de marca ---');
{
  // O defeito central: Math.max(altura, 3) fabrica pixels que o dado não tem.
  // Math.max(0, …) e Math.max(ALVO_MIN, …) são legítimos: um é clamp em zero,
  // o outro é ALVO de toque, que pode crescer porque não carrega valor.
  // Piso é Math.max com um LITERAL como primeiro argumento. Math.max(0, …) é
  // clamp em zero e Math.max(1, …) é guarda de divisão — nenhum dos dois
  // inventa tamanho. Qualquer outro caso precisa de `piso-ok:` na linha, com
  // a razão escrita: exceção invisível vira regra em três meses.
  for (const arquivo of GRAFICOS) {
    const cru = ler(join(DIR_FIN, arquivo));
    const pisos = cru
      .split('\n')
      .filter(linha => /Math\.max\(\s*\d+(\.\d+)?\s*,/.test(linha))
      .filter(linha => !/Math\.max\(\s*(0|1)\s*,/.test(linha))
      .filter(linha => !linha.includes('piso-ok:'))
      .map(linha => linha.trim());
    ok(pisos.length === 0, `${arquivo} não fabrica pixels com Math.max`, pisos.join(' | '));
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- cor sempre por token, nunca hexadecimal solto ---');
{
  // A fita de composição do painel tinha dez hexadecimais crus escritos à mão,
  // sem par para o modo escuro. No escuro eles não mudavam.
  for (const [arquivo, fonte] of fontes) {
    const hexes = [...fonte.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]);
    ok(hexes.length === 0, `${arquivo} não tem cor hexadecimal crua`, hexes.join(', '));
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- cor de status nunca é série ---');
{
  // --fin-positive e --fin-negative significam ESTADO. Usá-los como SÉRIE faz
  // "atrasado" e "vendedor 4" terem a mesma cor na mesma tela.
  //
  // Mas estado também se desenha: caixa projetado negativo é ALARME e o
  // veredito de saúde é STATUS — nesses dois casos a cor de estado é a cor
  // certa. A exceção precisa de `status-ok:` NA LINHA, com a razão escrita,
  // pelo mesmo motivo do piso: exceção invisível vira regra em três meses.
  for (const arquivo of GRAFICOS) {
    const cru = ler(join(DIR_FIN, arquivo));
    const linhas = cru.split('\n');
    const status = linhas
      .map((linha, i) => ({ linha, anterior: linhas[i - 1] ?? '' }))
      .filter(({ linha }) => /var\(--fin-(positive|negative|warning)[^)]*\)/.test(linha))
      .filter(({ linha }) => !linha.trimStart().startsWith('*') && !linha.trimStart().startsWith('//'))
      // A marca vale na própria linha ou na anterior: dentro de atributo JSX
      // não existe comentário de fim de linha, e exigir na própria obrigaria a
      // escrever código pior só para satisfazer o teste.
      .filter(({ linha, anterior }) => !linha.includes('status-ok:') && !anterior.includes('status-ok:'))
      .map(({ linha }) => linha.trim());
    ok(status.length === 0, `${arquivo} não pinta série com cor de status`, status.join(' | '));
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- o SVG não é distorcido ---');
{
  // preserveAspectRatio="none" estica o desenho e arruína de uma vez o raio de
  // 4px, o respiro de 2px e a espessura do traço.
  for (const [arquivo, fonte] of fontes) {
    ok(!fonte.includes('preserveAspectRatio'), `${arquivo} não mexe em preserveAspectRatio`);
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- informação não vive em title= nativo ---');
{
  // O title= do SVG não abre no toque: era o que deixava os painéis mudos no
  // celular, que é o aparelho em que a agência mais os abre.
  for (const [arquivo, fonte] of fontes) {
    const titles = [...fonte.matchAll(/\stitle=\{/g)].map(m => m[0]);
    ok(titles.length === 0, `${arquivo} não informa por title=`, `${titles.length} ocorrências`);
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- tracejado significa ausência, em todo gráfico ---');
{
  // Sem essa disciplina, no mesmo painel o tracejado diria "planejado" num
  // gráfico e "não sei" no outro, e quem lê os dois perde a chave.
  for (const arquivo of GRAFICOS) {
    const fonte = fontes.get(arquivo)!;
    const dashes = [...fonte.matchAll(/strokeDasharray=\{([^}]+)\}/g)].map(m => m[1].trim());
    const forasDaRegra = dashes.filter(d => !d.includes('TRACEJADO_AUSENCIA'));
    ok(
      forasDaRegra.length === 0,
      `${arquivo} só traceja com TRACEJADO_AUSENCIA`,
      forasDaRegra.join(' | '),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- toda tela do pilar tem uma resposta e uma só ---');
{
  for (const tela of TELAS) {
    const fonte = fontes.get(tela)!;
    const aberturas = [...fonte.matchAll(/<Resposta\b/g)].length;
    ok(aberturas === 1, `${tela} monta exatamente uma Resposta`, `${aberturas} encontradas`);
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- nenhuma tela do pilar ficou no dialeto legado ---');
{
  // --t-* é o dialeto antigo, e nele --t-green e --t-blue apontam AMBOS para
  // var(--fin-accent): duas categorias saíam exatamente da mesma cor.
  for (const tela of TELAS) {
    const fonte = fontes.get(tela)!;
    const legado = [...fonte.matchAll(/var\(--t-[a-z-]+\)/g)].map(m => m[0]);
    ok(legado.length === 0, `${tela} não usa tokens --t-*`, [...new Set(legado)].join(', '));
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- o mês é estado do pilar, não de cada tela ---');
{
  // Cinco seletores independentes: trocar para agosto no Painel e clicar em
  // "Ver metas" devolvia setembro, sem aviso.
  //
  // O Dashboard Financeiro usa o seletor de PERÍODO, que é o mesmo princípio
  // num recorte mais largo (doze janelas, não só mês). Vale qualquer um dos
  // dois: o que a regra exige é que o recorte viva na URL, não na memória da
  // tela.
  const COM_MES = TELAS.filter(t => !t.includes('vendedores'));
  for (const tela of COM_MES) {
    const fonte = fontes.get(tela)!;
    ok(
      fonte.includes('useMesDaUrl') || fonte.includes('usePeriodoDaUrl'),
      `${tela} guarda o recorte de tempo na URL`,
    );
  }
}

console.log(`\n${total - falhas}/${total} testes do porteiro dos gráficos passaram`);
if (falhas > 0) process.exit(1);

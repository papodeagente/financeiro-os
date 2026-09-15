/**
 * Testes da régua dos gráficos (src/lib/escala.ts).
 *
 * Escala errada não quebra typecheck — ela desenha errado, e o erro chega ao
 * usuário parecendo um fato. Estes testes travam as garantias que os seis
 * componentes de SVG passam a depender, principalmente a que motivou o módulo:
 * NÃO EXISTE PISO DE MARCA. O gráfico da folha que este trabalho substitui
 * fabricava pixels com Math.max, e cinco meses sem faturamento apareciam como
 * cinco meses de venda pequena.
 *
 * Roda com: node --experimental-strip-types scripts/test-escala.ts
 */
import {
  ALVO_MIN,
  MARCA_MINUSCULA,
  PORTAO_SERIE_TEMPORAL,
  agruparPorDia,
  alvosSemColisao,
  escalaComumDeFaixas,
  escalaLinear,
  formatarEixoBRL,
  larguraDaMarca,
  periodosComMovimento,
  portaoDeSerie,
  posicionarRotulosDeMarca,
  ritmoEsperadoPct,
  ritmoNecessario,
  ticksArredondados,
  type Ponto,
} from '../src/lib/escala.ts';

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
console.log('--- não existe piso de marca ---');
{
  // O defeito que motivou o módulo: zero desenhado como 3px.
  eq(larguraDaMarca(0, 1000, 300), { px: 0, minuscula: false }, 'zero desenha zero, não um risquinho');
  eq(larguraDaMarca(500, 1000, 300).px, 150, 'metade do total é metade da largura');
  eq(larguraDaMarca(1000, 1000, 300).px, 300, 'o total ocupa a largura toda');
}
{
  // Valor minúsculo desenha minúsculo, e AVISA que precisa de linha-guia.
  const r = larguraDaMarca(1, 10000, 300);
  eq(r.px < MARCA_MINUSCULA, true, 'fatia de 0,01% fica abaixo do mínimo visível');
  eq(r.minuscula, true, 'e é sinalizada para ganhar linha-guia');
  eq(r.px > 0, true, 'mas não é apagada: ela existe');
}
{
  eq(larguraDaMarca(-50, 1000, 300), { px: 0, minuscula: false }, 'valor negativo não vira barra');
  eq(larguraDaMarca(2000, 1000, 300).px, 300, 'acima do total satura na largura, não estoura');
  eq(larguraDaMarca(50, 0, 300), { px: 0, minuscula: false }, 'total zero não inventa escala');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- escala linear ---');
{
  const e = escalaLinear(1000, 200);
  eq(e(0), 0, 'zero é zero');
  eq(e(250), 50, 'um quarto é um quarto');
  eq(e(1000), 200, 'o máximo é a largura');
  eq(e(5000), 200, 'acima do máximo satura');
  eq(e(-10), 0, 'negativo é zero');
}
{
  // Sem dado não há escala: inventar uma desenharia barras arbitrárias.
  eq(escalaLinear(0, 200)(50), 0, 'máximo zero devolve zero');
  eq(escalaLinear(1000, 0)(500), 0, 'largura zero devolve zero');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- ticks que uma pessoa lê ---');
{
  eq(ticksArredondados(30818, 4), [0, 10000, 20000, 30000, 40000], 'passos redondos, não 7.704,50');
  eq(ticksArredondados(100, 4), [0, 25, 50, 75, 100], 'centena em quartos');
  eq(ticksArredondados(0), [], 'sem máximo não há eixo');
  eq(ticksArredondados(-5), [], 'máximo negativo não há eixo');
}
{
  const t = ticksArredondados(67914, 4);
  eq(t[0], 0, 'começa no zero');
  eq(t[t.length - 1] >= 67914, true, 'o último tick cobre o máximo');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- abreviação só no eixo ---');
{
  eq(formatarEixoBRL(30818), 'R$ 31 mil', 'milhares arredondados');
  eq(formatarEixoBRL(1_200_000), 'R$ 1,2 mi', 'milhões com uma casa');
  eq(formatarEixoBRL(0), 'R$ 0', 'zero é zero');
  eq(formatarEixoBRL(847), 'R$ 847', 'abaixo de mil vai inteiro');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- alvo de toque cresce, a marca não ---');
{
  // Doze barras em 343px dão 28px: menor que o dedo. O alvo cresce; a marca,
  // que carrega o valor, fica onde está.
  const bandas = Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, x: i * 28, w: 20 }));
  const alvos = alvosSemColisao(bandas, 336);
  eq(alvos.length, 12, 'todos os alvos voltam');
  eq(alvos.every(a => a.w >= 20), true, 'nenhum alvo encolheu');
  // Não podem se sobrepor: o toque tem que ser sem ambiguidade.
  const sobrepoe = alvos.some((a, i) => i > 0 && a.x < alvos[i - 1].x + alvos[i - 1].w - 0.01);
  eq(sobrepoe, false, 'os alvos não se sobrepõem');
}
{
  // Poucas barras: há espaço para todo mundo alcançar o mínimo.
  const alvos = alvosSemColisao(
    [{ id: 'a', x: 0, w: 10 }, { id: 'b', x: 200, w: 10 }],
    343,
  );
  eq(alvos.every(a => a.w >= ALVO_MIN), true, 'com espaço, todo alvo chega a 44px');
}
{
  const unico = alvosSemColisao([{ id: 'u', x: 100, w: 8 }], 343);
  eq(unico[0].w >= ALVO_MIN, true, 'marca sozinha ganha a faixa inteira');
  eq(alvosSemColisao([], 343), [], 'sem marca, sem alvo');
}
{
  // Alvo que já é grande não é mexido.
  eq(
    alvosSemColisao([{ id: 'g', x: 10, w: 100 }], 343),
    [{ id: 'g', x: 10, w: 100 }],
    'alvo grande fica como está',
  );
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- dois lançamentos no mesmo dia são um degrau ---');
{
  const r = agruparPorDia([
    { data: '2026-09-09', v: 1 },
    { data: '2026-09-09', v: 2 },
    { data: '2026-09-11', v: 3 },
  ]);
  eq(r.length, 2, 'dois dias, não três lançamentos');
  eq(r[0].itens.length, 2, 'o dia repetido junta os dois');
  eq(r.map(x => x.dia), ['2026-09-09', '2026-09-11'], 'em ordem de data');
}
{
  eq(agruparPorDia([{ data: '' }, { data: '2026-09-01' }]).length, 1, 'item sem data não vira dia');
  eq(agruparPorDia([]), [], 'lista vazia');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- o portão da série temporal ---');
const ponto = (chave: string, valor: number | null): Ponto => ({ chave, rotulo: chave, valor });
{
  // O caso real da folha: 12 meses, faturamento só no último.
  const doze: Ponto[] = Array.from({ length: 12 }, (_, i) =>
    ponto(`m${i}`, i === 11 ? 30818 : null));
  eq(periodosComMovimento(doze), 1, 'só um mês tem movimento');
  eq(portaoDeSerie(doze), 'insuficiente', 'um ponto não desenha tendência');
}
{
  const nunca: Ponto[] = Array.from({ length: 6 }, (_, i) => ponto(`m${i}`, null));
  eq(portaoDeSerie(nunca), 'sem-dado', 'nunca houve dado é diferente de pouco dado');
}
{
  const tres = [ponto('a', 10), ponto('b', 20), ponto('c', 30)];
  eq(portaoDeSerie(tres), 'desenha', 'três períodos com movimento abrem o gráfico');
  eq(PORTAO_SERIE_TEMPORAL, 3, 'o portão é três');
}
{
  // Zero é dado, mas não é movimento: doze meses de zero não viram linha.
  const zeros = Array.from({ length: 12 }, (_, i) => ponto(`m${i}`, 0));
  eq(periodosComMovimento(zeros), 0, 'zero não é movimento');
  eq(portaoDeSerie(zeros), 'insuficiente', 'mas houve dado, então não é sem-dado');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- ritmo é aritmética, não profecia ---');
{
  eq(ritmoEsperadoPct(14, 30), 46.67, 'dia 14 de 30 é 46,67% do mês');
  eq(ritmoEsperadoPct(30, 30), 100, 'último dia é 100%');
  eq(ritmoEsperadoPct(0, 30), 0, 'antes de começar é 0%');
  eq(ritmoEsperadoPct(45, 30), 100, 'dia além do fim satura em 100%');
}
{
  // O número do Bruno: faltam R$ 194.182,00 em 16 dias.
  eq(ritmoNecessario(194182, 16), 12136.38, 'quanto por dia para alcançar a meta');
  eq(ritmoNecessario(0, 16), 0, 'meta batida não exige ritmo');
  eq(ritmoNecessario(-500, 16), 0, 'passou da meta também é zero');
  eq(ritmoNecessario(1000, 0), null, 'sem dias restantes não há ritmo possível');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- escala comum entre planos ---');
{
  const r = escalaComumDeFaixas([
    { faixas: [{ de: 0, ate: 50000, percentual: 5 }, { de: 50000, ate: null, percentual: 7 }] },
    { faixas: [{ de: 0, ate: 80000, percentual: 3 }] },
  ]);
  eq(r.maxBase, 80000, 'a maior base manda nos dois painéis');
  eq(r.maxPct, 7, 'e o maior percentual também');
}
{
  eq(escalaComumDeFaixas([]), { maxBase: 0, maxPct: 0 }, 'sem plano, sem escala');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- rótulos que não se atropelam ---');
{
  eq(posicionarRotulosDeMarca([{ pct: 10 }, { pct: 90 }], 300), ['acima', 'acima'],
    'marcas distantes ficam as duas em cima');
  eq(posicionarRotulosDeMarca([{ pct: 50 }, { pct: 52 }], 300), ['acima', 'abaixo'],
    'marcas coladas alternam para não se tocarem');
  eq(posicionarRotulosDeMarca([], 300), [], 'sem marca, sem rótulo');
}

// ══════════════════════════════════════════════════════════════════════
console.log(`\n${total - falhas}/${total} testes da régua dos gráficos passaram`);
if (falhas > 0) process.exit(1);

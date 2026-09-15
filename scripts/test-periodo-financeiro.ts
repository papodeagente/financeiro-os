/**
 * Os cortes de período do Dashboard Financeiro.
 *
 * Corte de período é onde dashboard mente sem avisar, e o erro é invisível no
 * teste manual das duas da tarde: `new Date('2026-09-01')` volta um dia no fuso
 * do Brasil, e em produção (UTC) tudo que acontece depois das 21h cai no dia
 * seguinte — na virada do mês, no MÊS seguinte. Estes testes travam a
 * aritmética em data civil, com datas de corte escolhidas para doer:
 * virada de ano, fevereiro bissexto, domingo, e mês de 31 dias.
 */
import {
  diasDaJanela, janelaDeComparacao, mesDaJanela, resolverPeriodo, segundaDaSemana, trimestreDe,
} from '../src/lib/periodo-financeiro.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}
const j = (chave: Parameters<typeof resolverPeriodo>[0], hoje: string, p?: { de?: string; ate?: string }) => {
  const r = resolverPeriodo(chave, hoje, p);
  return [r.de, r.ate];
};

// ══════════════════════════════════════════════════════════════════════
console.log('--- semana comercial começa na segunda ---');
eq(segundaDaSemana('2026-09-15'), '2026-09-14', 'terça volta para a segunda');
eq(segundaDaSemana('2026-09-14'), '2026-09-14', 'segunda é ela mesma');
// Domingo pertence à semana que COMEÇOU na segunda anterior. Recuar zero aqui
// faria o domingo abrir uma semana nova de um dia só.
eq(segundaDaSemana('2026-09-20'), '2026-09-14', 'domingo fecha a semana, não abre outra');
eq(segundaDaSemana('2026-09-21'), '2026-09-21', 'a segunda seguinte abre a próxima');
eq(segundaDaSemana('2026-01-01'), '2025-12-29', 'a semana atravessa a virada do ano');

// ══════════════════════════════════════════════════════════════════════
console.log('--- trimestre ---');
eq(trimestreDe('2026-09-15'), { de: '2026-07-01', ate: '2026-09-30' }, 'setembro é o 3º trimestre');
eq(trimestreDe('2026-01-05'), { de: '2026-01-01', ate: '2026-03-31' }, 'janeiro abre o 1º');
eq(trimestreDe('2026-12-31'), { de: '2026-10-01', ate: '2026-12-31' }, 'dezembro fecha o 4º');
eq(trimestreDe('2024-02-10'), { de: '2024-01-01', ate: '2024-03-31' }, 'ano bissexto não muda o trimestre');

// ══════════════════════════════════════════════════════════════════════
console.log('--- as janelas ---');
{
  const HOJE = '2026-09-15';
  eq(j('HOJE', HOJE), ['2026-09-15', '2026-09-15'], 'hoje é um dia só');
  eq(j('ONTEM', HOJE), ['2026-09-14', '2026-09-14'], 'ontem é um dia só');
  eq(j('ESTA_SEMANA', HOJE), ['2026-09-14', '2026-09-15'], 'esta semana termina HOJE, não no domingo');
  eq(j('SEMANA_PASSADA', HOJE), ['2026-09-07', '2026-09-13'], 'semana passada é segunda a domingo, fechada');
  // O mês corrente termina hoje. Somar setembro inteiro de despesa contra
  // quinze dias de receita anunciaria um prejuízo que não existe.
  eq(j('ESTE_MES', HOJE), ['2026-09-01', '2026-09-15'], 'este mês termina hoje, não no dia 30');
  eq(j('MES_PASSADO', HOJE), ['2026-08-01', '2026-08-31'], 'mês passado é o mês inteiro');
  eq(j('ULTIMOS_30', HOJE), ['2026-08-17', '2026-09-15'], '30 dias CONTANDO hoje, não 31');
  eq(j('ULTIMOS_90', HOJE), ['2026-06-18', '2026-09-15'], '90 dias contando hoje');
  eq(j('ESTE_TRIMESTRE', HOJE), ['2026-07-01', '2026-09-15'], 'trimestre corrente termina hoje');
  eq(j('ESTE_ANO', HOJE), ['2026-01-01', '2026-09-15'], 'ano corrente termina hoje');
  eq(j('ANO_PASSADO', HOJE), ['2025-01-01', '2025-12-31'], 'ano passado é o ano inteiro');
}
{
  // As bordas que quebram implementação ingênua.
  eq(j('MES_PASSADO', '2026-01-10'), ['2025-12-01', '2025-12-31'], 'janeiro volta para dezembro do ano anterior');
  eq(j('MES_PASSADO', '2026-03-31'), ['2026-02-01', '2026-02-28'], '31 de março volta para fevereiro INTEIRO, não 31/02');
  eq(j('MES_PASSADO', '2024-03-31'), ['2024-02-01', '2024-02-29'], 'fevereiro bissexto tem 29');
  eq(j('ESTE_MES', '2026-02-01'), ['2026-02-01', '2026-02-01'], 'primeiro dia do mês é janela de um dia');
  eq(j('ULTIMOS_30', '2026-01-05'), ['2025-12-07', '2026-01-05'], 'os 30 dias atravessam o ano');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- período personalizado ---');
eq(j('PERSONALIZADO', '2026-09-15', { de: '2026-03-01', ate: '2026-03-31' }), ['2026-03-01', '2026-03-31'], 'respeita o que foi escolhido');
// Ordem de clique não é dado: quem escolheu duas datas quis o intervalo.
eq(j('PERSONALIZADO', '2026-09-15', { de: '2026-03-31', ate: '2026-03-01' }), ['2026-03-01', '2026-03-31'], 'datas invertidas viram a janela na ordem certa');
eq(j('PERSONALIZADO', '2026-09-15'), ['2026-09-01', '2026-09-15'], 'sem escolha, cai no mês corrente');

// ══════════════════════════════════════════════════════════════════════
console.log('--- tamanho da janela ---');
eq(diasDaJanela('2026-09-15', '2026-09-15'), 1, 'um dia é um dia, não zero');
eq(diasDaJanela('2026-09-01', '2026-09-30'), 30, 'setembro tem 30');
eq(diasDaJanela('2026-01-01', '2026-12-31'), 365, 'ano comum');
eq(diasDaJanela('2024-01-01', '2024-12-31'), 366, 'ano bissexto');

// ══════════════════════════════════════════════════════════════════════
console.log('--- a janela de comparação ---');
{
  // Comparar 15 dias de setembro com 31 dias de agosto anunciaria uma queda
  // que é só diferença de tamanho de janela.
  const c = janelaDeComparacao(resolverPeriodo('ESTE_MES', '2026-09-15'));
  eq([c.de, c.ate], ['2026-08-17', '2026-08-31'], 'a comparação tem o MESMO tamanho da janela atual');
  eq(diasDaJanela(c.de, c.ate), 15, 'quinze dias contra quinze dias');
}
{
  const c = janelaDeComparacao(resolverPeriodo('MES_PASSADO', '2026-09-15'));
  eq([c.de, c.ate], ['2026-07-01', '2026-07-31'], 'agosto compara com julho');
}
{
  // Turismo é sazonal: o ano compara com o ano, não com o período anterior.
  const c = janelaDeComparacao(resolverPeriodo('ESTE_ANO', '2026-09-15'));
  eq([c.de, c.ate], ['2025-01-01', '2025-09-15'], 'o ano corrente compara com o mesmo intervalo do ano passado');
}
{
  const c = janelaDeComparacao(resolverPeriodo('HOJE', '2026-01-01'));
  eq([c.de, c.ate], ['2025-12-31', '2025-12-31'], 'primeiro do ano compara com o último do anterior');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- o mês da janela, para rotular a tela ---');
eq(mesDaJanela({ de: '2026-09-01', ate: '2026-09-15' }), '2026-09', 'janela dentro de um mês tem mês');
eq(mesDaJanela({ de: '2026-08-17', ate: '2026-09-15' }), null, 'janela que atravessa mês não tem mês');

console.log(`\n${total - falhas}/${total} testes de período passaram`);
if (falhas > 0) process.exit(1);

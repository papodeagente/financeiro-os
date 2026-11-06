/**
 * Envio agendado de relatório (E7, G3), regras puras: e-mails, validação,
 * próximo envio em Brasília (diário, semanal, mensal, último dia do mês),
 * período de cada envio e o link de leitura.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-relatorios-agendados.ts
 */
import {
  consultaSemDatas, descricaoDoAgendamento, lerDestinatarios, periodoDoEnvio, proximoEnvio,
  situacaoDoLink, tokenTemFormato, urlDaLeitura, validarAgendamento,
} from '../src/lib/relatorios-agendados/regras.ts';
import { hashDoTokenDeLeitura, novoTokenDeLeitura } from '../src/lib/relatorios-agendados/token.ts';
import { payloadDoEnvio } from '../src/lib/relatorios-agendados/payload.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else console.log(`PASS  ${label}`);
}

console.log('--- E-mails e validação ---');
eq(lerDestinatarios('A@x.com; b@y.com.br,\n a@x.com  ruim'), { emails: ['a@x.com', 'b@y.com.br'], invalidos: ['ruim'] }, 'separadores livres, sem repetir, inválido apontado');
eq(consultaSemDatas('?relatorio=vendedor&de=2026-01-01&ate=2026-01-31&formato=pdf&ordem=receita'), 'relatorio=vendedor&ordem=receita', 'as datas e o formato saem da consulta salva');
const base = { nome: 'Vendas', relatorio: 'vendas', consulta: 'relatorio=produto', frequencia: 'semanal', dia_semana: 1, hora: 8, periodo: 'semana_anterior', formato: 'pdf', destinatarios: ['a@x.com'], validade_dias: 30 };
const ok = validarAgendamento(base);
eq(ok.ok, true, 'agendamento válido');
const ruim = validarAgendamento({ ...base, nome: 'a', frequencia: 'anual', hora: 23, periodo: 'sempre', destinatarios: [], validade_dias: 120, relatorio: 'dre' });
eq(ruim.ok ? [] : Object.keys(ruim.erros).sort(), ['destinatarios', 'frequencia', 'hora', 'nome', 'periodo', 'relatorio', 'validade_dias'], 'cada erro no seu campo');
eq(validarAgendamento({ ...base, destinatarios: Array.from({ length: 21 }, (_, i) => `p${i}@x.com`) }).ok, false, 'até 20 e-mails');
eq(validarAgendamento({ ...base, frequencia: 'mensal', dia_mes: 31 }).ok, false, 'dia do mês até 28 (ou o último)');

console.log('--- Próximo envio (Brasília) ---');
const em = (s: string) => new Date(s);
eq(proximoEnvio({ frequencia: 'diario', dia_semana: 0, dia_mes: 1, hora: 7 }, em('2026-11-06T09:00:00Z')).toISOString(), '2026-11-06T10:00:00.000Z', 'diário: hoje às 7h de Brasília (10h UTC)');
eq(proximoEnvio({ frequencia: 'diario', dia_semana: 0, dia_mes: 1, hora: 7 }, em('2026-11-06T10:00:00Z')).toISOString(), '2026-11-07T10:00:00.000Z', 'diário: na hora exata, vai para amanhã');
eq(proximoEnvio({ frequencia: 'diario', dia_semana: 0, dia_mes: 1, hora: 7 }, em('2026-11-07T02:30:00Z')).toISOString(), '2026-11-07T10:00:00.000Z', '23h30 de Brasília ainda é o dia anterior');
// 06/11/2026 é sexta-feira.
eq(proximoEnvio({ frequencia: 'semanal', dia_semana: 1, dia_mes: 1, hora: 8 }, em('2026-11-06T12:00:00Z')).toISOString(), '2026-11-09T11:00:00.000Z', 'semanal: a próxima segunda às 8h');
eq(proximoEnvio({ frequencia: 'semanal', dia_semana: 5, dia_mes: 1, hora: 8 }, em('2026-11-06T12:00:00Z')).toISOString(), '2026-11-13T11:00:00.000Z', 'semanal: hoje já passou, a próxima sexta');
eq(proximoEnvio({ frequencia: 'mensal', dia_semana: 0, dia_mes: 1, hora: 7 }, em('2026-11-06T12:00:00Z')).toISOString(), '2026-12-01T10:00:00.000Z', 'mensal: dia 1 do mês seguinte');
eq(proximoEnvio({ frequencia: 'mensal', dia_semana: 0, dia_mes: 0, hora: 7 }, em('2026-02-10T12:00:00Z')).toISOString(), '2026-02-28T10:00:00.000Z', 'mensal: último dia de fevereiro');
eq(proximoEnvio({ frequencia: 'mensal', dia_semana: 0, dia_mes: 10, hora: 7 }, em('2026-12-20T12:00:00Z')).toISOString(), '2027-01-10T10:00:00.000Z', 'mensal: vira o ano');

console.log('--- Período do envio ---');
eq(periodoDoEnvio('ontem', '2026-11-06'), { de: '2026-11-05', ate: '2026-11-05' }, 'ontem');
eq(periodoDoEnvio('ultimos_7', '2026-11-06'), { de: '2026-10-30', ate: '2026-11-05' }, 'últimos 7 dias, até ontem');
eq(periodoDoEnvio('semana_anterior', '2026-11-09'), { de: '2026-11-02', ate: '2026-11-08' }, 'semana passada de segunda a domingo (envio na segunda)');
eq(periodoDoEnvio('semana_anterior', '2026-11-08'), { de: '2026-10-26', ate: '2026-11-01' }, 'no domingo, a semana anterior inteira');
eq(periodoDoEnvio('mes_anterior', '2026-01-01'), { de: '2025-12-01', ate: '2025-12-31' }, 'mês passado na virada do ano');
eq(periodoDoEnvio('mes_anterior', '2026-03-05'), { de: '2026-02-01', ate: '2026-02-28' }, 'fevereiro inteiro');
eq(periodoDoEnvio('mes_atual', '2026-11-06'), { de: '2026-11-01', ate: '2026-11-05' }, 'mês atual até ontem');
eq(periodoDoEnvio('mes_atual', '2026-11-01'), { de: '2026-10-01', ate: '2026-10-31' }, 'no dia 1, o mês que acabou');
eq(periodoDoEnvio('ano_atual', '2026-01-01'), { de: '2025-01-01', ate: '2025-12-31' }, 'no 1º de janeiro, o ano que acabou');
eq(descricaoDoAgendamento({ frequencia: 'semanal', dia_semana: 0, dia_mes: 1, hora: 9, periodo: 'ultimos_7' }), 'Todo domingo às 9h, com últimos 7 dias', 'descrição em palavras');
eq(descricaoDoAgendamento({ frequencia: 'mensal', dia_semana: 0, dia_mes: 0, hora: 7, periodo: 'mes_anterior' }), 'Todo último dia do mês às 7h, com mês passado', 'último dia do mês');

console.log('--- Link de leitura ---');
const t = novoTokenDeLeitura();
eq([tokenTemFormato(t), t.length, novoTokenDeLeitura() === t], [true, 43, false], 'token sorteado de 43 letras');
eq([hashDoTokenDeLeitura(t).length, hashDoTokenDeLeitura(t) === hashDoTokenDeLeitura(t), hashDoTokenDeLeitura(t) === t], [64, true, false], 'hash estável, diferente do token');
eq([tokenTemFormato('../../etc'), tokenTemFormato('')], [false, false], 'formato errado nem vai ao banco');
eq(situacaoDoLink({ expira_em: '2026-11-10T00:00:00Z', revogado_em: null }, em('2026-11-06T00:00:00Z')), 'valendo', 'valendo');
eq(situacaoDoLink({ expira_em: '2026-11-05T00:00:00Z', revogado_em: null }, em('2026-11-06T00:00:00Z')), 'vencido', 'vencido');
eq(situacaoDoLink({ expira_em: '2026-11-10T00:00:00Z', revogado_em: '2026-11-06T00:00:00Z' }, em('2026-11-07T00:00:00Z')), 'revogado', 'desligado');
eq(urlDaLeitura('https://fin.x.com/', 'abc'), 'https://fin.x.com/r/abc', 'endereço do link');
const pl = payloadDoEnvio({ id: 'ra-1', nome: 'Vendas da semana', destinatarios: ['a@x.com'], formato: 'pdf', criado_por_nome: 'Ana' },
  { titulo: 'Vendas por vendedor', filtros: [{ rotulo: 'Vendedor', valor: 'Bia' }], colunas: [], linhas: [{}, {}] },
  { url: 'https://fin.x.com/r/TOKEN', token: 'TOKEN', expira_em: '2026-12-06T00:00:00.000Z' }, '2026-11-02', '2026-11-08');
eq([pl.assunto, pl.url_planilha, pl.url_pdf, pl.linhas, pl.periodo.rotulo], ['Vendas da semana · 02/11/2026 a 08/11/2026', 'https://fin.x.com/api/leitura/TOKEN?formato=xlsx', 'https://fin.x.com/api/leitura/TOKEN?formato=pdf', 2, '02/11/2026 a 08/11/2026'], 'o que o CRM recebe para o e-mail');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);

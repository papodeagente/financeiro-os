/**
 * Mudança de sistema (E4, 05/11/2026), a parte pura: leitor de planilhas
 * (XLSX, XLS, CSV, TXT, Latin-1), datas e dinheiro brasileiros, linha de
 * total, lista cortada, agrupamento, dicionário de sinônimos, mapeamento,
 * interpretação das linhas e identidade (quem é quem, sem duplicar).
 *
 * As planilhas são montadas em memória com o SheetJS, no formato das listas
 * que o sistema anterior exporta (colunas da grade de Contas a Pagar/Receber,
 * Pessoas, Contas e Cartões, Categorias).
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-migracao.ts
 */
import * as XLSX from 'xlsx';
import { dataBR, lerCentavos, lerData, lerDocumento, lerParcela, normalizar } from '../src/lib/migracao/valores.ts';
import { adivinharLista, sugerirMapeamento, validarMapeamento, camposDoCabecalho } from '../src/lib/migracao/dicionario.ts';
import { decodificarTexto, detectarSeparador, lerCsv, lerPlanilha, prepararAba } from '../src/lib/migracao/leitor.ts';
import { interpretarLinha, interpretarLinhas, lerMovimento } from '../src/lib/migracao/interpretar.ts';
import { acharPessoa, chaveDoTitulo, indiceVazio } from '../src/lib/migracao/identidade.ts';
import { gravadorDeEnsaio, processarRegistro, proximoCodigo } from '../src/lib/migracao/plano.ts';

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

function xlsx(linhas: unknown[][], tipo: XLSX.BookType = 'xlsx', datas = false): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(linhas, { cellDates: datas });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Planilha1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: tipo }) as ArrayBuffer);
}
const latin1 = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));
const utf8 = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));

console.log('--- Valores ---');
eq([lerData('05/11/2026'), lerData('5/11/26'), lerData('05-11-2026 14:30'), lerData('2026-11-05'), lerData(46331), lerData('46331')],
  ['2026-11-05', '2026-11-05', '2026-11-05', '2026-11-05', '2026-11-05', '2026-11-05'], 'datas: dd/mm/aaaa, aa, com hora, ISO e serial do Excel');
eq([lerData('31/02/2026'), lerData('13/13/2026'), lerData('abc'), lerData(''), lerData(12)], [null, null, null, null, null], 'datas impossíveis viram null (nunca inverte dia e mês)');
eq([lerCentavos('1.234,56'), lerCentavos('R$ 1.234,56'), lerCentavos('-1.234,56'), lerCentavos('(1.234,56)'), lerCentavos('R$ -10,00'), lerCentavos('1234,5')],
  [123456, 123456, -123456, -123456, -1000, 123450], 'dinheiro brasileiro');
eq([lerCentavos('1.500'), lerCentavos('1234.56'), lerCentavos(1234.56), lerCentavos(0.1 + 0.2), lerCentavos('abc'), lerCentavos('12/10'), lerCentavos('')],
  [150000, 123456, 123456, 30, null, null, null], 'milhar com ponto, decimal com ponto, número, lixo');
eq([lerDocumento('123.456.789-09'), lerDocumento('12.345.678/0001-95'), lerDocumento(12345678909), lerDocumento(1234567890), lerDocumento('123')],
  ['12345678909', '12345678000195', '12345678909', '01234567890', ''], 'CPF/CNPJ só dígitos (número do Excel recupera o zero)');
eq([lerParcela('2/5'), lerParcela('Parcela 3 de 10'), lerParcela('4'), lerParcela('12'), lerParcela('6/5')],
  [{ numero: 2, total: 5 }, { numero: 3, total: 10 }, { numero: 1, total: 4 }, { numero: 1, total: 12 }, null], 'parcelas');
eq([normalizar('Venda Nº'), normalizar('  Razão   Social '), dataBR('2026-11-05')], ['venda no', 'razao social', '05/11/2026'], 'normalização');

console.log('--- Dicionário e mapeamento ---');
const cabTitulos = ['Número', 'Empresa', 'Pessoa', 'Razão social', 'Conta', 'Documento', 'Descrição', 'Emissão', 'Vencimento', 'Liquidação', 'Movimento', 'Valor', 'Valor Final', 'Venda Nº', 'Fatura Nº', 'Vendedor', 'Parcelas', 'Moeda', 'Boleto Nº'];
const adiv = adivinharLista(cabTitulos);
eq([adiv.lista, adiv.sugestao.faltando, adiv.sugestao.mapeamento.vencimento, adiv.sugestao.mapeamento.valor_final, adiv.sugestao.mapeamento.movimento],
  ['titulos', [], 8, 12, 10], 'grade de Contas a Pagar/Receber vira títulos, com vencimento, valor final e movimento');
eq(adiv.sugestao.ignoradas.map(c => c.cabecalho), ['Boleto Nº'], 'coluna desconhecida fica de fora e é listada');
eq(adivinharLista(['Nome', 'Razão social', 'CPF', 'CNPJ', 'E-mail', 'Telefone', 'Celular', 'Tipo']).lista, 'pessoas', 'lista de pessoas');
eq(adivinharLista(['Descrição', 'Grupo', 'Tipo', 'Repasse']).lista, 'categorias', 'lista de categorias');
const contas = sugerirMapeamento(['Descrição', 'Tipo', 'Banco', 'Agência', 'Conta', 'Saldo'], 'contas');
eq([contas.mapeamento.nome, contas.mapeamento.numero, contas.mapeamento.saldo], [0, 4, 5], 'contas: com Descrição, "Conta" é o número');
eq(sugerirMapeamento(['Conta', 'Banco'], 'contas').mapeamento.nome, 0, 'contas: sem Descrição, "Conta" é o nome');
eq(validarMapeamento('titulos', { pessoa: 0, vencimento: 0 }, 3).ok, false, 'a mesma coluna em dois campos é recusada');
eq(validarMapeamento('titulos', { inventado: 1 }, 3).ok, false, 'campo que não existe é recusado');
eq(camposDoCabecalho('Conta', 'contas'), ['nome', 'numero'], 'cabeçalho ambíguo tem dois candidatos');

console.log('--- Leitor ---');
const grade = [
  ['Contas a Pagar/Receber'],
  ['Período: 01/11/2026 a 30/11/2026'],
  [],
  cabTitulos,
  ['101', 'Matriz', 'Maria Souza', '', 'Itaú', 'NF 10', 'Pacote Lisboa', '01/11/2026', '10/11/2026', '', 'Receber', '1.200,00', '1.200,00', '55', '', 'Ana', '1/3', 'R$', ''],
  ['102', 'Matriz', 'Hotel Sol Ltda', 'Hotel Sol Ltda', 'Itaú', 'FAT 9', 'Diárias', '02/11/2026', '15/11/2026', '', 'Pagar', '800,50', '800,50', '', '9', '', '', 'R$', ''],
  ['', '', '', '', '', '', '', '', '', '', '', '', '2.000,50', '', '', '', '', '', ''],
];
const plXlsx = lerPlanilha('novembro.xlsx', xlsx(grade));
const prep = prepararAba(plXlsx.abas[0]);
eq([plXlsx.formato, prep.linhaCabecalho, prep.cabecalhos.length, prep.linhas.map(l => [l.numero, l.tipo])],
  ['xlsx', 4, 19, [[5, 'dado'], [6, 'dado'], [7, 'total']]], 'XLSX: acha o cabeçalho depois do título e do período; rodapé de total');
eq([prep.totalRodape[12], prep.avisos.map(a => a.codigo)], [200050, ['total_do_rodape']], 'soma do rodapé guardada e avisada');

const comTotal = [cabTitulos.slice(0, 13), ['1', 'Matriz', 'Joana', '', '', '', '', '', '01/12/2026', '', 'Receber', '10,00', '10,00'], ['Total', '', '', '', '', '', '', '', '', '', '', '', '10,00']];
eq(prepararAba(lerPlanilha('a.xlsx', xlsx(comTotal)).abas[0]).linhas.map(l => l.tipo), ['dado', 'total'], 'linha "Total" do rodapé');

const xls = lerPlanilha('antigo.xls', xlsx([['Pessoa', 'Vencimento', 'Valor Final', 'Movimento'], ['José', 46331, 99.9, 'Pagar']], 'biff8'));
const prepXls = prepararAba(xls.abas[0]);
eq([xls.formato, prepXls.linhas[0].celulas], ['xls', ['José', 46331, 99.9, 'Pagar']], 'XLS antigo (BIFF8): número e serial do Excel vêm como número');

const cortada = [['Pessoa', 'Vencimento', 'Valor Final'], ['Ana', '01/12/2026', '10,00'], ['Essa consulta retornou muitos registros. Serão exibidos os 2 primeiros.', '', '']];
const prepCortada = prepararAba(lerPlanilha('c.xlsx', xlsx(cortada)).abas[0]);
eq([prepCortada.avisos.map(a => a.codigo), prepCortada.linhas.map(l => l.tipo)], [['lista_cortada'], ['dado', 'aviso']], 'lista cortada avisada pelo próprio arquivo');
const quinhentas = [['Pessoa', 'Vencimento', 'Valor Final']];
for (let i = 0; i < 500; i++) quinhentas.push([`P${i}`, '01/12/2026', '1,00']);
eq(prepararAba(lerPlanilha('q.xlsx', xlsx(quinhentas)).abas[0]).avisos.map(a => a.codigo), ['lista_pode_estar_cortada'], 'exatamente 500 linhas: pode estar cortada');

const csvLatin = 'Pessoa;Vencimento;Movimento;Valor Final;Descrição\r\nJoão Conceição;05/12/2026;Receber;"1.500,00";Passagem São Paulo\r\n';
const plCsv = lerPlanilha('dez.csv', latin1(csvLatin));
eq([plCsv.formato, plCsv.codificacao, plCsv.separador, plCsv.abas[0].linhas[1]],
  ['csv', 'latin-1', ';', ['João Conceição', '05/12/2026', 'Receber', '1.500,00', 'Passagem São Paulo']], 'CSV em Latin-1 com ; e aspas');
const plCsvUtf = lerPlanilha('dez.csv', utf8('﻿Pessoa,Vencimento,Valor Final\nJoão,05/12/2026,"1.500,00"\n'));
eq([plCsvUtf.codificacao, plCsvUtf.separador, plCsvUtf.abas[0].linhas[1]], ['utf-8', ',', ['João', '05/12/2026', '1.500,00']], 'CSV em UTF-8 com BOM e vírgula');
const plTxt = lerPlanilha('dez.txt', latin1('Pessoa\tVencimento\tValor Final\nAna\t05/12/2026\t10,00\n'));
eq([plTxt.formato, plTxt.separador, plTxt.abas[0].linhas[1]], ['txt', '\t', ['Ana', '05/12/2026', '10,00']], 'TXT tabulado');
eq([detectarSeparador('a;b;c\n1;2,5;3\n'), lerCsv('"a;b";"c""d"\n', ';')], [';', [['a;b', 'c"d']]], 'separador e aspas');
eq(decodificarTexto(new Uint8Array([0x93, 0x41, 0x94])).texto, '“A”', 'Windows-1252 nos bytes 0x80–0x9F');

const agrup = [['Pessoa', 'Vencimento', 'Valor Final'], ['Movimento: Pagar', null, null], ['Cia Aérea X', '01/12/2026', '300,00'], ['Movimento: Receber', null, null], ['Bruno', '02/12/2026', '50,00']];
const prepAgrup = prepararAba(lerPlanilha('g.xlsx', xlsx(agrup)).abas[0]);
const map = sugerirMapeamento(prepAgrup.cabecalhos, 'titulos').mapeamento;
const interp = interpretarLinhas('titulos', prepAgrup.linhas, map);
eq(interp.map(i => i.resultado.ok ? (i.resultado.registro.dados as { movimento: string }).movimento : i.resultado.codigo),
  ['linha_de_agrupamento', 'pagar', 'linha_de_agrupamento', 'receber'], 'grade agrupada: "Movimento: Pagar" vale para as linhas de baixo');

console.log('--- Interpretação dos títulos ---');
const m = sugerirMapeamento(cabTitulos, 'titulos').mapeamento;
const linha = (over: Record<number, unknown>) => { const l: unknown[] = ['101', 'Matriz', 'Maria', '', '', 'NF 1', 'Pacote', '01/11/2026', '10/11/2026', '', 'Receber', '100,00', '120,00', '', '', '', '2/3', 'R$', '']; for (const [k, v] of Object.entries(over)) l[Number(k)] = v; return l as never; };
const ok = interpretarLinha('titulos', linha({}), m, { dataCorte: '2026-11-05' });
eq(ok.ok && ok.registro.lista === 'titulos' ? [ok.registro.dados.valor, ok.registro.dados.vencimento, ok.registro.dados.parcela_numero, ok.registro.dados.total_parcelas, ok.registro.dados.movimento] : ok,
  [12000, '2026-11-10', 2, 3, 'receber'], 'valor final vale mais que valor; parcela 2/3');
const liq = interpretarLinha('titulos', linha({ 9: '04/11/2026' }), m, { dataCorte: '2026-11-05' });
eq(liq.ok ? 'ok' : [liq.codigo], ['liquidado'], 'liquidado até a data de corte fica de fora (histórico é da v2)');
const liqDepois = interpretarLinha('titulos', linha({ 9: '07/11/2026' }), m, { dataCorte: '2026-11-05' });
eq(liqDepois.ok ? [liqDepois.registro.lista === 'titulos' && liqDepois.registro.dados.liquidado_depois_do_corte, liqDepois.avisos.length] : liqDepois, ['2026-11-07', 1], 'liquidado DEPOIS do corte entra em aberto, com aviso');
eq([interpretarLinha('titulos', linha({ 12: 'abc', 11: '' }), m).ok ? '' : (interpretarLinha('titulos', linha({ 12: 'abc', 11: '' }), m) as { codigo: string }).codigo,
  (interpretarLinha('titulos', linha({ 8: '31/02/2026' }), m) as { codigo: string }).codigo,
  (interpretarLinha('titulos', linha({ 10: '' , 12: '50,00' }), m) as { codigo: string }).codigo,
  (interpretarLinha('titulos', linha({ 17: 'US$' }), m) as { codigo: string }).codigo],
  ['valor_invalido', 'data_invalida', 'sem_movimento', 'moeda_estrangeira'], 'recusas com código');
const semMov = interpretarLinha('titulos', linha({ 10: '', 12: '-50,00' }), m);
eq(semMov.ok && semMov.registro.lista === 'titulos' ? [semMov.registro.dados.movimento, semMov.registro.dados.valor] : semMov, ['pagar', 5000], 'sem movimento e valor negativo: a pagar');
eq((interpretarLinha('titulos', linha({ 10: '' }), m, { movimento: 'pagar' }) as { registro: { dados: { movimento: string } } }).registro.dados.movimento, 'pagar', 'movimento escolhido para o arquivo inteiro');
eq((interpretarLinha('titulos', linha({ 1: 'Filial' }), m, { empresas: ['Matriz'] }) as { codigo: string }).codigo, 'outra_empresa', 'empresa fora da mudança');
eq([lerMovimento('A Pagar'), lerMovimento('R'), lerMovimento('Despesa'), lerMovimento('xyz')], ['pagar', 'receber', 'pagar', null], 'leitura do movimento');

console.log('--- Identidade ---');
const ind = indiceVazio();
ind.pessoas.push(
  { id: 'c1', papel: 'cliente', nome: 'Maria Souza', razao_social: '', documento: '12345678909', email: 'casal@x.com', telefones: ['(11) 99999-1111'], doLote: false },
  { id: 'c2', papel: 'cliente', nome: 'Pedro Lima', razao_social: '', documento: '', email: 'pedro@x.com', telefones: [], doLote: false },
  { id: 'c3', papel: 'cliente', nome: 'José Silva', razao_social: '', documento: '', email: '', telefones: [], doLote: false },
  { id: 'c4', papel: 'cliente', nome: 'José Silva', razao_social: '', documento: '', email: '', telefones: [], doLote: false },
);
const r1 = acharPessoa(ind, 'cliente', { nome: 'MARIA S.', documento: '123.456.789-09' });
eq(r1.tipo === 'achou' ? [r1.pessoa.id, r1.como] : r1, ['c1', 'documento'], 'CPF manda, mesmo com outro nome');
const r2 = acharPessoa(ind, 'cliente', { nome: 'João Souza', email: 'CASAL@x.com' });
eq([r2.tipo, r2.tipo !== 'ambigua' ? r2.avisos.length : 0], ['nova', 1], 'mesmo e-mail e nome diferente: pessoa separada, com aviso');
const r3 = acharPessoa(ind, 'cliente', { nome: 'Pedro Lima', email: 'pedro@x.com' });
eq(r3.tipo === 'achou' ? r3.como : r3, 'email', 'mesmo e-mail e mesmo nome: a mesma pessoa');
eq(acharPessoa(ind, 'cliente', { nome: 'Jose Silva' }).tipo, 'ambigua', 'dois homônimos sem documento: pede o CPF/CNPJ');
eq(acharPessoa(ind, 'cliente', { nome: 'Maria Souza', documento: '98765432100' }).tipo, 'nova', 'mesmo nome com outro CPF: outra pessoa');
eq(acharPessoa(ind, 'fornecedor', { nome: 'Maria Souza' }).tipo, 'nova', 'papel separa cliente de fornecedor');
eq(chaveDoTitulo({ movimento: 'pagar', pessoa: 'Hotel Sol Ltda', documento_pessoa: '', documento: 'FAT-9', vencimento: '2026-11-15', valor: 80050, parcela_numero: 1, total_parcelas: 1 }),
  'pagar|hotel sol|fat 9|2026-11-15|80050|1/1', 'chave natural do título');

console.log('--- Plano (ensaio) ---');
const ip = indiceVazio();
ip.categorias.push({ id: 'r', nome: 'RECEITAS', tipo: 'RECEITA', pai_id: null, codigo: '1', doLote: false }, { id: 'r1', nome: 'Comissões', tipo: 'RECEITA', pai_id: 'r', codigo: '1.1', doLote: false },
  { id: 'd', nome: 'DESPESAS', tipo: 'DESPESA', pai_id: null, codigo: '2', doLote: false });
eq([proximoCodigo(ip, ip.categorias[0]), proximoCodigo(ip, ip.categorias[1]), proximoCodigo(ip, null)], ['1.2', '1.1.01', '3'], 'códigos do plano de contas');
const g = gravadorDeEnsaio();
const ctx = { dataCorte: '2026-11-05', chavesDoLote: new Map<string, string>(), saldosDoLote: new Set<string>() };
const o = { lote_id: 'L', arquivo_id: 'A', arquivo: 'nov.xlsx', linha: 5, etapa: 4 };
const tit = interpretarLinha('titulos', linha({}), m) as { ok: true; registro: never };
const d1 = await processarRegistro(tit.registro, {}, ip, ctx, g, o);
const d2 = await processarRegistro(tit.registro, {}, ip, ctx, g, { ...o, linha: 9 });
eq([d1.resultado, d2.resultado, d2.codigo, d2.motivo], ['criar', 'recusar', 'duplicado_no_arquivo', 'Repete a linha 5 de "nov.xlsx".'], 'mesma linha duas vezes: a segunda é recusada como duplicada');
eq([ip.pessoas.length, ip.pessoas[0].nome, d1.avisos.some(a => a.includes('não estava cadastrado'))], [1, 'Maria', true], 'pessoa nova criada a partir do título (simulada)');
ip.chavesImportadas.set(d1.chave!, '"Mudança de outubro"');
const ctx2 = { ...ctx, chavesDoLote: new Map<string, string>() };
const d3 = await processarRegistro(tit.registro, {}, ip, ctx2, g, o);
eq([d3.resultado, d3.codigo], ['recusar', 'ja_importado'], 'já trazido por outra mudança: recusado');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);

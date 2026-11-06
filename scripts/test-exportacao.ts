/**
 * Exportação (E7, G3): o documento único de toda lista e relatório.
 * Validação do que a tela manda, colunas sensíveis, células, nome do arquivo
 * com o filtro, Excel (.xlsx, lido de volta pelo SheetJS) e PDF (jsPDF).
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-exportacao.ts
 */
import * as XLSX from 'xlsx';
import {
  csvDoDocumento, matrizDoDocumento, nomeDoArquivo, rotuloDoPeriodo, semColunasSensiveis, slug, textoDaCelula,
  validarDocumento, valorParaPlanilha, type DocumentoExportado,
} from '../src/lib/exportacao/documento.ts';
import { planilhaDoDocumento } from '../src/lib/exportacao/planilha.ts';
import { orientacaoDoDocumento, paraLatin1, pdfDoDocumento, pesosDasColunas } from '../src/lib/exportacao/pdf.ts';
import { cabecalhosDoArquivo, formatoDaConsulta } from '../src/lib/exportacao/arquivo.ts';

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

const doc: DocumentoExportado = {
  titulo: 'Cobranças',
  filtros: [{ rotulo: 'Período', valor: rotuloDoPeriodo('2026-11-01', '2026-11-30') }, { rotulo: 'Situação', valor: 'Em atraso' }],
  colunas: [
    { id: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
    { id: 'venc', rotulo: 'Vencimento', tipo: 'data' },
    { id: 'valor', rotulo: 'Valor', tipo: 'dinheiro' },
    { id: 'receita', rotulo: 'Receita da agência', tipo: 'dinheiro', sensivel: true },
    { id: 'pct', rotulo: '% de receita', tipo: 'percentual', sensivel: true },
    { id: 'qtd', rotulo: 'Parcelas', tipo: 'inteiro' },
  ],
  linhas: [
    { cliente: 'Carla Dias', venc: '2026-11-05', valor: 1234.5, receita: 200, pct: 16.2, qtd: 3 },
    { cliente: '=HYPERLINK("x")', venc: '2026-11-10', valor: -10, receita: 0, pct: 0, qtd: 1 },
  ],
  totais: { valor: 1224.5, receita: 200, qtd: 4 },
};

// ── Validação ──────────────────────────────────────────────────────────────
{
  eq(validarDocumento(null).ok, false, 'nada para exportar é recusado');
  eq(validarDocumento({ titulo: '', colunas: [{ id: 'a' }], linhas: [] }).ok, false, 'sem título é recusado');
  eq(validarDocumento({ titulo: 'X', colunas: [], linhas: [] }).ok, false, 'sem coluna é recusado');
  eq(validarDocumento({ titulo: 'X', colunas: [{ id: 'a' }, { id: 'a' }], linhas: [] }).ok, false, 'coluna repetida é recusada');
  eq(validarDocumento({ titulo: 'X', colunas: [{ id: 'a' }], linhas: new Array(50_001).fill({}) }).ok, false, 'mais de 50 mil linhas é recusado');
  const v = validarDocumento({
    titulo: 'X', colunas: [{ id: 'a', rotulo: 'A', tipo: 'dinheiro' }, { id: 'b', rotulo: 'B', tipo: 'qualquer' }],
    linhas: [{ a: 10, b: { obj: 1 }, c: 'some' }, { a: Infinity, b: 'ok' }], totais: { a: 10 }, filtros: [{ rotulo: 'P', valor: '' }, { rotulo: 'Q', valor: 'v' }],
  });
  eq(v.ok, true, 'documento válido passa');
  if (v.ok) {
    eq(v.documento.colunas[1].tipo, 'texto', 'tipo desconhecido vira texto');
    eq(v.documento.linhas[0], { a: 10, b: '[object Object]' }, 'linha só leva as colunas do documento (campo extra cai)');
    eq(v.documento.linhas[1].a, null, 'número infinito vira vazio');
    eq(v.documento.filtros, [{ rotulo: 'Q', valor: 'v' }], 'filtro sem valor cai');
    eq(v.documento.dinheiro_em, 'reais', 'dinheiro em reais por padrão');
  }
}

// ── Colunas sensíveis ──────────────────────────────────────────────────────
{
  const sem = semColunasSensiveis(doc, false);
  eq(sem.colunas.map(c => c.id), ['cliente', 'venc', 'valor', 'qtd'], 'sem o direito, as colunas do ganho saem');
  eq('receita' in sem.linhas[0], false, 'e o número nem vai na linha');
  eq(sem.totais, { valor: 1224.5, qtd: 4 }, 'nem no total');
  eq(semColunasSensiveis(doc, true), doc, 'com o direito, nada muda');
}

// ── Células ────────────────────────────────────────────────────────────────
{
  const c = (tipo: DocumentoExportado['colunas'][number]['tipo']) => ({ id: 'x', rotulo: 'X', tipo });
  eq(textoDaCelula(c('dinheiro'), 1234.5), 'R$ 1.234,50', 'dinheiro em reais vira R$');
  eq(textoDaCelula(c('dinheiro'), 123450, 'centavos'), 'R$ 1.234,50', 'dinheiro em centavos vira R$');
  eq(textoDaCelula(c('dinheiro'), -10), '-R$ 10,00', 'negativo com sinal');
  eq(textoDaCelula(c('data'), '2026-11-05'), '05/11/2026', 'data em dd/mm/aaaa');
  eq(textoDaCelula(c('percentual'), 16.25), '16,25%', 'percentual');
  eq(textoDaCelula(c('inteiro'), 12000), '12.000', 'inteiro com milhar');
  eq(textoDaCelula(c('texto'), true), 'Sim', 'sim/não');
  eq(valorParaPlanilha(c('dinheiro'), 123456, 'centavos'), 1234.56, 'planilha recebe reais como número');
  eq(valorParaPlanilha(c('texto'), '=1+1'), "'=1+1", 'fórmula vira texto');
  eq(valorParaPlanilha(c('texto'), '-5 dias'), "'-5 dias", 'traço no começo também');
  const m = matrizDoDocumento(doc);
  eq(m[0], ['Cliente', 'Vencimento', 'Valor', 'Receita da agência', '% de receita', 'Parcelas'], 'cabeçalho');
  eq(m[3], ['Total', '', 1224.5, 200, '', 4], 'linha de total com rótulo');
  eq(csvDoDocumento(doc).split('\r\n')[1], 'Carla Dias;05/11/2026;1234,5;200;16,2;3', 'CSV com ; e vírgula decimal');
}

// ── Nome do arquivo com o filtro ───────────────────────────────────────────
{
  eq(slug('Fluxo de caixa · Conta Itaú'), 'fluxo-de-caixa-conta-itau', 'slug sem acento');
  eq(nomeDoArquivo(doc, 'xlsx'), 'cobrancas-2026-11-01-a-2026-11-30-em-atraso.xlsx', 'nome leva o filtro aplicado');
  eq(nomeDoArquivo(doc, 'imprimir'), 'cobrancas-2026-11-01-a-2026-11-30-em-atraso.pdf', 'imprimir é PDF');
  eq(nomeDoArquivo({ titulo: '', filtros: [] }, 'pdf'), 'exportacao.pdf', 'sem título');
  eq(nomeDoArquivo({ titulo: 'a'.repeat(200) }, 'csv').length <= 124, true, 'nome tem teto');
  eq(rotuloDoPeriodo(null, null), 'todo o período', 'período aberto');
  eq(formatoDaConsulta('xlsx'), 'xlsx', 'formato da consulta');
  eq(formatoDaConsulta('exe'), null, 'formato desconhecido');
  eq(cabecalhosDoArquivo('dre.pdf', 'imprimir')['Content-Disposition'].startsWith('inline'), true, 'imprimir abre na janela');
  eq(cabecalhosDoArquivo('dre.xlsx', 'xlsx')['Content-Disposition'].startsWith('attachment'), true, 'Excel baixa');
}

// ── Excel lido de volta ────────────────────────────────────────────────────
{
  const bytes = planilhaDoDocumento(doc, new Date('2026-11-06T15:00:00Z'));
  const wb = XLSX.read(bytes, { type: 'array', cellNF: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  eq(wb.SheetNames[0], 'Cobranças', 'aba com o título');
  eq(ws.A1.v, 'Cobranças', 'título no topo');
  eq(ws.A2.v, 'Período: 01/11/2026 a 30/11/2026 · Situação: Em atraso', 'filtros por extenso no topo');
  eq(String(ws.A3.v).startsWith('Gerado em 06/11/2026'), true, 'hora em que saiu');
  eq(ws.A5.v, 'Cliente', 'cabeçalho depois de uma linha em branco');
  eq(ws.C6.v, 1234.5, 'dinheiro como número');
  eq(ws.C6.z, '#,##0.00;[Red]-#,##0.00', 'com formato de dinheiro');
  eq(ws.B6.t, 'n', 'data como data');
  eq(ws.B6.z, 'dd/mm/yyyy', 'no formato brasileiro');
  eq(ws.A7.v, "'=HYPERLINK(\"x\")", 'fórmula neutralizada');
  eq(ws.A8.v, 'Total', 'total no fim');
  eq(ws['!autofilter']?.ref, 'A5:F7', 'filtro automático no cabeçalho');
}

// ── PDF ────────────────────────────────────────────────────────────────────
{
  eq(paraLatin1('A → B ✓'), 'A -> B ok', 'setas e marcas viram texto');
  const pesos = pesosDasColunas(doc.colunas, [['Carla', '05/11/2026', 'R$ 1.234,50', '', '', '3']]);
  eq(pesos.length, 6, 'um peso por coluna');
  eq(orientacaoDoDocumento(doc, pesos), 'retrato', 'seis colunas curtas cabem em pé');
  eq(orientacaoDoDocumento({ ...doc, colunas: [...doc.colunas, { id: 'z', rotulo: 'Z', tipo: 'texto' }] }, [...pesos, 8]), 'paisagem', 'sete colunas vão em paisagem');
  const pdf = await pdfDoDocumento(doc, { geradoEm: new Date('2026-11-06T15:00:00Z') });
  const txt = new TextDecoder('latin1').decode(pdf);
  eq(txt.startsWith('%PDF-'), true, 'é um PDF');
  eq(txt.includes('/AutoPrint') || txt.includes('/Print'), false, 'PDF comum não imprime sozinho');
  const imp = new TextDecoder('latin1').decode(await pdfDoDocumento(doc, { imprimir: true }));
  eq(/\/S\s*\/Named[\s\S]*\/N\s*\/Print/.test(imp) || imp.includes('/Print'), true, 'Imprimir abre a janela de impressão');
  const muitas: DocumentoExportado = { titulo: 'Grande', colunas: doc.colunas, linhas: Array.from({ length: 400 }, (_, i) => ({ cliente: `Pessoa ${i}`, valor: i })) };
  const grande = new TextDecoder('latin1').decode(await pdfDoDocumento(muitas));
  eq((grande.match(/\/Type \/Page\b/g) ?? []).length > 3, true, '400 linhas quebram em várias páginas');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);

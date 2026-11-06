/**
 * Lançamento (E7, frente D, 06/11/2026), lógica pura: anexo livre (tipo pelo
 * conteúdo, tamanho, limite, nome seguro, como servir), regra de rateio que
 * entra sozinha, e a série a receber em outra moeda.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-lancamento-e7d.ts
 */
import {
  ANEXO_MAX_BYTES, MAX_ANEXOS_POR_TITULO, anexosDe, comoServir, conferirArquivoDoAnexo, nomeDoAnexo, FORMATO_DO_ARQUIVO_PRIVADO,
} from '../src/lib/anexos-do-titulo.ts';
import { gatilhoDaRegra, regraQueSeAplicaSozinha } from '../src/lib/dimensoes.ts';
import { brlEmCentavos, limparModelo, montarTitulo } from '../src/lib/recorrencia-titulos.ts';

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
const bytes = (s: string) => new TextEncoder().encode(s);

console.log('--- Anexo livre ---');
eq(conferirArquivoDoAnexo(bytes('%PDF-1.7 ...'), 'x.pdf', 0), { ok: true, ext: 'pdf', mime: 'application/pdf' }, 'PDF pelo conteúdo');
eq(conferirArquivoDoAnexo(bytes('%PDF-1.7 ...'), 'disfarce.txt', 0).ok && conferirArquivoDoAnexo(bytes('%PDF-1.7'), 'disfarce.txt', 0), { ok: true, ext: 'pdf', mime: 'application/pdf' }, 'o conteúdo manda, não o nome');
eq(conferirArquivoDoAnexo(bytes('<html><script>'), 'pagina.html', 0).ok, false, 'HTML: recusado');
eq(conferirArquivoDoAnexo(bytes('a;b\n1;2'), 'planilha.csv', 0).ok, true, 'CSV: aceito');
eq(conferirArquivoDoAnexo(new Uint8Array([0x4d, 0x5a]), 'app.exe', 0).ok, false, 'executável: recusado');
eq(conferirArquivoDoAnexo(new Uint8Array(0), 'vazio.pdf', 0).ok, false, 'vazio: recusado');
eq(conferirArquivoDoAnexo(new Uint8Array(ANEXO_MAX_BYTES + 1).fill(0x25), 'g.pdf', 0).ok, false, 'acima do limite: recusado');
eq(conferirArquivoDoAnexo(bytes('%PDF-'), 'x.pdf', MAX_ANEXOS_POR_TITULO).ok, false, 'conta cheia: recusado');
eq([nomeDoAnexo('../../etc/passwd'), nomeDoAnexo('  Contrato  final.pdf '), nomeDoAnexo('')], ['.. .. etc passwd', 'Contrato final.pdf', 'arquivo'], 'nome mostrado nunca vira caminho');
eq([comoServir('a.pdf').inline, comoServir('a.png').inline, comoServir('a.csv').inline, comoServir('a.docx').inline], [true, true, false, false], 'PDF e imagem abrem; o resto desce como arquivo');
eq([FORMATO_DO_ARQUIVO_PRIVADO.test('anexo-abc_1.xlsx'), FORMATO_DO_ARQUIVO_PRIVADO.test('../x.pdf'), FORMATO_DO_ARQUIVO_PRIVADO.test('x.html')], [true, false, false], 'leitura só de nome gerado e tipo aceito');
eq(anexosDe({ anexos: [{ nome: 'a', url: '/api/comprovantes/x.pdf' }, { url: '' }, 'lixo', { url: '/api/comprovantes/y.pdf' }] }).map(a => a.nome), ['a', 'y.pdf'], 'lista antiga lida em forma segura');

console.log('--- Rateio que entra sozinho ---');
eq([gatilhoDaRegra({}), gatilhoDaRegra({ categoria_id: ' c1 ', pessoa: '   ' }), gatilhoDaRegra({ pessoa: ' Hotel  Serra ' })],
  [undefined, { categoria_id: 'c1' }, { pessoa: 'Hotel Serra' }], 'gatilho limpo; vazio = só à mão');
const regras = [
  { id: 'cat', aplicar_quando: { categoria_id: 'c1' } },
  { id: 'pessoa', aplicar_quando: { pessoa: 'Hotel Serra' } },
  { id: 'ambos', aplicar_quando: { categoria_id: 'c1', pessoa: 'Hotel Serra' } },
  { id: 'manual' },
];
eq([regraQueSeAplicaSozinha(regras, { categoria_id: 'c1' })?.id, regraQueSeAplicaSozinha(regras, { pessoa: 'hotel serra' })?.id,
  regraQueSeAplicaSozinha(regras, { categoria_id: 'c1', pessoa: 'Hotel Serra' })?.id, regraQueSeAplicaSozinha(regras, { categoria_id: 'c2', pessoa: 'Outro' })],
['cat', 'pessoa', 'ambos', null], 'as duas vencem; depois pessoa; depois categoria; nada casa = nenhuma');
eq(regraQueSeAplicaSozinha([{ id: 'a', aplicar_quando: { categoria_id: 'c1' } }, { id: 'b', aplicar_quando: { categoria_id: 'c1' } }], { categoria_id: 'c1' }), null, 'empate: nenhuma (não adivinha)');

console.log('--- Série a receber em outra moeda ---');
const modelo = limparModelo('contas_receber', { descricao: 'Pacote', moeda: 'usd', cambio: 5.5, campos_personalizados: { p: 1 }, conta_previsao_id: 'b1', valor_final: 99 });
eq([modelo.moeda, modelo.cambio, modelo.campos_personalizados, modelo.conta_previsao_id, 'valor_final' in modelo], ['USD', 5.5, { p: 1 }, 'b1', false], 'modelo guarda moeda, câmbio, campos e conta prevista (nunca o valor)');
eq('moeda' in limparModelo('contas_receber', { descricao: 'x', moeda: 'BRL' }), false, 'em real: nada de moeda no modelo (a conta de sempre)');
eq(limparModelo('contas_pagar', { descricao: 'x', moeda: 'GBP', cambio: 7 }).moeda, 'GBP', 'pagar: outras moedas além de USD e EUR não viram real');
eq(brlEmCentavos('contas_receber', modelo, 100000), 550000, 'em reais pelo câmbio do lançamento');
eq(brlEmCentavos('contas_receber', {}, 100000), 100000, 'a receber em real: o mesmo número');
const t = montarTitulo({ tabela: 'contas_receber', serieId: 's', modo: 'parcelado', regra: { frequencia: 'MES', intervalo: 1, feriado: 'manter', fim: { tipo: 'ocorrencias', ocorrencias: 2 } },
  modelo, ordem: 1, total: 2, vencimento: '2026-12-10', valorCentavos: 100000, valorBrlCentavos: 550000, emissao: '2026-11-06', id: 's-001' }) as unknown as Record<string, unknown>;
eq([t.moeda, t.cambio, t.valor_original, t.valor_final], ['USD', 5.5, 1000, 5500], 'título: na moeda, com o valor em reais');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);

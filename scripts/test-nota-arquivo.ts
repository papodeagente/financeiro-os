/**
 * Regras de baixar o PDF/XML da nota.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-nota-arquivo.ts
 */
import {
  decidirArquivo, nomeDoArquivo, enderecoDoArquivo, cabecalhoDeDownload, ehTipoDeArquivo,
} from '../src/lib/nota-arquivo.ts';
import { buscarArquivo, EmissorPlugNotas, ErroFiscal } from '../src/lib/nfse-emissor.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

const AUTORIZADA = {
  numero: '1234', codigo_verificacao: 'ABC-123', status: 'AUTORIZADA',
  link_pdf: 'https://api.plugnotas.com.br/nfse/pdf/xyz',
  link_xml: 'https://api.plugnotas.com.br/nfse/xml/xyz',
};

// O endereço nunca é o do emissor: é a rota do sistema. É a correção inteira.
eq(enderecoDoArquivo('n1', 'pdf'), '/api/fiscal/notas/n1/arquivo?tipo=pdf', 'a tela aponta para a rota do sistema, não para o link do emissor');
eq(enderecoDoArquivo('nota/estranha', 'xml'), '/api/fiscal/notas/nota%2Festranha/arquivo?tipo=xml', 'id com barra vai escapado');

const pdf = decidirArquivo(AUTORIZADA, 'pdf');
eq(pdf.pode && pdf.url, AUTORIZADA.link_pdf, 'o servidor busca no link_pdf');
eq(pdf.pode && pdf.tipo_conteudo, 'application/pdf', 'e entrega como PDF');
const xml = decidirArquivo(AUTORIZADA, 'xml');
eq(xml.pode && xml.url, AUTORIZADA.link_xml, 'o XML vem do link_xml, não do link_pdf');
eq(xml.pode && xml.tipo_conteudo, 'application/xml', 'e entrega como XML');

// Cancelada ainda tem documento: cancelar não apaga a nota que existiu.
eq(decidirArquivo({ ...AUTORIZADA, status: 'CANCELADA' }, 'pdf').pode, true, 'nota cancelada continua baixável');

for (const status of ['PROCESSANDO', 'REJEITADA', 'RASCUNHO', '', 'autorizada ']) {
  const d = decidirArquivo({ ...AUTORIZADA, status }, 'pdf');
  eq([d.pode, !d.pode && d.motivo], [false, 'nota-nao-autorizada'], `status ${JSON.stringify(status)} não tem documento`);
}
eq(decidirArquivo({ ...AUTORIZADA, status: 'autorizada' }, 'pdf').pode, true, 'mas o status em minúscula é o mesmo status');

const semLink = decidirArquivo({ ...AUTORIZADA, link_pdf: '   ' }, 'pdf');
eq([semLink.pode, !semLink.pode && semLink.motivo], [false, 'emissor-nao-devolveu-link'], 'autorizada sem link é falta de link, não falta de autorização');
eq(!semLink.pode && semLink.mensagem.includes('PDF'), true, 'e a mensagem diz qual arquivo faltou');

eq(nomeDoArquivo(AUTORIZADA, 'pdf'), 'nfse-1234.pdf', 'o arquivo se chama pelo número da nota');
eq(nomeDoArquivo({ ...AUTORIZADA, numero: '' }, 'xml'), 'nfse-ABC-123.xml', 'sem número, pelo código de verificação');
eq(nomeDoArquivo({ status: 'AUTORIZADA' }, 'pdf'), 'nota-fiscal.pdf', 'sem nenhum dos dois, um nome ainda assim');
eq(nomeDoArquivo({ numero: '12/34 çã' }, 'pdf'), 'nfse-1234ca.pdf', 'barra, espaço e acento saem do nome: ele viaja num cabeçalho');

eq(cabecalhoDeDownload('nfse-1234.pdf'), 'attachment; filename="nfse-1234.pdf"; filename*=UTF-8\'\'nfse-1234.pdf', 'o cabeçalho manda salvar, não abrir');

eq(['pdf', 'xml'].map(ehTipoDeArquivo), [true, true], 'pdf e xml são tipos');
eq(['PDF', 'pdfx', '', null, undefined, 'json'].map(ehTipoDeArquivo), [false, false, false, false, false, false], 'e nada mais é');

// ---- A busca no emissor ----
// Quem baixa é o servidor, com a chave no cabeçalho. Estes testes trocam o
// fetch por um de mentira para olhar o cabeçalho que SAIU e o que entra.
const original = globalThis.fetch;
function fingirFetch(resposta: Response, registro: { url?: string; cabecalhos?: unknown }) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    registro.url = String(url);
    registro.cabecalhos = init?.headers;
    return resposta;
  }) as typeof fetch;
}
async function erroDe(f: () => Promise<unknown>): Promise<string> {
  try { await f(); return '(não deu erro)'; }
  catch (e) { return e instanceof ErroFiscal ? e.message : `(outro erro: ${String(e)})`; }
}

const bytesPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
{
  const reg: { url?: string; cabecalhos?: unknown } = {};
  fingirFetch(new Response(bytesPdf, { status: 200, headers: { 'content-type': 'application/pdf' } }), reg);
  const r = await buscarArquivo('https://emissor/pdf/1', { 'x-api-key': 'chave' }, 'application/pdf');
  eq([...r.bytes], [...bytesPdf], 'os bytes do PDF chegam inteiros');
  eq(r.tipo_conteudo, 'application/pdf', 'e o tipo vem do emissor');
  eq((reg.cabecalhos as Record<string, string>)['x-api-key'], 'chave', 'a chave viaja no cabeçalho, que é o motivo da rota existir');
}
{
  // A pegadinha: 200 com JSON de erro. Entregar isso como PDF salvaria um
  // arquivo quebrado na máquina do cliente.
  const reg: { url?: string } = {};
  fingirFetch(new Response('{"error":"nota não encontrada"}', { status: 200, headers: { 'content-type': 'application/json' } }), reg);
  eq(
    await erroDe(() => buscarArquivo('https://emissor/pdf/1', {}, 'application/pdf')),
    'O emissor respondeu com uma mensagem em vez do arquivo da nota.',
    'JSON com HTTP 200 é erro, não documento',
  );
}
{
  const reg: { url?: string } = {};
  fingirFetch(new Response('', { status: 200, headers: { 'content-type': 'application/pdf' } }), reg);
  eq(
    await erroDe(() => buscarArquivo('https://emissor/pdf/1', {}, 'application/pdf')),
    'O emissor devolveu um arquivo vazio.',
    'arquivo de zero byte não é arquivo',
  );
}
{
  const reg: { url?: string } = {};
  fingirFetch(new Response('sem permissão', { status: 401, headers: { 'content-type': 'text/plain' } }), reg);
  eq(
    await erroDe(() => buscarArquivo('https://emissor/pdf/1', {}, 'application/pdf')),
    'O emissor recusou entregar o arquivo da nota (HTTP 401).',
    'e a recusa do emissor diz o código, para dar o que investigar',
  );
}
{
  // O emissor é quem sabe autenticar: a PlugNotas por x-api-key.
  const reg: { url?: string; cabecalhos?: unknown } = {};
  fingirFetch(new Response(bytesPdf, { status: 200, headers: { 'content-type': 'application/pdf' } }), reg);
  await new EmissorPlugNotas().baixarArquivo(
    'https://emissor/pdf/1', 'application/pdf',
    { provedor: 'plugnotas', ambiente: 'HOMOLOGACAO', token: 'tok-da-agencia' } as never,
  );
  eq((reg.cabecalhos as Record<string, string>)['x-api-key'], 'tok-da-agencia', 'a PlugNotas manda a chave da agência');
  eq(reg.url, 'https://emissor/pdf/1', 'e busca exatamente o link que o emissor gravou na nota');
}
globalThis.fetch = original;

console.log(`\n${total - falhas}/${total} testes de baixar a nota passaram`);
if (falhas > 0) process.exit(1);

/**
 * Avisar o CRM da nota fiscal (src/lib/nota-para-o-crm.ts).
 *
 * POR QUE ESTES TESTES IMPORTAM. O evento vira documento na área do CLIENTE,
 * no outro sistema. Os três erros possíveis são todos silenciosos deste lado:
 * emitir cedo demais publica link vazio; emitir sem o vínculo da venda faz o
 * CRM descartar e ninguém vê; e emitir duas vezes publica o mesmo documento
 * repetido para o cliente — `sincronizarNota` roda em laço até a prefeitura
 * responder.
 *
 * Roda com: node --experimental-strip-types scripts/test-nota-para-o-crm.ts
 */
import {
  chaveDoAviso, decidirAviso, montarAviso, nomeDoArquivo,
} from '../src/lib/nota-para-o-crm.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const OK = {
  id: 'n1', status: 'AUTORIZADA', numero: '000124',
  link_pdf: 'https://emissor/nota.pdf', link_xml: 'https://emissor/nota.xml',
  valor_servicos: 12000, autorizada_em: '2026-10-07T12:00:00.000Z',
};

console.log('--- só avisa quando há o que mostrar ---');
eq(decidirAviso({ nota: OK, crmVendaId: 'deal-9' }), { avisar: true, motivo: null }, 'autorizada, com arquivo e com venda');

eq(decidirAviso({ nota: { ...OK, status: 'PROCESSANDO' }, crmVendaId: 'deal-9' }).motivo, 'nao-autorizada', 'em processamento não avisa');
eq(decidirAviso({ nota: { ...OK, status: 'REJEITADA' }, crmVendaId: 'deal-9' }).motivo, 'nao-autorizada', 'rejeitada não avisa');
eq(decidirAviso({ nota: { ...OK, status: 'CANCELADA' }, crmVendaId: 'deal-9' }).motivo, 'nao-autorizada', 'cancelada não avisa');
eq(decidirAviso({ nota: { ...OK, status: 'autorizada' }, crmVendaId: 'deal-9' }).avisar, true, 'caixa baixa também conta');

// Autorizada mas sem PDF: o portal mostraria um documento vazio. O XML não
// entra no portal — é papel do contador, não do viajante —, então ele sozinho
// não basta.
eq(decidirAviso({ nota: { ...OK, link_pdf: '' }, crmVendaId: 'd' }).motivo, 'sem-arquivo', 'sem PDF não publica');
eq(decidirAviso({ nota: { ...OK, link_pdf: '', link_xml: 'https://x/n.xml' }, crmVendaId: 'd' }).motivo, 'sem-arquivo', 'só XML NÃO basta: ele não vai para o portal');
eq(decidirAviso({ nota: { ...OK, link_xml: '' }, crmVendaId: 'd' }).avisar, true, 'só PDF basta');
eq(decidirAviso({ nota: { ...OK, link_pdf: '   ' }, crmVendaId: 'd' }).motivo, 'sem-arquivo', 'espaço não conta como link');

// O erro mais traiçoeiro: evento perfeito que o CRM descarta por falta de vínculo.
eq(decidirAviso({ nota: OK, crmVendaId: '' }).motivo, 'sem-venda-no-crm', 'sem venda do CRM não avisa');
eq(decidirAviso({ nota: OK, crmVendaId: null }).motivo, 'sem-venda-no-crm', 'nulo também');
eq(decidirAviso({ nota: OK, crmVendaId: '   ' }).motivo, 'sem-venda-no-crm', 'só espaço também');

console.log('--- precedência: o motivo relatado é o primeiro impedimento ---');
eq(
  decidirAviso({ nota: { ...OK, status: 'PROCESSANDO', link_pdf: '' }, crmVendaId: '' }).motivo,
  'nao-autorizada',
  'status vem antes de arquivo e de vínculo',
);

console.log('--- a chave trava o reenvio ---');
// sincronizarNota roda em laço: a chave tem que ser da NOTA, não da tentativa.
eq(chaveDoAviso('n1'), 'nf-n1', 'chave derivada do id da nota');
eq(chaveDoAviso('n1') === chaveDoAviso('n1'), true, 'mesma nota, mesma chave');
eq(chaveDoAviso('n1') === chaveDoAviso('n2'), false, 'notas diferentes, chaves diferentes');

console.log('--- o nome que o cliente vê ---');
// Sem espaço e sem acento: do outro lado ele vira chave no S3, e o CRM
// limparia o que sobrasse — o cliente veria o resto da limpeza.
eq(nomeDoArquivo('000124'), 'nfse-000124.pdf', 'com número');
eq(nomeDoArquivo(''), 'nota-fiscal.pdf', 'sem número não vira "nfse-.pdf"');
eq(nomeDoArquivo(null), 'nota-fiscal.pdf', 'nulo idem');
eq(nomeDoArquivo('  124  '), 'nfse-124.pdf', 'espaços aparados');
eq(nomeDoArquivo('12/34 çã'), 'nfse-1234ca.pdf', 'barra, espaço e acento saem do nome');

console.log('--- o aviso leva o PDF inteiro, não o link ---');
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // %PDF-1
const aviso = montarAviso({ nota: OK, crmVendaId: 'deal-9', pdf: PDF });
eq(aviso.crm_venda_id, 'deal-9', 'o vínculo com a negociação');
eq(aviso.nome_arquivo, 'nfse-000124.pdf', 'o nome pronto para o portal');
eq(aviso.tipo_conteudo, 'application/pdf', 'o tipo');
eq(aviso.valor_servicos, 12000, 'o valor');
eq(aviso.autorizada_em, '2026-10-07T12:00:00.000Z', 'quando autorizou');
// O ponto da mudança: o que viaja são os BYTES. O link do emissor exige a
// chave da agência e não abriria no navegador de ninguém.
eq([...Buffer.from(aviso.arquivo_base64, 'base64')], [...PDF], 'os bytes do PDF voltam inteiros do base64');
eq(JSON.stringify(aviso).includes('https://emissor/nota.pdf'), false, 'o link do emissor NÃO vai no evento');
eq(JSON.stringify(aviso).includes('https://emissor/nota.xml'), false, 'nem o do XML');
// Campo ausente não vira "undefined" string no payload.
const magro = montarAviso({ nota: { id: 'n9', status: 'AUTORIZADA' }, crmVendaId: 'd', pdf: PDF });
eq(magro.numero, '', 'número ausente vira string vazia');
eq(magro.valor_servicos, 0, 'valor ausente vira 0');
eq(magro.nome_arquivo, 'nota-fiscal.pdf', 'sem número, o arquivo ainda tem nome');

console.log(`\n${total - falhas}/${total} testes do aviso da nota ao CRM passaram`);
if (falhas > 0) process.exit(1);

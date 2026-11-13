/**
 * Identidade visual da agência no recibo (src/lib/marca-da-agencia.ts): cor
 * do cadastro só entra validada e o texto sempre lê bem.
 */
import {
  COR_DESTAQUE_PADRAO, COR_PRIMARIA_PADRAO, contraste, corValida, legivelNoPapel, marcaDoDocumento, textoSobre,
} from '../src/lib/marca-da-agencia.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

eq(['#1a2b3c', '#ABC', ' #00ff00 ', 'red', 'url(x)', '#12345', '', null].map(corValida), ['#1A2B3C', '#AABBCC', '#00FF00', null, null, null, null, null], 'só hex vira cor; o resto cai no padrão');
eq(marcaDoDocumento(null).primaria, COR_PRIMARIA_PADRAO, 'sem cadastro: cor principal padrão');
eq(marcaDoDocumento({ cores: { primaria: 'javascript:x', destaque: '' } }).destaque, COR_DESTAQUE_PADRAO, 'cor inválida no cadastro não entra no CSS');

eq([textoSobre('#004AAD'), textoSobre('#FFD400'), textoSobre('#111111'), textoSobre('#F5F5F5')], ['#FFFFFF', '#111827', '#FFFFFF', '#111827'], 'texto sobre a faixa: branco no escuro, quase preto no claro');
for (const cor of ['#004AAD', '#FFD400', '#00C2FF', '#E5E7EB', '#FF6B00']) {
  eq(contraste(textoSobre(cor), cor) >= 4.5, true, `faixa ${cor}: texto com contraste de leitura`);
  eq(contraste(legivelNoPapel(cor), '#FFFFFF') >= 4.5, true, `${cor} escrita no papel branco fica legível`);
}
eq(legivelNoPapel('#004AAD'), '#004AAD', 'cor que já lê bem não muda');

console.log(`\n${total - falhas}/${total} testes da marca da agência passaram`);
if (falhas > 0) process.exit(1);

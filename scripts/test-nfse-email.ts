/**
 * Enviar a nota por e-mail ao cliente (src/lib/nfse-email.ts).
 *
 * POR QUE ESTES TESTES IMPORTAM. Quem despacha o e-mail é o emissor, não este
 * sistema, e isso cria três jeitos de mentir para o usuário:
 *
 *  1. Oferecer a opção quando não há e-mail no cadastro. A pessoa marca,
 *     emite, e nada chega — sem erro em lugar nenhum.
 *  2. Validar e-mail com rigor demais e barrar endereço que funciona. O custo
 *     do falso negativo aqui é a nota não chegar ao cliente.
 *  3. Prometer que DESMARCAR impede o envio. A conta do emissor pode estar
 *     configurada para enviar sempre, e essa chave não está neste sistema.
 *
 * Roda com: node --experimental-strip-types scripts/test-nfse-email.ts
 */
import {
  disponibilidadeDoEnvio, emailPlausivel, resumoDoEnvio,
} from '../src/lib/nfse-email.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}
function contem(texto: string, trecho: string, label: string) {
  total++;
  if (texto.includes(trecho)) console.log(`PASS  ${label}`);
  else { falhas++; console.log(`FAIL  ${label}\n        "${texto}" não contém "${trecho}"`); }
}

console.log('--- forma de e-mail: pega o quebrado, não arbitra o resto ---');
eq(emailPlausivel('cliente@empresa.com.br'), true, 'endereço comum');
eq(emailPlausivel('maria.souza+nota@gmail.com'), true, 'apelido com + passa');
eq(emailPlausivel('a@b.co'), true, 'endereço curto e válido passa');
eq(emailPlausivel('contato@agência.com.br'), true, 'domínio com acento não é barrado');
eq(emailPlausivel('nome@dominio-novo.viagem'), true, 'TLD incomum não é barrado');

eq(emailPlausivel(''), false, 'vazio');
eq(emailPlausivel('   '), false, 'só espaço');
eq(emailPlausivel(null), false, 'nulo');
eq(emailPlausivel(undefined), false, 'indefinido');
eq(emailPlausivel('Maria Souza'), false, 'nome digitado no lugar do e-mail');
eq(emailPlausivel('maria souza@x.com'), false, 'espaço no meio');
eq(emailPlausivel('maria@'), false, 'sem domínio');
eq(emailPlausivel('@empresa.com'), false, 'sem parte local');
eq(emailPlausivel('maria@empresa'), false, 'domínio sem ponto');
eq(emailPlausivel('maria@@empresa.com'), false, 'dois arrobas');
eq(emailPlausivel('maria@.com'), false, 'domínio começa com ponto');
eq(emailPlausivel('maria@empresa.'), false, 'domínio termina com ponto');
eq(emailPlausivel('maria@empresa..com'), false, 'ponto duplo no domínio');

console.log('--- a opção só aparece quando o envio pode acontecer ---');
eq(
  disponibilidadeDoEnvio({ emissorEnvia: true, emailDoTomador: 'cliente@x.com.br' }),
  { liberado: true, motivo: '', causa: null },
  'emissor envia e cliente tem e-mail: liberado',
);

// O caso que mais engana: tudo certo na tela, e nada chega.
const semEmail = disponibilidadeDoEnvio({ emissorEnvia: true, emailDoTomador: '' });
eq(semEmail.liberado, false, 'sem e-mail no cadastro: fechado');
contem(semEmail.motivo, 'não tem e-mail no cadastro', 'o motivo diz o que falta');
contem(semEmail.motivo, 'cadastro do cliente', 'o motivo diz onde resolver');

const torto = disponibilidadeDoEnvio({ emissorEnvia: true, emailDoTomador: 'Maria Souza' });
eq(torto.liberado, false, 'e-mail sem forma de endereço: fechado');
contem(torto.motivo, 'Maria Souza', 'o motivo mostra o valor que está gravado');

const semEmissor = disponibilidadeDoEnvio({ emissorEnvia: false, emailDoTomador: 'cliente@x.com' });
eq(semEmissor.liberado, false, 'emissor que não envia: fechado');
contem(semEmissor.motivo, 'Configurações', 'o motivo aponta onde trocar o emissor');

// Precedência: sem emissor, a falta de e-mail não é o assunto.
const nenhum = disponibilidadeDoEnvio({ emissorEnvia: false, emailDoTomador: '' });
contem(nenhum.motivo, 'não envia a nota por e-mail', 'o emissor vem antes do cadastro no motivo');

eq(
  disponibilidadeDoEnvio({ emissorEnvia: true, emailDoTomador: '  cliente@x.com.br  ' }).liberado,
  true,
  'espaço em volta não invalida',
);

console.log('--- a causa manda a pessoa para o lugar certo ---');
// O motivo diz "cadastro do cliente" e o link embaixo levava para a
// configuração fiscal: metade das pessoas ia para a tela errada.
eq(disponibilidadeDoEnvio({ emissorEnvia: false, emailDoTomador: 'x@y.com' }).causa, 'emissor', 'emissor: causa emissor');
eq(disponibilidadeDoEnvio({ emissorEnvia: true, emailDoTomador: '' }).causa, 'sem-email', 'sem e-mail: causa sem-email');
eq(disponibilidadeDoEnvio({ emissorEnvia: true, emailDoTomador: 'Maria' }).causa, 'email-invalido', 'e-mail torto: causa email-invalido');
eq(disponibilidadeDoEnvio({ emissorEnvia: true, emailDoTomador: 'x@y.com' }).causa, null, 'liberado não tem causa');

console.log('--- a frase não promete o que não controlamos ---');
const pedindo = resumoDoEnvio({ pedido: true, emailDoTomador: 'cliente@x.com.br' });
contem(pedindo, 'cliente@x.com.br', 'diz para qual endereço vai');
contem(pedindo, 'autorizar', 'diz que depende da autorização, não do envio');

const semPedir = resumoDoEnvio({ pedido: false, emailDoTomador: 'cliente@x.com.br' });
// A frase NÃO pode afirmar que nada será enviado: a conta do emissor pode
// estar configurada para enviar sempre, e essa chave está fora deste sistema.
eq(semPedir.includes('Nada será enviado'), false, 'não afirma que nada será enviado');
contem(semPedir, 'Não vamos pedir', 'diz o que NÓS fazemos');
contem(semPedir, 'enviar sempre', 'avisa que a conta do emissor pode enviar assim mesmo');

console.log(`\n${total - falhas}/${total} testes do envio da nota por e-mail passaram`);
if (falhas > 0) process.exit(1);

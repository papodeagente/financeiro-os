/**
 * O documento e o endereço do cliente (src/lib/cliente-documento.ts).
 *
 * POR QUE ESTES TESTES IMPORTAM. A prefeitura recusa nota sem CPF ou CNPJ do
 * tomador, e um documento com um dígito trocado tem o tamanho certo e passa em
 * qualquer conferência preguiçosa — a recusa chega depois, com a venda fechada
 * e o cliente esperando. E o endereço do tomador saía em branco em TODA nota
 * porque o montador lia uma chave que não existe no cadastro.
 *
 * Roda com: node --experimental-strip-types scripts/test-cliente-documento.ts
 */
import {
  apenasDigitos, cnpjValido, cpfValido, documentoValido, enderecoDoCliente,
  faltaParaNota, formatarDocumento, mascararCep, mascararDocumento,
  prontoParaNota, tipoDoDocumento,
} from '../src/lib/cliente-documento.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

// CPFs e CNPJs de teste, com dígito verificador correto.
const CPF_OK = '52998224725';
const CPF_ERRADO = '52998224726'; // último dígito trocado
const CNPJ_OK = '11222333000181';
const CNPJ_ERRADO = '11222333000182';

// ══════════════════════════════════════════════════════════════════════
console.log('--- só os dígitos ---');
eq(apenasDigitos('529.982.247-25'), CPF_OK, 'máscara de CPF some');
eq(apenasDigitos('11.222.333/0001-81'), CNPJ_OK, 'máscara de CNPJ some');
eq(apenasDigitos(null), '', 'nulo vira vazio');
eq(apenasDigitos('  '), '', 'espaço vira vazio');
eq(apenasDigitos('abc'), '', 'texto vira vazio');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- o dígito verificador é conferido ---');
eq(cpfValido(CPF_OK), true, 'CPF correto passa');
eq(cpfValido('529.982.247-25'), true, 'com máscara também');
// Este é o caso que motivou a validação: tamanho certo, dígito errado.
eq(cpfValido(CPF_ERRADO), false, 'um dígito trocado é recusado AQUI, não na prefeitura');
eq(cpfValido('1234567890'), false, 'dez dígitos não é CPF');
eq(cpfValido('123456789012'), false, 'doze dígitos também não');
// Sequência repetida passa na conta do dígito e é recusada por qualquer órgão.
eq(cpfValido('11111111111'), false, 'sequência repetida é recusada');
eq(cpfValido('00000000000'), false, 'zeros também');
eq(cpfValido(''), false, 'vazio não é CPF válido');

eq(cnpjValido(CNPJ_OK), true, 'CNPJ correto passa');
eq(cnpjValido('11.222.333/0001-81'), true, 'com máscara também');
eq(cnpjValido(CNPJ_ERRADO), false, 'um dígito trocado é recusado');
eq(cnpjValido('11111111111111'), false, 'sequência repetida é recusada');
eq(cnpjValido(CPF_OK), false, 'CPF não é CNPJ');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- o veredito do documento ---');
eq(tipoDoDocumento(CPF_OK), 'CPF', 'onze dígitos certos é CPF');
eq(tipoDoDocumento(CNPJ_OK), 'CNPJ', 'quatorze dígitos certos é CNPJ');
eq(tipoDoDocumento(''), 'vazio', 'nada é vazio');
eq(tipoDoDocumento(null), 'vazio', 'nulo é vazio');
// "Vazio" e "errado" são coisas diferentes: um é cadastro incompleto, o outro
// é erro de digitação, e a tela precisa dizer frases diferentes.
eq(tipoDoDocumento(CPF_ERRADO), 'invalido', 'tamanho certo com dígito errado é inválido, não vazio');
eq(tipoDoDocumento('123'), 'invalido', 'três dígitos é inválido');

eq(documentoValido(''), true, 'cliente SEM documento é permitido: ele existe e compra');
eq(documentoValido(CPF_OK), true, 'CPF correto é válido');
eq(documentoValido(CPF_ERRADO), false, 'CPF errado NÃO é válido');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- formatação ---');
eq(formatarDocumento(CPF_OK), '529.982.247-25', 'CPF formatado');
eq(formatarDocumento(CNPJ_OK), '11.222.333/0001-81', 'CNPJ formatado');
eq(formatarDocumento('123'), '123', 'incompleto sai como está, sem inventar máscara');
eq(formatarDocumento(''), '', 'vazio continua vazio');

console.log('\n--- máscara enquanto digita ---');
eq(mascararDocumento('529'), '529', 'três dígitos');
eq(mascararDocumento('529982'), '529.982', 'seis dígitos ganham o primeiro ponto');
eq(mascararDocumento('52998224725'), '529.982.247-25', 'CPF completo');
eq(mascararDocumento('112223330001'), '11.222.333/0001', 'vira CNPJ ao passar de onze');
eq(mascararDocumento('11222333000181'), '11.222.333/0001-81', 'CNPJ completo');
eq(mascararDocumento('112223330001812345'), '11.222.333/0001-81', 'não passa de quatorze dígitos');
eq(mascararCep('01310'), '01310', 'CEP curto sem traço');
eq(mascararCep('01310100'), '01310-100', 'CEP completo com traço');
eq(mascararCep('013101009999'), '01310-100', 'CEP não passa de oito dígitos');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- o endereço nas duas formas ---');
{
  // O formato REAL do cadastro: plano.
  const plano = {
    cep: '01310-100', logradouro: 'Av. Paulista', numero: '1000',
    complemento: 'sala 5', bairro: 'Bela Vista', cidade: 'São Paulo', estado: 'SP',
  };
  eq(enderecoDoCliente(plano), {
    cep: '01310-100', logradouro: 'Av. Paulista', numero: '1000',
    complemento: 'sala 5', bairro: 'Bela Vista', cidade: 'São Paulo', estado: 'SP',
  }, 'endereço plano é lido');
}
{
  // O formato que o montador da nota procurava — e que fazia TODA nota sair
  // com o endereço do tomador em branco, porque nenhum cliente o tem.
  const aninhado = { endereco: { cep: '20040-020', logradouro: 'Rua da Praia', numero: '7', cidade: 'Rio de Janeiro', estado: 'RJ' } };
  const e = enderecoDoCliente(aninhado);
  eq([e.cep, e.logradouro, e.cidade], ['20040-020', 'Rua da Praia', 'Rio de Janeiro'], 'endereço aninhado entra como retaguarda');
  eq(e.complemento, '', 'campo ausente vira string vazia, não undefined');
}
{
  // Os dois presentes: o plano manda, porque é o que o cadastro grava.
  const misto = { cep: '01310-100', cidade: 'São Paulo', endereco: { cep: '99999-999', cidade: 'Outra' } };
  const e = enderecoDoCliente(misto);
  eq([e.cep, e.cidade], ['01310-100', 'São Paulo'], 'o plano tem precedência sobre o aninhado');
}
{
  eq(enderecoDoCliente(null), { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' }, 'cliente nulo devolve endereço vazio, nunca quebra');
  eq(enderecoDoCliente({ cep: '   ' }).cep, '', 'espaço em branco conta como vazio');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- o que falta para a nota sair ---');
eq(faltaParaNota({ cpf: CPF_OK }, 'Renata'), [], 'PF com CPF certo está pronta');
eq(faltaParaNota({ cnpj: CNPJ_OK }, 'Agência X'), [], 'PJ com CNPJ certo está pronta');
eq(faltaParaNota({ cpf_cnpj: CPF_OK }, 'Renata'), [], 'o campo unificado também serve');
// O caso que este trabalho existe para acabar: o cadastro rápido pedia nome,
// e-mail e telefone, e a pessoa só descobria o problema na hora de emitir.
eq(faltaParaNota({}, 'Renata'), ['CPF ou CNPJ'], 'sem documento, a nota não sai');
eq(faltaParaNota({ cpf: CPF_ERRADO }, 'Renata'), ['CPF ou CNPJ válido'], 'documento errado tem frase própria');
eq(faltaParaNota({ cpf: CPF_OK }, ''), ['nome'], 'sem nome também não sai');
eq(faltaParaNota({}, ''), ['nome', 'CPF ou CNPJ'], 'os dois faltando aparecem juntos');
eq(faltaParaNota(null, 'Renata'), ['CPF ou CNPJ'], 'cliente nulo não quebra');

eq(prontoParaNota({ cpf: CPF_OK }, 'Renata'), true, 'pronto quando não falta nada');
eq(prontoParaNota({}, 'Renata'), false, 'não pronto sem documento');

console.log(`\n${total - falhas}/${total} testes do documento do cliente passaram`);
if (falhas > 0) process.exit(1);

/**
 * A ficha do cliente (src/lib/ficha-do-cliente.ts), a frase da comissão na
 * lista de contas a receber (src/lib/comissao-da-venda.ts) e a regra de como
 * a linha da venda do CRM vira conta (comoALinhaNasce). Tudo puro.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-ficha-e-comissao.ts
 */
import { aplicarFichaDoCrm, dataDaFicha, lerFichaDoCrm, secoesDaFicha } from '../src/lib/ficha-do-cliente.ts';
import { fraseDaComissao } from '../src/lib/comissao-da-venda.ts';
import { comoALinhaNasce } from '../src/lib/venda-crm-itens.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

console.log('--- como a linha da venda do CRM vira conta ---');
const direto = { pagoAAgencia: false, agenciaRecebeDe: new Set<string>() };
const linha = { fornecedor_id: 'f-cativa', valor_custo: 312.5, valor_venda: 390.63, sem_fornecedor: false };
eq(comoALinhaNasce(linha, direto), { meio_pagamento: 'fornecedor', comissao_valor: 78.13, comissao_percentual: 20 }, 'padrão: pago direto, comissão = margem (20%)');
eq(comoALinhaNasce(linha, { ...direto, pagoAAgencia: true }).meio_pagamento, 'proprio', 'pago pela plataforma da agência: a agência recebe e paga');
eq(comoALinhaNasce(linha, { ...direto, agenciaRecebeDe: new Set(['f-cativa']) }).meio_pagamento, 'proprio', 'cadastro do fornecedor diz "a agência"');
eq(comoALinhaNasce({ fornecedor_id: '', valor_custo: 0, valor_venda: 300, sem_fornecedor: false }, direto).meio_pagamento, 'proprio', 'sem fornecedor e sem custo: serviço da própria agência');
eq(comoALinhaNasce({ fornecedor_id: '', valor_custo: 500, valor_venda: 600, sem_fornecedor: true }, direto), { meio_pagamento: 'fornecedor', comissao_valor: 100, comissao_percentual: 16.67 }, 'custo sem fornecedor: comissão, para informar quem paga');
eq(comoALinhaNasce({ ...linha, valor_custo: 400 }, direto), { meio_pagamento: 'fornecedor', comissao_valor: 0, comissao_percentual: 0 }, 'vendido abaixo do custo: nenhuma comissão inventada (fica a do cadastro)');
eq(comoALinhaNasce({ ...linha, valor_custo: 0 }, direto).comissao_valor, 0, 'sem custo informado: a margem não é a venda inteira');

console.log('\n--- a frase da comissão ---');
eq(fraseDaComissao({ origem: 'COMISSAO_FORNECEDOR', cliente_da_venda_nome: 'Bruno', valor_pago_direto: 390.63 })?.replace(/\s/g, ' '), 'Venda de Bruno: pagou R$ 390,63 direto ao fornecedor.', 'de qual venda e quanto foi pago direto');
eq(fraseDaComissao({ origem: 'COMISSAO_FORNECEDOR', cliente_da_venda_nome: '', valor_pago_direto: 0 }), null, 'comissão lançada à mão, sem venda: sem frase');
eq(fraseDaComissao({ origem: 'VENDA', cliente_da_venda_nome: 'Bruno', valor_pago_direto: 10 }), null, 'conta do cliente não é comissão');

console.log('\n--- a ficha ---');
eq([dataDaFicha('1985-03-21'), dataDaFicha('03-21'), dataDaFicha('13-40'), dataDaFicha('')], ['21/03/1985', '21 de março', '13-40', ''], 'datas com e sem ano');
eq(lerFichaDoCrm(null), null, 'CRM antigo, sem ficha: nada muda');
const f = lerFichaDoCrm({
  data_nascimento: '03-21', endereco: { cidade: ' São Paulo ', estado: 'SP' }, etiquetas: ['vip', 'vip', ' '],
  conjuge: { nome: '' }, filhos: [{ nome: 'Lia' }, { nome: '' }], telefones_adicionais: [{ numero: '' }], responsavel: 'Karen',
})!;
eq([f.endereco.cidade, f.etiquetas, f.conjuge, f.filhos.length, f.telefones_adicionais.length, f.passaporte.numero], ['São Paulo', ['vip'], null, 1, 0, ''], 'saneada: texto aparado, sem repetição, sem cônjuge sem nome, sem item vazio');
const aplicada = aplicarFichaDoCrm({ cidade: '', data_nascimento: '' }, f, false);
eq([aplicada.data.cidade, aplicada.data.data_nascimento, aplicada.campos], ['São Paulo', '', ['endereço', 'etiquetas']], 'nascimento sem ano não vai para o campo de data (que exige o ano)');
eq(aplicarFichaDoCrm({ cidade: 'Campinas' }, f, false).data.cidade, 'Campinas', 'venda não troca o preenchido');
eq(aplicarFichaDoCrm({ cidade: 'Campinas' }, f, true).data.cidade, 'São Paulo', 'mudança no CRM troca');

const secoes = secoesDaFicha({
  telefone_principal: '(11) 99999-0000', whatsapp: '11999990000', email: 'a@b.com',
  cidade: 'Campinas', estado: 'SP', logradouro: 'Rua A', numero: '10',
  passaporte: 'FX1', validade_passaporte: '2031-05-10',
  crm_ficha: { ...f, data_nascimento: '1985-03-21', profissao: 'Médico', conjuge: { nome: 'Ana', cpf: '', data_nascimento: '', passaporte: { numero: '', validade: '', pais_emissor: '' } }, passaporte: { numero: 'FX1', validade: '2031-05-10', pais_emissor: 'BR' } },
});
const mapa = Object.fromEntries(secoes.map(s => [s.titulo, s.itens.map(i => `${i.rotulo}: ${i.valor}`)]));
eq(mapa['Contato'], ['Telefone: (11) 99999-0000', 'E-mail: a@b.com'], 'o mesmo celular com e sem máscara aparece uma vez');
eq(mapa['Endereço'], ['Endereço: Rua A, 10', 'Bairro e cidade: Campinas/SP'], 'o cadastro daqui vence a ficha (Campinas, não São Paulo)');
eq(mapa['Documentos de viagem'], ['Passaporte: FX1 · válido até 10/05/2031 · BR'], 'passaporte com validade e país');
eq(mapa['Família'], ['Cônjuge: Ana', 'Filho(a): Lia'], 'família vem da ficha do CRM');
eq(mapa['No CRM'], ['Responsável: Karen', 'Etiquetas: vip'], 'quem cuida no CRM e as etiquetas');
eq(secoesDaFicha({}).length, 0, 'cliente sem nada: nenhuma seção vazia');

console.log(`\n${total - falhas}/${total} testes da ficha e da comissão passaram`);
if (falhas > 0) process.exit(1);

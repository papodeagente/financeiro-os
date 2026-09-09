/**
 * Testes do cálculo da NFS-e (src/lib/nfse-calculo.ts).
 *
 * O que estes testes protegem é a regra que dá nome ao sistema: numa agência
 * de viagens o valor da venda não é receita da agência. Emitir nota de
 * R$ 20.000 quando a agência agenciou uma viagem de R$ 16.500 de fornecedores
 * faz a agência pagar ISS sobre dinheiro que só passou pela conta dela.
 *
 * Roda com: node --experimental-strip-types scripts/test-nfse.ts
 */
import {
  calcularNota,
  conflitosComEmissor,
  issEhEstimativa,
  regimeSugerido,
  montarDiscriminacao,
  pendenciasParaEmitir,
} from '../src/lib/nfse-calculo.ts';
import { codigoInterno, montarCorpoEmissao } from '../src/lib/nfse-acelera.ts';

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

const base = {
  regime: 'INTERMEDIACAO' as const,
  forma_base: 'VALOR_COMISSAO' as const,
  valor_recebido: 20000,
  valor_total_venda: 20000,
  custo_fornecedores: 16500,
  aliquota_iss: 2,
  iss_retido: false,
};

// ══════════════════════════════════════════════════════════════════════
console.log('--- a viagem de R$ 20.000 com R$ 16.500 de fornecedores ---');
{
  const r = calcularNota(base);
  eq(r.valor_servicos, 3500, 'a nota sai da comissão, não da venda');
  eq(r.base_calculo, 3500, 'a base do ISS é a comissão');
  eq(r.valor_iss, 70, 'ISS de 2% sobre 3.500');
  eq(r.comissao_da_parcela, 3500, 'comissão da parcela');
  eq(r.repasse_da_parcela, 16500, 'repasse aos fornecedores');
  eq(r.erros, [], 'nada impede a emissão');
}
{
  // O erro caro: emitir a mesma venda como prestação direta.
  const r = calcularNota({ ...base, regime: 'PRESTACAO_DIRETA' });
  eq(r.valor_servicos, 20000, 'prestação direta tributa o valor cheio');
  eq(r.base_calculo, 20000, 'base é o valor inteiro');
  eq(r.valor_iss, 400, 'ISS de 400 em vez de 70');
}
{
  // Os dois formatos de intermediação chegam à MESMA base. É o invariante.
  const comissao = calcularNota(base);
  const comDeducao = calcularNota({ ...base, forma_base: 'TOTAL_COM_DEDUCAO' });
  eq(comDeducao.valor_servicos, 20000, 'o documento mostra o valor cheio');
  eq(comDeducao.valor_deducoes, 16500, 'e o repasse como dedução');
  eq(comDeducao.base_calculo, comissao.base_calculo, 'a base é a mesma nos dois formatos');
  eq(comDeducao.valor_iss, comissao.valor_iss, 'e o ISS também');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- venda parcelada: cada recebimento leva sua fatia ---');
{
  // Mesma viagem, paga em duas parcelas de 10.000.
  const p1 = calcularNota({ ...base, valor_recebido: 10000 });
  const p2 = calcularNota({ ...base, valor_recebido: 10000 });
  eq(p1.valor_servicos, 1750, 'metade da comissão na primeira parcela');
  eq(p2.valor_servicos, 1750, 'e a outra metade na segunda');
  eq(p1.repasse_da_parcela, 8250, 'o repasse acompanha a proporção');
  eq(
    p1.valor_servicos + p2.valor_servicos,
    calcularNota(base).valor_servicos,
    'a soma das parcelas fecha com a nota única',
  );
}
{
  // Entrada de 30%: a comissão sai proporcional, não adiantada.
  const r = calcularNota({ ...base, valor_recebido: 6000 });
  eq(r.valor_servicos, 1050, '30% do recebimento carrega 30% da comissão');
  eq(r.repasse_da_parcela, 4950, 'e 30% do repasse');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- ISS retido pelo tomador ---');
{
  const r = calcularNota({ ...base, iss_retido: true });
  eq(r.valor_iss, 70, 'o ISS continua sendo 70');
  eq(r.valor_liquido, 3430, 'mas a agência recebe 3.430');
  eq(
    r.avisos.some(a => a.includes('retido')),
    true,
    'e o aviso explica por quê',
  );
}
{
  const r = calcularNota(base);
  eq(r.valor_liquido, 3500, 'sem retenção o líquido é o serviço inteiro');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- o que impede a nota de sair errada ---');
{
  // Custo maior que a venda: não há comissão a tributar.
  const r = calcularNota({ ...base, custo_fornecedores: 21000 });
  eq(r.erros.length > 0, true, 'venda no prejuízo não emite nota de intermediação');
  eq(r.valor_servicos, 0, 'e não inventa comissão');
  eq(r.base_calculo, 0, 'base zero, nunca negativa');
}
{
  // Custo igual à venda: mesma coisa.
  const r = calcularNota({ ...base, custo_fornecedores: 20000 });
  eq(r.erros.length > 0, true, 'margem zero também impede');
}
{
  // Intermediação sem valor de venda: não dá para separar comissão de repasse.
  const r = calcularNota({ ...base, valor_total_venda: 0 });
  eq(r.erros.length > 0, true, 'sem valor de venda a intermediação não fecha');
}
{
  // Venda sem custo lançado: avisa, mas deixa emitir.
  const r = calcularNota({ ...base, custo_fornecedores: 0 });
  eq(r.erros, [], 'não impede');
  eq(r.valor_servicos, 20000, 'a comissão vira o valor inteiro');
  eq(r.avisos.some(a => a.includes('custo de fornecedor')), true, 'mas avisa que falta o custo');
}
{
  const r = calcularNota({ ...base, valor_recebido: 0 });
  eq(r.erros.length > 0, true, 'recebimento zero não vira nota');
}
{
  const r = calcularNota({ ...base, aliquota_iss: 150 });
  eq(r.erros.some(e => e.includes('100%')), true, 'alíquota impossível é erro');
}
{
  const r = calcularNota({ ...base, aliquota_iss: 0 });
  eq(r.valor_iss, 0, 'alíquota zero não gera ISS');
  eq(r.avisos.some(a => a.includes('zerada')), true, 'e avisa');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- dedução e desconto nunca deixam a base negativa ---');
{
  const r = calcularNota({
    ...base,
    forma_base: 'TOTAL_COM_DEDUCAO',
    deducao_manual: 999999,
  });
  eq(r.valor_deducoes, 20000, 'dedução limitada ao valor do serviço');
  eq(r.base_calculo, 0, 'base fica zero, não negativa');
  eq(r.avisos.some(a => a.includes('limitada')), true, 'e o limite é avisado');
}
{
  const r = calcularNota({ ...base, desconto_incondicionado: 999999 });
  eq(r.base_calculo, 0, 'desconto também é limitado');
  eq(r.desconto_incondicionado, 3500, 'até zerar a base, nunca além');
}
{
  const r = calcularNota({ ...base, desconto_incondicionado: 500 });
  eq(r.base_calculo, 3000, 'desconto normal abate da base');
  eq(r.valor_iss, 60, 'e o ISS acompanha');
}
{
  // Dedução manual numa nota que já é da comissão seria contar duas vezes.
  const r = calcularNota({ ...base, deducao_manual: 16500 });
  eq(r.valor_deducoes, 0, 'a dedução é ignorada');
  eq(r.base_calculo, 3500, 'a base continua sendo a comissão');
  eq(r.avisos.some(a => a.includes('ignorada')), true, 'e o usuário fica sabendo');
}
{
  // Valor negativo em custo não vira crédito.
  const r = calcularNota({ ...base, custo_fornecedores: -5000 });
  eq(r.valor_servicos, 20000, 'custo negativo conta como zero');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- centavos ---');
{
  const r = calcularNota({
    ...base,
    valor_recebido: 3333.33,
    valor_total_venda: 10000,
    custo_fornecedores: 6666.67,
  });
  eq(r.valor_servicos, 1111.11, 'comissão proporcional arredondada a centavo');
  eq(r.repasse_da_parcela, 2222.22, 'repasse fecha com o recebido');
  eq(round(r.valor_servicos + r.repasse_da_parcela), 3333.33, 'comissão + repasse = parcela');
}
function round(n: number) { return Math.round(n * 100) / 100; }

// ══════════════════════════════════════════════════════════════════════
console.log('--- regime sugerido pela própria venda ---');
{
  eq(regimeSugerido(20000, 16500), 'INTERMEDIACAO', 'venda com fornecedor é agenciamento');
  eq(regimeSugerido(20000, 0), 'PRESTACAO_DIRETA', 'venda sem custo é serviço próprio');
  eq(regimeSugerido(0, 0), 'PRESTACAO_DIRETA', 'venda sem valor não é intermediação');
  eq(regimeSugerido(1000, 1000), 'PRESTACAO_DIRETA', 'sem margem não sugere intermediação');
  eq(regimeSugerido(1000, 1200), 'PRESTACAO_DIRETA', 'prejuízo também não');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- discriminação ---');
{
  eq(
    montarDiscriminacao('Agenciamento de viagem — {cliente} — venda {venda}', {
      cliente: 'Maria Silva',
      venda: 'VND-0001',
    }),
    'Agenciamento de viagem — Maria Silva — venda VND-0001',
    'preenche os campos',
  );
  eq(
    montarDiscriminacao('Serviço {inexistente} prestado', {}),
    'Serviço prestado',
    'placeholder desconhecido some sem deixar espaço duplo',
  );
  eq(montarDiscriminacao('', {}), '', 'modelo vazio não quebra');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- pendências antes de emitir ---');
const configOk = {
  provedor: 'plugnotas',
  temCertificado: true,
  certificadoValidoAte: '2027-01-01',
  hoje: '2026-09-09',
  item_lista_servico: '9.02',
  cnae: '7911200',
  aliquota_iss: 2,
  emitente_cnpj: '12345678000199',
  emitente_inscricao_municipal: '123456',
  tomador_documento: '11122233344',
  tomador_nome: 'Maria Silva',
};
{
  eq(pendenciasParaEmitir(configOk), [], 'configuração completa não tem pendência');
}
{
  const p = pendenciasParaEmitir({ ...configOk, temCertificado: false });
  eq(p.some(x => x.includes('certificado digital')), true, 'sem certificado, pendência');
}
{
  const p = pendenciasParaEmitir({ ...configOk, tomador_documento: '' });
  eq(p.some(x => x.includes('CPF ou CNPJ')), true, 'cliente sem documento impede');
}
{
  const p = pendenciasParaEmitir({ ...configOk, certificadoValidoAte: '2026-08-01' });
  eq(p.some(x => x.includes('venceu em 01/08/2026')), true, 'certificado vencido é dito com a data');
}
{
  const p = pendenciasParaEmitir({ ...configOk, provedor: '', item_lista_servico: '', cnae: '' });
  eq(p.length, 3, 'as pendências se acumulam, não param na primeira');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- o que o emissor aceita ---');
const NACIONAL = { deducoes: false, aliquota_por_nota: false, intermediario: false };
const COMPLETO = { deducoes: true, aliquota_por_nota: true, intermediario: true };
{
  // O padrão nacional não tem campo de dedução: o formato de valor cheio
  // precisa ser BLOQUEADO, nunca convertido em silêncio.
  const c = conflitosComEmissor({
    regime: 'INTERMEDIACAO',
    forma_base: 'TOTAL_COM_DEDUCAO',
    tem_intermediario: false,
    capacidades: NACIONAL,
  });
  eq(c.length, 1, 'valor cheio com dedução é conflito no padrão nacional');
  eq(c[0].includes('Troque para'), true, 'e a mensagem diz o que fazer');
}
{
  const c = conflitosComEmissor({
    regime: 'INTERMEDIACAO',
    forma_base: 'VALOR_COMISSAO',
    tem_intermediario: false,
    capacidades: NACIONAL,
  });
  eq(c, [], 'nota da comissão passa no padrão nacional');
}
{
  const c = conflitosComEmissor({
    regime: 'PRESTACAO_DIRETA',
    forma_base: 'TOTAL_COM_DEDUCAO',
    tem_intermediario: false,
    capacidades: NACIONAL,
  });
  eq(c, [], 'prestação direta não usa dedução, então não conflita');
}
{
  const c = conflitosComEmissor({
    regime: 'INTERMEDIACAO',
    forma_base: 'TOTAL_COM_DEDUCAO',
    tem_intermediario: false,
    capacidades: COMPLETO,
  });
  eq(c, [], 'emissor com dedução aceita os dois formatos');
}
{
  const c = conflitosComEmissor({
    regime: 'INTERMEDIACAO',
    forma_base: 'VALOR_COMISSAO',
    tem_intermediario: true,
    capacidades: NACIONAL,
  });
  eq(c.length, 1, 'intermediário sem suporte vira aviso');
  eq(c[0].includes('Troque para'), false, 'mas não bloqueia a emissão');
}
{
  eq(issEhEstimativa(NACIONAL), true, 'no padrão nacional o ISS da tela é estimativa');
  eq(issEhEstimativa(COMPLETO), false, 'com alíquota por nota, o número é o que vai');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- corpo da emissão na AceleraAPI ---');
const notaBase = {
  id: 'nota-abc-123',
  discriminacao: 'Agenciamento de viagem — Maria Silva',
  valor_servicos: 3500,
  valor_recebido: 20000,
  regime: 'INTERMEDIACAO' as const,
  emitida_em: '2026-09-09T12:00:00.000Z',
  tomador: {
    cpf_cnpj: '111.222.333-44',
    razao_social: 'Maria Silva',
    email: 'maria@exemplo.com',
    inscricao_municipal: '',
    endereco: {
      cep: '01310-100', logradouro: 'Av. Paulista', numero: '1000',
      complemento: '', bairro: 'Bela Vista', cidade: 'São Paulo', estado: 'SP',
    },
  },
};
const configBase = {
  cod_tributacao_nacional: '090201',
  cod_municipio_ibge: '3550308',
  info_complementar_padrao: '',
};
{
  const c = montarCorpoEmissao({
    nota: notaBase as never,
    config: configBase as never,
  });
  eq(c.valor_servico, 3500, 'o valor da nota é a comissão, não a venda');
  eq(c.tomador_documento, '11122233344', 'documento vai só com dígitos');
  eq(c.tomador_cep, '01310100', 'CEP também');
  eq(c.cod_tributacao_nacional, '090201', 'código de tributação nacional');
  eq(c.cod_municipio_prestacao, '3550308', 'município da prestação');
  eq(c.data_competencia, '2026-09-09', 'competência sai da data de emissão');
  eq(
    typeof c.info_complementar === 'string' && (c.info_complementar as string).includes('20000.00'),
    true,
    'o valor intermediado fica registrado no complemento',
  );
  eq('aliquota' in c, false, 'não manda alíquota: quem calcula é a prefeitura');
  eq('valor_deducoes' in c, false, 'não manda dedução: o padrão nacional não tem o campo');
}
{
  // Campo vazio não pode virar string vazia no corpo: a API valida formato.
  const semEndereco = {
    ...notaBase,
    tomador: { ...notaBase.tomador, email: '', endereco: {
      cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '',
    } },
  };
  const c = montarCorpoEmissao({ nota: semEndereco as never, config: configBase as never });
  eq('tomador_email' in c, false, 'e-mail vazio não vai no corpo');
  eq('tomador_cep' in c, false, 'CEP vazio também não');
  eq('tomador_logradouro' in c, false, 'nem o logradouro');
  eq(c.tomador_nome, 'Maria Silva', 'o obrigatório continua indo');
}
{
  // cod_interno é a trava anti-duplicata: no máximo 20 alfanuméricos, e
  // estável para a mesma nota.
  eq(codigoInterno('nota-abc-123'), 'notaabc123', 'tira o que não é alfanumérico');
  eq(codigoInterno('a'.repeat(40)).length, 20, 'corta em 20 caracteres');
  eq(codigoInterno('a'.repeat(40)), codigoInterno('a'.repeat(40)), 'é estável');
  eq(codigoInterno('---'), 'NOTA', 'id sem caractere válido ainda gera código');
}
{
  // Prestação direta manda o valor recebido inteiro.
  const direta = { ...notaBase, regime: 'PRESTACAO_DIRETA' as const, valor_servicos: 20000 };
  const c = montarCorpoEmissao({ nota: direta as never, config: configBase as never });
  eq(c.valor_servico, 20000, 'serviço próprio tributa o valor cheio');
  eq(
    typeof c.info_complementar === 'string' && (c.info_complementar as string).includes('Agenciamento'),
    false,
    'e não fala de agenciamento no complemento',
  );
}

// ══════════════════════════════════════════════════════════════════════
console.log(`\n${total - falhas}/${total} testes da nota fiscal passaram`);
if (falhas > 0) process.exit(1);

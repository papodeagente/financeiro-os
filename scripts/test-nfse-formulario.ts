/**
 * O formulário de emissão no desenho do Asaas (Bruno, 18/09/2026).
 *
 * O que estes testes guardam não é o layout: é o dinheiro e a honestidade da
 * tela. Retenção não encolhe a nota, dedução é figura do ISS e não das
 * federais, e campo que o emissor não transmite tem que ser declarado.
 */
import {
  formularioVazio,
  aplicarServico,
  valoresDaNota,
  validarFormulario,
  camposQueNaoViajam,
  problemaDoCampo,
  temErro,
  ISS_MAXIMO,
  type ServicoCadastrado,
} from '../src/lib/nfse-formulario.ts';

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

const servico: ServicoCadastrado = {
  id: 'sv1',
  codigo_tributacao: '09.02.01',
  cnae: '7911200',
  descricao: 'Agenciamento de viagens',
  aliquota_iss: 3,
  nbs: '1.1503.10.00',
  descricao_padrao: 'Serviço de agenciamento de viagens.',
};

{ // o serviço escolhido preenche código, CNAE e alíquota
    const f = aplicarServico(formularioVazio(), servico);
    eq(f.codigo_tributacao, '09.02.01', 'código de tributação');
    eq(f.cnae, '7911200', 'CNAE');
    eq(f.aliquota_iss, 3, 'alíquota');
    eq(f.descricao, 'Serviço de agenciamento de viagens.', 'descrição padrão');
}

{ // trocar de serviço NÃO apaga a descrição já escrita
    // Quem escreveu o texto da nota e depois corrigiu o serviço não pode
    // perder o trabalho: o digitado vence o padrão do cadastro.
    const f = { ...formularioVazio(), descricao: 'Consultoria do projeto X' };
    eq(aplicarServico(f, servico).descricao, 'Consultoria do projeto X', 'descrição preservada');
}

{ // serviço sem alíquota cadastrada não zera a que já estava
    const f = { ...formularioVazio(), aliquota_iss: 5 };
    const semAliquota = { ...servico, aliquota_iss: 0 };
    eq(aplicarServico(f, semAliquota).aliquota_iss, 5, 'alíquota preservada');
}

{ // RETENÇÃO NÃO ENCOLHE A NOTA: o valor emitido é o bruto
    // Abater retenção do valor da nota emitiria documento menor que a venda,
    // e a diferença viraria receita faltando na contabilidade do cliente.
    const v = valoresDaNota({
      valor_servicos: 237,
      form: { ...formularioVazio(), aliquota_iss: 3, aliquota_ir: 1.5, aliquota_inss: 11, deducoes: 0, tipo_recolhimento_iss: 'PRESTADOR' },
    });
    eq(v.valor_servicos, 237, 'valor da nota');
    eq(v.retencao_ir, 3.56, 'IR 1,5% de 237');
    eq(v.retencao_inss, 26.07, 'INSS 11% de 237');
    eq(v.iss_retido, 0, 'prestador recolhe: nada retido de ISS');
    eq(v.valor_liquido, 207.37, 'líquido = 237 − 3,56 − 26,07');
}

{ // com ISS retido pelo tomador, o ISS entra no total retido
    const v = valoresDaNota({
      valor_servicos: 1000,
      form: { ...formularioVazio(), aliquota_iss: 5, tipo_recolhimento_iss: 'TOMADOR', aliquota_inss: 0, aliquota_ir: 0, deducoes: 0 },
    });
    eq(v.valor_iss, 50, 'ISS');
    eq(v.iss_retido, 50, 'retido pelo tomador');
    eq(v.valor_liquido, 950, 'a empresa recebe 950');
}

{ // DEDUÇÃO é do ISS, não das federais
    // A base do ISS desconta a dedução; IRRF e INSS incidem sobre o serviço.
    const v = valoresDaNota({
      valor_servicos: 1000,
      form: { ...formularioVazio(), aliquota_iss: 5, deducoes: 400, aliquota_ir: 1.5, aliquota_inss: 0, tipo_recolhimento_iss: 'PRESTADOR' },
    });
    eq(v.base_calculo, 600, 'base do ISS com dedução');
    eq(v.valor_iss, 30, 'ISS sobre 600');
    eq(v.retencao_ir, 15, 'IR sobre os 1000, não sobre os 600');
}

{ // dedução maior que a nota é aparada, nunca gera base negativa
    const v = valoresDaNota({
      valor_servicos: 500,
      form: { ...formularioVazio(), deducoes: 900, aliquota_iss: 5 },
    });
    eq(v.deducoes, 500, 'dedução aparada no valor da nota');
    eq(v.base_calculo, 0, 'base zerada, nunca negativa');
}

{ // serviço é obrigatório, com a mesma mensagem da tela
    const form = formularioVazio();
    const p = validarFormulario({ form, valores: valoresDaNota({ valor_servicos: 100, form }), iss_e_estimativa: false });
    eq(problemaDoCampo(p, 'servico_id')?.mensagem, 'Este campo é obrigatório', 'mensagem do campo');
    eq(temErro(p), true, 'impede emitir');
}

{ // alíquota acima do teto constitucional AVISA, não bloqueia
    // Existem regimes especiais. Travar quem está certo seria pior que avisar.
    const form = { ...aplicarServico(formularioVazio(), servico), aliquota_iss: 7 };
    const p = validarFormulario({ form, valores: valoresDaNota({ valor_servicos: 100, form }), iss_e_estimativa: false });
    const aviso = problemaDoCampo(p, 'aliquota_iss');
    eq(aviso?.nivel, 'aviso', 'é aviso');
    eq(String(aviso?.mensagem).includes(`${ISS_MAXIMO}%`), true, 'cita o teto');
    eq(temErro(p), false, 'não impede emitir');
}

{ // quando o emissor calcula o ISS, a alíquota não é criticada
    // No padrão nacional quem calcula é a prefeitura: criticar um número que
    // nem viaja só assustaria o usuário à toa.
    const form = { ...aplicarServico(formularioVazio(), servico), aliquota_iss: 7 };
    const p = validarFormulario({ form, valores: valoresDaNota({ valor_servicos: 100, form }), iss_e_estimativa: true });
    eq(problemaDoCampo(p, 'aliquota_iss'), null, 'sem crítica');
}

{ // a reforma tributária não aceita meia resposta
    const base = aplicarServico(formularioVazio(), servico);
    const so_cst = { ...base, cst: '00' };
    const p1 = validarFormulario({ form: so_cst, valores: valoresDaNota({ valor_servicos: 100, form: so_cst }), iss_e_estimativa: false });
    eq(problemaDoCampo(p1, 'classificacao_tributaria')?.nivel, 'erro', 'CST sem classificação');

    const so_class = { ...base, classificacao_tributaria: '000001' };
    const p2 = validarFormulario({ form: so_class, valores: valoresDaNota({ valor_servicos: 100, form: so_class }), iss_e_estimativa: false });
    eq(problemaDoCampo(p2, 'cst')?.nivel, 'erro', 'classificação sem CST');

    const nenhum = validarFormulario({ form: base, valores: valoresDaNota({ valor_servicos: 100, form: base }), iss_e_estimativa: false });
    eq(problemaDoCampo(nenhum, 'cst'), null, 'os dois vazios seguem válidos');
}

{ // retenção maior que a nota é erro, não aviso
    const form = { ...aplicarServico(formularioVazio(), servico), aliquota_inss: 90, aliquota_ir: 30 };
    const valores = valoresDaNota({ valor_servicos: 100, form });
    const p = validarFormulario({ form, valores, iss_e_estimativa: false });
    eq(problemaDoCampo(p, 'retencoes')?.nivel, 'erro', 'bloqueia');
}

{ // A TELA DIZ o que não chega na prefeitura
    // O ponto inteiro do módulo: nada é coletado em silêncio.
    const form = {
      ...aplicarServico(formularioVazio(), servico),
      cst: '00', classificacao_tributaria: '000001', aliquota_ir: 1.5, deducoes: 100,
    };
    const nacional = camposQueNaoViajam({ form, capacidades: { deducoes: false, aliquota_por_nota: false } });
    eq(nacional.includes('Código NBS'), true, 'NBS');
    eq(nacional.includes('Reforma tributária (CST, classificação e indicador)'), true, 'reforma');
    eq(nacional.includes('Retenção de IR'), true, 'IR');
    eq(nacional.includes('Deduções'), true, 'dedução no padrão nacional');
    eq(nacional.includes('Alíquota do ISS'), true, 'alíquota no padrão nacional');

    const plugnotas = camposQueNaoViajam({ form, capacidades: { deducoes: true, aliquota_por_nota: true } });
    eq(plugnotas.includes('Deduções'), false, 'PlugNotas aceita dedução');
    eq(plugnotas.includes('Alíquota do ISS'), false, 'PlugNotas aceita alíquota');
}

{ // formulário limpo não acusa nada que não foi preenchido
    const vazio = formularioVazio();
    eq(camposQueNaoViajam({ form: vazio, capacidades: { deducoes: false, aliquota_por_nota: false } }), [], 'nada a declarar');
}

console.log(`\n${total - falhas}/${total} testes do formulário da nota passaram`);
if (falhas > 0) process.exit(1);

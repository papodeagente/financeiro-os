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
  blocosDisponiveis,
  limparIndisponiveis,
  opcoesTransmissiveis,
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

/** O emissor mais restritivo: é o pressuposto quando nada foi configurado. */
const TUDO_FECHADO = {
  deducoes: false, aliquota_por_nota: false,
  retencao_fonte: false, reforma_tributaria: false, nbs: false,
};
const TUDO_ABERTO = {
  deducoes: true, aliquota_por_nota: true,
  retencao_fonte: true, reforma_tributaria: true, nbs: true,
};

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
    const nacional = camposQueNaoViajam({ form, capacidades: TUDO_FECHADO });
    eq(nacional.includes('Código NBS'), true, 'NBS');
    eq(nacional.includes('Reforma tributária (CST, classificação e indicador)'), true, 'reforma');
    eq(nacional.includes('Retenção de IR'), true, 'IR');
    eq(nacional.includes('Deduções'), true, 'dedução no padrão nacional');
    // A alíquota NÃO entra nesta lista: ela vira campo somente leitura com a
    // própria explicação. Ver o comentário em camposQueNaoViajam.
    eq(nacional.includes('Alíquota do ISS'), false, 'alíquota não é "coletada em silêncio"');

    const plugnotas = camposQueNaoViajam({ form, capacidades: { ...TUDO_FECHADO, deducoes: true, aliquota_por_nota: true } });
    eq(plugnotas.includes('Deduções'), false, 'PlugNotas aceita dedução');
    eq(plugnotas.includes('Alíquota do ISS'), false, 'PlugNotas aceita alíquota');
    eq(plugnotas.includes('Retenção de IR'), true, 'PlugNotas ainda não transmite retenção');
}

{ // formulário limpo não acusa nada que não foi preenchido
    const vazio = formularioVazio();
    eq(camposQueNaoViajam({ form: vazio, capacidades: TUDO_FECHADO }), [], 'nada a declarar');
}

{ // CAMPO QUE NÃO VIAJA FICA FECHADO, não aberto com aviso
  // É a regra que tira o risco do usuário: bloco aberto que não é transmitido
  // faz o tomador reter tributo sobre nota que não registra retenção, e reduz
  // a base do ISS só na tela.
  const d = blocosDisponiveis(TUDO_FECHADO);
  eq([d.nbs.liberado, d.reforma.liberado, d.retencao.liberado, d.deducoes.liberado, d.aliquota_iss.liberado],
     [false, false, false, false, false], 'emissor restritivo fecha todos os blocos');
  for (const bloco of ['nbs', 'reforma', 'retencao', 'deducoes', 'aliquota_iss'] as const) {
    eq(d[bloco].motivo.length > 40, true, `${bloco} explica o motivo, não só some`);
  }
  const a = blocosDisponiveis(TUDO_ABERTO);
  eq([a.nbs.liberado, a.reforma.liberado, a.retencao.liberado, a.deducoes.liberado, a.aliquota_iss.liberado],
     [true, true, true, true, true], 'emissor completo abre todos');
}

{ // O INVARIANTE: depois de limpar, NADA fica preenchido sem ser transmitido
  const cheio = {
    ...aplicarServico(formularioVazio(), servico),
    cst: '000', classificacao_tributaria: '000001', indicador_operacao: '1',
    aliquota_inss: 11, aliquota_ir: 1.5, deducoes: 300, nbs: '1.1503.10.00',
  };
  const limpo = limparIndisponiveis(cheio, TUDO_FECHADO);
  eq(camposQueNaoViajam({ form: limpo, capacidades: TUDO_FECHADO }), [],
     'nada sobra preenchido que o emissor não transmite');
  eq([limpo.cst, limpo.classificacao_tributaria, limpo.indicador_operacao, limpo.nbs], ['', '', '', ''],
     'reforma e NBS zerados');
  eq([limpo.aliquota_inss, limpo.aliquota_ir, limpo.deducoes], [0, 0, 0], 'retenções e dedução zeradas');
  // A alíquota do ISS NÃO é zerada: ela continua sendo a estimativa exibida.
  eq(limpo.aliquota_iss, 3, 'a alíquota segue visível como estimativa');
}

{ // Trocar de emissor com o formulário aberto não deixa resíduo
  const cheio = { ...aplicarServico(formularioVazio(), servico), aliquota_ir: 1.5, deducoes: 300 };
  const noAberto = limparIndisponiveis(cheio, TUDO_ABERTO);
  eq([noAberto.aliquota_ir, noAberto.deducoes], [1.5, 300], 'emissor completo preserva');
  const depoisDaTroca = limparIndisponiveis(noAberto, TUDO_FECHADO);
  eq([depoisDaTroca.aliquota_ir, depoisDaTroca.deducoes], [0, 0], 'a troca zera o que não viaja mais');
}

{ // O que é do serviço permanece: fechar bloco não pode apagar a nota
  const f = aplicarServico(formularioVazio(), servico);
  const limpo = limparIndisponiveis(f, TUDO_FECHADO);
  eq([limpo.codigo_tributacao, limpo.cnae, limpo.descricao],
     [f.codigo_tributacao, f.cnae, f.descricao], 'serviço, CNAE e descrição intactos');
}

{ // A MESMA TRAVA DO LADO DA API: a tela não é a garantia
  // A API é chamada por integração, script e curl. Fechar o bloco no
  // navegador protege o distraído; isto protege o sistema.
  const pedido = {
    codigo_nbs: '1.1503.10.00', cst: '000', classificacao_tributaria: '000001',
    indicador_operacao: '1', aliquota_inss: 11, aliquota_ir: 1.5, deducao_manual: 300,
  };
  const seguro = opcoesTransmissiveis(pedido, TUDO_FECHADO);
  eq(seguro.codigo_nbs, undefined, 'NBS descartado');
  eq([seguro.cst, seguro.classificacao_tributaria, seguro.indicador_operacao],
     [undefined, undefined, undefined], 'reforma descartada');
  eq([seguro.aliquota_inss, seguro.aliquota_ir], [0, 0], 'retenções zeradas');
  eq(seguro.deducao_manual, null, 'dedução descartada');

  const completo = opcoesTransmissiveis(pedido, TUDO_ABERTO);
  eq(completo.deducao_manual, 300, 'emissor completo preserva a dedução');
  eq(completo.aliquota_inss, 11, 'emissor completo preserva a retenção');
}

console.log(`\n${total - falhas}/${total} testes do formulário da nota passaram`);
if (falhas > 0) process.exit(1);

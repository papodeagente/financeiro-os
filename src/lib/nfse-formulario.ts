/**
 * O FORMULÁRIO DE EMISSÃO DA NOTA, no formato que o Bruno pediu em 18/09/2026:
 * o mesmo desenho do Asaas.
 *
 * O que esse desenho acerta, e por isso vale copiar: o obrigatório fica em
 * cima e cabe em uma tela (serviço, descrição, quem recolhe o ISS, alíquota),
 * e todo o resto vive em blocos recolhidos marcados "(Opcional)". Quem emite
 * a mesma nota toda semana não vê o que não usa; quem precisa de retenção na
 * fonte ou dos campos da reforma tributária abre o bloco e acha.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A PARTE QUE O FORMULÁRIO SOZINHO NÃO RESOLVE
 * ────────────────────────────────────────────────────────────────────────────
 * Campo bonito que não chega na prefeitura é pior que campo ausente: o
 * usuário preenche, confia, e a nota sai sem aquilo. Por isso cada campo aqui
 * declara se ele VIAJA (vai no XML da nota) ou se fica GUARDADO no sistema
 * até o emissor passar a aceitá-lo. `camposQueNaoViajam` é o que a tela usa
 * para dizer isso na cara do usuário, em vez de fingir conformidade.
 *
 * Hoje, com os dois emissores que o sistema fala:
 *   - AceleraAPI (padrão nacional): não aceita dedução, nem alíquota por
 *     nota, nem retenção, nem os campos da reforma. Quem calcula o ISS é a
 *     prefeitura, a partir do código de tributação.
 *   - PlugNotas: aceita dedução e alíquota por nota.
 *
 * Só cálculo e validação: nada de banco, nada de rede.
 */
import { num, percentual, round2 } from './money';

/** Quem recolhe o ISS. É a mesma pergunta que o campo `iss_retido` responde. */
export type TipoRecolhimentoISS = 'PRESTADOR' | 'TOMADOR';

/** Um serviço do catálogo da empresa, cadastrado em Configurações. */
export interface ServicoCadastrado {
  id: string;
  /** Código de tributação nacional, o item da LC 116. Ex.: "01.01.01". */
  codigo_tributacao: string;
  /** CNAE da atividade. Ex.: "6201501". */
  cnae: string;
  descricao: string;
  /** Em %, por exemplo 2 para 2%. */
  aliquota_iss: number;
  /** Código NBS, usado em serviço exportado. Opcional. */
  nbs?: string;
  /** Texto que entra sozinho na descrição da nota. */
  descricao_padrao?: string;
}

export interface FormularioNota {
  /** Id do serviço cadastrado, ou "" quando veio da lista nacional. */
  servico_id: string;
  codigo_tributacao: string;
  cnae: string;
  nbs: string;
  descricao: string;
  tipo_recolhimento_iss: TipoRecolhimentoISS;
  /** Em %, por exemplo 2 para 2%. */
  aliquota_iss: number;

  // ── Reforma tributária (LC 214/2025). Opcional enquanto não obriga. ──
  cst: string;
  classificacao_tributaria: string;
  indicador_operacao: string;

  // ── Retenção na fonte: o que o TOMADOR retém e recolhe no lugar. ──
  aliquota_inss: number;
  aliquota_ir: number;

  // ── Outras deduções e observações. ──
  deducoes: number;
  observacoes: string;
}

export function formularioVazio(): FormularioNota {
  return {
    servico_id: '',
    codigo_tributacao: '',
    cnae: '',
    nbs: '',
    descricao: '',
    tipo_recolhimento_iss: 'PRESTADOR',
    aliquota_iss: 0,
    cst: '',
    classificacao_tributaria: '',
    indicador_operacao: '',
    aliquota_inss: 0,
    aliquota_ir: 0,
    deducoes: 0,
    observacoes: '',
  };
}

/**
 * Aplica um serviço escolhido ao formulário.
 *
 * Preenche o que o serviço sabe e NÃO apaga o que a pessoa já escreveu: a
 * descrição digitada à mão vence a descrição padrão do cadastro. Trocar de
 * serviço no meio do preenchimento não pode custar o texto já escrito.
 */
export function aplicarServico(form: FormularioNota, servico: ServicoCadastrado): FormularioNota {
  return {
    ...form,
    servico_id: servico.id,
    codigo_tributacao: servico.codigo_tributacao,
    cnae: servico.cnae,
    nbs: form.nbs || servico.nbs || '',
    descricao: form.descricao || servico.descricao_padrao || servico.descricao || '',
    aliquota_iss: aliquotaValida(servico.aliquota_iss) ? round2(num(servico.aliquota_iss)) : form.aliquota_iss,
  };
}

function aliquotaValida(v: unknown): boolean {
  const n = num(v);
  return Number.isFinite(n) && n > 0;
}

export interface ValoresDaNota {
  /** O que vai no campo de valor do serviço. É o bruto. */
  valor_servicos: number;
  deducoes: number;
  base_calculo: number;
  valor_iss: number;
  /** ISS que o TOMADOR retém. Zero quando o prestador recolhe. */
  iss_retido: number;
  retencao_inss: number;
  retencao_ir: number;
  total_retido: number;
  /** O que a empresa efetivamente recebe depois de tudo que foi retido. */
  valor_liquido: number;
}

/**
 * Os números da nota a partir do valor da cobrança.
 *
 * Duas decisões que valem registro:
 *
 *  1. **O valor da NOTA é o bruto, não o líquido.** Retenção não diminui a
 *     nota: ela muda quem recolhe o tributo. Abater a retenção do valor da
 *     nota emitiria documento de valor menor que a venda, e a diferença
 *     apareceria como receita faltando na contabilidade do cliente.
 *  2. **A base do ISS desconta a dedução; a das retenções federais, não.**
 *     Dedução é figura do ISS municipal (materiais, subempreitada, repasse em
 *     agenciamento). IRRF e INSS incidem sobre o valor do serviço.
 */
export function valoresDaNota(entrada: {
  valor_servicos: number;
  form: Pick<FormularioNota, 'aliquota_iss' | 'tipo_recolhimento_iss' | 'aliquota_inss' | 'aliquota_ir' | 'deducoes'>;
}): ValoresDaNota {
  const bruto = round2(Math.max(0, num(entrada.valor_servicos)));
  const deducoes = round2(Math.min(bruto, Math.max(0, num(entrada.form.deducoes))));
  const base = round2(bruto - deducoes);

  const valorIss = percentual(base, Math.max(0, num(entrada.form.aliquota_iss)));
  const issRetido = entrada.form.tipo_recolhimento_iss === 'TOMADOR' ? valorIss : 0;

  const inss = percentual(bruto, Math.max(0, num(entrada.form.aliquota_inss)));
  const ir = percentual(bruto, Math.max(0, num(entrada.form.aliquota_ir)));

  const totalRetido = round2(issRetido + inss + ir);
  return {
    valor_servicos: bruto,
    deducoes,
    base_calculo: base,
    valor_iss: valorIss,
    iss_retido: issRetido,
    retencao_inss: inss,
    retencao_ir: ir,
    total_retido: totalRetido,
    valor_liquido: round2(bruto - totalRetido),
  };
}

export interface ProblemaDoCampo {
  campo: keyof FormularioNota | 'retencoes';
  /** `erro` impede a emissão; `aviso` só alerta. */
  nivel: 'erro' | 'aviso';
  mensagem: string;
}

/**
 * O teto e o piso do ISS não são opinião: são a Constituição.
 *
 * Alíquota máxima de 5% (art. 8º, II da LC 116) e mínima de 2% (art. 8º-A,
 * incluído pela LC 157/2016). Fora dessa faixa não é erro de digitação
 * qualquer: é nota que a prefeitura recusa, ou pior, aceita e vira
 * autuação. Aqui isso é AVISO, não bloqueio — existem regimes especiais e
 * municípios com isenção, e travar a emissão de quem está certo seria pior.
 */
export const ISS_MINIMO = 2;
export const ISS_MAXIMO = 5;

export function validarFormulario(entrada: {
  form: FormularioNota;
  valores: ValoresDaNota;
  /** O emissor calcula o ISS sozinho? Então a alíquota aqui é estimativa. */
  iss_e_estimativa: boolean;
}): ProblemaDoCampo[] {
  const { form, valores } = entrada;
  const problemas: ProblemaDoCampo[] = [];
  const add = (campo: ProblemaDoCampo['campo'], nivel: ProblemaDoCampo['nivel'], mensagem: string) =>
    problemas.push({ campo, nivel, mensagem });

  // Sem serviço não há como a prefeitura saber o que foi prestado.
  if (!String(form.codigo_tributacao ?? '').trim()) {
    add('servico_id', 'erro', 'Este campo é obrigatório');
  }

  if (!String(form.descricao ?? '').trim()) {
    add('descricao', 'erro', 'Descreva o serviço prestado. É o que o cliente lê na nota.');
  }

  const aliq = num(form.aliquota_iss);
  if (!entrada.iss_e_estimativa) {
    if (aliq > ISS_MAXIMO) {
      add('aliquota_iss', 'aviso', `A alíquota máxima do ISS é ${ISS_MAXIMO}% (LC 116, art. 8º). Confirme com a contabilidade.`);
    } else if (aliq > 0 && aliq < ISS_MINIMO) {
      add('aliquota_iss', 'aviso', `A alíquota mínima do ISS é ${ISS_MINIMO}% (LC 157/2016), salvo regime especial.`);
    } else if (aliq === 0 && form.tipo_recolhimento_iss === 'PRESTADOR') {
      add('aliquota_iss', 'aviso', 'Alíquota zero emite nota sem ISS. Só está certo se a empresa for isenta ou imune.');
    }
  }

  // A reforma tributária tem duas metades que não andam separadas: a
  // classificação existe DENTRO de uma situação tributária.
  if (form.classificacao_tributaria && !form.cst) {
    add('cst', 'erro', 'Escolha a situação tributária antes da classificação.');
  }
  if (form.cst && !form.classificacao_tributaria) {
    add('classificacao_tributaria', 'erro', 'Com a situação tributária preenchida, a classificação também é exigida.');
  }

  // Retenção maior que a nota deixaria a empresa recebendo valor negativo.
  if (valores.total_retido > valores.valor_servicos) {
    add('retencoes', 'erro', 'As retenções somam mais que o valor da nota. Revise as alíquotas.');
  }

  if (valores.deducoes > 0 && valores.deducoes >= valores.valor_servicos) {
    add('deducoes', 'aviso', 'A dedução consome o valor inteiro da nota: a base do ISS fica zerada.');
  }

  return problemas;
}

export function temErro(problemas: ProblemaDoCampo[]): boolean {
  return problemas.some(p => p.nivel === 'erro');
}

export function problemaDoCampo(
  problemas: ProblemaDoCampo[],
  campo: ProblemaDoCampo['campo'],
): ProblemaDoCampo | null {
  return problemas.find(p => p.campo === campo) ?? null;
}

export interface CapacidadesDoEmissor {
  deducoes: boolean;
  aliquota_por_nota: boolean;
  retencao_fonte: boolean;
  reforma_tributaria: boolean;
  nbs: boolean;
}

export type BlocoDoFormulario = 'aliquota_iss' | 'nbs' | 'reforma' | 'retencao' | 'deducoes';

export interface Disponibilidade {
  liberado: boolean;
  /** Por que está fechado. Texto que a tela mostra no lugar dos campos. */
  motivo: string;
}

/**
 * O QUE O FORMULÁRIO PODE OFERECER, dado o emissor configurado.
 *
 * Esta é a regra que torna a tela segura, e ela é o contrário da intuição:
 * campo que o emissor NÃO transmite não fica editável com um aviso, fica
 * FECHADO.
 *
 * O motivo é jurídico, não estético. Retenção na fonte declarada no
 * formulário e ausente da nota não é um aviso ignorado: é o tomador retendo
 * tributo sobre um documento que não registra retenção, e os dois lados
 * divergindo na apuração. Dedução preenchida e não enviada reduz a base do
 * ISS só na tela, e a nota sai com imposto maior do que o usuário viu.
 * Código da reforma tributária digitado à mão, sem tabela oficial para
 * validar e sem transmissão, é informação fiscal inventada guardada como se
 * fosse declarada.
 *
 * Em todos esses casos, deixar preencher transfere para o usuário um risco
 * que ele não tem como enxergar. Fechar o bloco e dizer o porquê devolve a
 * decisão para onde ela pertence: a escolha do emissor, em Configurações.
 */
export function blocosDisponiveis(c: CapacidadesDoEmissor): Record<BlocoDoFormulario, Disponibilidade> {
  const semEmissor = (o_que: string) =>
    `O emissor configurado não transmite ${o_que}. O campo fica fechado para a nota não sair diferente do que você vê aqui. Troque o emissor em Configurações, Notas fiscais.`;

  return {
    aliquota_iss: c.aliquota_por_nota
      ? { liberado: true, motivo: '' }
      : {
        liberado: false,
        motivo:
          'Neste emissor quem calcula o ISS é a prefeitura, a partir do código de tributação do serviço. O valor ao lado é a alíquota cadastrada no serviço, mostrada para conferência.',
      },
    nbs: c.nbs ? { liberado: true, motivo: '' } : { liberado: false, motivo: semEmissor('o código NBS') },
    reforma: c.reforma_tributaria
      ? { liberado: true, motivo: '' }
      : {
        liberado: false,
        motivo:
          'Os campos da reforma tributária ainda não são transmitidos por este emissor, e os códigos oficiais de CST e cClassTrib não estão publicados no sistema. Preencher aqui guardaria informação fiscal sem validação e sem envio, então o bloco fica fechado até as duas coisas existirem.',
      },
    retencao: c.retencao_fonte
      ? { liberado: true, motivo: '' }
      : {
        liberado: false,
        motivo:
          'Este emissor não declara retenção na fonte na nota. Preencher aqui faria o tomador reter tributo sobre um documento que não registra a retenção, e os dois lados divergiriam na apuração. Para reter, use um emissor que transmita o campo.',
      },
    deducoes: c.deducoes
      ? { liberado: true, motivo: '' }
      : {
        liberado: false,
        motivo:
          'Este emissor não aceita dedução por nota. O valor digitado reduziria a base do ISS só na tela, e a nota sairia com imposto maior do que você viu.',
      },
  };
}

/**
 * Zera o que o emissor não transmite, ANTES de calcular e de gravar.
 *
 * É a rede de segurança para o caminho que a tela não cobre: formulário que
 * ficou aberto enquanto alguém trocou o emissor noutra aba, valor que veio da
 * prévia, chamada direta da API. Sem ela, um número preenchido num emissor
 * capaz sobreviveria à troca para um emissor que não envia aquele campo.
 */
export function limparIndisponiveis(form: FormularioNota, c: CapacidadesDoEmissor): FormularioNota {
  const d = blocosDisponiveis(c);
  return {
    ...form,
    nbs: d.nbs.liberado ? form.nbs : '',
    cst: d.reforma.liberado ? form.cst : '',
    classificacao_tributaria: d.reforma.liberado ? form.classificacao_tributaria : '',
    indicador_operacao: d.reforma.liberado ? form.indicador_operacao : '',
    aliquota_inss: d.retencao.liberado ? form.aliquota_inss : 0,
    aliquota_ir: d.retencao.liberado ? form.aliquota_ir : 0,
    deducoes: d.deducoes.liberado ? form.deducoes : 0,
  };
}

/**
 * Quais campos preenchidos NÃO chegam na prefeitura com o emissor atual.
 *
 * É a função mais importante deste arquivo. Sem ela o formulário viraria o
 * que existe de pior em software fiscal: uma tela completa, de aparência
 * profissional, que coleta dados e descarta metade em silêncio. Quem
 * preenche retenção de IRRF e vê a nota sair sem ela descobre no acerto com
 * o contador, meses depois.
 *
 * Devolve os rótulos como aparecem na tela, para a mensagem ser reconhecível.
 */
export function camposQueNaoViajam(entrada: {
  form: FormularioNota;
  capacidades: CapacidadesDoEmissor;
}): string[] {
  const { form, capacidades } = entrada;
  const fora: string[] = [];

  if (String(form.nbs ?? '').trim()) fora.push('Código NBS');
  if (form.cst || form.classificacao_tributaria || form.indicador_operacao) {
    fora.push('Reforma tributária (CST, classificação e indicador)');
  }
  if (num(form.aliquota_inss) > 0) fora.push('Retenção de INSS');
  if (num(form.aliquota_ir) > 0) fora.push('Retenção de IR');
  if (num(form.deducoes) > 0 && !capacidades.deducoes) fora.push('Deduções');

  // A ALÍQUOTA DO ISS NÃO ENTRA NESTA LISTA, de propósito.
  //
  // Ela não é dado coletado em silêncio: quando a prefeitura é quem calcula, o
  // campo fica somente leitura e diz isso ali mesmo, como estimativa vinda do
  // serviço cadastrado. Repetir aqui, na tarja do que não é transmitido,
  // mandaria a mensagem contrária à do próprio campo — e faria o invariante
  // "depois de limpar, nada sobra" ser impossível de cumprir.

  return fora;
}

/** O recorte de opções de emissão que esta trava conhece. */
export interface OpcoesTransmissiveis {
  codigo_nbs?: string;
  cst?: string;
  classificacao_tributaria?: string;
  indicador_operacao?: string;
  aliquota_inss?: number;
  aliquota_ir?: number;
  deducao_manual?: number | null;
}

/**
 * A MESMA REGRA DE `limparIndisponiveis`, do lado do servidor.
 *
 * Existe separada porque o formulário é da tela e as opções são da API, e a
 * API é chamada por quem quiser: integração, script, curl. Fechar o bloco no
 * navegador protege o usuário distraído; esta função protege o sistema.
 *
 * Vive no módulo puro, e não dentro do serviço que fala com o banco, para
 * poder ser testada sem Postgres — a regra é de conformidade fiscal, e regra
 * assim não pode depender de um teste de integração para ser verificada.
 */
export function opcoesTransmissiveis<T extends OpcoesTransmissiveis>(
  opcoes: T,
  c: Pick<CapacidadesDoEmissor, 'deducoes' | 'retencao_fonte' | 'reforma_tributaria' | 'nbs'>,
): T {
  return {
    ...opcoes,
    codigo_nbs: c.nbs ? opcoes.codigo_nbs : undefined,
    cst: c.reforma_tributaria ? opcoes.cst : undefined,
    classificacao_tributaria: c.reforma_tributaria ? opcoes.classificacao_tributaria : undefined,
    indicador_operacao: c.reforma_tributaria ? opcoes.indicador_operacao : undefined,
    aliquota_inss: c.retencao_fonte ? opcoes.aliquota_inss : 0,
    aliquota_ir: c.retencao_fonte ? opcoes.aliquota_ir : 0,
    deducao_manual: c.deducoes ? opcoes.deducao_manual : null,
  };
}

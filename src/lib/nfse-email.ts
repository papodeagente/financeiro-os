/**
 * Enviar a nota fiscal por e-mail ao cliente.
 *
 * QUEM ENVIA NÃO SOMOS NÓS. O sistema não tem servidor de e-mail, e montar um
 * só para isto significaria domínio verificado, SPF/DKIM e uma reputação de
 * envio para cuidar — para depois entregar o mesmo PDF e o mesmo XML que o
 * emissor já entrega. Então o pedido viaja na própria nota (`enviarEmail`, na
 * raiz do payload) e quem despacha é o emissor, depois que a prefeitura
 * autoriza.
 *
 * Isso tem três consequências que a tela precisa dizer, e que esta regra
 * existe para deixar explícitas:
 *
 *  1. Sem e-mail no tomador não há para onde enviar. A opção fica FECHADA,
 *     como todo campo que não viaja neste módulo — e não marcada com um aviso
 *     que ninguém lê.
 *  2. O e-mail sai na AUTORIZAÇÃO, não no envio. Nota que ficou em
 *     processamento, ou que foi rejeitada, não gera e-mail nenhum.
 *  3. Desmarcar NÃO é garantia de que nada sai: a conta do emissor pode estar
 *     configurada para enviar sempre, e essa chave fica do lado dele, fora
 *     deste sistema. Prometer "não envia" seria prometer o que não
 *     controlamos.
 */

/**
 * Forma plausível de e-mail.
 *
 * DELIBERADAMENTE FROUXO. O objetivo é pegar o campo vazio, o nome digitado
 * sem arroba e o espaço no meio — não arbitrar o que é endereço válido.
 * Validação estrita aqui rejeitaria endereços legítimos (apelido com `+`,
 * domínio novo, acento) e o custo do falso negativo é alto: a pessoa fica sem
 * conseguir mandar a nota para um e-mail que funciona.
 */
export function emailPlausivel(valor: string | null | undefined): boolean {
  const e = String(valor ?? '').trim();
  if (e.length < 5 || /\s/.test(e)) return false;
  const partes = e.split('@');
  if (partes.length !== 2) return false;
  const [local, dominio] = partes;
  if (local.length === 0 || dominio.length < 3) return false;
  if (!dominio.includes('.')) return false;
  if (dominio.startsWith('.') || dominio.endsWith('.') || dominio.includes('..')) return false;
  return true;
}

/**
 * Por que está fechado.
 *
 * A tela usa isto para mandar a pessoa ao lugar CERTO: o emissor se resolve
 * em Configurações, o e-mail se resolve no cadastro do cliente. Um link só
 * para os dois casos manda metade das pessoas para a tela errada.
 */
export type CausaDoBloqueio = 'emissor' | 'sem-email' | 'email-invalido';

export interface DisponibilidadeDoEnvio {
  liberado: boolean;
  /** Vazio quando liberado. Texto pronto para a tela quando fechado. */
  motivo: string;
  causa: CausaDoBloqueio | null;
}

/**
 * A opção pode ser oferecida?
 *
 * Mesma regra do resto do formulário (ver `blocosDisponiveis`): o que não
 * viaja fica fechado, com o motivo escrito.
 */
export function disponibilidadeDoEnvio(entrada: {
  /** O emissor configurado transmite o pedido de envio. */
  emissorEnvia: boolean;
  /** E-mail gravado no tomador da nota. */
  emailDoTomador: string | null | undefined;
}): DisponibilidadeDoEnvio {
  if (!entrada.emissorEnvia) {
    return {
      liberado: false,
      causa: 'emissor',
      motivo:
        'O emissor configurado não envia a nota por e-mail. A opção fica fechada para a tela não '
        + 'prometer um envio que não acontece. Troque o emissor em Configurações, Notas fiscais.',
    };
  }
  const email = String(entrada.emailDoTomador ?? '').trim();
  if (!email) {
    return {
      liberado: false,
      causa: 'sem-email',
      motivo:
        'Este cliente não tem e-mail no cadastro, então não há para onde enviar. Preencha o e-mail '
        + 'no cadastro do cliente e abra a emissão de novo.',
    };
  }
  if (!emailPlausivel(email)) {
    return {
      liberado: false,
      causa: 'email-invalido',
      motivo:
        `O e-mail do cliente ("${email}") não tem forma de endereço. Corrija no cadastro do cliente `
        + 'e abra a emissão de novo.',
    };
  }
  return { liberado: true, motivo: '', causa: null };
}

/**
 * O que dizer ao usuário sobre o que vai acontecer.
 *
 * Uma frase, no futuro do indicativo, sem promessa que não se sustenta: o
 * envio depende da AUTORIZAÇÃO, e o silêncio não é garantido.
 */
export function resumoDoEnvio(entrada: {
  pedido: boolean;
  emailDoTomador: string | null | undefined;
}): string {
  const email = String(entrada.emailDoTomador ?? '').trim();
  if (entrada.pedido) {
    return `Assim que a prefeitura autorizar, o emissor manda o PDF e o XML para ${email}.`;
  }
  // Não dizemos "nada será enviado": a conta do emissor pode estar
  // configurada para enviar sempre, e essa chave não está neste sistema.
  return 'Não vamos pedir o envio. Se a conta do emissor estiver configurada para enviar sempre, '
    + 'o e-mail sai mesmo assim.';
}

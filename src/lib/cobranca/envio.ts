/**
 * Envio da cobrança com cópia e texto próprios (E7, 06/11/2026). Puro.
 *
 * O pedido de envio (`COBRANCA_ENVIAR`) pode levar, além do canal:
 *   · `copia_para`: até 5 e-mails que recebem uma cópia (o financeiro do
 *     cliente, o aprovador);
 *   · `assunto` e `mensagem`: o texto que abre o e-mail, no lugar do padrão.
 * Tudo só no e-mail: no WhatsApp a mensagem sai pelo modelo aprovado na Meta
 * e não aceita texto livre nem cópia.
 */
import { ErroCobranca } from './tipos';
import type { CanalCobranca } from './config';

export const MAX_COPIAS = 5;
export const MAX_ASSUNTO = 150;
export const MAX_MENSAGEM = 2000;

export interface EnvioPersonalizado {
  copia_para: string[];
  assunto: string;
  mensagem: string;
}

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

/** Quebra o texto digitado (vírgula, ponto e vírgula, espaço ou linha) em e-mails. */
export function separarEmails(v: unknown): string[] {
  const lista = Array.isArray(v) ? v.map(x => String(x ?? '')) : String(v ?? '').split(/[\s,;]+/);
  return [...new Set(lista.map(e => e.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Confere o que veio da tela. Devolve o envio limpo (vazio quando nada foi
 * pedido) ou lança ErroCobranca com a frase para a pessoa corrigir.
 */
export function lerEnvioPersonalizado(canal: CanalCobranca, corpo: Record<string, unknown> | null | undefined): EnvioPersonalizado {
  const copia_para = separarEmails(corpo?.copia_para);
  const assunto = String(corpo?.assunto ?? '').replace(/\s+/g, ' ').trim();
  const mensagem = String(corpo?.mensagem ?? '').replace(/\r\n/g, '\n').trim();
  if (canal === 'whatsapp' && (copia_para.length || assunto || mensagem)) {
    throw new ErroCobranca('No WhatsApp a mensagem sai pelo modelo aprovado na Meta: cópia, assunto e texto próprio só no e-mail.');
  }
  if (copia_para.length > MAX_COPIAS) throw new ErroCobranca(`Até ${MAX_COPIAS} e-mails em cópia.`);
  const invalido = copia_para.find(e => !EMAIL.test(e));
  if (invalido) throw new ErroCobranca(`"${invalido}" não parece um e-mail. Confira e tente de novo.`);
  if (assunto.length > MAX_ASSUNTO) throw new ErroCobranca(`O assunto pode ter até ${MAX_ASSUNTO} letras.`);
  if (mensagem.length > MAX_MENSAGEM) throw new ErroCobranca(`A mensagem pode ter até ${MAX_MENSAGEM} letras.`);
  return { copia_para, assunto, mensagem };
}

/** Os campos que vão no payload do CRM: só os preenchidos. */
export function camposDoEnvio(e: EnvioPersonalizado): Partial<EnvioPersonalizado> {
  return {
    ...(e.copia_para.length ? { copia_para: e.copia_para } : {}),
    ...(e.assunto ? { assunto: e.assunto } : {}),
    ...(e.mensagem ? { mensagem: e.mensagem } : {}),
  };
}

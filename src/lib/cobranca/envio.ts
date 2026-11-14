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

/**
 * O que o e-mail leva (E7): o boleto (o de sempre), o documento da fatura
 * (link para o cliente ler e salvar em PDF) ou os dois. Fatura só quando a
 * cobrança é de uma fatura fechada.
 */
export type DocumentosDoEnvio = 'boleto' | 'fatura' | 'boleto_e_fatura';
export const DOCUMENTOS_DO_ENVIO: readonly DocumentosDoEnvio[] = ['boleto', 'fatura', 'boleto_e_fatura'];
export const ROTULO_DOS_DOCUMENTOS: Record<DocumentosDoEnvio, string> = {
  boleto: 'Boleto',
  fatura: 'Fatura',
  boleto_e_fatura: 'Boleto e fatura',
};

export function ehDocumentosDoEnvio(v: unknown): v is DocumentosDoEnvio {
  return typeof v === 'string' && (DOCUMENTOS_DO_ENVIO as readonly string[]).includes(v);
}

/** O e-mail leva o documento da fatura? */
export function levaFatura(d: DocumentosDoEnvio): boolean {
  return d === 'fatura' || d === 'boleto_e_fatura';
}

export interface EnvioPersonalizado {
  copia_para: string[];
  assunto: string;
  mensagem: string;
  /** Ausente ou 'boleto' (padrão) = o e-mail de sempre. */
  documentos?: DocumentosDoEnvio;
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
  const pedido = corpo?.documentos;
  if (pedido !== undefined && pedido !== null && pedido !== '' && !ehDocumentosDoEnvio(pedido)) {
    throw new ErroCobranca('Escolha o que vai no e-mail: boleto, fatura ou os dois.');
  }
  const documentos: DocumentosDoEnvio = ehDocumentosDoEnvio(pedido) ? pedido : 'boleto';
  if (canal === 'whatsapp' && (copia_para.length || assunto || mensagem)) {
    throw new ErroCobranca('No WhatsApp a mensagem sai pelo modelo aprovado na Meta: cópia, assunto e texto próprio só no e-mail.');
  }
  if (canal === 'whatsapp' && documentos !== 'boleto') {
    throw new ErroCobranca('A fatura vai por e-mail. No WhatsApp sai o boleto, pelo modelo aprovado na Meta.');
  }
  if (copia_para.length > MAX_COPIAS) throw new ErroCobranca(`Até ${MAX_COPIAS} e-mails em cópia.`);
  const invalido = copia_para.find(e => !EMAIL.test(e));
  if (invalido) throw new ErroCobranca(`"${invalido}" não parece um e-mail. Confira e tente de novo.`);
  if (assunto.length > MAX_ASSUNTO) throw new ErroCobranca(`O assunto pode ter até ${MAX_ASSUNTO} letras.`);
  if (mensagem.length > MAX_MENSAGEM) throw new ErroCobranca(`A mensagem pode ter até ${MAX_MENSAGEM} letras.`);
  return { copia_para, assunto, mensagem, ...(documentos !== 'boleto' ? { documentos } : {}) };
}

/** Os campos que vão no payload do CRM: só os preenchidos ('boleto' não vai: é o e-mail de sempre). */
export function camposDoEnvio(e: EnvioPersonalizado): { copia_para?: string[]; assunto?: string; mensagem?: string; documentos?: Exclude<DocumentosDoEnvio, 'boleto'> } {
  return {
    ...(e.copia_para.length ? { copia_para: e.copia_para } : {}),
    ...(e.assunto ? { assunto: e.assunto } : {}),
    ...(e.mensagem ? { mensagem: e.mensagem } : {}),
    ...(e.documentos === 'fatura' || e.documentos === 'boleto_e_fatura' ? { documentos: e.documentos } : {}),
  };
}

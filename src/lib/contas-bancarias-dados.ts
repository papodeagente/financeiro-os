/**
 * Dados do cadastro da conta bancária (06/11/2026, E7) — regra pura.
 *
 *   titular / titular_documento   de quem é a conta (opcional);
 *   banco_codigo                  código COMPE da lista oficial (bancos.ts);
 *                                 `banco` continua o nome (texto livre nas
 *                                 contas antigas, nada é convertido);
 *   agencia_digito / conta_digito o dígito separado do número;
 *   ativo                         false = desativada (some dos seletores).
 */
import { bancoPorCodigo } from './bancos';

const limpa = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Arruma o item no lugar antes de gravar. Devolve a recusa (400) ou null. */
export function normalizarDadosDaConta(item: Record<string, unknown>): string | null {
  if ('titular' in item) item.titular = limpa(item.titular, 120);
  if ('titular_documento' in item) {
    const doc = limpa(item.titular_documento, 30).replace(/[^\d]/g, '');
    if (doc && doc.length !== 11 && doc.length !== 14) return 'O CPF ou CNPJ do titular precisa ter 11 ou 14 números.';
    item.titular_documento = doc;
  }
  for (const campo of ['agencia_digito', 'conta_digito'] as const) {
    if (!(campo in item)) continue;
    const d = limpa(item[campo], 4).toUpperCase();
    if (d && !/^[0-9X]{1,2}$/.test(d)) return campo === 'agencia_digito' ? 'O dígito da agência tem 1 ou 2 caracteres (número ou X).' : 'O dígito da conta tem 1 ou 2 caracteres (número ou X).';
    item[campo] = d;
  }
  for (const campo of ['agencia', 'conta'] as const) {
    if (typeof item[campo] === 'string') item[campo] = limpa(item[campo], 30);
  }
  if ('banco_codigo' in item) {
    const c = limpa(item.banco_codigo, 3);
    if (c) {
      const b = bancoPorCodigo(c);
      if (!b) return 'Escolha o banco na lista oficial.';
      item.banco_codigo = b.codigo;
      item.banco_ispb = b.ispb;
      if (!limpa(item.banco, 200)) item.banco = b.nome;
    } else {
      item.banco_codigo = '';
      item.banco_ispb = '';
    }
  }
  if ('ativo' in item) item.ativo = item.ativo !== false && item.ativo !== 'false';
  return null;
}

/** Agência e conta por extenso, com o dígito: "Ag 1234-5 · Conta 98765-0". */
export function identificacaoDaConta(c: { agencia?: unknown; agencia_digito?: unknown; conta?: unknown; conta_digito?: unknown }): string {
  const comDigito = (n: unknown, d: unknown) => {
    const a = String(n ?? '').trim();
    const b = String(d ?? '').trim();
    return a ? (b ? `${a}-${b}` : a) : '';
  };
  const partes: string[] = [];
  const ag = comDigito(c.agencia, c.agencia_digito);
  const ct = comDigito(c.conta, c.conta_digito);
  if (ag) partes.push(`Ag ${ag}`);
  if (ct) partes.push(`Conta ${ct}`);
  return partes.join(' · ');
}

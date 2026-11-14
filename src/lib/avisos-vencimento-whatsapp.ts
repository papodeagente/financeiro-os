/**
 * Aviso de vencimento pelo WhatsApp, para a equipe da agência (E7, 06/11/2026). Puro.
 *
 * Além do sino, quem a agência cadastrar em Configurações › Financeiro recebe
 * no WhatsApp, uma vez por dia (a partir das 7h de Brasília), o resumo do que
 * vence hoje e do que está em atraso, a pagar e a receber. Sai pelo WhatsApp
 * conectado no CRM (evento `FINANCEIRO_AVISO_VENCIMENTOS`, como a régua de
 * cobrança): o Financeiro monta o texto; o CRM só entrega.
 *
 * Desligado por padrão (opt-in) e só para os números cadastrados. "Nada sai"
 * (mudança de sistema) vale: nenhum aviso.
 */
import { round2 } from './money';
import type { ContaEmAberto } from './avisos-vencimento';

export const MAX_TELEFONES_DO_AVISO = 5;

export interface DestinoDoAviso {
  nome: string;
  /** Só dígitos, com o país (55…). */
  telefone: string;
}

export interface AvisoWhatsApp {
  ligado: boolean;
  telefones: DestinoDoAviso[];
}

export const AVISO_WHATSAPP_PADRAO: AvisoWhatsApp = { ligado: false, telefones: [] };

/** Telefone brasileiro em dígitos com o 55 (10 ou 11 dígitos locais), ou '' se não serve. */
export function telefoneDoAviso(v: unknown): string {
  const bruto = String(v ?? '').trim();
  let d = bruto.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  // Com "+" na frente, o país vem escrito: só vale o 55.
  else if (!bruto.startsWith('+') && (d.length === 10 || d.length === 11)) d = `55${d}`;
  if (!d.startsWith('55') || (d.length !== 12 && d.length !== 13)) return '';
  return d;
}

/** Grava só o que conhece; números inválidos ou repetidos ficam de fora; até 5. */
export function normalizarAvisoWhatsApp(v: unknown): AvisoWhatsApp {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const lista = Array.isArray(o.telefones) ? o.telefones : [];
  const telefones: DestinoDoAviso[] = [];
  for (const t of lista) {
    const r = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
    const telefone = telefoneDoAviso(r.telefone);
    if (!telefone || telefones.some(x => x.telefone === telefone)) continue;
    telefones.push({ nome: String(r.nome ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), telefone });
    if (telefones.length >= MAX_TELEFONES_DO_AVISO) break;
  }
  return { ligado: o.ligado === true, telefones };
}

/** Os números que a tela recusaria, para dizer quais não serviram. */
export function telefonesInvalidos(v: unknown): string[] {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const lista = Array.isArray(o.telefones) ? o.telefones : [];
  return lista
    .map(t => String(((t && typeof t === 'object' ? t : {}) as Record<string, unknown>).telefone ?? '').trim())
    .filter(t => t && !telefoneDoAviso(t));
}

export interface GrupoDoResumo { quantidade: number; total: number }

export interface ResumoDoDia {
  pagar_hoje: GrupoDoResumo;
  pagar_atrasadas: GrupoDoResumo;
  receber_hoje: GrupoDoResumo;
  receber_atrasadas: GrupoDoResumo;
  /** As maiores a pagar hoje (até 3), para o texto. */
  maiores_a_pagar_hoje: Array<{ descricao: string; saldo: number }>;
}

const formatarBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string) => { const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}` : iso; };

function grupo(contas: readonly ContaEmAberto[]): GrupoDoResumo {
  return { quantidade: contas.length, total: round2(contas.reduce((a, c) => a + c.saldo, 0)) };
}

/** O resumo do dia: o que vence hoje e o que já venceu, a pagar e a receber. */
export function resumoDoDia(contas: readonly ContaEmAberto[], hoje: string): ResumoDoDia {
  const abertas = contas.filter(c => c.saldo > 0.004 && /^\d{4}-\d{2}-\d{2}/.test(c.vencimento));
  const de = (t: ContaEmAberto['tabela'], f: (v: string) => boolean) => abertas.filter(c => c.tabela === t && f(c.vencimento.slice(0, 10)));
  const pagarHoje = de('contas_pagar', v => v === hoje);
  return {
    pagar_hoje: grupo(pagarHoje),
    pagar_atrasadas: grupo(de('contas_pagar', v => v < hoje)),
    receber_hoje: grupo(de('contas_receber', v => v === hoje)),
    receber_atrasadas: grupo(de('contas_receber', v => v < hoje)),
    maiores_a_pagar_hoje: [...pagarHoje].sort((a, b) => b.saldo - a.saldo).slice(0, 3)
      .map(c => ({ descricao: (c.descricao || c.pessoa || 'Conta sem descrição').trim().slice(0, 60), saldo: c.saldo })),
  };
}

export function resumoVazio(r: ResumoDoDia): boolean {
  return !r.pagar_hoje.quantidade && !r.pagar_atrasadas.quantidade && !r.receber_hoje.quantidade && !r.receber_atrasadas.quantidade;
}

const linha = (rotulo: string, g: GrupoDoResumo) =>
  g.quantidade ? `${rotulo}: ${g.quantidade} ${g.quantidade === 1 ? 'conta' : 'contas'}, ${formatarBRL(g.total)}` : null;

/**
 * O texto que chega no WhatsApp. Curto, sem nome de cliente nem documento
 * (o celular pode estar na mão de outra pessoa): só quantidades, totais e as
 * descrições das maiores contas a pagar hoje.
 */
export function textoDoResumo(r: ResumoDoDia, hoje: string, agencia: string, url: string): string {
  const partes = [
    `Financeiro${agencia ? ` · ${agencia}` : ''} · ${dataBR(hoje)}`,
    '',
    linha('A pagar hoje', r.pagar_hoje),
    linha('A pagar em atraso', r.pagar_atrasadas),
    linha('A receber hoje', r.receber_hoje),
    linha('A receber em atraso', r.receber_atrasadas),
  ].filter((x): x is string => x !== null);
  if (r.maiores_a_pagar_hoje.length) {
    partes.push('', 'Maiores a pagar hoje:');
    for (const c of r.maiores_a_pagar_hoje) partes.push(`• ${c.descricao}: ${formatarBRL(c.saldo)}`);
  }
  if (url) partes.push('', `Abrir no Financeiro: ${url}`);
  return partes.join('\n').slice(0, 1500);
}

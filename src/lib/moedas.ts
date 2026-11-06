/**
 * Cadastro de moedas da agência (E7, frente D, 06/11/2026) — regra pura.
 *
 * As oito moedas do sistema (MOEDAS, em ./cambio) continuam fixas e sempre
 * presentes. A agência acrescenta outras pelo código ISO 4217 (ARS, CLP,
 * MXN...), com nome, símbolo e casas decimais. Cotação ao vivo só para as que
 * a fonte publica (PTAX: MOEDAS_PTAX_DISPONIVEIS); nas outras o câmbio é
 * digitado, como sempre foi possível.
 *
 * Os códigos válidos e as sugestões de nome, símbolo e casas vêm do próprio
 * Intl do JavaScript (lista ISO 4217 que acompanha o Node e o navegador):
 * nada de lista copiada à mão.
 */
import { MOEDAS, MOEDAS_PTAX_DISPONIVEIS, type CatalogoDeMoedas, type Moeda } from './cambio';

/** Até 2 casas: os valores na moeda são guardados com 2 casas (centavos). */
export const CASAS_MAXIMAS = 2;
export const LIMITE_DE_MOEDAS_DA_AGENCIA = 40;

/** Uma moeda cadastrada pela agência, como fica gravada. */
export interface MoedaDaAgencia {
  codigo: string;
  nome: string;
  simbolo: string;
  casas: number;
  ativo: boolean;
}

/** Códigos ISO 4217 que o Intl conhece (null quando o ambiente não informa). */
export function codigosIso4217(): ReadonlySet<string> | null {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof f !== 'function') return null;
    const lista = f('currency');
    return lista.length ? new Set(lista.map(c => c.toUpperCase())) : null;
  } catch {
    return null;
  }
}

export function normalizarCodigo(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase().slice(0, 8) : '';
}

/** Nome, símbolo e casas que o padrão internacional dá para o código (sugestão). */
export function sugestaoDaMoeda(codigo: string): { nome: string; simbolo: string; casas: number; casas_iso: number } | null {
  const c = normalizarCodigo(codigo);
  if (!/^[A-Z]{3}$/.test(c)) return null;
  const iso = codigosIso4217();
  if (iso && !iso.has(c)) return null;
  let nome = c;
  let simbolo = c;
  let casasIso = 2;
  try {
    const dn = new Intl.DisplayNames(['pt-BR'], { type: 'currency' });
    const n = dn.of(c);
    if (n && n !== c) nome = n.charAt(0).toUpperCase() + n.slice(1);
  } catch { /* fica o código */ }
  try {
    const partes = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol' }).formatToParts(1);
    simbolo = partes.find(p => p.type === 'currency')?.value || c;
    casasIso = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch { /* fica o código */ }
  return { nome, simbolo, casas: Math.min(CASAS_MAXIMAS, casasIso), casas_iso: casasIso };
}

/** Confere uma moeda nova ou editada. Devolve a moeda limpa ou o erro em português. */
export function validarMoedaDaAgencia(
  entrada: Record<string, unknown>,
  existentes: readonly MoedaDaAgencia[],
  edicao?: string,
): { ok: true; moeda: MoedaDaAgencia } | { ok: false; erro: string } {
  const codigo = edicao ?? normalizarCodigo(entrada.codigo);
  if (!/^[A-Z]{3}$/.test(codigo)) return { ok: false, erro: 'O código tem três letras, como ARS ou CLP (padrão ISO 4217).' };
  if (MOEDAS.some(m => m.codigo === codigo)) return { ok: false, erro: `${codigo} já vem pronta no sistema.` };
  const iso = codigosIso4217();
  if (iso && !iso.has(codigo)) return { ok: false, erro: `${codigo} não é um código de moeda do padrão ISO 4217.` };
  if (!edicao) {
    if (existentes.some(m => m.codigo === codigo)) return { ok: false, erro: `${codigo} já está cadastrada.` };
    if (existentes.length >= LIMITE_DE_MOEDAS_DA_AGENCIA) return { ok: false, erro: `O limite é de ${LIMITE_DE_MOEDAS_DA_AGENCIA} moedas cadastradas.` };
  }
  const atual = existentes.find(m => m.codigo === codigo);
  const sug = sugestaoDaMoeda(codigo);
  const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
  const nome = texto(entrada.nome, 60) || atual?.nome || sug?.nome || codigo;
  const simbolo = texto(entrada.simbolo, 8) || atual?.simbolo || sug?.simbolo || codigo;
  const casasBruto = entrada.casas === undefined || entrada.casas === null || entrada.casas === ''
    ? (atual?.casas ?? sug?.casas ?? 2)
    : Number(entrada.casas);
  if (!Number.isInteger(casasBruto) || casasBruto < 0 || casasBruto > CASAS_MAXIMAS) {
    return { ok: false, erro: `Casas decimais vão de 0 a ${CASAS_MAXIMAS}.` };
  }
  const ativo = entrada.ativo === undefined ? (atual?.ativo ?? true) : entrada.ativo !== false;
  return { ok: true, moeda: { codigo, nome, simbolo, casas: casasBruto, ativo } };
}

/** As do sistema mais as da agência, prontas para cambio.ts. */
export function catalogoCompleto(daAgencia: readonly MoedaDaAgencia[]): CatalogoDeMoedas {
  const extras: Moeda[] = daAgencia
    .filter(m => !MOEDAS.some(s => s.codigo === m.codigo))
    .map(m => ({
      codigo: m.codigo, nome: m.nome, simbolo: m.simbolo, casas: m.casas, turismo: false,
      ptax: MOEDAS_PTAX_DISPONIVEIS.includes(m.codigo), da_agencia: true, ativo: m.ativo,
    }));
  return [...MOEDAS, ...extras.sort((a, b) => a.codigo.localeCompare(b.codigo))];
}

/** O que aparece para escolher (moeda desativada some, a não ser a já gravada). */
export function moedasParaEscolher(catalogo: CatalogoDeMoedas, atual?: string | null): Moeda[] {
  return catalogo.filter(m => m.ativo !== false || m.codigo === atual);
}

/** "Cotação ao vivo (PTAX)" / "Câmbio digitado". */
export function comoVemOCambio(m: Pick<Moeda, 'codigo' | 'turismo' | 'ptax'>): string {
  if (m.codigo === 'BRL') return 'Moeda da agência';
  if (m.turismo) return 'Turismo e PTAX ao vivo';
  if (m.ptax) return 'PTAX ao vivo';
  return 'Câmbio digitado';
}

/** Confere a moeda de um cadastro (título, conta). Vazio = real; desconhecida = erro. */
export function conferirMoedaDoCadastro(v: unknown, catalogo: CatalogoDeMoedas): { moeda: string } | { erro: string } {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (!s) return { moeda: 'BRL' };
  if (catalogo.some(m => m.codigo === s)) return { moeda: s };
  return { erro: `A moeda ${s.slice(0, 8)} não está cadastrada. Cadastre em Moedas e câmbio antes de usar.` };
}

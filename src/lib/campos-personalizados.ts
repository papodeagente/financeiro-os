/**
 * Campos personalizados nos títulos (06/11/2026, E7) — regra pura.
 *
 * A agência cria os campos que precisa nas contas a pagar e a receber (ex.:
 * "Nº do pedido do cliente", "Aprovado pelo sócio", "Mês de competência").
 * Cada campo tem nome, tipo e a quem vale. Os valores ficam no próprio título,
 * em `data.campos_personalizados[<id do campo>]`, e aparecem no lançamento,
 * na lista Contas a Pagar/Receber e na planilha.
 *
 * As definições ficam no cadastro da agência (agencia.data, chave
 * CHAVE_DOS_CAMPOS). Regras:
 *   - o id é estável: renomear não perde os valores gravados;
 *   - desativar esconde o campo do lançamento novo, mas os valores ficam;
 *   - nenhum valor gravado é apagado por mudança de definição.
 */

export type TipoDoCampoPersonalizado = 'texto' | 'numero' | 'data' | 'sim_nao' | 'lista';
export type AplicaA = 'ambos' | 'pagar' | 'receber';
export type TabelaDoTitulo = 'contas_pagar' | 'contas_receber';
export type ValorDoCampo = string | number | boolean | null;

export interface CampoPersonalizado {
  id: string;
  nome: string;
  tipo: TipoDoCampoPersonalizado;
  /** Só para o tipo lista. */
  opcoes?: string[];
  ativo: boolean;
  aplica_a: AplicaA;
  obrigatorio?: boolean;
}

/** Chave do cadastro da agência onde as definições ficam. */
export const CHAVE_DOS_CAMPOS = 'campos_personalizados_titulos';

export const LIMITES = {
  campos: 30,
  nome: 60,
  opcoes: 50,
  opcao: 60,
  texto: 500,
  id: 40,
} as const;

export const TIPOS: readonly TipoDoCampoPersonalizado[] = ['texto', 'numero', 'data', 'sim_nao', 'lista'];

export const ROTULO_DO_TIPO: Record<TipoDoCampoPersonalizado, string> = {
  texto: 'Texto',
  numero: 'Número',
  data: 'Data',
  sim_nao: 'Sim ou não',
  lista: 'Lista de opções',
};

export const ROTULO_DO_ALCANCE: Record<AplicaA, string> = {
  ambos: 'Pagar e receber',
  pagar: 'Só contas a pagar',
  receber: 'Só contas a receber',
};

const ID = /^[a-z0-9_-]{1,40}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function limpar(texto: unknown, max: number): string {
  return typeof texto === 'string' ? texto.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Id estável a partir do nome (sem acento, minúsculo), sem repetir os já usados. */
export function idParaNome(nome: string, usados: ReadonlySet<string>): string {
  const base = nome
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 30) || 'campo';
  let id = base;
  for (let n = 2; usados.has(id); n++) id = `${base}_${n}`.slice(0, LIMITES.id);
  return id;
}

/**
 * Lista de definições vinda da tela ou do banco, em forma segura: sem nome
 * vazio, sem id repetido, tipo conhecido, opções limpas, no máximo 30.
 * Aceita a lista pura ou `{ campos: [...] }`.
 */
export function normalizarDefinicoes(entrada: unknown): CampoPersonalizado[] {
  const lista = Array.isArray(entrada) ? entrada
    : entrada && typeof entrada === 'object' && Array.isArray((entrada as { campos?: unknown }).campos)
      ? (entrada as { campos: unknown[] }).campos : [];
  const usados = new Set<string>();
  const saida: CampoPersonalizado[] = [];
  for (const bruto of lista) {
    if (saida.length >= LIMITES.campos) break;
    if (!bruto || typeof bruto !== 'object') continue;
    const o = bruto as Record<string, unknown>;
    const nome = limpar(o.nome, LIMITES.nome);
    if (!nome) continue;
    const idInformado = typeof o.id === 'string' ? o.id.trim().toLowerCase() : '';
    const id = ID.test(idInformado) && !usados.has(idInformado) ? idInformado : idParaNome(nome, usados);
    usados.add(id);
    const tipo = TIPOS.includes(o.tipo as TipoDoCampoPersonalizado) ? o.tipo as TipoDoCampoPersonalizado : 'texto';
    const aplica_a: AplicaA = o.aplica_a === 'pagar' || o.aplica_a === 'receber' ? o.aplica_a : 'ambos';
    const campo: CampoPersonalizado = { id, nome, tipo, ativo: o.ativo !== false, aplica_a };
    if (o.obrigatorio === true) campo.obrigatorio = true;
    if (tipo === 'lista') {
      const vistas = new Set<string>();
      const opcoes: string[] = [];
      for (const op of Array.isArray(o.opcoes) ? o.opcoes : []) {
        const t = limpar(op, LIMITES.opcao);
        const k = t.toLowerCase();
        if (!t || vistas.has(k)) continue;
        vistas.add(k);
        opcoes.push(t);
        if (opcoes.length >= LIMITES.opcoes) break;
      }
      campo.opcoes = opcoes;
    }
    saida.push(campo);
  }
  return saida;
}

/** O que a tela precisa corrigir antes de salvar as definições (null = pode salvar). */
export function problemaNasDefinicoes(campos: readonly CampoPersonalizado[]): string | null {
  if (campos.length > LIMITES.campos) return `Até ${LIMITES.campos} campos.`;
  const nomes = new Set<string>();
  for (const c of campos) {
    const k = c.nome.trim().toLowerCase();
    if (!k) return 'Dê um nome a cada campo.';
    if (nomes.has(k)) return `Já existe um campo chamado "${c.nome}".`;
    nomes.add(k);
    if (c.tipo === 'lista' && (!c.opcoes || c.opcoes.length === 0)) return `O campo "${c.nome}" é uma lista: escreva ao menos uma opção.`;
  }
  return null;
}

/** Os campos que valem para a tabela. Sem `incluirInativos`, só os ativos. */
export function camposDaTabela(
  defs: readonly CampoPersonalizado[], tabela: TabelaDoTitulo, opcoes: { incluirInativos?: boolean } = {},
): CampoPersonalizado[] {
  const lado: AplicaA = tabela === 'contas_pagar' ? 'pagar' : 'receber';
  return defs.filter(d => (d.aplica_a === 'ambos' || d.aplica_a === lado) && (opcoes.incluirInativos || d.ativo));
}

/** Valor vazio para o campo (não preenchido). */
export function valorVazio(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/**
 * Confere e arruma `item.campos_personalizados` NO PRÓPRIO item, antes de
 * gravar o título. Não depende das definições (o servidor de contas chama
 * sempre): só tipos primitivos, ids válidos, texto até 500 caracteres,
 * número finito, data AAAA-MM-DD. Vazio sai do mapa. Devolve a recusa (400)
 * ou null.
 */
export function sanearCamposPersonalizadosDoItem(item: Record<string, unknown>): string | null {
  if (!('campos_personalizados' in item)) return null;
  const bruto = item.campos_personalizados;
  if (bruto === null || bruto === undefined) { delete item.campos_personalizados; return null; }
  if (typeof bruto !== 'object' || Array.isArray(bruto)) return 'Campos personalizados em formato inválido.';
  const entradas = Object.entries(bruto as Record<string, unknown>);
  if (entradas.length > LIMITES.campos * 2) return 'Campos personalizados demais neste título.';
  const limpo: Record<string, ValorDoCampo> = {};
  for (const [id, v] of entradas) {
    if (!ID.test(id)) return 'Campo personalizado com identificador inválido.';
    if (valorVazio(v)) continue;
    if (typeof v === 'boolean') { limpo[id] = v; continue; }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return 'Campo personalizado com número inválido.';
      limpo[id] = v;
      continue;
    }
    if (typeof v === 'string') {
      limpo[id] = v.trim().slice(0, LIMITES.texto);
      continue;
    }
    return 'Campo personalizado com valor inválido (só texto, número, data ou sim/não).';
  }
  item.campos_personalizados = limpo;
  return null;
}

/** Converte o que a tela digitou para o valor do tipo do campo (null = vazio ou inválido). */
export function valorParaGravar(def: Pick<CampoPersonalizado, 'tipo' | 'opcoes'>, entrada: unknown): ValorDoCampo {
  if (valorVazio(entrada)) return null;
  switch (def.tipo) {
    case 'numero': {
      const n = typeof entrada === 'number' ? entrada : Number(String(entrada).replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    case 'sim_nao':
      if (entrada === true || entrada === 'true' || entrada === 'sim') return true;
      if (entrada === false || entrada === 'false' || entrada === 'nao') return false;
      return null;
    case 'data': {
      const t = String(entrada).slice(0, 10);
      return DATA.test(t) ? t : null;
    }
    case 'lista': {
      const t = String(entrada).trim();
      return def.opcoes?.includes(t) ? t : (t ? t.slice(0, LIMITES.opcao) : null);
    }
    default:
      return String(entrada).trim().slice(0, LIMITES.texto) || null;
  }
}

/** Para a tela: o primeiro obrigatório sem valor (null = tudo certo). */
export function validarObrigatorios(
  defs: readonly CampoPersonalizado[], tabela: TabelaDoTitulo, valores: Record<string, unknown> | null | undefined,
): string | null {
  for (const d of camposDaTabela(defs, tabela)) {
    if (d.obrigatorio && valorVazio(valores?.[d.id])) return `Preencha o campo "${d.nome}".`;
  }
  return null;
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

/** O valor por extenso, em pt-BR, para lista, planilha e histórico. */
export function formatarValorDoCampo(def: Pick<CampoPersonalizado, 'tipo'>, valor: unknown): string {
  if (valorVazio(valor)) return '';
  switch (def.tipo) {
    case 'sim_nao':
      if (valor === true || valor === 'true' || valor === 'sim') return 'Sim';
      if (valor === false || valor === 'false' || valor === 'nao') return 'Não';
      return '';
    case 'data':
      return typeof valor === 'string' && DATA.test(valor.slice(0, 10)) ? dataBR(valor.slice(0, 10)) : '';
    case 'numero': {
      const n = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
      return Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: 6 }) : '';
    }
    default:
      return typeof valor === 'object' ? '' : String(valor).slice(0, LIMITES.texto);
  }
}

/**
 * Formas de pagamento (05/11/2026) — regra pura, sem banco e sem React.
 *
 * As formas de sempre (Dinheiro, Cheque, Boleto, Cartão de crédito e de
 * débito, Depósito/Transferência, Pix, Faturar, Outros) existem em toda
 * agência sem cadastro nenhum. A agência pode:
 *  - ajustar cada uma (conta bancária padrão, dias para cair, taxa) ou
 *    desligá-la das escolhas novas;
 *  - criar formas próprias (ex.: "Vale-viagem", "Link de pagamento").
 *
 * O PASSADO NÃO MUDA. Os títulos já gravados guardam um texto em
 * `forma_recebimento` / `forma_pagamento` ('PIX', 'TED', 'CARTAO', 'BOLETO',
 * 'DINHEIRO', 'CHEQUE', 'CARTAO_CORP', 'DEPOSITO' ou vazio). Os códigos das
 * formas do sistema são esses mesmos textos sempre que existiam, então quase
 * tudo casa direto. Os dois que não têm par exato ('CARTAO', sem saber se foi
 * crédito ou débito, e 'DEPOSITO') continuam gravados como estão e aparecem
 * com o rótulo de antes; só servem de apelido para achar a conta e a taxa
 * padrão. Nada é reescrito.
 */
import { num, round2 } from './money';

export type UsoDaForma = 'ambos' | 'pagar' | 'receber';
export type SentidoDaForma = 'pagar' | 'receber';

export interface FormaPagamento {
  /** Código gravado no título e na baixa. Nunca muda depois de criado. */
  codigo: string;
  nome: string;
  /** Forma de sempre: não se apaga nem se renomeia, só se ajusta ou desliga. */
  sistema: boolean;
  uso: UsoDaForma;
  ativo: boolean;
  conta_bancaria_id: string | null;
  /** Dias até o dinheiro cair na conta (cartão, boleto). 0 = na hora. */
  dias_para_cair: number;
  /** Taxa em % do valor (ex.: 3,49). */
  taxa_pct: number;
  /** Taxa fixa por operação, em reais (ex.: 1,99 por boleto). */
  taxa_fixa: number;
  /** Texto pronto para "Outros" (ex.: dados para depósito). */
  informacoes: string;
  ordem: number;
}

/** O que a agência pode guardar sobre uma forma (de sempre ou própria). */
export type AjusteDaForma = Partial<Omit<FormaPagamento, 'codigo' | 'sistema'>> & { codigo: string };

const base = (codigo: string, nome: string, ordem: number, uso: UsoDaForma = 'ambos'): FormaPagamento => ({
  codigo, nome, sistema: true, uso, ativo: true, conta_bancaria_id: null,
  dias_para_cair: 0, taxa_pct: 0, taxa_fixa: 0, informacoes: '', ordem,
});

/** As formas de sempre, na ordem em que aparecem nas escolhas. */
export const FORMAS_DO_SISTEMA: readonly FormaPagamento[] = [
  base('PIX', 'Pix', 10),
  base('DINHEIRO', 'Dinheiro', 20),
  base('CHEQUE', 'Cheque', 30),
  base('BOLETO', 'Boleto', 40),
  base('CARTAO_CREDITO', 'Cartão de crédito', 50),
  base('CARTAO_DEBITO', 'Cartão de débito', 60),
  base('TED', 'Depósito/Transferência', 70),
  base('FATURAR', 'Faturar', 80),
  // Só nas contas a pagar: liga a conta ao cartão corporativo cadastrado.
  base('CARTAO_CORP', 'Cartão corporativo', 90, 'pagar'),
  base('OUTROS', 'Outros', 100),
];

const CODIGOS_DO_SISTEMA = new Set(FORMAS_DO_SISTEMA.map(f => f.codigo));

/**
 * Valores antigos sem forma de sistema com o mesmo código. Mostram o rótulo
 * de antes; o apelido só serve para achar conta e taxa padrão.
 */
export const VALORES_ANTIGOS: Readonly<Record<string, { rotulo: string; apelidoDe: string }>> = {
  CARTAO: { rotulo: 'Cartão', apelidoDe: 'CARTAO_CREDITO' },
  DEPOSITO: { rotulo: 'Depósito', apelidoDe: 'TED' },
};

export function ehFormaDoSistema(codigo: string): boolean {
  return CODIGOS_DO_SISTEMA.has(codigo);
}

const inteiro = (v: unknown, min: number, max: number) => Math.min(max, Math.max(min, Math.round(num(v))));
const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Junta as formas de sempre com o que a agência guardou. A forma de sempre
 * mantém nome, código e uso; o ajuste guardado só muda conta, dias, taxa,
 * informações e se está ligada. Formas próprias entram como vieram.
 */
export function formasDaAgencia(guardadas: readonly AjusteDaForma[] = []): FormaPagamento[] {
  const porCodigo = new Map(guardadas.map(g => [g.codigo, g]));
  const sistema = FORMAS_DO_SISTEMA.map(f => {
    const g = porCodigo.get(f.codigo);
    if (!g) return { ...f };
    return {
      ...f,
      ativo: g.ativo ?? f.ativo,
      conta_bancaria_id: g.conta_bancaria_id || null,
      dias_para_cair: inteiro(g.dias_para_cair, 0, 365),
      taxa_pct: round2(Math.max(0, num(g.taxa_pct))),
      taxa_fixa: round2(Math.max(0, num(g.taxa_fixa))),
      informacoes: texto(g.informacoes, 500),
    };
  });
  const proprias = guardadas
    .filter(g => !CODIGOS_DO_SISTEMA.has(g.codigo) && texto(g.nome, 80))
    .map((g, i): FormaPagamento => ({
      codigo: g.codigo,
      nome: texto(g.nome, 80),
      sistema: false,
      uso: g.uso === 'pagar' || g.uso === 'receber' ? g.uso : 'ambos',
      ativo: g.ativo ?? true,
      conta_bancaria_id: g.conta_bancaria_id || null,
      dias_para_cair: inteiro(g.dias_para_cair, 0, 365),
      taxa_pct: round2(Math.max(0, num(g.taxa_pct))),
      taxa_fixa: round2(Math.max(0, num(g.taxa_fixa))),
      informacoes: texto(g.informacoes, 500),
      ordem: num(g.ordem) || 1000 + i,
    }));
  return [...sistema, ...proprias].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** A forma cadastrada que corresponde a um valor gravado (inclusive os antigos). */
export function formaDoValor(valor: string | null | undefined, formas: readonly FormaPagamento[]): FormaPagamento | null {
  const v = String(valor ?? '').trim();
  if (!v) return null;
  const direta = formas.find(f => f.codigo === v);
  if (direta) return direta;
  const antigo = VALORES_ANTIGOS[v];
  return antigo ? formas.find(f => f.codigo === antigo.apelidoDe) ?? null : null;
}

/**
 * Como mostrar um valor gravado. Ordem: valor antigo com rótulo próprio
 * ("Cartão"), forma cadastrada, e por último o próprio texto arrumado —
 * nunca some uma informação que estava lá.
 */
export function rotuloDaForma(valor: string | null | undefined, formas: readonly FormaPagamento[] = FORMAS_DO_SISTEMA): string {
  const v = String(valor ?? '').trim();
  if (!v) return '';
  if (VALORES_ANTIGOS[v]) return VALORES_ANTIGOS[v].rotulo;
  const f = formas.find(x => x.codigo === v);
  if (f) return f.nome;
  // Código desconhecido (forma própria apagada, texto de integração): o
  // próprio texto, legível.
  if (/^[A-Z0-9_]+$/.test(v)) {
    const s = v.replace(/_+/g, ' ').toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return v;
}

export interface OpcaoDeForma {
  valor: string;
  rotulo: string;
  /** Linha curta: "Cai em 30 dias · taxa de 3,49%". */
  detalhe?: string;
}

/** "Cai em 30 dias · taxa de 3,49% + R$ 0,50". Vazio quando não há nada a dizer. */
export function detalheDaForma(f: Pick<FormaPagamento, 'dias_para_cair' | 'taxa_pct' | 'taxa_fixa'>): string {
  const partes: string[] = [];
  if (f.dias_para_cair > 0) partes.push(f.dias_para_cair === 1 ? 'Cai em 1 dia' : `Cai em ${f.dias_para_cair} dias`);
  const pct = num(f.taxa_pct), fixo = num(f.taxa_fixa);
  if (pct > 0 || fixo > 0) {
    const tPct = pct > 0 ? `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : '';
    const tFixo = fixo > 0 ? fixo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
    partes.push(`taxa de ${[tPct, tFixo].filter(Boolean).join(' + ')}`);
  }
  return partes.join(' · ');
}

/**
 * As escolhas de um campo de forma. Entram as formas ligadas do sentido
 * (pagar ou receber). O valor que o título já tem SEMPRE aparece, mesmo que
 * a forma tenha sido desligada ou seja um valor antigo: abrir e salvar sem
 * mexer nunca troca a forma gravada.
 */
export function opcoesDeForma(
  formas: readonly FormaPagamento[],
  sentido: SentidoDaForma,
  valorAtual?: string | null,
): OpcaoDeForma[] {
  const opcoes: OpcaoDeForma[] = formas
    .filter(f => f.ativo && (f.uso === 'ambos' || f.uso === sentido))
    .map(f => ({ valor: f.codigo, rotulo: f.nome, detalhe: detalheDaForma(f) || undefined }));
  const atual = String(valorAtual ?? '').trim();
  if (atual && !opcoes.some(o => o.valor === atual)) {
    opcoes.unshift({ valor: atual, rotulo: rotuloDaForma(atual, formas) });
  }
  return opcoes;
}

/** Taxa sugerida pela forma para um valor, em reais (nunca mais que o valor). */
export function taxaDaForma(valor: number, forma: Pick<FormaPagamento, 'taxa_pct' | 'taxa_fixa'> | null | undefined): number {
  const v = round2(num(valor));
  if (!forma || v <= 0) return 0;
  const t = round2(v * num(forma.taxa_pct) / 100 + num(forma.taxa_fixa));
  return Math.min(v, Math.max(0, t));
}

/** Código de uma forma própria a partir do nome: "Vale-viagem" → "VALE_VIAGEM". */
export function codigoParaNome(nome: string, usados: Iterable<string> = []): string {
  const raiz = nome
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'FORMA';
  const ocupados = new Set([...CODIGOS_DO_SISTEMA, ...Object.keys(VALORES_ANTIGOS), ...usados]);
  if (!ocupados.has(raiz)) return raiz;
  for (let i = 2; i < 1000; i++) {
    const c = `${raiz}_${i}`;
    if (!ocupados.has(c)) return c;
  }
  return `${raiz}_${Date.now()}`;
}

/** Confere um ajuste vindo da tela. Devolve a mensagem de recusa ou null. */
export function validarAjuste(a: Partial<AjusteDaForma>, sistema: boolean): string | null {
  if (!sistema) {
    const nome = texto(a.nome, 200);
    if (!nome) return 'Dê um nome para a forma de pagamento.';
    if (nome.length > 80) return 'Use um nome com até 80 letras.';
  }
  const pct = num(a.taxa_pct);
  if (pct < 0 || pct >= 100) return 'A taxa em porcentagem precisa ficar entre 0 e 99,99%.';
  if (num(a.taxa_fixa) < 0) return 'A taxa fixa não pode ser negativa.';
  const dias = num(a.dias_para_cair);
  if (dias < 0 || dias > 365) return 'Os dias para cair precisam ficar entre 0 e 365.';
  return null;
}

/**
 * Resultado por categoria (05/11/2026) — os lançamentos viram registros
 * da tabela dinâmica (tabela-dinamica.ts). Conta pura, sem React e sem banco.
 *
 * Regras:
 *  - Receita entra positiva, despesa negativa: o total geral é o resultado.
 *  - Competência: valor da conta no vencimento. Caixa: o que se moveu
 *    (valorMovimentado) na data da baixa. Cancelada não existe.
 *  - Grupo = categoria pai no plano de contas (sem pai, o grupo é ela mesma).
 *  - Repasse fica fora por padrão: categoria marcada `repasse: true` no plano
 *    de contas (campo opcional do cadastro) e, por compatibilidade, a conta a
 *    pagar que a venda gerou (auto_gerado + origem VENDA), que é repasse ao
 *    fornecedor em todo o resto do financeiro.
 *  - "Dividir pelo rateio": a conta com rateio por centro de custo se divide pelo
 *    percentual; o que faltar para 100% fica em "Sem centro de custo".
 */
import type { ContaBancaria, ContaPagar, ContaReceber, PlanoContas } from './crm-types';
import { num, paraCentavos } from './money';
import { valorMovimentado } from './saldo-bancario';
import { auditCsvCell } from './audit-query';
import type { RegistroDinamico, TabelaDinamica } from './tabela-dinamica';
import { COLUNA_TOTAL } from './tabela-dinamica';

export type CampoDemonstrativo = 'tipo' | 'grupo' | 'categoria' | 'ano' | 'mes' | 'pessoa' | 'conta' | 'centro' | 'empresa';

export const ROTULO_DO_CAMPO: Record<CampoDemonstrativo, string> = {
  tipo: 'Tipo',
  grupo: 'Grupo',
  categoria: 'Categoria',
  ano: 'Ano',
  mes: 'Mês',
  pessoa: 'Pessoa',
  conta: 'Conta',
  centro: 'Centro de custo',
  empresa: 'Empresa',
};

export const CAMPOS_DO_DEMONSTRATIVO: CampoDemonstrativo[] = ['tipo', 'grupo', 'categoria', 'ano', 'mes', 'pessoa', 'conta', 'centro'];
/** Com duas ou mais empresas (E7) entra o campo Empresa; com uma, os de sempre. */
export const CAMPOS_COM_EMPRESA: CampoDemonstrativo[] = [...CAMPOS_DO_DEMONSTRATIVO, 'empresa'];
export function camposDoDemonstrativo(multiempresa: boolean): CampoDemonstrativo[] {
  return multiempresa ? CAMPOS_COM_EMPRESA : CAMPOS_DO_DEMONSTRATIVO;
}
export const LINHAS_PADRAO: CampoDemonstrativo[] = ['tipo', 'grupo', 'categoria'];
export const COLUNAS_PADRAO: CampoDemonstrativo[] = ['ano', 'mes'];

export const SEM_CATEGORIA = 'Sem categoria';
export const SEM_CENTRO = 'Sem centro de custo';
export const SEM_CONTA = 'Sem conta bancária';
export const SEM_PESSOA = 'Sem pessoa';
export const RECEITAS = 'Receitas';
export const DESPESAS = 'Despesas';

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** O que a tela mostra para o valor bruto do campo ('2026-10' vira "out/2026"). */
export function rotuloDoValor(campo: string, valor: string): string {
  if (campo === 'mes' && /^\d{4}-\d{2}$/.test(valor)) {
    const [a, m] = valor.split('-').map(Number);
    return `${MESES_CURTOS[m - 1]}/${a}`;
  }
  return valor || '—';
}

/** Receitas antes de Despesas; o resto pela ordem natural. */
export const ORDEM_DO_DEMONSTRATIVO = {
  tipo: (a: string, b: string) => (a === b ? 0 : a === RECEITAS ? -1 : b === RECEITAS ? 1 : a.localeCompare(b, 'pt-BR')),
};

export interface LancamentoDoDemonstrativo {
  tabela: 'contas_receber' | 'contas_pagar';
  id: string;
  descricao: string;
  pessoa: string;
  data: string;
  /** Reais, com sinal (despesa negativa), já com o rateio aplicado. */
  valor: number;
  rateado: boolean;
}

export interface EntradaDemonstrativo {
  receber: readonly ContaReceber[];
  pagar: readonly ContaPagar[];
  planoContas: readonly PlanoContas[];
  contasBancarias: readonly Pick<ContaBancaria, 'id' | 'nome'>[];
  regime: 'competencia' | 'caixa';
  incluirRepasse: boolean;
  usarRateio: boolean;
  /** Período pela data do regime, 'YYYY-MM-DD' inclusive. Vazio = sem corte. */
  de?: string;
  ate?: string;
  /**
   * Várias empresas (E7). Ausente = agência de uma empresa só: os registros
   * saem exatamente como antes, sem o campo Empresa. Presente: cada registro
   * ganha a empresa; com "Dividir pelo rateio", a conta rateada entre empresas
   * se divide pelo percentual de cada uma; e só entra o que é das `visiveis`.
   */
  multiempresa?: { nomes: ReadonlyMap<string, string>; visiveis: readonly string[] | null };
}

function rotuloDaCategoria(p: PlanoContas | undefined): string {
  if (!p) return SEM_CATEGORIA;
  return [p.codigo, p.nome].filter(Boolean).join(' ').trim() || SEM_CATEGORIA;
}

/** A categoria está marcada como repasse no cadastro? (campo opcional) */
export function categoriaEhRepasse(p: PlanoContas | undefined): boolean {
  return Boolean(p && (p as unknown as { repasse?: unknown }).repasse === true);
}

/** Divide os centavos pelos centros do rateio; sobra vai para "sem centro". */
export function ratearCentavos(
  centavos: number,
  rateio: ReadonlyArray<{ centro_custo?: string; percentual?: number }> | null | undefined,
): Array<{ centro: string; centavos: number }> {
  const partes = (rateio ?? [])
    .map(r => ({ centro: String(r.centro_custo ?? '').trim(), pct: num(r.percentual) }))
    .filter(r => r.centro && r.pct > 0);
  const somaPct = partes.reduce((s, p) => s + p.pct, 0);
  if (partes.length === 0 || somaPct <= 0) return [];
  const escala = somaPct > 100 ? 100 / somaPct : 1;
  const saida = partes.map(p => ({ centro: p.centro, centavos: Math.trunc((centavos * p.pct * escala) / 100) }));
  const distribuido = saida.reduce((s, p) => s + p.centavos, 0);
  const resto = centavos - distribuido;
  if (somaPct * escala < 100 - 1e-9) {
    if (resto !== 0) saida.push({ centro: SEM_CENTRO, centavos: resto });
  } else if (resto !== 0) {
    saida[saida.length - 1].centavos += resto;
  }
  return saida;
}

/**
 * Divide os centavos pelas empresas das linhas do rateio (E7). Linha sem
 * empresa fica na empresa da conta. Sem linha de empresa: tudo na da conta.
 * Os centavos fecham o total.
 */
export function ratearPorEmpresa(
  centavos: number,
  rateio: ReadonlyArray<{ empresa_id?: string; percentual?: number }> | null | undefined,
  empresaDaConta: string,
): Array<{ empresa: string; centavos: number }> {
  const linhas = (rateio ?? []).filter(l => num(l.percentual) > 0);
  if (!linhas.some(l => String(l.empresa_id ?? '').trim())) return [{ empresa: empresaDaConta, centavos }];
  const pct = new Map<string, number>();
  for (const l of linhas) {
    const e = String(l.empresa_id ?? '').trim() || empresaDaConta;
    pct.set(e, (pct.get(e) ?? 0) + num(l.percentual));
  }
  const total = [...pct.values()].reduce((s, p) => s + p, 0);
  if (total <= 0) return [{ empresa: empresaDaConta, centavos }];
  const saida = [...pct.entries()].map(([empresa, p]) => ({ empresa, centavos: Math.trunc((centavos * p) / total) }));
  const resto = centavos - saida.reduce((s, x) => s + x.centavos, 0);
  if (resto !== 0) saida[saida.length - 1].centavos += resto;
  return saida;
}

export function registrosDoDemonstrativo(e: EntradaDemonstrativo): RegistroDinamico<LancamentoDoDemonstrativo>[] {
  const porId = new Map(e.planoContas.map(p => [p.id, p]));
  const nomeDaConta = new Map(e.contasBancarias.map(c => [c.id, c.nome]));
  const saida: RegistroDinamico<LancamentoDoDemonstrativo>[] = [];

  function incluir(o: {
    tabela: 'contas_receber' | 'contas_pagar';
    id: string; descricao: string; pessoa: string; categoriaId: string;
    data: string; reais: number; sinal: 1 | -1; conta: string; centro: string;
    rateio: ContaReceber['rateio'] | undefined;
    empresa: string;
  }) {
    if (!o.reais) return;
    if (e.de && o.data < e.de) return;
    if (e.ate && o.data > e.ate) return;
    const cat = porId.get(o.categoriaId);
    const pai = cat?.categoria_pai_id ? porId.get(cat.categoria_pai_id) : undefined;
    const base = {
      tipo: o.sinal > 0 ? RECEITAS : DESPESAS,
      grupo: cat ? rotuloDaCategoria(pai ?? cat) : SEM_CATEGORIA,
      categoria: rotuloDaCategoria(cat),
      ano: o.data.slice(0, 4),
      mes: o.data.slice(0, 7),
      pessoa: o.pessoa.trim() || SEM_PESSOA,
      conta: (o.conta && nomeDaConta.get(o.conta)) || SEM_CONTA,
    };
    const centavosTotal = paraCentavos(o.reais) * o.sinal;
    const me = e.multiempresa;
    // Rateio entre empresas (E7): com "Dividir pelo rateio", cada empresa fica
    // com o seu percentual; sem ele, a conta inteira é da empresa dela.
    const porEmpresa = me && e.usarRateio ? ratearPorEmpresa(centavosTotal, o.rateio, o.empresa) : [{ empresa: o.empresa, centavos: centavosTotal }];
    for (const fatia of porEmpresa) {
      if (me?.visiveis && !me.visiveis.includes(fatia.empresa)) continue;
      const centavos = fatia.centavos;
      const partes = e.usarRateio ? ratearCentavos(centavos, o.rateio) : [];
      const pedacos = partes.length > 0 ? partes : [{ centro: o.centro.trim() || SEM_CENTRO, centavos }];
      const campoEmpresa: Record<string, string> = me ? { empresa: me.nomes.get(fatia.empresa) ?? fatia.empresa } : {};
      for (const p of pedacos) {
        saida.push({
          campos: { ...base, centro: p.centro, ...campoEmpresa },
          centavos: p.centavos,
          ref: { tabela: o.tabela, id: o.id, descricao: o.descricao, pessoa: o.pessoa, data: o.data, valor: p.centavos / 100, rateado: partes.length > 0 || porEmpresa.length > 1 },
        });
      }
    }
  }

  for (const cr of e.receber) {
    if (String(cr.status ?? '') === 'CANCELADO') continue;
    if (!e.incluirRepasse && categoriaEhRepasse(porId.get(cr.categoria_id))) continue;
    const caixa = e.regime === 'caixa';
    const data = String((caixa ? cr.data_recebimento : cr.data_vencimento) ?? '').slice(0, 10);
    if (!data) continue;
    incluir({
      tabela: 'contas_receber', id: cr.id, descricao: String(cr.descricao ?? ''), pessoa: String(cr.cliente_nome ?? ''),
      categoriaId: String(cr.categoria_id ?? ''), data,
      reais: caixa ? valorMovimentado(cr, 'valor_recebido') : num(cr.valor_final), sinal: 1,
      conta: String(cr.conta_bancaria_id ?? ''), centro: String(cr.centro_custo ?? ''), rateio: cr.rateio,
      empresa: String((cr as { empresa_id?: string }).empresa_id || 'principal'),
    });
  }
  for (const cp of e.pagar) {
    if (String(cp.status ?? '') === 'CANCELADO') continue;
    const repasse = categoriaEhRepasse(porId.get(cp.categoria_id)) || (!!cp.auto_gerado && cp.origem === 'VENDA');
    if (!e.incluirRepasse && repasse) continue;
    const caixa = e.regime === 'caixa';
    const data = String((caixa ? cp.data_pagamento : cp.data_vencimento) ?? '').slice(0, 10);
    if (!data) continue;
    incluir({
      tabela: 'contas_pagar', id: cp.id, descricao: String(cp.descricao ?? ''), pessoa: String(cp.fornecedor_nome ?? ''),
      categoriaId: String(cp.categoria_id ?? ''), data,
      reais: caixa ? valorMovimentado(cp, 'valor_pago') : num(cp.valor_final), sinal: -1,
      conta: String(cp.conta_bancaria_id ?? ''), centro: String(cp.centro_custo ?? ''), rateio: cp.rateio,
      empresa: String((cp as { empresa_id?: string }).empresa_id || 'principal'),
    });
  }
  return saida;
}

/** Centavos → "1234,56" para planilha brasileira (sem separador de milhar). */
function numeroDePlanilha(centavos: number): string {
  const neg = centavos < 0;
  const abs = Math.abs(Math.round(centavos));
  return `${neg ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/**
 * CSV seguro da tabela inteira (todos os níveis abertos): uma coluna por
 * campo de linha, uma por coluna-folha e o total. Separador ';' e BOM, para o
 * Excel brasileiro abrir certo; cada célula passa por auditCsvCell (fórmula
 * vira texto).
 */
export function csvDoDemonstrativo(t: TabelaDinamica): string {
  const rotuloCampo = (c: string) => ROTULO_DO_CAMPO[c as CampoDemonstrativo] ?? c;
  const cabecalhoColunas = t.colunas.map(col =>
    col.chave === COLUNA_TOTAL ? 'Valor' : col.caminho.map((v, i) => rotuloDoValor(t.camposColuna[i], v)).join(' › '));
  const cabecalho = [...(t.camposLinha.length ? t.camposLinha.map(rotuloCampo) : ['']), ...cabecalhoColunas, 'Total'];
  const linhas = t.linhas.map(l => [
    ...t.camposLinha.map((c, i) => (i <= l.nivel ? rotuloDoValor(c, l.caminho[i]) : '')),
    ...t.colunas.map(col => (l.celulas[col.chave] === undefined ? '' : numeroDePlanilha(l.celulas[col.chave]))),
    numeroDePlanilha(l.total),
  ]);
  const rodape = [
    'Total geral', ...Array.from({ length: Math.max(0, t.camposLinha.length - 1) }, () => ''),
    ...t.colunas.map(col => numeroDePlanilha(t.totaisPorColuna[col.chave] ?? 0)),
    numeroDePlanilha(t.totalGeral),
  ];
  // Número nosso ("-1234,56") sai como número: o auditCsvCell poria aspa
  // simples na frente do sinal e o Excel leria texto. Todo o resto passa por ele.
  const celula = (v: string) => (/^-?\d+,\d{2}$/.test(v) ? `"${v}"` : auditCsvCell(v));
  return '﻿' + [cabecalho, ...linhas, rodape].map(r => r.map(celula).join(';')).join('\r\n');
}

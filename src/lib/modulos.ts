/**
 * VERSÃO E MÓDULOS POR AGÊNCIA (13/11/2026) — regras puras.
 *
 * O sistema tem um motor só e duas experiências. Toda agência nasce na
 * versão SIMPLES (a de hoje). A versão COMPLETA (E1–E7) é liberada aos
 * poucos pelo Super Admin, módulo a módulo, por agência ou para todas.
 *
 *   tenants.data.fin_versao   'completa' liga tudo naquela agência
 *   tenants.data.modulos      { [id]: true | false } exceções da agência
 *   saas_config 'modulos_liberados'  { modulos: [id...] } liberado para todas
 *
 * Um módulo só vale com as dependências ligadas. O NÚCLEO decide também
 * qual tela abre nas telas que existem nas duas versões (pagar, receber,
 * DRE, fluxo...): núcleo ligado = tela completa.
 *
 * Arquivo puro (sem banco): usado no servidor (modulos-servidor.ts), na
 * sessão e nos testes.
 */

export const MODULOS = [
  { id: 'nucleo', nome: 'Núcleo completo', resumo: 'Contas a Pagar/Receber numa lista só, liquidação com juros e multa, extrato e movimentações, Fechar Caixa, perfis de acesso, alçadas e aprovações.', depende: [] },
  { id: 'cobranca', nome: 'Cobrança e portal do cliente', resumo: 'Boleto e Pix pelo Asaas ou Pagar.me da agência, régua de lembretes, portal do cliente com 2ª via, recibos e notas.', depende: ['nucleo'] },
  { id: 'mudanca', nome: 'Mudança de sistema', resumo: 'Assistente que traz os dados do sistema anterior, com ensaio, provas, desfazer e mês em paralelo.', depende: ['nucleo'] },
  { id: 'venda', nome: 'Venda completa, faturas e fornecedor', resumo: 'Ficha da venda com produtos, passageiros e pagamentos; faturas e regras de faturamento; fatura do fornecedor, sinais e acordos; cancelamento, reembolso e crédito do cliente.', depende: ['nucleo'] },
  { id: 'comissoes', nome: 'Comissões por função', resumo: 'Funções, planos por função, grade de metas, fechar e pagar comissões.', depende: ['nucleo'] },
  { id: 'notas', nome: 'Notas por regra', resumo: 'Gerar notas, regras da nota, retenções na fonte e acompanhamento na prefeitura.', depende: ['nucleo'] },
  { id: 'cambio', nome: 'Câmbio e moedas', resumo: 'Câmbio sugerido ao vivo, contas em moeda estrangeira, moedas da agência.', depende: ['nucleo'] },
  { id: 'extrato', nome: 'Extrato automático e conferência de operadora', resumo: 'Extrato do banco chegando sozinho, conciliação automática e conferência do extrato da operadora.', depende: ['nucleo'] },
  { id: 'empresas', nome: 'Várias empresas', resumo: 'Mais de um CNPJ na mesma agência, com seletor, rateio e configurações por empresa.', depende: ['nucleo'] },
  { id: 'relatorios', nome: 'Relatórios e exportação', resumo: 'Excel e PDF em toda lista, relatórios de vendas, DRE mês a mês e envios agendados.', depende: ['nucleo'] },
  { id: 'cheques', nome: 'Cheques', resumo: 'Imprimir cheque e controlar os cheques emitidos.', depende: ['nucleo'] },
  { id: 'ia', nome: 'IA', resumo: 'Lançar venda pelo voucher e perguntar ao financeiro em texto.', depende: ['nucleo'] },
  { id: 'asaas_unificado', nome: 'Asaas unificado', resumo: 'Quando a agência usa o Asaas no CRM e no Financeiro, o Financeiro fica com a conexão.', depende: ['nucleo', 'cobranca'] },
] as const;

export type ModuloId = (typeof MODULOS)[number]['id'];
export type VersaoDaConta = 'simples' | 'completa';

const IDS = new Set<string>(MODULOS.map(m => m.id));
export const ehModulo = (v: unknown): v is ModuloId => typeof v === 'string' && IDS.has(v);

export interface ModulosDaConta {
  /** 'completa' quando a agência foi posta inteira na versão completa. */
  versao: VersaoDaConta;
  /** Módulos ligados, já com as dependências conferidas. */
  ligados: ModuloId[];
  /** Telas compartilhadas (pagar, receber, DRE...) abrem na versão completa? */
  telasCompletas: boolean;
}

export const SEM_MODULOS: ModulosDaConta = { versao: 'simples', ligados: [], telasCompletas: false };

/** Os módulos liberados para todas, a partir de saas_config.data. */
export function liberadosParaTodas(data: unknown): ModuloId[] {
  const lista = data && typeof data === 'object' ? (data as Record<string, unknown>).modulos : null;
  return Array.isArray(lista) ? lista.filter(ehModulo) : [];
}

/**
 * Decide os módulos de uma agência: tenants.data + liberados para todas.
 * Exceção da agência vence a liberação geral (false desliga só nela).
 */
export function modulosDosDados(dataDaConta: unknown, liberados: readonly ModuloId[] = []): ModulosDaConta {
  const d = (dataDaConta && typeof dataDaConta === 'object' ? dataDaConta : {}) as Record<string, unknown>;
  if (d.fin_versao === 'completa') {
    return { versao: 'completa', ligados: MODULOS.map(m => m.id), telasCompletas: true };
  }
  const excecoes = (d.modulos && typeof d.modulos === 'object' ? d.modulos : {}) as Record<string, unknown>;
  const pedidos = new Set<ModuloId>(liberados);
  for (const [id, v] of Object.entries(excecoes)) {
    if (!ehModulo(id)) continue;
    if (v === true) pedidos.add(id);
    if (v === false) pedidos.delete(id);
  }
  // Dependência desligada derruba o módulo (em ordem do catálogo: o núcleo vem primeiro).
  const ligados: ModuloId[] = [];
  for (const m of MODULOS) {
    if (pedidos.has(m.id) && m.depende.every(dep => ligados.includes(dep))) ligados.push(m.id);
  }
  return { versao: 'simples', ligados, telasCompletas: ligados.includes('nucleo') };
}

export const moduloLigado = (m: Pick<ModulosDaConta, 'ligados'> | null | undefined, id: ModuloId): boolean =>
  Boolean(m && m.ligados.includes(id));

/** Valida o que o Super Admin manda gravar na agência. */
export function lerPedidoDaConta(v: unknown): { fin_versao: VersaoDaConta; modulos: Partial<Record<ModuloId, boolean>> } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const fin_versao: VersaoDaConta = o.fin_versao === 'completa' ? 'completa' : 'simples';
  const modulos: Partial<Record<ModuloId, boolean>> = {};
  if (o.modulos && typeof o.modulos === 'object') {
    for (const [id, val] of Object.entries(o.modulos as Record<string, unknown>)) {
      if (ehModulo(id) && typeof val === 'boolean') modulos[id] = val;
    }
  }
  return { fin_versao, modulos };
}

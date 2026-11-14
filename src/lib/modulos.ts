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

// ═══════════════════════════════════════════════════════════════════════
// CATÁLOGO DE ROTAS (14/11/2026): o que é só da versão completa, por módulo.
//
// Prefixos relativos a src/app, com '[x]' valendo qualquer segmento. Cada
// prefixo pertence a UM módulo. A agência sem o módulo recebe 404 na rota
// (guarda-rota.ts: recusaModulo) e na tela (guarda-tela.ts, no layout da
// pasta). O teste scripts/test-modulos-rotas.ts percorre src/app e falha se
// uma rota ou tela da completa ficar sem guarda, se a guarda for de outro
// módulo, ou se uma rota da versão simples cair num prefixo de módulo.
//
// `publica`: rota sem sessão (link do cliente). Ela confere o módulo da
// AGÊNCIA DONA do token (recusaModuloDaAgencia), nunca o de quem abriu.
// ═══════════════════════════════════════════════════════════════════════

export interface RotaDoModulo {
  prefixo: string;
  modulo: ModuloId;
  publica?: boolean;
}

const rotas = (modulo: ModuloId, prefixos: string[], publica?: boolean): RotaDoModulo[] =>
  prefixos.map(prefixo => (publica ? { prefixo, modulo, publica } : { prefixo, modulo }));

/** Rotas de API só da versão completa. */
export const APIS_DOS_MODULOS: readonly RotaDoModulo[] = [
  ...rotas('nucleo', [
    '/api/aprovacoes', '/api/baixas', '/api/centros-custo', '/api/config/financeiro', '/api/contas-pagar-receber',
    '/api/contas-pagar/[id]/restaurar', '/api/contas-receber/[id]/restaurar', '/api/encargos-da-liquidacao',
    '/api/formas-pagamento', '/api/historico', '/api/leitura-documento', '/api/limites-e-aprovacao',
    '/api/movimentos-caixa', '/api/perfis-de-acesso', '/api/periodos', '/api/permissoes/minhas',
    '/api/plano-contas/juntar', '/api/preferencias', '/api/recorrencias', '/api/regras-rateio',
    '/api/sugestao-categoria', '/api/titulos', '/api/v1/sites/reconciliacao',
  ]),
  ...rotas('cobranca', ['/api/cobrancas', '/api/config/cobranca', '/api/portal-links', '/api/recibos']),
  ...rotas('cobranca', ['/api/portal'], true),
  ...rotas('asaas_unificado', ['/api/plataformas/asaas-crm']),
  ...rotas('mudanca', ['/api/mudanca']),
  ...rotas('venda', [
    '/api/vendas/completa', '/api/vendas/lista', '/api/config/vendas', '/api/faturas', '/api/regras-faturamento',
    '/api/fornecedores/acordos', '/api/fornecedores/comissoes', '/api/fornecedores/faturas', '/api/fornecedores/opcoes',
    '/api/fornecedores/regra-faturamento', '/api/fornecedores/sinais', '/api/fornecedores/taxa-cc',
    '/api/creditos-cliente', '/api/reembolsos',
  ]),
  ...rotas('comissoes', ['/api/comissoes-por-funcao', '/api/comissao-mrr', '/api/metas-mrr']),
  ...rotas('notas', ['/api/fiscal/gerar', '/api/fiscal/notas-config', '/api/fiscal/notas-externas', '/api/fiscal/regras', '/api/fiscal/retencoes']),
  ...rotas('cambio', ['/api/cambio', '/api/moedas']),
  ...rotas('extrato', ['/api/extrato-automatico', '/api/conciliacao/automatica', '/api/conferencia-operadora']),
  ...rotas('empresas', ['/api/empresas']),
  ...rotas('relatorios', ['/api/relatorios/agendados', '/api/relatorios/lancamentos', '/api/relatorios/vendas', '/api/exportacao']),
  ...rotas('relatorios', ['/api/leitura'], true),
  ...rotas('cheques', ['/api/cheques']),
  ...rotas('ia', ['/api/perguntar', '/api/vendas/voucher']),
];

/** Telas só da versão completa (o layout da pasta do prefixo confere o módulo). */
export const TELAS_DOS_MODULOS: readonly RotaDoModulo[] = [
  ...rotas('nucleo', [
    '/financeiro-ag/aprovacoes', '/financeiro-ag/centros-custo', '/financeiro-ag/contas', '/financeiro-ag/extrato',
    '/financeiro-ag/fechamento', '/financeiro-ag/formas-pagamento', '/financeiro-ag/movimentacoes',
    '/config/financeiro', '/config/limites-e-aprovacao', '/config/perfis-de-acesso',
  ]),
  ...rotas('cobranca', ['/financeiro-ag/cobrancas', '/config/cobranca', '/recibo']),
  // Portal do cliente: a tela é uma casca que lê /api/portal/<token>, e é a
  // rota que confere a agência dona do link (a pessoa vê "Este link não abre mais").
  ...rotas('cobranca', ['/c/[token]'], true),
  ...rotas('mudanca', ['/mudanca']),
  ...rotas('venda', [
    '/financeiro-ag/creditos', '/financeiro-ag/faturas', '/financeiro-ag/fornecedores', '/financeiro-ag/reembolsos',
    '/financeiro-ag/regras-faturamento', '/config/vendas', '/vendas/[id]/ficha', '/vendas/[id]/nota-de-debito', '/vendas/lancar',
  ]),
  ...rotas('ia', ['/vendas/lancar/voucher', '/financeiro-ag/perguntar']),
  ...rotas('comissoes', [
    '/equipe/fechar-comissoes', '/equipe/funcoes', '/equipe/metas-por-funcao', '/equipe/minhas-comissoes',
    '/equipe/pagar-comissoes', '/equipe/planos-por-funcao', '/equipe/mrr', '/config/comissoes',
  ]),
  ...rotas('notas', ['/financeiro-ag/notas/gerar', '/financeiro-ag/notas/regras', '/financeiro-ag/notas/retencoes']),
  ...rotas('cambio', ['/financeiro-ag/moedas']),
  ...rotas('extrato', ['/financeiro-ag/extrato-automatico', '/financeiro-ag/conferencia-operadora', '/financeiro-ag/conciliacao/automatica']),
  ...rotas('empresas', ['/config/empresas']),
  ...rotas('relatorios', ['/financeiro-ag/relatorios', '/financeiro-ag/resultado-por-categoria', '/relatorios/vendas', '/relatorios/envios']),
  // Link de leitura de relatório: casca que lê /api/leitura/<token> (a rota confere a agência dona).
  ...rotas('relatorios', ['/r/[token]'], true),
  ...rotas('cheques', ['/financeiro-ag/cheques']),
];

/**
 * Rotas e telas que vieram com a versão completa mas NÃO são de módulo: valem
 * para todas as agências (motor, segurança) ou são da plataforma. Cada uma
 * com o motivo; o teste exige que toda rota nova da completa esteja num
 * prefixo de módulo ou aqui.
 */
export const ROTAS_SEM_MODULO: readonly { prefixo: string; motivo: string }[] = [
  { prefixo: '/api/admin', motivo: 'Painel da plataforma (Super Admin e CS), fora das agências.' },
  { prefixo: '/admin', motivo: 'Painel da plataforma (Super Admin e CS), fora das agências.' },
  { prefixo: '/api/agendador', motivo: 'Motor: chamada do agendador (segredo próprio); cada tarefa confere o módulo dela.' },
  { prefixo: '/api/arquivos', motivo: 'Segurança (FIN-08): documento enviado por qualquer agência fica na pasta privada e abre por aqui.' },
  { prefixo: '/api/arquivos-link', motivo: 'Segurança (FIN-08): link assinado do documento privado, de qualquer agência.' },
];

/** O caminho (URL ou pasta de src/app) casa com o prefixo, segmento a segmento? */
export function casaComPrefixo(prefixo: string, caminho: string): boolean {
  const p = prefixo.split('/').filter(Boolean);
  const c = caminho.split('?')[0].split('#')[0].split('/').filter(Boolean);
  if (c.length < p.length) return false;
  return p.every((seg, i) => (seg.startsWith('[') && seg.endsWith(']')) || seg === c[i]);
}

function maisEspecifico(lista: readonly RotaDoModulo[], caminho: string): RotaDoModulo | null {
  let achado: RotaDoModulo | null = null;
  for (const it of lista) {
    if (!casaComPrefixo(it.prefixo, caminho)) continue;
    if (!achado || it.prefixo.split('/').length > achado.prefixo.split('/').length) achado = it;
  }
  return achado;
}

/** O módulo de uma rota de API (null = vale para todas). */
export const rotaDaApi = (caminho: string): RotaDoModulo | null => maisEspecifico(APIS_DOS_MODULOS, caminho);
/** A tela e o módulo dela (null = vale para todas). O mais específico vence: /vendas/lancar/voucher é da IA. */
export const rotaDaTela = (caminho: string): RotaDoModulo | null => maisEspecifico(TELAS_DOS_MODULOS, caminho);
export const moduloDaTela = (caminho: string): ModuloId | null => rotaDaTela(caminho)?.modulo ?? null;

/** A tela abre para esta agência? (menu, ⌘K e atalhos mostram só o que ela pode abrir). */
export function telaLiberada(m: Pick<ModulosDaConta, 'ligados'> | null | undefined, caminho: string): boolean {
  const id = moduloDaTela(caminho);
  return !id || moduloLigado(m, id);
}

// ═══════════════════════════════════════════════════════════════════════
// AVISOS DO SINO E TAREFAS AUTOMÁTICAS
// ═══════════════════════════════════════════════════════════════════════

/** Tipos de aviso que só existem com um módulo (o sino da agência sem ele não os lista). */
export const MODULO_DO_AVISO: Readonly<Record<string, ModuloId>> = {
  FATURA_FORNECEDOR_PRONTA: 'venda',
  VENDA_FECHADA_MUDANCA_CRM: 'venda',
  FATURA_CONTESTADA: 'venda',
  FATURA_APROVADA: 'venda',
  VENDA_CANCELADA_EM_FATURA: 'venda',
  APROVACAO_PEDIDA: 'nucleo',
  APROVACAO_DECIDIDA: 'nucleo',
  CONTAS_A_PAGAR_VENCENDO: 'nucleo',
  CONTAS_A_RECEBER_ATRASADAS: 'nucleo',
  CREDITO_CLIENTE_VENCENDO: 'venda',
  REEMBOLSO_NO_PRAZO: 'venda',
  RELATORIO_AGENDADO_PRONTO: 'relatorios',
  EXTRATO_AUTOMATICO: 'extrato',
  COBRANCA_PENDENCIA: 'cobranca',
  NOTA_RECUSADA: 'notas',
  VENDA_EMPRESA_NAO_ENCONTRADA: 'empresas',
  EXTRATO_OPERADORA_DO_CRM: 'extrato',
};

export function avisoLiberado(m: Pick<ModulosDaConta, 'ligados'> | null | undefined, tipo: string): boolean {
  const id = MODULO_DO_AVISO[tipo];
  return !id || moduloLigado(m, id);
}

/**
 * Tarefas do agendador (src/lib/agendador/tarefas.ts) e o módulo de cada uma.
 *
 * 'motor' roda para todas as agências: o caixa de TODAS passa pelo razão,
 * então abrir e conferir o razão não é de módulo; a fila também é do motor
 * (ela confere cada tarefa pelo tipo, MODULO_DO_TIPO_NA_FILA). O resto só
 * roda nas agências com o módulo. Tarefa global (sem agência, como as
 * cotações do câmbio) continua global.
 */
export const MODULO_DA_TAREFA: Readonly<Record<string, ModuloId | 'motor'>> = {
  'razao-abertura': 'motor',
  'razao-conferencia': 'motor',
  fila: 'motor',
  'recorrencia-gerar': 'nucleo',
  'avisos-vencimento': 'nucleo',
  'cobranca-regua': 'cobranca',
  'cambio-cotacoes': 'cambio',
  'faturas-fornecedor': 'venda',
  'notas-por-gatilho': 'notas',
  'comissoes-calculo': 'comissoes',
  'creditos-e-reembolsos': 'venda',
  'faturas-montar': 'venda',
  'extrato-automatico': 'extrato',
  'acompanhar-notas-na-prefeitura': 'notas',
  'relatorios-agendados': 'relatorios',
  'liquidar-automaticamente': 'venda',
  'comissao-paga-crm': 'comissoes',
};

/** Tipos da fila de tarefas por agência e o módulo de cada um. Tipo fora daqui é do motor. */
export const MODULO_DO_TIPO_NA_FILA: Readonly<Record<string, ModuloId>> = {
  cobranca_emitir: 'cobranca',
  cobranca_atualizar: 'cobranca',
  nota_por_gatilho: 'notas',
  'migracao-aplicar': 'mudanca',
};

// ═══════════════════════════════════════════════════════════════════════
// SUPER ADMIN
// ═══════════════════════════════════════════════════════════════════════

/** A liberação geral com `id` ligado (ou tirado), na ordem do catálogo. */
export function liberadosCom(liberados: readonly ModuloId[], id: ModuloId, ligar: boolean): ModuloId[] {
  const s = new Set<ModuloId>(liberados);
  if (ligar) s.add(id); else s.delete(id);
  return MODULOS.map(m => m.id).filter(x => s.has(x));
}

/** Quantas agências ganham ou perdem `id` se a liberação geral passar de `antes` para `depois`. */
export function agenciasQueMudam(datas: readonly unknown[], antes: readonly ModuloId[], depois: readonly ModuloId[], id: ModuloId): number {
  let n = 0;
  for (const d of datas) {
    if (moduloLigado(modulosDosDados(d, antes), id) !== moduloLigado(modulosDosDados(d, depois), id)) n++;
  }
  return n;
}

/** O que a ficha da agência mostra em cada módulo: padrão (segue o geral), ligado ou desligado. */
export type EscolhaDoModulo = 'padrao' | 'ligado' | 'desligado';
export function escolhaDoModulo(dataDaConta: unknown, id: ModuloId): EscolhaDoModulo {
  const d = (dataDaConta && typeof dataDaConta === 'object' ? dataDaConta : {}) as Record<string, unknown>;
  const v = (d.modulos && typeof d.modulos === 'object' ? d.modulos as Record<string, unknown> : {})[id];
  return v === true ? 'ligado' : v === false ? 'desligado' : 'padrao';
}

/**
 * Confere o pedido do Super Admin antes de gravar (lerPedidoDaConta só
 * normaliza): versão só 'simples' ou 'completa'; módulos só do catálogo,
 * com true (ligado) ou false (desligado); fora da lista = padrão.
 */
export function erroDoPedidoDaConta(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'Pedido inválido.';
  const o = v as Record<string, unknown>;
  if ('fin_versao' in o && o.fin_versao !== 'simples' && o.fin_versao !== 'completa') return 'Versão inválida: use simples ou completa.';
  if ('modulos' in o) {
    if (!o.modulos || typeof o.modulos !== 'object' || Array.isArray(o.modulos)) return 'Módulos inválidos.';
    for (const [id, val] of Object.entries(o.modulos as Record<string, unknown>)) {
      if (!ehModulo(id)) return `Módulo desconhecido: ${id}.`;
      if (typeof val !== 'boolean') return `Escolha inválida no módulo ${id}: use ligado, desligado ou padrão.`;
    }
  }
  return null;
}

const rotuloDaEscolha = (e: EscolhaDoModulo) => (e === 'ligado' ? 'ligado' : e === 'desligado' ? 'desligado' : 'padrão');

/** O que mudou, em frases (para a auditoria da plataforma). */
export function mudancasDaConta(antes: unknown, depois: unknown): string[] {
  const versao = (d: unknown) => ((d && typeof d === 'object' ? (d as Record<string, unknown>).fin_versao : null) === 'completa' ? 'completa' : 'simples');
  const frases: string[] = [];
  if (versao(antes) !== versao(depois)) frases.push(`versão ${versao(antes)} → ${versao(depois)}`);
  for (const m of MODULOS) {
    const a = escolhaDoModulo(antes, m.id), b = escolhaDoModulo(depois, m.id);
    if (a !== b) frases.push(`${m.nome}: ${rotuloDaEscolha(a)} → ${rotuloDaEscolha(b)}`);
  }
  return frases;
}

/** Os nomes das dependências de um módulo, para a tela do Super Admin. */
export function nomesDasDependencias(id: ModuloId): string[] {
  const m = MODULOS.find(x => x.id === id);
  return (m?.depende ?? []).map(dep => MODULOS.find(x => x.id === dep)?.nome ?? dep);
}

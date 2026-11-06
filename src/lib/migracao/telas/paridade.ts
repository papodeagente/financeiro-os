/**
 * E4 · Mudança — Checklist de paridade (05/11/2026). Lista pura, sem React.
 *
 * Os 15 blocos do mapa tela a tela do plano do Financeiro: para cada um,
 * o que já existe e onde fica (com link para a tela), e o que ainda vem e
 * em qual entrega. A situação de cada bloco NÃO é escrita à mão: sai de
 * `montarChecklist`, pela entrega de cada item comparada com a entrega no ar.
 * Quando uma entrega publicar, basta subir `ENTREGA_NO_AR` (e dar o href aos
 * itens que ganharam tela): o checklist se refaz sozinho.
 *
 * Nomes de mercado e nossos. Nenhum nome de tela do sistema anterior que
 * esteja na lista proibida (docs/programa/e2-contratos.md, regra 3).
 */

/** Entregas do plano. 'hoje' = já existia antes do plano. */
export type Entrega = 'hoje' | 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6' | 'E7';

/**
 * A última entrega publicada (esta tela saiu com a E4). Quem publicar a E5,
 * a E6 e a E7 sobe este valor: os itens delas já têm o link da tela.
 */
export const ENTREGA_NO_AR: Entrega = 'E7';

export const O_QUE_TRAZ_A_ENTREGA: Record<Exclude<Entrega, 'hoje'>, string> = {
  E1: 'Base que protege o número',
  E2: 'Dia a dia',
  E3: 'Cobrança',
  E4: 'Mudança de sistema',
  E5: 'Venda e turismo',
  E6: 'Câmbio, banco e integrações',
  E7: 'Mudança completa e paridade final',
};

export interface ItemDaParidade {
  /** O que a agência faz, em palavras nossas. */
  rotulo: string;
  entrega: Entrega;
  /** Onde fica aqui. Obrigatório quando já existe (o teste confere). */
  href?: string;
  /**
   * O que ainda falta para o item valer por inteiro, mesmo com a entrega no
   * ar (ex.: depende de uma chave, do contador ou de arquivo real). Item com
   * falta não conta como pronto.
   */
  falta?: string;
}

export interface BlocoDaParidade {
  numero: number;
  titulo: string;
  /** Uma frase: o que este bloco cobre. */
  resumo: string;
  itens: ItemDaParidade[];
}

export const BLOCOS_DA_PARIDADE: readonly BlocoDaParidade[] = [
  {
    numero: 1, titulo: 'Contas a Pagar/Receber', resumo: 'A lista de contas, liquidação, lote, recorrência e aprovação.',
    itens: [
      { rotulo: 'Lista única de contas a pagar e a receber, com filtros, colunas salvas e totais', entrega: 'E2', href: '/financeiro-ag/contas' },
      { rotulo: 'Liquidar com data escolhida, juros, multa e desconto, várias baixas e estorno', entrega: 'E2', href: '/financeiro-ag/contas' },
      { rotulo: 'Ações em lote com prévia (liquidar, reagendar, recategorizar)', entrega: 'E2', href: '/financeiro-ag/contas' },
      { rotulo: 'Recorrência flexível e Mais parcelas', entrega: 'E2', href: '/financeiro-ag/pagar' },
      { rotulo: 'Ler boleto ou nota em PDF e preencher a conta', entrega: 'E2', href: '/financeiro-ag/pagar' },
      { rotulo: 'Mudança provada com os arquivos reais de uma agência que usa o sistema anterior', entrega: 'E7', href: '/mudanca', falta: 'Precisa dos arquivos exportados por uma agência parceira (os testes usam planilhas montadas).' },
      { rotulo: 'Pedido de aprovação no lugar do bloqueio', entrega: 'E2', href: '/financeiro-ag/aprovacoes' },
      { rotulo: 'Telas separadas de Contas a pagar e Contas a receber', entrega: 'hoje', href: '/financeiro-ag/receber' },
      { rotulo: 'Contas já liquidadas trazidas do sistema anterior, na data e na conta certas, sem dinheiro em dobro', entrega: 'E7', href: '/mudanca' },
      { rotulo: 'Mês em paralelo: as listas do mês de lá comparadas com as daqui, sem gravar', entrega: 'E7', href: '/mudanca' },
    ],
  },
  {
    numero: 2, titulo: 'Contas, caixa e cartões', resumo: 'Contas bancárias, extrato, movimentações, transferência e Fechar Caixa.',
    itens: [
      { rotulo: 'Contas bancárias e caixa', entrega: 'hoje', href: '/financeiro-ag/contas-bancarias' },
      { rotulo: 'Cartão corporativo com fatura lida por IA', entrega: 'hoje', href: '/financeiro-ag/cartoes' },
      { rotulo: 'Transferências entre contas', entrega: 'hoje', href: '/financeiro-ag/transferencias' },
      { rotulo: 'Conciliação por arquivo do banco (OFX ou CSV)', entrega: 'hoje', href: '/financeiro-ag/conciliacao' },
      { rotulo: 'Extrato de conta com várias contas e saldo linha a linha', entrega: 'E2', href: '/financeiro-ag/extrato' },
      { rotulo: 'Movimentações de todas as contas', entrega: 'E2', href: '/financeiro-ag/movimentacoes' },
      { rotulo: 'Fechar Caixa que trava de verdade e reabre com motivo', entrega: 'E2', href: '/financeiro-ag/fechamento' },
      { rotulo: 'Permissão por conta bancária', entrega: 'E2', href: '/config/perfis-de-acesso' },
      { rotulo: 'Saldo de abertura trazido do sistema anterior', entrega: 'E4', href: '/mudanca' },
      { rotulo: 'Extrato e movimentações antigos trazidos, ligados às liquidações', entrega: 'E7', href: '/mudanca' },
      { rotulo: 'Conta em moeda estrangeira e transferência com câmbio', entrega: 'E6', href: '/financeiro-ag/transferencias' },
      { rotulo: 'Extrato do banco automático', entrega: 'E6', href: '/financeiro-ag/extrato-automatico', falta: 'Hoje só para o Banco Inter. Os outros bancos dependem de contratar o provedor de extrato.' },
    ],
  },
  {
    numero: 3, titulo: 'Categorias, centros de custo e rateio', resumo: 'Plano de contas, centros, rateio e os relatórios de cada um.',
    itens: [
      { rotulo: 'Categorias em árvore, com repasse e juntar categorias', entrega: 'E2', href: '/financeiro-ag/plano-contas' },
      { rotulo: 'Centros de custo em árvore', entrega: 'E2', href: '/financeiro-ag/centros-custo' },
      { rotulo: 'Rateio por linha de categoria', entrega: 'E2', href: '/financeiro-ag/centros-custo' },
      { rotulo: 'Relatório por categoria', entrega: 'E2', href: '/financeiro-ag/relatorios/lancamentos-categoria' },
      { rotulo: 'Relatório por centro de custo', entrega: 'E2', href: '/financeiro-ag/relatorios/lancamentos-centro-custo' },
      { rotulo: 'Relatório por rateio', entrega: 'E2', href: '/financeiro-ag/relatorios/lancamentos-rateio' },
    ],
  },
  {
    numero: 4, titulo: 'Fluxo de caixa, DRE e visão geral', resumo: 'Os números do mês: fluxo, resultado e painel.',
    itens: [
      { rotulo: 'Visão geral do financeiro', entrega: 'hoje', href: '/financeiro-ag' },
      { rotulo: 'Lucro real', entrega: 'hoje', href: '/relatorios/lucro-real' },
      { rotulo: 'Fluxo de caixa previsto e realizado lado a lado', entrega: 'E2', href: '/financeiro-ag/fluxo-caixa' },
      { rotulo: 'DRE por competência ou por caixa', entrega: 'E2', href: '/financeiro-ag/dre' },
      { rotulo: 'Resultado por categoria em tabela dinâmica', entrega: 'E2', href: '/financeiro-ag/resultado-por-categoria' },
    ],
  },
  {
    numero: 5, titulo: 'Boletos, carnê e cobrança', resumo: 'Boleto e Pix pelo provedor da agência, sem arquivo de remessa nem de retorno.',
    itens: [
      { rotulo: 'Cobranças: boleto, Pix e carnê pelo Asaas ou Pagar.me da agência', entrega: 'E3', href: '/financeiro-ag/cobrancas', falta: 'Provado com provedor simulado. Falta uma rodada com a conta de uma agência no ambiente de testes do Asaas e do Pagar.me.' },
      { rotulo: 'Gerar boletos em lote e filtro Boleto não emitido', entrega: 'E3', href: '/financeiro-ag/contas' },
      { rotulo: 'O pagamento baixa a conta sozinho, com a taxa', entrega: 'E3', href: '/financeiro-ag/cobrancas' },
      { rotulo: 'Régua de lembretes por e-mail e WhatsApp', entrega: 'E3', href: '/config/cobranca', falta: 'O WhatsApp precisa do modelo de mensagem aprovado na Meta para cada agência.' },
      { rotulo: 'Recibo da conta recebida', entrega: 'E3', href: '/financeiro-ag/receber' },
      { rotulo: 'Portal do cliente com 2ª via e recibos', entrega: 'E3', href: '/pessoas/clientes' },
    ],
  },
  {
    numero: 6, titulo: 'Faturas ao cliente e regras de faturamento', resumo: 'Fatura corporativa por período, nota de débito e aprovação pelo cliente.',
    itens: [
      { rotulo: 'Regras de faturamento por cliente e fornecedor', entrega: 'E5', href: '/financeiro-ag/regras-faturamento' },
      { rotulo: 'Fatura do cliente: fechar, reabrir, mover itens, faturar avulso', entrega: 'E5', href: '/financeiro-ag/faturas' },
      { rotulo: 'Nota de débito e aprovação da fatura no portal', entrega: 'E5', href: '/financeiro-ag/faturas' },
      { rotulo: 'Regras de faturamento recriadas respondendo perguntas', entrega: 'E7', href: '/mudanca' },
      { rotulo: 'Faturas antigas trazidas para consulta', entrega: 'E7', href: '/mudanca/historico' },
    ],
  },
  {
    numero: 7, titulo: 'Venda (lado financeiro)', resumo: 'Produtos, passageiros, pagamentos e a receita de cada venda.',
    itens: [
      { rotulo: 'Contas da venda nascem sozinhas (vindas do CRM)', entrega: 'hoje', href: '/vendas' },
      { rotulo: 'Nova venda lançada no financeiro', entrega: 'hoje', href: '/vendas/nova' },
      { rotulo: 'Venda com passageiros, Taxa DU, RAV, Over e Fee', entrega: 'E5', href: '/vendas/lancar' },
      { rotulo: 'Posição da venda: cliente, fornecedor e receita', entrega: 'E5', href: '/vendas' },
      { rotulo: 'Vendas antigas trazidas completas (viagens futuras incluídas), sem gerar contas de novo', entrega: 'E7', href: '/vendas' },
    ],
  },
  {
    numero: 8, titulo: 'Fatura do fornecedor e comissão do fornecedor', resumo: 'O que pagar a cada fornecedor e a comissão esperada.',
    itens: [
      { rotulo: 'Fornecedores', entrega: 'hoje', href: '/pessoas/fornecedores' },
      { rotulo: 'Fatura do fornecedor com o quanto o cliente já pagou', entrega: 'E5', href: '/financeiro-ag/fornecedores/faturas' },
      { rotulo: 'Sinal ao fornecedor com saldo a compensar', entrega: 'E5', href: '/financeiro-ag/fornecedores/sinais' },
      { rotulo: 'Acordos de comissão com vigência e comissão esperada × recebida', entrega: 'E5', href: '/financeiro-ag/fornecedores/acordos' },
    ],
  },
  {
    numero: 9, titulo: 'Cancelamento, reembolso e crédito do cliente', resumo: 'O que acontece com o dinheiro quando a viagem muda.',
    itens: [
      { rotulo: 'Cancelar as contas em aberto da venda', entrega: 'hoje', href: '/vendas' },
      { rotulo: 'Cancelamento por passageiro com multa do fornecedor', entrega: 'E5', href: '/vendas' },
      { rotulo: 'Reembolsos com situação e prazo', entrega: 'E5', href: '/financeiro-ag/reembolsos' },
      { rotulo: 'Carteira de crédito do cliente', entrega: 'E5', href: '/financeiro-ag/creditos' },
      { rotulo: 'Reembolsos em aberto e créditos de clientes trazidos do sistema anterior', entrega: 'E7', href: '/financeiro-ag/creditos' },
    ],
  },
  {
    numero: 10, titulo: 'Notas fiscais e retenções', resumo: 'NFS-e, regras da nota e retenções na fonte.',
    itens: [
      { rotulo: 'NFS-e no padrão nacional', entrega: 'hoje', href: '/financeiro-ag/notas' },
      { rotulo: 'Configuração fiscal da agência', entrega: 'hoje', href: '/config/fiscal' },
      { rotulo: 'Gerar notas por regra e nota complementar', entrega: 'E5', href: '/financeiro-ag/notas/gerar' },
      { rotulo: 'Retenções na fonte (Lei 9.430)', entrega: 'E5', href: '/financeiro-ag/notas/retencoes', falta: 'Valor mínimo para reter e restituição de retenção: confirmar com o contador.' },
      { rotulo: 'Campos da reforma tributária (IBS e CBS) na nota', entrega: 'E5', href: '/config/fiscal', falta: 'Regras e alíquotas a confirmar com o contador.' },
      { rotulo: 'Notas já emitidas trazidas para consulta (nunca emitidas de novo)', entrega: 'E7', href: '/mudanca/historico' },
    ],
  },
  {
    numero: 11, titulo: 'Comissões e metas', resumo: 'Planos, metas, fechar e pagar comissões.',
    itens: [
      { rotulo: 'Planos de comissão com faixas', entrega: 'hoje', href: '/equipe/planos-comissao' },
      { rotulo: 'Comissões do mês', entrega: 'hoje', href: '/equipe/comissoes' },
      { rotulo: 'Metas da equipe', entrega: 'hoje', href: '/equipe/metas' },
      { rotulo: 'Fechar e pagar comissões no servidor, com prévia', entrega: 'E5', href: '/equipe/fechar-comissoes' },
      { rotulo: 'Painel do vendedor no celular', entrega: 'E5', href: '/equipe/minhas-comissoes' },
      { rotulo: 'Planos de comissão recriados respondendo perguntas', entrega: 'E7', href: '/mudanca' },
      { rotulo: 'Comissões já pagas e metas trazidas do sistema anterior', entrega: 'E7', href: '/mudanca/historico' },
    ],
  },
  {
    numero: 12, titulo: 'Formas de pagamento, moedas e câmbio', resumo: 'Como o dinheiro entra e sai, em reais ou em outra moeda.',
    itens: [
      { rotulo: 'Formas de pagamento, com Pix', entrega: 'E2', href: '/financeiro-ag/formas-pagamento' },
      { rotulo: 'Câmbio sugerido ao vivo, sempre editável', entrega: 'E6', href: '/financeiro-ag/moedas', falta: 'A PTAX já está ao vivo. O câmbio turismo liga quando a chave da AwesomeAPI for cadastrada no cofre do Super Admin.' },
      { rotulo: 'Moedas e variação cambial', entrega: 'E6', href: '/financeiro-ag/moedas' },
      { rotulo: 'Lista oficial de bancos', entrega: 'E6', href: '/financeiro-ag/contas-bancarias' },
    ],
  },
  {
    numero: 13, titulo: 'Integrações e conferência com operadoras', resumo: 'O que chega sozinho de fora e a conferência com a operadora.',
    itens: [
      { rotulo: 'Recebimentos das plataformas (Asaas, Pagar.me, Hotmart)', entrega: 'hoje', href: '/financeiro-ag/recebimentos' },
      { rotulo: 'Integração com o CRM', entrega: 'hoje', href: '/config/crm' },
      { rotulo: 'Conferência de extrato de qualquer operadora', entrega: 'E6', href: '/financeiro-ag/conferencia-operadora' },
    ],
  },
  {
    numero: 14, titulo: 'Configurações, permissões e registro', resumo: 'Quem pode fazer o quê e o que foi feito.',
    itens: [
      { rotulo: 'Usuários e papéis', entrega: 'hoje', href: '/config/usuarios' },
      { rotulo: 'Perfis de acesso com contas bancárias liberadas', entrega: 'E2', href: '/config/perfis-de-acesso' },
      { rotulo: 'Limites e aprovação', entrega: 'E2', href: '/config/limites-e-aprovacao' },
      { rotulo: 'Configurações do financeiro por seção', entrega: 'E2', href: '/config/financeiro' },
      { rotulo: 'Registro de atividades com antes e depois', entrega: 'E2', href: '/config/auditoria' },
    ],
  },
  {
    numero: 15, titulo: 'Relatórios de vendas', resumo: 'Vendas por produto, vendedor, forma de pagamento e ranking.',
    itens: [
      { rotulo: 'Vendas fechadas', entrega: 'hoje', href: '/vendas' },
      { rotulo: 'Rentabilidade', entrega: 'hoje', href: '/relatorios/rentabilidade' },
      { rotulo: 'Vendas por produto, vendedor, empresa e forma de pagamento', entrega: 'E5', href: '/relatorios/vendas' },
      { rotulo: 'Ranking de clientes e tabela dinâmica de vendas', entrega: 'E5', href: '/relatorios/vendas' },
      { rotulo: 'Vendas antigas nos relatórios, com a receita por mês provada', entrega: 'E7', href: '/relatorios/vendas' },
    ],
  },
];

const ORDEM: readonly Entrega[] = ['hoje', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7'];

/** O item já está no ar, dada a entrega publicada? */
export function itemNoAr(entrega: Entrega, noAr: Entrega = ENTREGA_NO_AR): boolean {
  return ORDEM.indexOf(entrega) <= ORDEM.indexOf(noAr);
}

export type SituacaoDoBloco = 'pronto' | 'parcial' | 'vem';

export interface ItemMontado extends ItemDaParidade { pronto: boolean; noAr: boolean }

export interface BlocoMontado extends Omit<BlocoDaParidade, 'itens'> {
  itens: ItemMontado[];
  situacao: SituacaoDoBloco;
  prontos: number;
  /** Entregas que ainda faltam para fechar o bloco, em ordem. */
  faltam: Entrega[];
}

export interface ChecklistMontado {
  blocos: BlocoMontado[];
  itensProntos: number;
  itensTotal: number;
  blocosProntos: number;
  /** Itens no ar que ainda dependem de algo (chave, contador, arquivo real). */
  comFalta: number;
  /** Quantos itens chegam em cada entrega futura. */
  porEntrega: Array<{ entrega: Entrega; itens: number }>;
}

/** Monta o checklist a partir dos blocos do plano e da entrega no ar. */
export function montarChecklist(blocos: readonly BlocoDaParidade[] = BLOCOS_DA_PARIDADE, noAr: Entrega = ENTREGA_NO_AR): ChecklistMontado {
  const futuras = new Map<Entrega, number>();
  const montados = blocos.map<BlocoMontado>(b => {
    const itens = b.itens.map(i => {
      const estaNoAr = itemNoAr(i.entrega, noAr);
      return { ...i, noAr: estaNoAr, pronto: estaNoAr && !i.falta };
    });
    const prontos = itens.filter(i => i.pronto).length;
    const faltam = [...new Set(itens.filter(i => !i.noAr).map(i => i.entrega))].sort((x, y) => ORDEM.indexOf(x) - ORDEM.indexOf(y));
    for (const i of itens) if (!i.noAr) futuras.set(i.entrega, (futuras.get(i.entrega) ?? 0) + 1);
    const situacao: SituacaoDoBloco = prontos === itens.length ? 'pronto' : prontos === 0 ? 'vem' : 'parcial';
    return { numero: b.numero, titulo: b.titulo, resumo: b.resumo, itens, situacao, prontos, faltam };
  });
  const itensTotal = montados.reduce((s, b) => s + b.itens.length, 0);
  const itensProntos = montados.reduce((s, b) => s + b.prontos, 0);
  return {
    blocos: montados,
    itensProntos,
    itensTotal,
    blocosProntos: montados.filter(b => b.situacao === 'pronto').length,
    comFalta: montados.reduce((s, b) => s + b.itens.filter(i => i.noAr && i.falta).length, 0),
    porEntrega: [...futuras.entries()].sort((a, b) => ORDEM.indexOf(a[0]) - ORDEM.indexOf(b[0])).map(([entrega, itens]) => ({ entrega, itens })),
  };
}

/** "Chega na E5 · Venda e turismo" */
export function rotuloDaEntrega(e: Entrega): string {
  return e === 'hoje' ? 'Já existia' : `${e} · ${O_QUE_TRAZ_A_ENTREGA[e]}`;
}

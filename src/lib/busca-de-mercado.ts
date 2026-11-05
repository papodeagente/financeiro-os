/**
 * Busca por termos de mercado (05/11/2026) — lista pura, sem React.
 *
 * Quem vem de outro sistema financeiro procura pelo nome que já usa:
 * "retorno do banco", "remessa", "baixar boleto", "retenção", "câmbio",
 * "conferir depósito", "fechar caixa"... Cada termo leva à tela certa e,
 * quando aqui o processo é diferente, diz isso numa frase curta.
 *
 * Só termos comuns do mercado financeiro e de turismo. Nenhum nome de tela
 * ou frase exclusiva de outro sistema (lista proibida em
 * docs/programa/e2-contratos.md, regra 3; o teste confere).
 */

export interface DestinoDeMercado {
  /** Identificador estável (chave da lista na tela). */
  id: string;
  /** Como a pessoa costuma chamar (o primeiro é o principal). */
  termos: string[];
  href: string;
  /** Nome da tela aqui. */
  tela: string;
  /** Uma frase quando aqui funciona diferente. */
  frase?: string;
}

export const DESTINOS_DE_MERCADO: readonly DestinoDeMercado[] = [
  {
    id: 'retorno-banco', termos: ['retorno do banco', 'arquivo de retorno', 'retorno bancário', 'cnab'],
    href: '/financeiro-ag/recebimentos', tela: 'Recebimentos das plataformas',
    frase: 'Aqui não tem arquivo de retorno: o boleto pago pela plataforma de pagamento baixa a conta sozinho.',
  },
  {
    id: 'remessa', termos: ['remessa', 'arquivo de remessa', 'registrar boleto', 'enviar remessa'],
    href: '/financeiro-ag/receber', tela: 'Contas a receber',
    frase: 'Aqui não tem arquivo de remessa: o boleto é registrado na plataforma de pagamento na hora em que é criado.',
  },
  {
    id: 'baixar-boleto', termos: ['baixar boleto', 'baixa de boleto', 'boleto pago', 'boletos recebidos'],
    href: '/financeiro-ag/receber', tela: 'Contas a receber',
    frase: 'Aqui o pagamento do boleto baixa sozinho; acompanhe em Contas a receber.',
  },
  {
    id: 'retencao', termos: ['retenção', 'retenções', 'imposto retido', 'iss retido', 'ir retido', 'inss retido'],
    href: '/financeiro-ag/notas', tela: 'Notas fiscais',
    frase: 'ISS, IR e INSS retidos ficam na nota fiscal de cada serviço.',
  },
  {
    id: 'cambio', termos: ['câmbio', 'cotação', 'moeda estrangeira', 'dólar', 'euro', 'variação cambial'],
    href: '/financeiro-ag/pagar', tela: 'Contas a pagar',
    frase: 'A moeda e o câmbio são informados em cada conta a pagar em moeda estrangeira.',
  },
  {
    id: 'conferir-deposito', termos: ['conferir depósito', 'conferência de depósito', 'depósito identificado', 'conciliação bancária', 'conciliar', 'importar extrato', 'ofx'],
    href: '/financeiro-ag/conciliacao', tela: 'Conciliação',
    frase: 'Importe o extrato do banco e confira cada lançamento com as contas.',
  },
  {
    id: 'fechar-caixa', termos: ['fechar caixa', 'fechamento de caixa', 'fechamento do mês', 'travar período', 'reabrir caixa'],
    href: '/financeiro-ag/fechamento', tela: 'Fechar Caixa',
  },
  {
    id: 'extrato', termos: ['extrato', 'extrato de conta', 'extrato bancário', 'saldo da conta', 'saldo do banco'],
    href: '/financeiro-ag/extrato', tela: 'Extrato de conta',
  },
  {
    id: 'movimentacoes', termos: ['movimentações', 'movimentação de caixa', 'entradas e saídas', 'livro caixa'],
    href: '/financeiro-ag/movimentacoes', tela: 'Movimentações',
  },
  {
    id: 'contas-pagar', termos: ['contas a pagar', 'pagamentos', 'despesas', 'boletos a pagar', 'fornecedores a pagar'],
    href: '/financeiro-ag/pagar', tela: 'Contas a pagar',
  },
  {
    id: 'contas-receber', termos: ['contas a receber', 'recebimentos', 'cobrança', 'a receber de clientes'],
    href: '/financeiro-ag/receber', tela: 'Contas a receber',
  },
  {
    id: 'liquidar-pagar', termos: ['liquidar conta a pagar', 'liquidar', 'dar baixa', 'baixar conta', 'quitar', 'registrar pagamento'],
    href: '/financeiro-ag/pagar', tela: 'Contas a pagar',
    frase: 'Abra a conta e use "Registrar pagamento": dá para escolher a data, a conta, juros, multa e desconto.',
  },
  {
    id: 'liquidar-receber', termos: ['liquidar conta a receber', 'liquidar', 'dar baixa', 'baixar conta', 'quitar', 'registrar recebimento'],
    href: '/financeiro-ag/receber', tela: 'Contas a receber',
    frase: 'Abra a conta e use "Registrar recebimento": dá para escolher a data, a conta, juros, multa e desconto.',
  },
  {
    id: 'em-atraso', termos: ['em atraso', 'atrasados', 'inadimplência', 'inadimplentes', 'vencidos'],
    href: '/financeiro-ag/receber?status=ATRASADO', tela: 'Contas a receber em atraso',
  },
  {
    id: 'estorno', termos: ['estornar', 'estorno', 'desfazer baixa', 'cancelar pagamento'],
    href: '/financeiro-ag/pagar', tela: 'Contas a pagar',
    frase: 'No histórico de baixas da conta, cada pagamento ou recebimento pode ser estornado sozinho.',
  },
  {
    id: 'centro-custo', termos: ['centro de custo', 'centros de custo', 'filial', 'departamento'],
    href: '/financeiro-ag/centros-custo', tela: 'Centros de Custo',
  },
  {
    id: 'rateio', termos: ['rateio', 'ratear', 'dividir despesa', 'regra de rateio'],
    href: '/financeiro-ag/centros-custo', tela: 'Centros de Custo',
    frase: 'As regras de rateio ficam junto dos centros de custo; no lançamento, um clique aplica.',
  },
  {
    id: 'relatorio-rateio', termos: ['relatório de rateio', 'rateio por centro'],
    href: '/financeiro-ag/relatorios/lancamentos-rateio', tela: 'Relatório por rateio',
  },
  {
    id: 'categorias', termos: ['categoria', 'categorias', 'plano de contas', 'categoria financeira', 'categorias padrão'],
    href: '/financeiro-ag/plano-contas', tela: 'Categorias',
  },
  {
    id: 'formas', termos: ['forma de pagamento', 'formas de pagamento', 'pix', 'cartão de crédito', 'cartão de débito', 'taxa de cartão', 'taxa da maquininha'],
    href: '/financeiro-ag/formas-pagamento', tela: 'Formas de pagamento',
  },
  {
    id: 'transferencia', termos: ['transferência entre contas', 'transferência', 'ted entre contas', 'sangria', 'suprimento de caixa'],
    href: '/financeiro-ag/transferencias', tela: 'Transferências',
  },
  {
    id: 'fluxo', termos: ['fluxo de caixa', 'previsto e realizado', 'previsão de caixa', 'projeção de caixa'],
    href: '/financeiro-ag/fluxo-caixa', tela: 'Fluxo de caixa',
  },
  {
    id: 'dre', termos: ['dre', 'demonstrativo de resultado', 'resultado do mês', 'lucro do mês', 'regime de caixa', 'regime de competência'],
    href: '/financeiro-ag/dre', tela: 'DRE',
  },
  {
    id: 'resultado-categoria', termos: ['resultado por categoria', 'tabela dinâmica', 'gastos por categoria'],
    href: '/financeiro-ag/resultado-por-categoria', tela: 'Resultado por categoria',
  },
  {
    id: 'juros-multa', termos: ['juros', 'multa', 'juros e multa', 'desconto por antecipação', 'encargos'],
    href: '/config/financeiro', tela: 'Configurações do financeiro',
    frase: 'Aqui ficam os juros, a multa e o desconto que a liquidação sugere, e onde eles entram no resultado.',
  },
  {
    id: 'aprovacao', termos: ['aprovação de pagamento', 'aprovar pagamento', 'pedido de aprovação', 'alçada'],
    href: '/financeiro-ag/aprovacoes', tela: 'Aprovações',
  },
  {
    id: 'bloqueios', termos: ['bloqueio', 'bloqueios', 'limite de desconto', 'limites'],
    href: '/config/limites-e-aprovacao', tela: 'Limites e aprovação',
    frase: 'Aqui o que passa do limite vira pedido de aprovação em vez de travar.',
  },
  {
    id: 'permissoes', termos: ['permissões', 'perfil de acesso', 'perfis de acesso', 'direitos do usuário', 'liberar conta bancária'],
    href: '/config/perfis-de-acesso', tela: 'Perfis de acesso',
  },
  {
    id: 'log', termos: ['log', 'histórico de alterações', 'auditoria', 'quem alterou', 'registro de atividades'],
    href: '/config/auditoria', tela: 'Registro de atividades',
  },
  {
    id: 'nota-fiscal', termos: ['nota fiscal', 'nfs-e', 'nfse', 'emitir nota'],
    href: '/financeiro-ag/notas', tela: 'Notas fiscais',
  },
  {
    id: 'comissao', termos: ['comissão', 'comissões', 'pagar comissão', 'fechar comissão'],
    href: '/equipe/comissoes', tela: 'Comissões',
  },
  {
    id: 'cartao-corporativo', termos: ['cartão corporativo', 'cartão da empresa', 'fatura do cartão'],
    href: '/financeiro-ag/cartoes', tela: 'Cartões',
  },
  {
    id: 'contas-bancarias', termos: ['conta bancária', 'contas bancárias', 'banco', 'bancos', 'caixa'],
    href: '/financeiro-ag/contas-bancarias', tela: 'Contas bancárias',
  },
  {
    id: 'recorrente', termos: ['conta recorrente', 'despesa fixa', 'parcelar', 'parcelamento', 'repetir todo mês'],
    href: '/financeiro-ag/pagar', tela: 'Contas a pagar',
    frase: 'Ao lançar a conta, ligue "Repetir" para parcelar ou repetir todo mês.',
  },
  {
    id: 'taxas-recebimento', termos: ['taxa da plataforma', 'taxas de pagamento', 'taxa do boleto', 'custo do recebimento'],
    href: '/relatorios/taxas', tela: 'Taxas de pagamento',
  },
];

/** Minúsculas, sem acento e sem espaço sobrando. */
export function normalizarBusca(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface ResultadoDeMercado {
  destino: DestinoDeMercado;
  /** O termo que casou, como está na lista. */
  termo: string;
}

/**
 * Destinos cujo termo contém o que foi digitado (ou o contrário, para frase
 * longa como "onde faço o retorno do banco"). Ordem: começo de termo antes de
 * meio de termo, termo principal antes dos sinônimos. Precisa de 3 letras.
 */
export function buscarPorTermoDeMercado(consulta: string, limite = 6): ResultadoDeMercado[] {
  const q = normalizarBusca(consulta);
  if (q.length < 3) return [];
  const achados: Array<ResultadoDeMercado & { peso: number; ordem: number }> = [];
  DESTINOS_DE_MERCADO.forEach((d, ordem) => {
    let melhor: { termo: string; peso: number } | null = null;
    d.termos.forEach((termo, i) => {
      const t = normalizarBusca(termo);
      let peso = -1;
      if (t === q) peso = 0;
      else if (t.startsWith(q)) peso = 1;
      else if (t.split(' ').some(p => p.startsWith(q))) peso = 2;
      else if (q.length >= 5 && t.includes(q)) peso = 3;
      else if (t.length >= 4 && q.includes(t)) peso = 4;
      if (peso < 0) return;
      const total = peso * 10 + Math.min(i, 9);
      if (!melhor || total < melhor.peso) melhor = { termo, peso: total };
    });
    if (melhor) achados.push({ destino: d, termo: (melhor as { termo: string }).termo, peso: (melhor as { peso: number }).peso, ordem });
  });
  return achados
    .sort((a, b) => a.peso - b.peso || a.ordem - b.ordem)
    .slice(0, limite)
    .map(({ destino, termo }) => ({ destino, termo }));
}

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
    id: 'gerar-notas', termos: ['gerar notas', 'gerar notas fiscais', 'nota complementar', 'notas das vendas', 'nota da venda', 'nota para operadora'],
    href: '/financeiro-ag/notas/gerar', tela: 'Gerar notas',
    frase: 'Cada venda mostra a receita, o que já está em nota e o saldo; o saldo vira nota pela regra, com prévia.',
  },
  {
    id: 'regras-da-nota', termos: ['regra da nota', 'regras da nota', 'regras de nota fiscal', 'nota ao fornecedor', 'nota ao representante', 'emissão automática de nota'],
    href: '/financeiro-ag/notas/regras', tela: 'Regras da nota',
    frase: 'Para quem sai nota (pagante, fornecedor, representante), sobre quais componentes e quando sai sozinha.',
  },
  {
    id: 'retencoes-na-fonte', termos: ['retenções na fonte', 'retenção na fonte', 'lei 9.430', 'irrf retido', 'csll retida', 'pis cofins retido', 'órgão público'],
    href: '/financeiro-ag/notas/retencoes', tela: 'Retenções na fonte (Lei 9.430)',
    frase: 'IR, CSLL, PIS e COFINS que o cliente retém, por produto: a conta a receber sai líquida.',
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
    id: 'cobrancas', termos: ['boletos emitidos', 'emitir boleto', 'gerar boleto', 'boleto não emitido', 'segunda via', '2ª via', 'reemitir boleto', 'carnê', 'pix cobrança', 'cobrança automática'],
    href: '/financeiro-ag/cobrancas', tela: 'Cobranças',
    frase: 'O boleto e o Pix saem pelo Asaas ou Pagar.me da agência e baixam a conta sozinhos quando o cliente paga.',
  },
  {
    id: 'recibo', termos: ['recibo', 'imprimir recibo', 'recibo de pagamento', 'comprovante para o cliente'],
    href: '/financeiro-ag/receber', tela: 'Contas a receber',
    frase: 'Na conta recebida, use Recibo: a página sai pronta para imprimir ou salvar em PDF.',
  },
  {
    id: 'lancar-venda', termos: ['lançar venda', 'venda de turismo', 'pagamentos da venda', 'fechar venda', 'reabrir venda', 'posição da venda', 'passageiros da venda'],
    href: '/vendas/lancar', tela: 'Lançar venda',
    frase: 'As contas a receber e a pagar nascem sozinhas de cada forma de pagamento, sem botão de gerar.',
  },
  {
    id: 'receita-da-venda', termos: ['receita da venda', 'componentes de receita', 'taxa du', 'rav', 'over', 'markup', 'fee da agência'],
    href: '/config/vendas', tela: 'Configurações de vendas',
    frase: 'A agência escolhe quais componentes contam como receita; a ficha da venda mostra a receita aberta por componente.',
  },
  {
    id: 'fatura-fornecedor', termos: ['fatura do fornecedor', 'fatura de fornecedor', 'faturar fornecedor', 'pagar operadora', 'corte do fornecedor', 'taxa cc du', 'taxa cc rav', 'pagar consolidadora'],
    href: '/financeiro-ag/fornecedores/faturas', tela: 'Fatura do fornecedor',
    frase: 'Junta os itens de várias vendas numa conta a pagar, pela regra de corte e vencimento do fornecedor, mostrando quanto cada cliente já pagou.',
  },
  {
    id: 'sinal-fornecedor', termos: ['sinal ao fornecedor', 'adiantamento ao fornecedor', 'sinal da operadora', 'pagamento antecipado ao fornecedor'],
    href: '/financeiro-ag/fornecedores/sinais', tela: 'Sinais a fornecedores',
    frase: 'O sinal pago é descontado sozinho das próximas faturas do fornecedor.',
  },
  {
    id: 'acordos-fornecedor', termos: ['acordo com fornecedor', 'comissão do fornecedor', 'over da operadora', 'incentivo da operadora', 'tabela de comissão', 'vigência da comissão'],
    href: '/financeiro-ag/fornecedores/acordos', tela: 'Acordos com fornecedores',
    frase: 'Comissão, over e Taxa CC por fornecedor e produto, com vigência: a venda usa o acordo da data dela.',
  },
  {
    id: 'comissao-fornecedor', termos: ['comissão esperada', 'comissão recebida', 'conferir comissão', 'comissão da operadora', 'comissão atrasada'],
    href: '/financeiro-ag/fornecedores/comissoes', tela: 'Comissão de fornecedores',
    frase: 'Esperado pelo acordo, lançado na venda e recebido de fato, por operadora, com alerta do que não bate.',
  },
  {
    id: 'regua-cobranca', termos: ['régua de cobrança', 'lembrete de vencimento', 'cobrar cliente', 'aviso de cobrança', 'portal do cliente'],
    href: '/config/cobranca', tela: 'Configurações de cobrança',
    frase: 'Os lembretes saem pelo WhatsApp e e-mail do CRM; o cliente também tem um link pessoal para pagar e baixar recibos.',
  },
  {
    id: 'taxas-recebimento', termos: ['taxa da plataforma', 'taxas de pagamento', 'taxa do boleto', 'custo do recebimento'],
    href: '/relatorios/taxas', tela: 'Taxas de pagamento',
  },
  // Mudança de sistema (E4): quem chega de outro sistema procura assim.
  {
    id: 'mudanca', termos: ['mudança de sistema', 'migrar', 'migração', 'trazer dados do sistema anterior', 'importar dados', 'importar planilha', 'implantação', 'saldo inicial'],
    href: '/mudanca', tela: 'Mudar para o EnturOS',
    frase: 'Traz contas, categorias, pessoas, contas em aberto e saldos do sistema anterior, com ensaio e desfazer.',
  },
  {
    id: 'glossario', termos: ['glossário', 'de para', 'como chama aqui', 'nome antigo'],
    href: '/mudanca/glossario', tela: 'Glossário da mudança',
  },
  {
    id: 'paridade', termos: ['checklist de paridade', 'paridade', 'o que já tem aqui', 'o que falta'],
    href: '/mudanca/paridade', tela: 'Checklist de paridade',
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

/**
 * Os planos do Entur OS Fin, como aparecem na landing (/api/planos), no
 * cadastro e em /admin/planos.
 *
 * Bruno, 09/11/2026: os planos passam a se chamar Básico, Controle e Escala,
 * com os itens refeitos a partir das telas que existem no sistema; emissão de
 * nota fiscal a partir do Controle. Os nomes antigos (Basic, Founder, Founder
 * Pro) eram do produto de propostas e falavam de CRM, voos e hotéis.
 *
 * O slug não muda: é ele que `tenants.plano`, as assinaturas e os convites
 * guardam. Preço também não: continua o que está no banco.
 *
 * Os limites são registro, não trava: hoje nenhuma tela confere o plano antes
 * de deixar usar um recurso (nem usuários, nem nota fiscal).
 */

export interface PlanoDoSaas {
  id: string;
  slug: string;
  nome: string;
  /** O nome que o plano tinha antes. A troca só vale para quem ainda está com ele. */
  nomeAntigo: string;
  descricao: string;
  preco_mensal: number;
  preco_anual: number;
  destaque: boolean;
  ordem: number;
  limites: Record<string, number | boolean>;
  features: string[];
}

export const PLANOS_DO_SAAS: PlanoDoSaas[] = [
  {
    id: 'plano-basic',
    slug: 'basic',
    nome: 'Básico',
    nomeAntigo: 'Basic',
    descricao: 'Para organizar o dinheiro da agência e ver o lucro de verdade.',
    preco_mensal: 97,
    preco_anual: 970,
    destaque: false,
    ordem: 1,
    limites: { usuarios: 3, grupos: 10, propostas_mes: 50, ai_enabled: false, white_label: false, nota_fiscal: false },
    features: [
      'Até 3 usuários',
      'Contas a pagar e a receber',
      'Fluxo de caixa projetado',
      'Resultado do mês por categoria e centro de custo',
      'Conciliação bancária pelo extrato',
      'Cartões, transferências e fechamento de caixa',
      'Vendas do Entur OS CRM entram sozinhas',
      'Mudança do sistema anterior sem redigitar',
    ],
  },
  {
    id: 'plano-founder',
    slug: 'founder',
    nome: 'Controle',
    nomeAntigo: 'Founder',
    descricao: 'Para cobrar, emitir nota e pagar comissão sem planilha.',
    preco_mensal: 197,
    preco_anual: 1970,
    destaque: true,
    ordem: 2,
    limites: { usuarios: 10, grupos: 50, propostas_mes: 200, ai_enabled: true, white_label: false, nota_fiscal: true },
    features: [
      'Até 10 usuários',
      'Tudo do Básico',
      'Emissão de nota fiscal de serviço sobre a comissão, com retenções',
      'Boleto e Pix pelo Asaas ou Pagar.me, com baixa automática',
      'Faturamento de clientes e portal com 2ª via e notas',
      'Comissões, metas e fechamento da equipe',
      'Vendas da Hotmart, Asaas e Pagar.me entram sozinhas',
      'Extrato automático do banco e conciliação automática',
      'Aprovação de pagamentos por alçada',
      'IA que lê a fatura do cartão e responde perguntas sobre o financeiro',
    ],
  },
  {
    id: 'plano-founder-pro',
    slug: 'founder-pro',
    nome: 'Escala',
    nomeAntigo: 'Founder Pro',
    descricao: 'Para agências com várias empresas, equipe grande e operação em moeda estrangeira.',
    preco_mensal: 397,
    preco_anual: 3970,
    destaque: false,
    ordem: 3,
    limites: { usuarios: -1, grupos: -1, propostas_mes: -1, ai_enabled: true, white_label: true, nota_fiscal: true },
    features: [
      'Usuários ilimitados',
      'Tudo do Controle',
      'Várias empresas (CNPJs e lojas) na mesma conta',
      'Moedas e câmbio turismo e PTAX',
      'Conferência do extrato da operadora',
      'Folha, funções e planos de comissão por função',
      'Resultado do mês e fluxo de caixa enviados por e-mail na data marcada',
      'Perfis de acesso e registro de atividades',
      'Implantação acompanhada e suporte dedicado',
    ],
  },
];

interface Executor {
  query(text: string, values?: unknown[]): Promise<{ rowCount?: number | null }>;
}

/**
 * Cria os planos numa instalação nova e troca os nomes e itens dos planos que
 * ainda estão com o nome antigo. Roda a cada initDB: plano que já foi trocado,
 * ou que alguém editou em /admin/planos com outro nome, não é tocado. Preço,
 * ordem e destaque de um plano que já existe ficam como estão.
 */
export async function semearPlanos(exec: Executor): Promise<void> {
  for (const p of PLANOS_DO_SAAS) {
    await exec.query(
      `INSERT INTO planos (id, slug, nome, descricao, preco_mensal, preco_anual, moeda, destaque, ordem, ativo, limites, features)
       VALUES ($1, $2, $3, $4, $5, $6, 'BRL', $7, $8, TRUE, $9::jsonb, $10::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.slug, p.nome, p.descricao, p.preco_mensal, p.preco_anual, p.destaque, p.ordem,
        JSON.stringify(p.limites), JSON.stringify(p.features)],
    );
    await exec.query(
      `UPDATE planos
          SET nome = $2, descricao = $3, features = $4::jsonb, limites = limites || $5::jsonb, updated_at = NOW()
        WHERE slug = $1 AND nome = $6`,
      [p.slug, p.nome, p.descricao, JSON.stringify(p.features),
        JSON.stringify({ ai_enabled: p.limites.ai_enabled, white_label: p.limites.white_label, nota_fiscal: p.limites.nota_fiscal }),
        p.nomeAntigo],
    );
  }
}

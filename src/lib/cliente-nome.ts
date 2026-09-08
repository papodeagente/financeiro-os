/**
 * Nome e tipo de pessoa do cliente: CAMINHO ÚNICO.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * A derivação do nome estava copiada em oito telas, cada uma com uma guarda
 * diferente, e todas assumindo duas coisas que o banco não garante:
 *
 *  1. Que `tipo` vale exatamente 'PF' ou 'PJ'. A coluna escalar `clientes.tipo`
 *     tem DEFAULT 'fisica', e o webhook do CRM grava literalmente 'fisica'
 *     (ver upsertClienteByExternalId em crm-integration.ts). Nenhum desses
 *     valores é 'PF', então todo cliente vindo do CRM caía no ramo de pessoa
 *     jurídica.
 *  2. Que os campos de nome existem. O cliente criado pelo CRM tem apenas
 *     `nome`; não tem `nome_completo`, `nome_fantasia` nem `razao_social`.
 *
 * As duas juntas faziam a expressão devolver `undefined`, e a tela de vendas
 * chamava `.toLowerCase()` no resultado: a página inteira quebrava com
 * "Algo deu errado" assim que a agência tivesse UMA venda vinda do CRM.
 *
 * Regra: estas funções NUNCA devolvem undefined e NUNCA lançam.
 */

/** Formato mínimo aceito. Casa tanto com o tipo Cliente quanto com o JSONB cru. */
export interface ClienteNomeavel {
  tipo?: string | null;
  /** Coluna escalar preenchida pelo webhook do CRM. */
  nome?: string | null;
  nome_completo?: string | null;
  nome_fantasia?: string | null;
  razao_social?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
  cpf_cnpj?: string | null;
}

/**
 * Normaliza o tipo de pessoa. Aceita os valores da interface ('PF'/'PJ'), os
 * do banco ('fisica'/'juridica'), com ou sem acento e em qualquer caixa.
 * Desconhecido ou vazio cai em pessoa física, que é o default da coluna.
 */
export function tipoPessoa(tipo: string | null | undefined): 'PF' | 'PJ' {
  const t = String(tipo ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (t === 'pj' || t.startsWith('jur')) return 'PJ';
  return 'PF';
}

/** Rótulo do tipo de pessoa para a tela. */
export function tipoPessoaLabel(tipo: string | null | undefined): string {
  return tipoPessoa(tipo) === 'PJ' ? 'Pessoa Jurídica' : 'Pessoa Física';
}

function primeiroPreenchido(valores: Array<string | null | undefined>): string {
  for (const v of valores) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s) return s;
  }
  return '';
}

/**
 * Nome do cliente para exibição.
 *
 * Tenta primeiro o campo próprio do tipo de pessoa e depois os demais, porque
 * o cadastro real é irregular: cliente do CRM só tem `nome`, cliente antigo só
 * tem `nome_completo`, e empresa pode ter só razão social. Devolve string
 * vazia quando não há nome nenhum, nunca undefined.
 */
export function nomeDoCliente(cliente: ClienteNomeavel | null | undefined): string {
  if (!cliente) return '';
  return tipoPessoa(cliente.tipo) === 'PJ'
    ? primeiroPreenchido([
        cliente.nome_fantasia,
        cliente.razao_social,
        cliente.nome,
        cliente.nome_completo,
      ])
    : primeiroPreenchido([
        cliente.nome_completo,
        cliente.nome,
        cliente.nome_fantasia,
        cliente.razao_social,
      ]);
}

/**
 * Mesma coisa, com um marcador quando não há nome. Use nas colunas de tabela,
 * onde célula vazia parece defeito.
 */
export function nomeDoClienteOuTraco(
  cliente: ClienteNomeavel | null | undefined,
  traco = '—',
): string {
  return nomeDoCliente(cliente) || traco;
}

/** Documento do cliente, respeitando o tipo de pessoa e o campo unificado. */
export function documentoDoCliente(cliente: ClienteNomeavel | null | undefined): string {
  if (!cliente) return '';
  return tipoPessoa(cliente.tipo) === 'PJ'
    ? primeiroPreenchido([cliente.cnpj, cliente.cpf_cnpj])
    : primeiroPreenchido([cliente.cpf, cliente.cpf_cnpj]);
}

/**
 * Mudança de sistema (E4, 05/11/2026): dicionário das listas que a agência
 * exporta do sistema anterior e o mapeamento por cabeçalho. Puro.
 *
 * Cada lista tem os seus campos, e cada campo os nomes de coluna com que ele
 * costuma aparecer (sinônimos de mercado). O mesmo nome muda de sentido
 * conforme a lista: "Tipo" é Receita/Despesa nas categorias, Pessoa Física
 * ou Jurídica nas pessoas e o tipo da conta nas contas. Por isso o
 * dicionário é por lista.
 *
 * A pessoa nunca digita sintaxe: a tela mostra a sugestão (coluna → campo),
 * ela confirma ou troca escolhendo numa lista. Coluna que não casa com nada
 * fica de fora e aparece listada.
 */
import { normalizar } from './valores';

export type ListaId = 'contas' | 'categorias' | 'centros_custo' | 'pessoas' | 'titulos' | 'saldos';

/** Ordem de aplicação: cada etapa depende das anteriores. */
export const ORDEM_DAS_LISTAS: ListaId[] = ['contas', 'categorias', 'centros_custo', 'pessoas', 'titulos', 'saldos'];

/** Etapa (1–5) em que as linhas de cada lista são gravadas. */
export const ETAPA_DA_LISTA: Record<ListaId, number> = {
  contas: 1, categorias: 2, centros_custo: 2, pessoas: 3, titulos: 4, saldos: 5,
};

export type TipoDoCampo = 'texto' | 'data' | 'dinheiro' | 'documento' | 'simnao' | 'parcela';

export interface CampoDaLista {
  id: string;
  rotulo: string;
  tipo: TipoDoCampo;
  obrigatorio?: boolean;
  /** Nomes de coluna aceitos, na forma em que aparecem nas telas. */
  sinonimos: string[];
  /** Dica curta para a tela (o que é o campo). */
  dica?: string;
}

export interface DefinicaoDaLista {
  id: ListaId;
  rotulo: string;
  /** Onde fica no sistema anterior e como exportar, em palavras. */
  comoExportar: string[];
  campos: CampoDaLista[];
  /** Pelo menos um destes precisa estar ligado (além dos obrigatórios). */
  algumDe?: string[][];
}

export const LISTAS: DefinicaoDaLista[] = [
  {
    id: 'contas',
    rotulo: 'Contas bancárias e cartões',
    comoExportar: [
      'Abra a lista de contas e cartões da agência.',
      'Deixe à mostra as colunas Descrição, Tipo, Banco, Agência, Conta e Saldo.',
      'Use Exportar e escolha Excel ou Texto.',
    ],
    campos: [
      { id: 'nome', rotulo: 'Nome da conta', tipo: 'texto', obrigatorio: true, sinonimos: ['Descrição', 'Nome', 'Nome da conta', 'Conta', 'Conta bancária', 'Apelido'] },
      { id: 'tipo', rotulo: 'Tipo da conta', tipo: 'texto', sinonimos: ['Tipo', 'Tipo da conta', 'Tipo de conta'], dica: 'Corrente, Caixa, Poupança, Cartão de crédito ou Aplicação' },
      { id: 'banco', rotulo: 'Banco', tipo: 'texto', sinonimos: ['Banco', 'Nº do banco', 'Número do banco', 'Código do banco', 'Instituição'] },
      { id: 'agencia', rotulo: 'Agência', tipo: 'texto', sinonimos: ['Agência', 'Agência/Dígito', 'Ag'] },
      { id: 'numero', rotulo: 'Número da conta', tipo: 'texto', sinonimos: ['Conta', 'Número', 'Número da conta', 'Nº da conta', 'Conta/Dígito', 'Conta corrente'] },
      { id: 'saldo', rotulo: 'Saldo na data de corte', tipo: 'dinheiro', sinonimos: ['Saldo', 'Saldo atual', 'Saldo na data', 'Saldo final'] },
      { id: 'moeda', rotulo: 'Moeda', tipo: 'texto', sinonimos: ['Moeda'] },
      { id: 'ativa', rotulo: 'Ativa', tipo: 'simnao', sinonimos: ['Ativa', 'Ativo', 'Situação'] },
      { id: 'dia_fechamento', rotulo: 'Dia de fechamento da fatura', tipo: 'texto', sinonimos: ['Fechamento da fatura', 'Dia de fechamento', 'Fechamento fatura'] },
      { id: 'dia_vencimento', rotulo: 'Dia de vencimento da fatura', tipo: 'texto', sinonimos: ['Vencimento da fatura', 'Dia de vencimento', 'Vencimento fatura'] },
    ],
  },
  {
    id: 'categorias',
    rotulo: 'Categorias',
    comoExportar: [
      'Abra a lista de categorias do financeiro.',
      'Exporte com as colunas Descrição, Grupo e Tipo (Receita ou Despesa).',
    ],
    campos: [
      { id: 'nome', rotulo: 'Categoria', tipo: 'texto', obrigatorio: true, sinonimos: ['Descrição', 'Categoria', 'Nome', 'Nome da categoria'] },
      { id: 'grupo', rotulo: 'Grupo', tipo: 'texto', sinonimos: ['Grupo', 'Grupo de categoria', 'Grupo da categoria', 'Categoria pai'] },
      { id: 'tipo', rotulo: 'Receita ou despesa', tipo: 'texto', sinonimos: ['Tipo', 'Natureza', 'Movimento', 'Receita/Despesa'] },
      { id: 'repasse', rotulo: 'Repasse', tipo: 'simnao', sinonimos: ['Repasse', 'É repasse'] },
    ],
  },
  {
    id: 'centros_custo',
    rotulo: 'Centros de custo',
    comoExportar: ['Abra a lista de centros de custo e exporte a coluna Descrição.'],
    campos: [
      { id: 'nome', rotulo: 'Centro de custo', tipo: 'texto', obrigatorio: true, sinonimos: ['Descrição', 'Centro de custo', 'Centro de custos', 'Centro', 'Nome'] },
    ],
  },
  {
    id: 'pessoas',
    rotulo: 'Pessoas (clientes e fornecedores)',
    comoExportar: [
      'Abra a lista de pessoas.',
      'Deixe à mostra Nome, Razão social, CPF, CNPJ, E-mail, Telefone e Celular.',
      'Se a lista for grande, exporte por letra ou por tipo: o sistema anterior corta listas longas.',
    ],
    campos: [
      { id: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, sinonimos: ['Nome', 'Pessoa', 'Cliente', 'Fornecedor', 'Nome fantasia', 'Favorecido'] },
      { id: 'razao_social', rotulo: 'Razão social', tipo: 'texto', sinonimos: ['Razão social', 'Razao'] },
      { id: 'documento', rotulo: 'CPF/CNPJ', tipo: 'documento', sinonimos: ['CPF/CNPJ', 'CNPJ/CPF', 'Documento', 'CPF ou CNPJ'] },
      { id: 'cpf', rotulo: 'CPF', tipo: 'documento', sinonimos: ['CPF'] },
      { id: 'cnpj', rotulo: 'CNPJ', tipo: 'documento', sinonimos: ['CNPJ'] },
      { id: 'email', rotulo: 'E-mail', tipo: 'texto', sinonimos: ['E-mail', 'Email', 'Correio eletrônico'] },
      { id: 'telefone', rotulo: 'Telefone', tipo: 'texto', sinonimos: ['Telefone', 'Fone', 'Telefone comercial', 'Telefone fixo'] },
      { id: 'celular', rotulo: 'Celular', tipo: 'texto', sinonimos: ['Celular', 'Telefone celular', 'WhatsApp', 'Whatsapp'] },
      { id: 'tipo_pessoa', rotulo: 'Pessoa física ou jurídica', tipo: 'texto', sinonimos: ['Tipo', 'Tipo de pessoa', 'Pessoa física/jurídica'] },
      { id: 'papel', rotulo: 'Cliente ou fornecedor', tipo: 'texto', sinonimos: ['Papel', 'Perfil', 'Cadastro', 'Cliente/Fornecedor', 'Categoria da pessoa'] },
      { id: 'cep', rotulo: 'CEP', tipo: 'texto', sinonimos: ['CEP'] },
      { id: 'endereco', rotulo: 'Endereço', tipo: 'texto', sinonimos: ['Endereço', 'Logradouro', 'Rua'] },
      { id: 'numero_endereco', rotulo: 'Número', tipo: 'texto', sinonimos: ['Número', 'Nº'] },
      { id: 'bairro', rotulo: 'Bairro', tipo: 'texto', sinonimos: ['Bairro'] },
      { id: 'cidade', rotulo: 'Cidade', tipo: 'texto', sinonimos: ['Cidade', 'Município'] },
      { id: 'uf', rotulo: 'UF', tipo: 'texto', sinonimos: ['UF', 'Estado'] },
      { id: 'codigo', rotulo: 'Código no sistema anterior', tipo: 'texto', sinonimos: ['Código', 'Cód', 'Codigo'] },
    ],
  },
  {
    id: 'titulos',
    rotulo: 'Contas a pagar e a receber em aberto',
    comoExportar: [
      'Abra a lista de contas a pagar e a receber.',
      'Filtre a situação "Em aberto" e o período pelo vencimento.',
      'Exporte UM ARQUIVO POR MÊS: o sistema anterior corta listas grandes e só mostra os primeiros registros.',
      'Deixe à mostra Pessoa, CPF/CNPJ, Movimento, Documento, Descrição, Emissão, Vencimento, Liquidação, Valor Final, Categoria, Centro de custo, Conta e Parcelas.',
    ],
    campos: [
      { id: 'pessoa', rotulo: 'Pessoa', tipo: 'texto', obrigatorio: true, sinonimos: ['Pessoa', 'Cliente', 'Fornecedor', 'Nome', 'Favorecido', 'Sacado', 'Cliente/Fornecedor'] },
      { id: 'razao_social', rotulo: 'Razão social', tipo: 'texto', sinonimos: ['Razão social'] },
      { id: 'documento_pessoa', rotulo: 'CPF/CNPJ da pessoa', tipo: 'documento', sinonimos: ['CPF/CNPJ', 'CNPJ/CPF', 'CPF', 'CNPJ', 'CPF ou CNPJ'] },
      { id: 'movimento', rotulo: 'A pagar ou a receber', tipo: 'texto', sinonimos: ['Movimento', 'Pagar/Receber', 'Receber/Pagar', 'Tipo de movimento', 'Natureza', 'Movimentação', 'Pagar ou receber'] },
      { id: 'numero', rotulo: 'Número no sistema anterior', tipo: 'texto', sinonimos: ['Número', 'Nº', 'Numero', 'Código'] },
      { id: 'documento', rotulo: 'Documento', tipo: 'texto', sinonimos: ['Documento', 'Nº documento', 'Número do documento', 'Nota', 'Nota fiscal', 'NF'] },
      { id: 'descricao', rotulo: 'Descrição', tipo: 'texto', sinonimos: ['Descrição', 'Histórico', 'Descricao'] },
      { id: 'emissao', rotulo: 'Emissão', tipo: 'data', sinonimos: ['Emissão', 'Data de emissão', 'Data emissão', 'Competência', 'Cadastrado em'] },
      { id: 'vencimento', rotulo: 'Vencimento', tipo: 'data', obrigatorio: true, sinonimos: ['Vencimento', 'Data de vencimento', 'Data vencimento', 'Vence em'] },
      { id: 'liquidacao', rotulo: 'Liquidação', tipo: 'data', sinonimos: ['Liquidação', 'Data de liquidação', 'Pagamento', 'Recebimento', 'Data de pagamento', 'Data de recebimento', 'Baixa'] },
      { id: 'valor', rotulo: 'Valor', tipo: 'dinheiro', sinonimos: ['Valor', 'Valor original', 'Valor do título'] },
      { id: 'valor_final', rotulo: 'Valor final', tipo: 'dinheiro', sinonimos: ['Valor Final', 'Valor total', 'Total', 'Saldo', 'Valor em aberto'] },
      { id: 'situacao', rotulo: 'Situação', tipo: 'texto', sinonimos: ['Situação', 'Status', 'Situacao'] },
      { id: 'categoria', rotulo: 'Categoria', tipo: 'texto', sinonimos: ['Categoria', 'Categorias', 'Plano de contas', 'Conta contábil'] },
      { id: 'grupo', rotulo: 'Grupo da categoria', tipo: 'texto', sinonimos: ['Grupo', 'Grupo de categoria', 'Grupo da categoria'] },
      { id: 'centro_custo', rotulo: 'Centro de custo', tipo: 'texto', sinonimos: ['Centro de custo', 'Centro de custos', 'Centro'] },
      { id: 'conta', rotulo: 'Conta (previsão)', tipo: 'texto', sinonimos: ['Conta', 'Conta previsão', 'Conta (previsão)', 'Conta bancária'] },
      { id: 'empresa', rotulo: 'Empresa', tipo: 'texto', sinonimos: ['Empresa', 'Filial', 'Loja', 'Unidade'] },
      { id: 'venda', rotulo: 'Venda Nº', tipo: 'texto', sinonimos: ['Venda Nº', 'Venda', 'Nº da venda', 'Número da venda'] },
      { id: 'fatura', rotulo: 'Fatura Nº', tipo: 'texto', sinonimos: ['Fatura Nº', 'Fatura', 'Nº da fatura', 'Número da fatura'] },
      { id: 'vendedor', rotulo: 'Vendedor', tipo: 'texto', sinonimos: ['Vendedor', 'Vendedora', 'Agente'] },
      { id: 'parcela', rotulo: 'Parcela', tipo: 'parcela', sinonimos: ['Parcela', 'Parcelas', 'Nº parcela'] },
      { id: 'forma', rotulo: 'Forma de pagamento', tipo: 'texto', sinonimos: ['Formas de pagamento', 'Forma de pagamento', 'Forma'] },
      { id: 'moeda', rotulo: 'Moeda', tipo: 'texto', sinonimos: ['Moeda'] },
      { id: 'observacoes', rotulo: 'Observações', tipo: 'texto', sinonimos: ['Observações', 'Observação', 'Obs'] },
    ],
    algumDe: [['valor', 'valor_final']],
  },
  {
    id: 'saldos',
    rotulo: 'Saldos das contas na data de corte',
    comoExportar: [
      'Abra o saldo das contas (ou o extrato de cada conta) na data de corte.',
      'Exporte a conta e o saldo. Pode ser uma conta por linha.',
    ],
    campos: [
      { id: 'conta', rotulo: 'Conta', tipo: 'texto', obrigatorio: true, sinonimos: ['Conta', 'Descrição', 'Nome', 'Nome da conta'] },
      { id: 'saldo', rotulo: 'Saldo', tipo: 'dinheiro', obrigatorio: true, sinonimos: ['Saldo', 'Saldo final', 'Saldo na data', 'Saldo atual', 'Saldo da conta'] },
      { id: 'data', rotulo: 'Data do saldo', tipo: 'data', sinonimos: ['Data', 'Fechamento', 'Data do saldo', 'Em'] },
      { id: 'moeda', rotulo: 'Moeda', tipo: 'texto', sinonimos: ['Moeda'] },
    ],
  },
];

export function definicaoDaLista(id: string): DefinicaoDaLista | null {
  return LISTAS.find(l => l.id === id) ?? null;
}

/** Mapeamento confirmado: campo → índice da coluna (0 = primeira). */
export type Mapeamento = Record<string, number>;

export interface SugestaoDeMapeamento {
  mapeamento: Mapeamento;
  /** Colunas que não casaram com nenhum campo (ficam de fora). */
  ignoradas: Array<{ indice: number; cabecalho: string }>;
  /** Campos obrigatórios (ou do grupo "pelo menos um") ainda sem coluna. */
  faltando: string[];
  /** Quantos cabeçalhos casaram (serve para escolher a lista). */
  pontos: number;
}

const SINONIMOS_NORMALIZADOS = new Map<string, Map<string, string[]>>();

function sinonimosDe(lista: DefinicaoDaLista): Map<string, string[]> {
  let m = SINONIMOS_NORMALIZADOS.get(lista.id);
  if (!m) {
    m = new Map();
    for (const c of lista.campos) m.set(c.id, c.sinonimos.map(normalizar).filter(Boolean));
    SINONIMOS_NORMALIZADOS.set(lista.id, m);
  }
  return m;
}

/**
 * Sugere o mapeamento de uma lista a partir dos cabeçalhos.
 *
 * Primeiro casam as colunas que só servem para um campo; depois as
 * ambíguas vão para o primeiro campo ainda livre, na ordem do dicionário.
 * Assim, nas contas, "Conta" vira o número quando há "Descrição", e o nome
 * da conta quando não há.
 */
export function sugerirMapeamento(cabecalhos: readonly string[], listaId: ListaId): SugestaoDeMapeamento {
  const lista = definicaoDaLista(listaId);
  if (!lista) return { mapeamento: {}, ignoradas: [], faltando: [], pontos: 0 };
  const sin = sinonimosDe(lista);
  const candidatos: Array<{ indice: number; cabecalho: string; campos: string[] }> = cabecalhos.map((cab, indice) => {
    const n = normalizar(cab);
    const campos = n ? lista.campos.filter(c => sin.get(c.id)!.includes(n)).map(c => c.id) : [];
    return { indice, cabecalho: cab, campos };
  });
  const mapeamento: Mapeamento = {};
  const usada = new Set<number>();
  for (const c of candidatos) {
    if (c.campos.length === 1 && mapeamento[c.campos[0]] === undefined) {
      mapeamento[c.campos[0]] = c.indice;
      usada.add(c.indice);
    }
  }
  for (const c of candidatos) {
    if (usada.has(c.indice) || c.campos.length < 2) continue;
    const livre = c.campos.find(id => mapeamento[id] === undefined);
    if (livre) { mapeamento[livre] = c.indice; usada.add(c.indice); }
  }
  const ignoradas = candidatos.filter(c => !usada.has(c.indice) && normalizar(c.cabecalho)).map(c => ({ indice: c.indice, cabecalho: c.cabecalho }));
  return { mapeamento, ignoradas, faltando: camposFaltando(lista, mapeamento), pontos: usada.size };
}

/** Campos obrigatórios sem coluna (e grupos "pelo menos um" vazios, como "valor ou valor_final"). */
export function camposFaltando(lista: DefinicaoDaLista, mapeamento: Mapeamento): string[] {
  const faltando = lista.campos.filter(c => c.obrigatorio && mapeamento[c.id] === undefined).map(c => c.id);
  for (const grupo of lista.algumDe ?? []) {
    if (!grupo.some(id => mapeamento[id] !== undefined)) faltando.push(grupo.join('|'));
  }
  return faltando;
}

/** Rótulo legível dos campos que faltam ("Vencimento", "Valor ou Valor final"). */
export function rotuloDosFaltando(listaId: ListaId, faltando: readonly string[]): string[] {
  const lista = definicaoDaLista(listaId);
  const rot = (id: string) => lista?.campos.find(c => c.id === id)?.rotulo ?? id;
  return faltando.map(f => f.split('|').map(rot).join(' ou '));
}

/**
 * Qual lista o arquivo parece ser. Ganha a que casa mais colunas sem faltar
 * obrigatório; empate fica com a ordem de ORDEM_DAS_LISTAS invertida (a
 * lista mais "rica", títulos, vence pessoas quando as duas casam igual).
 */
export function adivinharLista(cabecalhos: readonly string[]): { lista: ListaId; sugestao: SugestaoDeMapeamento } {
  let melhor: { lista: ListaId; sugestao: SugestaoDeMapeamento; nota: number } | null = null;
  for (const id of [...ORDEM_DAS_LISTAS].reverse()) {
    const s = sugerirMapeamento(cabecalhos, id);
    const nota = s.pontos * 10 - s.faltando.length * 25 + (s.faltando.length === 0 ? 5 : 0);
    if (!melhor || nota > melhor.nota) melhor = { lista: id, sugestao: s, nota };
  }
  return { lista: melhor!.lista, sugestao: melhor!.sugestao };
}

/** Confere um mapeamento enviado pela tela: campos existentes e colunas dentro do arquivo, sem repetir coluna. */
export function validarMapeamento(listaId: ListaId, mapeamento: unknown, colunas: number): { ok: true; mapeamento: Mapeamento } | { ok: false; erro: string } {
  const lista = definicaoDaLista(listaId);
  if (!lista) return { ok: false, erro: 'Lista desconhecida.' };
  if (!mapeamento || typeof mapeamento !== 'object' || Array.isArray(mapeamento)) return { ok: false, erro: 'Mapeamento inválido.' };
  const limpo: Mapeamento = {};
  const usadas = new Map<number, string>();
  for (const [campo, valor] of Object.entries(mapeamento as Record<string, unknown>)) {
    if (valor === null || valor === undefined || valor === '') continue;
    const def = lista.campos.find(c => c.id === campo);
    if (!def) return { ok: false, erro: `O campo "${campo}" não existe nesta lista.` };
    const i = Number(valor);
    if (!Number.isInteger(i) || i < 0 || i >= colunas) return { ok: false, erro: `A coluna escolhida para "${def.rotulo}" não existe no arquivo.` };
    if (usadas.has(i)) {
      const outro = lista.campos.find(c => c.id === usadas.get(i))?.rotulo ?? '';
      return { ok: false, erro: `A mesma coluna foi ligada a "${outro}" e a "${def.rotulo}". Escolha uma só.` };
    }
    usadas.set(i, campo);
    limpo[campo] = i;
  }
  return { ok: true, mapeamento: limpo };
}

/** Campos da lista cujo sinônimo é exatamente este cabeçalho (vazio = nenhum). */
export function camposDoCabecalho(cabecalho: string, listaId: ListaId): string[] {
  const lista = definicaoDaLista(listaId);
  if (!lista) return [];
  const n = normalizar(cabecalho);
  if (!n) return [];
  const sin = sinonimosDe(lista);
  return lista.campos.filter(c => sin.get(c.id)!.includes(n)).map(c => c.id);
}

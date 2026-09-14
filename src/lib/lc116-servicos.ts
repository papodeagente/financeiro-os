/**
 * Serviços da LC 116/03 que uma agência de viagens presta.
 *
 * POR QUE ESTA LISTA EXISTE. O padrão nacional pede um código de tributação de
 * 6 dígitos, e a AceleraAPI não publica tabela para consultar. Pedir o número
 * cru para a agência transferia para ela um problema que é de classificação
 * fiscal, não de digitação: ninguém sabe "090201" de cabeça, e errar o código
 * é errar o imposto.
 *
 * Então a tela pergunta o que a agência FAZ, em português, e o sistema
 * propõe o código.
 *
 * O CÓDIGO É PROPOSTA, NÃO VERDADE. Ele se forma como item + subitem +
 * desdobramento (o exemplo da própria AceleraAPI, 010701, é o item 1.07 com
 * desdobramento 01). O desdobramento pode variar por município, e a lista não
 * substitui a contabilidade. Por isso a tela deixa editar o número e, ao
 * salvar, sincroniza com o emissor: quem diz se o código vale é ele, e a
 * resposta aparece antes de qualquer nota sair.
 *
 * As descrições são as da lei, resumidas para caber na tela sem mudar sentido.
 */

export interface ServicoLC116 {
  /** Item da lista anexa à LC 116/03, por exemplo "9.02". */
  item: string;
  /** Código de tributação nacional proposto, 6 dígitos. */
  codigo: string;
  /** O que a agência faz, em português de quem trabalha nela. */
  titulo: string;
  /** Texto da lei, resumido. */
  descricao: string;
  /** Palavras que a pessoa provavelmente digita ao procurar. */
  sinonimos: string[];
}

/** Monta o código nacional a partir do item da lei. 9.02 vira 090201. */
export function codigoDoItem(item: string, desdobramento = '01'): string {
  const partes = String(item ?? '').trim().split('.');
  if (partes.length !== 2) return '';
  const grupo = partes[0].replace(/\D+/g, '').padStart(2, '0');
  const subitem = partes[1].replace(/\D+/g, '').padStart(2, '0');
  if (!grupo || !subitem) return '';
  return `${grupo}${subitem}${desdobramento}`.slice(0, 6);
}

export const SERVICOS_AGENCIA: ServicoLC116[] = [
  {
    item: '9.02',
    codigo: '090201',
    titulo: 'Agenciamento de viagens e turismo',
    descricao:
      'Agenciamento, organização, promoção, intermediação e execução de programas de turismo, '
      + 'passeios, viagens, excursões, hospedagens e congêneres.',
    sinonimos: [
      'agenciamento', 'viagem', 'viagens', 'turismo', 'pacote', 'excursao', 'excursão',
      'passeio', 'intermediacao', 'intermediação', 'roteiro', 'agencia de viagens',
    ],
  },
  {
    item: '9.01',
    codigo: '090101',
    titulo: 'Hospedagem',
    descricao:
      'Hospedagem de qualquer natureza em hotéis, apart-service, flat, apart-hotéis, '
      + 'motéis, pensões e congêneres, e ocupação por temporada com fornecimento de serviço.',
    sinonimos: ['hospedagem', 'hotel', 'pousada', 'diaria', 'diária', 'temporada', 'flat'],
  },
  {
    item: '9.03',
    codigo: '090301',
    titulo: 'Guia de turismo',
    descricao: 'Serviços prestados por guias de turismo.',
    sinonimos: ['guia', 'guiamento', 'city tour', 'condutor'],
  },
  {
    item: '10.01',
    codigo: '100101',
    titulo: 'Corretagem de seguro de viagem',
    descricao:
      'Agenciamento, corretagem ou intermediação de câmbio, de seguros, de cartões de crédito, '
      + 'de planos de saúde e de planos de previdência privada.',
    sinonimos: ['seguro', 'seguro viagem', 'corretagem', 'cambio', 'câmbio', 'assistencia'],
  },
  {
    item: '17.01',
    codigo: '170101',
    titulo: 'Consultoria e assessoria',
    descricao:
      'Assessoria ou consultoria de qualquer natureza, inclusive análise, exame, pesquisa, '
      + 'coleta, compilação e fornecimento de dados.',
    sinonimos: ['consultoria', 'assessoria', 'taxa de servico', 'taxa de serviço', 'planejamento'],
  },
  {
    item: '17.10',
    codigo: '171001',
    titulo: 'Organização de eventos e congressos',
    descricao:
      'Planejamento, organização e administração de feiras, exposições, congressos e congêneres.',
    sinonimos: ['evento', 'eventos', 'congresso', 'feira', 'convencao', 'convenção', 'incentivo'],
  },
  {
    item: '12.13',
    codigo: '121301',
    titulo: 'Produção de eventos e espetáculos',
    descricao:
      'Produção, mediante ou sem encomenda prévia, de eventos, espetáculos, entrevistas, '
      + 'shows, desfiles e congêneres.',
    sinonimos: ['show', 'espetaculo', 'espetáculo', 'producao', 'produção', 'festa'],
  },
];

/** Tira acento e caixa para a busca não depender de como a pessoa digita. */
function normalizar(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Procura serviços por descrição, item ou código.
 *
 * Busca vazia devolve a lista inteira: a agência que não sabe o que procurar
 * precisa ver as opções, não uma tela em branco.
 */
export function buscarServicos(termo: string): ServicoLC116[] {
  const q = normalizar(termo);
  if (!q) return SERVICOS_AGENCIA;
  const digitos = q.replace(/\D+/g, '');
  return SERVICOS_AGENCIA.filter(s => {
    if (normalizar(s.titulo).includes(q)) return true;
    if (normalizar(s.descricao).includes(q)) return true;
    if (s.sinonimos.some(x => normalizar(x).includes(q))) return true;
    if (digitos && (s.codigo.includes(digitos) || s.item.replace(/\D+/g, '').includes(digitos))) {
      return true;
    }
    return false;
  });
}

/** O serviço a que um código pertence, quando ele veio desta lista. */
export function servicoDoCodigo(codigo: string): ServicoLC116 | null {
  const c = String(codigo ?? '').replace(/\D+/g, '');
  return SERVICOS_AGENCIA.find(s => s.codigo === c) ?? null;
}

/**
 * O que a empresa faz, segundo o cadastro dela na Receita.
 *
 * O código de tributação não sai do certificado — o certificado só assina. Ele
 * sai da ATIVIDADE da empresa, e a atividade está no CNAE, que a consulta de
 * CNPJ devolve. Então em vez de pedir um número, o sistema lê o que a empresa
 * declarou fazer e mostra o serviço correspondente em primeiro lugar.
 */

/** CNAE (só dígitos) para o item da LC 116 que costuma corresponder. */
const CNAE_PARA_ITEM: Record<string, string> = {
  // Turismo
  '7911200': '9.02', // Agências de viagens
  '7912100': '9.02', // Operadores turísticos
  '7990200': '9.02', // Serviços de reservas e outros do turismo
  '5011401': '9.02', // Transporte marítimo de passageiros (cruzeiro vendido)
  // Hospedagem
  '5510801': '9.01', // Hotéis
  '5510802': '9.01', // Apart-hotéis
  '5590601': '9.01', // Albergues
  '5590602': '9.01', // Campings
  '5590603': '9.01', // Pensões
  '5590699': '9.01', // Outros alojamentos
  // Guias
  '7990201': '9.03', // Serviços de guia de turismo
  // Seguros e câmbio
  '6622300': '10.01', // Corretores e agentes de seguros
  '6619301': '10.01', // Serviços de câmbio
  // Consultoria
  '7020400': '17.01', // Consultoria em gestão empresarial
  '7490104': '17.01', // Atividades de intermediação e agenciamento
  // Eventos
  '8230001': '17.10', // Serviços de organização de feiras e congressos
  '8230002': '17.10', // Casas de festas e eventos
  '9001901': '12.13', // Produção teatral
  '9001902': '12.13', // Produção musical
  '9001999': '12.13', // Outras atividades de artes cênicas
};

/**
 * Itens da LC 116 que correspondem às atividades da empresa, na ordem em que
 * ela as declarou (principal primeiro).
 *
 * CNAE desconhecido não vira palpite: ele simplesmente não entra na lista. É
 * melhor a agência escolher entre os serviços do que receber uma sugestão
 * inventada a partir de uma atividade que ninguém mapeou.
 */
export function itensDaAtividade(cnaes: string[]): string[] {
  const vistos = new Set<string>();
  const itens: string[] = [];
  for (const bruto of cnaes) {
    const c = String(bruto ?? '').replace(/\D+/g, '');
    const item = CNAE_PARA_ITEM[c];
    if (item && !vistos.has(item)) {
      vistos.add(item);
      itens.push(item);
    }
  }
  return itens;
}

/** O item que o sistema propõe como padrão: o da atividade principal. */
export function itemSugerido(cnaePrincipal: string): string {
  return itensDaAtividade([cnaePrincipal])[0] ?? '';
}

/**
 * Os serviços que a empresa presta, segundo o CNAE dela, seguidos do resto.
 *
 * É o que faz a tela mostrar "exatamente aquilo que a empresa faz" em vez de
 * uma lista genérica: a atividade declarada na Receita vem primeiro, marcada.
 */
export function servicosDaEmpresa(cnaes: string[]): {
  daAtividade: ServicoLC116[];
  demais: ServicoLC116[];
} {
  const itens = itensDaAtividade(cnaes);
  const daAtividade = itens
    .map(i => SERVICOS_AGENCIA.find(s => s.item === i))
    .filter((s): s is ServicoLC116 => Boolean(s));
  const marcados = new Set(daAtividade.map(s => s.item));
  return {
    daAtividade,
    demais: SERVICOS_AGENCIA.filter(s => !marcados.has(s.item)),
  };
}

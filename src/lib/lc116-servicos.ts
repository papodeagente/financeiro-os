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

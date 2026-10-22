/**
 * Modelos de mapa mental.
 *
 * Um modelo não é "um mapa com uns nós dentro": é uma pergunta já feita.
 * Quem abre um SWOT não precisa lembrar das quatro palavras; quem abre um
 * roteiro recebe os dias prontos para preencher. O ganho está na estrutura,
 * não na quantidade de nós — por isso cada modelo tem o mínimo que torna a
 * pergunta visível e nada que o usuário precise apagar.
 *
 * ESCOLHIDOS PARA UMA AGÊNCIA DE VIAGENS, não copiados dos genéricos das
 * plataformas: roteiro, lançamento de grupo e jornada do cliente são o
 * trabalho de verdade de quem usa este sistema. Os demais (SWOT, OKR, ata,
 * causa e efeito, projeto, organograma, brainstorm) são os que as grandes
 * ferramentas — MindMeister, XMind, Miro, Whimsical — oferecem em primeiro
 * lugar, porque são os que as pessoas de fato usam.
 *
 * Cada modelo traz o LAYOUT e o TEMA que o servem melhor. O organograma vem
 * no layout de organograma; o roteiro, que se lê em sequência, vem em
 * árvore para a direita; o brainstorm, que irradia, vem em mapa.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Lightbulb, Map as MapIcon, Rocket, Network, Scale, FolderKanban,
  ClipboardList, Route, Target, Fish,
} from 'lucide-react';
import {
  createMindMap, newId,
  type MapaMentalData, type MapaLayout, type MindNode, type Theme,
} from './mapa-mental';

/** Um galho do modelo: texto e, opcionalmente, ícone e filhos. */
export interface Galho {
  text: string;
  icon?: string;
  children?: Galho[];
}

export interface ModeloDeMapa {
  id: string;
  nome: string;
  /** Uma frase, no tom de "para que serve", não de "o que é". */
  descricao: string;
  categoria: 'viagens' | 'estrategia' | 'gestao' | 'ideias';
  icone: LucideIcon;
  layout: MapaLayout;
  theme: Theme;
  /** O texto da ideia central. */
  raiz: string;
  galhos: Galho[];
}

/**
 * Monta o mapa a partir do modelo. A árvore é ligada por parentId + ordem,
 * que é como o resto do sistema a lê; sanitizeMap preenche o lado dos ramos
 * na primeira carga, então o modelo não precisa dizer de que lado cada um
 * fica.
 */
export function construirDoModelo(modelo: ModeloDeMapa, nome?: string): MapaMentalData {
  const mapa = createMindMap(nome || modelo.nome);
  const nodes: Record<string, MindNode> = { ...mapa.nodes };
  nodes[mapa.rootId] = { ...nodes[mapa.rootId], text: modelo.raiz };

  const plantar = (galhos: Galho[], parentId: string) => {
    galhos.forEach((g, ordem) => {
      const id = newId();
      nodes[id] = { id, text: g.text, parentId, ordem, ...(g.icon ? { icon: g.icon } : {}) };
      if (g.children?.length) plantar(g.children, id);
    });
  };
  plantar(modelo.galhos, mapa.rootId);

  return { ...mapa, nodes, layout: modelo.layout, theme: modelo.theme };
}

const g = (text: string, children?: Galho[], icon?: string): Galho => ({ text, ...(children ? { children } : {}), ...(icon ? { icon } : {}) });

export const MODELOS_DE_MAPA: ModeloDeMapa[] = [
  {
    id: 'brainstorm',
    nome: 'Brainstorm',
    descricao: 'Jogue ideias em volta de um tema e organize depois.',
    categoria: 'ideias',
    icone: Lightbulb,
    layout: 'map',
    theme: 'rainbow',
    raiz: 'Tema',
    galhos: [
      g('Ideia 1', [g('Como fazer'), g('O que precisa')]),
      g('Ideia 2', [g('Como fazer'), g('O que precisa')]),
      g('Ideia 3', [g('Como fazer'), g('O que precisa')]),
      g('Ideia 4', [g('Como fazer'), g('O que precisa')]),
      g('Ideia 5', [g('Como fazer'), g('O que precisa')]),
      g('Ideia 6', [g('Como fazer'), g('O que precisa')]),
    ],
  },
  {
    id: 'roteiro',
    nome: 'Roteiro de viagem',
    descricao: 'Dia a dia do destino, com manhã, tarde e noite para preencher.',
    categoria: 'viagens',
    icone: MapIcon,
    layout: 'logical',
    theme: 'ocean',
    raiz: 'Destino',
    galhos: [
      g('Antes de embarcar', [g('Documentos e vistos'), g('Seguro viagem'), g('Câmbio')]),
      g('Dia 1 · Chegada', [g('Manhã'), g('Tarde'), g('Noite')]),
      g('Dia 2', [g('Manhã'), g('Tarde'), g('Noite')]),
      g('Dia 3', [g('Manhã'), g('Tarde'), g('Noite')]),
      g('Dia 4 · Retorno', [g('Manhã'), g('Traslado e voo')]),
      g('Hospedagem', [g('Hotel'), g('Check-in e check-out')]),
    ],
  },
  {
    id: 'lancamento-de-grupo',
    nome: 'Lançamento de grupo',
    descricao: 'Da pré-venda ao pós-viagem: o que fazer em cada fase para o grupo fechar.',
    categoria: 'viagens',
    icone: Rocket,
    layout: 'map',
    theme: 'vibrante',
    raiz: 'Grupo',
    galhos: [
      g('Pré-venda', [g('Lista de interessados'), g('Material de divulgação'), g('Preço e condições')]),
      g('Venda', [g('Abertura das vagas'), g('Sinal e parcelas'), g('Fila de espera')]),
      g('Operação', [g('Fornecedores confirmados'), g('Rooming list'), g('Documentação dos passageiros')]),
      g('Embarque', [g('Encontro no aeroporto'), g('Kit do viajante'), g('Contato de emergência')]),
      g('Pós-viagem', [g('Pesquisa de satisfação'), g('Pedir indicação'), g('Fotos e depoimentos')]),
    ],
  },
  {
    id: 'organograma',
    nome: 'Organograma da agência',
    descricao: 'Quem responde a quem. Cresce para baixo, como um organograma de verdade.',
    categoria: 'gestao',
    icone: Network,
    layout: 'org',
    theme: 'mono',
    raiz: 'Direção',
    galhos: [
      g('Comercial', [g('Vendedor'), g('Vendedor'), g('Atendimento')]),
      g('Operações', [g('Reservas'), g('Emissão'), g('Pós-venda')]),
      g('Financeiro', [g('Contas a pagar e receber'), g('Fiscal')]),
      g('Marketing', [g('Conteúdo'), g('Tráfego')]),
    ],
  },
  {
    id: 'swot',
    nome: 'Análise SWOT',
    descricao: 'Forças, fraquezas, oportunidades e ameaças, lado a lado.',
    categoria: 'estrategia',
    icone: Scale,
    layout: 'map',
    theme: 'vibrante',
    raiz: 'Nosso negócio',
    galhos: [
      g('Forças', [g('O que fazemos bem'), g('O que o cliente elogia'), g('Vantagem sobre os outros')]),
      g('Fraquezas', [g('Onde perdemos venda'), g('O que falta na equipe'), g('O que custa caro')]),
      g('Oportunidades', [g('Destino em alta'), g('Parceria possível'), g('Público novo')]),
      g('Ameaças', [g('Concorrente'), g('Câmbio e economia'), g('Dependência de fornecedor')]),
    ],
  },
  {
    id: 'projeto',
    nome: 'Plano de projeto',
    descricao: 'Objetivo, fases e entregas, do começo ao encerramento.',
    categoria: 'gestao',
    icone: FolderKanban,
    layout: 'org-right',
    theme: 'forest',
    raiz: 'Projeto',
    galhos: [
      g('Objetivo', [g('O que muda quando acabar'), g('Como vamos medir')]),
      g('Descoberta', [g('Quem precisa disso'), g('O que já existe')]),
      g('Planejamento', [g('Entregas'), g('Prazos'), g('Quem faz o quê')]),
      g('Execução', [g('Entrega 1'), g('Entrega 2'), g('Entrega 3')]),
      g('Encerramento', [g('O que aprendemos'), g('O que fica de pé')]),
      g('Riscos', [g('O que pode dar errado'), g('Plano B')]),
    ],
  },
  {
    id: 'ata-de-reuniao',
    nome: 'Ata de reunião',
    descricao: 'Pauta, decisões e ações com responsável — para a reunião não evaporar.',
    categoria: 'gestao',
    icone: ClipboardList,
    layout: 'logical',
    theme: 'classic',
    raiz: 'Reunião',
    galhos: [
      g('Pauta', [g('Assunto 1'), g('Assunto 2'), g('Assunto 3')]),
      g('Decisões', [g('O que ficou decidido')]),
      g('Ações', [g('O quê · quem · até quando'), g('O quê · quem · até quando')]),
      g('Pendências', [g('O que ficou para a próxima')]),
      g('Próxima reunião', [g('Data'), g('Pauta prevista')]),
    ],
  },
  {
    id: 'jornada-do-cliente',
    nome: 'Jornada do cliente',
    descricao: 'Da descoberta ao pós-viagem: o que o cliente vive e o que a agência faz em cada passo.',
    categoria: 'viagens',
    icone: Route,
    layout: 'org-right',
    theme: 'sunset',
    raiz: 'Cliente',
    galhos: [
      g('Descoberta', [g('Como nos encontrou'), g('Primeira impressão')]),
      g('Cotação', [g('O que perguntou'), g('Tempo de resposta'), g('Proposta enviada')]),
      g('Compra', [g('O que fez decidir'), g('Pagamento'), g('Confirmação')]),
      g('Viagem', [g('Embarque'), g('Durante'), g('Imprevistos')]),
      g('Pós-viagem', [g('Como foi'), g('Indicação'), g('Próxima viagem')]),
    ],
  },
  {
    id: 'okr',
    nome: 'OKR do trimestre',
    descricao: 'Um objetivo, três resultados-chave e o que vai ser feito para chegar lá.',
    categoria: 'estrategia',
    icone: Target,
    layout: 'logical',
    theme: 'pastel',
    raiz: 'Objetivo do trimestre',
    galhos: [
      g('Resultado-chave 1', [g('Meta em número'), g('Iniciativa'), g('Iniciativa')]),
      g('Resultado-chave 2', [g('Meta em número'), g('Iniciativa'), g('Iniciativa')]),
      g('Resultado-chave 3', [g('Meta em número'), g('Iniciativa'), g('Iniciativa')]),
      g('Como vamos acompanhar', [g('Frequência'), g('Quem olha')]),
    ],
  },
  {
    id: 'causa-e-efeito',
    nome: 'Causa e efeito',
    descricao: 'Espinha de peixe: um problema no centro e as causas em seis famílias.',
    categoria: 'estrategia',
    icone: Fish,
    layout: 'map',
    theme: 'sepia',
    raiz: 'Problema',
    galhos: [
      g('Pessoas', [g('Causa possível'), g('Causa possível')]),
      g('Processo', [g('Causa possível'), g('Causa possível')]),
      g('Produto', [g('Causa possível'), g('Causa possível')]),
      g('Parceiros', [g('Causa possível'), g('Causa possível')]),
      g('Preço', [g('Causa possível'), g('Causa possível')]),
      g('Comunicação', [g('Causa possível'), g('Causa possível')]),
    ],
  },
];

export const CATEGORIAS: Record<ModeloDeMapa['categoria'], string> = {
  viagens: 'Viagens',
  estrategia: 'Estratégia',
  gestao: 'Gestão',
  ideias: 'Ideias',
};

export function modeloPorId(id: string): ModeloDeMapa | undefined {
  return MODELOS_DE_MAPA.find(m => m.id === id);
}

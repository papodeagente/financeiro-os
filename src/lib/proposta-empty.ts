// Detecta se um bloco esta "vazio" — sem conteudo significativo
// preenchido pelo usuario. Usado pelo SelectableBlock pra mostrar
// empty state visual no editor (no /p/[slug] publico nao se aplica:
// se o user nao preencheu, a propria renderizacao do bloco mostra o
// resultado real, podendo ser blank).

import type { SecaoProposta } from './crm-types';

interface EmptyHint {
  title: string;
  description: string;
  // Icone emoji usado no overlay
  icon: string;
}

export function getEmptyHint(secao: SecaoProposta): EmptyHint | null {
  const c = secao.conteudo as Record<string, unknown>;

  switch (secao.tipo) {
    case 'TEXTO': {
      const titulo = (c.titulo as string) || '';
      const corpo = ((c.corpo as string) || '').replace(/<[^>]*>/g, '').trim();
      if (!titulo && !corpo) {
        return {
          icon: '📝',
          title: 'Adicione um texto',
          description: 'Clique para abrir o editor e escrever um título ou parágrafo.',
        };
      }
      return null;
    }

    case 'GALERIA': {
      const imagens = (c.imagens as string[]) || [];
      if (imagens.length === 0) {
        return {
          icon: '🖼️',
          title: 'Galeria vazia',
          description: 'Clique para adicionar imagens e montar uma galeria visual.',
        };
      }
      return null;
    }

    case 'ALOJAMENTO': {
      const hotelNome = (c.hotel_nome as string) || '';
      if (!hotelNome) {
        return {
          icon: '🏨',
          title: 'Nenhum hotel selecionado',
          description: 'Use "Buscar Hotel API" ou preencha os dados manualmente.',
        };
      }
      return null;
    }

    case 'VOO': {
      const companhia = (c.companhia as string) || '';
      const origem = (c.origem as string) || '';
      const destino = (c.destino as string) || '';
      if (!companhia && !origem && !destino) {
        return {
          icon: '✈️',
          title: 'Nenhum voo configurado',
          description: 'Use "Buscar Voo API" ou preencha origem/destino manualmente.',
        };
      }
      return null;
    }

    case 'TRANSPORTE': {
      const origem = (c.origem as string) || '';
      const destino = (c.destino as string) || '';
      if (!origem && !destino) {
        return {
          icon: '🚐',
          title: 'Transporte sem rota',
          description: 'Defina origem e destino do transporte.',
        };
      }
      return null;
    }

    case 'VALORES': {
      const opcoes = (c.opcoes as Array<{ titulo?: string; valor_total?: number }>) || [];
      const first = opcoes[0];
      if (opcoes.length === 0 || (!first?.titulo && !first?.valor_total)) {
        return {
          icon: '💰',
          title: 'Sem valores cadastrados',
          description: 'Adicione opções de preço e formas de pagamento.',
        };
      }
      return null;
    }

    case 'INCLUSOS': {
      const inclusos = ((c.inclusos as string[]) || []).filter(Boolean);
      const naoInclusos = ((c.nao_inclusos as string[]) || []).filter(Boolean);
      if (inclusos.length === 0 && naoInclusos.length === 0) {
        return {
          icon: '✅',
          title: 'Liste o que está incluso',
          description: 'Adicione itens à lista de inclusos e não inclusos da proposta.',
        };
      }
      return null;
    }

    case 'CTA': {
      const texto = (c.texto_botao as string) || '';
      if (!texto || texto === 'Quero reservar minha viagem!') {
        return {
          icon: '👆',
          title: 'Personalize o botão de ação',
          description: 'Defina o texto, ação (WhatsApp/Email) e cor do botão.',
        };
      }
      return null;
    }

    case 'VIDEO': {
      const url = (c.url as string) || '';
      if (!url) {
        return {
          icon: '▶️',
          title: 'Cole o link do vídeo',
          description: 'Suporta YouTube e Vimeo. O vídeo aparecerá embedado.',
        };
      }
      return null;
    }

    case 'MAPA': {
      const pontos = ((c.pontos as unknown[]) || []);
      if (pontos.length === 0) {
        return {
          icon: '📍',
          title: 'Mapa sem pontos',
          description: 'Adicione pontos de interesse com latitude/longitude.',
        };
      }
      return null;
    }

    case 'FAQ': {
      const perguntas = ((c.perguntas as unknown[]) || []);
      if (perguntas.length === 0) {
        return {
          icon: '❓',
          title: 'Sem perguntas',
          description: 'Adicione perguntas frequentes pra esclarecer dúvidas do cliente.',
        };
      }
      return null;
    }

    case 'COUNTDOWN': {
      const dataEvento = (c.data_evento as string) || '';
      if (!dataEvento) {
        return {
          icon: '⏱️',
          title: 'Defina a data',
          description: 'O countdown começa a contar até a data escolhida.',
        };
      }
      return null;
    }

    case 'DEPOIMENTO': {
      const deps = ((c.depoimentos as Array<{ texto?: string }>) || [])
        .filter(d => d.texto?.trim());
      if (deps.length === 0) {
        return {
          icon: '💬',
          title: 'Sem depoimentos',
          description: 'Adicione frases de clientes satisfeitos pra dar prova social.',
        };
      }
      return null;
    }

    case 'SERVICO': {
      const titulo = (c.titulo as string) || '';
      const descricao = (c.descricao as string) || '';
      if (!titulo && !descricao) {
        return {
          icon: '✨',
          title: 'Configure o serviço',
          description: 'Defina título, descrição e (opcionalmente) valor.',
        };
      }
      return null;
    }

    case 'ROTEIRO_DIA': {
      const dias = ((c.dias as Array<{ atividades?: unknown[] }>) || []);
      const hasContent = dias.some(d => (d.atividades?.length || 0) > 0);
      if (!hasContent) {
        return {
          icon: '📅',
          title: 'Roteiro sem atividades',
          description: 'Adicione atividades em cada dia da viagem.',
        };
      }
      return null;
    }

    default:
      return null;
  }
}

// Gera uma proposta exemplo completa pra onboarding: 1 bloco de cada
// tipo principal preenchido com conteudo realista. O usuario edita
// inline pra entender o que cada elemento faz.
//
// Inclui:
//   capa (mensagem de abertura) · TEXTO intro · ALOJAMENTO · VOO ·
//   ROTEIRO_DIA · GALERIA · INCLUSOS · VALORES · DEPOIMENTO · MAPA ·
//   FAQ · CTA · TEXTO de despedida
//
// Nao inclui: COUNTDOWN, VIDEO, SERVICO, TRANSPORTE — sao opcionais
// e poluem o onboarding. Usuario pode adicionar pela paleta.

import type { SecaoProposta, Proposta } from './crm-types';
import { generateId } from './utils';

export function buildSecoesExemplo(): SecaoProposta[] {
  let ordem = 0;
  const next = (): number => ordem++;

  return [
    {
      id: generateId(),
      tipo: 'TEXTO',
      ordem: next(),
      visivel: true,
      conteudo: {
        titulo: 'Sua viagem dos sonhos começa aqui',
        corpo: 'Preparei essa proposta exclusiva para você. Veja os detalhes abaixo, todas as opções de hospedagem, voos, roteiro e investimento. Qualquer dúvida, estou à disposição.',
        alinhamento: 'center',
      },
    },
    {
      id: generateId(),
      tipo: 'ALOJAMENTO',
      ordem: next(),
      visivel: true,
      conteudo: {
        id: generateId(),
        destino_nome: 'Santiago, Chile',
        hotel_nome: 'Hotel Plaza El Bosque Ebro',
        hotel_estrelas: 4,
        hotel_imagem: '',
        hotel_galeria: [],
        hotel_descricao: 'Hotel boutique no coração de Las Condes, com café da manhã, academia e piscina aquecida.',
        hotel_link: '',
        check_in: '2026-07-15',
        check_out: '2026-07-22',
        noites: 7,
        regime: 'BB',
        quarto_tipo: 'Quarto Superior Casal',
        bebidas: '',
        viagem_noturna: false,
      },
    },
    {
      id: generateId(),
      tipo: 'VOO',
      ordem: next(),
      visivel: true,
      conteudo: {
        id: generateId(),
        data: '2026-07-15',
        origem: 'GRU - São Paulo',
        destino: 'SCL - Santiago',
        companhia: 'LATAM Airlines',
        numero_voo: 'LA754',
        horario_saida: '08:25',
        horario_chegada: '12:40',
        detalhes: 'Voo direto · Bagagem 23kg inclusa · Refeição a bordo',
        mostrar_segmentos: true,
        mostrar_emissao_co2: true,
        mostrar_aeronave: true,
        mostrar_bagagem: true,
        mostrar_alerta_atraso: false,
      },
    },
    {
      id: generateId(),
      tipo: 'ROTEIRO_DIA',
      ordem: next(),
      visivel: true,
      conteudo: {
        dias: [
          {
            numero: 1,
            titulo: 'Chegada em Santiago',
            descricao: 'Recepção no aeroporto, transfer privativo até o hotel. Tarde livre para descanso ou primeiro contato com o bairro.',
            imagem: '',
            atividades: ['Transfer privativo IN', 'Check-in no hotel', 'Tarde livre'],
            refeicoes_inclusas: 'Não inclui',
          },
          {
            numero: 2,
            titulo: 'City Tour + Cerro San Cristóbal',
            descricao: 'Tour panorâmico pelos principais pontos da capital: Plaza de Armas, Mercado Central e subida ao Cerro San Cristóbal.',
            imagem: '',
            atividades: ['City tour 4h', 'Funicular Cerro San Cristóbal', 'Almoço no Mercado Central'],
            refeicoes_inclusas: 'Café da manhã + Almoço',
          },
          {
            numero: 3,
            titulo: 'Vinícolas no Vale do Maipo',
            descricao: 'Excursão de dia inteiro pelas vinícolas mais famosas da região com degustação guiada.',
            imagem: '',
            atividades: ['Tour Concha y Toro', 'Degustação 5 vinhos', 'Almoço regional'],
            refeicoes_inclusas: 'Café da manhã + Almoço',
          },
        ],
      },
    },
    {
      id: generateId(),
      tipo: 'GALERIA',
      ordem: next(),
      visivel: true,
      conteudo: {
        imagens: [],
      },
    },
    {
      id: generateId(),
      tipo: 'INCLUSOS',
      ordem: next(),
      visivel: true,
      conteudo: {
        inclusos: [
          '7 noites de hospedagem com café da manhã',
          'Passagem aérea ida e volta (classe econômica)',
          'Transfer aeroporto/hotel/aeroporto privativo',
          'City Tour Santiago (4h)',
          'Tour Vinícolas Vale do Maipo (8h)',
          'Seguro viagem internacional',
          'Assistência 24h em português',
        ],
        nao_inclusos: [
          'Refeições não especificadas',
          'Bebidas alcoólicas',
          'Gorjetas e gastos pessoais',
          'Despesas com bagagem extra',
        ],
      },
    },
    {
      id: generateId(),
      tipo: 'VALORES',
      ordem: next(),
      visivel: true,
      conteudo: {
        opcoes: [
          {
            titulo: 'Pacote Completo',
            valor_total: 8900,
            destaque: true,
            parcelas: [
              { forma: 'À vista no PIX (5% de desconto)', valor_parcela: 8455, valor_total: 8455, destaque: true },
              { forma: 'Cartão em 10x sem juros', valor_parcela: 890, valor_total: 8900, destaque: false },
              { forma: 'Cartão em 12x com juros', valor_parcela: 779, valor_total: 9348, destaque: false },
            ],
          },
        ],
        observacoes_valores: 'Valores por pessoa em apartamento duplo. Sujeito a disponibilidade e variação cambial.',
        validade: '2026-06-30',
      },
    },
    {
      id: generateId(),
      tipo: 'DEPOIMENTO',
      ordem: next(),
      visivel: true,
      conteudo: {
        depoimentos: [
          {
            texto: 'Viagem maravilhosa, tudo organizado nos mínimos detalhes. O suporte 24h em português fez toda a diferença.',
            autor: 'Mariana Costa',
            foto: '',
            destino: 'Santiago 2025',
          },
        ],
      },
    },
    {
      id: generateId(),
      tipo: 'FAQ',
      ordem: next(),
      visivel: true,
      conteudo: {
        titulo: 'Perguntas Frequentes',
        perguntas: [
          { pergunta: 'Preciso de visto pro Chile?', resposta: 'Não — brasileiros viajam ao Chile com passaporte ou RG dentro da validade (mínimo 6 meses).' },
          { pergunta: 'Qual a melhor época pra viajar?', resposta: 'Entre março e novembro, com clima ameno. Para ski, junho a setembro nas montanhas próximas.' },
          { pergunta: 'Posso pagar parcelado?', resposta: 'Sim — em até 12x no cartão de crédito, com ou sem juros conforme a opção.' },
        ],
      },
    },
    {
      id: generateId(),
      tipo: 'CTA',
      ordem: next(),
      visivel: true,
      conteudo: {
        texto_botao: 'Quero reservar minha viagem!',
        tipo_acao: 'WHATSAPP',
        numero_whatsapp: '',
        mensagem_predefinida: 'Olá! Tenho interesse na proposta de Santiago. Pode me ajudar?',
        cor_botao: '#004aad',
      },
    },
    {
      id: generateId(),
      tipo: 'TEXTO',
      ordem: next(),
      visivel: true,
      conteudo: {
        titulo: 'Obrigado pela confiança',
        corpo: 'Estarei à disposição em todas as etapas — antes, durante e depois da viagem. Esta proposta tem validade até a data informada acima.',
        alinhamento: 'center',
      },
    },
  ];
}

// Aplica o exemplo numa proposta existente, preservando id/agencia/
// cliente/visual e populando capa + secoes + rodape com conteudo
// demonstrativo. Usado pelo onboarding.
export function aplicarExemploNaProposta(p: Proposta): Proposta {
  return {
    ...p,
    cabecalho: {
      ...p.cabecalho,
      titulo: p.cabecalho.titulo || 'Sua viagem para Santiago',
      subtitulo: p.cabecalho.subtitulo || '7 noites · Hospedagem + Voos + Roteiro completo',
      mensagem_abertura: p.cabecalho.mensagem_abertura || 'Olá! Preparei esta proposta com todo o cuidado para sua viagem. Veja os detalhes abaixo.',
    },
    secoes: buildSecoesExemplo(),
    rodape: {
      ...p.rodape,
      mensagem: p.rodape.mensagem || 'Esta proposta foi feita com muito carinho para você. Qualquer dúvida, me chame no WhatsApp!',
    },
  };
}

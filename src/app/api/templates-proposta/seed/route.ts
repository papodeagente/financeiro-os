import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId } from '@/lib/utils';
import type { TemplateProposta, SecaoProposta, AlojamentoData, TransporteData } from '@/lib/crm-types';
import { getTenantId } from '@/lib/tenant';

function s(tipo: SecaoProposta['tipo'], ordem: number, conteudo: Record<string, unknown>): SecaoProposta {
  return { id: generateId(), tipo, ordem, visivel: true, conteudo };
}
function aloj(data: Omit<AlojamentoData, 'id'>): AlojamentoData {
  return { id: generateId(), ...data };
}
function transp(data: Omit<TransporteData, 'id'>): TransporteData {
  return { id: generateId(), ...data };
}

// ═══════════════════════════════════════════════════════════════
// TEMPLATE 1: TERRA SANTA — Israel completo (Discovery layout)
// Demonstra: viagem, alojamentos, transportes, roteiro, mapa, galeria, FAQ, depoimentos
// ═══════════════════════════════════════════════════════════════
const TERRA_SANTA_ALOJ: AlojamentoData[] = [
  aloj({
    destino_nome: 'Jerusalem', hotel_nome: 'David Citadel Hotel', hotel_estrelas: 5,
    hotel_imagem: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&q=80',
    hotel_galeria: [
      'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=600&q=80',
      'https://images.unsplash.com/photo-1580502304784-8985b7eb7260?w=600&q=80',
    ],
    hotel_descricao: 'Hotel 5 estrelas com vista para as muralhas da Cidade Velha. Piscina, spa, restaurante kosher premiado.',
    hotel_link: '', check_in: '2026-06-10', check_out: '2026-06-13', noites: 3,
    regime: 'BB', quarto_tipo: 'Deluxe', bebidas: '',
    lat: 31.7767, lng: 35.2245, viagem_noturna: false,
  }),
  aloj({
    destino_nome: 'Mar Morto', hotel_nome: 'Isrotel Dead Sea Resort', hotel_estrelas: 5,
    hotel_imagem: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&q=80',
    hotel_galeria: [],
    hotel_descricao: 'Resort a beira do Mar Morto com spa terapeutico, piscinas de agua mineral e acesso privativo a praia.',
    hotel_link: '', check_in: '2026-06-13', check_out: '2026-06-14', noites: 1,
    regime: 'HB', quarto_tipo: 'Superior', bebidas: '',
    lat: 31.5, lng: 35.37, viagem_noturna: false,
  }),
  aloj({
    destino_nome: 'Tel Aviv', hotel_nome: 'The Norman Hotel', hotel_estrelas: 5,
    hotel_imagem: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80',
    hotel_galeria: [],
    hotel_descricao: 'Boutique hotel de luxo na White City. Restaurante rooftop, piscina com vista para o Mediterraneo.',
    hotel_link: '', check_in: '2026-06-14', check_out: '2026-06-17', noites: 3,
    regime: 'BB', quarto_tipo: 'Deluxe Sea View', bebidas: '',
    lat: 32.0741, lng: 34.7764, viagem_noturna: false,
  }),
];

const TERRA_SANTA_TRANSP: TransporteData[] = [
  transp({ tipo: 'VOO', data: '2026-06-09', origem: 'GRU', destino: 'TLV', companhia: 'LATAM', numero_voo: 'LA8084', horario_saida: '23:55', horario_chegada: '18:30', tempo_estimado: '14h35', detalhes: 'Voo direto | R$ 4.850,00' }),
  transp({ tipo: 'TRANSFER', data: '2026-06-10', origem: 'Aeroporto Ben Gurion (TLV)', destino: 'Hotel David Citadel, Jerusalem', companhia: '', numero_voo: '', horario_saida: '19:30', horario_chegada: '20:45', distancia_km: 65, tempo_estimado: '1h15', detalhes: 'Van privativa com guia em portugues' }),
  transp({ tipo: 'TRANSFER', data: '2026-06-13', origem: 'Jerusalem', destino: 'Mar Morto', companhia: '', numero_voo: '', horario_saida: '09:00', horario_chegada: '10:00', distancia_km: 45, tempo_estimado: '1h', detalhes: 'Passando por Massada' }),
  transp({ tipo: 'TRANSFER', data: '2026-06-14', origem: 'Mar Morto', destino: 'Tel Aviv', companhia: '', numero_voo: '', horario_saida: '10:00', horario_chegada: '12:00', distancia_km: 150, tempo_estimado: '2h', detalhes: 'Via Arad e Beer Sheva' }),
  transp({ tipo: 'VOO', data: '2026-06-17', origem: 'TLV', destino: 'GRU', companhia: 'LATAM', numero_voo: 'LA8085', horario_saida: '00:30', horario_chegada: '09:15', tempo_estimado: '14h45', detalhes: 'VOLTA | Voo direto | R$ 4.850,00' }),
];

const terraSanta: Omit<TemplateProposta, 'id'> = {
  nome: 'Terra Santa — Israel Completo',
  descricao: 'Roteiro completo por Israel: Jerusalém, Mar Morto e Tel Aviv. 8 dias com guia, hotéis 5 estrelas e experiências únicas. Modelo DISCOVERY que demonstra TODOS os 14 tipos de blocos disponíveis (texto, galeria, vídeo, mapa, roteiro, alojamentos, transportes, inclusos, valores, FAQ, depoimento, CTA e countdown).',
  tipo_viagem: 'CULTURAL',
  icone: '✡️',
  imagem_preview: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=600&q=80',
  visual: {
    tema: 'padrao', layout: 'DISCOVERY', cor_primaria: '#1e40af', cor_secundaria: '#0a0a14', cor_texto: '#111827',
    cor_fundo: '#f8fafc', fonte: 'Inter',
    imagem_capa: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=1400&q=80',
    estilo_capa: 'FULLSCREEN',
  },
  secoes_padrao: [
    // TEXTO abertura
    s('TEXTO', 0, {
      titulo: 'Uma jornada pela Terra Santa',
      corpo: 'Caminhe onde Jesus caminhou. Flutue no Mar Morto. Descubra a vibrante Tel Aviv. Este roteiro foi desenhado para proporcionar uma experiencia transformadora — unindo fe, historia e cultura em 8 dias inesqueciveis.',
      alinhamento: 'center',
    }),
    // GALERIA capa
    s('GALERIA', 1, { imagens: [
      'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&q=80',
      'https://images.unsplash.com/photo-1580502304784-8985b7eb7260?w=800&q=80',
      'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&q=80',
      'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80',
    ] }),
    // VIDEO — apresentacao do roteiro
    s('VIDEO', 2, {
      titulo: 'Conheça a Terra Santa em 2 minutos',
      url: 'https://www.youtube.com/watch?v=JXk_4WaBDKQ',
    }),
    // MAPA — pontos da rota
    s('MAPA', 3, {
      titulo: 'Sua rota pela Terra Santa',
      zoom: 8,
      pontos: [
        { lat: 31.7767, lng: 35.2245, label: 'Jerusalém — Cidade Velha' },
        { lat: 31.7857, lng: 35.2400, label: 'Monte das Oliveiras' },
        { lat: 31.7054, lng: 35.2024, label: 'Belém — Igreja da Natividade' },
        { lat: 31.3156, lng: 35.3536, label: 'Massada' },
        { lat: 31.5000, lng: 35.3700, label: 'Mar Morto' },
        { lat: 32.0741, lng: 34.7764, label: 'Tel Aviv — White City' },
        { lat: 32.0536, lng: 34.7521, label: 'Jaffa antiga' },
      ],
    }),
    // ROTEIRO DIA A DIA
    s('ROTEIRO_DIA', 4, { dias: [
      { numero: 1, titulo: 'Dia 1 — Embarque no Brasil', descricao: 'Saida de Sao Paulo (GRU) no voo LATAM LA8084 com destino a Tel Aviv. Voo noturno direto — jantar e cafe da manha servidos a bordo.', imagem: '', atividades: ['Check-in no aeroporto de Guarulhos', 'Embarque as 23:55'], refeicoes_inclusas: 'Jantar e cafe a bordo', lat: -23.4356, lng: -46.4731 },
      { numero: 2, titulo: 'Dia 2 — Chegada em Israel e Jerusalem', descricao: 'Chegada ao Aeroporto Ben Gurion as 18:30. Recepcao com guia em portugues e transfer privativo ate Jerusalem. Check-in no David Citadel Hotel com vista para as muralhas.', imagem: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&q=80', atividades: ['Transfer aeroporto → Jerusalem (1h15)', 'Check-in David Citadel Hotel 5★', 'Jantar de boas-vindas no rooftop'], refeicoes_inclusas: 'Jantar', lat: 31.7767, lng: 35.2245 },
      { numero: 3, titulo: 'Dia 3 — Cidade Velha de Jerusalem', descricao: 'Dia inteiro explorando a Cidade Velha: Via Dolorosa, Santo Sepulcro, Muro das Lamentacoes, Monte do Templo. Almoco em restaurante tipico no bairro armenio.', imagem: 'https://images.unsplash.com/photo-1580502304784-8985b7eb7260?w=800&q=80', atividades: ['Via Dolorosa — 14 estacoes', 'Basilica do Santo Sepulcro', 'Muro das Lamentacoes', 'Monte do Templo / Esplanada das Mesquitas', 'Almoco tipico no bairro armenio'], refeicoes_inclusas: 'Cafe da manha e almoco', lat: 31.7784, lng: 35.2296 },
      { numero: 4, titulo: 'Dia 4 — Monte das Oliveiras e Belem', descricao: 'Manha no Monte das Oliveiras com vista panoramica. Tarde em Belem: Igreja da Natividade e Gruta do Leite. Retorno a Jerusalem para jantar livre.', imagem: '', atividades: ['Monte das Oliveiras — panoramica', 'Jardim de Getsemani', 'Igreja de Todas as Nacoes', 'Belem — Igreja da Natividade', 'Praca da Manjedoura'], refeicoes_inclusas: 'Cafe da manha', lat: 31.7782, lng: 35.2428 },
      { numero: 5, titulo: 'Dia 5 — Massada e Mar Morto', descricao: 'Saida cedo para Massada — subida de teleferico e visita a fortaleza de Herodes. Descida ao Mar Morto para a experiencia de flutuacao. Check-in no Isrotel Dead Sea Resort.', imagem: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&q=80', atividades: ['Fortaleza de Massada (teleferico)', 'Flutuacao no Mar Morto', 'Spa com lama terapeutica', 'Check-in Isrotel Dead Sea Resort 5★'], refeicoes_inclusas: 'Cafe da manha e jantar', lat: 31.3156, lng: 35.3536 },
      { numero: 6, titulo: 'Dia 6 — Transfer para Tel Aviv', descricao: 'Manha livre no resort com spa. Apos o almoco, transfer panoramico ate Tel Aviv passando pelo deserto do Negev. Check-in no The Norman Hotel.', imagem: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80', atividades: ['Manha livre — spa e praia privativa', 'Transfer Mar Morto → Tel Aviv (2h)', 'Check-in The Norman Hotel 5★', 'Passeio pelo bairro de Neve Tzedek'], refeicoes_inclusas: 'Cafe da manha', lat: 32.0741, lng: 34.7764 },
      { numero: 7, titulo: 'Dia 7 — Tel Aviv e Jaffa', descricao: 'City tour por Tel Aviv: White City (Bauhaus), mercado Carmel, praia de Gordon. Tarde na antiga Jaffa com suas galerias de arte. Jantar de despedida em restaurante a beira-mar.', imagem: '', atividades: ['White City — arquitetura Bauhaus (UNESCO)', 'Mercado Carmel', 'Praia de Gordon Beach', 'Old Jaffa — galerias e porto historico', 'Jantar de despedida a beira-mar'], refeicoes_inclusas: 'Cafe da manha e jantar', lat: 32.0536, lng: 34.7521 },
      { numero: 8, titulo: 'Dia 8 — Retorno ao Brasil', descricao: 'Dia livre para compras e ultimos passeios. Transfer ao Aeroporto Ben Gurion. Voo LATAM LA8085 de volta a Sao Paulo, chegando as 09:15.', imagem: '', atividades: ['Manha livre para compras', 'Transfer hotel → aeroporto', 'Voo TLV → GRU (14h45)'], refeicoes_inclusas: 'Cafe da manha', lat: 32.0055, lng: 34.8854 },
    ] }),
    // ALOJAMENTO — David Citadel Jerusalém
    s('ALOJAMENTO', 5, {
      id: generateId(),
      destino_nome: 'Jerusalém', hotel_nome: 'David Citadel Hotel', hotel_estrelas: 5,
      hotel_imagem: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&q=80',
      hotel_galeria: [
        'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=600&q=80',
        'https://images.unsplash.com/photo-1580502304784-8985b7eb7260?w=600&q=80',
      ],
      hotel_descricao: 'Hotel 5 estrelas com vista para as muralhas da Cidade Velha. Piscina, spa, restaurante kosher premiado.',
      hotel_link: 'https://www.thedavidcitadel.com', check_in: '2026-06-10', check_out: '2026-06-13', noites: 3,
      regime: 'BB', quarto_tipo: 'Deluxe', bebidas: 'Não inclusas',
      lat: 31.7767, lng: 35.2245, viagem_noturna: false,
    }),
    // ALOJAMENTO — Isrotel Mar Morto
    s('ALOJAMENTO', 6, {
      id: generateId(),
      destino_nome: 'Mar Morto', hotel_nome: 'Isrotel Dead Sea Resort', hotel_estrelas: 5,
      hotel_imagem: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&q=80',
      hotel_galeria: [],
      hotel_descricao: 'Resort à beira do Mar Morto com spa terapêutico, piscinas de água mineral e acesso privativo à praia.',
      hotel_link: '', check_in: '2026-06-13', check_out: '2026-06-14', noites: 1,
      regime: 'HB', quarto_tipo: 'Superior', bebidas: 'Inclusas no jantar',
      lat: 31.5, lng: 35.37, viagem_noturna: false,
    }),
    // ALOJAMENTO — The Norman Tel Aviv
    s('ALOJAMENTO', 7, {
      id: generateId(),
      destino_nome: 'Tel Aviv', hotel_nome: 'The Norman Hotel', hotel_estrelas: 5,
      hotel_imagem: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80',
      hotel_galeria: [],
      hotel_descricao: 'Boutique hotel de luxo na White City. Restaurante rooftop, piscina com vista para o Mediterrâneo.',
      hotel_link: '', check_in: '2026-06-14', check_out: '2026-06-17', noites: 3,
      regime: 'BB', quarto_tipo: 'Deluxe Sea View', bebidas: '',
      lat: 32.0741, lng: 34.7764, viagem_noturna: false,
    }),
    // TRANSPORTE — Voo de ida
    s('TRANSPORTE', 8, {
      id: generateId(), tipo: 'VOO', data: '2026-06-09',
      origem: 'GRU', destino: 'TLV', companhia: 'LATAM', numero_voo: 'LA8084',
      horario_saida: '23:55', horario_chegada: '18:30', tempo_estimado: '14h35',
      detalhes: 'Voo direto São Paulo → Tel Aviv | R$ 4.850,00 ida e volta',
    }),
    // TRANSPORTE — Voo de volta
    s('TRANSPORTE', 9, {
      id: generateId(), tipo: 'VOO', data: '2026-06-17',
      origem: 'TLV', destino: 'GRU', companhia: 'LATAM', numero_voo: 'LA8085',
      horario_saida: '00:30', horario_chegada: '09:15', tempo_estimado: '14h45',
      detalhes: 'VOLTA | Voo direto Tel Aviv → São Paulo',
    }),
    // INCLUSOS
    s('INCLUSOS', 10, {
      inclusos: [
        'Passagem aerea LATAM GRU↔TLV (voo direto, classe economica)',
        'Hospedagem 7 noites em hoteis 5 estrelas (David Citadel, Isrotel, The Norman)',
        'Cafe da manha diario em todos os hoteis',
        '3 jantares especiais (boas-vindas, Mar Morto, despedida)',
        '1 almoco tipico em Jerusalem',
        'Todos os transfers privativos em van executiva',
        'Guia profissional em portugues durante todo o roteiro',
        'Ingressos para Massada (com teleferico)',
        'Seguro viagem completo com cobertura de USD 100.000',
        'Kit do viajante (mapa, guia impresso, necessaire)',
      ],
      nao_inclusos: [
        'Refeicoes nao mencionadas no roteiro',
        'Bebidas durante as refeicoes',
        'Passeios opcionais (passeio de barco em Tiberias, etc.)',
        'Despesas pessoais e gorjetas',
        'Taxa de saida de Israel (se aplicavel)',
        'Excesso de bagagem',
      ],
    }),
    // VALORES com 2 opcoes
    s('VALORES', 11, {
      opcoes: [
        {
          titulo: 'Apto Duplo (por pessoa)',
          valor_total: 18450,
          destaque: true,
          parcelas: [
            { forma: 'A vista PIX', valor_parcela: 18450, valor_total: 18450, destaque: true },
            { forma: '10x cartao s/ juros', valor_parcela: 1845, valor_total: 18450, destaque: false },
            { forma: '6x boleto', valor_parcela: 3075, valor_total: 18450, destaque: false },
          ],
        },
        {
          titulo: 'Single (quarto individual)',
          valor_total: 24900,
          destaque: false,
          parcelas: [
            { forma: 'A vista PIX', valor_parcela: 24900, valor_total: 24900, destaque: true },
            { forma: '10x cartao s/ juros', valor_parcela: 2490, valor_total: 24900, destaque: false },
          ],
        },
      ],
      observacoes_valores: 'Valores validos para saida em 09/Jun/2026. Sujeito a disponibilidade. Criancas de 2 a 11 anos: consultar.',
      validade: '2026-05-15',
    }),
    // FAQ
    s('FAQ', 12, { titulo: 'Perguntas Frequentes', perguntas: [
      { pergunta: 'Preciso de visto para Israel?', resposta: 'Brasileiros nao precisam de visto para estadias de ate 90 dias. Basta passaporte valido com pelo menos 6 meses de validade.' },
      { pergunta: 'Qual a moeda local?', resposta: 'O Shekel (ILS). Cartoes de credito internacionais sao aceitos na maioria dos estabelecimentos. Recomendamos levar dolares para trocar.' },
      { pergunta: 'E seguro viajar para Israel?', resposta: 'Sim. As areas turisticas sao extremamente seguras e bem policiadas. Nosso guia acompanha o grupo o tempo todo.' },
      { pergunta: 'Qual a melhor epoca para ir?', resposta: 'Junho e ideal: clima seco, temperaturas agradaveis (25-30°C) e pouca chuva. Perfeito para passeios ao ar livre.' },
    ] }),
    // DEPOIMENTO
    s('DEPOIMENTO', 13, { depoimentos: [
      { texto: 'A viagem a Terra Santa mudou minha vida. Cada lugar que visitamos tem um significado profundo. O David Citadel e espetacular — acordar vendo as muralhas de Jerusalem nao tem preco.', autor: 'Maria e Joao S.', foto: '', destino: 'Israel 2025' },
      { texto: 'Organização impecavel do inicio ao fim. O guia sabia tudo sobre a historia, a comida era incrivel e flutuar no Mar Morto foi a experiencia mais surreal da minha vida!', autor: 'Carlos M.', foto: '', destino: 'Israel 2024' },
    ] }),
    // CTA
    s('CTA', 14, { texto_botao: 'Quero conhecer a Terra Santa!', tipo_acao: 'WHATSAPP', numero_whatsapp: '', mensagem_predefinida: 'Ola! Vi a proposta Terra Santa e quero reservar minha viagem a Israel.', cor_botao: '#1e40af' }),
    // COUNTDOWN
    s('COUNTDOWN', 15, { titulo: 'Embarque em', data_evento: '2026-06-09T23:55:00', mensagem: 'Faltam poucos dias para a viagem dos sonhos!' }),
  ],
  mensagem_abertura_padrao: 'Prezado(a) cliente,\n\nE com grande alegria que apresentamos este roteiro pela Terra Santa. Cada detalhe foi cuidadosamente planejado para proporcionar uma experiencia transformadora — combinando fe, historia milenar e paisagens de tirar o folego.\n\nEstamos a disposicao para personalizar qualquer detalhe.',
  inclusos_padrao: ['Passagem aerea', 'Hoteis 5★', 'Guia portugues', 'Transfers', 'Seguro'],
  nao_inclusos_padrao: ['Refeicoes extras', 'Bebidas', 'Gorjetas'],
  is_padrao: true,
};
// Attach viagem to the template secoes (will be set on proposta.viagem when template is selected)
(terraSanta as Record<string, unknown>).viagem_padrao = {
  duracao_dias: 8, duracao_noites: 7,
  destinos: [
    { id: generateId(), nome: 'Jerusalem', descricao: 'Cidade Santa', dias_inicio: 2, dias_fim: 4, alojamento_ids: [TERRA_SANTA_ALOJ[0].id] },
    { id: generateId(), nome: 'Mar Morto', descricao: '', dias_inicio: 5, dias_fim: 5, alojamento_ids: [TERRA_SANTA_ALOJ[1].id] },
    { id: generateId(), nome: 'Tel Aviv', descricao: '', dias_inicio: 6, dias_fim: 8, alojamento_ids: [TERRA_SANTA_ALOJ[2].id] },
  ],
  alojamentos: TERRA_SANTA_ALOJ,
  transportes: TERRA_SANTA_TRANSP,
  interesses_tags: ['Religioso', 'Cultural', 'Historia', 'Natureza', 'Gastronomia'],
  termos_condicoes: 'Cancelamento ate 45 dias antes: reembolso integral. 30-44 dias: 80%. 15-29 dias: 50%. Menos de 15 dias: sem reembolso. Seguro viagem obrigatorio.',
  sobre_agencia: 'Somos especialistas em viagens a Terra Santa ha mais de 15 anos. Mais de 3.000 passageiros realizaram o sonho de conhecer Israel conosco.',
};

// ═══════════════════════════════════════════════════════════════
// TEMPLATE 2: MALDIVAS LUA DE MEL — Resort all-inclusive
// Demonstra: layout classico, servicos com fotos, galeria, video, countdown
// ═══════════════════════════════════════════════════════════════
const maldivas: Omit<TemplateProposta, 'id'> = {
  nome: 'Maldivas — Lua de Mel',
  descricao: 'Overwater villa nas Maldivas com tudo incluso. 6 noites de puro luxo para casais. Layout CLASSICO com servicos detalhados.',
  tipo_viagem: 'ROMANCE',
  icone: '💍',
  imagem_preview: 'https://images.unsplash.com/photo-1514282401047-d79a71a590e8?w=600&q=80',
  visual: {
    tema: 'padrao', cor_primaria: '#0891b2', cor_secundaria: '#0a0a14', cor_texto: '#1a1a2e',
    cor_fundo: '#ecfeff', fonte: 'Inter',
    imagem_capa: 'https://images.unsplash.com/photo-1514282401047-d79a71a590e8?w=1400&q=80',
    estilo_capa: 'FULLSCREEN',
  },
  secoes_padrao: [
    s('TEXTO', 0, {
      titulo: 'Maldivas — Onde o paraiso encontra o oceano',
      corpo: '<p>Imaginem acordar sobre aguas cristalinas, com o som suave das ondas como despertador. Nas <strong>Maldivas</strong>, cada momento e uma celebracao do amor — do cafe da manha flutuante ao jantar sob as estrelas.</p><p>Este roteiro foi criado especialmente para voces, com cada detalhe pensado para ser <em>inesquecivel</em>.</p>',
      alinhamento: 'center',
    }),
    s('GALERIA', 1, { imagens: [
      'https://images.unsplash.com/photo-1514282401047-d79a71a590e8?w=800&q=80',
      'https://images.unsplash.com/photo-1573843981267-be1999ff37cd?w=800&q=80',
      'https://images.unsplash.com/photo-1540202404-a2f29016b523?w=800&q=80',
      'https://images.unsplash.com/photo-1439130490301-25e322d88054?w=800&q=80',
      'https://images.unsplash.com/photo-1602002418082-a4443e081dd1?w=800&q=80',
    ] }),
    s('SERVICO', 2, {
      icone: '✈️', titulo: 'Voo Sao Paulo → Male', detalhes: [
        'LATAM LA8070 — GRU → DOH (escala em Doha)',
        'Qatar Airways QR674 — DOH → MLE',
        'Duracao total: 22h com conexao',
        'Classe executiva disponivel (consultar)',
      ],
      descricao: 'Voo com conexao em Doha. Lounge VIP incluso na conexao. Chegada em Male com recepcao e transfer de seaplane ate o resort.',
      imagem: 'https://images.unsplash.com/photo-1436491865332-7a61a109db05?w=800&q=80',
      valor: 8900, exibir_valor: true,
    }),
    s('SERVICO', 3, {
      icone: '🏝️', titulo: 'Overwater Pool Villa — 6 noites', detalhes: [
        'Villa sobre a agua com piscina privativa',
        'Deck com acesso direto ao oceano',
        'Chao de vidro para observar a vida marinha',
        'Banheira de hidromassagem ao ar livre',
        'Servico de mordomo 24h',
      ],
      descricao: 'A suite mais exclusiva do resort, com 120m² sobre as aguas turquesa do Oceano Indico. All-inclusive premium com bebidas, spa e restaurantes.',
      imagem: 'https://images.unsplash.com/photo-1573843981267-be1999ff37cd?w=800&q=80',
      valor: 42000, exibir_valor: true,
    }),
    s('SERVICO', 4, {
      icone: '🤿', titulo: 'Experiencias Inclusas', detalhes: [
        'Mergulho com snorkel guiado (2x)',
        'Sunset dolphin cruise',
        'Cafe da manha flutuante na piscina',
        'Jantar romantico pe-na-areia com velas',
        'Sessao de spa para casal (60min)',
        'Aula de culinaria maldiviana',
      ],
      descricao: 'Experiencias curadas para criar memorias inesqueciveis. Todas inclusas no pacote sem custo adicional.',
      imagem: 'https://images.unsplash.com/photo-1540202404-a2f29016b523?w=800&q=80',
      valor: 0, exibir_valor: false,
    }),
    s('ROTEIRO_DIA', 5, { dias: [
      { numero: 1, titulo: 'Dia 1 — Embarque', descricao: 'Saida de Sao Paulo no voo LATAM com conexao em Doha. Lounge VIP na conexao.', imagem: '', atividades: [], refeicoes_inclusas: 'Refeicoes a bordo' },
      { numero: 2, titulo: 'Dia 2 — Chegada ao Paraiso', descricao: 'Chegada em Male. Transfer de seaplane (30min, vista espetacular) ate o resort. Check-in na Overwater Villa. Resto do dia livre para curtir a villa e a piscina privativa. Jantar de boas-vindas.', imagem: 'https://images.unsplash.com/photo-1573843981267-be1999ff37cd?w=800&q=80', atividades: ['Seaplane Male → Resort', 'Check-in Overwater Villa', 'Jantar de boas-vindas'], refeicoes_inclusas: 'Almoco e jantar' },
      { numero: 3, titulo: 'Dia 3 — Snorkel e Sunset Cruise', descricao: 'Manha de snorkel guiado no recife da house reef. Almoco no restaurante overwater. Tarde livre. Ao entardecer, sunset dolphin cruise com champagne.', imagem: 'https://images.unsplash.com/photo-1540202404-a2f29016b523?w=800&q=80', atividades: ['Snorkel guiado na house reef', 'Sunset dolphin cruise'], refeicoes_inclusas: 'All-inclusive' },
      { numero: 4, titulo: 'Dia 4 — Spa & Romance', descricao: 'Manha com sessao de spa para casal. Almoco em sandbank privativo. Tarde: cafe da manha flutuante na piscina da villa (sessao de fotos inclusa).', imagem: '', atividades: ['Spa para casal (60min)', 'Almoco em sandbank privativo', 'Floating breakfast + fotos'], refeicoes_inclusas: 'All-inclusive' },
      { numero: 5, titulo: 'Dia 5 — Exploracao', descricao: 'Visita a ilha local (cultura maldiviana). Aula de culinaria. Segundo mergulho de snorkel em recife externo. Jantar romantico pe-na-areia com velas e musica ao vivo.', imagem: '', atividades: ['Visita a ilha local', 'Aula de culinaria', 'Snorkel recife externo', 'Jantar romantico pe-na-areia'], refeicoes_inclusas: 'All-inclusive' },
      { numero: 6, titulo: 'Dia 6 — Dia Livre', descricao: 'Dia inteiramente livre para aproveitar o resort no ritmo de voces. Paddleboard, caiaque, biblioteca, cinema ao ar livre. Late check-out disponivel.', imagem: '', atividades: ['Dia livre no resort', 'Atividades aquaticas', 'Cinema ao ar livre'], refeicoes_inclusas: 'All-inclusive' },
      { numero: 7, titulo: 'Dia 7 — Retorno', descricao: 'Ultimo cafe da manha com vista. Transfer de seaplane ate Male. Voo de retorno a Sao Paulo via Doha.', imagem: '', atividades: ['Check-out e seaplane', 'Voo MLE → DOH → GRU'], refeicoes_inclusas: 'Cafe da manha' },
    ] }),
    s('INCLUSOS', 6, {
      inclusos: [
        'Passagem aerea GRU↔MLE com conexao (classe economica premium)',
        'Transfer de seaplane Male↔Resort (ida e volta)',
        'Overwater Pool Villa — 6 noites all-inclusive',
        'Todas as refeicoes e bebidas premium (all-inclusive)',
        'Cafe da manha flutuante',
        'Jantar romantico pe-na-areia',
        '2 sessoes de snorkel guiado',
        'Sunset dolphin cruise',
        'Spa para casal (60min)',
        'Aula de culinaria maldiviana',
        'Wi-Fi de alta velocidade',
        'Seguro viagem com cobertura de USD 150.000',
      ],
      nao_inclusos: [
        'Mergulho com cilindro (SCUBA)',
        'Excursoes adicionais',
        'Tratamentos de spa extras',
        'Compras pessoais',
        'Gorjetas (recomendado USD 5-10/dia)',
        'Upgrade para classe executiva no voo',
      ],
    }),
    s('VALORES', 7, {
      opcoes: [
        {
          titulo: 'Pacote Casal — Overwater Villa',
          valor_total: 52900,
          destaque: true,
          parcelas: [
            { forma: 'A vista PIX (5% desc.)', valor_parcela: 50255, valor_total: 50255, destaque: true },
            { forma: '12x cartao s/ juros', valor_parcela: 4408, valor_total: 52900, destaque: false },
            { forma: '3x boleto', valor_parcela: 17633, valor_total: 52900, destaque: false },
          ],
        },
        {
          titulo: 'Upgrade Beach Villa com Piscina',
          valor_total: 38500,
          destaque: false,
          parcelas: [
            { forma: 'A vista PIX', valor_parcela: 38500, valor_total: 38500, destaque: true },
            { forma: '10x cartao s/ juros', valor_parcela: 3850, valor_total: 38500, destaque: false },
          ],
        },
      ],
      observacoes_valores: 'Valores para o casal (2 pessoas). Validos para embarque Jun-Set/2026. Alta temporada (Dez-Mar): acrescimo de 30%.',
      validade: '2026-05-30',
    }),
    s('DEPOIMENTO', 8, { depoimentos: [
      { texto: 'Foi a melhor decisao da nossa lua de mel. A overwater villa e REAL — voce olha pro chao de vidro e ve raias passando! O jantar na areia com velas foi o momento mais magico da nossa vida.', autor: 'Fernanda e Rafael', foto: '', destino: 'Maldivas 2025' },
    ] }),
    s('CTA', 9, { texto_botao: 'Reservar nosso paraiso', tipo_acao: 'WHATSAPP', numero_whatsapp: '', mensagem_predefinida: 'Ola! Queremos reservar o pacote Maldivas Lua de Mel!', cor_botao: '#0891b2' }),
    s('COUNTDOWN', 10, { titulo: 'Embarque para o paraiso em', data_evento: '2026-07-01T22:00:00', mensagem: 'O paraiso esta mais perto do que voce imagina!' }),
  ],
  mensagem_abertura_padrao: 'Queridos,\n\nNao existe lugar mais perfeito para celebrar o amor de voces do que as Maldivas. Preparamos um roteiro all-inclusive com tudo o que voces merecem — villa sobre as aguas, experiencias exclusivas e momentos que ficarao para sempre na memoria.\n\nCada detalhe foi pensado com carinho. Confiram!',
  inclusos_padrao: ['Aereo', 'Seaplane', 'Villa all-inclusive', 'Experiencias', 'Seguro'],
  nao_inclusos_padrao: ['Mergulho SCUBA', 'Spa extra', 'Gorjetas'],
  is_padrao: true,
};

// ═══════════════════════════════════════════════════════════════
// TEMPLATE 3: PATAGONIA AVENTURA — Trekking El Chalten + Perito Moreno
// Demonstra: layout discovery, mapa, transporte misto (voo + transfer)
// ═══════════════════════════════════════════════════════════════
const PATAG_ALOJ: AlojamentoData[] = [
  aloj({
    destino_nome: 'El Calafate', hotel_nome: 'Esplendor by Wyndham Calafate', hotel_estrelas: 4,
    hotel_imagem: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80',
    hotel_galeria: [], hotel_descricao: 'Hotel 4 estrelas com vista para o Lago Argentino. Spa, restaurante regional e aquecimento central.',
    hotel_link: '', check_in: '2026-09-15', check_out: '2026-09-18', noites: 3,
    regime: 'BB', quarto_tipo: 'Superior Lake View', bebidas: '',
    lat: -50.3379, lng: -72.2648, viagem_noturna: false,
  }),
  aloj({
    destino_nome: 'El Chalten', hotel_nome: 'Hosteria Senderos', hotel_estrelas: 3,
    hotel_imagem: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80',
    hotel_galeria: [], hotel_descricao: 'Hosteria acolhedora no coracao de El Chalten. Cafe da manha reforçado para trilheiros, sala com lareira.',
    hotel_link: '', check_in: '2026-09-18', check_out: '2026-09-20', noites: 2,
    regime: 'BB', quarto_tipo: 'Standard', bebidas: '',
    lat: -49.3314, lng: -72.8867, viagem_noturna: false,
  }),
];

const PATAG_TRANSP: TransporteData[] = [
  transp({ tipo: 'VOO', data: '2026-09-15', origem: 'GRU', destino: 'EZE', companhia: 'Aerolineas Argentinas', numero_voo: 'AR1141', horario_saida: '07:30', horario_chegada: '10:15', tempo_estimado: '2h45', detalhes: 'Voo direto' }),
  transp({ tipo: 'VOO', data: '2026-09-15', origem: 'AEP', destino: 'FTE', companhia: 'Aerolineas Argentinas', numero_voo: 'AR1880', horario_saida: '13:00', horario_chegada: '16:20', tempo_estimado: '3h20', detalhes: 'Voo direto | Conexao em Buenos Aires' }),
  transp({ tipo: 'TRANSFER', data: '2026-09-18', origem: 'El Calafate', destino: 'El Chalten', companhia: 'CalTur', numero_voo: '', horario_saida: '08:00', horario_chegada: '11:00', distancia_km: 213, tempo_estimado: '3h', detalhes: 'Bus rodoviario panoramico pela Ruta 40' }),
  transp({ tipo: 'TRANSFER', data: '2026-09-20', origem: 'El Chalten', destino: 'El Calafate (aeroporto)', companhia: 'CalTur', numero_voo: '', horario_saida: '06:00', horario_chegada: '09:00', distancia_km: 213, tempo_estimado: '3h', detalhes: 'Transfer direto ao aeroporto' }),
  transp({ tipo: 'VOO', data: '2026-09-20', origem: 'FTE', destino: 'GRU', companhia: 'Aerolineas Argentinas', numero_voo: 'AR1881/AR1140', horario_saida: '11:00', horario_chegada: '21:30', tempo_estimado: '10h30', detalhes: 'VOLTA | 1 escala(s): AEP' }),
];

const patagonia: Omit<TemplateProposta, 'id'> = {
  nome: 'Patagonia — Aventura Glaciar',
  descricao: 'Trekking em El Chalten, Perito Moreno e paisagens da Patagonia argentina. 6 dias de aventura com voos, transfers e hoteis. Layout DISCOVERY.',
  tipo_viagem: 'AVENTURA',
  icone: '🏔️',
  imagem_preview: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600&q=80',
  visual: {
    tema: 'padrao', layout: 'DISCOVERY', cor_primaria: '#059669', cor_secundaria: '#0a0a14', cor_texto: '#111827',
    cor_fundo: '#f0fdf4', fonte: 'Inter',
    imagem_capa: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1400&q=80',
    estilo_capa: 'FULLSCREEN',
  },
  secoes_padrao: [
    s('TEXTO', 0, { titulo: 'Patagonia — Onde o mundo e selvagem', corpo: 'Trilhas entre geleiras, montanhas lendarias e paisagens que parecem de outro planeta. Um roteiro para quem quer sentir a forca da natureza de perto.', alinhamento: 'center' }),
    s('ROTEIRO_DIA', 1, { dias: [
      { numero: 1, titulo: 'Dia 1 — Sao Paulo → El Calafate', descricao: 'Voo GRU→EZE pela manha. Conexao em Buenos Aires e voo AEP→FTE a tarde. Chegada em El Calafate as 16:20. Transfer ao hotel. Jantar livre.', imagem: '', atividades: ['Voo GRU→EZE (2h45)', 'Conexao em Buenos Aires', 'Voo AEP→FTE (3h20)', 'Transfer ao Esplendor Calafate'], refeicoes_inclusas: 'Refeicoes a bordo', lat: -50.3379, lng: -72.2648 },
      { numero: 2, titulo: 'Dia 2 — Perito Moreno', descricao: 'Dia inteiro no Glaciar Perito Moreno. Caminhada pelas passarelas com vista frontal do glaciar. Opcional: minitrekking sobre o gelo (nao incluso). Retorno ao hotel ao entardecer.', imagem: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80', atividades: ['Parque Nacional Los Glaciares', 'Passarelas Glaciar Perito Moreno', 'Opcional: minitrekking no gelo', 'Safari nautico pelo Canal de los Tempanos'], refeicoes_inclusas: 'Cafe da manha e lunchbox', lat: -50.4967, lng: -73.0372 },
      { numero: 3, titulo: 'Dia 3 — Lago Argentino & Estancias', descricao: 'Passeio de barco pelo Lago Argentino com vista aos glaciares Upsala e Spegazzini. Tarde livre ou visita a estancia patagonica com churrasco de cordeiro.', imagem: '', atividades: ['Navegacao Lago Argentino (Todo Glaciares)', 'Glaciar Upsala', 'Glaciar Spegazzini', 'Churrasco de cordeiro na estancia'], refeicoes_inclusas: 'Cafe da manha e almoco', lat: -50.2136, lng: -72.8883 },
      { numero: 4, titulo: 'Dia 4 — El Calafate → El Chalten', descricao: 'Transfer panoramico pela Ruta 40 (3h). Chegada em El Chalten, capital do trekking. Trilha leve de adaptacao ate o Mirador de los Condores.', imagem: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80', atividades: ['Bus panoramico Ruta 40 (3h)', 'Check-in Hosteria Senderos', 'Trilha Mirador de los Condores (1h30)', 'Vista panoramica de El Chalten'], refeicoes_inclusas: 'Cafe da manha', lat: -49.3314, lng: -72.8867 },
      { numero: 5, titulo: 'Dia 5 — Trilha Laguna de los Tres (Fitz Roy)', descricao: 'A trilha mais iconica da Patagonia! 25km (10-12h) ate a base do Monte Fitz Roy com vista da Laguna de los Tres. Nivel: moderado-dificil.', imagem: '', atividades: ['Trilha Laguna de los Tres (25km)', 'Vista do Monte Fitz Roy (3.405m)', 'Laguna de los Tres', 'Nivel: moderado-dificil'], refeicoes_inclusas: 'Cafe da manha reforçado e lunchbox', lat: -49.2712, lng: -72.9437 },
      { numero: 6, titulo: 'Dia 6 — Retorno', descricao: 'Saida cedo de El Chalten ao aeroporto de El Calafate (3h). Voo FTE→AEP→GRU. Chegada em Sao Paulo as 21:30.', imagem: '', atividades: ['Transfer El Chalten → Aeroporto (3h)', 'Voo FTE→AEP (3h20)', 'Conexao em Buenos Aires', 'Voo AEP→GRU'], refeicoes_inclusas: 'Cafe da manha', lat: -50.2803, lng: -72.0530 },
    ] }),
    s('INCLUSOS', 2, {
      inclusos: [
        'Passagem aerea GRU↔FTE com conexao em Buenos Aires (Aerolineas Argentinas)',
        'Hospedagem 3 noites El Calafate (Esplendor 4★) + 2 noites El Chalten (Hosteria Senderos)',
        'Cafe da manha diario',
        '1 almoco na estancia + 2 lunchbox para trilhas',
        'Transfer Bus El Calafate ↔ El Chalten (ida e volta)',
        'Excursao Perito Moreno com passarelas',
        'Navegacao Todo Glaciares (Upsala + Spegazzini)',
        'Ingresso Parque Nacional Los Glaciares',
        'Seguro viagem aventura com resgate em montanha',
      ],
      nao_inclusos: [
        'Minitrekking no Glaciar Perito Moreno (USD 220 pp)',
        'Refeicoes nao mencionadas',
        'Equipamento de trekking pessoal',
        'Gorjetas',
        'Gastos pessoais',
      ],
    }),
    s('VALORES', 3, {
      opcoes: [{
        titulo: 'Pacote Aventura (por pessoa, apto duplo)',
        valor_total: 8950,
        destaque: true,
        parcelas: [
          { forma: 'A vista PIX', valor_parcela: 8950, valor_total: 8950, destaque: true },
          { forma: '10x cartao s/ juros', valor_parcela: 895, valor_total: 8950, destaque: false },
        ],
      }],
      observacoes_valores: 'Valores em reais por pessoa. Sujeito a disponibilidade e variacao cambial (dolar blue). Saida set/2026.',
      validade: '2026-07-31',
    }),
    s('FAQ', 4, { titulo: 'Perguntas Frequentes', perguntas: [
      { pergunta: 'Qual o nivel de dificuldade das trilhas?', resposta: 'A trilha do Fitz Roy e moderada-dificil (25km, 10-12h). As demais sao leves. Recomendamos preparo fisico basico.' },
      { pergunta: 'Que roupas levar?', resposta: 'Sistema de camadas: segunda pele termica + fleece + corta-vento impermeavel. Bota de trekking impermeavel obrigatoria. O clima muda rapidamente.' },
      { pergunta: 'Preciso de visto para Argentina?', resposta: 'Brasileiros nao precisam de visto. Basta RG ou passaporte valido.' },
    ] }),
    s('CTA', 5, { texto_botao: 'Reservar minha aventura!', tipo_acao: 'WHATSAPP', numero_whatsapp: '', mensagem_predefinida: 'Ola! Quero reservar o pacote Patagonia Aventura!', cor_botao: '#059669' }),
  ],
  mensagem_abertura_padrao: 'A Patagonia esta chamando! Preparamos um roteiro que combina as geleiras monumentais de El Calafate com o trekking lendario de El Chalten. Uma experiencia para quem busca contato genuino com a natureza.',
  inclusos_padrao: ['Aereo', 'Hoteis', 'Transfers', 'Excursoes', 'Seguro aventura'],
  nao_inclusos_padrao: ['Minitrekking', 'Refeicoes extras', 'Equipamento pessoal'],
  is_padrao: true,
};
(patagonia as Record<string, unknown>).viagem_padrao = {
  duracao_dias: 6, duracao_noites: 5,
  destinos: [
    { id: generateId(), nome: 'El Calafate', descricao: 'Perito Moreno e Lago Argentino', dias_inicio: 1, dias_fim: 3, alojamento_ids: [PATAG_ALOJ[0].id] },
    { id: generateId(), nome: 'El Chalten', descricao: 'Fitz Roy e trekking', dias_inicio: 4, dias_fim: 6, alojamento_ids: [PATAG_ALOJ[1].id] },
  ],
  alojamentos: PATAG_ALOJ,
  transportes: PATAG_TRANSP,
  interesses_tags: ['Aventura', 'Trekking', 'Natureza', 'Glaciares', 'Fotografia'],
};

// ═══════════════════════════════════════════════════════════════
// TEMPLATE 4: DISNEY ORLANDO — Família com 4 parques + Universal
// Demonstra: layout CLASSICO, multiplos servicos com fotos, roteiro 10 dias, mapa Orlando
// ═══════════════════════════════════════════════════════════════
const DISNEY_ALOJ: AlojamentoData[] = [
  aloj({
    destino_nome: 'Orlando — Disney Resort', hotel_nome: 'Disney\'s Art of Animation Resort', hotel_estrelas: 4,
    hotel_imagem: 'https://images.unsplash.com/photo-1605108042851-6a8b6f73fbf7?w=800&q=80',
    hotel_galeria: [
      'https://images.unsplash.com/photo-1597466765990-64ad1c35dafc?w=600&q=80',
      'https://images.unsplash.com/photo-1531219572328-a0171b4448a3?w=600&q=80',
    ],
    hotel_descricao: 'Hotel oficial da Disney com tema dos filmes Procurando Nemo, Carros, Rei Leao e Pequena Sereia. Suites familiares para ate 6 pessoas, piscina com fundo musical, transporte gratuito para todos os parques.',
    hotel_link: 'https://disneyworld.disney.go.com/resorts/art-of-animation-resort/',
    check_in: '2026-07-10', check_out: '2026-07-19', noites: 9,
    regime: 'RO', quarto_tipo: 'Family Suite (Pequena Sereia)', bebidas: '',
    lat: 28.3585, lng: -81.5454, viagem_noturna: false,
  }),
];

const DISNEY_TRANSP: TransporteData[] = [
  transp({ tipo: 'VOO', data: '2026-07-10', origem: 'GRU', destino: 'MCO', companhia: 'LATAM', numero_voo: 'LA8124', horario_saida: '21:55', horario_chegada: '06:30', tempo_estimado: '9h35', detalhes: 'Voo direto noturno' }),
  transp({ tipo: 'TRANSFER', data: '2026-07-10', origem: 'Aeroporto MCO', destino: 'Disney Resort', companhia: 'Mears Connect', numero_voo: '', horario_saida: '07:30', horario_chegada: '08:30', distancia_km: 35, tempo_estimado: '1h', detalhes: 'Transfer compartilhado oficial Disney' }),
  transp({ tipo: 'CARRO', data: '2026-07-15', origem: 'Disney Resort', destino: 'Universal Studios', companhia: 'Alamo Rent-a-Car', numero_voo: '', horario_saida: '08:00', horario_chegada: '08:30', distancia_km: 18, tempo_estimado: '30min', detalhes: 'Aluguel por 4 dias (jul/15-19) — categoria SUV' }),
  transp({ tipo: 'TRANSFER', data: '2026-07-19', origem: 'Disney Resort', destino: 'Aeroporto MCO', companhia: 'Mears Connect', numero_voo: '', horario_saida: '17:00', horario_chegada: '18:00', distancia_km: 35, tempo_estimado: '1h', detalhes: 'Transfer ao aeroporto' }),
  transp({ tipo: 'VOO', data: '2026-07-19', origem: 'MCO', destino: 'GRU', companhia: 'LATAM', numero_voo: 'LA8125', horario_saida: '21:30', horario_chegada: '07:15', tempo_estimado: '9h45', detalhes: 'VOLTA | Voo direto noturno' }),
];

const disney: Omit<TemplateProposta, 'id'> = {
  nome: 'Disney Orlando — Família Mágica',
  descricao: '10 dias em Orlando com 4 parques Disney + Universal Studios. Hotel oficial Disney, Magic Bands, Genie+ inclusos. Layout CLASSICO completo para famílias.',
  tipo_viagem: 'FAMILIA',
  icone: '🎢',
  imagem_preview: 'https://images.unsplash.com/photo-1597466765990-64ad1c35dafc?w=600&q=80',
  visual: {
    tema: 'padrao', layout: 'CLASSICO', cor_primaria: '#7c3aed', cor_secundaria: '#0a0a14', cor_texto: '#1a1a2e',
    cor_fundo: '#faf5ff', fonte: 'Inter',
    imagem_capa: 'https://images.unsplash.com/photo-1597466765990-64ad1c35dafc?w=1400&q=80',
    estilo_capa: 'FULLSCREEN',
  },
  secoes_padrao: [
    s('TEXTO', 0, {
      titulo: 'Onde os sonhos se tornam realidade',
      corpo: '<p>Sua família vai viver <strong>10 dias mágicos</strong> em Orlando — caminhando pelo Castelo da Cinderella, voando com Peter Pan, desafiando Hulk na Universal e mergulhando no mundo de Harry Potter.</p><p>Reservamos cada detalhe: hotel oficial Disney, transporte, Magic Bands, ingressos com Genie+ e até o aluguel de carro para a Universal.</p>',
      alinhamento: 'center',
    }),
    s('GALERIA', 1, { imagens: [
      'https://images.unsplash.com/photo-1597466765990-64ad1c35dafc?w=800&q=80',
      'https://images.unsplash.com/photo-1605108042851-6a8b6f73fbf7?w=800&q=80',
      'https://images.unsplash.com/photo-1607861716497-e65ab29fc7ac?w=800&q=80',
      'https://images.unsplash.com/photo-1531219572328-a0171b4448a3?w=800&q=80',
      'https://images.unsplash.com/photo-1610375461246-83df859d849d?w=800&q=80',
      'https://images.unsplash.com/photo-1573481078476-baef74ddec76?w=800&q=80',
    ] }),
    s('VIDEO', 2, {
      titulo: 'Walt Disney World — Tour pelos 4 parques',
      url: 'https://www.youtube.com/watch?v=yMlUWp4ckqo',
    }),
    s('MAPA', 3, {
      titulo: 'Orlando — todos os parques que você visitará',
      zoom: 11,
      pontos: [
        { lat: 28.4177, lng: -81.5812, label: 'Magic Kingdom — Castelo' },
        { lat: 28.3747, lng: -81.5494, label: 'Epcot — Spaceship Earth' },
        { lat: 28.3597, lng: -81.5586, label: 'Hollywood Studios — Star Wars' },
        { lat: 28.3553, lng: -81.5901, label: 'Animal Kingdom — Pandora' },
        { lat: 28.4750, lng: -81.4683, label: 'Universal Studios' },
        { lat: 28.4717, lng: -81.4727, label: 'Islands of Adventure — Hogwarts' },
        { lat: 28.3585, lng: -81.5454, label: 'Disney\'s Art of Animation Resort' },
      ],
    }),
    s('SERVICO', 4, {
      icone: '🏰', titulo: 'Magic Kingdom — Dia 1', detalhes: [
        'Castelo da Cinderella e show Happily Ever After (fogos)',
        'Space Mountain, Big Thunder Mountain, Splash Mountain',
        'Encontro com personagens (Mickey, Princesas, Stitch)',
        'Parade Festival of Fantasy as 15h',
        'Genie+ incluso — fila rápida em 7 atrações',
      ],
      descricao: 'O parque mais icônico da Disney. Comece pelo Castelo da Cinderella, deixando para os fogos do show Happily Ever After fechar o dia.',
      imagem: 'https://images.unsplash.com/photo-1597466765990-64ad1c35dafc?w=800&q=80',
      valor: 0, exibir_valor: false,
    }),
    s('SERVICO', 5, {
      icone: '🌍', titulo: 'Epcot — Dia 2', detalhes: [
        'Spaceship Earth (a esfera gigante)',
        '11 países do World Showcase (México, Japão, Itália, Alemanha...)',
        'Test Track — simulador de carros',
        'Soarin\' Around the World',
        'Festival de Sabores Internacionais',
      ],
      descricao: 'Cultura, gastronomia e tecnologia. Um dia para passear pelos 11 países e experimentar comidas autênticas. Perfeito para casais e adultos.',
      imagem: 'https://images.unsplash.com/photo-1610375461246-83df859d849d?w=800&q=80',
      valor: 0, exibir_valor: false,
    }),
    s('SERVICO', 6, {
      icone: '🎬', titulo: 'Hollywood Studios — Dia 3', detalhes: [
        'Star Wars: Galaxy\'s Edge (planeta Batuu)',
        'Rise of the Resistance — atração nº 1 da Disney',
        'Tower of Terror (queda de elevador 13 andares)',
        'Rock \'n\' Roller Coaster (Aerosmith)',
        'Toy Story Land',
      ],
      descricao: 'Cinema e Star Wars em estado puro. Para os fãs, esse é o dia mais aguardado da viagem.',
      imagem: 'https://images.unsplash.com/photo-1607861716497-e65ab29fc7ac?w=800&q=80',
      valor: 0, exibir_valor: false,
    }),
    s('SERVICO', 7, {
      icone: '🦁', titulo: 'Animal Kingdom — Dia 4', detalhes: [
        'Pandora — World of Avatar e Flight of Passage',
        'Expedition Everest (montanha-russa Yeti)',
        'Kilimanjaro Safaris (safari real com leões e girafas)',
        'Festival of the Lion King',
        'Tree of Life à noite com show Awakenings',
      ],
      descricao: 'O parque mais natural da Disney. Safari de verdade, atrações inspiradas em Avatar e o show noturno mais bonito de Orlando.',
      imagem: 'https://images.unsplash.com/photo-1605114985479-0a8b4f7989da?w=800&q=80',
      valor: 0, exibir_valor: false,
    }),
    s('SERVICO', 8, {
      icone: '🧙', titulo: 'Universal Studios + Islands of Adventure — Dias 6 e 7', detalhes: [
        'Wizarding World of Harry Potter (Diagon Alley + Hogsmeade)',
        'Hogwarts Express conectando os 2 parques',
        'Velocicoaster (montanha-russa nº 1 do mundo 2024)',
        'Hulk Coaster + Spider-Man Adventure',
        'Express Pass incluso — fila rápida ilimitada',
      ],
      descricao: '2 dias completos no universo Universal. Para os fãs de Harry Potter, é uma experiência transformadora.',
      imagem: 'https://images.unsplash.com/photo-1573481078476-baef74ddec76?w=800&q=80',
      valor: 0, exibir_valor: false,
    }),
    s('ROTEIRO_DIA', 9, { dias: [
      { numero: 1, titulo: 'Dia 1 — Embarque', descricao: 'Saída de São Paulo no voo LATAM LA8124 (direto noturno) com destino a Orlando. Jantar e café da manhã servidos a bordo.', imagem: '', atividades: ['Check-in GRU 19h', 'Embarque 21:55'], refeicoes_inclusas: 'Refeições a bordo', lat: -23.4356, lng: -46.4731 },
      { numero: 2, titulo: 'Dia 2 — Chegada Orlando + Disney Springs', descricao: 'Chegada em Orlando às 06:30. Transfer ao Disney\'s Art of Animation. Check-in antecipado, descanso e à tarde Disney Springs (compras, jantar, Cirque du Soleil opcional).', imagem: 'https://images.unsplash.com/photo-1605108042851-6a8b6f73fbf7?w=800&q=80', atividades: ['Transfer MCO → Disney Resort', 'Check-in Art of Animation', 'Tarde livre em Disney Springs', 'Retirada dos Magic Bands'], refeicoes_inclusas: '', lat: 28.3585, lng: -81.5454 },
      { numero: 3, titulo: 'Dia 3 — Magic Kingdom', descricao: 'O parque mais icônico da Disney. Castelo da Cinderella, atrações clássicas e show de fogos Happily Ever After.', imagem: 'https://images.unsplash.com/photo-1597466765990-64ad1c35dafc?w=800&q=80', atividades: ['Magic Kingdom 9h-22h', 'Encontro com personagens', 'Parade Festival of Fantasy', 'Show Happily Ever After'], refeicoes_inclusas: '', lat: 28.4177, lng: -81.5812 },
      { numero: 4, titulo: 'Dia 4 — Epcot', descricao: 'Tour pelos 11 países do World Showcase, atrações futuristas e festival de sabores.', imagem: 'https://images.unsplash.com/photo-1610375461246-83df859d849d?w=800&q=80', atividades: ['Spaceship Earth', 'World Showcase (11 países)', 'Test Track e Soarin\'', 'Show noturno EPCOT Forever'], refeicoes_inclusas: '', lat: 28.3747, lng: -81.5494 },
      { numero: 5, titulo: 'Dia 5 — Hollywood Studios', descricao: 'Star Wars: Galaxy\'s Edge, Toy Story Land e atrações cinematográficas.', imagem: 'https://images.unsplash.com/photo-1607861716497-e65ab29fc7ac?w=800&q=80', atividades: ['Rise of the Resistance', 'Galaxy\'s Edge — Batuu', 'Tower of Terror', 'Rock\'n\'Roller Coaster'], refeicoes_inclusas: '', lat: 28.3597, lng: -81.5586 },
      { numero: 6, titulo: 'Dia 6 — Animal Kingdom', descricao: 'Pandora, safári real e o icônico show noturno Tree of Life Awakenings.', imagem: '', atividades: ['Pandora — Flight of Passage', 'Kilimanjaro Safaris', 'Expedition Everest', 'Festival of the Lion King'], refeicoes_inclusas: '', lat: 28.3553, lng: -81.5901 },
      { numero: 7, titulo: 'Dia 7 — Universal Studios', descricao: 'Início da experiência Universal. Diagon Alley, simuladores e atrações cinematográficas. Carro alugado retirado pela manhã.', imagem: 'https://images.unsplash.com/photo-1573481078476-baef74ddec76?w=800&q=80', atividades: ['Retirada do carro alugado', 'Universal Studios', 'Diagon Alley (Harry Potter)', 'Hogwarts Express → Islands'], refeicoes_inclusas: '', lat: 28.4750, lng: -81.4683 },
      { numero: 8, titulo: 'Dia 8 — Islands of Adventure', descricao: 'Hogsmeade, Velocicoaster e Hulk. Todos os super-heróis e dragões de Harry Potter no mesmo dia.', imagem: '', atividades: ['Hogsmeade & Hogwarts Castle', 'Velocicoaster (top 1 mundial)', 'Hulk Coaster', 'Spider-Man Adventure'], refeicoes_inclusas: '', lat: 28.4717, lng: -81.4727 },
      { numero: 9, titulo: 'Dia 9 — Outlets + Volcano Bay', descricao: 'Manhã de compras nos outlets premium (Vineland ou Orlando International). Tarde no Volcano Bay (parque aquático Universal) ou Disney Typhoon Lagoon — opcional.', imagem: '', atividades: ['Compras em Outlets premium', 'Almoço no Cheesecake Factory', 'Tarde livre — opcional Volcano Bay', 'Devolução do carro'], refeicoes_inclusas: '', lat: 28.4267, lng: -81.4505 },
      { numero: 10, titulo: 'Dia 10 — Retorno', descricao: 'Manhã livre. Late check-out às 16h. Transfer ao aeroporto e voo de volta a São Paulo.', imagem: '', atividades: ['Manhã livre / piscina', 'Late check-out 16h', 'Transfer ao aeroporto', 'Voo MCO → GRU 21:30'], refeicoes_inclusas: '', lat: 28.4294, lng: -81.3089 },
    ] }),
    s('ALOJAMENTO', 10, {
      id: generateId(),
      destino_nome: 'Orlando — Disney Resort', hotel_nome: 'Disney\'s Art of Animation Resort', hotel_estrelas: 4,
      hotel_imagem: 'https://images.unsplash.com/photo-1605108042851-6a8b6f73fbf7?w=800&q=80',
      hotel_galeria: [
        'https://images.unsplash.com/photo-1597466765990-64ad1c35dafc?w=600&q=80',
        'https://images.unsplash.com/photo-1531219572328-a0171b4448a3?w=600&q=80',
      ],
      hotel_descricao: 'Hotel oficial Disney com suítes familiares temáticas (Pequena Sereia, Carros, Rei Leão, Procurando Nemo). Acomoda até 6 pessoas. Inclui transporte gratuito a todos os parques, Early Park Entry e Extended Evening Hours.',
      hotel_link: 'https://disneyworld.disney.go.com/resorts/art-of-animation-resort/',
      check_in: '2026-07-10', check_out: '2026-07-19', noites: 9,
      regime: 'RO', quarto_tipo: 'Family Suite (Pequena Sereia)', bebidas: '',
      lat: 28.3585, lng: -81.5454, viagem_noturna: false,
    }),
    s('TRANSPORTE', 11, {
      id: generateId(), tipo: 'VOO', data: '2026-07-10',
      origem: 'GRU', destino: 'MCO', companhia: 'LATAM', numero_voo: 'LA8124',
      horario_saida: '21:55', horario_chegada: '06:30', tempo_estimado: '9h35',
      detalhes: 'Voo direto noturno São Paulo → Orlando',
    }),
    s('TRANSPORTE', 12, {
      id: generateId(), tipo: 'CARRO', data: '2026-07-15',
      origem: 'Alamo Disney Resort', destino: 'Universal Studios', companhia: 'Alamo Rent-a-Car', numero_voo: '',
      horario_saida: '08:00', horario_chegada: '08:30', tempo_estimado: '30min',
      detalhes: 'SUV intermediário — 4 dias com seguro full coverage',
    }),
    s('TRANSPORTE', 13, {
      id: generateId(), tipo: 'VOO', data: '2026-07-19',
      origem: 'MCO', destino: 'GRU', companhia: 'LATAM', numero_voo: 'LA8125',
      horario_saida: '21:30', horario_chegada: '07:15', tempo_estimado: '9h45',
      detalhes: 'VOLTA | Voo direto noturno',
    }),
    s('INCLUSOS', 14, {
      inclusos: [
        'Passagem aérea LATAM GRU↔MCO direto (classe econômica)',
        'Hospedagem 9 noites Disney\'s Art of Animation — Family Suite (acomoda 6)',
        'Ingressos 4 dias Park Hopper (Magic Kingdom, Epcot, Hollywood Studios, Animal Kingdom)',
        'Genie+ incluso em todos os dias Disney',
        'Ingressos 2 dias Park-to-Park Universal Studios + Islands of Adventure',
        'Express Pass Universal — fila rápida ilimitada',
        'Magic Bands para toda a família',
        'Transfer Mears Connect aeroporto ↔ hotel (ida e volta)',
        'Aluguel de carro SUV por 4 dias com seguro full',
        'Transporte gratuito Disney entre todos os parques e hotel',
        'Early Park Entry (30min antes da abertura)',
        'Seguro viagem com cobertura USD 100.000',
        'Chip de celular com 5GB de internet por pessoa',
      ],
      nao_inclusos: [
        'Refeições nos parques e hotel',
        'Volcano Bay e Typhoon Lagoon (parques aquáticos)',
        'Disney Memory Maker (fotos profissionais — opcional USD 199)',
        'Cirque du Soleil em Disney Springs',
        'Excesso de bagagem',
        'Gorjetas e despesas pessoais',
        'Estacionamento nos parques (incluso no carro)',
      ],
    }),
    s('VALORES', 15, {
      opcoes: [
        {
          titulo: 'Família 4 pessoas (2 adultos + 2 crianças)',
          valor_total: 47800,
          destaque: true,
          parcelas: [
            { forma: 'À vista PIX (5% desc.)', valor_parcela: 45410, valor_total: 45410, destaque: true },
            { forma: '12x cartão s/ juros', valor_parcela: 3983, valor_total: 47800, destaque: false },
            { forma: '6x boleto', valor_parcela: 7967, valor_total: 47800, destaque: false },
          ],
        },
        {
          titulo: 'Família 6 pessoas (Suíte completa)',
          valor_total: 68900,
          destaque: false,
          parcelas: [
            { forma: 'À vista PIX', valor_parcela: 65455, valor_total: 65455, destaque: true },
            { forma: '12x cartão s/ juros', valor_parcela: 5742, valor_total: 68900, destaque: false },
          ],
        },
        {
          titulo: 'Casal sem crianças (Standard Room)',
          valor_total: 32500,
          destaque: false,
          parcelas: [
            { forma: 'À vista PIX', valor_parcela: 32500, valor_total: 32500, destaque: true },
            { forma: '10x cartão s/ juros', valor_parcela: 3250, valor_total: 32500, destaque: false },
          ],
        },
      ],
      observacoes_valores: 'Valores totais para a família, não por pessoa. Crianças menores de 3 anos não pagam ingressos. Embarque jul/2026 (alta temporada). Para baixa temporada: -25%.',
      validade: '2026-06-15',
    }),
    s('FAQ', 16, { titulo: 'Perguntas Frequentes', perguntas: [
      { pergunta: 'Qual a melhor idade para levar crianças?', resposta: 'A partir dos 4 anos as crianças aproveitam plenamente. Bebês até 2 anos têm acesso gratuito mas não lembrarão da experiência. Dica: idade ideal entre 5 e 12 anos.' },
      { pergunta: 'Preciso de visto americano?', resposta: 'Sim. Visto B1/B2 (turismo) com validade de 10 anos. Cobramos a taxa do consulado USD 185 separadamente — entrevista presencial obrigatória em SP, RJ ou Recife.' },
      { pergunta: 'Vale a pena alugar carro?', resposta: 'Para Universal SIM (não há transporte Disney até lá). Entre os parques Disney, o transporte gratuito do hotel é eficiente — não precisa de carro.' },
      { pergunta: 'O que é Genie+ e Express Pass?', resposta: 'Sistemas de fila rápida. Genie+ na Disney (incluso) permite reservar horários nas atrações. Express Pass na Universal (incluso) é fila ilimitada — economiza 4-5 horas por dia.' },
      { pergunta: 'Posso comprar refeições à parte?', resposta: 'Sim. Custo médio USD 60-80 por pessoa/dia comendo nos parques. Ofereço pacote Disney Dining Plan opcional por +R$ 4.800 por pessoa para 9 dias.' },
    ] }),
    s('DEPOIMENTO', 17, { depoimentos: [
      { texto: 'Levamos nossas duas filhas (7 e 10) em julho. Foi a viagem dos sonhos! O hotel temático foi um sucesso, as Magic Bands abriam tudo sozinhas e o Genie+ economizou nossas pernas. Voltamos esgotados mas felizes.', autor: 'Família Almeida', foto: '', destino: 'Orlando 2025' },
      { texto: 'O Express Pass na Universal foi a melhor decisão. Fizemos as principais atrações 3 vezes. Velocicoaster é incrível! Nossa filha de 12 anos não queria ir embora.', autor: 'Roberta e Pedro', foto: '', destino: 'Orlando 2024' },
    ] }),
    s('CTA', 18, { texto_botao: 'Reservar a viagem mágica!', tipo_acao: 'WHATSAPP', numero_whatsapp: '', mensagem_predefinida: 'Olá! Quero reservar a viagem Disney Orlando para minha família!', cor_botao: '#7c3aed' }),
    s('COUNTDOWN', 19, { titulo: 'Embarque para a Disney em', data_evento: '2026-07-10T21:55:00', mensagem: 'A magia está chegando!' }),
  ],
  mensagem_abertura_padrao: 'Querida família,\n\nSeu sonho de levar as crianças (e o coração de criança dos pais) a Orlando se torna realidade neste roteiro. Cuidamos de cada detalhe — do hotel temático Disney até o Express Pass Universal — para que vocês foquem apenas em criar memórias inesquecíveis.\n\nPreparem-se: serão 10 dias de pura magia.',
  inclusos_padrao: ['Aéreo direto', 'Hotel Disney 9 noites', '4 parques Disney + Universal', 'Genie+ e Express Pass', 'Carro alugado', 'Seguro'],
  nao_inclusos_padrao: ['Refeições', 'Visto', 'Memory Maker'],
  is_padrao: true,
};
(disney as Record<string, unknown>).viagem_padrao = {
  duracao_dias: 10, duracao_noites: 9,
  destinos: [
    { id: generateId(), nome: 'Orlando', descricao: '4 parques Disney + Universal Studios', dias_inicio: 2, dias_fim: 10, alojamento_ids: [DISNEY_ALOJ[0].id] },
  ],
  alojamentos: DISNEY_ALOJ,
  transportes: DISNEY_TRANSP,
  interesses_tags: ['Família', 'Disney', 'Universal', 'Crianças', 'Compras'],
  termos_condicoes: 'Cancelamento até 60 dias antes: reembolso integral. 30-59 dias: 70%. 15-29 dias: 40%. Menos de 15 dias: sem reembolso. Visto americano de responsabilidade do cliente.',
  sobre_agencia: 'Especialistas em viagens à Disney há mais de 12 anos. Mais de 800 famílias atendidas com avaliação 4.9/5.',
};

// ═══════════════════════════════════════════════════════════════
// TEMPLATE 5: MEDITERRÂNEO ROYAL CARIBBEAN — Cruzeiro 7 noites + pré/pós
// Demonstra: layout DISCOVERY, multiplos servicos, transporte misto, alojamento + cabines
// ═══════════════════════════════════════════════════════════════
const CRUZ_ALOJ: AlojamentoData[] = [
  aloj({
    destino_nome: 'Roma (Pré-cruzeiro)', hotel_nome: 'Hotel Splendide Royal', hotel_estrelas: 5,
    hotel_imagem: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=800&q=80',
    hotel_galeria: [], hotel_descricao: 'Palácio do século XIX a 200m da Villa Borghese. Restaurante Mirabelle com estrela Michelin e terraço panorâmico sobre Roma.',
    hotel_link: '', check_in: '2026-09-05', check_out: '2026-09-07', noites: 2,
    regime: 'BB', quarto_tipo: 'Deluxe Junior Suite', bebidas: '',
    lat: 41.9098, lng: 12.4884, viagem_noturna: false,
  }),
  aloj({
    destino_nome: 'Mediterrâneo (Cruzeiro)', hotel_nome: 'Symphony of the Seas — Royal Caribbean', hotel_estrelas: 5,
    hotel_imagem: 'https://images.unsplash.com/photo-1548574505-5e239809ee19?w=800&q=80',
    hotel_galeria: [
      'https://images.unsplash.com/photo-1599058917765-a780eda07a3e?w=600&q=80',
      'https://images.unsplash.com/photo-1566375638485-0a8be9bcfb83?w=600&q=80',
    ],
    hotel_descricao: 'O 2º maior cruzeiro do mundo com 18 decks, parque aquático, robô-bartender, simulador de surfe FlowRider, escalada e show da Broadway. Cabine Balcony deck 10 — vista panorâmica direta para o mar.',
    hotel_link: 'https://www.royalcaribbean.com/symphony-of-the-seas',
    check_in: '2026-09-07', check_out: '2026-09-14', noites: 7,
    regime: 'AI', quarto_tipo: 'Cabine Balcony — Deck 10 (Cat. 4D)', bebidas: 'Pacote Deluxe Beverage incluso',
    lat: 41.5912, lng: 2.6556, viagem_noturna: true,
  }),
  aloj({
    destino_nome: 'Barcelona (Pós-cruzeiro)', hotel_nome: 'Hotel Casa Fuster', hotel_estrelas: 5,
    hotel_imagem: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=800&q=80',
    hotel_galeria: [], hotel_descricao: 'Edifício modernista de 1908 no Passeig de Gràcia. Rooftop com vista para Sagrada Família, café Vienés histórico e jazz ao vivo.',
    hotel_link: '', check_in: '2026-09-14', check_out: '2026-09-16', noites: 2,
    regime: 'BB', quarto_tipo: 'Deluxe Premium Modernist', bebidas: '',
    lat: 41.3960, lng: 2.1614, viagem_noturna: false,
  }),
];

const CRUZ_TRANSP: TransporteData[] = [
  transp({ tipo: 'VOO', data: '2026-09-04', origem: 'GRU', destino: 'FCO', companhia: 'ITA Airways', numero_voo: 'AZ675', horario_saida: '17:30', horario_chegada: '09:45', tempo_estimado: '12h15', detalhes: 'Voo direto São Paulo → Roma' }),
  transp({ tipo: 'TRANSFER', data: '2026-09-05', origem: 'Aeroporto Fiumicino', destino: 'Hotel Splendide Royal Roma', companhia: '', numero_voo: '', horario_saida: '10:30', horario_chegada: '11:30', distancia_km: 32, tempo_estimado: '1h', detalhes: 'Mercedes Classe E privativo' }),
  transp({ tipo: 'TRANSFER', data: '2026-09-07', origem: 'Hotel Roma', destino: 'Porto de Civitavecchia', companhia: '', numero_voo: '', horario_saida: '11:00', horario_chegada: '13:00', distancia_km: 80, tempo_estimado: '2h', detalhes: 'Transfer privativo ao porto de embarque' }),
  transp({ tipo: 'BARCO', data: '2026-09-07', origem: 'Civitavecchia (Roma)', destino: 'Mediterrâneo', companhia: 'Royal Caribbean', numero_voo: 'Symphony of the Seas', horario_saida: '17:00', horario_chegada: '07:00', tempo_estimado: '7 noites', detalhes: 'Embarque cruzeiro 7 noites: Civitavecchia → Nápoles → Em alto mar → Palma de Mallorca → Marselha → Em alto mar → Barcelona' }),
  transp({ tipo: 'TRANSFER', data: '2026-09-14', origem: 'Porto de Barcelona', destino: 'Hotel Casa Fuster', companhia: '', numero_voo: '', horario_saida: '08:00', horario_chegada: '08:45', distancia_km: 6, tempo_estimado: '45min', detalhes: 'Desembarque e transfer privativo' }),
  transp({ tipo: 'VOO', data: '2026-09-16', origem: 'BCN', destino: 'GRU', companhia: 'ITA Airways', numero_voo: 'AZ677', horario_saida: '14:20', horario_chegada: '23:50', tempo_estimado: '12h30', detalhes: 'VOLTA | Voo direto Barcelona → São Paulo' }),
];

const cruzeiro: Omit<TemplateProposta, 'id'> = {
  nome: 'Mediterrâneo — Cruzeiro Royal Caribbean',
  descricao: '11 dias com cruzeiro Symphony of the Seas pelo Mediterrâneo + Roma e Barcelona. 6 destinos em 1 viagem. Layout DISCOVERY com cabine Balcony, all-inclusive premium e pacote de bebidas.',
  tipo_viagem: 'CRUZEIRO',
  icone: '🚢',
  imagem_preview: 'https://images.unsplash.com/photo-1548574505-5e239809ee19?w=600&q=80',
  visual: {
    tema: 'padrao', layout: 'DISCOVERY', cor_primaria: '#0369a1', cor_secundaria: '#0a0a14', cor_texto: '#0f172a',
    cor_fundo: '#f0f9ff', fonte: 'Inter',
    imagem_capa: 'https://images.unsplash.com/photo-1548574505-5e239809ee19?w=1400&q=80',
    estilo_capa: 'FULLSCREEN',
  },
  secoes_padrao: [
    s('TEXTO', 0, {
      titulo: 'Uma viagem, seis destinos',
      corpo: 'Imagine acordar em Nápoles, almoçar em Mallorca e jantar em Marselha — sem fazer e desfazer malas. Com o Symphony of the Seas, cada porto é uma nova aventura, e o navio em si é um destino completo: parque aquático, robôs, escalada, shows da Broadway.',
      alinhamento: 'center',
    }),
    s('GALERIA', 1, { imagens: [
      'https://images.unsplash.com/photo-1548574505-5e239809ee19?w=800&q=80',
      'https://images.unsplash.com/photo-1599058917765-a780eda07a3e?w=800&q=80',
      'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=800&q=80',
      'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=800&q=80',
      'https://images.unsplash.com/photo-1518659526054-190340b32735?w=800&q=80',
      'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=800&q=80',
    ] }),
    s('VIDEO', 2, {
      titulo: 'Symphony of the Seas — tour completo do navio',
      url: 'https://www.youtube.com/watch?v=K5IIoOl6FZM',
    }),
    s('MAPA', 3, {
      titulo: 'Sua rota pelo Mediterrâneo',
      zoom: 5,
      pontos: [
        { lat: 41.9098, lng: 12.4884, label: 'Roma — Pré-cruzeiro 2 noites' },
        { lat: 42.0942, lng: 11.7958, label: 'Civitavecchia — Embarque' },
        { lat: 40.8518, lng: 14.2681, label: 'Nápoles — Pompeia & Capri' },
        { lat: 39.5696, lng: 2.6502, label: 'Palma de Mallorca' },
        { lat: 43.2965, lng: 5.3698, label: 'Marselha — Provença' },
        { lat: 41.3851, lng: 2.1734, label: 'Barcelona — Desembarque' },
        { lat: 41.3960, lng: 2.1614, label: 'Casa Fuster — Pós 2 noites' },
      ],
    }),
    s('SERVICO', 4, {
      icone: '🚢', titulo: 'Symphony of the Seas — o navio', detalhes: [
        '6.680 passageiros · 18 decks · 362m de comprimento',
        '7 piscinas · 4 slides · FlowRider (simulador de surfe)',
        'Escalada · Tirolesa · Patinação no gelo',
        '50+ restaurantes e bares (10 inclusos no pacote)',
        'Shows da Broadway: HAIRSPRAY (incluso)',
        'AquaTheater · Robô-bartender Bionic Bar',
      ],
      descricao: 'O 2º maior cruzeiro do mundo. Cada deck é uma cidade — bairro Central Park com plantas reais, Boardwalk com carrossel, Royal Promenade com lojas e desfiles.',
      imagem: 'https://images.unsplash.com/photo-1599058917765-a780eda07a3e?w=800&q=80',
      valor: 0, exibir_valor: false,
    }),
    s('SERVICO', 5, {
      icone: '🛏️', titulo: 'Cabine Balcony — Deck 10', detalhes: [
        '17m² + 5m² de varanda privativa',
        'Cama King-size (ou 2 twin)',
        'Banheiro completo com chuveiro',
        'TV interativa + minibar',
        'Cofre digital · Secador',
        'Vista mar com porta de vidro panorâmica',
      ],
      descricao: 'A categoria mais procurada — varanda privativa para tomar café da manhã com vista para o mar e curtir os pôr-do-sol em alto mar.',
      imagem: 'https://images.unsplash.com/photo-1566375638485-0a8be9bcfb83?w=800&q=80',
      valor: 0, exibir_valor: false,
    }),
    s('SERVICO', 6, {
      icone: '🍷', titulo: 'Pacote Deluxe Beverage incluso', detalhes: [
        'Bebidas alcoólicas até USD 14 (drinks, vinhos, cervejas)',
        'Refrigerantes ilimitados em todos os bares',
        'Cafés especiais e cappuccinos',
        'Sucos premium e águas',
        'Validez em todos os 18 bares do navio',
        'Sem limite diário',
      ],
      descricao: 'Sem se preocupar com a conta no fim do cruzeiro. Use livremente em qualquer bar do navio — economia média de USD 800 por pessoa em 7 noites.',
      imagem: 'https://images.unsplash.com/photo-1535970793482-07de93762dc4?w=800&q=80',
      valor: 0, exibir_valor: false,
    }),
    s('ROTEIRO_DIA', 7, { dias: [
      { numero: 1, titulo: 'Dia 1 — Voo São Paulo → Roma', descricao: 'Saída de São Paulo às 17:30 no voo direto da ITA Airways. Jantar e cinema a bordo.', imagem: '', atividades: ['Embarque GRU 17:30', 'Voo noturno 12h15'], refeicoes_inclusas: 'Refeições a bordo', lat: -23.4356, lng: -46.4731 },
      { numero: 2, titulo: 'Dia 2 — Chegada em Roma', descricao: 'Chegada em Fiumicino às 09:45. Transfer privativo ao Splendide Royal. Tarde livre — sugestão: Villa Borghese e Piazza del Popolo.', imagem: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=800&q=80', atividades: ['Transfer privativo Mercedes', 'Check-in Splendide Royal', 'Villa Borghese (a pé)', 'Jantar no terraço Mirabelle'], refeicoes_inclusas: 'Jantar', lat: 41.9098, lng: 12.4884 },
      { numero: 3, titulo: 'Dia 3 — Coliseu, Vaticano e Trastevere', descricao: 'City tour completo de Roma: Coliseu (skip the line), Fórum Romano, Vaticano com Capela Sistina, jantar em Trastevere.', imagem: 'https://images.unsplash.com/photo-1518659526054-190340b32735?w=800&q=80', atividades: ['Coliseu skip the line', 'Fórum Romano + Palatino', 'Vaticano e Capela Sistina', 'Jantar em Trastevere'], refeicoes_inclusas: 'Café e jantar', lat: 41.8902, lng: 12.4922 },
      { numero: 4, titulo: 'Dia 4 — Embarque no cruzeiro', descricao: 'Manhã livre em Roma. Transfer ao porto de Civitavecchia. Embarque no Symphony of the Seas. Jantar a bordo e show inaugural.', imagem: 'https://images.unsplash.com/photo-1548574505-5e239809ee19?w=800&q=80', atividades: ['Manhã livre Roma', 'Transfer Civitavecchia (2h)', 'Embarque 13:00', 'Saída 17:00 - Show inaugural'], refeicoes_inclusas: 'Café da manhã + All-inclusive', lat: 42.0942, lng: 11.7958 },
      { numero: 5, titulo: 'Dia 5 — Nápoles (Pompeia & Capri opcional)', descricao: 'Chegada em Nápoles às 07h. Excursão opcional Pompeia (USD 89) ou Capri (USD 199) — não inclusas. Saída do navio às 18h.', imagem: 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=800&q=80', atividades: ['Chegada Nápoles 07h', 'Excursão Pompeia (opcional)', 'Excursão Capri (opcional)', 'Pizza autêntica em Spaccanapoli'], refeicoes_inclusas: 'All-inclusive a bordo', lat: 40.8518, lng: 14.2681 },
      { numero: 6, titulo: 'Dia 6 — Em alto mar', descricao: 'Dia inteiro navegando. Aproveite todas as atrações do Symphony: FlowRider, escalada, parque aquático, show HAIRSPRAY na Broadway.', imagem: '', atividades: ['FlowRider — surfe a bordo', 'Escalada e tirolesa', 'Show Broadway: HAIRSPRAY', 'Jantar no Wonderland (especialidade)'], refeicoes_inclusas: 'All-inclusive premium' },
      { numero: 7, titulo: 'Dia 7 — Palma de Mallorca', descricao: 'Chegada em Palma às 08h. Catedral La Seu, centro histórico, banho na praia. Saída às 17h.', imagem: '', atividades: ['Catedral La Seu', 'Centro histórico', 'Praia de Palma', 'Tapas em La Lonja'], refeicoes_inclusas: 'All-inclusive', lat: 39.5696, lng: 2.6502 },
      { numero: 8, titulo: 'Dia 8 — Marselha (Provença)', descricao: 'Chegada em Marselha às 09h. Excursão opcional a Aix-en-Provence (USD 119) ou Cassis (USD 99). Vieux-Port e Notre-Dame de la Garde.', imagem: '', atividades: ['Vieux-Port', 'Notre-Dame de la Garde', 'Excursão Provença (opcional)', 'Bouillabaisse no porto'], refeicoes_inclusas: 'All-inclusive', lat: 43.2965, lng: 5.3698 },
      { numero: 9, titulo: 'Dia 9 — Em alto mar', descricao: 'Último dia de cruzeiro. Spa, brunch, show de despedida.', imagem: '', atividades: ['Spa & Wellness', 'Brunch champagne', 'Show de despedida', 'Jantar de gala'], refeicoes_inclusas: 'All-inclusive premium' },
      { numero: 10, titulo: 'Dia 10 — Desembarque em Barcelona', descricao: 'Desembarque às 07h. Transfer ao Hotel Casa Fuster. Tarde livre — Sagrada Família ao por do sol.', imagem: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=800&q=80', atividades: ['Desembarque 07h', 'Check-in Casa Fuster', 'Sagrada Família (skip the line)', 'Jantar no rooftop'], refeicoes_inclusas: 'Café da manhã + jantar', lat: 41.3960, lng: 2.1614 },
      { numero: 11, titulo: 'Dia 11 — Park Güell, Las Ramblas', descricao: 'Manhã no Park Güell e Las Ramblas. Transfer ao aeroporto. Voo de volta a São Paulo.', imagem: '', atividades: ['Park Güell', 'Las Ramblas', 'Mercado da Boqueria', 'Transfer aeroporto BCN'], refeicoes_inclusas: 'Café da manhã + a bordo', lat: 41.4145, lng: 2.1527 },
    ] }),
    s('ALOJAMENTO', 8, {
      id: generateId(),
      destino_nome: 'Mediterrâneo — Cabine no Symphony', hotel_nome: 'Symphony of the Seas — Royal Caribbean', hotel_estrelas: 5,
      hotel_imagem: 'https://images.unsplash.com/photo-1548574505-5e239809ee19?w=800&q=80',
      hotel_galeria: [
        'https://images.unsplash.com/photo-1599058917765-a780eda07a3e?w=600&q=80',
        'https://images.unsplash.com/photo-1566375638485-0a8be9bcfb83?w=600&q=80',
      ],
      hotel_descricao: 'O 2º maior cruzeiro do mundo. 18 decks com parque aquático, escalada, FlowRider, AquaTheater e show HAIRSPRAY. Cabine Balcony Deck 10 (Cat. 4D).',
      hotel_link: 'https://www.royalcaribbean.com/symphony-of-the-seas',
      check_in: '2026-09-07', check_out: '2026-09-14', noites: 7,
      regime: 'AI', quarto_tipo: 'Cabine Balcony — Deck 10 (Cat. 4D)', bebidas: 'Pacote Deluxe Beverage incluso',
      lat: 41.5912, lng: 2.6556, viagem_noturna: true,
    }),
    s('TRANSPORTE', 9, {
      id: generateId(), tipo: 'VOO', data: '2026-09-04',
      origem: 'GRU', destino: 'FCO', companhia: 'ITA Airways', numero_voo: 'AZ675',
      horario_saida: '17:30', horario_chegada: '09:45', tempo_estimado: '12h15',
      detalhes: 'Voo direto São Paulo → Roma',
    }),
    s('TRANSPORTE', 10, {
      id: generateId(), tipo: 'BARCO', data: '2026-09-07',
      origem: 'Civitavecchia (Roma)', destino: 'Barcelona', companhia: 'Royal Caribbean', numero_voo: 'Symphony of the Seas',
      horario_saida: '17:00', horario_chegada: '07:00', tempo_estimado: '7 noites',
      detalhes: 'Cruzeiro 7 noites: Roma → Nápoles → Mar → Mallorca → Marselha → Mar → Barcelona',
    }),
    s('TRANSPORTE', 11, {
      id: generateId(), tipo: 'VOO', data: '2026-09-16',
      origem: 'BCN', destino: 'GRU', companhia: 'ITA Airways', numero_voo: 'AZ677',
      horario_saida: '14:20', horario_chegada: '23:50', tempo_estimado: '12h30',
      detalhes: 'VOLTA | Voo direto Barcelona → São Paulo',
    }),
    s('INCLUSOS', 12, {
      inclusos: [
        'Passagem aérea ITA Airways GRU↔FCO/BCN (em open jaw, voos diretos)',
        'Hotel Splendide Royal Roma — 2 noites (Junior Suite, café da manhã)',
        'Cruzeiro Symphony of the Seas — 7 noites em Cabine Balcony Deck 10',
        'All-inclusive premium a bordo (refeições, drinks, shows)',
        'Pacote Deluxe Beverage incluso (bebidas até USD 14)',
        'Hotel Casa Fuster Barcelona — 2 noites (Deluxe, café da manhã)',
        'Todos os transfers privativos em Mercedes Classe E',
        'Tour guiado em Roma (Coliseu, Vaticano com skip the line)',
        'Tour em Barcelona (Sagrada Família com skip the line + Park Güell)',
        'Taxas portuárias e gorjetas a bordo',
        'Wi-Fi VOOM a bordo (1 dispositivo por pessoa)',
        'Seguro viagem com cobertura USD 200.000',
      ],
      nao_inclusos: [
        'Excursões em portos (Pompeia, Capri, Provença) — opcionais USD 89-199',
        'Refeições nos restaurantes de especialidade do navio (USD 35-65)',
        'Tratamentos de spa a bordo',
        'Compras a bordo e onshore',
        'Gorjetas para guias em terra',
        'Excesso de bagagem',
      ],
    }),
    s('VALORES', 13, {
      opcoes: [
        {
          titulo: 'Cabine Balcony Deck 10 (por pessoa, casal)',
          valor_total: 38900,
          destaque: true,
          parcelas: [
            { forma: 'À vista PIX (5% desc.)', valor_parcela: 36955, valor_total: 36955, destaque: true },
            { forma: '12x cartão s/ juros', valor_parcela: 3242, valor_total: 38900, destaque: false },
            { forma: '6x boleto', valor_parcela: 6483, valor_total: 38900, destaque: false },
          ],
        },
        {
          titulo: 'Upgrade Suite Junior (com Concierge)',
          valor_total: 54200,
          destaque: false,
          parcelas: [
            { forma: 'À vista PIX', valor_parcela: 51490, valor_total: 51490, destaque: true },
            { forma: '12x cartão s/ juros', valor_parcela: 4517, valor_total: 54200, destaque: false },
          ],
        },
        {
          titulo: 'Cabine Interna (econômica, sem janela)',
          valor_total: 28900,
          destaque: false,
          parcelas: [
            { forma: 'À vista PIX', valor_parcela: 28900, valor_total: 28900, destaque: true },
            { forma: '10x cartão s/ juros', valor_parcela: 2890, valor_total: 28900, destaque: false },
          ],
        },
      ],
      observacoes_valores: 'Valores por pessoa em ocupação dupla. Embarque set/2026. Sujeito a disponibilidade — categorias premium esgotam 6+ meses antes.',
      validade: '2026-06-30',
    }),
    s('FAQ', 14, { titulo: 'Perguntas Frequentes', perguntas: [
      { pergunta: 'Sofro de enjoo — vou passar mal no cruzeiro?', resposta: 'O Symphony tem estabilizadores avançados — você praticamente não sente o movimento. Caso seja muito sensível, levamos Dramin diariamente. As cabines no centro do navio (decks 6-10) são as mais estáveis.' },
      { pergunta: 'Preciso de visto para Itália e Espanha?', resposta: 'Brasileiros não precisam de visto Schengen para até 90 dias. ETIAS começa em maio/2026 — incluímos a taxa de €7 no pacote.' },
      { pergunta: 'É preciso ir junto às excursões em portos?', resposta: 'Não. Você pode descer livremente nos portos. Excursões oficiais Royal Caribbean garantem retorno antes do navio zarpar — recomendado para Pompeia (35km de Nápoles).' },
      { pergunta: 'Quantas malas posso levar?', resposta: 'Voo: 23kg + 8kg de mão por pessoa. Cruzeiro: ilimitado (mas o quarto é compacto — recomendamos 1 mala grande + 1 de mão por pessoa).' },
      { pergunta: 'A internet a bordo funciona bem?', resposta: 'O Wi-Fi VOOM é via satélite — funciona bem para mensagens, e-mails e redes sociais. Streaming de vídeo (Netflix) tem qualidade reduzida.' },
    ] }),
    s('DEPOIMENTO', 15, { depoimentos: [
      { texto: 'O Symphony é um mundo à parte. Não tem como se entediar — a cada hora tem uma atividade nova. A cabine balcony foi transformadora: ver os portos chegando ao amanhecer da varanda é mágico. Indico de olhos fechados.', autor: 'Carlos e Beatriz', foto: '', destino: 'Mediterrâneo 2025' },
      { texto: 'Pacote de bebidas é OBRIGATÓRIO. Tomei champagne, drinks e cafés especiais à vontade — só nesse item economizei mais de USD 600. O show da Broadway foi de cair o queixo!', autor: 'Marcela R.', foto: '', destino: 'Mediterrâneo 2024' },
    ] }),
    s('CTA', 16, { texto_botao: 'Reservar minha cabine!', tipo_acao: 'WHATSAPP', numero_whatsapp: '', mensagem_predefinida: 'Olá! Quero reservar o cruzeiro Mediterrâneo Royal Caribbean!', cor_botao: '#0369a1' }),
    s('COUNTDOWN', 17, { titulo: 'Embarque para o Mediterrâneo em', data_evento: '2026-09-04T17:30:00', mensagem: 'Sua aventura mediterrânea está chegando!' }),
  ],
  mensagem_abertura_padrao: 'Prezados,\n\nApresentamos uma das experiências mais completas do nosso portfólio: 11 dias combinando o melhor da Itália, da Espanha e do Mediterrâneo a bordo do Symphony of the Seas — um dos maiores cruzeiros do mundo.\n\nVocês vão acordar em uma cidade nova praticamente todos os dias, sem fazer e desfazer malas. É a viagem perfeita para quem quer eficiência sem abrir mão do conforto.',
  inclusos_padrao: ['Aéreo direto', 'Hotéis 5★ em Roma e Barcelona', 'Cruzeiro 7 noites Cabine Balcony', 'All-inclusive premium', 'Pacote bebidas', 'Tours guiados'],
  nao_inclusos_padrao: ['Excursões em portos', 'Spa', 'Restaurantes de especialidade'],
  is_padrao: true,
};
(cruzeiro as Record<string, unknown>).viagem_padrao = {
  duracao_dias: 11, duracao_noites: 10,
  destinos: [
    { id: generateId(), nome: 'Roma', descricao: 'Pré-cruzeiro 2 noites', dias_inicio: 2, dias_fim: 3, alojamento_ids: [CRUZ_ALOJ[0].id] },
    { id: generateId(), nome: 'Mediterrâneo', descricao: 'Cruzeiro Symphony of the Seas — 7 noites', dias_inicio: 4, dias_fim: 9, alojamento_ids: [CRUZ_ALOJ[1].id] },
    { id: generateId(), nome: 'Barcelona', descricao: 'Pós-cruzeiro 2 noites', dias_inicio: 10, dias_fim: 11, alojamento_ids: [CRUZ_ALOJ[2].id] },
  ],
  alojamentos: CRUZ_ALOJ,
  transportes: CRUZ_TRANSP,
  interesses_tags: ['Cruzeiro', 'Mediterrâneo', 'Cultura', 'Gastronomia', 'Luxo'],
  termos_condicoes: 'Cancelamento até 90 dias antes: reembolso integral menos taxas Royal Caribbean. 60-89 dias: 75%. 30-59 dias: 50%. Menos de 30 dias: sem reembolso (cobertura via seguro viagem).',
  sobre_agencia: 'Agência certificada Royal Caribbean Diamond Plus há 8 anos. Mais de 1.200 cabines vendidas com avaliação média 4.9/5.',
};

// ═══════════════════════════════════════════════════════════════
// TEMPLATE 6: JAPÃO SAKURA — Tóquio + Kyoto + Osaka com Cerejeiras
// Demonstra: layout DISCOVERY, JR Pass, ryokan tradicional, multiplos transportes
// ═══════════════════════════════════════════════════════════════
const JAPAO_ALOJ: AlojamentoData[] = [
  aloj({
    destino_nome: 'Tóquio', hotel_nome: 'Park Hotel Tokyo', hotel_estrelas: 5,
    hotel_imagem: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&q=80',
    hotel_galeria: [
      'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=600&q=80',
      'https://images.unsplash.com/photo-1542051841857-5f90071e7989?w=600&q=80',
    ],
    hotel_descricao: 'Hotel 5 estrelas no Shiodome (Shiodome Media Tower). Cada quarto é uma obra de arte pintada por artistas japoneses. Vista panorâmica para a Tokyo Tower e o Monte Fuji em dias claros.',
    hotel_link: '', check_in: '2026-04-02', check_out: '2026-04-06', noites: 4,
    regime: 'BB', quarto_tipo: 'Artist Room — Tokyo Tower View', bebidas: '',
    lat: 35.6586, lng: 139.7595, viagem_noturna: false,
  }),
  aloj({
    destino_nome: 'Kyoto', hotel_nome: 'Tawaraya Ryokan', hotel_estrelas: 5,
    hotel_imagem: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=800&q=80',
    hotel_galeria: [
      'https://images.unsplash.com/photo-1523359346063-d879354c0ea5?w=600&q=80',
    ],
    hotel_descricao: 'Ryokan tradicional fundado em 1709 — hospedagem mais antiga do Japão em operação contínua. Tatami, futon, kaiseki dinner (jantar imperial), onsen privativo no quarto.',
    hotel_link: '', check_in: '2026-04-06', check_out: '2026-04-09', noites: 3,
    regime: 'HB', quarto_tipo: 'Tatami Suite com Onsen privativo', bebidas: 'Cerimônia do chá inclusa',
    lat: 35.0117, lng: 135.7681, viagem_noturna: false,
  }),
  aloj({
    destino_nome: 'Osaka', hotel_nome: 'The St. Regis Osaka', hotel_estrelas: 5,
    hotel_imagem: 'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?w=800&q=80',
    hotel_galeria: [], hotel_descricao: 'Hotel 5 estrelas em Honmachi com mordomo 24h, restaurante La Veduta (italiano premiado) e view de cidade. Conexão direta com metrô.',
    hotel_link: '', check_in: '2026-04-09', check_out: '2026-04-11', noites: 2,
    regime: 'BB', quarto_tipo: 'Deluxe Premier', bebidas: '',
    lat: 34.6829, lng: 135.5004, viagem_noturna: false,
  }),
];

const JAPAO_TRANSP: TransporteData[] = [
  transp({ tipo: 'VOO', data: '2026-04-01', origem: 'GRU', destino: 'NRT', companhia: 'Japan Airlines', numero_voo: 'JL8500', horario_saida: '13:30', horario_chegada: '20:45', tempo_estimado: '24h15', detalhes: 'Voo via NYC (JFK) — Japan Airlines em codeshare LATAM. 1 escala' }),
  transp({ tipo: 'TREM', data: '2026-04-02', origem: 'Aeroporto Narita', destino: 'Estação Tóquio', companhia: 'Narita Express', numero_voo: 'N\'EX 17', horario_saida: '09:30', horario_chegada: '10:30', distancia_km: 67, tempo_estimado: '1h', detalhes: 'Trem expresso direto — incluso no JR Pass' }),
  transp({ tipo: 'TREM', data: '2026-04-06', origem: 'Estação Tóquio', destino: 'Estação Kyoto', companhia: 'Shinkansen Nozomi', numero_voo: 'Nozomi 219', horario_saida: '10:00', horario_chegada: '12:18', distancia_km: 513, tempo_estimado: '2h18', detalhes: 'Trem-bala 320km/h — assento reservado primeira classe (Green Car)' }),
  transp({ tipo: 'TREM', data: '2026-04-09', origem: 'Estação Kyoto', destino: 'Estação Shin-Osaka', companhia: 'Shinkansen Hikari', numero_voo: 'Hikari 506', horario_saida: '10:30', horario_chegada: '10:45', distancia_km: 39, tempo_estimado: '15min', detalhes: 'Trem-bala — incluso no JR Pass' }),
  transp({ tipo: 'TREM', data: '2026-04-11', origem: 'Estação Shin-Osaka', destino: 'Aeroporto Kansai (KIX)', companhia: 'Haruka Express', numero_voo: 'Haruka 12', horario_saida: '14:00', horario_chegada: '14:50', distancia_km: 65, tempo_estimado: '50min', detalhes: 'Expresso direto ao aeroporto — incluso no JR Pass' }),
  transp({ tipo: 'VOO', data: '2026-04-11', origem: 'KIX', destino: 'GRU', companhia: 'Japan Airlines', numero_voo: 'JL8501', horario_saida: '17:45', horario_chegada: '20:30', tempo_estimado: '23h45', detalhes: 'VOLTA | Via NYC (JFK)' }),
];

const japao: Omit<TemplateProposta, 'id'> = {
  nome: 'Japão Sakura — Tóquio, Kyoto e Osaka',
  descricao: '11 dias no Japão na temporada das cerejeiras (hanami). Tóquio moderna, Kyoto tradicional (ryokan + onsen), Osaka gastronômica. Layout DISCOVERY com JR Pass e Shinkansen.',
  tipo_viagem: 'CULTURAL',
  icone: '🌸',
  imagem_preview: 'https://images.unsplash.com/photo-1522383225653-ed111181a951?w=600&q=80',
  visual: {
    tema: 'padrao', layout: 'DISCOVERY', cor_primaria: '#db2777', cor_secundaria: '#0a0a14', cor_texto: '#1a1a2e',
    cor_fundo: '#fdf2f8', fonte: 'Inter',
    imagem_capa: 'https://images.unsplash.com/photo-1522383225653-ed111181a951?w=1400&q=80',
    estilo_capa: 'FULLSCREEN',
  },
  secoes_padrao: [
    s('TEXTO', 0, {
      titulo: 'Hanami — a magia das cerejeiras em flor',
      corpo: '<p>Por apenas 10-14 dias ao ano, o Japão se transforma em um cenário irreal: milhões de cerejeiras desabrocham simultaneamente em um espetáculo que transcende fotografia. É o <strong>hanami</strong> — a tradição milenar de contemplar a beleza efêmera da flor de sakura.</p><p>Você verá Tóquio em todo o seu contraste — neon de Shibuya pela noite, parque Ueno coberto de pétalas pela manhã. Em Kyoto, dormirá em um ryokan de 1709 com onsen privativo. Em Osaka, mergulhará na gastronomia de rua mais famosa do mundo.</p>',
      alinhamento: 'center',
    }),
    s('GALERIA', 1, { imagens: [
      'https://images.unsplash.com/photo-1522383225653-ed111181a951?w=800&q=80',
      'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=800&q=80',
      'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=800&q=80',
      'https://images.unsplash.com/photo-1542051841857-5f90071e7989?w=800&q=80',
      'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?w=800&q=80',
      'https://images.unsplash.com/photo-1535139262971-c51845709a48?w=800&q=80',
    ] }),
    s('VIDEO', 2, {
      titulo: 'Sakura — a estação mais bonita do Japão',
      url: 'https://www.youtube.com/watch?v=JcSaXbSnh0o',
    }),
    s('MAPA', 3, {
      titulo: 'Sua rota pelo Japão',
      zoom: 6,
      pontos: [
        { lat: 35.6586, lng: 139.7595, label: 'Tóquio — Park Hotel (4 noites)' },
        { lat: 35.7148, lng: 139.7967, label: 'Asakusa — Senso-ji' },
        { lat: 35.6586, lng: 139.7454, label: 'Shibuya Crossing' },
        { lat: 35.3606, lng: 138.7274, label: 'Monte Fuji' },
        { lat: 35.0117, lng: 135.7681, label: 'Kyoto — Tawaraya Ryokan' },
        { lat: 34.9671, lng: 135.7727, label: 'Fushimi Inari — 10.000 torii' },
        { lat: 35.0394, lng: 135.6720, label: 'Arashiyama — Bambuzal' },
        { lat: 34.6829, lng: 135.5004, label: 'Osaka — St. Regis (2 noites)' },
        { lat: 34.6687, lng: 135.5012, label: 'Dotonbori — gastronomia' },
      ],
    }),
    s('SERVICO', 4, {
      icone: '🚄', titulo: 'Japan Rail Pass — 7 dias ilimitado', detalhes: [
        'Viagens ilimitadas em todas as linhas JR (incluindo Shinkansen)',
        'Trem-bala Tóquio ↔ Kyoto ↔ Osaka',
        'Narita Express e Haruka Express ao aeroporto',
        'Green Car (1ª classe) — assentos reservados',
        'Linhas JR locais em todas as cidades',
        'Ferries JR (Hiroshima ↔ Miyajima opcional)',
      ],
      descricao: 'O passe que torna o Japão acessível. 7 dias de uso ilimitado com Green Car (1ª classe) — economia média de USD 800 por pessoa em comparação a tickets avulsos.',
      imagem: 'https://images.unsplash.com/photo-1535139262971-c51845709a48?w=800&q=80',
      valor: 0, exibir_valor: false,
    }),
    s('SERVICO', 5, {
      icone: '⛩️', titulo: 'Tawaraya Ryokan — experiência tradicional', detalhes: [
        'Hospedagem fundada em 1709 — mais antiga do Japão',
        'Quartos com tatami e futon (8 tatames = ~13m²)',
        'Onsen privativo no quarto (banho termal)',
        'Yukata (kimono leve) e geta (sandália) inclusos',
        'Cerimônia do chá pela tarde',
        'Kaiseki dinner — jantar imperial com 12 pratos',
      ],
      descricao: 'A experiência mais autêntica do Japão. Sem TV, sem internet exposta — apenas você, jardim zen e a tradição mais refinada do país.',
      imagem: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=800&q=80',
      valor: 0, exibir_valor: false,
    }),
    s('SERVICO', 6, {
      icone: '🍜', titulo: 'Tour gastronômico em Dotonbori', detalhes: [
        'Takoyaki (bolinhos de polvo) — Aizuya original',
        'Okonomiyaki (panqueca japonesa) em Mizuno',
        'Kushikatsu (espetinhos fritos) em Daruma',
        'Ramen tonkotsu em Ichiran (24h)',
        'Sushi no mercado Kuromon',
        'Wagyu A5 grelhado em yakiniku',
      ],
      descricao: 'Osaka é a cozinha do Japão. Tour de 4 horas com guia local pelos melhores spots de Dotonbori, com 6 paradas e degustação inclusa em todas.',
      imagem: 'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?w=800&q=80',
      valor: 0, exibir_valor: false,
    }),
    s('ROTEIRO_DIA', 7, { dias: [
      { numero: 1, titulo: 'Dia 1 — Embarque', descricao: 'Saída de São Paulo para Tóquio via Nova York. Voo longo de 24h com escala em JFK.', imagem: '', atividades: ['Check-in GRU 11h', 'Voo GRU → JFK', 'Conexão JFK', 'Voo JFK → NRT'], refeicoes_inclusas: 'Refeições a bordo', lat: -23.4356, lng: -46.4731 },
      { numero: 2, titulo: 'Dia 2 — Chegada Tóquio', descricao: 'Chegada em Narita às 20:45 (já no dia 2 — passa-se a linha de data). Narita Express ao centro de Tóquio. Check-in no Park Hotel. Descanso.', imagem: '', atividades: ['Imigração e retirada do JR Pass', 'Narita Express → Tóquio (1h)', 'Check-in Park Hotel', 'Jantar leve no hotel'], refeicoes_inclusas: 'Jantar', lat: 35.6586, lng: 139.7595 },
      { numero: 3, titulo: 'Dia 3 — Tóquio: Asakusa & Akihabara', descricao: 'Manhã no templo Senso-ji em Asakusa (cerejeiras no rio Sumida). Almoço típico. Tarde em Akihabara — anime, mangá e tecnologia.', imagem: 'https://images.unsplash.com/photo-1542051841857-5f90071e7989?w=800&q=80', atividades: ['Templo Senso-ji', 'Rio Sumida — barco hanami', 'Akihabara — Electric Town', 'Maid Café (opcional)'], refeicoes_inclusas: 'Café e almoço', lat: 35.7148, lng: 139.7967 },
      { numero: 4, titulo: 'Dia 4 — Tóquio: Shibuya & Harajuku', descricao: 'Shibuya Crossing (cruzamento mais famoso do mundo), estátua do Hachiko. Harajuku — cultura jovem. Meiji Jingu para hanami. Jantar em Ginza.', imagem: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=800&q=80', atividades: ['Shibuya Crossing', 'Estátua do Hachiko', 'Takeshita-dori (Harajuku)', 'Meiji Jingu (cerejeiras)', 'Jantar em Ginza'], refeicoes_inclusas: 'Café e jantar', lat: 35.6586, lng: 139.7454 },
      { numero: 5, titulo: 'Dia 5 — Excursão ao Monte Fuji', descricao: 'Excursão de dia inteiro ao Monte Fuji (dia opcional, mas incluso). Hakone com teleférico, lago Ashi e ryokan-onsen para banho termal. Retorno a Tóquio.', imagem: '', atividades: ['Monte Fuji 5ª estação', 'Lago Ashi (barco pirata)', 'Hakone Ropeway', 'Onsen banho termal', 'Retorno a Tóquio'], refeicoes_inclusas: 'Café e almoço', lat: 35.3606, lng: 138.7274 },
      { numero: 6, titulo: 'Dia 6 — Shinkansen para Kyoto', descricao: 'Shinkansen Nozomi de Tóquio para Kyoto (2h18 a 320km/h). Check-in no Tawaraya Ryokan — vestir yukata, cerimônia do chá. À noite, kaiseki dinner imperial.', imagem: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=800&q=80', atividades: ['Shinkansen Tóquio→Kyoto', 'Check-in Tawaraya Ryokan', 'Cerimônia do chá', 'Kaiseki dinner (12 pratos)', 'Onsen privativo'], refeicoes_inclusas: 'Café da manhã + Kaiseki', lat: 35.0117, lng: 135.7681 },
      { numero: 7, titulo: 'Dia 7 — Kyoto: Fushimi Inari & Gion', descricao: 'Manhã cedo no Fushimi Inari (10.000 torii vermelhos). Tarde no bairro de Gion — busca por gueixas e maikos. Jantar tradicional.', imagem: '', atividades: ['Fushimi Inari (10.000 torii)', 'Caminhada Inari Mountain', 'Gion — distrito das gueixas', 'Jantar em Pontocho'], refeicoes_inclusas: 'Café + jantar', lat: 34.9671, lng: 135.7727 },
      { numero: 8, titulo: 'Dia 8 — Kyoto: Arashiyama & Templos', descricao: 'Bambuzal de Arashiyama (icônico). Templo Tenryu-ji. Tarde em Kinkaku-ji (Pavilhão de Ouro). Hanami no rio Kamogawa.', imagem: '', atividades: ['Bambuzal de Arashiyama', 'Templo Tenryu-ji', 'Kinkaku-ji (Pavilhão de Ouro)', 'Ginkaku-ji (Pavilhão de Prata)', 'Hanami rio Kamogawa'], refeicoes_inclusas: 'Café + jantar', lat: 35.0394, lng: 135.6720 },
      { numero: 9, titulo: 'Dia 9 — Shinkansen para Osaka', descricao: 'Trem-bala curtíssimo (15min). Check-in no St. Regis Osaka. Tarde no Castelo de Osaka durante hanami. À noite, primeiro contato com Dotonbori.', imagem: 'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?w=800&q=80', atividades: ['Shinkansen Kyoto→Osaka', 'Check-in St. Regis Osaka', 'Castelo de Osaka (cerejeiras)', 'Dotonbori à noite'], refeicoes_inclusas: 'Café da manhã', lat: 34.6829, lng: 135.5004 },
      { numero: 10, titulo: 'Dia 10 — Osaka: Tour Gastronômico', descricao: 'Tour gastronômico em Dotonbori — 6 paradas com guia. Tarde em Shinsekai e Universal Studios Japan opcional. Despedida com sushi premium.', imagem: '', atividades: ['Tour gastronômico Dotonbori (4h)', 'Mercado Kuromon', 'Universal Studios Japan (opcional)', 'Jantar de despedida — sushi'], refeicoes_inclusas: 'Café + tour gastronômico (almoço)', lat: 34.6687, lng: 135.5012 },
      { numero: 11, titulo: 'Dia 11 — Retorno', descricao: 'Manhã livre. Haruka Express ao Kansai Airport. Voo de volta a São Paulo via NYC.', imagem: '', atividades: ['Manhã livre — compras', 'Check-out 12h', 'Haruka Express → KIX', 'Voo KIX → JFK → GRU'], refeicoes_inclusas: 'Café + a bordo', lat: 34.4347, lng: 135.2440 },
    ] }),
    s('ALOJAMENTO', 8, {
      id: generateId(),
      destino_nome: 'Tóquio', hotel_nome: 'Park Hotel Tokyo', hotel_estrelas: 5,
      hotel_imagem: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&q=80',
      hotel_galeria: ['https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=600&q=80'],
      hotel_descricao: 'Hotel 5 estrelas no Shiodome. Cada quarto é uma obra de arte pintada. Vista para Tokyo Tower e Monte Fuji.',
      hotel_link: '', check_in: '2026-04-02', check_out: '2026-04-06', noites: 4,
      regime: 'BB', quarto_tipo: 'Artist Room — Tokyo Tower View', bebidas: '',
      lat: 35.6586, lng: 139.7595, viagem_noturna: false,
    }),
    s('ALOJAMENTO', 9, {
      id: generateId(),
      destino_nome: 'Kyoto', hotel_nome: 'Tawaraya Ryokan', hotel_estrelas: 5,
      hotel_imagem: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=800&q=80',
      hotel_galeria: ['https://images.unsplash.com/photo-1523359346063-d879354c0ea5?w=600&q=80'],
      hotel_descricao: 'Ryokan tradicional fundado em 1709. Tatami, futon, kaiseki dinner imperial, onsen privativo.',
      hotel_link: '', check_in: '2026-04-06', check_out: '2026-04-09', noites: 3,
      regime: 'HB', quarto_tipo: 'Tatami Suite com Onsen privativo', bebidas: 'Cerimônia do chá inclusa',
      lat: 35.0117, lng: 135.7681, viagem_noturna: false,
    }),
    s('ALOJAMENTO', 10, {
      id: generateId(),
      destino_nome: 'Osaka', hotel_nome: 'The St. Regis Osaka', hotel_estrelas: 5,
      hotel_imagem: 'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?w=800&q=80',
      hotel_galeria: [],
      hotel_descricao: 'Hotel 5 estrelas em Honmachi com mordomo 24h, restaurante La Veduta premiado.',
      hotel_link: '', check_in: '2026-04-09', check_out: '2026-04-11', noites: 2,
      regime: 'BB', quarto_tipo: 'Deluxe Premier', bebidas: '',
      lat: 34.6829, lng: 135.5004, viagem_noturna: false,
    }),
    s('TRANSPORTE', 11, {
      id: generateId(), tipo: 'VOO', data: '2026-04-01',
      origem: 'GRU', destino: 'NRT', companhia: 'Japan Airlines', numero_voo: 'JL8500',
      horario_saida: '13:30', horario_chegada: '20:45', tempo_estimado: '24h15',
      detalhes: 'Voo via NYC (JFK) — 1 escala',
    }),
    s('TRANSPORTE', 12, {
      id: generateId(), tipo: 'TREM', data: '2026-04-06',
      origem: 'Estação Tóquio', destino: 'Estação Kyoto', companhia: 'Shinkansen Nozomi', numero_voo: 'Nozomi 219',
      horario_saida: '10:00', horario_chegada: '12:18', tempo_estimado: '2h18',
      detalhes: 'Trem-bala 320km/h — Green Car (1ª classe) com assentos reservados',
    }),
    s('TRANSPORTE', 13, {
      id: generateId(), tipo: 'VOO', data: '2026-04-11',
      origem: 'KIX', destino: 'GRU', companhia: 'Japan Airlines', numero_voo: 'JL8501',
      horario_saida: '17:45', horario_chegada: '20:30', tempo_estimado: '23h45',
      detalhes: 'VOLTA | Via NYC (JFK)',
    }),
    s('INCLUSOS', 14, {
      inclusos: [
        'Passagem aérea Japan Airlines GRU↔NRT/KIX em open jaw',
        'Hotel Park Hotel Tokyo — 4 noites (Artist Room com vista)',
        'Tawaraya Ryokan Kyoto — 3 noites (Tatami Suite com onsen privativo)',
        'Kaiseki dinner imperial no ryokan (12 pratos)',
        'St. Regis Osaka — 2 noites (Deluxe Premier)',
        'Japan Rail Pass 7 dias — Green Car (1ª classe)',
        'Shinkansen Tóquio↔Kyoto↔Osaka',
        'Excursão de dia inteiro ao Monte Fuji e Hakone',
        'Tour gastronômico em Dotonbori (4h, 6 paradas)',
        'Cerimônia do chá em Kyoto',
        'Wi-Fi pocket (1 dispositivo) por toda a viagem',
        'Seguro viagem com cobertura USD 150.000',
        'Manual de bolso com frases em japonês',
      ],
      nao_inclusos: [
        'Refeições não mencionadas (média USD 35-50/dia)',
        'Universal Studios Japan (opcional ¥9.800)',
        'Maid Café em Akihabara',
        'Shopping pessoal',
        'Taxa de banho termal em onsens públicos (¥800)',
        'Excesso de bagagem',
      ],
    }),
    s('VALORES', 15, {
      opcoes: [
        {
          titulo: 'Pacote Completo (por pessoa, apto duplo)',
          valor_total: 36500,
          destaque: true,
          parcelas: [
            { forma: 'À vista PIX (5% desc.)', valor_parcela: 34675, valor_total: 34675, destaque: true },
            { forma: '12x cartão s/ juros', valor_parcela: 3042, valor_total: 36500, destaque: false },
            { forma: '6x boleto', valor_parcela: 6083, valor_total: 36500, destaque: false },
          ],
        },
        {
          titulo: 'Single (quarto individual)',
          valor_total: 49800,
          destaque: false,
          parcelas: [
            { forma: 'À vista PIX', valor_parcela: 49800, valor_total: 49800, destaque: true },
            { forma: '12x cartão s/ juros', valor_parcela: 4150, valor_total: 49800, destaque: false },
          ],
        },
      ],
      observacoes_valores: 'Valores válidos para hanami 2026 (alta temporada). Sakura é fenômeno natural — datas exatas confirmadas 30 dias antes. Reserva mínima de 90 dias antes.',
      validade: '2026-02-15',
    }),
    s('FAQ', 16, { titulo: 'Perguntas Frequentes', perguntas: [
      { pergunta: 'Quando é o pico das cerejeiras?', resposta: 'Em Tóquio: tipicamente 25 mar - 5 abr. Em Kyoto: 28 mar - 8 abr. Como é fenômeno natural, varia ano a ano. Nosso roteiro de 02-11/abr captura o pico nas três cidades em 90% dos anos.' },
      { pergunta: 'Brasileiros precisam de visto?', resposta: 'Sim. Visto de turista válido para 90 dias — entrevista no consulado SP/RJ. Demoramos 5-7 dias úteis. Custo ¥3.000 incluso no pacote (taxa).' },
      { pergunta: 'Como funciona dormir em ryokan?', resposta: 'Você dorme em futon sobre tatami. O quarto é vazio durante o dia (mesa baixa para o chá), e a equipe arruma o futon antes do jantar. Yukata (kimono leve) é fornecido — usa-se até para o jantar.' },
      { pergunta: 'É difícil se virar sem falar japonês?', resposta: 'Tóquio e Osaka têm bom inglês em hotéis e principais turísticos. Em Kyoto e ryokans, oferecemos manual de frases em japonês + nosso guia digital fica disponível 24h via WhatsApp.' },
      { pergunta: 'Tatuagens são problema em onsens?', resposta: 'Sim, em onsens públicos. Mas no Tawaraya Ryokan o onsen é PRIVATIVO no quarto — sem restrições. Em Hakone usamos onsen com aceitação de tatuagens.' },
      { pergunta: 'Posso usar real ou cartão de crédito?', resposta: 'O Japão ainda usa muito dinheiro físico. Recomendamos levar yen em espécie (¥80.000 por pessoa). Cartões internacionais funcionam em hotéis e lojas grandes mas não em pequenos restaurantes.' },
    ] }),
    s('DEPOIMENTO', 17, { depoimentos: [
      { texto: 'O Tawaraya foi a experiência mais surreal da minha vida. Dormir sobre tatami, jantar 12 pratos servidos um a um por mulheres em quimono, ter onsen privativo... isso não é hotelaria, é arte. Vale CADA centavo.', autor: 'Patrícia M.', foto: '', destino: 'Japão Sakura 2025' },
      { texto: 'Fomos no exato pico das cerejeiras em Kyoto. O Fushimi Inari ao amanhecer, com pétalas caindo nos torii, é uma imagem que vai ficar gravada para sempre. Roteiro impecável, o JR Pass facilita demais.', autor: 'Ricardo e Marina', foto: '', destino: 'Japão Sakura 2024' },
    ] }),
    s('CTA', 18, { texto_botao: 'Reservar Sakura 2026!', tipo_acao: 'WHATSAPP', numero_whatsapp: '', mensagem_predefinida: 'Olá! Quero reservar a viagem Japão Sakura 2026!', cor_botao: '#db2777' }),
    s('COUNTDOWN', 19, { titulo: 'Embarque para o Japão em', data_evento: '2026-04-01T13:30:00', mensagem: 'A floração das cerejeiras está chegando!' }),
  ],
  mensagem_abertura_padrao: 'Prezados,\n\nViajar ao Japão durante o hanami é como pisar dentro de uma pintura. Por 10-14 dias ao ano, milhões de cerejeiras desabrocham simultaneamente — e quem está lá testemunha um espetáculo natural inesquecível.\n\nDesenhamos cada detalhe: do hotel-galeria em Tóquio ao ryokan de 1709 em Kyoto, da culinária de Osaka ao Shinkansen de 320km/h. Vocês vão atravessar o Japão moderno e o tradicional em sua estação mais bonita.',
  inclusos_padrao: ['Aéreo', 'Hotel 5★ Tóquio', 'Ryokan Kyoto + Kaiseki', 'St. Regis Osaka', 'JR Pass 7 dias', 'Excursões e tours'],
  nao_inclusos_padrao: ['Refeições não mencionadas', 'Universal Japan', 'Compras pessoais'],
  is_padrao: true,
};
(japao as Record<string, unknown>).viagem_padrao = {
  duracao_dias: 11, duracao_noites: 9,
  destinos: [
    { id: generateId(), nome: 'Tóquio', descricao: 'Capital moderna — Shibuya, Asakusa, Shinjuku', dias_inicio: 2, dias_fim: 5, alojamento_ids: [JAPAO_ALOJ[0].id] },
    { id: generateId(), nome: 'Kyoto', descricao: 'Capital tradicional — Templos, gueixas, ryokan', dias_inicio: 6, dias_fim: 8, alojamento_ids: [JAPAO_ALOJ[1].id] },
    { id: generateId(), nome: 'Osaka', descricao: 'Capital gastronômica — Dotonbori', dias_inicio: 9, dias_fim: 11, alojamento_ids: [JAPAO_ALOJ[2].id] },
  ],
  alojamentos: JAPAO_ALOJ,
  transportes: JAPAO_TRANSP,
  interesses_tags: ['Cultural', 'Gastronomia', 'Tradição', 'Hanami', 'Fotografia'],
  termos_condicoes: 'Reserva mínima de 90 dias antes. Cancelamento até 60 dias: 80% reembolso. 30-59 dias: 50%. Menos de 30 dias: sem reembolso (sakura é alta demanda). Visto japonês de responsabilidade do cliente.',
  sobre_agencia: 'Especialistas em Japão há 9 anos. Parceria oficial com Tawaraya Ryokan e JR East. Mais de 600 viajantes atendidos.',
};

// ═══════════════════════════════════════════════════════════════
// ALL TEMPLATES
// ═══════════════════════════════════════════════════════════════
const TEMPLATES: Omit<TemplateProposta, 'id'>[] = [
  terraSanta,
  maldivas,
  patagonia,
  disney,
  cruzeiro,
  japao,
];

export async function POST() {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB not initialized' }, { status: 500 });

    const tenantId = await getTenantId();
    // Delete all seed templates (is_padrao = true in JSONB data)
    await pool.query(`DELETE FROM templates_proposta WHERE (data->>'is_padrao')::boolean = true AND tenant_id = $1`, [tenantId]);
    // Also delete old templates by known names (before is_padrao was used)
    await pool.query(`DELETE FROM templates_proposta WHERE LOWER(nome) IN ($1, $2, $3, $4, $5, $6) AND tenant_id = $7`, [
      'europa romantica', 'aventura & natureza', 'disney em familia', 'cruzeiro maritimo', 'viagem corporativa', 'praia & relax', tenantId,
    ]);

    let count = 0;
    for (const tmpl of TEMPLATES) {
      const id = generateId();
      const data = { ...tmpl, id };
      await pool.query(
        `INSERT INTO templates_proposta (id, tenant_id, nome, data) VALUES ($1, $2, $3, $4)`,
        [id, tenantId, tmpl.nome, JSON.stringify(data)]
      );
      count++;
    }

    return NextResponse.json({ message: `${count} templates criados (antigos removidos)`, total: TEMPLATES.length });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

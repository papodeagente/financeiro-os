import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId } from '@/lib/utils';
import type { TemplateProposta, SecaoProposta, AlojamentoData, TransporteData } from '@/lib/crm-types';

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
  descricao: 'Roteiro completo por Israel: Jerusalem, Mar Morto e Tel Aviv. 8 dias com guia, hoteis 5 estrelas e experiencias unicas. Modelo DISCOVERY com todos os recursos.',
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
    // ROTEIRO DIA A DIA
    s('ROTEIRO_DIA', 2, { dias: [
      { numero: 1, titulo: 'Dia 1 — Embarque no Brasil', descricao: 'Saida de Sao Paulo (GRU) no voo LATAM LA8084 com destino a Tel Aviv. Voo noturno direto — jantar e cafe da manha servidos a bordo.', imagem: '', atividades: ['Check-in no aeroporto de Guarulhos', 'Embarque as 23:55'], refeicoes_inclusas: 'Jantar e cafe a bordo', lat: -23.4356, lng: -46.4731 },
      { numero: 2, titulo: 'Dia 2 — Chegada em Israel e Jerusalem', descricao: 'Chegada ao Aeroporto Ben Gurion as 18:30. Recepcao com guia em portugues e transfer privativo ate Jerusalem. Check-in no David Citadel Hotel com vista para as muralhas.', imagem: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&q=80', atividades: ['Transfer aeroporto → Jerusalem (1h15)', 'Check-in David Citadel Hotel 5★', 'Jantar de boas-vindas no rooftop'], refeicoes_inclusas: 'Jantar', lat: 31.7767, lng: 35.2245 },
      { numero: 3, titulo: 'Dia 3 — Cidade Velha de Jerusalem', descricao: 'Dia inteiro explorando a Cidade Velha: Via Dolorosa, Santo Sepulcro, Muro das Lamentacoes, Monte do Templo. Almoco em restaurante tipico no bairro armenio.', imagem: 'https://images.unsplash.com/photo-1580502304784-8985b7eb7260?w=800&q=80', atividades: ['Via Dolorosa — 14 estacoes', 'Basilica do Santo Sepulcro', 'Muro das Lamentacoes', 'Monte do Templo / Esplanada das Mesquitas', 'Almoco tipico no bairro armenio'], refeicoes_inclusas: 'Cafe da manha e almoco', lat: 31.7784, lng: 35.2296 },
      { numero: 4, titulo: 'Dia 4 — Monte das Oliveiras e Belem', descricao: 'Manha no Monte das Oliveiras com vista panoramica. Tarde em Belem: Igreja da Natividade e Gruta do Leite. Retorno a Jerusalem para jantar livre.', imagem: '', atividades: ['Monte das Oliveiras — panoramica', 'Jardim de Getsemani', 'Igreja de Todas as Nacoes', 'Belem — Igreja da Natividade', 'Praca da Manjedoura'], refeicoes_inclusas: 'Cafe da manha', lat: 31.7782, lng: 35.2428 },
      { numero: 5, titulo: 'Dia 5 — Massada e Mar Morto', descricao: 'Saida cedo para Massada — subida de teleferico e visita a fortaleza de Herodes. Descida ao Mar Morto para a experiencia de flutuacao. Check-in no Isrotel Dead Sea Resort.', imagem: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&q=80', atividades: ['Fortaleza de Massada (teleferico)', 'Flutuacao no Mar Morto', 'Spa com lama terapeutica', 'Check-in Isrotel Dead Sea Resort 5★'], refeicoes_inclusas: 'Cafe da manha e jantar', lat: 31.3156, lng: 35.3536 },
      { numero: 6, titulo: 'Dia 6 — Transfer para Tel Aviv', descricao: 'Manha livre no resort com spa. Apos o almoco, transfer panoramico ate Tel Aviv passando pelo deserto do Negev. Check-in no The Norman Hotel.', imagem: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80', atividades: ['Manha livre — spa e praia privativa', 'Transfer Mar Morto → Tel Aviv (2h)', 'Check-in The Norman Hotel 5★', 'Passeio pelo bairro de Neve Tzedek'], refeicoes_inclusas: 'Cafe da manha', lat: 32.0741, lng: 34.7764 },
      { numero: 7, titulo: 'Dia 7 — Tel Aviv e Jaffa', descricao: 'City tour por Tel Aviv: White City (Bauhaus), mercado Carmel, praia de Gordon. Tarde na antiga Jaffa com suas galerias de arte. Jantar de despedida em restaurante a beira-mar.', imagem: '', atividades: ['White City — arquitetura Bauhaus (UNESCO)', 'Mercado Carmel', 'Praia de Gordon Beach', 'Old Jaffa — galerias e porto historico', 'Jantar de despedida a beira-mar'], refeicoes_inclusas: 'Cafe da manha e jantar', lat: 32.0536, lng: 34.7521 },
      { numero: 8, titulo: 'Dia 8 — Retorno ao Brasil', descricao: 'Dia livre para compras e ultimos passeios. Transfer ao Aeroporto Ben Gurion. Voo LATAM LA8085 de volta a Sao Paulo, chegando as 09:15.', imagem: '', atividades: ['Manha livre para compras', 'Transfer hotel → aeroporto', 'Voo TLV → GRU (14h45)'], refeicoes_inclusas: 'Cafe da manha', lat: 32.0055, lng: 34.8854 },
    ] }),
    // INCLUSOS
    s('INCLUSOS', 3, {
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
    s('VALORES', 4, {
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
    s('FAQ', 5, { titulo: 'Perguntas Frequentes', perguntas: [
      { pergunta: 'Preciso de visto para Israel?', resposta: 'Brasileiros nao precisam de visto para estadias de ate 90 dias. Basta passaporte valido com pelo menos 6 meses de validade.' },
      { pergunta: 'Qual a moeda local?', resposta: 'O Shekel (ILS). Cartoes de credito internacionais sao aceitos na maioria dos estabelecimentos. Recomendamos levar dolares para trocar.' },
      { pergunta: 'E seguro viajar para Israel?', resposta: 'Sim. As areas turisticas sao extremamente seguras e bem policiadas. Nosso guia acompanha o grupo o tempo todo.' },
      { pergunta: 'Qual a melhor epoca para ir?', resposta: 'Junho e ideal: clima seco, temperaturas agradaveis (25-30°C) e pouca chuva. Perfeito para passeios ao ar livre.' },
    ] }),
    // DEPOIMENTO
    s('DEPOIMENTO', 6, { depoimentos: [
      { texto: 'A viagem a Terra Santa mudou minha vida. Cada lugar que visitamos tem um significado profundo. O David Citadel e espetacular — acordar vendo as muralhas de Jerusalem nao tem preco.', autor: 'Maria e Joao S.', foto: '', destino: 'Israel 2025' },
      { texto: 'Organização impecavel do inicio ao fim. O guia sabia tudo sobre a historia, a comida era incrivel e flutuar no Mar Morto foi a experiencia mais surreal da minha vida!', autor: 'Carlos M.', foto: '', destino: 'Israel 2024' },
    ] }),
    // CTA
    s('CTA', 7, { texto_botao: 'Quero conhecer a Terra Santa!', tipo_acao: 'WHATSAPP', numero_whatsapp: '', mensagem_predefinida: 'Ola! Vi a proposta Terra Santa e quero reservar minha viagem a Israel.', cor_botao: '#1e40af' }),
    // COUNTDOWN
    s('COUNTDOWN', 8, { titulo: 'Embarque em', data_evento: '2026-06-09T23:55:00', mensagem: 'Faltam poucos dias para a viagem dos sonhos!' }),
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
// ALL TEMPLATES
// ═══════════════════════════════════════════════════════════════
const TEMPLATES: Omit<TemplateProposta, 'id'>[] = [
  terraSanta,
  maldivas,
  patagonia,
];

export async function POST() {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB not initialized' }, { status: 500 });

    // Delete old seed templates
    await pool.query(`DELETE FROM templates_proposta WHERE LOWER(nome) IN ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      'europa romantica', 'aventura & natureza', 'disney em familia', 'cruzeiro maritimo', 'viagem corporativa', 'praia & relax',
      'terra santa — israel completo', 'maldivas — lua de mel', 'patagonia — aventura glaciar',
    ]);

    let count = 0;
    for (const tmpl of TEMPLATES) {
      const id = generateId();
      const data = { ...tmpl, id };
      await pool.query(
        `INSERT INTO templates_proposta (id, nome, data) VALUES ($1, $2, $3)`,
        [id, tmpl.nome, JSON.stringify(data)]
      );
      count++;
    }

    return NextResponse.json({ message: `${count} templates criados (antigos removidos)`, total: TEMPLATES.length });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

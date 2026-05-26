export interface AIPropostaContext {
  destino?: string;
  hotel?: string;
  periodo?: string;
  cliente_nome?: string;
  tipo_viagem?: string;
  num_dias?: number;
  destino_descricao?: string;
  destino_dicas?: string;
  destino_gastronomia?: string;
  // Origem do voo (default Brasil) — Claude usa pra montar segmentos ida/volta
  origem_voo?: string;
}

function ctx(c: AIPropostaContext): string {
  const parts: string[] = [];
  if (c.destino) parts.push(`Destino: ${c.destino}`);
  if (c.hotel) parts.push(`Hotel: ${c.hotel}`);
  if (c.periodo) parts.push(`Periodo: ${c.periodo}`);
  if (c.cliente_nome) parts.push(`Cliente: ${c.cliente_nome}`);
  if (c.tipo_viagem) parts.push(`Tipo: ${c.tipo_viagem}`);
  if (c.num_dias) parts.push(`Duracao: ${c.num_dias} dias`);
  if (c.origem_voo) parts.push(`Origem do voo: ${c.origem_voo}`);
  if (c.destino_descricao) parts.push(`Sobre o destino: ${c.destino_descricao}`);
  if (c.destino_dicas) parts.push(`Dicas: ${c.destino_dicas}`);
  if (c.destino_gastronomia) parts.push(`Gastronomia: ${c.destino_gastronomia}`);
  return parts.join('\n');
}

export function getPromptForBlock(tipo: string, context: AIPropostaContext): string {
  const base = `Voce e um redator de propostas de viagem para uma agencia brasileira de alto padrao. Use tom comercial, inspirador e caloroso. Escreva em portugues brasileiro.

Contexto da viagem:
${ctx(context)}

`;

  switch (tipo) {
    case 'TEXTO':
      return base + `Gere um bloco de texto para a proposta de viagem. Deve ter um titulo atrativo e um corpo de 2-3 paragrafos que faca o cliente sonhar com o destino.

Responda APENAS com JSON valido (sem markdown):
{"titulo": "...", "corpo": "...", "alinhamento": "left"}`;

    case 'ROTEIRO_DIA':
      return base + `Gere um roteiro dia-a-dia para ${context.num_dias || 5} dias de viagem. Cada dia deve ter um titulo criativo e descricao detalhada com atividades, restaurantes e dicas.

Responda APENAS com JSON valido (sem markdown):
{"dias": [{"numero": 1, "titulo": "Dia 1 — Titulo criativo", "descricao": "Descricao detalhada do dia...", "atividades": ["atividade 1", "atividade 2"], "refeicoes_inclusas": "Cafe da manha"}]}`;

    case 'INCLUSOS':
      return base + `Gere uma lista do que esta incluso e nao incluso nesta viagem. Inclua 8-12 itens inclusos e 5-8 nao inclusos, tipicos para este tipo de viagem.

Responda APENAS com JSON valido (sem markdown):
{"inclusos": ["item 1", "item 2"], "nao_inclusos": ["item 1", "item 2"]}`;

    case 'SERVICO':
      return base + `Gere a descricao de um servico de viagem (pode ser voo, hotel, transfer, passeio, etc). Use emojis no icone.

Responda APENAS com JSON valido (sem markdown):
{"icone": "emoji", "titulo": "...", "descricao": "...", "detalhes": ["detalhe 1", "detalhe 2"], "imagem": "", "valor": 0, "exibir_valor": false}`;

    case 'DEPOIMENTO':
      return base + `Gere 2-3 depoimentos ficticios mas realistas de clientes que fizeram viagem similar. Use nomes brasileiros.

Responda APENAS com JSON valido (sem markdown):
{"depoimentos": [{"texto": "...", "autor": "Nome Sobrenome", "foto": "", "destino": "Destino da viagem"}]}`;

    case 'CTA':
      return base + `Gere o texto de um botao CTA (call-to-action) convincente para fechar a venda desta viagem.

Responda APENAS com JSON valido (sem markdown):
{"texto_botao": "...", "tipo_acao": "WHATSAPP", "numero_whatsapp": "", "mensagem_predefinida": "Ola! Gostaria de saber mais sobre a proposta de viagem para ${context.destino || 'o destino'}.", "cor_botao": "#004aad"}`;

    default:
      return base + `Gere conteudo relevante para um bloco do tipo "${tipo}" numa proposta de viagem.

Responda APENAS com JSON valido (sem markdown).`;
  }
}

// ============================================================
// Proposta COMPLETA — gera todos os blocos típicos de uma proposta
// real de viagem: galeria do destino, intro, hotel sugerido, voo
// ida/volta, roteiro detalhado, inclusos, valores, FAQ, depoimentos,
// CTA. Imagens vêm como `image_query` (palavras-chave) — o backend
// enriquece com URLs do Unsplash depois.
// ============================================================
export function getPromptForFullProposal(context: AIPropostaContext): string {
  const dias = context.num_dias || 5;
  const noites = Math.max(1, dias - 1);
  const destino = context.destino || 'destino';
  const origemVoo = context.origem_voo || 'São Paulo (GRU)';

  return `Voce e um especialista em propostas de viagem para uma agencia brasileira de alto padrao. Tom comercial, inspirador, caloroso. Portugues brasileiro.

Contexto:
${ctx(context)}

Gere uma proposta COMPLETA de viagem com TODOS os blocos abaixo, na ordem.

INSTRUCOES IMPORTANTES SOBRE IMAGENS:
- NUNCA invente URLs de imagens. Em vez disso, use o campo "image_query" com 2-4 palavras-chave em INGLES (ex.: "Paris Eiffel Tower sunset") que o backend usará pra buscar a foto.
- Para hotel.hotel_galeria, use ["query1", "query2", "query3"] (3-5 queries diferentes do hotel/cidade).
- Para depoimento.foto, deixe vazio (backend coloca avatar generico).

INSTRUCOES SOBRE DADOS REALISTAS:
- HOTEL: invente nome plausivel de hotel real ou estilo realista para o destino (4-5 estrelas, com nome composto), com descricao rica, amenities, proximidades.
- VOO: gere 2 blocos VOO separados — um IDA e um VOLTA, com segmentos realistas (companhia conhecida tipo LATAM/GOL/Azul/Air France/American/etc, numeros de voo plausiveis, horarios coerentes, aeroportos reais).
- VALORES: 2-3 opcoes (Standard/Premium/Luxo) com valor_total realista pro destino e duracao. valor_pessoa = valor_total / 2.
- DEPOIMENTOS: 3 depoimentos com nomes brasileiros plausiveis, todos sobre o mesmo destino.
- FAQ: 5-7 perguntas frequentes sobre essa viagem (documentos, clima, dinheiro, idioma, vacinas, etc).
- ROTEIRO: ${dias} dias completos com atividades reais do destino, restaurantes reais, dicas locais.

Responda APENAS com JSON valido (sem markdown), formato EXATO:
{
  "cabecalho": {
    "titulo": "Proposta de Viagem para ${destino}",
    "subtitulo": "Subtitulo personalizado${context.cliente_nome ? ` para ${context.cliente_nome}` : ''}",
    "mensagem_abertura": "Mensagem de abertura calorosa em 1-2 paragrafos."
  },
  "secoes": [
    {
      "tipo": "GALERIA",
      "conteudo": {
        "titulo": "Conheça ${destino}",
        "image_queries": ["${destino} skyline", "${destino} street", "${destino} food", "${destino} landmark"]
      }
    },
    {
      "tipo": "TEXTO",
      "conteudo": {
        "titulo": "Sobre essa viagem",
        "corpo": "2-3 paragrafos inspiradores sobre o que torna ${destino} especial e o que essa viagem oferece.",
        "alinhamento": "left"
      }
    },
    {
      "tipo": "VOO",
      "conteudo": {
        "id": "voo-ida",
        "data": "2026-08-10",
        "origem": "GRU",
        "destino": "<codigo IATA do destino>",
        "companhia": "<companhia plausivel>",
        "numero_voo": "<numero plausivel>",
        "horario_saida": "22:00",
        "horario_chegada": "12:30",
        "aeroporto_origem_nome": "${origemVoo}",
        "aeroporto_destino_nome": "<nome real do aeroporto>",
        "escalas": 0,
        "classe": "Econômica",
        "bagagem": "1 mala 23kg incluída",
        "voo_etapa": "IDA"
      }
    },
    {
      "tipo": "VOO",
      "conteudo": {
        "id": "voo-volta",
        "data": "2026-08-${10 + dias}",
        "origem": "<codigo IATA do destino>",
        "destino": "GRU",
        "companhia": "<mesma da ida>",
        "numero_voo": "<numero plausivel>",
        "horario_saida": "14:00",
        "horario_chegada": "23:30",
        "aeroporto_origem_nome": "<nome real do aeroporto>",
        "aeroporto_destino_nome": "${origemVoo}",
        "escalas": 0,
        "classe": "Econômica",
        "bagagem": "1 mala 23kg incluída",
        "voo_etapa": "VOLTA"
      }
    },
    {
      "tipo": "ALOJAMENTO",
      "conteudo": {
        "id": "hotel-1",
        "destino_nome": "${destino}",
        "hotel_nome": "<nome plausivel 4-5 estrelas>",
        "hotel_estrelas": 4,
        "hotel_descricao": "Descricao rica 2-3 paragrafos sobre o hotel, localização, estilo, diferenciais.",
        "check_in": "2026-08-11",
        "check_out": "2026-08-${10 + dias}",
        "noites": ${noites},
        "regime": "BB",
        "quarto_tipo": "Superior King",
        "rating": 4.5,
        "amenities": ["Wi-Fi grátis", "Café da manhã", "Piscina", "Academia", "Restaurante"],
        "proximidades": [
          {"nome": "<ponto de interesse>", "transports": [{"tipo": "walk", "duracao": "5 min"}]},
          {"nome": "<outro ponto>", "transports": [{"tipo": "subway", "duracao": "10 min"}]}
        ],
        "image_query": "${destino} luxury hotel room",
        "gallery_queries": ["${destino} hotel exterior", "${destino} hotel lobby", "${destino} hotel pool", "${destino} hotel restaurant"]
      }
    },
    {
      "tipo": "ROTEIRO_DIA",
      "conteudo": {
        "dias": [
          {"numero": 1, "titulo": "Dia 1 — titulo criativo", "descricao": "Atividades detalhadas com restaurantes e dicas.", "atividades": ["...", "..."], "refeicoes_inclusas": "Café da manhã"}
        ]
      }
    },
    {
      "tipo": "INCLUSOS",
      "conteudo": {
        "inclusos": ["10-12 itens inclusos coerentes com a viagem"],
        "nao_inclusos": ["5-8 itens não inclusos"]
      }
    },
    {
      "tipo": "VALORES",
      "conteudo": {
        "opcoes": [
          {"titulo": "Standard", "descricao": "Hotel 4 estrelas, voos econômicos.", "valor_total": 0, "destaque": false, "parcelas": [{"forma": "À vista PIX", "valor_parcela": 0, "valor_total": 0, "destaque": true}, {"forma": "10x cartão", "valor_parcela": 0, "valor_total": 0, "destaque": false}]},
          {"titulo": "Premium", "descricao": "Hotel 5 estrelas, voos econômicos premium, transfers privativos.", "valor_total": 0, "destaque": true, "parcelas": [{"forma": "À vista PIX", "valor_parcela": 0, "valor_total": 0, "destaque": true}, {"forma": "10x cartão", "valor_parcela": 0, "valor_total": 0, "destaque": false}]},
          {"titulo": "Luxo", "descricao": "Hotel 5 estrelas suíte, voos executiva, transfers VIP, passeios privativos.", "valor_total": 0, "destaque": false, "parcelas": [{"forma": "À vista PIX", "valor_parcela": 0, "valor_total": 0, "destaque": true}, {"forma": "10x cartão", "valor_parcela": 0, "valor_total": 0, "destaque": false}]}
        ],
        "observacoes_valores": "Valores por pessoa em apartamento duplo. Sujeitos a confirmação e disponibilidade.",
        "validade": ""
      }
    },
    {
      "tipo": "DEPOIMENTO",
      "conteudo": {
        "depoimentos": [
          {"texto": "...", "autor": "Nome Sobrenome", "foto": "", "destino": "${destino}"},
          {"texto": "...", "autor": "Nome Sobrenome", "foto": "", "destino": "${destino}"},
          {"texto": "...", "autor": "Nome Sobrenome", "foto": "", "destino": "${destino}"}
        ]
      }
    },
    {
      "tipo": "FAQ",
      "conteudo": {
        "titulo": "Perguntas frequentes",
        "perguntas": [
          {"pergunta": "Pergunta 1?", "resposta": "Resposta detalhada."},
          {"pergunta": "Pergunta 2?", "resposta": "Resposta detalhada."}
        ]
      }
    },
    {
      "tipo": "CTA",
      "conteudo": {
        "texto_botao": "Quero essa viagem",
        "tipo_acao": "WHATSAPP",
        "numero_whatsapp": "",
        "mensagem_predefinida": "Olá! Gostaria de saber mais sobre a proposta para ${destino}.",
        "cor_botao": "#004aad"
      }
    }
  ]
}

GERE TODOS OS BLOCOS COMPLETOS — não omita nenhum nem deixe placeholders. Roteiro deve ter os ${dias} dias completos. Valores devem ser realistas para o destino e duração. FAQ com 5-7 perguntas reais.`;
}

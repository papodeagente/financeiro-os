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
}

function ctx(c: AIPropostaContext): string {
  const parts: string[] = [];
  if (c.destino) parts.push(`Destino: ${c.destino}`);
  if (c.hotel) parts.push(`Hotel: ${c.hotel}`);
  if (c.periodo) parts.push(`Periodo: ${c.periodo}`);
  if (c.cliente_nome) parts.push(`Cliente: ${c.cliente_nome}`);
  if (c.tipo_viagem) parts.push(`Tipo: ${c.tipo_viagem}`);
  if (c.num_dias) parts.push(`Duracao: ${c.num_dias} dias`);
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
{"texto_botao": "...", "tipo_acao": "WHATSAPP", "numero_whatsapp": "", "mensagem_predefinida": "Ola! Gostaria de saber mais sobre a proposta de viagem para ${context.destino || 'o destino'}.", "cor_botao": "#10b981"}`;

    default:
      return base + `Gere conteudo relevante para um bloco do tipo "${tipo}" numa proposta de viagem.

Responda APENAS com JSON valido (sem markdown).`;
  }
}

export function getPromptForFullProposal(context: AIPropostaContext): string {
  return `Voce e um redator de propostas de viagem para uma agencia brasileira de alto padrao. Use tom comercial, inspirador e caloroso. Escreva em portugues brasileiro.

Contexto da viagem:
${ctx(context)}

Gere uma proposta COMPLETA de viagem com os seguintes blocos, nesta ordem:
1. TEXTO — Introducao inspiradora sobre o destino
2. ROTEIRO_DIA — Roteiro dia-a-dia para ${context.num_dias || 5} dias
3. INCLUSOS — O que esta e nao esta incluso
4. CTA — Botao de call-to-action

Responda APENAS com JSON valido (sem markdown), no formato:
{
  "cabecalho": {
    "titulo": "Titulo da proposta",
    "subtitulo": "Subtitulo personalizado${context.cliente_nome ? ` para ${context.cliente_nome}` : ''}",
    "mensagem_abertura": "Mensagem de abertura calorosa..."
  },
  "secoes": [
    {"tipo": "TEXTO", "conteudo": {"titulo": "...", "corpo": "...", "alinhamento": "left"}},
    {"tipo": "ROTEIRO_DIA", "conteudo": {"dias": [{"numero": 1, "titulo": "...", "descricao": "...", "atividades": [], "refeicoes_inclusas": ""}]}},
    {"tipo": "INCLUSOS", "conteudo": {"inclusos": ["..."], "nao_inclusos": ["..."]}},
    {"tipo": "CTA", "conteudo": {"texto_botao": "...", "tipo_acao": "WHATSAPP", "numero_whatsapp": "", "mensagem_predefinida": "...", "cor_botao": "#10b981"}}
  ]
}`;
}

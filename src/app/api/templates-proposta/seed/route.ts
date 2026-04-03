import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId } from '@/lib/utils';
import type { TemplateProposta, SecaoProposta } from '@/lib/crm-types';

function secao(tipo: SecaoProposta['tipo'], ordem: number, conteudo: Record<string, unknown>): SecaoProposta {
  return { id: generateId(), tipo, ordem, visivel: true, conteudo };
}

const TEMPLATES: Omit<TemplateProposta, 'id'>[] = [
  {
    nome: 'Europa Romantica',
    descricao: 'Roteiro perfeito para casais — lua de mel, aniversarios e escapadas romanticas pela Europa.',
    tipo_viagem: 'ROMANCE',
    icone: '💕',
    imagem_preview: 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=600&q=80',
    visual: {
      tema: 'padrao', cor_primaria: '#e11d48', cor_secundaria: '#0a0a14', cor_texto: '#1a1a2e',
      cor_fundo: '#fff1f2', fonte: 'Inter', imagem_capa: 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=1200&q=80', estilo_capa: 'FULLSCREEN',
    },
    secoes_padrao: [
      secao('TEXTO', 0, { titulo: 'Sua viagem dos sonhos', corpo: '', alinhamento: 'center' }),
      secao('ROTEIRO_DIA', 1, { dias: [
        { numero: 1, titulo: 'Dia 1 — Chegada', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
        { numero: 2, titulo: 'Dia 2 — Exploracao', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
        { numero: 3, titulo: 'Dia 3 — Romance', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
        { numero: 4, titulo: 'Dia 4 — Passeios', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
        { numero: 5, titulo: 'Dia 5 — Retorno', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
      ] }),
      secao('INCLUSOS', 2, { inclusos: ['Passagem aerea ida e volta', 'Hospedagem com cafe da manha', 'Transfer aeroporto/hotel', 'Seguro viagem', 'Jantar romantico'], nao_inclusos: ['Refeicoes nao mencionadas', 'Passeios opcionais', 'Gorjetas'] }),
      secao('VALORES', 3, { opcoes: [{ titulo: 'Pacote Casal', valor_total: 0, destaque: true, parcelas: [{ forma: 'A vista PIX', valor_parcela: 0, valor_total: 0, destaque: true }] }], observacoes_valores: '', validade: '' }),
      secao('CTA', 4, { texto_botao: 'Quero reservar!', numero_whatsapp: '', mensagem_predefinida: 'Ola! Tenho interesse no roteiro Europa Romantica.' }),
    ],
    mensagem_abertura_padrao: 'Preparamos este roteiro especial para tornar sua viagem inesquecivel. Cada detalhe foi pensado com carinho para criar momentos unicos a dois.',
    inclusos_padrao: ['Passagem aerea', 'Hospedagem', 'Transfer', 'Seguro viagem'],
    nao_inclusos_padrao: ['Refeicoes nao mencionadas', 'Passeios opcionais'],
    is_padrao: true,
  },
  {
    nome: 'Aventura & Natureza',
    descricao: 'Trilhas, montanhas e experiencias ao ar livre para os espiritos aventureiros.',
    tipo_viagem: 'AVENTURA',
    icone: '🏔️',
    imagem_preview: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600&q=80',
    visual: {
      tema: 'padrao', cor_primaria: '#059669', cor_secundaria: '#0a0a14', cor_texto: '#1a1a2e',
      cor_fundo: '#ecfdf5', fonte: 'Inter', imagem_capa: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=80', estilo_capa: 'FULLSCREEN',
    },
    secoes_padrao: [
      secao('TEXTO', 0, { titulo: 'Aventura te espera', corpo: '', alinhamento: 'left' }),
      secao('ROTEIRO_DIA', 1, { dias: [
        { numero: 1, titulo: 'Dia 1 — Chegada e aclimatacao', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
        { numero: 2, titulo: 'Dia 2 — Trilha principal', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
        { numero: 3, titulo: 'Dia 3 — Atividades radicais', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
        { numero: 4, titulo: 'Dia 4 — Exploracao livre', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
        { numero: 5, titulo: 'Dia 5 — Retorno', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
      ] }),
      secao('INCLUSOS', 2, { inclusos: ['Passagem aerea', 'Hospedagem', 'Guia especializado', 'Equipamentos', 'Seguro aventura'], nao_inclusos: ['Refeicoes extras', 'Atividades opcionais', 'Gorjetas'] }),
      secao('VALORES', 3, { opcoes: [{ titulo: 'Pacote Aventura', valor_total: 0, destaque: true, parcelas: [{ forma: 'A vista PIX', valor_parcela: 0, valor_total: 0, destaque: true }] }], observacoes_valores: '', validade: '' }),
      secao('CTA', 4, { texto_botao: 'Reservar aventura!', numero_whatsapp: '', mensagem_predefinida: 'Ola! Quero saber mais sobre o pacote Aventura.' }),
    ],
    mensagem_abertura_padrao: 'Para quem busca emocao e contato com a natureza, preparamos um roteiro cheio de adrenalina e paisagens de tirar o folego.',
    inclusos_padrao: ['Passagem aerea', 'Hospedagem', 'Guia', 'Equipamentos'],
    nao_inclusos_padrao: ['Refeicoes extras', 'Atividades opcionais'],
    is_padrao: true,
  },
  {
    nome: 'Disney em Familia',
    descricao: 'A magia Disney para toda a familia — parques, hoteis tematicos e diversao garantida.',
    tipo_viagem: 'FAMILIA',
    icone: '🏰',
    imagem_preview: 'https://images.unsplash.com/photo-1597466599360-3b9775841aec?w=600&q=80',
    visual: {
      tema: 'padrao', cor_primaria: '#7c3aed', cor_secundaria: '#0a0a14', cor_texto: '#1a1a2e',
      cor_fundo: '#faf5ff', fonte: 'Inter', imagem_capa: 'https://images.unsplash.com/photo-1597466599360-3b9775841aec?w=1200&q=80', estilo_capa: 'SPLIT',
    },
    secoes_padrao: [
      secao('TEXTO', 0, { titulo: 'A magia Disney espera voces!', corpo: '', alinhamento: 'center' }),
      secao('SERVICO', 1, { icone: '✈️', titulo: 'Voo', descricao: '', detalhes: [], imagem: '', valor: 0, exibir_valor: false }),
      secao('SERVICO', 2, { icone: '🏨', titulo: 'Hotel', descricao: '', detalhes: [], imagem: '', valor: 0, exibir_valor: false }),
      secao('ROTEIRO_DIA', 3, { dias: [
        { numero: 1, titulo: 'Dia 1 — Chegada em Orlando', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
        { numero: 2, titulo: 'Dia 2 — Magic Kingdom', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
        { numero: 3, titulo: 'Dia 3 — Epcot', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
        { numero: 4, titulo: 'Dia 4 — Hollywood Studios', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
        { numero: 5, titulo: 'Dia 5 — Animal Kingdom', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
        { numero: 6, titulo: 'Dia 6 — Compras e lazer', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
        { numero: 7, titulo: 'Dia 7 — Retorno', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' },
      ] }),
      secao('INCLUSOS', 4, { inclusos: ['Passagem aerea', 'Hotel com cafe', 'Ingressos parques Disney', 'Transfer aeroporto/hotel', 'Seguro viagem familia'], nao_inclusos: ['Refeicoes nos parques', 'Souvenirs', 'Gorjetas', 'Passeios extras'] }),
      secao('VALORES', 5, { opcoes: [{ titulo: 'Pacote Familia (2 adultos + 2 criancas)', valor_total: 0, destaque: true, parcelas: [{ forma: 'A vista PIX', valor_parcela: 0, valor_total: 0, destaque: true }] }], observacoes_valores: 'Valores por pessoa. Criancas ate 12 anos com desconto.', validade: '' }),
      secao('CTA', 6, { texto_botao: 'Quero levar a familia!', numero_whatsapp: '', mensagem_predefinida: 'Ola! Tenho interesse no pacote Disney em Familia.' }),
    ],
    mensagem_abertura_padrao: 'Realizem o sonho de toda a familia com um roteiro completo pela Disney. Cada dia foi planejado para maximizar a diversao de todas as idades!',
    inclusos_padrao: ['Passagem aerea', 'Hospedagem', 'Ingressos', 'Transfer', 'Seguro'],
    nao_inclusos_padrao: ['Refeicoes nos parques', 'Souvenirs'],
    is_padrao: true,
  },
  {
    nome: 'Cruzeiro Maritimo',
    descricao: 'Navegue em grande estilo — roteiros de cruzeiro com tudo incluso.',
    tipo_viagem: 'CRUZEIRO',
    icone: '🚢',
    imagem_preview: 'https://images.unsplash.com/photo-1548574505-5e239809ee19?w=600&q=80',
    visual: {
      tema: 'padrao', cor_primaria: '#0284c7', cor_secundaria: '#0a0a14', cor_texto: '#1a1a2e',
      cor_fundo: '#f0f9ff', fonte: 'Inter', imagem_capa: 'https://images.unsplash.com/photo-1548574505-5e239809ee19?w=1200&q=80', estilo_capa: 'FULLSCREEN',
    },
    secoes_padrao: [
      secao('TEXTO', 0, { titulo: 'Navegue em grande estilo', corpo: '', alinhamento: 'center' }),
      secao('SERVICO', 1, { icone: '🚢', titulo: 'Cabine', descricao: '', detalhes: [], imagem: '', valor: 0, exibir_valor: false }),
      secao('ROTEIRO_DIA', 2, { dias: [
        { numero: 1, titulo: 'Dia 1 — Embarque', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: 'Todas' },
        { numero: 2, titulo: 'Dia 2 — Dia no mar', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: 'Todas' },
        { numero: 3, titulo: 'Dia 3 — Porto 1', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: 'Todas' },
        { numero: 4, titulo: 'Dia 4 — Porto 2', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: 'Todas' },
        { numero: 5, titulo: 'Dia 5 — Desembarque', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: 'Cafe da manha' },
      ] }),
      secao('INCLUSOS', 3, { inclusos: ['Cabine', 'Todas as refeicoes a bordo', 'Entretenimento', 'Piscina e spa basico', 'Seguro viagem'], nao_inclusos: ['Bebidas premium', 'Excursoes em terra', 'Spa premium', 'Gorjetas'] }),
      secao('VALORES', 4, { opcoes: [{ titulo: 'Cabine Interna', valor_total: 0, destaque: false, parcelas: [] }, { titulo: 'Cabine com Varanda', valor_total: 0, destaque: true, parcelas: [] }], observacoes_valores: 'Valores por pessoa em cabine dupla.', validade: '' }),
      secao('CTA', 5, { texto_botao: 'Reservar cruzeiro!', numero_whatsapp: '', mensagem_predefinida: 'Ola! Quero saber mais sobre o cruzeiro.' }),
    ],
    mensagem_abertura_padrao: 'Descubra o prazer de viajar pelo mar. Tudo incluso, sem preocupacoes — apenas relaxe e aproveite cada momento a bordo.',
    inclusos_padrao: ['Cabine', 'Refeicoes', 'Entretenimento', 'Seguro'],
    nao_inclusos_padrao: ['Bebidas premium', 'Excursoes', 'Spa premium'],
    is_padrao: true,
  },
  {
    nome: 'Viagem Corporativa',
    descricao: 'Eventos, convencoes e viagens de negocios com foco em eficiencia e conforto.',
    tipo_viagem: 'CORPORATIVO',
    icone: '💼',
    imagem_preview: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&q=80',
    visual: {
      tema: 'padrao', cor_primaria: '#1e293b', cor_secundaria: '#0a0a14', cor_texto: '#1a1a2e',
      cor_fundo: '#f8fafc', fonte: 'Inter', imagem_capa: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80', estilo_capa: 'MINIMAL',
    },
    secoes_padrao: [
      secao('TEXTO', 0, { titulo: 'Proposta Corporativa', corpo: '', alinhamento: 'left' }),
      secao('SERVICO', 1, { icone: '✈️', titulo: 'Aereo', descricao: '', detalhes: [], imagem: '', valor: 0, exibir_valor: true }),
      secao('SERVICO', 2, { icone: '🏨', titulo: 'Hospedagem', descricao: '', detalhes: [], imagem: '', valor: 0, exibir_valor: true }),
      secao('INCLUSOS', 3, { inclusos: ['Passagem aerea executiva', 'Hotel categoria superior', 'Transfer privativo', 'Seguro viagem corporativo'], nao_inclusos: ['Refeicoes extras', 'Lavanderia', 'Minibar'] }),
      secao('VALORES', 4, { opcoes: [{ titulo: 'Pacote Executivo', valor_total: 0, destaque: true, parcelas: [{ forma: 'Faturado 30 dias', valor_parcela: 0, valor_total: 0, destaque: true }] }], observacoes_valores: 'Valores por participante. Descontos para grupos acima de 10 pessoas.', validade: '' }),
      secao('CTA', 5, { texto_botao: 'Solicitar orcamento', numero_whatsapp: '', mensagem_predefinida: 'Ola! Gostaria de um orcamento corporativo.' }),
    ],
    mensagem_abertura_padrao: 'Apresentamos nossa proposta com foco em otimizar a logistica e o conforto dos participantes, garantindo uma experiencia profissional e eficiente.',
    inclusos_padrao: ['Aereo executivo', 'Hotel superior', 'Transfer', 'Seguro corporativo'],
    nao_inclusos_padrao: ['Refeicoes extras', 'Extras de hotel'],
    is_padrao: true,
  },
  {
    nome: 'Praia & Relax',
    descricao: 'Sol, mar e descanso — destinos de praia com resorts all-inclusive.',
    tipo_viagem: 'PRAIA',
    icone: '🏖️',
    imagem_preview: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&q=80',
    visual: {
      tema: 'padrao', cor_primaria: '#0891b2', cor_secundaria: '#0a0a14', cor_texto: '#1a1a2e',
      cor_fundo: '#ecfeff', fonte: 'Inter', imagem_capa: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=80', estilo_capa: 'FULLSCREEN',
    },
    secoes_padrao: [
      secao('TEXTO', 0, { titulo: 'Paraiso te espera', corpo: '', alinhamento: 'center' }),
      secao('GALERIA', 1, { imagens: [] }),
      secao('ROTEIRO_DIA', 2, { dias: [
        { numero: 1, titulo: 'Dia 1 — Chegada ao paraiso', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: 'Jantar' },
        { numero: 2, titulo: 'Dia 2 — Praia e relaxamento', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: 'All-inclusive' },
        { numero: 3, titulo: 'Dia 3 — Passeio de barco', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: 'All-inclusive' },
        { numero: 4, titulo: 'Dia 4 — Dia livre', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: 'All-inclusive' },
        { numero: 5, titulo: 'Dia 5 — Retorno', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: 'Cafe da manha' },
      ] }),
      secao('INCLUSOS', 3, { inclusos: ['Passagem aerea', 'Resort all-inclusive', 'Transfer', 'Seguro viagem'], nao_inclusos: ['Passeios opcionais', 'Spa', 'Gorjetas'] }),
      secao('VALORES', 4, { opcoes: [{ titulo: 'Pacote All-Inclusive', valor_total: 0, destaque: true, parcelas: [{ forma: 'A vista PIX', valor_parcela: 0, valor_total: 0, destaque: true }] }], observacoes_valores: '', validade: '' }),
      secao('CTA', 5, { texto_botao: 'Quero relaxar!', numero_whatsapp: '', mensagem_predefinida: 'Ola! Tenho interesse no pacote Praia & Relax.' }),
    ],
    mensagem_abertura_padrao: 'Nada como dias de sol, mar e total descanso. Preparamos um roteiro para voce recarregar as energias no paraiso.',
    inclusos_padrao: ['Passagem aerea', 'Resort all-inclusive', 'Transfer', 'Seguro'],
    nao_inclusos_padrao: ['Passeios opcionais', 'Spa'],
    is_padrao: true,
  },
];

export async function POST() {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB not initialized' }, { status: 500 });

    let count = 0;
    for (const tmpl of TEMPLATES) {
      const id = generateId();
      const data = { ...tmpl, id };
      // Check if template with same name already exists
      const { rows: existing } = await pool.query(
        `SELECT id FROM templates_proposta WHERE LOWER(nome) = $1`,
        [tmpl.nome.toLowerCase()]
      );
      if (existing.length > 0) continue;

      await pool.query(
        `INSERT INTO templates_proposta (id, nome, data) VALUES ($1, $2, $3)`,
        [id, tmpl.nome, JSON.stringify(data)]
      );
      count++;
    }

    return NextResponse.json({ message: `${count} templates criados`, total: TEMPLATES.length });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

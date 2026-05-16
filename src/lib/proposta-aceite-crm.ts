// Helpers para o fluxo publico de aceite/alteracao da proposta:
// quando o cliente preenche o formulario (nome/telefone/email) e
// confirma, criamos automaticamente um Cliente PF + uma Venda CRM
// (em status ORCAMENTO) no tenant da agencia.
//
// Usado pelos endpoints:
//   PUT /api/propostas/public/[slug]/aceitar
//   POST /api/propostas/public/[slug]/solicitar-alteracao

import type { Pool } from 'pg';
import { generateId } from './utils';

interface PropostaJSON {
  id?: string;
  numero?: string;
  cabecalho?: { titulo?: string; subtitulo?: string };
  cliente_id?: string;
  cliente_nome?: string;
  vendedor_id?: string;
  rodape?: { nome_vendedor?: string };
  secoes?: Array<{ tipo: string; conteudo: Record<string, unknown> }>;
}

interface CriarVendaInput {
  pool: Pool;
  tenantId: string;
  propostaId: string;
  proposta: PropostaJSON;
  nome: string;
  telefone: string;
  email: string;
  // 'aceite' = cliente aceitou a proposta; 'alteracao' = pediu alteracao
  tipo: 'aceite' | 'alteracao';
  // Texto da alteracao solicitada (so quando tipo='alteracao')
  anotacao?: string;
  ip: string;
}

interface CriarVendaResult {
  clienteId: string;
  vendaId: string;
  vendaNumero: string;
  valorTotal: number;
}

// Calcula valor total da proposta a partir do 1o bloco VALORES (opcao
// com destaque, ou primeira). Default 0 se nao houver.
function calcValorProposta(proposta: PropostaJSON): number {
  for (const secao of proposta.secoes || []) {
    if (secao.tipo !== 'VALORES') continue;
    const c = secao.conteudo as { opcoes?: Array<{ valor_total?: number; destaque?: boolean }> };
    const opcoes = c.opcoes || [];
    if (opcoes.length === 0) continue;
    const destaque = opcoes.find(o => o.destaque) || opcoes[0];
    return Number(destaque.valor_total || 0);
  }
  return 0;
}

// Monta lista de produtos pra venda baseada nos blocos da proposta.
// Cada ALOJAMENTO vira 1 HOTEL; cada VOO/TRANSPORTE vira 1 AEREO; o
// titulo do bloco VALORES vira o "PACOTE" principal. Se nao houver
// nenhum, retorna 1 PACOTE generico com o titulo da proposta.
function montarProdutos(proposta: PropostaJSON): Array<Record<string, unknown>> {
  const produtos: Array<Record<string, unknown>> = [];
  let temAereo = false;
  let temHotel = false;

  for (const secao of proposta.secoes || []) {
    if (secao.tipo === 'ALOJAMENTO') {
      const c = secao.conteudo as {
        hotel_nome?: string; destino_nome?: string;
        check_in?: string; check_out?: string; quarto_tipo?: string;
        preco_total?: number;
      };
      temHotel = true;
      produtos.push({
        id: generateId(),
        tipo: 'HOTEL',
        descricao: `${c.hotel_nome || 'Hospedagem'}${c.destino_nome ? ` — ${c.destino_nome}` : ''}`,
        fornecedor_id: '', fornecedor_nome: '',
        data_inicio: c.check_in || '',
        data_fim: c.check_out || '',
        localizador: '', cia_aerea: '', trecho: '',
        hotel_nome: c.hotel_nome || '',
        tipo_apto: c.quarto_tipo || '',
        valor_custo: 0,
        valor_venda: Number(c.preco_total || 0),
        status: 'RESERVADO',
      });
    } else if (secao.tipo === 'VOO' || secao.tipo === 'TRANSPORTE') {
      const c = secao.conteudo as {
        tipo?: string; origem?: string; destino?: string;
        data?: string; companhia?: string; numero_voo?: string;
        valor?: number;
      };
      // Ignora TRANSPORTE terrestre — so AEREO conta como produto da venda
      if (secao.tipo === 'TRANSPORTE' && c.tipo !== 'VOO') continue;
      temAereo = true;
      produtos.push({
        id: generateId(),
        tipo: 'AEREO',
        descricao: `${c.origem || ''} → ${c.destino || ''}${c.companhia ? ` (${c.companhia})` : ''}`,
        fornecedor_id: '', fornecedor_nome: c.companhia || '',
        data_inicio: c.data || '',
        data_fim: c.data || '',
        localizador: '',
        cia_aerea: c.companhia || '',
        trecho: `${c.origem || ''}/${c.destino || ''}`,
        hotel_nome: '', tipo_apto: '',
        valor_custo: 0,
        valor_venda: Number(c.valor || 0),
        status: 'RESERVADO',
      });
    }
  }

  // Se nao identificou produtos especificos, cria 1 PACOTE generico
  if (produtos.length === 0) {
    produtos.push({
      id: generateId(),
      tipo: 'PACOTE',
      descricao: proposta.cabecalho?.titulo || 'Proposta',
      fornecedor_id: '', fornecedor_nome: '',
      data_inicio: '', data_fim: '',
      localizador: '', cia_aerea: '', trecho: '',
      hotel_nome: '', tipo_apto: '',
      valor_custo: 0,
      valor_venda: calcValorProposta(proposta),
      status: 'RESERVADO',
    });
  }

  return produtos;
}

// Cria Cliente PF (ou reusa se ja existe um com mesmo email/telefone no
// tenant) + VendaCRM em status ORCAMENTO no banco. Retorna ids gerados.
export async function criarVendaDaPropostaPublica(
  input: CriarVendaInput,
): Promise<CriarVendaResult> {
  const { pool, tenantId, propostaId, proposta, nome, telefone, email, tipo, anotacao } = input;

  // 1. Procura cliente existente por email (case-insensitive) ou telefone
  //    no mesmo tenant pra evitar duplicar.
  let clienteId = '';
  if (email || telefone) {
    const { rows: existentes } = await pool.query(
      `SELECT id, data FROM clientes
       WHERE tenant_id = $1
         AND (LOWER(COALESCE(data->>'email', '')) = LOWER($2)
              OR REGEXP_REPLACE(COALESCE(data->>'telefone_principal', ''), '\\D', '', 'g') = REGEXP_REPLACE($3, '\\D', '', 'g'))
       LIMIT 1`,
      [tenantId, email || '__none__', telefone || '__none__'],
    );
    if (existentes.length > 0) {
      clienteId = existentes[0].id;
    }
  }

  // 2. Cria cliente novo se nao houver existente.
  if (!clienteId) {
    clienteId = generateId();
    const novoCliente = {
      id: clienteId, tipo: 'PF',
      nome_completo: nome, cpf: '', rg: '', data_nascimento: '',
      genero: '', estado_civil: '', nacionalidade: 'Brasileira',
      passaporte: '', validade_passaporte: '',
      razao_social: '', nome_fantasia: '', cnpj: '', inscricao_estadual: '',
      telefone_principal: telefone, telefone_secundario: '',
      whatsapp: telefone, email,
      email_secundario: '',
      cep: '', logradouro: '', numero: '', complemento: '', bairro: '',
      cidade: '', estado: '', pais: 'Brasil',
      cartoes: [], anexos: [], marcadores: ['proposta-publica'], campos_personalizados: {},
      preferencias: {
        tipo_viagem: [], classe_voo: '', tipo_hotel: '', destinos_favoritos: [],
        restricoes_alimentares: '', necessidades_especiais: '', assento_preferido: '',
        programa_fidelidade: [],
      },
      vendedor_responsavel: proposta.vendedor_id || '',
      indicado_por: '', data_cadastro: new Date().toISOString(),
      ultima_compra: '', total_compras: 0, valor_total_historico: 0,
      status: 'ATIVO',
      observacoes: `Cadastro criado automaticamente a partir do aceite/solicitacao da proposta ${proposta.numero || propostaId}.`,
    };
    await pool.query(
      `INSERT INTO clientes (id, tenant_id, data, nome, tipo, cpf_cnpj, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'PF', '', NOW(), NOW())`,
      [clienteId, tenantId, JSON.stringify(novoCliente), nome],
    );
  }

  // 3. Cria a Venda CRM (estilo "negociacao"). Status = ORCAMENTO porque
  //    o cliente acabou de manifestar interesse — financeiro ainda nao
  //    foi gerado. Vendedor pode confirmar/cancelar depois.
  const vendaId = generateId();
  const ano = new Date().getFullYear();
  const vendaNumero = `V${ano}-${Math.floor(Date.now() / 1000).toString().slice(-6)}`;
  const tituloProposta = proposta.cabecalho?.titulo
    || proposta.cabecalho?.subtitulo
    || 'Proposta';
  const produtos = montarProdutos(proposta);
  const valorTotal = produtos.reduce((sum, p) => sum + Number(p.valor_venda || 0), 0)
    || calcValorProposta(proposta);

  const observacoesParts: string[] = [];
  observacoesParts.push(`Proposta: ${proposta.numero || propostaId}`);
  observacoesParts.push(`Cliente preencheu o formulario publico em ${new Date().toLocaleString('pt-BR')}.`);
  if (tipo === 'alteracao' && anotacao) {
    observacoesParts.push('');
    observacoesParts.push(`SOLICITACAO DE ALTERACAO:`);
    observacoesParts.push(anotacao);
  }

  const novaVenda = {
    id: vendaId,
    numero: vendaNumero,
    data_venda: new Date().toISOString().split('T')[0],
    tipo: 'AVULSA',
    grupo_id: null,
    cliente_id: clienteId,
    vendedor_id: proposta.vendedor_id || '',
    passageiros: [{ nome, tipo: 'ADT', documento: '', data_nascimento: '', telefone, email }],
    pagantes: [{ cliente_id: clienteId, nome, percentual: 100, valor: valorTotal }],
    produtos,
    valor_total_custo: 0,
    valor_total_venda: valorTotal,
    markup_realizado: 0,
    desconto: 0,
    valor_final: valorTotal,
    forma_pagamento: 'AVISTA_PIX',
    parcelas: 1,
    pagamento_detalhado: [],
    status: 'ORCAMENTO',
    motivo_cancelamento: '',
    recibo_emitido: false,
    intermediario_id: null,
    comissao_intermediario: 0,
    centro_custo: '', numero_po: '',
    anexos: [
      { nome: tituloProposta, url: `/p/${propostaId}` },
    ],
    observacoes: observacoesParts.join('\n'),
    campos_personalizados: {
      origem_lead: tipo === 'aceite' ? 'aceite_publico' : 'solicitacao_alteracao',
      proposta_id: propostaId,
    },
    nome_negociacao: tituloProposta,
  };

  await pool.query(
    `INSERT INTO vendas_crm (id, tenant_id, data, cliente_id, vendedor_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [vendaId, tenantId, JSON.stringify(novaVenda), clienteId, novaVenda.vendedor_id, 'ORCAMENTO'],
  );

  return { clienteId, vendaId, vendaNumero, valorTotal };
}

// Fluxo de aceite/alteracao da proposta publica integrado ao CRM:
//
//   1. Persiste evento local em proposta_eventos_publicos (idempotente
//      por request_id+proposta_id) — fonte de verdade independente do CRM.
//   2. Procura NEGOCIACAO ATIVA (vendas_crm em status ORCAMENTO,
//      RESERVADO ou CONFIRMADO) do cliente via telefone OU email
//      normalizados.
//   3. Se existir → cria anotacao + tarefa naquela negociacao. NAO duplica.
//   4. Se nao existir → cria Cliente novo + VendaCRM em ORCAMENTO +
//      anotacao inicial + tarefa.
//   5. Atualiza evento local com crm_negotiation_id, crm_task_id e
//      matched_existing_negotiation. Em caso de falha CRM, marca
//      sync_status='error' mas mantem o evento salvo pra reprocessar.
//
// Idempotencia: tabela proposta_eventos_publicos tem UNIQUE
// (proposta_id, request_id). Re-envio com mesmo request_id retorna o
// resultado do envio anterior sem efeitos colaterais.

import type { Pool, PoolClient } from 'pg';
import { generateId } from './utils';
import { round2, num, somaPor, percentual, divSegura, hojeISO } from './money';

// ============================================================
// Tipos
// ============================================================

interface PropostaJSON {
  id?: string;
  numero?: string;
  cabecalho?: { titulo?: string; subtitulo?: string };
  cliente_id?: string;
  cliente_nome?: string;
  vendedor_id?: string;
  rodape?: { nome_vendedor?: string };
  visual?: { cor_primaria?: string };
  secoes?: Array<{ tipo: string; conteudo: Record<string, unknown> }>;
}

export interface CriarEventoPropostaInput {
  pool: Pool;
  tenantId: string;
  propostaId: string;
  propostaUrl: string;
  proposta: PropostaJSON;
  nome: string;
  telefone: string;
  email: string;
  tipo: 'aceite' | 'alteracao';
  anotacao?: string;
  ip: string;
  requestId: string;        // idempotency key gerada pelo client
}

export interface CriarEventoPropostaResult {
  eventoId: string;
  vendaId: string;
  vendaNumero: string;
  tarefaId: string;
  clienteId: string;
  valorTotal: number;
  matchedExisting: boolean;
  duplicado: boolean;       // true se o request_id ja foi processado antes
  syncStatus: 'ok' | 'error';
  syncError?: string;
}

// ============================================================
// Normalizacao de telefone/email
// ============================================================

function normalizarTelefone(t: string): string {
  return (t || '').replace(/\D/g, '');
}

function normalizarEmail(e: string): string {
  return (e || '').trim().toLowerCase();
}

// ============================================================
// Extracao de dados da proposta
// ============================================================

function nomeDoRoteiro(proposta: PropostaJSON, propostaId: string): string {
  return proposta.cabecalho?.titulo
    || proposta.cabecalho?.subtitulo
    || `Proposta ${proposta.numero || propostaId}`;
}

function calcValorProposta(proposta: PropostaJSON): number {
  for (const secao of proposta.secoes || []) {
    if (secao.tipo !== 'VALORES') continue;
    const c = secao.conteudo as { opcoes?: Array<{ valor_total?: number; destaque?: boolean }> };
    const opcoes = c.opcoes || [];
    if (opcoes.length === 0) continue;
    const destaque = opcoes.find(o => o.destaque) || opcoes[0];
    return round2(num(destaque.valor_total));
  }
  return 0;
}

/** Comissão de fornecedor declarada na seção (valor em R$ ou percentual).
 *  Proposta pública não tem custo: a comissão é a única receita real da
 *  agência que dá pra apurar aqui. */
function comissaoDaSecao(conteudo: Record<string, unknown>, valorVenda: number): number {
  const direto = num(conteudo.comissao_valor ?? conteudo.comissao);
  if (direto > 0) return round2(direto);
  const pct = num(conteudo.comissao_percentual);
  if (pct > 0) return percentual(valorVenda, pct);
  return 0;
}

interface ProdutoExtraido {
  tipo: string;
  descricao: string;
  fornecedor_nome: string;
  data_inicio: string;
  data_fim: string;
  valor_venda: number;
  comissao_valor: number;   // R$ — 0 quando a proposta não informa
}

function extrairProdutos(proposta: PropostaJSON): ProdutoExtraido[] {
  const produtos: ProdutoExtraido[] = [];
  for (const secao of proposta.secoes || []) {
    if (secao.tipo === 'ALOJAMENTO') {
      const c = secao.conteudo as {
        hotel_nome?: string; destino_nome?: string;
        check_in?: string; check_out?: string;
        preco_total?: number;
      };
      const valorVenda = round2(num(c.preco_total));
      produtos.push({
        tipo: 'HOTEL',
        descricao: `${c.hotel_nome || 'Hospedagem'}${c.destino_nome ? ` — ${c.destino_nome}` : ''}`,
        fornecedor_nome: '',
        data_inicio: c.check_in || '',
        data_fim: c.check_out || '',
        valor_venda: valorVenda,
        comissao_valor: comissaoDaSecao(secao.conteudo, valorVenda),
      });
    } else if (secao.tipo === 'VOO' || (secao.tipo === 'TRANSPORTE' && (secao.conteudo as { tipo?: string }).tipo === 'VOO')) {
      const c = secao.conteudo as {
        origem?: string; destino?: string; data?: string;
        companhia?: string; valor?: number;
      };
      const valorVenda = round2(num(c.valor));
      produtos.push({
        tipo: 'AEREO',
        descricao: `${c.origem || ''} → ${c.destino || ''}${c.companhia ? ` (${c.companhia})` : ''}`,
        fornecedor_nome: c.companhia || '',
        data_inicio: c.data || '',
        data_fim: c.data || '',
        valor_venda: valorVenda,
        comissao_valor: comissaoDaSecao(secao.conteudo, valorVenda),
      });
    }
  }
  if (produtos.length === 0) {
    produtos.push({
      tipo: 'PACOTE',
      descricao: nomeDoRoteiro(proposta, ''),
      fornecedor_nome: '',
      data_inicio: '', data_fim: '',
      valor_venda: calcValorProposta(proposta),
      comissao_valor: 0,
    });
  }
  return produtos;
}

// ============================================================
// Helpers de query
// ============================================================

interface NegociacaoAtiva {
  vendaId: string;
  clienteId: string;
  vendedorId: string;
  numero: string;
}

// Status que indicam negociacao ATIVA (em andamento).
// Encerradas: CANCELADO, CONCLUIDO.
const STATUS_ATIVOS = ['ORCAMENTO', 'RESERVADO', 'CONFIRMADO'];

/**
 * Procura uma VendaCRM (negociacao) ATIVA do tenant que pertenca a um
 * cliente cujo telefone ou email batem (apos normalizacao) com os
 * fornecidos. Retorna a 1a encontrada por ordem decrescente de criacao.
 *
 * Algoritmo:
 *   1. Encontra cliente_id por email OU telefone normalizado em
 *      clientes (tenant scoped).
 *   2. Encontra vendas_crm com aquele cliente_id e status IN ativos.
 *
 * Se cliente nao existir ou nao tiver venda ativa, retorna null.
 */
export async function buscarNegociacaoAtiva(
  pool: Pool | PoolClient,
  tenantId: string,
  telefone: string,
  email: string,
): Promise<NegociacaoAtiva | null> {
  const tel = normalizarTelefone(telefone);
  const em = normalizarEmail(email);
  if (!tel && !em) return null;

  // Query encontra clientes que batem por email lower-case OU por
  // qualquer campo de telefone normalizado (so digitos).
  const { rows } = await pool.query<{
    venda_id: string; cliente_id: string; vendedor_id: string; numero: string;
  }>(
    `
    WITH cli AS (
      SELECT id FROM clientes
      WHERE tenant_id = $1
        AND (
          ($2 <> '' AND LOWER(COALESCE(data->>'email', '')) = $2)
          OR ($2 <> '' AND LOWER(COALESCE(data->>'email_secundario', '')) = $2)
          OR ($3 <> '' AND REGEXP_REPLACE(COALESCE(data->>'telefone_principal', ''), '\\D', '', 'g') = $3)
          OR ($3 <> '' AND REGEXP_REPLACE(COALESCE(data->>'telefone_secundario', ''), '\\D', '', 'g') = $3)
          OR ($3 <> '' AND REGEXP_REPLACE(COALESCE(data->>'whatsapp', ''), '\\D', '', 'g') = $3)
        )
    )
    SELECT v.id AS venda_id,
           v.cliente_id,
           v.data->>'vendedor_id' AS vendedor_id,
           COALESCE(v.data->>'numero', v.id) AS numero
    FROM vendas_crm v
    INNER JOIN cli ON cli.id = v.cliente_id
    WHERE v.tenant_id = $1
      AND v.status = ANY($4)
    ORDER BY v.created_at DESC
    LIMIT 1
    `,
    [tenantId, em, tel, STATUS_ATIVOS],
  );

  if (rows.length === 0) return null;
  return {
    vendaId: rows[0].venda_id,
    clienteId: rows[0].cliente_id,
    vendedorId: rows[0].vendedor_id || '',
    numero: rows[0].numero,
  };
}

interface CriarAnotacaoArgs {
  pool: Pool | PoolClient;
  tenantId: string;
  vendaId: string;
  texto: string;
  origem?: string;
  tipoEvento?: 'aceite' | 'alteracao';
  data?: Record<string, unknown>;
}

export async function criarAnotacaoNegociacao(args: CriarAnotacaoArgs): Promise<string> {
  const id = generateId();
  await args.pool.query(
    `INSERT INTO negociacao_anotacoes (id, tenant_id, venda_id, autor_id, autor_nome, texto, origem, tipo_evento, data)
     VALUES ($1, $2, $3, '', 'Sistema', $4, $5, $6, $7)`,
    [
      id, args.tenantId, args.vendaId,
      args.texto,
      args.origem || 'sistema',
      args.tipoEvento || null,
      JSON.stringify(args.data || {}),
    ],
  );
  return id;
}

interface CriarTarefaArgs {
  pool: Pool | PoolClient;
  tenantId: string;
  vendaId: string;
  clienteId?: string;
  responsavelId: string;
  titulo: string;
  descricao: string;
  prioridade?: 'baixa' | 'normal' | 'alta' | 'urgente';
  origem?: string;
  dataVencimento?: string;
  data?: Record<string, unknown>;
}

export async function criarTarefaNegociacao(args: CriarTarefaArgs): Promise<string> {
  const id = generateId();
  await args.pool.query(
    `INSERT INTO negociacao_tarefas
       (id, tenant_id, venda_id, cliente_id, responsavel_id, titulo, descricao,
        status, prioridade, origem, data_vencimento, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', $8, $9, $10, $11)`,
    [
      id, args.tenantId, args.vendaId,
      args.clienteId || null,
      args.responsavelId || '',
      args.titulo,
      args.descricao,
      args.prioridade || 'alta',
      args.origem || 'sistema',
      args.dataVencimento || null,
      JSON.stringify(args.data || {}),
    ],
  );
  return id;
}

// ============================================================
// Cliente: busca ou cria
// ============================================================

async function buscarOuCriarCliente(
  client: PoolClient,
  tenantId: string,
  nome: string,
  telefone: string,
  email: string,
  vendedorPadrao: string,
  propostaNumero: string,
): Promise<string> {
  const tel = normalizarTelefone(telefone);
  const em = normalizarEmail(email);

  if (em || tel) {
    const { rows: existentes } = await client.query<{ id: string }>(
      `SELECT id FROM clientes
       WHERE tenant_id = $1
         AND (
           ($2 <> '' AND LOWER(COALESCE(data->>'email', '')) = $2)
           OR ($3 <> '' AND REGEXP_REPLACE(COALESCE(data->>'telefone_principal', ''), '\\D', '', 'g') = $3)
           OR ($3 <> '' AND REGEXP_REPLACE(COALESCE(data->>'whatsapp', ''), '\\D', '', 'g') = $3)
         )
       LIMIT 1`,
      [tenantId, em, tel],
    );
    if (existentes.length > 0) return existentes[0].id;
  }

  const clienteId = generateId();
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
    vendedor_responsavel: vendedorPadrao,
    indicado_por: '', data_cadastro: new Date().toISOString(),
    ultima_compra: '', total_compras: 0, valor_total_historico: 0,
    status: 'ATIVO',
    observacoes: `Cadastro criado automaticamente pelo aceite/solicitacao da proposta ${propostaNumero}.`,
  };
  await client.query(
    `INSERT INTO clientes (id, tenant_id, data, nome, tipo, cpf_cnpj, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'PF', '', NOW(), NOW())`,
    [clienteId, tenantId, JSON.stringify(novoCliente), nome],
  );
  return clienteId;
}

// ============================================================
// Texto compartilhado (anotacao + tarefa)
// ============================================================

function listaProdutosLegivel(produtos: ProdutoExtraido[]): string {
  if (produtos.length === 0) return '—';
  return produtos.map(p => `- ${p.tipo}: ${p.descricao}${p.valor_venda ? ` (R$ ${p.valor_venda.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})` : ''}`).join('\n');
}

function montarTextoAnotacao(input: CriarEventoPropostaInput, valorTotal: number, produtos: ProdutoExtraido[]): string {
  const titulo = input.tipo === 'aceite'
    ? 'CLIENTE ACEITOU PROPOSTA'
    : 'CLIENTE SOLICITOU ALTERAÇÕES';
  const linhas: string[] = [
    titulo,
    '',
    `Nome: ${input.nome}`,
    `Telefone: ${input.telefone || '—'}`,
    `Email: ${input.email || '—'}`,
    '',
    `Proposta: ${nomeDoRoteiro(input.proposta, input.propostaId)}`,
    `Link: ${input.propostaUrl}`,
    `Valor: R$ ${valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    '',
    'Produtos/itens:',
    listaProdutosLegivel(produtos),
    '',
    `Data/hora: ${new Date().toLocaleString('pt-BR')}`,
    `Origem: proposta publica`,
  ];
  if (input.tipo === 'alteracao' && input.anotacao) {
    linhas.push('');
    linhas.push('SOLICITACAO DE ALTERACAO:');
    linhas.push(input.anotacao);
  }
  return linhas.join('\n');
}

function montarTituloTarefa(tipo: 'aceite' | 'alteracao'): string {
  return tipo === 'aceite'
    ? 'Cliente aceitou proposta'
    : 'Cliente solicitou alterações na proposta';
}

function montarDescricaoTarefa(input: CriarEventoPropostaInput, valorTotal: number): string {
  const nomeRoteiro = nomeDoRoteiro(input.proposta, input.propostaId);
  if (input.tipo === 'aceite') {
    return [
      'Cliente aceitou a proposta pública.',
      `Cliente: ${input.nome}`,
      `Telefone: ${input.telefone || '—'} · Email: ${input.email || '—'}`,
      `Roteiro: ${nomeRoteiro}`,
      `Valor: R$ ${valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `Link: ${input.propostaUrl}`,
      '',
      'Próximos passos: revisar proposta e entrar em contato para fechamento.',
    ].join('\n');
  }
  return [
    'Cliente solicitou alterações na proposta pública.',
    `Cliente: ${input.nome}`,
    `Telefone: ${input.telefone || '—'} · Email: ${input.email || '—'}`,
    `Roteiro: ${nomeRoteiro}`,
    `Valor: R$ ${valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    `Link: ${input.propostaUrl}`,
    '',
    'Solicitação do cliente:',
    input.anotacao || '(sem texto)',
    '',
    'Próximos passos: revisar a observação, atualizar a proposta e retornar contato.',
  ].join('\n');
}

// ============================================================
// MAIN: processarEventoPropostaPublica
// ============================================================

export async function processarEventoPropostaPublica(
  input: CriarEventoPropostaInput,
): Promise<CriarEventoPropostaResult> {
  const { pool, tenantId, propostaId, propostaUrl, proposta, requestId } = input;

  // ============ IDEMPOTENCIA ============
  // Se mesmo (proposta_id, request_id) ja foi processado, retorna
  // resultado anterior. Sem efeitos colaterais.
  if (requestId) {
    const { rows: existing } = await pool.query<{
      id: string; crm_negotiation_id: string | null; crm_task_id: string | null;
      matched_existing_negotiation: boolean; cliente_id: string | null;
      sync_status: string; sync_error: string | null;
      payload: { valorTotal?: number; vendaNumero?: string };
    }>(
      `SELECT id, crm_negotiation_id, crm_task_id, matched_existing_negotiation,
              cliente_id, sync_status, sync_error, payload
       FROM proposta_eventos_publicos
       WHERE proposta_id = $1 AND request_id = $2
       LIMIT 1`,
      [propostaId, requestId],
    );
    if (existing.length > 0) {
      const ev = existing[0];
      return {
        eventoId: ev.id,
        vendaId: ev.crm_negotiation_id || '',
        vendaNumero: ev.payload?.vendaNumero || '',
        tarefaId: ev.crm_task_id || '',
        clienteId: ev.cliente_id || '',
        valorTotal: ev.payload?.valorTotal || 0,
        matchedExisting: ev.matched_existing_negotiation,
        duplicado: true,
        syncStatus: ev.sync_status as 'ok' | 'error',
        syncError: ev.sync_error || undefined,
      };
    }
  }

  const valorTotal = calcValorProposta(proposta);
  const produtos = extrairProdutos(proposta);
  const nomeRoteiro = nomeDoRoteiro(proposta, propostaId);

  // ============ PERSISTENCIA LOCAL (1o passo, antes do CRM) ============
  // Insere evento com sync_status='pending'. Se CRM falhar adiante,
  // marca 'error' mas o evento esta salvo pra reprocessar.
  const eventoId = generateId();
  await pool.query(
    `INSERT INTO proposta_eventos_publicos
       (id, tenant_id, proposta_id, proposta_url, action_type,
        customer_name, customer_phone, customer_email, change_request_text,
        request_id, sync_status, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)`,
    [
      eventoId, tenantId, propostaId, propostaUrl, input.tipo,
      input.nome, input.telefone, input.email, input.anotacao || null,
      requestId,
      JSON.stringify({
        valorTotal,
        produtos,
        nomeRoteiro,
        propostaNumero: proposta.numero,
        ip: input.ip,
      }),
    ],
  );

  let vendaId = '';
  let vendaNumero = '';
  let clienteId = '';
  let tarefaId = '';
  let matchedExisting = false;
  let syncStatus: 'ok' | 'error' = 'ok';
  let syncError: string | undefined;

  try {
    // ============ BUSCAR NEGOCIACAO ATIVA ============
    const negociacaoExistente = await buscarNegociacaoAtiva(
      pool, tenantId, input.telefone, input.email,
    );

    if (negociacaoExistente) {
      // ============ EXISTE: cria anotacao + tarefa ============
      vendaId = negociacaoExistente.vendaId;
      vendaNumero = negociacaoExistente.numero;
      clienteId = negociacaoExistente.clienteId;
      matchedExisting = true;

      await criarAnotacaoNegociacao({
        pool, tenantId,
        vendaId,
        texto: montarTextoAnotacao(input, valorTotal, produtos),
        origem: 'proposta_publica',
        tipoEvento: input.tipo,
        data: {
          proposta_id: propostaId,
          proposta_url: propostaUrl,
          nome_roteiro: nomeRoteiro,
          valor_total: valorTotal,
          produtos,
          cliente_form: { nome: input.nome, telefone: input.telefone, email: input.email },
          change_request: input.anotacao,
        },
      });

      tarefaId = await criarTarefaNegociacao({
        pool, tenantId,
        vendaId,
        clienteId,
        responsavelId: negociacaoExistente.vendedorId,
        titulo: montarTituloTarefa(input.tipo),
        descricao: montarDescricaoTarefa(input, valorTotal),
        prioridade: input.tipo === 'aceite' ? 'urgente' : 'alta',
        origem: 'sistema',
        data: {
          proposta_id: propostaId,
          proposta_url: propostaUrl,
          tipo_acao: input.tipo,
          cliente_form: { nome: input.nome, telefone: input.telefone, email: input.email },
        },
      });
    } else {
      // ============ NAO EXISTE: cria cliente + venda + anotacao + tarefa ============
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        clienteId = await buscarOuCriarCliente(
          client, tenantId,
          input.nome, input.telefone, input.email,
          proposta.vendedor_id || '',
          proposta.numero || propostaId,
        );

        vendaId = generateId();
        const ano = new Date().getFullYear();
        vendaNumero = `V${ano}-${Math.floor(Date.now() / 1000).toString().slice(-6)}`;
        // Nome da negociacao: "Roteiro | Cliente"
        const nomeNegociacao = `${nomeRoteiro} | ${input.nome}`.slice(0, 200);
        const dataAcao = new Date().toISOString();

        // Proposta pública não traz custo de fornecedor. Se a proposta
        // declarar comissão, ela vira a receita da agência (e o custo é o
        // resto). Sem comissão declarada, o custo fica desconhecido — e a
        // venda é marcada com base_comissao_confiavel=false para que o
        // cálculo de comissão do vendedor NÃO use o faturamento bruto como
        // base (comissão sobre bruto = comissão sobre dinheiro do fornecedor).
        const comissaoFornecedorTotal = somaPor(produtos, p => p.comissao_valor);
        const baseComissaoConfiavel = comissaoFornecedorTotal > 0;
        const custoTotal = baseComissaoConfiavel
          ? Math.max(round2(valorTotal - comissaoFornecedorTotal), 0)
          : 0;

        const novaVenda = {
          id: vendaId,
          numero: vendaNumero,
          nome_negociacao: nomeNegociacao,
          data_venda: hojeISO(),
          data_acao_cliente: dataAcao,
          tipo: 'AVULSA',
          grupo_id: null,
          cliente_id: clienteId,
          vendedor_id: proposta.vendedor_id || '',
          passageiros: [{
            nome: input.nome, tipo: 'ADT', documento: '', data_nascimento: '',
            telefone: input.telefone, email: input.email,
          }],
          pagantes: [{ cliente_id: clienteId, nome: input.nome, percentual: 100, valor: valorTotal }],
          produtos: produtos.map(p => ({
            id: generateId(),
            tipo: p.tipo,
            descricao: p.descricao,
            fornecedor_id: '',
            fornecedor_nome: p.fornecedor_nome,
            data_inicio: p.data_inicio,
            data_fim: p.data_fim,
            localizador: '', cia_aerea: '', trecho: '',
            hotel_nome: '', tipo_apto: '',
            // Custo = venda - comissão declarada. Sem comissão declarada
            // permanece 0 (desconhecido), nunca "custo zero" de verdade.
            valor_custo: p.comissao_valor > 0 ? Math.max(round2(p.valor_venda - p.comissao_valor), 0) : 0,
            valor_venda: p.valor_venda,
            // comissao_fornecedor é PERCENTUAL do valor de venda do produto.
            comissao_fornecedor: p.comissao_valor > 0
              ? round2(divSegura(p.comissao_valor, p.valor_venda) * 100)
              : 0,
            moeda: 'BRL',
            cambio: 1,
            status: 'RESERVADO',
          })),
          valor_total_custo: custoTotal,
          valor_total_venda: valorTotal,
          markup_realizado: 0, desconto: 0,
          valor_final: valorTotal,
          // Extensões JSONB lidas pelo cálculo de comissão do vendedor.
          receita_agencia_estimada: comissaoFornecedorTotal,
          base_comissao_confiavel: baseComissaoConfiavel,
          forma_pagamento: 'AVISTA_PIX', parcelas: 1, pagamento_detalhado: [],
          status: 'ORCAMENTO',
          motivo_cancelamento: '', recibo_emitido: false,
          intermediario_id: null, comissao_intermediario: 0,
          centro_custo: '', numero_po: '',
          anexos: [{ nome: nomeRoteiro, url: propostaUrl }],
          observacoes: baseComissaoConfiavel
            ? ''
            : 'Origem proposta pública: custo de fornecedor não informado. Preencher custo/comissão antes de calcular a comissão do vendedor.',
          campos_personalizados: {
            origem: 'proposta_publica',
            tipo_acao: input.tipo,
            proposta_id: propostaId,
            proposta_url: propostaUrl,
          },
        };

        await client.query(
          `INSERT INTO vendas_crm (id, tenant_id, data, cliente_id, vendedor_id, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'ORCAMENTO', NOW(), NOW())`,
          [vendaId, tenantId, JSON.stringify(novaVenda), clienteId, novaVenda.vendedor_id],
        );

        // Anotacao inicial automatica
        await criarAnotacaoNegociacao({
          pool: client, tenantId,
          vendaId,
          texto: montarTextoAnotacao(input, valorTotal, produtos),
          origem: 'proposta_publica',
          tipoEvento: input.tipo,
          data: {
            proposta_id: propostaId,
            proposta_url: propostaUrl,
            nome_roteiro: nomeRoteiro,
            valor_total: valorTotal,
            produtos,
            cliente_form: { nome: input.nome, telefone: input.telefone, email: input.email },
            change_request: input.anotacao,
          },
        });

        // Tarefa inicial automatica
        tarefaId = await criarTarefaNegociacao({
          pool: client, tenantId,
          vendaId,
          clienteId,
          responsavelId: novaVenda.vendedor_id,
          titulo: montarTituloTarefa(input.tipo),
          descricao: montarDescricaoTarefa(input, valorTotal),
          prioridade: input.tipo === 'aceite' ? 'urgente' : 'alta',
          origem: 'sistema',
          data: {
            proposta_id: propostaId,
            proposta_url: propostaUrl,
            tipo_acao: input.tipo,
            cliente_form: { nome: input.nome, telefone: input.telefone, email: input.email },
          },
        });

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }

    // ============ ATUALIZA EVENTO COM IDs DO CRM ============
    await pool.query(
      `UPDATE proposta_eventos_publicos
       SET cliente_id = $1,
           crm_negotiation_id = $2,
           crm_task_id = $3,
           matched_existing_negotiation = $4,
           sync_status = 'ok',
           payload = payload || jsonb_build_object('vendaNumero', $5::text)
       WHERE id = $6`,
      [clienteId, vendaId, tarefaId, matchedExisting, vendaNumero, eventoId],
    );
  } catch (e) {
    syncStatus = 'error';
    syncError = e instanceof Error ? e.message : 'Erro desconhecido';
    await pool.query(
      `UPDATE proposta_eventos_publicos
       SET sync_status = 'error', sync_error = $1
       WHERE id = $2`,
      [syncError, eventoId],
    );
  }

  return {
    eventoId,
    vendaId,
    vendaNumero,
    tarefaId,
    clienteId,
    valorTotal,
    matchedExisting,
    duplicado: false,
    syncStatus,
    syncError,
  };
}

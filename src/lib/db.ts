import { Pool } from 'pg';

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
  : null;

export default pool;

let initialized = false;

export async function initDB() {
  if (!pool || initialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grupos (
      id TEXT PRIMARY KEY,
      grp_id TEXT NOT NULL DEFAULT '',
      origem_destino TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS clientes (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      cpf_cnpj TEXT NOT NULL DEFAULT '',
      tipo TEXT NOT NULL DEFAULT 'fisica',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS fornecedores_crm (
      id TEXT PRIMARY KEY,
      nome_fantasia TEXT NOT NULL DEFAULT '',
      cnpj TEXT NOT NULL DEFAULT '',
      categoria TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS membros (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      cargo TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vendas_crm (
      id TEXT PRIMARY KEY,
      cliente_id TEXT NOT NULL DEFAULT '',
      vendedor_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'orcamento',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contas_receber (
      id TEXT PRIMARY KEY,
      venda_id TEXT NOT NULL DEFAULT '',
      cliente_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pendente',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contas_pagar (
      id TEXT PRIMARY KEY,
      fornecedor_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pendente',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS plano_contas (
      id TEXT PRIMARY KEY,
      codigo TEXT NOT NULL DEFAULT '',
      descricao TEXT NOT NULL DEFAULT '',
      tipo TEXT NOT NULL DEFAULT 'receita',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contas_bancarias (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      banco TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS centros_custo (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agencia (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cac_mensal (
      id TEXT PRIMARY KEY,
      mes TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cenarios_cac (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      mes_referencia TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transferencias (
      id TEXT PRIMARY KEY,
      conta_origem_id TEXT NOT NULL DEFAULT '',
      conta_destino_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDENTE',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS extrato_bancario (
      id TEXT PRIMARY KEY,
      conta_bancaria_id TEXT NOT NULL DEFAULT '',
      status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS planos_comissao (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS comissoes (
      id TEXT PRIMARY KEY,
      venda_id TEXT NOT NULL DEFAULT '',
      vendedor_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'CALCULADA',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS metas (
      id TEXT PRIMARY KEY,
      vendedor_id TEXT NOT NULL DEFAULT '',
      mes_referencia TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS propostas (
      id TEXT PRIMARY KEY,
      numero TEXT NOT NULL DEFAULT '',
      cliente_id TEXT NOT NULL DEFAULT '',
      vendedor_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'RASCUNHO',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS templates_proposta (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL DEFAULT '',
      acao TEXT NOT NULL DEFAULT '',
      modulo TEXT NOT NULL DEFAULT '',
      entidade TEXT NOT NULL DEFAULT '',
      entidade_id TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS api_cache (
      key TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      calls_saved INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS voos_monitorados (
      id TEXT PRIMARY KEY,
      grupo_id TEXT NOT NULL DEFAULT '',
      cia TEXT NOT NULL DEFAULT '',
      numero_voo TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS config_apis (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS destinos (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      pais TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS crm_config (
      id TEXT PRIMARY KEY DEFAULT 'singleton',
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS crm_eventos_saida (
      id TEXT PRIMARY KEY,
      tipo TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDENTE',
      tentativas INTEGER NOT NULL DEFAULT 0,
      proxima_tentativa TIMESTAMPTZ,
      latencia_ms INTEGER,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS crm_eventos_entrada (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL DEFAULT '',
      tipo TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'RECEBIDO',
      processado BOOLEAN NOT NULL DEFAULT false,
      erro TEXT,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS planejamento_custos (
      id TEXT PRIMARY KEY,
      mes TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orcamentos (
      id TEXT PRIMARY KEY,
      numero TEXT NOT NULL DEFAULT '',
      cliente_id TEXT NOT NULL DEFAULT '',
      grupo_id TEXT NOT NULL DEFAULT '',
      proposta_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'RASCUNHO',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS planejamento_projetos (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planejando',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS fluxograma_categorias (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      ordem INTEGER NOT NULL DEFAULT 0,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS fluxogramas (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      categoria_id TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cartoes_corp (
      id TEXT PRIMARY KEY,
      apelido TEXT NOT NULL DEFAULT '',
      bandeira TEXT NOT NULL DEFAULT '',
      ativo BOOLEAN NOT NULL DEFAULT true,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS funis (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'rascunho',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS funis_simulacoes (
      id TEXT PRIMARY KEY,
      funil_id TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS funis_templates (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      categoria TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS itens_venda (
      id TEXT PRIMARY KEY,
      venda_id TEXT NOT NULL DEFAULT '',
      fornecedor_id TEXT NOT NULL DEFAULT '',
      sequencia INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'ativo',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notificacoes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      tipo TEXT NOT NULL DEFAULT '',
      titulo TEXT NOT NULL DEFAULT '',
      descricao TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL DEFAULT '',
      vendedor_id TEXT NOT NULL DEFAULT '',
      lida BOOLEAN NOT NULL DEFAULT FALSE,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Eventos da proposta publica (aceite/solicitacao alteracao).
    -- Persistencia LOCAL do evento, independente da sincronizacao com CRM.
    -- Garante que mesmo se a integracao falhar o envio do cliente esta salvo.
    CREATE TABLE IF NOT EXISTS proposta_eventos_publicos (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      proposta_id TEXT NOT NULL,
      proposta_url TEXT NOT NULL DEFAULT '',
      action_type TEXT NOT NULL,            -- 'aceite' | 'alteracao'
      customer_name TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL DEFAULT '',
      customer_email TEXT NOT NULL DEFAULT '',
      change_request_text TEXT,
      cliente_id TEXT,
      crm_negotiation_id TEXT,              -- vendas_crm.id (existente ou criada)
      crm_task_id TEXT,
      matched_existing_negotiation BOOLEAN NOT NULL DEFAULT FALSE,
      request_id TEXT NOT NULL DEFAULT '',  -- idempotencia client-side
      sync_status TEXT NOT NULL DEFAULT 'ok',  -- 'ok' | 'pending' | 'error'
      sync_error TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Anotacoes vinculadas a uma negociacao (vendas_crm).
    -- Origem: 'sistema' (auto gerada), 'manual' (vendedor escreveu).
    CREATE TABLE IF NOT EXISTS negociacao_anotacoes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      venda_id TEXT NOT NULL,
      autor_id TEXT NOT NULL DEFAULT '',
      autor_nome TEXT NOT NULL DEFAULT '',
      texto TEXT NOT NULL,
      origem TEXT NOT NULL DEFAULT 'manual',
      tipo_evento TEXT,                     -- 'aceite' | 'alteracao' | NULL
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Tarefas vinculadas a uma negociacao (vendas_crm) ou cliente.
    CREATE TABLE IF NOT EXISTS negociacao_tarefas (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      venda_id TEXT,
      cliente_id TEXT,
      responsavel_id TEXT NOT NULL DEFAULT '',
      titulo TEXT NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pendente',  -- 'pendente' | 'em_andamento' | 'concluida' | 'cancelada'
      prioridade TEXT NOT NULL DEFAULT 'normal', -- 'baixa' | 'normal' | 'alta' | 'urgente'
      origem TEXT NOT NULL DEFAULT 'manual',    -- 'manual' | 'sistema' (auto)
      data_vencimento DATE,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    -- Indices para eventos publicos
    CREATE INDEX IF NOT EXISTS idx_prop_eventos_pub_tenant_proposta
      ON proposta_eventos_publicos(tenant_id, proposta_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prop_eventos_pub_request
      ON proposta_eventos_publicos(proposta_id, request_id)
      WHERE request_id <> '';
    CREATE INDEX IF NOT EXISTS idx_prop_eventos_pub_sync
      ON proposta_eventos_publicos(sync_status, created_at)
      WHERE sync_status <> 'ok';

    -- Indices para anotacoes
    CREATE INDEX IF NOT EXISTS idx_neg_anotacoes_venda
      ON negociacao_anotacoes(venda_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_neg_anotacoes_tenant
      ON negociacao_anotacoes(tenant_id, created_at DESC);

    -- Indices para tarefas
    CREATE INDEX IF NOT EXISTS idx_neg_tarefas_venda
      ON negociacao_tarefas(venda_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_neg_tarefas_responsavel
      ON negociacao_tarefas(responsavel_id, status, data_vencimento);
    CREATE INDEX IF NOT EXISTS idx_neg_tarefas_tenant
      ON negociacao_tarefas(tenant_id, status, created_at DESC);

    -- Indices auxiliares pra busca por telefone/email em vendas_crm e clientes
    -- (telefone normalizado: so digitos). Usados na busca de negociacao ativa.
    CREATE INDEX IF NOT EXISTS idx_clientes_email_lower
      ON clientes (tenant_id, (LOWER(COALESCE(data->>'email', ''))));
    CREATE INDEX IF NOT EXISTS idx_vendas_crm_cliente_status
      ON vendas_crm (tenant_id, cliente_id, status);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notificacoes_tenant_lida_data ON notificacoes(tenant_id, lida, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notificacoes_vendedor ON notificacoes(vendedor_id);
  `);

  // Create indices for new tables (IF NOT EXISTS prevents errors on re-run)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_crm_eventos_saida_tipo ON crm_eventos_saida(tipo);
    CREATE INDEX IF NOT EXISTS idx_crm_eventos_saida_status ON crm_eventos_saida(status);
    CREATE INDEX IF NOT EXISTS idx_crm_eventos_saida_proxima ON crm_eventos_saida(proxima_tentativa);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_eventos_entrada_idem ON crm_eventos_entrada(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_crm_eventos_entrada_tipo ON crm_eventos_entrada(tipo);
    CREATE INDEX IF NOT EXISTS idx_crm_eventos_entrada_proc ON crm_eventos_entrada(processado);
    -- NOTE: o índice único em planejamento_custos é (tenant_id, mes) — criado mais abaixo
    -- após o ALTER TABLE que adiciona tenant_id. Não criar UNIQUE em mes apenas, pois
    -- duplicatas entre tenants quebram initDB() e impedem login.
    CREATE INDEX IF NOT EXISTS idx_planejamento_projetos_nome ON planejamento_projetos(nome);
    CREATE INDEX IF NOT EXISTS idx_planejamento_projetos_status ON planejamento_projetos(status);
    CREATE INDEX IF NOT EXISTS idx_fluxograma_categorias_ordem ON fluxograma_categorias(ordem);
    CREATE INDEX IF NOT EXISTS idx_fluxogramas_categoria ON fluxogramas(categoria_id);
    CREATE INDEX IF NOT EXISTS idx_fluxogramas_nome ON fluxogramas(nome);
    CREATE INDEX IF NOT EXISTS idx_funis_nome ON funis(nome);
    CREATE INDEX IF NOT EXISTS idx_funis_status ON funis(status);
    CREATE INDEX IF NOT EXISTS idx_funis_simulacoes_funil ON funis_simulacoes(funil_id);
    CREATE INDEX IF NOT EXISTS idx_funis_templates_categoria ON funis_templates(categoria);
    CREATE INDEX IF NOT EXISTS idx_itens_venda_venda ON itens_venda(venda_id);
  `);

  // ============================================================
  // MULTI-TENANT TABLES
  // ============================================================
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL DEFAULT '',
      cnpj TEXT NOT NULL DEFAULT '',
      plano TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'ativo',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
    CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

    CREATE TABLE IF NOT EXISTS super_admins (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL DEFAULT '',
      nome TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tenant_usage (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      mes TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Planos do SaaS (Basic, Founder, Founder Pro). Editaveis no
    -- /admin/planos pra ajustar preco/limites/features sem deploy.
    -- slug e a referencia estavel usada em tenants.plano.
    CREATE TABLE IF NOT EXISTS planos (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL DEFAULT '',
      descricao TEXT NOT NULL DEFAULT '',
      preco_mensal NUMERIC(10, 2) NOT NULL DEFAULT 0,
      preco_anual NUMERIC(10, 2) NOT NULL DEFAULT 0,
      moeda TEXT NOT NULL DEFAULT 'BRL',
      destaque BOOLEAN NOT NULL DEFAULT FALSE,
      ordem INTEGER NOT NULL DEFAULT 0,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      limites JSONB NOT NULL DEFAULT '{}'::jsonb,
      features JSONB NOT NULL DEFAULT '[]'::jsonb,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Assinaturas — relacao tenant -> plano + status + datas. Permite
    -- historico (suspensoes, mudanca de plano). Status: trial, ativa,
    -- suspensa, cancelada, inadimplente.
    CREATE TABLE IF NOT EXISTS assinaturas (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      plano_slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'trial',
      trial_ends_at TIMESTAMPTZ,
      ciclo TEXT NOT NULL DEFAULT 'mensal',
      proxima_cobranca DATE,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_super_admins_email ON super_admins(email);
    CREATE INDEX IF NOT EXISTS idx_tenant_usage_tenant ON tenant_usage(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_planos_ordem ON planos(ordem) WHERE ativo = TRUE;
    CREATE INDEX IF NOT EXISTS idx_assinaturas_tenant ON assinaturas(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_assinaturas_trial ON assinaturas(trial_ends_at) WHERE status = 'trial';
  `);

  // Seed dos planos padrao (idempotente — ON CONFLICT DO NOTHING).
  // Precos sao PLACEHOLDERS que o user edita em /admin/planos.
  await pool.query(`
    INSERT INTO planos (id, slug, nome, descricao, preco_mensal, preco_anual, moeda, destaque, ordem, ativo, limites, features)
    VALUES
      ('plano-basic', 'basic', 'Basic', 'Para agências que estão começando.',
        97, 970, 'BRL', FALSE, 1, TRUE,
        '{"usuarios": 3, "propostas_mes": 50, "grupos": 10, "ai_enabled": false, "white_label": false}'::jsonb,
        '["Até 3 usuários", "50 propostas/mês", "Hub de viagens", "Templates prontos", "Suporte por email"]'::jsonb
      ),
      ('plano-founder', 'founder', 'Founder', 'Para agências em crescimento que precisam de mais ferramentas.',
        197, 1970, 'BRL', TRUE, 2, TRUE,
        '{"usuarios": 10, "propostas_mes": 200, "grupos": 50, "ai_enabled": true, "white_label": false}'::jsonb,
        '["Até 10 usuários", "200 propostas/mês", "Geração com IA (Claude)", "CRM completo", "Funis e campanhas", "API de hotéis e voos", "Suporte prioritário"]'::jsonb
      ),
      ('plano-founder-pro', 'founder-pro', 'Founder Pro', 'Para agências consolidadas com alto volume e necessidade de white-label.',
        397, 3970, 'BRL', FALSE, 3, TRUE,
        '{"usuarios": -1, "propostas_mes": -1, "grupos": -1, "ai_enabled": true, "white_label": true}'::jsonb,
        '["Usuários ilimitados", "Propostas ilimitadas", "Geração com IA (Claude)", "CRM completo + automações", "Domínio personalizado nas propostas", "White-label completo", "Suporte dedicado", "Onboarding 1-a-1"]'::jsonb
      )
    ON CONFLICT (id) DO NOTHING;
  `);

  // Bruno como super admin (idempotente). Cobre o caso de tenant
  // existente sem o owner Bruno cadastrado.
  if (process.env.SUPER_ADMIN_EMAIL || true) {
    const email = (process.env.SUPER_ADMIN_EMAIL || 'bruno@entur.com.br').toLowerCase();
    const senhaHash = process.env.SUPER_ADMIN_PASSWORD_HASH || '';
    // Idempotente: nao sobrescreve senha se ja existe.
    await pool.query(
      `INSERT INTO super_admins (id, email, nome, data)
       VALUES ('super-bruno', $1, 'Bruno Barbosa',
         jsonb_build_object('senha_hash', $2, 'ativo', true))
       ON CONFLICT (id) DO NOTHING`,
      [email, senhaHash],
    );
  }

  // ============================================================
  // GESTÃO DE GRUPOS — vagas, reservas e materiais por grupo
  // ============================================================
  // Criadas automaticamente quando um grupo é criado (trigger em
  // /api/grupos POST). Mantêm os contadores de vagas calculados a
  // partir das reservas (não editar manualmente).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gestao_grupos (
      id TEXT PRIMARY KEY,
      grupo_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ativo',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gestao_grupos_grupo ON gestao_grupos(grupo_id);

    CREATE TABLE IF NOT EXISTS grupo_periodos_vagas (
      id TEXT PRIMARY KEY,
      grupo_id TEXT NOT NULL DEFAULT '',
      periodo_index INTEGER NOT NULL DEFAULT 0,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_grupo_periodos_vagas_grupo ON grupo_periodos_vagas(grupo_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grupo_periodos_vagas_grupo_idx
      ON grupo_periodos_vagas(grupo_id, periodo_index);

    CREATE TABLE IF NOT EXISTS grupo_reservas (
      id TEXT PRIMARY KEY,
      grupo_id TEXT NOT NULL DEFAULT '',
      periodo_id TEXT NOT NULL DEFAULT '',
      cliente_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'reservado',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_grupo_reservas_grupo ON grupo_reservas(grupo_id);
    CREATE INDEX IF NOT EXISTS idx_grupo_reservas_periodo ON grupo_reservas(periodo_id);
    CREATE INDEX IF NOT EXISTS idx_grupo_reservas_cliente ON grupo_reservas(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_grupo_reservas_status ON grupo_reservas(status);

    CREATE TABLE IF NOT EXISTS grupo_materiais (
      id TEXT PRIMARY KEY,
      grupo_id TEXT NOT NULL DEFAULT '',
      tipo TEXT NOT NULL DEFAULT 'arquivo',
      nome TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_grupo_materiais_grupo ON grupo_materiais(grupo_id);
    CREATE INDEX IF NOT EXISTS idx_grupo_materiais_tipo ON grupo_materiais(tipo);

    -- Passageiros (Fase B) — entidade própria por reserva.
    -- Cada reserva pode ter N passageiros. O responsável financeiro
    -- continua sendo o cliente da reserva (cliente_id). Os passageiros
    -- são as pessoas que efetivamente viajam (podem ser diferentes do
    -- contratante).
    CREATE TABLE IF NOT EXISTS grupo_passageiros (
      id TEXT PRIMARY KEY,
      grupo_id TEXT NOT NULL DEFAULT '',
      reserva_id TEXT NOT NULL DEFAULT '',
      nome_completo TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_grupo_passageiros_grupo ON grupo_passageiros(grupo_id);
    CREATE INDEX IF NOT EXISTS idx_grupo_passageiros_reserva ON grupo_passageiros(reserva_id);
    CREATE INDEX IF NOT EXISTS idx_grupo_passageiros_nome ON grupo_passageiros(nome_completo);

    -- Quartos (Fase E) — rooming list por grupo. Cada quarto tem
    -- capacidade e tipo de acomodação. Passageiros são alocados via
    -- campo quarto_id em grupo_passageiros.data.
    CREATE TABLE IF NOT EXISTS grupo_quartos (
      id TEXT PRIMARY KEY,
      grupo_id TEXT NOT NULL DEFAULT '',
      numero TEXT NOT NULL DEFAULT '',
      tipo_acomodacao TEXT NOT NULL DEFAULT 'DBL_CASAL',
      capacidade INTEGER NOT NULL DEFAULT 2,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_grupo_quartos_grupo ON grupo_quartos(grupo_id);

    -- Documentos por passageiro (Fase E). Cada passageiro pode ter
    -- múltiplos documentos (RG, CPF, passaporte, autorização menor,
    -- etc.) com status de validação independente.
    CREATE TABLE IF NOT EXISTS grupo_documentos (
      id TEXT PRIMARY KEY,
      grupo_id TEXT NOT NULL DEFAULT '',
      passageiro_id TEXT NOT NULL DEFAULT '',
      tipo TEXT NOT NULL DEFAULT 'outros',
      status TEXT NOT NULL DEFAULT 'pendente',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_grupo_documentos_grupo ON grupo_documentos(grupo_id);
    CREATE INDEX IF NOT EXISTS idx_grupo_documentos_passageiro ON grupo_documentos(passageiro_id);
    CREATE INDEX IF NOT EXISTS idx_grupo_documentos_status ON grupo_documentos(status);

    -- Tarefas operacionais (Fase F) — checklist por grupo com prazo,
    -- prioridade, responsável.
    CREATE TABLE IF NOT EXISTS grupo_tarefas (
      id TEXT PRIMARY KEY,
      grupo_id TEXT NOT NULL DEFAULT '',
      tipo TEXT NOT NULL DEFAULT 'outros',
      status TEXT NOT NULL DEFAULT 'pendente',
      prioridade TEXT NOT NULL DEFAULT 'media',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_grupo_tarefas_grupo ON grupo_tarefas(grupo_id);
    CREATE INDEX IF NOT EXISTS idx_grupo_tarefas_status ON grupo_tarefas(status);
    CREATE INDEX IF NOT EXISTS idx_grupo_tarefas_prioridade ON grupo_tarefas(prioridade);

    -- Histórico de eventos (Fase F) — timeline imutável de mudanças no
    -- grupo. Quem fez, quando, o que mudou. Não usa audit_log existente
    -- pra manter contexto rico (entidade, dados antes/depois).
    CREATE TABLE IF NOT EXISTS grupo_eventos (
      id TEXT PRIMARY KEY,
      grupo_id TEXT NOT NULL DEFAULT '',
      tipo TEXT NOT NULL DEFAULT 'outros',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_grupo_eventos_grupo ON grupo_eventos(grupo_id);
    CREATE INDEX IF NOT EXISTS idx_grupo_eventos_created ON grupo_eventos(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_grupo_eventos_tipo ON grupo_eventos(tipo);
  `);

  // ============================================================
  // ADD tenant_id TO ALL EXISTING TABLES
  // ============================================================
  const TENANT_TABLES = [
    'grupos', 'clientes', 'fornecedores_crm', 'membros', 'vendas_crm',
    'contas_receber', 'contas_pagar', 'plano_contas', 'contas_bancarias',
    'centros_custo', 'agencia', 'usuarios', 'cac_mensal', 'cenarios_cac',
    'transferencias', 'extrato_bancario', 'planos_comissao', 'comissoes',
    'metas', 'propostas', 'templates_proposta', 'audit_log', 'api_cache',
    'voos_monitorados', 'config_apis', 'destinos', 'crm_config',
    'crm_eventos_saida', 'crm_eventos_entrada', 'planejamento_custos',
    'orcamentos', 'planejamento_projetos',
    'fluxograma_categorias', 'fluxogramas',
    'cartoes_corp',
    'funis', 'funis_simulacoes', 'funis_templates',
    'itens_venda',
    'gestao_grupos', 'grupo_periodos_vagas', 'grupo_reservas', 'grupo_materiais',
    'grupo_passageiros', 'grupo_quartos', 'grupo_documentos',
    'grupo_tarefas', 'grupo_eventos',
  ];

  // ============================================================
  // contas_receber / contas_pagar — coluna escalar grupo_id
  // ============================================================
  // Adiciona coluna grupo_id em contas_receber e contas_pagar para
  // permitir queries indexadas filtrando pelo grupo. Faz backfill a
  // partir do JSONB data->>grupo_id (preenchido pelo /confirmar).
  // Aditivo: não remove nada.
  await pool.query(`
    ALTER TABLE contas_receber ADD COLUMN IF NOT EXISTS grupo_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE contas_pagar   ADD COLUMN IF NOT EXISTS grupo_id TEXT NOT NULL DEFAULT '';
    UPDATE contas_receber
       SET grupo_id = COALESCE(data->>'grupo_id', '')
     WHERE grupo_id = '' AND (data->>'grupo_id') IS NOT NULL AND (data->>'grupo_id') <> '';
    UPDATE contas_pagar
       SET grupo_id = COALESCE(data->>'grupo_id', '')
     WHERE grupo_id = '' AND (data->>'grupo_id') IS NOT NULL AND (data->>'grupo_id') <> '';
    CREATE INDEX IF NOT EXISTS idx_contas_receber_grupo ON contas_receber(grupo_id) WHERE grupo_id <> '';
    CREATE INDEX IF NOT EXISTS idx_contas_pagar_grupo   ON contas_pagar(grupo_id)   WHERE grupo_id <> '';
  `);
  for (const table of TENANT_TABLES) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT ''`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table}(tenant_id)`);
  }

  // ============================================================
  // CRM INTEGRATION — external_id for idempotent upsert by CRM ID
  // ============================================================
  // Enables receiving "crm_contact_123" / "crm_user_45" / "crm_supplier_22"
  // from the CRM and resolving them to internal IDs without duplicating.
  await pool.query(`
    ALTER TABLE clientes ADD COLUMN IF NOT EXISTS external_id TEXT;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS external_id TEXT;
    ALTER TABLE fornecedores_crm ADD COLUMN IF NOT EXISTS external_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_external_id
      ON clientes(tenant_id, external_id) WHERE external_id IS NOT NULL AND external_id <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_external_id
      ON usuarios(tenant_id, external_id) WHERE external_id IS NOT NULL AND external_id <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fornecedores_crm_external_id
      ON fornecedores_crm(tenant_id, external_id) WHERE external_id IS NOT NULL AND external_id <> '';
    -- CNPJ dedupe so the CRM and Financeiro recognize the same supplier
    -- across systems even if the CRM's internal id changes (resync, merge,
    -- etc.). Stores cnpj as digits-only.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fornecedores_crm_cnpj
      ON fornecedores_crm(tenant_id, cnpj) WHERE cnpj IS NOT NULL AND cnpj <> '';
  `);

  // ============================================================
  // crm_config — composite PK (id, tenant_id)
  // ============================================================
  // The original PK was just `id` (with DEFAULT 'singleton'), which
  // physically allowed only one row in the whole DB. Multi-tenant
  // integration requires one config per tenant, so we promote the PK.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'crm_config'::regclass
          AND contype = 'p'
          AND pg_get_constraintdef(oid) NOT LIKE '%tenant_id%'
      ) THEN
        ALTER TABLE crm_config DROP CONSTRAINT crm_config_pkey;
        ALTER TABLE crm_config ADD PRIMARY KEY (id, tenant_id);
      END IF;
    END
    $$;
  `);

  // Drop the old unique constraint on planejamento_custos(mes) — now needs (tenant_id, mes)
  await pool.query(`DROP INDEX IF EXISTS idx_planejamento_custos_mes`);
  // Deduplicate planejamento_custos before creating the composite unique index.
  // Keep only the row with the highest updated_at per (tenant_id, mes); fallback to id as tiebreaker.
  await pool.query(`
    DELETE FROM planejamento_custos a USING planejamento_custos b
    WHERE a.tenant_id IS NOT DISTINCT FROM b.tenant_id
      AND a.mes IS NOT DISTINCT FROM b.mes
      AND (a.updated_at < b.updated_at OR (a.updated_at = b.updated_at AND a.id < b.id))
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_planejamento_custos_tenant_mes ON planejamento_custos(tenant_id, mes)`);

  // Run multi-tenant migration (assign existing data to default tenant)
  const { migrateToMultiTenant } = await import('./migrate-multitenant');
  await migrateToMultiTenant();

  // Seed dos 6 templates de funis (idempotente via WHERE NOT EXISTS por id fixo).
  // Templates são globais (tenant_id = '') para aparecer em qualquer tenant.
  const { FUNIL_TEMPLATES_SEED } = await import('./funil-templates-seed');
  for (const tpl of FUNIL_TEMPLATES_SEED) {
    await pool.query(
      `INSERT INTO funis_templates (id, nome, categoria, data, tenant_id, created_at)
       SELECT $1, $2, $3, $4::jsonb, '', NOW()
       WHERE NOT EXISTS (SELECT 1 FROM funis_templates WHERE id = $1)`,
      [tpl.id, tpl.nome, tpl.categoria, JSON.stringify(tpl)],
    );
  }

  initialized = true;
}

# Relatorio Completo do Sistema — Entur OS

> Documento de referencia para treinamento de IA. Gerado em 2026-04-03.
> Projeto: **Entur OS** (grupos-os)
> Stack: Next.js 16.2.2 + React 19 + TypeScript + Tailwind CSS v4 + PostgreSQL + Shadcn/ui

---

## 1. VISAO GERAL DO SISTEMA

**Entur OS** e um sistema completo de gestao para agencias de viagens e comercio exterior. Cobre desde o planejamento de custos ate o controle financeiro, passando por metas comerciais e criacao de produtos/propostas.

### Arquitetura
- **Frontend**: Next.js 16.2.2 App Router (React 19, TypeScript, Tailwind v4, Shadcn/ui)
- **Backend**: API Routes do Next.js (server-side)
- **Banco de Dados**: PostgreSQL via driver `pg` (connection pool, max 5 conexoes)
- **Autenticacao**: JWT via cookies httpOnly (`jose` library)
- **Deploy**: Docker standalone no Coolify (servidor `187.127.6.135:8000`)
- **Repositorio**: `github.com/papodeagente/financeiro-os.git`

### Navegacao — 4 Pilares
O sistema e organizado em 4 pilares que refletem o fluxo do negocio:

```
PLANEJAMENTO → METAS → PRODUTOS → FINANCEIRO
```

Layout: **Top Rail (48px)** horizontal no topo + **Sidebar Contextual (232px)** que muda conforme o pilar ativo.

```
┌─────────────────────────────────────────────────────┐
│ [E] Entur OS    [PLANEJ.] [METAS] [PROD.] [FIN.]  ⚙ 🌙 👤 │  ← Top Rail
├──────────┬──────────────────────────────────────────┤
│ Sidebar  │          Content Area                    │
│ contextual│                                         │
│ (232px)  │                                          │
├──────────┴──────────────────────────────────────────┤
```

### Mapeamento de Rotas → Pilares

| Prefixo da Rota | Pilar |
|---|---|
| `/cac/*` | Planejamento |
| `/planejamento/*` | Planejamento |
| `/dashboard` | Metas |
| `/equipe/*` | Metas |
| `/grupos`, `/grupo/*` | Produtos |
| `/propostas/*` | Produtos |
| `/vendas/orcamentos`, `/vendas/nova-orcamento` | Produtos |
| `/voos`, `/hoteis`, `/destinos` | Produtos |
| `/financeiro*` | Financeiro |
| `/vendas` (exceto orcamentos) | Financeiro |
| `/pessoas/*` | Financeiro |
| `/relatorios/*` | Financeiro |
| `/config/*` | Nenhum pilar (pagina avulsa) |
| `/login`, `/p/*` | Sem shell (paginas publicas) |

---

## 2. ESTRUTURA DE ARQUIVOS

```
grupos-os/
├── Dockerfile                    # Build multi-stage Docker
├── package.json                  # Dependencias e scripts
├── next.config.ts                # output: 'standalone', pg externo
├── tsconfig.json                 # strict, paths @/* → ./src/*
├── components.json               # Shadcn/ui config (base-nova)
├── postcss.config.mjs            # @tailwindcss/postcss v4
├── eslint.config.mjs             # next core-web-vitals + typescript
│
├── src/
│   ├── middleware.ts              # Auth JWT, rotas publicas
│   │
│   ├── app/
│   │   ├── layout.tsx             # Root layout (Inter font, ThemeProvider, AuthProvider, AppShell)
│   │   ├── page.tsx               # Redirect → /dashboard
│   │   ├── globals.css            # Tokens CSS (light/dark), animacoes, scrollbar
│   │   │
│   │   ├── login/page.tsx
│   │   ├── dashboard/page.tsx
│   │   │
│   │   ├── grupos/page.tsx                    # Lista de grupos
│   │   ├── grupo/[id]/page.tsx                # Editor de grupo (12 abas)
│   │   │
│   │   ├── propostas/
│   │   │   ├── page.tsx                       # Lista de propostas
│   │   │   ├── nova/page.tsx                  # Wizard nova proposta
│   │   │   ├── [id]/page.tsx                  # Editor de proposta
│   │   │   └── analytics/page.tsx             # Analytics de propostas
│   │   │
│   │   ├── p/[slug]/page.tsx                  # Preview publico da proposta
│   │   │
│   │   ├── vendas/
│   │   │   ├── page.tsx                       # Lista de vendas
│   │   │   ├── nova/page.tsx                  # Nova venda
│   │   │   └── orcamentos/page.tsx            # Orcamentos
│   │   │
│   │   ├── financeiro-ag/
│   │   │   ├── fluxo-caixa/page.tsx
│   │   │   ├── dre/page.tsx
│   │   │   ├── conciliacao/page.tsx
│   │   │   ├── receber/page.tsx
│   │   │   ├── pagar/page.tsx
│   │   │   ├── plano-contas/page.tsx
│   │   │   ├── contas-bancarias/page.tsx
│   │   │   └── transferencias/page.tsx
│   │   │
│   │   ├── financeiro-grupos/page.tsx         # Financeiro por grupo
│   │   ├── financeiro/[id]/[tab]/page.tsx     # Financeiro detalhe
│   │   │
│   │   ├── pessoas/
│   │   │   ├── page.tsx                       # Redirect → clientes
│   │   │   ├── clientes/page.tsx
│   │   │   ├── fornecedores/page.tsx
│   │   │   └── equipe/page.tsx
│   │   │
│   │   ├── equipe/
│   │   │   ├── metas/page.tsx
│   │   │   ├── comissoes/page.tsx
│   │   │   └── planos-comissao/page.tsx
│   │   │
│   │   ├── cac/
│   │   │   ├── dashboard/page.tsx
│   │   │   └── cenarios/page.tsx
│   │   │
│   │   ├── relatorios/
│   │   │   ├── financeiro/page.tsx
│   │   │   ├── rentabilidade/page.tsx
│   │   │   └── comparativo/page.tsx
│   │   │
│   │   ├── hoteis/page.tsx
│   │   ├── voos/page.tsx                      # Busca de voos (Amadeus)
│   │   ├── destinos/page.tsx                  # Banco de destinos
│   │   │
│   │   ├── config/
│   │   │   ├── agencia/page.tsx
│   │   │   └── usuarios/page.tsx
│   │   │
│   │   ├── planejamento/
│   │   │   ├── custos/page.tsx                # Placeholder — Em breve
│   │   │   └── projetos/page.tsx              # Placeholder — Em breve
│   │   │
│   │   └── api/                               # 67 API routes (detalhadas abaixo)
│   │
│   ├── components/
│   │   ├── AppShell.tsx                       # Layout principal (TopRail + PillarSidebar + Content)
│   │   ├── TopRail.tsx                        # Barra horizontal 48px com 4 pilares
│   │   ├── PillarSidebar.tsx                  # Sidebar contextual por pilar
│   │   ├── AppSidebar.tsx                     # Sidebar antigo (backup, nao importado)
│   │   ├── FloatingResume.tsx                 # Resumo flutuante de calculos
│   │   ├── MoneyInput.tsx                     # Input monetario BRL
│   │   ├── AirportInput.tsx                   # Autocomplete de aeroportos
│   │   ├── FlightSearchModal.tsx              # Modal busca voos
│   │   ├── HotelSearchModal.tsx               # Modal busca hoteis
│   │   │
│   │   ├── ui/                                # Shadcn/ui components
│   │   │   ├── badge.tsx, button.tsx, card.tsx, dialog.tsx
│   │   │   ├── input.tsx, label.tsx, select.tsx, separator.tsx
│   │   │   ├── sheet.tsx, table.tsx, tabs.tsx, textarea.tsx
│   │   │   ├── tooltip.tsx, alert.tsx, scroll-area.tsx
│   │   │
│   │   ├── tabs/                              # Abas do editor de grupo
│   │   │   ├── InfTab.tsx                     # Info geral
│   │   │   ├── TktTab.tsx                     # Aereo
│   │   │   ├── HtlTab.tsx                     # Hotelaria
│   │   │   ├── RecTab.tsx                     # Receptivo/passeios
│   │   │   ├── CarTab.tsx                     # Transporte
│   │   │   ├── GuiaTab.tsx                    # Guias
│   │   │   ├── SegTab.tsx                     # Seguro viagem
│   │   │   ├── NavioTab.tsx                   # Cruzeiros
│   │   │   ├── IngTab.tsx                     # Ingressos
│   │   │   ├── BrindeTab.tsx                  # Brindes
│   │   │   ├── PropostaTab.tsx                # Gerar proposta
│   │   │   ├── HtlSegTab.tsx                  # Hotel + Seguro combinado
│   │   │   └── financial/                     # Abas financeiras do grupo
│   │   │       ├── PainelTab.tsx, VendasTab.tsx, RecebimentosTab.tsx
│   │   │       ├── FornecedoresTab.tsx, FluxoCaixaTab.tsx
│   │   │       ├── DRETab.tsx, IndicadoresTab.tsx
│   │   │
│   │   └── propostas/                         # Sistema de propostas
│   │       ├── PropostaEditor.tsx             # Editor principal
│   │       ├── PropostaSidebar.tsx            # Sidebar do editor
│   │       ├── BlockRenderer.tsx              # Renderizador de blocos
│   │       ├── BlockToolbar.tsx               # Toolbar de blocos
│   │       ├── RichTextEditor.tsx             # Editor WYSIWYG (TipTap)
│   │       ├── ImageUpload.tsx                # Upload de imagens
│   │       ├── DestinoAutocomplete.tsx        # Autocomplete destinos
│   │       ├── DestinoQuickFill.tsx           # Preenchimento rapido
│   │       ├── MapaRoteiro.tsx                # Mapa de roteiro
│   │       ├── MapaRoteiroInterno.tsx         # Mapa interno
│   │       │
│   │       ├── blocks/                        # Tipos de bloco
│   │       │   ├── TextoBlock.tsx             # Texto livre
│   │       │   ├── VideoBlock.tsx             # Video embed
│   │       │   ├── GaleriaBlock.tsx           # Galeria de fotos
│   │       │   ├── RoteiroDiaBlock.tsx        # Roteiro dia-a-dia
│   │       │   ├── MapaBlock.tsx              # Mapa
│   │       │   ├── FAQBlock.tsx               # Perguntas frequentes
│   │       │   ├── CountdownBlock.tsx         # Contagem regressiva
│   │       │   ├── AlojamentoBlock.tsx        # Hospedagem
│   │       │   ├── TransporteBlock.tsx        # Transporte
│   │       │   ├── ServicoBlock.tsx           # Servicos
│   │       │   ├── InclusosBlock.tsx          # O que esta incluso
│   │       │   ├── ValoresBlock.tsx           # Valores/precos
│   │       │   ├── DepoimentoBlock.tsx        # Depoimentos
│   │       │   ├── CtaBlock.tsx               # Call-to-action
│   │       │   └── types.ts                   # Tipos dos blocos
│   │       │
│   │       └── preview/                       # Preview publico
│   │           ├── PreviewRenderer.tsx         # Renderizador classico
│   │           ├── DiscoveryRenderer.tsx       # Layout Discovery (moderno)
│   │           ├── CapaSection.tsx             # Capa
│   │           ├── RodapeSection.tsx           # Rodape
│   │           ├── AceitarProposta.tsx         # Aceite digital
│   │           ├── LeadCapture.tsx             # Captura de leads
│   │           ├── ChatWidget.tsx              # Chatbot IA
│   │           └── discovery/                  # Componentes Discovery
│   │               ├── DiscoveryHeader.tsx, DiscoveryHero.tsx
│   │               ├── IntroSection.tsx, AccommodationSummary.tsx
│   │               ├── TransportSummary.tsx, PricingSection.tsx
│   │               ├── RouteMap.tsx, RouteMapInterno.tsx
│   │               ├── DayEntry.tsx, DestinationBlock.tsx
│   │               ├── DiscoveryFooter.tsx, DiscoveryRenderer.tsx
│   │
│   ├── contexts/
│   │   ├── AuthContext.tsx                    # user, loading, logout, refresh
│   │   ├── AppContext.tsx                     # activeGrupoId, setActiveGrupo
│   │   └── ThemeContext.tsx                   # theme (light/dark), toggleTheme
│   │
│   ├── hooks/
│   │   └── useActivePillar.ts                # Mapa rota → pilar ativo
│   │
│   └── lib/
│       ├── db.ts                              # Pool PostgreSQL + initDB() com 27 tabelas
│       ├── auth.ts                            # Helpers de autenticacao
│       ├── crud-api.ts                        # CRUD generico para API routes
│       ├── utils.ts                           # cn(), formatBRL(), parseBRL(), generateId()
│       ├── types.ts                           # Tipos do produto (GrupoViagem, abas, servicos)
│       ├── crm-types.ts                       # Tipos CRM (Cliente, Proposta, Venda, etc.)
│       ├── financial-types.ts                 # Tipos financeiros (Venda, Parcela, DRE)
│       ├── defaults.ts                        # Fabricas de objetos padrao
│       ├── financial-defaults.ts              # Defaults financeiros
│       ├── calculations.ts                    # Calculos de precos (calcProposta)
│       ├── financial-calculations.ts          # Metricas financeiras, DRE, fluxo caixa
│       ├── storage.ts                         # Persistencia de grupos (API + localStorage)
│       ├── crm-storage.ts                     # CRUD generico para entidades CRM
│       ├── export-utils.ts                    # Exportacao CSV
│       ├── api-cache.ts                       # Cache de API no PostgreSQL
│       ├── amadeus-api.ts                     # Integracao Amadeus (voos)
│       ├── google-places-api.ts               # Integracao Google Places (hoteis)
│       ├── flight-data-mapper.ts              # Mapeamento dados de voo
│       ├── hotel-data-mapper.ts               # Mapeamento dados de hotel
│       ├── temas-proposta.ts                  # Temas visuais de proposta
│       ├── ai-prompts.ts                      # Prompts para geracao IA
│       ├── i18n-proposta.ts                   # Internacionalizacao (pt-BR, en, es)
│       └── discovery-utils.ts                 # Utilitarios layout Discovery
```

---

## 3. BANCO DE DADOS — SCHEMA COMPLETO (27 TABELAS)

### Padrao Arquitetural
Todas as tabelas seguem o mesmo padrao:
- Colunas indexadas para filtros rapidos
- Coluna `data` JSONB para dados completos do registro
- `created_at` e `updated_at` com TIMESTAMPTZ

### 3.1 grupos
Grupos de viagem (produto principal).
```sql
CREATE TABLE IF NOT EXISTS grupos (
  id TEXT PRIMARY KEY,
  grp_id TEXT NOT NULL DEFAULT '',
  origem_destino TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
**JSONB `data`** contem: `periodos[]`, `tkt` (aereo), `htl` (hotel), `rec` (receptivo), `car` (transporte), `guia`, `seg` (seguro), `navio`, `ing` (ingressos), `brinde`, `params` (markup, contrato, pagamento), `cambio`, `financeiro`.

### 3.2 clientes
```sql
CREATE TABLE IF NOT EXISTS clientes (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL DEFAULT '',
  cpf_cnpj TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'fisica',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: nome, tipo
```
**JSONB `data`**: dados PF/PJ, endereco, contato, preferencias de viagem, cartoes, anexos.

### 3.3 fornecedores_crm
```sql
CREATE TABLE IF NOT EXISTS fornecedores_crm (
  id TEXT PRIMARY KEY,
  nome_fantasia TEXT NOT NULL DEFAULT '',
  cnpj TEXT NOT NULL DEFAULT '',
  categoria TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: nome_fantasia, cnpj, categoria
```

### 3.4 membros
```sql
CREATE TABLE IF NOT EXISTS membros (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL DEFAULT '',
  cargo TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: nome, cargo, email
```

### 3.5 vendas_crm
```sql
CREATE TABLE IF NOT EXISTS vendas_crm (
  id TEXT PRIMARY KEY,
  cliente_id TEXT NOT NULL DEFAULT '',
  vendedor_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'orcamento',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: cliente_id, vendedor_id, status
```

### 3.6 contas_receber
```sql
CREATE TABLE IF NOT EXISTS contas_receber (
  id TEXT PRIMARY KEY,
  venda_id TEXT NOT NULL DEFAULT '',
  cliente_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendente',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: venda_id, cliente_id, status
```

### 3.7 contas_pagar
```sql
CREATE TABLE IF NOT EXISTS contas_pagar (
  id TEXT PRIMARY KEY,
  fornecedor_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendente',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: fornecedor_id, status
```

### 3.8 plano_contas
```sql
CREATE TABLE IF NOT EXISTS plano_contas (
  id TEXT PRIMARY KEY,
  codigo TEXT NOT NULL DEFAULT '',
  descricao TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'receita',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: codigo, descricao, tipo
```

### 3.9 contas_bancarias
```sql
CREATE TABLE IF NOT EXISTS contas_bancarias (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL DEFAULT '',
  banco TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: nome, banco
```

### 3.10 centros_custo
```sql
CREATE TABLE IF NOT EXISTS centros_custo (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.11 agencia (singleton)
```sql
CREATE TABLE IF NOT EXISTS agencia (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.12 usuarios
```sql
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: nome, email
```
**JSONB `data`**: `senha_hash`, `perfil` (ADMIN, VENDEDOR), `permissoes`.

### 3.13 cac_mensal
```sql
CREATE TABLE IF NOT EXISTS cac_mensal (
  id TEXT PRIMARY KEY,
  mes TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indice: mes
```

### 3.14 cenarios_cac
```sql
CREATE TABLE IF NOT EXISTS cenarios_cac (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL DEFAULT '',
  mes_referencia TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: nome, mes_referencia
```

### 3.15 transferencias
```sql
CREATE TABLE IF NOT EXISTS transferencias (
  id TEXT PRIMARY KEY,
  conta_origem_id TEXT NOT NULL DEFAULT '',
  conta_destino_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDENTE',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: conta_origem_id, conta_destino_id, status
```

### 3.16 extrato_bancario
```sql
CREATE TABLE IF NOT EXISTS extrato_bancario (
  id TEXT PRIMARY KEY,
  conta_bancaria_id TEXT NOT NULL DEFAULT '',
  status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: conta_bancaria_id, status_conciliacao
```

### 3.17 planos_comissao
```sql
CREATE TABLE IF NOT EXISTS planos_comissao (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indice: nome
```

### 3.18 comissoes
```sql
CREATE TABLE IF NOT EXISTS comissoes (
  id TEXT PRIMARY KEY,
  venda_id TEXT NOT NULL DEFAULT '',
  vendedor_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'CALCULADA',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: venda_id, vendedor_id, status
```

### 3.19 metas
```sql
CREATE TABLE IF NOT EXISTS metas (
  id TEXT PRIMARY KEY,
  vendedor_id TEXT NOT NULL DEFAULT '',
  mes_referencia TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: vendedor_id, mes_referencia
```

### 3.20 propostas
```sql
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
-- Indices: numero, cliente_id, vendedor_id, status
```
**Status possiveis**: RASCUNHO, ENVIADO, VISUALIZADO, ACEITO, REJEITADO.
**JSONB `data`**: `visual` (tema, cores, fontes), `secoes[]` (blocos de conteudo), `aceite` (assinatura digital), `leads[]`, `feedbacks[]`, `visualizacoes[]`.

### 3.21 templates_proposta
```sql
CREATE TABLE IF NOT EXISTS templates_proposta (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indice: nome
```
**6 templates pre-definidos**: Europa Romantica, Aventura & Natureza, Disney em Familia, Cruzeiro Maritimo, Viagem Corporativa, Praia & Relax.

### 3.22 audit_log
```sql
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
-- Indices: usuario_id, acao, modulo, entidade, entidade_id
```

### 3.23 api_cache
```sql
CREATE TABLE IF NOT EXISTS api_cache (
  key TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  calls_saved INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.24 voos_monitorados
```sql
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
```

### 3.25 config_apis (singleton)
```sql
CREATE TABLE IF NOT EXISTS config_apis (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
**JSONB `data`**: `amadeus` (api_key, api_secret, ambiente), `google_places` (api_key), `anthropic` (api_key, modelo).

### 3.26 destinos
```sql
CREATE TABLE IF NOT EXISTS destinos (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL DEFAULT '',
  pais TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: nome, pais
```
**JSONB `data`**: descricao, idioma, clima, moeda, fuso, melhor_epoca, gastronomia, dicas, fast_facts[].

---

## 4. API ROUTES COMPLETAS (67 endpoints)

### 4.1 Autenticacao

| Metodo | Rota | Descricao |
|---|---|---|
| POST | `/api/auth/login` | Login com email/senha. Retorna JWT cookie httpOnly (7 dias) |
| GET | `/api/auth/session` | Retorna sessao atual do usuario autenticado |
| POST | `/api/auth/logout` | Limpa cookie de sessao |
| POST | `/api/auth/seed` | Cria usuario admin inicial (so funciona se nenhum usuario existe) |
| POST | `/api/auth/hash-password` | Hash de senha (requer ADMIN) |

**Login request**: `{ email: string, senha: string }`
**Login response**: `{ ok: true, user: { id, nome, email, perfil, permissoes } }`
**Admin padrao**: email `admin@entur.com.br`, senha `admin123`

### 4.2 CRUD Generico (padrao repetido)

O sistema usa `createCrudHandlers` e `createCrudItemHandlers` de `src/lib/crud-api.ts` para gerar endpoints CRUD padronizados. O padrao e:

- `GET /api/{entidade}` — Lista todos os registros
- `POST /api/{entidade}` — Cria novo registro
- `GET /api/{entidade}/[id]` — Busca por ID
- `PUT /api/{entidade}/[id]` — Atualiza por ID
- `DELETE /api/{entidade}/[id]` — Remove por ID

**Entidades que seguem este padrao:**

| Rota Base | Tabela | Colunas Indexadas |
|---|---|---|
| `/api/usuarios` | usuarios | nome, email |
| `/api/clientes` | clientes | nome, cpf_cnpj, tipo |
| `/api/fornecedores-crm` | fornecedores_crm | nome_fantasia, cnpj, categoria |
| `/api/membros` | membros | nome, cargo, email |
| `/api/vendas-crm` | vendas_crm | cliente_id, vendedor_id, status |
| `/api/contas-receber` | contas_receber | venda_id, cliente_id, status |
| `/api/contas-pagar` | contas_pagar | fornecedor_id, status |
| `/api/plano-contas` | plano_contas | codigo, descricao, tipo |
| `/api/contas-bancarias` | contas_bancarias | nome, banco |
| `/api/transferencias` | transferencias | conta_origem_id, conta_destino_id, status |
| `/api/extrato-bancario` | extrato_bancario | conta_bancaria_id, status_conciliacao |
| `/api/cac-mensal` | cac_mensal | mes |
| `/api/cenarios-cac` | cenarios_cac | nome, mes_referencia |
| `/api/planos-comissao` | planos_comissao | nome |
| `/api/comissoes` | comissoes | venda_id, vendedor_id, status |
| `/api/metas` | metas | vendedor_id, mes_referencia |
| `/api/propostas` | propostas | numero, cliente_id, vendedor_id, status |
| `/api/templates-proposta` | templates_proposta | nome |
| `/api/destinos` | destinos | nome, pais |
| `/api/audit-log` | audit_log | usuario_id, acao, modulo, entidade, entidade_id |

### 4.3 Grupos (rotas especiais)

| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/grupos` | Lista todos os grupos |
| POST | `/api/grupos` | Cria grupo |
| GET | `/api/grupos/[id]` | Busca grupo por ID |
| PUT | `/api/grupos/[id]` | Atualiza grupo |
| DELETE | `/api/grupos/[id]` | Remove grupo |
| POST | `/api/grupos/sync` | Sync em lote (transacao atomica). Body: array de grupos |

### 4.4 Propostas (rotas especiais)

| Metodo | Rota | Descricao |
|---|---|---|
| POST | `/api/propostas/from-grupo` | Cria proposta a partir de grupo. Body: `{ grupo_id }`. Gera numero `PROP-XXXX` |
| PUT | `/api/propostas/[id]/aceitar` | Cliente aceita proposta. Body: `{ nome_aceite }` |
| POST | `/api/propostas/[id]/feedback` | Adiciona feedback. Body: `{ mensagem, nome? }` |

### 4.5 Propostas Publicas (sem autenticacao)

| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/propostas/public/[slug]` | Busca proposta por slug (6+ chars do ID) |
| PUT | `/api/propostas/public/[slug]/aceitar` | Aceite publico. Body: `{ nome_aceite }` |
| POST | `/api/propostas/public/[slug]/feedback` | Feedback publico. Body: `{ mensagem, nome? }` |
| POST | `/api/propostas/public/[slug]/lead` | Captura lead. Body: `{ nome, email?, telefone?, mensagem? }` |
| POST | `/api/propostas/public/[slug]/view` | Registra visualizacao. Body: `{ tempo_segundos? }` |
| POST | `/api/propostas/public/[slug]/chat` | Chatbot IA sobre a proposta. Body: `{ mensagem, historico? }` |

### 4.6 Templates

| Metodo | Rota | Descricao |
|---|---|---|
| POST | `/api/templates-proposta/seed` | Inicializa 6 templates padrao |

### 4.7 Destinos

| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/destinos?q=termo` | Busca destinos por nome/pais |
| POST | `/api/destinos/enrich` | Enriquecimento IA do destino. Body: `{ nome, pais? }` |

### 4.8 Configuracao

| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/agencia` | Dados da agencia (singleton, id='default') |
| POST | `/api/agencia` | Salva dados da agencia |
| GET | `/api/apis-config` | Config de APIs externas (singleton) |
| POST | `/api/apis-config` | Salva config de APIs |
| POST | `/api/apis-config/test` | Testa conexao com API. Body: `{ provider, config }` |
| GET | `/api/apis-config/cache-stats` | Estatisticas do cache |

### 4.9 Integracoes Externas

| Metodo | Rota | API Externa | Descricao |
|---|---|---|---|
| POST | `/api/flights/search` | Amadeus | Busca voos. Body: `{ origem, destino, data_ida, data_volta?, adultos, criancas, classe }` |
| GET | `/api/flights/airports?keyword=` | Amadeus | Busca aeroportos |
| POST | `/api/hotels/search` | Google Places | Busca hoteis. Body: `{ destino, query? }` |

### 4.10 Uploads

| Metodo | Rota | Descricao |
|---|---|---|
| POST | `/api/upload` | Upload de imagens (multipart/form-data). Max 10MB. Tipos: jpeg, png, webp, gif, avif |
| GET | `/api/uploads/[filename]` | Serve arquivo salvo. Cache 1 ano. Protecao path traversal |

**Storage**: `/data/uploads` em producao (volume persistente Coolify), `/public/uploads` em dev.

### 4.11 IA

| Metodo | Rota | Descricao |
|---|---|---|
| POST | `/api/ai/proposta` | Geracao de conteudo IA para proposta. Modos: `bloco` (secao unica) ou `completo` (proposta inteira) |

---

## 5. SISTEMA DE TIPOS (TypeScript)

### 5.1 Tipos do Produto (GrupoViagem)

```typescript
type AbaType = 'INF' | 'TKT' | 'HTL' | 'REC' | 'CAR' | 'GUIA' | 'SEG' | 'NAVIO' | 'ING' | 'BRINDE' | 'PROPOSTA' | 'HTL+SEG';

interface GrupoViagem {
  id: string;
  grp_id: string;
  origem_destino: string;
  periodos: Periodo[];          // Check-in/check-out
  tkt: { fontes: TktFonte[] };  // Aereo
  htl: { fontes: HtlFonte[] };  // Hotelaria
  rec: { fornecedores: RecFornecedor[] };  // Receptivo
  car: { empresas: CarEmpresa[] };         // Transporte
  guia: { fornecedores: GuiaFornecedor[] }; // Guias
  seg: { seguradoras: SegSeguradora[] };    // Seguro
  navio: { fornecedores: NavioFornecedor[] }; // Cruzeiros
  ing: { fontes: IngFonte[] };              // Ingressos
  brinde: { fornecedores: BrindeFornecedor[] }; // Brindes
  params: Params;               // Markup, contrato, pagamento
  cambio: CambioItem[];         // Taxas de cambio
  financeiro?: FinanceiroGrupo; // Dados financeiros
}

interface Params {
  markup: number;
  contrato: { descricao: string; clausulas: string[] };
  pagamento: { a_vista: PagConfig; cartao: PagConfig; boleto: PagConfig };
}

// Moedas suportadas
const MOEDAS = ['BRL', 'USD', 'EUR', 'GBP', 'ARS', 'CLP', 'PEN', 'COP'];
```

### 5.2 Tipos CRM

```typescript
interface Cliente {
  id: string;
  tipo: 'fisica' | 'juridica';
  // PF
  nome_completo?: string;
  cpf?: string;
  rg?: string;
  data_nascimento?: string;
  // PJ
  razao_social?: string;
  nome_fantasia?: string;
  cnpj?: string;
  inscricao_estadual?: string;
  // Contato
  email?: string;
  telefone?: string;
  celular?: string;
  // Endereco
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  // Preferencias
  preferencias?: { classe_voo?, tipo_hospedagem?, restricoes_alimentares?, observacoes? };
  cartoes?: CartaoCliente[];
  anexos?: AnexoCliente[];
}

interface Proposta {
  id: string;
  numero: string;          // PROP-0001
  titulo: string;
  subtitulo?: string;
  cliente_id?: string;
  vendedor_id?: string;
  grupo_id?: string;
  status: 'RASCUNHO' | 'ENVIADO' | 'VISUALIZADO' | 'ACEITO' | 'REJEITADO';
  layout?: 'classic' | 'discovery';
  visual: PropostaVisual;  // Tema, cores, fontes, header
  secoes: PropostaSecao[]; // Blocos de conteudo
  aceite?: { nome_aceite, data_aceite, ip_aceite };
  leads?: PropostaLead[];
  feedbacks?: PropostaFeedback[];
  visualizacoes?: PropostaView[];
  validade_dias?: number;
  idioma?: 'pt-BR' | 'en' | 'es';
  versao?: number;
}

// Tipos de secao/bloco da proposta
type TipoSecao = 'TEXTO' | 'SERVICO' | 'ROTEIRO_DIA' | 'GALERIA' | 'MAPA' |
                 'FAQ' | 'VALORES' | 'CTA' | 'COUNTDOWN' | 'ALOJAMENTO' |
                 'TRANSPORTE' | 'INCLUSOS' | 'DEPOIMENTO' | 'VIDEO';

interface VendaCRM {
  id: string;
  numero?: string;          // VEN-0001
  cliente_id: string;
  vendedor_id?: string;
  grupo_id?: string;
  proposta_id?: string;
  status: string;           // orcamento, confirmada, cancelada
  valor_total: number;
  desconto?: number;
  forma_pagamento?: string;
  condicao_pagamento?: string;
  data_venda?: string;
  observacoes?: string;
}

interface Destino {
  id: string;
  nome: string;
  pais: string;
  descricao?: string;
  idioma?: string;
  clima?: string;
  moeda?: string;
  fuso?: string;
  melhor_epoca?: string;
  gastronomia?: string;
  dicas?: string;
  fast_facts?: string[];
  imagem_url?: string;
  enriched?: boolean;        // Flag se foi enriquecido por IA
  enriched_at?: string;
}
```

### 5.3 Tipos Financeiros

```typescript
interface Venda {
  id: string;
  cliente: string;
  apto: TipoApto;           // SGL, DBL, TPL, QDP, CHD
  paxes: number;
  forma: FormaPagamento;     // AVISTA, CARTAO, BOLETO, PIX
  valor_unitario: number;
  desconto: number;
  valor_final: number;
  status: StatusVenda;       // RESERVA, CONFIRMADA, CANCELADA
  data: string;
  vendedor?: string;
  observacoes?: string;
}

interface Parcela {
  id: string;
  venda_id: string;
  numero: number;
  valor: number;
  vencimento: string;
  status: StatusParcela;     // PENDENTE, PAGO, ATRASADO
  data_pagamento?: string;
  forma_recebimento?: string;
  conta_bancaria_id?: string;
}

interface FinanceiroGrupo {
  vendas: Venda[];
  parcelas: Parcela[];
  fornecedores: PagamentoFornecedor[];
  config: FinanceiroConfig;
  custos_extras?: CustoExtra[];
  notas?: string;
}

// Enums
type TipoApto = 'SGL' | 'DBL' | 'TPL' | 'QDP' | 'CHD';
type TipoPax = 'ADT' | 'CHD' | 'INF';
type FormaPagamento = 'AVISTA' | 'CARTAO' | 'BOLETO' | 'PIX';
type StatusVenda = 'RESERVA' | 'CONFIRMADA' | 'CANCELADA';
type StatusParcela = 'PENDENTE' | 'PAGO' | 'ATRASADO';
type StatusFornecedor = 'PENDENTE' | 'PAGO' | 'PARCIAL';
type CategoriaFornecedor = 'AEREO' | 'HOTEL' | 'RECEPTIVO' | 'TRANSPORTE' | 'SEGURO' | 'CRUZEIRO' | 'GUIA' | 'INGRESSO' | 'OUTROS';
```

---

## 6. LOGICA DE CALCULOS

### 6.1 Calculo de Proposta (`calcProposta`)
Funcao principal que calcula o preco total do grupo:
- Soma custos de todos os servicos (aereo, hotel, receptivo, transporte, guia, seguro, cruzeiro, ingressos, brindes)
- Aplica markup configurado em `params.markup`
- Calcula preco por tipo de apartamento (SGL, DBL, TPL, QDP, CHD)
- Calcula preco por forma de pagamento (a vista, cartao, boleto)
- Retorna totais por pax e por casal

### 6.2 Calculos Financeiros
- `calcVendasMetrics()` — Total de aptos, pax, receita, descontos, vendas por tipo/forma
- `calcRecebimentosMetrics()` — Recebidos, pendentes, atrasados, previsao 30 dias
- `calcFornecedoresMetrics()` — Custos por categoria, economia, totais
- `calcFluxoCaixa()` — Entradas/saidas mensais com saldo acumulado
- `calcDRE()` — Demonstrativo de resultado (receita - custos = resultado)
- `calcIndicadores()` — KPIs avancados: break-even, velocidade de vendas, cenarios

---

## 7. AUTENTICACAO E MIDDLEWARE

### Middleware (`src/middleware.ts`)
- Verifica JWT em todas as rotas protegidas
- Cookie: `entur-session` (httpOnly, 7 dias)
- Biblioteca: `jose` (jwtVerify)
- Secret: variavel `JWT_SECRET` (fallback hardcoded para dev)

### Rotas publicas (sem autenticacao)
- `/login`
- `/api/auth/login`
- `/api/auth/seed`
- `/api/auth/session`
- `/p/*` (preview de propostas)
- `/api/propostas/public/*`
- Assets estaticos

### Perfis de usuario
- **ADMIN** — Acesso total
- **VENDEDOR** — Acesso restrito conforme permissoes

---

## 8. INTEGRACOES EXTERNAS

### 8.1 Amadeus API (Voos)
- Busca de voos por origem/destino/data
- Busca de aeroportos por keyword
- Config: `api_key`, `api_secret`, `ambiente` (test/production)
- Cache: respostas cacheadas no PostgreSQL com TTL

### 8.2 Google Places API (Hoteis)
- Busca de hoteis por destino
- Retorna: rating, preco, endereco, amenities, reviews
- Config: `api_key`

### 8.3 Anthropic Claude API (IA)
- Geracao de conteudo para propostas (blocos ou completa)
- Enriquecimento de destinos (descricao, clima, dicas, etc.)
- Chatbot na pagina publica da proposta
- Config: `api_key`, `modelo`

---

## 9. CONTEXTOS REACT (State Management)

### AuthContext
```typescript
interface AuthState {
  user: { id, nome, email, perfil, permissoes } | null;
  loading: boolean;
}
// Methods: logout(), refresh()
// Auto-refresh on pathname change
```

### AppContext
```typescript
interface AppState {
  activeGrupoId: string | null;
  activeGrupoLabel: string | null;
}
// Methods: setActiveGrupo(id, label?)
// Persiste em localStorage
```

### ThemeContext
```typescript
interface ThemeState {
  theme: 'light' | 'dark';
}
// Methods: toggleTheme()
// Persiste em localStorage: 'entur-theme'
// Aplica classe 'dark' no <html>
```

---

## 10. DESIGN SYSTEM — TOKENS CSS

### Tema Claro (`:root`)
```css
--t-bg: #f4f4f4;
--t-surface: #ffffff;
--t-surface-hover: #f8f8fb;
--t-border: rgba(0, 0, 0, 0.08);
--t-text: #1a1a2e;
--t-text-secondary: #6b6b80;
--t-text-muted: #999;
--t-green: #004aad;              /* Cor primaria (azul) */
--t-green-bg: rgba(0, 74, 173, 0.1);
--t-red: #dc2626;
--t-blue: #2563eb;
--t-amber: #d97706;
--t-sidebar-bg: #ffffff;
--t-sidebar-item: #6b6b80;
--t-sidebar-item-hover: #f4f4f4;
--t-input-bg: #ffffff;
```

### Tema Escuro (`.dark`)
```css
--t-bg: #0a0a14;
--t-surface: #12121e;
--t-surface-hover: rgba(255, 255, 255, 0.02);
--t-border: rgba(255, 255, 255, 0.06);
--t-text: #f0f0f5;
--t-text-secondary: #8888a0;
--t-text-muted: #555;
--t-green: #004aad;
--t-sidebar-bg: #0e0e1a;
--t-sidebar-item: #8888a0;
--t-sidebar-item-hover: rgba(255, 255, 255, 0.04);
--t-input-bg: #0f0f1a;
```

---

## 11. MENUS DA SIDEBAR POR PILAR

### PLANEJAMENTO (Calculator icon)
```
CUSTOS
  Custos do Negocio          → /planejamento/custos     (placeholder)
  Custos de Projeto          → /planejamento/projetos    (placeholder)

CAC
  Dashboard CAC              → /cac/dashboard
  Cenarios                   → /cac/cenarios
```

### METAS (Target icon)
```
INDICADORES
  Dashboard KPI              → /dashboard

EQUIPE
  Metas e Ranking            → /equipe/metas
  Comissoes                  → /equipe/comissoes
  Planos de Comissao         → /equipe/planos-comissao
```

### PRODUTOS (Package icon)
```
CRIAR
  Grupos                     → /grupos
  Nova Proposta              → /propostas/nova
  Orcamentos                 → /vendas/orcamentos

PROPOSTAS
  Minhas Propostas           → /propostas
  Analytics                  → /propostas/analytics

FERRAMENTAS
  Buscar Voos                → /voos
  Buscar Hoteis              → /hoteis
  Banco de Destinos          → /destinos
```

### FINANCEIRO (DollarSign icon)
```
VISAO GERAL
  Fluxo de Caixa             → /financeiro-ag/fluxo-caixa
  DRE                        → /financeiro-ag/dre
  Conciliacao                → /financeiro-ag/conciliacao

CONTAS
  Contas a Receber           → /financeiro-ag/receber
  Contas a Pagar             → /financeiro-ag/pagar
  Plano de Contas            → /financeiro-ag/plano-contas
  Contas Bancarias           → /financeiro-ag/contas-bancarias
  Transferencias             → /financeiro-ag/transferencias

GRUPOS
  Financeiro de Grupos       → /financeiro-grupos

VENDAS
  Nova Venda                 → /vendas/nova
  Lista de Vendas            → /vendas

PESSOAS
  Clientes                   → /pessoas/clientes
  Fornecedores               → /pessoas/fornecedores
  Equipe                     → /pessoas/equipe

RELATORIOS
  Financeiro                 → /relatorios/financeiro
  Rentabilidade              → /relatorios/rentabilidade
  Comparativo Mensal         → /relatorios/comparativo
```

---

## 12. DEPENDENCIAS DO PROJETO

### Producao
| Pacote | Versao | Uso |
|---|---|---|
| next | 16.2.2 | Framework principal |
| react / react-dom | 19.2.4 | UI |
| pg | 8.20.0 | PostgreSQL driver |
| jose | 6.2.2 | JWT tokens |
| lucide-react | 1.7.0 | Icones |
| shadcn | 4.1.2 | Componentes UI |
| @tiptap/* | 3.22.1 | Editor rich text (WYSIWYG) |
| @dnd-kit/* | 6.3.1+ | Drag and drop |
| leaflet / react-leaflet | 1.9.4 / 5.0.0 | Mapas |
| html2pdf.js | 0.14.0 | Geracao PDF |
| clsx + tailwind-merge | 2.1.1 / 3.5.0 | Class utilities |
| class-variance-authority | 0.7.1 | Variantes de componentes |

### Desenvolvimento
| Pacote | Versao |
|---|---|
| typescript | 5 |
| tailwindcss | 4 |
| @tailwindcss/postcss | 4 |
| eslint + eslint-config-next | 9 / 16.2.2 |
| @types/node, @types/react, @types/pg | 20 / 19 / 8.20.0 |

---

## 13. DOCKER E DEPLOY

### Dockerfile (multi-stage)
```dockerfile
# Stage 1: Base
FROM node:20-alpine AS base

# Stage 2: Dependencies
FROM base AS deps
COPY package*.json ./
RUN npm ci

# Stage 3: Build
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 4: Runner
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system nodejs && adduser --system nextjs
RUN mkdir -p /app/data/uploads && chown -R nextjs:nodejs /app/data
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

### Coolify Deploy
- **UUID**: `frvuku1e7hje8qplm8bxgsi8`
- **Volume persistente**: `grupos-os-data:/app/data` (para uploads)
- **Porta**: 3000
- **Deploy via API**: `POST http://187.127.6.135:8000/api/v1/deploy?uuid={uuid}&force=true`

### Variaveis de Ambiente
| Variavel | Descricao |
|---|---|
| `DATABASE_URL` | Connection string PostgreSQL |
| `JWT_SECRET` | Chave secreta para tokens JWT |
| `NODE_ENV` | `production` ou `development` |

---

## 14. FUNCIONALIDADES POR PAGINA

### /dashboard — KPI Dashboard
Dashboard principal com metricas de desempenho. Pilar: METAS.

### /grupos — Lista de Grupos
Cards com todos os grupos de viagem. Permite criar, duplicar, exportar JSON, importar, deletar. Pilar: PRODUTOS.

### /grupo/[id] — Editor de Grupo
Editor completo com 12 abas:
- **INF**: Info geral (ID, origem-destino, periodos)
- **TKT**: Aereo (trechos, fornecedores, precos por fonte)
- **HTL**: Hotelaria (hoteis, quartos, diarias, precos)
- **REC**: Receptivo (passeios, fornecedores)
- **CAR**: Transporte (empresas, veiculos)
- **GUIA**: Guias (fornecedores por destino)
- **SEG**: Seguro viagem (seguradoras, coberturas)
- **NAVIO**: Cruzeiros (cabines, fornecedores)
- **ING**: Ingressos/atrativos
- **BRINDE**: Brindes/souvenirs
- **PROPOSTA**: Gerar proposta a partir do grupo
- **HTL+SEG**: Hotel + Seguro combinado

Auto-save a cada 5 segundos. FloatingResume com calculos em tempo real. Pilar: PRODUTOS.

### /propostas — Lista de Propostas
Tabela com todas as propostas. Filtros por status. Cards de resumo (total, rascunhos, enviadas, aceitas). Atividade recente. Pilar: PRODUTOS.

### /propostas/nova — Nova Proposta (Wizard)
1. Escolher template ou criar em branco
2. Dados da viagem (cliente, destino, datas, passageiros, orcamento, toggle IA)
3. Abre editor

### /propostas/[id] — Editor de Proposta
Editor WYSIWYG com blocos arrast aveis (TipTap + dnd-kit):
- Texto, Video, Galeria, Roteiro dia-a-dia, Mapa, FAQ, Countdown
- Alojamento, Transporte, Servicos, Inclusos, Valores, Depoimentos, CTA
- Sidebar com configuracoes visuais (tema, cores, fontes)
- Preview em tempo real
- Gerar link publico

### /p/[slug] — Preview Publico
Pagina publica da proposta (sem autenticacao). Dois layouts: `classic` e `discovery`.
Features: aceite digital, captura de leads, feedback, chatbot IA, tracking de visualizacoes.

### /propostas/analytics — Analytics
Metricas de propostas: total, visualizadas, taxa de aceite, leads, feedbacks, valor aceito, tempo medio de visualizacao. Top propostas mais vistas.

### /vendas — Lista de Vendas
Tabela com vendas. Filtros por status/data. Cards: total vendas, valor total, ticket medio. Pilar: FINANCEIRO.

### /vendas/nova — Nova Venda
Formulario de venda manual. Pilar: FINANCEIRO.

### /vendas/orcamentos — Orcamentos
Tela de orcamentos. Pilar: PRODUTOS.

### /financeiro-ag/* — Modulo Financeiro da Agencia
- **fluxo-caixa**: Timeline de movimentacoes, saldo acumulado, projecao futura
- **dre**: Demonstrativo de resultado por periodo
- **conciliacao**: Conciliacao bancaria (extrato vs lancamentos)
- **receber**: Contas a receber com filtros e acao "Receber"
- **pagar**: Contas a pagar com filtros e acao "Pagar"
- **plano-contas**: Hierarquia de categorias contabeis
- **contas-bancarias**: Cadastro de contas bancarias
- **transferencias**: Transferencias entre contas

### /financeiro-grupos — Financeiro por Grupo
Visao financeira agrupada: faturado, custos, margem, vendas, ticket medio.

### /financeiro/[id]/[tab] — Financeiro Detalhe
Financeiro detalhado de um grupo especifico com abas: Painel, Vendas, Recebimentos, Fornecedores, Fluxo Caixa, DRE, Indicadores.

### /pessoas/clientes — Clientes
CRUD de clientes PF/PJ com dados completos, preferencias, anexos.

### /pessoas/fornecedores — Fornecedores
CRUD de fornecedores com categorias.

### /pessoas/equipe — Equipe
Cadastro de membros da equipe com cargos e performance.

### /equipe/metas — Metas e Ranking
Definicao e acompanhamento de metas por vendedor/mes.

### /equipe/comissoes — Comissoes
Calculo e listagem de comissoes.

### /equipe/planos-comissao — Planos de Comissao
Configuracao de regras de comissao.

### /cac/dashboard — Dashboard CAC
Custo de Aquisicao de Cliente mensal com metricas.

### /cac/cenarios — Cenarios CAC
Simulacao de cenarios de CAC.

### /voos — Busca de Voos
Busca via Amadeus API. Filtros: origem, destino, datas, passageiros, classe.

### /hoteis — Busca de Hoteis
Busca via Google Places. Mostra rating, preco, amenities, reviews.

### /destinos — Banco de Destinos
CRUD de destinos com enriquecimento por IA (descricao, clima, moeda, dicas).

### /relatorios/* — Relatorios
- **financeiro**: Relatorio financeiro consolidado
- **rentabilidade**: Analise de rentabilidade
- **comparativo**: Comparativo mensal

### /config/agencia — Config Agencia
Dados da agencia (nome, logo, contato, CNPJ).

### /config/usuarios — Config Usuarios
Gerenciamento de usuarios do sistema.

---

## 15. PATTERNS E CONVENCOES

### CRUD Generico
Todas as entidades usam `createCrudHandlers(table, indexColumns)`:
```typescript
// Lista + Cria
const { GET, POST } = createCrudHandlers('tabela', ['coluna1', 'coluna2']);

// Busca + Atualiza + Remove
const { GET, PUT, DELETE } = createCrudItemHandlers('tabela', ['coluna1', 'coluna2']);
```

### Padrao JSONB
Dados completos ficam na coluna `data` (JSONB). Colunas separadas existem apenas para indexacao e filtros rapidos. Isso permite schema flexivel sem migrations.

### IDs
Gerados no frontend com `generateId()` (provavelmente UUID ou similar).

### Formato Monetario
`R$ 1.234,56` — ponto como separador de milhar, virgula como decimal. Funcoes: `formatBRL()`, `parseBRL()`.

### Formato de Data
`dd/mm/aaaa` para exibicao. ISO 8601 para armazenamento.

### Numeracao Automatica
- Propostas: `PROP-0001`, `PROP-0002`, ...
- Vendas: `VEN-0001`, `VEN-0002`, ...

### Auto-save
Editor de grupo salva automaticamente a cada 5 segundos.

### Persistencia de Grupos
API-first com fallback para localStorage (migra dados locais para DB automaticamente).

---

## 16. RESUMO ESTATISTICO

| Metrica | Valor |
|---|---|
| Tabelas no banco | 27 |
| API routes | 67 |
| Paginas (page.tsx) | ~35 |
| Componentes | ~60 |
| Tipos de bloco de proposta | 14 |
| Abas do editor de grupo | 12 |
| Templates de proposta | 6 |
| Integracoes externas | 3 (Amadeus, Google Places, Anthropic) |
| Idiomas suportados | 3 (pt-BR, en, es) |
| Moedas suportadas | 8 (BRL, USD, EUR, GBP, ARS, CLP, PEN, COP) |

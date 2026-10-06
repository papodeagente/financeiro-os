# Cobertura da modernização visual (05/10/2026)

Branch `design/modernizacao-visual`. Referência: painel administrativo claro, com barra lateral branca, cartões com ícone e azul como cor de interação. Regras e tokens estão em [design-system.md](design-system.md). Capturas em [ui-capturas/](ui-capturas/), todas com dados fictícios de simulação.

## O que mudou, em números

| Medida | Antes (`main`) | Depois |
|---|---|---|
| Classes de cor crua do Tailwind na interface | 3.205 (em 217 de 339 arquivos com algum padrão antigo) | 0 |
| Hex dentro de classe na interface | dezenas, incluindo 83 do dourado antigo `#d4a853` | 0, fora a miniatura ilustrativa do funil, que é exceção documentada |
| Dialetos de token com valor próprio (`--t-*`, `--lg-*`, `--ink-*`, `--text-*`) | `--text-*` com escala paralela (11 e 13px) | todos são apelidos de `--fin-*` |
| Cabeçalhos de página | 2 desenhos (o legado com título do tamanho do texto) | 1 desenho, com o legado virando adaptador |
| Molduras de página | `PageShell` (1400px, `--t-*`), `MolduraDaPagina` e 35 molduras `p-6` à mão | respiro e largura por token |
| Componentes sem consumidor | `AppSidebar`, `PillarRail`, `SubNav`, `QuickAction`, `FeaturePanel`, `ui/tabs`, `KpiCard` | removidos |
| Rolagem horizontal da página a 390px | 5 telas | 0 |
| Botões com texto fixo sobre preenchimento | 77 | 0 |

As cores cruas que restam no repositório (745) e os hex (314) ficam todos nas exceções de conteúdo ou em arquivos de dado: tema de proposta, categoria de funil, bandeira de cartão e paleta do mapa mental.

## Superfícies compartilhadas

| Superfície | Componente | Situação inicial | Migração | Validação |
|---|---|---|---|---|
| Shell: barra do topo | `TopBar` | já em tokens, menus com `z-[100]` | camada por token | varredura 182 rotas×larguras |
| Shell: barra lateral | `PillarSidebar` | cinza "recuada", 232px, itens de 36px; dois itens ativos ao mesmo tempo (prefixo) | branca, 240px, itens de 40px, ativo em azul suave; vence o item mais específico | fotos com dados |
| Shell celular | `AppShell` (gaveta) | gaveta abaixo de 768px | sem mudança de comportamento | varredura a 390px |
| Cabeçalho de página | `fin/PageHeader`, `PageHeader` (adaptador) | dois desenhos | um desenho, título de 24px | fotos antes e depois |
| Moldura | `MolduraDaPagina`, `PageShell` (adaptador) | larguras e respiros diferentes | tokens `--fin-page-pad` e `--fin-page-max` | varredura |
| Botão | `ui/button` | 32px, raio 14, sombra azul de outro sistema, `text-white` | 44/40px, raio 8, texto sobre preenchimento | fotos e tema escuro |
| Campo, área de texto, select | `ui/input`, `ui/textarea`, `ui/select` | 32px, raio 10, anel próprio somado ao global | 44/40px, raio 8, foco pelo anel global | fotos |
| Badge e chip | `ui/badge`, `fin/StatusChip` | pílula versus retângulo | retângulo de raio pequeno nos dois | fotos |
| Cartão | `ui/card`, `.kpi-card`, `.bento-card`, `.section-card`, `lg-glass-*` | sem sombra, fundo `#ffffff` fixo (quebrava no escuro), faixa colorida no topo | branco por token, sopro de sombra, raio 14 | tema escuro |
| Indicador | `fin/MetricCard`, `IconeDeIndicador` | rótulo em maiúsculas, sem ícone | ícone opcional (40 cartões), rótulo legível, padding 20 | fotos com dados |
| Diálogo | `ui/dialog`, `fin/ConfirmDialog` | fundo cinza (vidro), véu com desfoque | branco, véu sólido, rolagem interna, camada por token | fotos |
| Gaveta | `ui/sheet`, `fin/RecordSheet` | fundo cinza | branca com borda do lado de dentro | fotos da conciliação |
| Tooltip, popover | `ui/tooltip`, `ui/select` | `z-50` solto | camada por token | inspeção |
| Foco | CSS global | anel duplo em campo; anel em volta de diálogo inteiro | um anel; contêiner de diálogo, gaveta e menu sem anel | inspeção |
| Estados vazio, carregando e erro | `DataState`, `EmptyLesson`, `EmptyState` | anel do `EmptyState` com CSS inválido (`var()33`) | `comAlfa` | varredura com listas vazias |
| Avisos e etiquetas CSS | `.banner-*`, `.badge--*` | hex fixo | tokens | — |
| Terceiros | controles do React Flow | branco translúcido e hex | tokens | foto do editor |
| Super Admin | `admin/layout` e 11 telas | shell escuro à mão, ilegível no tema escuro, sem celular | base clara do app, selo "Super Admin" violeta, barra superior no celular | varredura com sessão de super admin (22) |

## Validações executadas

- **`npm test`:** passa inteiro (52 grupos). Inclui o porteiro novo `test-design-system.ts` (14 verificações) e o porteiro de gráficos que já existia.
- **`tsc --noEmit`:** limpo.
- **Lint (ESLint):** 110 erros no `main` e os mesmos 110 na branch, comparados arquivo a arquivo e regra a regra. Nenhum novo. Todos são anteriores (regras de hooks do React 19: `react-hooks/refs`, `set-state-in-effect`, `purity`...) e ficam como pendência fora desta mudança.
- **`next build`:** passa.
- **Varredura de rotas:** as 91 rotas em 1440 e 390px, antes e depois, com a API simulada (sessão ADMIN e listas vazias). Nenhum erro de página novo e nenhuma rolagem horizontal da página. As 11 telas `/admin` passaram em separado com sessão de super admin.
- **Inspeção visual com dados:** painel, financeiro, contas a receber, conciliação, vendas e clientes, em 1440 e 390px. Tema escuro em quatro telas. Super Admin em 1440 e 390px.

## Limitações e o que falta validar

- **Sem dados reais.** A validação usou o build de produção local com a API simulada. As listas vêm vazias, a não ser nas telas fotografadas com dados de exemplo. Telas com conteúdo denso real (muitas linhas, nomes longos) só serão vistas em produção.
- **Rotas dinâmicas** (`[id]`, `[token]`, `[slug]`) foram abertas com id fictício, então mostram o estado de vazio ou de não encontrado. O conteúdo carregado delas não foi inspecionado.
- **Larguras 768 e 1024px e zoom:** não foram varridas rota a rota. As grades e molduras usam `sm:`/`lg:`, e a barra lateral vira gaveta abaixo de 768px.
- **Tema escuro:** inspecionado em quatro telas e coberto pelo porteiro, não tela a tela.
- **Telas não refeitas estruturalmente.** Várias telas legadas (formulário de venda, propostas, grupos, configurações do CRM) ganharam tokens, controles e moldura novos, mas mantêm a composição interna. Não houve redesenho de fluxo.
- **Editores de canvas** (fluxograma, funil, mapa mental): agora empilham os painéis no celular, mas editar em tela de celular continua limitado pela própria natureza do canvas.

## Matriz por rota

"Situação inicial" conta o padrão antigo no `page.tsx` da rota no `main`. "Validação" traz o resultado da varredura antes e depois em cada largura: `ok` quer dizer sem erro de página, `rola Npx` quer dizer rolagem horizontal da página, e `→` é o redirecionamento.

| Rota | Layout / componente | Situação inicial (main) | Migração realizada | Validação executada | Pendências |
|---|---|---|---|---|---|
| / | composição própria sobre tokens | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok → /dashboard; 390: ok → /dashboard) / depois (1440: ok → /dashboard; 390: ok → /dashboard) | Redireciona para /dashboard com sessão; sem sessão é a landing pública (identidade própria, preservada). |
| /admin | composição própria sobre tokens | 2 cores cruas | cores cruas → tokens (2), primitivos e shell novos | varredura com sessão de super admin (1440 e 390): ok, sem rolagem; varredura antes (1440: ok → /admin/login; 390: ok → /admin/login) / depois (1440: ok → /admin/login; 390: ok → /admin/login) | — |
| /admin/convites | composição própria sobre tokens | 63 cores cruas | cores cruas → tokens (63), moldura por tokens, primitivos e shell novos | varredura com sessão de super admin (1440 e 390): ok, sem rolagem; varredura antes (1440: ok → /admin/login; 390: ok → /admin/login) / depois (1440: ok → /admin/login; 390: ok → /admin/login) | — |
| /admin/convites/[id] | composição própria sobre tokens | 29 cores cruas | cores cruas → tokens (29), moldura por tokens, primitivos e shell novos | varredura com sessão de super admin (1440 e 390): ok, sem rolagem; varredura antes (1440: ok → /admin/login; 390: ok → /admin/login) / depois (1440: ok → /admin/login; 390: ok → /admin/login) | validada sem registro real (id fictício): estado vazio/não encontrado |
| /admin/dashboard | composição própria sobre tokens | 41 cores cruas, 3 hex | cores cruas → tokens (41), hex → tokens (3), primitivos e shell novos | varredura com sessão de super admin (1440 e 390): ok, sem rolagem; varredura antes (1440: ok → /admin/login; 390: ok → /admin/login) / depois (1440: ok → /admin/login; 390: ok → /admin/login) | — |
| /admin/login | composição própria sobre tokens | 21 cores cruas, 7 hex | cores cruas → tokens (21), hex → tokens (7), primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /admin/marketing | composição própria sobre tokens | 40 cores cruas | cores cruas → tokens (40), moldura por tokens, primitivos e shell novos | varredura com sessão de super admin (1440 e 390): ok, sem rolagem; varredura antes (1440: ok → /admin/login; 390: ok → /admin/login) / depois (1440: ok → /admin/login; 390: ok → /admin/login) | — |
| /admin/planos | composição própria sobre tokens | 27 cores cruas | cores cruas → tokens (27), moldura por tokens, primitivos e shell novos | varredura com sessão de super admin (1440 e 390): ok, sem rolagem; varredura antes (1440: ok → /admin/login; 390: ok → /admin/login) / depois (1440: ok → /admin/login; 390: ok → /admin/login) | — |
| /admin/support | composição própria sobre tokens | 58 cores cruas, 2 hex | cores cruas → tokens (58), hex → tokens (2), primitivos e shell novos | varredura com sessão de super admin (1440 e 390): ok, sem rolagem; varredura antes (1440: ok → /admin/login; 390: ok → /admin/login) / depois (1440: ok → /admin/login; 390: ok → /admin/login) | — |
| /admin/support/[id] | composição própria sobre tokens | 63 cores cruas, 8 hex | cores cruas → tokens (63), hex → tokens (8), primitivos e shell novos | varredura com sessão de super admin (1440 e 390): ok, sem rolagem; varredura antes (1440: ok → /admin/login; 390: ok → /admin/login) / depois (1440: ok → /admin/login; 390: ok → /admin/login) | validada sem registro real (id fictício): estado vazio/não encontrado |
| /admin/tenants | composição própria sobre tokens | 37 cores cruas, 6 hex | cores cruas → tokens (37), hex → tokens (6), primitivos e shell novos | varredura com sessão de super admin (1440 e 390): ok, sem rolagem; varredura antes (1440: ok → /admin/login; 390: ok → /admin/login) / depois (1440: ok → /admin/login; 390: ok → /admin/login) | — |
| /admin/tenants/[id] | composição própria sobre tokens | 57 cores cruas, 10 hex | cores cruas → tokens (57), hex → tokens (10), primitivos e shell novos | varredura com sessão de super admin (1440 e 390): ok, sem rolagem; varredura antes (1440: ok → /admin/login; 390: ok → /admin/login) / depois (1440: ok → /admin/login; 390: ok → /admin/login) | validada sem registro real (id fictício): estado vazio/não encontrado |
| /admin/tenants/novo | composição própria sobre tokens | 42 cores cruas, 14 hex | cores cruas → tokens (42), hex → tokens (14), primitivos e shell novos | varredura com sessão de super admin (1440 e 390): ok, sem rolagem; varredura antes (1440: ok → /admin/login; 390: ok → /admin/login) / depois (1440: ok → /admin/login; 390: ok → /admin/login) | — |
| /cac | redirecionamento | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok → /cac/dashboard; 390: ok → /cac/dashboard) / depois (1440: ok → /cac/dashboard; 390: ok → /cac/dashboard) | — |
| /cac/cenarios | composição própria sobre tokens | 2 hex, 139 tokens de dialeto | hex → tokens (2), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /cac/dashboard | composição própria sobre tokens | 2 cores cruas, 1 hex, 87 tokens de dialeto | cores cruas → tokens (2), hex → tokens (1), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /config | composição própria sobre tokens | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok → /config/agencia; 390: ok → /config/agencia) / depois (1440: ok → /config/agencia; 390: ok → /config/agencia) | — |
| /config/agencia | composição própria sobre tokens | 144 tokens de dialeto | dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /config/auditoria | PageShell (adaptador) | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /config/crm | PageShell (adaptador) | 11 cores cruas, 147 tokens de dialeto | cores cruas → tokens (11), dialeto resolvido na fonte (apelido de --fin-*), primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /config/fiscal | PageShell (adaptador) | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /config/fiscal/avancado | PageShell (adaptador) | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /config/fiscal/servicos | fin/PageHeader + moldura por tokens | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /config/integracoes | PageShell (adaptador) | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /config/integracoes/ia | PageShell (adaptador) | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /config/plataformas | fin/PageHeader + moldura por tokens | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /config/reset | composição própria sobre tokens | 49 cores cruas | cores cruas → tokens (49), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /config/usuarios | composição própria sobre tokens | 42 cores cruas, 28 tokens de dialeto | cores cruas → tokens (42), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /dashboard | fin/PageHeader + moldura por tokens | já em --fin-* | indicadores com ícone, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok); inspeção visual com dados (1440 e 390); tema escuro | — |
| /destinos | composição própria sobre tokens | 9 cores cruas, 94 tokens de dialeto | cores cruas → tokens (9), dialeto resolvido na fonte (apelido de --fin-*), primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /equipe | redirecionamento | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok → /equipe/metas; 390: ok → /equipe/metas) / depois (1440: ok → /equipe/metas; 390: ok → /equipe/metas) | — |
| /equipe/comissoes | MolduraDaPagina + fin/PageHeader | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /equipe/folha | MolduraDaPagina + fin/PageHeader | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /equipe/metas | MolduraDaPagina + fin/PageHeader | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /equipe/planos-comissao | composição própria sobre tokens | 2 hex, 99 tokens de dialeto | hex → tokens (2), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /equipe/vendedores | MolduraDaPagina + fin/PageHeader | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /financeiro-ag | fin/PageHeader + moldura por tokens | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok); inspeção visual com dados (1440 e 390) | — |
| /financeiro-ag/cartoes | fin/PageHeader + moldura por tokens | já em --fin-* | indicadores com ícone, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /financeiro-ag/conciliacao | fin/PageHeader + moldura por tokens | já em --fin-* | indicadores com ícone, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok); inspeção visual com dados (1440 e 390) | — |
| /financeiro-ag/contas-bancarias | fin/PageHeader + moldura por tokens | já em --fin-* | indicadores com ícone, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /financeiro-ag/dre | fin/PageHeader + moldura por tokens | já em --fin-* | indicadores com ícone, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /financeiro-ag/fluxo-caixa | fin/PageHeader + moldura por tokens | já em --fin-* | indicadores com ícone, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /financeiro-ag/notas | PageShell (adaptador) | já em --fin-* | indicadores com ícone, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /financeiro-ag/pagar | PageShell (adaptador) | já em --fin-* | indicadores com ícone, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /financeiro-ag/plano-contas | fin/PageHeader + moldura por tokens | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /financeiro-ag/receber | PageShell (adaptador) | já em --fin-* | indicadores com ícone, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok); inspeção visual com dados (1440 e 390); tema escuro | — |
| /financeiro-ag/recebimentos | MolduraDaPagina + fin/PageHeader | já em --fin-* | indicadores com ícone, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /financeiro-ag/transferencias | fin/PageHeader + moldura por tokens | já em --fin-* | indicadores com ícone, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /financeiro-grupos | fin/PageHeader + moldura por tokens | já em --fin-* | indicadores com ícone, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /financeiro/[id]/[tab] | composição própria sobre tokens | 2 cores cruas, 10 tokens de dialeto | cores cruas → tokens (2), dialeto resolvido na fonte (apelido de --fin-*), primitivos e shell novos | varredura antes (1440: ok → /dashboard; 390: ok → /dashboard) / depois (1440: ok → /dashboard; 390: ok → /dashboard) | validada sem registro real (id fictício): estado vazio/não encontrado |
| /grupo/[id] | composição própria sobre tokens | 2 cores cruas, 1 hex, 13 tokens de dialeto | cores cruas → tokens (2), hex → tokens (1), dialeto resolvido na fonte (apelido de --fin-*), primitivos e shell novos | varredura antes (1440: ok → /dashboard; 390: ok → /dashboard) / depois (1440: ok → /dashboard; 390: ok → /dashboard) | validada sem registro real (id fictício): estado vazio/não encontrado |
| /grupo/[id]/gestao | composição própria sobre tokens | 28 tokens de dialeto | dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | validada sem registro real (id fictício): estado vazio/não encontrado |
| /grupos | PageShell (adaptador) + PageHeader (adaptador) | 52 cores cruas, 134 tokens de dialeto | cores cruas → tokens (52), dialeto resolvido na fonte (apelido de --fin-*), primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /grupos/gestao | composição própria sobre tokens | 43 tokens de dialeto | dialeto resolvido na fonte (apelido de --fin-*), primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /hoteis | composição própria sobre tokens | 21 cores cruas, 69 tokens de dialeto | cores cruas → tokens (21), dialeto resolvido na fonte (apelido de --fin-*), primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /login | composição própria sobre tokens | 3 cores cruas, 1 hex, 24 tokens de dialeto | cores cruas → tokens (3), hex → tokens (1), dialeto resolvido na fonte (apelido de --fin-*), primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /mapas-mentais/publico/[token] | composição própria sobre tokens | 16 cores cruas, 3 hex | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | 16 cores cruas restantes (conteúdo); Mapa público: cores escolhidas pelo usuário preservadas. |
| /p/[slug] | composição própria sobre tokens | 5 cores cruas, 6 hex | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | 5 cores cruas restantes (conteúdo); Proposta pública: cores do modelo da proposta (marca do tenant) preservadas. |
| /perfil | composição própria sobre tokens | 32 cores cruas | cores cruas → tokens (32), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /pessoas | composição própria sobre tokens | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok → /pessoas/clientes; 390: ok → /pessoas/clientes) / depois (1440: ok → /pessoas/clientes; 390: ok → /pessoas/clientes) | — |
| /pessoas/clientes | PageHeader (adaptador) + moldura por tokens | 13 cores cruas, 8 hex, 175 tokens de dialeto | cores cruas → tokens (13), hex → tokens (8), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok); inspeção visual com dados (1440 e 390); tema escuro | — |
| /pessoas/equipe | redirecionamento | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok → /equipe/vendedores; 390: ok → /equipe/vendedores) / depois (1440: ok → /equipe/vendedores; 390: ok → /equipe/vendedores) | — |
| /pessoas/fornecedores | PageHeader (adaptador) + moldura por tokens | 35 cores cruas, 6 hex, 124 tokens de dialeto | cores cruas → tokens (35), hex → tokens (6), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /planejamento/custos | composição própria sobre tokens | 1 hex, 113 tokens de dialeto | hex → tokens (1), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /planejamento/fluxogramas | PageHeader (adaptador) + moldura por tokens | 5 cores cruas, 43 tokens de dialeto | cores cruas → tokens (5), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok, rola 69px) / depois (1440: ok; 390: ok) | — |
| /planejamento/fluxogramas/[id] | composição própria sobre tokens | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok, rola 205px) / depois (1440: ok; 390: ok) | validada sem registro real (id fictício): estado vazio/não encontrado |
| /planejamento/funis | PageHeader (adaptador) + moldura por tokens | 5 cores cruas, 48 tokens de dialeto | cores cruas → tokens (5), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /planejamento/funis/[id] | composição própria sobre tokens | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | validada sem registro real (id fictício): estado vazio/não encontrado |
| /planejamento/mapas-mentais | composição própria sobre tokens | 28 cores cruas | cores cruas → tokens (28), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /planejamento/mapas-mentais/[id] | composição própria sobre tokens | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | validada sem registro real (id fictício): estado vazio/não encontrado |
| /planejamento/mapas-mentais/importar/[token] | composição própria sobre tokens | 29 cores cruas | cores cruas → tokens (29), primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | validada sem registro real (id fictício): estado vazio/não encontrado |
| /planejamento/projetos | PageHeader (adaptador) + moldura por tokens | 3 cores cruas, 42 tokens de dialeto | cores cruas → tokens (3), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /preview-iframe | composição própria sobre tokens | 3 cores cruas, 3 hex | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | 3 cores cruas restantes (conteúdo); Moldura de prévia da proposta: renderiza o documento, preservado. |
| /propostas | PageShell (adaptador) + PageHeader (adaptador) | 22 cores cruas, 2 hex, 41 tokens de dialeto | cores cruas → tokens (22), hex → tokens (2), dialeto resolvido na fonte (apelido de --fin-*), primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /propostas/[id] | composição própria sobre tokens | 3 tokens de dialeto | dialeto resolvido na fonte (apelido de --fin-*), primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | validada sem registro real (id fictício): estado vazio/não encontrado |
| /propostas/analytics | composição própria sobre tokens | 16 cores cruas, 24 tokens de dialeto | cores cruas → tokens (16), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /propostas/nova | composição própria sobre tokens | 7 cores cruas, 4 hex, 109 tokens de dialeto | cores cruas → tokens (7), hex → tokens (4), dialeto resolvido na fonte (apelido de --fin-*), primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /relatorios | redirecionamento | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok → /relatorios/financeiro; 390: ok, rola 80px → /relatorios/financeiro) / depois (1440: ok → /relatorios/financeiro; 390: ok → /relatorios/financeiro) | — |
| /relatorios/comparativo | composição própria sobre tokens | 37 cores cruas, 61 tokens de dialeto | cores cruas → tokens (37), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok, rola 54px) / depois (1440: ok; 390: ok) | — |
| /relatorios/financeiro | composição própria sobre tokens | 1 hex, 77 tokens de dialeto | hex → tokens (1), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok, rola 80px) / depois (1440: ok; 390: ok) | — |
| /relatorios/lucro-real | MolduraDaPagina + fin/PageHeader | já em --fin-* | indicadores com ícone, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /relatorios/rentabilidade | composição própria sobre tokens | 9 cores cruas, 1 hex, 71 tokens de dialeto | cores cruas → tokens (9), hex → tokens (1), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /relatorios/taxas | MolduraDaPagina + fin/PageHeader | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /signup | composição própria sobre tokens | já em --fin-* | primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /suporte | composição própria sobre tokens | 72 cores cruas | cores cruas → tokens (72), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /suporte/[id] | composição própria sobre tokens | 58 cores cruas | cores cruas → tokens (58), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | validada sem registro real (id fictício): estado vazio/não encontrado |
| /vendas | PageShell (adaptador) + PageHeader (adaptador) | 1 hex, 10 tokens de dialeto | hex → tokens (1), dialeto resolvido na fonte (apelido de --fin-*), primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok); inspeção visual com dados (1440 e 390); tema escuro | — |
| /vendas/[id] | composição própria sobre tokens | 54 cores cruas, 50 tokens de dialeto | cores cruas → tokens (54), dialeto resolvido na fonte (apelido de --fin-*), primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | validada sem registro real (id fictício): estado vazio/não encontrado |
| /vendas/nova | composição própria sobre tokens | 38 cores cruas, 4 hex, 134 tokens de dialeto | cores cruas → tokens (38), hex → tokens (4), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /vendas/orcamentos | composição própria sobre tokens | 8 cores cruas, 50 tokens de dialeto | cores cruas → tokens (8), dialeto resolvido na fonte (apelido de --fin-*), moldura por tokens, primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |
| /voos | composição própria sobre tokens | 3 cores cruas, 97 tokens de dialeto | cores cruas → tokens (3), dialeto resolvido na fonte (apelido de --fin-*), primitivos e shell novos | varredura antes (1440: ok; 390: ok) / depois (1440: ok; 390: ok) | — |

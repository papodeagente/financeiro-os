# Design System do Entur OS Fin

Uma fonte de verdade para cor, tipografia, espaço, raio, sombra, altura, movimento e camada. Todas as telas internas, o Super Admin e os componentes compartilhados usam esses tokens. Revisão de 05/10/2026, com base num painel administrativo claro de referência: navegação branca, fundo muito claro, cartões brancos com borda fina, azul como cor de interação e verde, laranja, vermelho e violeta só onde têm significado.

## A regra para tela nova

1. **Layout.** A tela entra no shell global (`AppShell`: barra do topo com os pilares e barra lateral do pilar). Use `MolduraDaPagina` como moldura e `fin/PageHeader` como cabeçalho. Não escreva `p-6`, `max-w-7xl` nem título à mão.
2. **Componentes.** Use os componentes de `src/components/fin` e `src/components/ui`. Se faltar uma variação, **estenda a variante que já existe** antes de criar um componente novo.
3. **Cor.** Só `--fin-*`. O teste `scripts/test-design-system.ts` falha se aparecer qualquer um destes fora da lista de exceções:
   - classe de cor crua do Tailwind (`bg-blue-500`, `text-gray-600`);
   - hex dentro de classe (`bg-[#2563EB]`);
   - texto fixo sobre um preenchimento de destaque.
4. **Texto sobre preenchimento.** Fundo `--fin-accent` (ou positivo, negativo, violeta) leva sempre texto `--fin-text-on-fill`. `text-white` some no tema escuro, porque lá o azul clareia.
5. **Transparência.** Use `comAlfa(cor, %)` de `src/lib/cor.ts`. Nunca concatene alfa em hex (`cor + '20'`): com token isso vira CSS inválido e é descartado em silêncio.

## Tokens

Declarados em `src/app/globals.css`, no `:root` (tema claro) e em `.dark`. `--fin-*` é a **única** camada que declara valor. Os dialetos antigos continuam existindo como apelidos de uma linha, para não quebrar telas: `--t-*`, `--lg-*`, `--ink-*`, `--text-*`, `--elevation-*` e os semânticos do shadcn. Código novo usa só `--fin-*`.

### Cor

| Token | Claro | Uso |
|---|---|---|
| `--fin-bg` | `#F7F9FC` | Fundo da área de trabalho |
| `--fin-surface` | `#FFFFFF` | Cartão, painel, sobreposição, barra lateral |
| `--fin-surface-2` | `#F1F5F9` | Área secundária, hover de item, trilho |
| `--fin-surface-sunken` | `#EDF1F7` | Bloco rebaixado dentro de cartão |
| `--fin-border` / `--fin-border-strong` | `#E2E8F0` / `#CBD5E1` | Divisória, contorno de cartão / contorno de controle |
| `--fin-text` | `#0F172A` | Título e conteúdo principal |
| `--fin-text-2` | `#475569` | Conteúdo secundário, rótulo de indicador |
| `--fin-text-3` | `#5B6878` | Metadado. Mais escuro que o `#64748B` da referência, que fica abaixo de 4,5:1 sobre `--fin-surface-2` |
| `--fin-text-on-fill` | `#FFFFFF` (escuro: `#0F1621`) | Texto sobre preenchimento de destaque |
| `--fin-accent` / `-hover` / `-soft` / `-ring` | `#004aad` / `#003B8A` / `#E8EFF9` | Interação, link, foco, item ativo. Azul da marca Entur |
| `--fin-positive` / `-soft` | `#047857` / `#ECFDF5` | Recebido, conciliado, sucesso |
| `--fin-warning` / `-text` / `-soft` | `#d97706` / `#B45309` / `#FFFBEB` | Atenção |
| `--fin-negative` / `-text` / `-soft` | `#dc2626` / `#B42318` / `#FEF2F2` | Erro, atraso, ação destrutiva |
| `--fin-info` / `-soft` | `#2563eb` / `#EFF6FF` | Informação |
| `--fin-violet` / `-soft` | `#6D28D9` / `#F5F3FF` | Destaque complementar: categoria, Super Admin. Não é estado |
| `--fin-serie-1..6` | validadas | Séries de gráfico e categorias nominais. Cor de status nunca vira série |

### Tipografia

Inter em tudo, numa escala fechada de oito degraus. Use as classes `.fin-t-*`.

| Classe | Tamanho | Uso |
|---|---|---|
| `fin-t-resposta` | 32–44px | O número que a tela existe para dar (um por tela) |
| `fin-t-metric` / `fin-t-metric-sm` | 30 / 20px | Valor de indicador |
| `fin-t-title` | 24px | Título de página |
| `fin-t-subhead` | 16px | Título de seção e de diálogo |
| `fin-t-body` / `fin-t-body-strong` | 14px | Corpo (o piso de leitura) |
| `fin-t-caption` | 12px | Metadado, contexto do indicador |
| `fin-t-overline` | 11px, maiúsculas | Rótulo de grupo de navegação e de cabeçalho de tabela |

O corpo da página é 14px. Pesos usados: 400, 500 e 600.

### Espaço, raio, sombra, altura, movimento e camada

- **Espaço:** `--fin-s-1..6` = 4, 8, 12, 16, 24 e 40px. O respiro da página é `--fin-page-pad`: 16px até 1023px, 24px no desktop e 32px a partir de 1280px. A largura de leitura é `--fin-page-max` (1440px).
- **Raio:** `--fin-r-sm` 6px (chip, badge), `--fin-r-md` 8px (botão, campo, item de menu), `--fin-r-lg` 14px (cartão, painel, diálogo).
- **Sombra:**
  - `--fin-e-card`: um sopro, para cartão em repouso;
  - `--fin-e1`: o que flutua (menu, popover);
  - `--fin-e2`: o que cobre (diálogo, gaveta).
- **Altura de controle:** `--fin-h-compacto` 32px, `--fin-h-padrao` 40px e `--fin-h-confortavel` 44px. Abaixo de `lg`, botão e campo usam 44px (alvo de toque).
- **Movimento:** `--fin-dur-rapida` 120ms, `--fin-dur-base` 180ms, `--fin-curva`. Tudo vai a 0ms com `prefers-reduced-motion`.
- **Camada (z-index):** `--fin-z-conteudo` 10, `-cabecalho` 30, `-menu` 40, `-gaveta` e `-modal` 50, `-popover` 60 e `-toast` 100. Na classe: `z-[var(--fin-z-modal)]`.

### Tema escuro

O tema escuro é o mesmo conjunto de tokens com outros valores (`.dark`). Para ele funcionar não há nada a fazer, desde que a tela use token. O que quebra o tema escuro é exatamente o que o porteiro barra: hex, cor crua do Tailwind e texto branco fixo.

## Componentes e variantes

| Componente | Onde | Variantes e regra |
|---|---|---|
| `Button` | `ui/button` | Variantes `default` (destaque), `outline`, `secondary`, `ghost`, `destructive` e `link`. Tamanhos `xs`, `sm`, `default` (44/40px), `lg` e `icon*`. O foco é o anel global de 2px |
| `Input`, `Textarea`, `Select` | `ui/` | 44/40px de altura, raio 8, borda `--fin-border-strong`, foco pela borda de destaque. 16px no celular, para o iOS não dar zoom |
| `Badge` | `ui/badge` | Retângulo de raio pequeno, igual ao `StatusChip` |
| `StatusChip` | `fin/StatusChip` | Rótulo e tom vêm de um dicionário único por domínio (`receber`, `pagar`, `conciliacao`, `origem`...) |
| `EtiquetaDaPlataforma` | `fin/` | "via Hotmart/Asaas/Pagar.me" |
| `Card` | `ui/card` | Branco, borda fina, `--fin-e-card`, raio 14 |
| `MetricCard` | `fin/MetricCard` | Indicador com `contexto` obrigatório. `icone` opcional num quadrado de cor suave, cujo tom segue o papel do número (`tomDoIcone` só quando o assunto tem cor própria). `IconeDeIndicador` serve cartões que não podem ser `MetricCard` |
| `.kpi-card` (CSS legado) | `globals.css` | Mesmo desenho do `MetricCard`. Não use em tela nova |
| `PageHeader` | `fin/PageHeader` | Um H1 de 24px, no máximo uma ação primária, recarregar como ícone. O `components/PageHeader` é adaptador da API antiga e desenha igual |
| `MolduraDaPagina` | `fin/` | Respiro e largura por token. O `PageShell` é adaptador e desenha igual |
| `FilterBar`, `FinTable` | `fin/` | Busca, selects e resumo "N de M". Tabela com ordenação, total e `onLinhaClick` |
| `RecordSheet` | `fin/` | Gaveta lateral (480/640px) com resumo e ação primária fixos no rodapé |
| `ConfirmDialog` | `fin/` | Confirmação com "o que vai acontecer" por extenso, detalhes e variante destrutiva |
| `Dialog`, `Sheet`, `Tooltip` | `ui/` | Superfície branca, véu `rgb(15 23 42 / 0.4)` e camada por token |
| `DataState`, `EmptyLesson`, `EmptyState` | `fin/`, `components/` | Carregando (esqueleto com a forma do conteúdo), vazio (o que é e como começar) e erro |
| Gráficos | `fin/GraficoMoldura`, `Cascata`, `EscadaAcumulada`... | Regras próprias em `scripts/test-graficos-regressao.ts` |

## Padrões por tipo de tela

### Painel (dashboard)

O padrão é `fin/PageHeader` com o período, a resposta (um número), o gráfico ao lado, a grade de indicadores (`sm:grid-cols-2 xl:grid-cols-4`) e depois "precisa da sua atenção". Variação só aparece quando há período comparável. Exemplos: `/dashboard`, `/financeiro-ag`.

```tsx
<MolduraDaPagina>
  <PageHeader titulo="Financeiro" subtitulo="..." onRecarregar={load} />
  <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 lg:grid-cols-4">
    <MetricCard rotulo="Recebido" icone={ArrowDownLeft} valor={x} estado="ok" tone="positivo" contexto="..." />
  </div>
</MolduraDaPagina>
```

### Listagem

A ordem é `PageHeader` com a ação primária, depois os indicadores do recorte, a `FilterBar` e a `FinTable`. A tabela larga rola dentro do próprio contêiner. Exemplos: `/financeiro-ag/receber`, `/vendas`, `/pessoas/clientes`.

### Formulário

Campos agrupados por assunto em cartões, cada um com `Field` (rótulo, ajuda e erro associados). A ação principal fica no topo ou no rodapé da gaveta. No celular as grades viram uma coluna (`grid-cols-1 sm:grid-cols-3`). Sucesso só depois da resposta do servidor. Exemplo: `/config/agencia`.

### Tela operacional

A conferência acontece numa gaveta ao lado da linha, e não longe dela. A fila avança sozinha e tudo pode ser desfeito. Exemplo: `/financeiro-ag/conciliacao`. Editores de canvas (fluxograma, funil, mapa mental) ocupam a tela inteira. No celular os painéis laterais empilham abaixo do canvas, em vez de espremê-lo.

### Super Admin

É a mesma base do app: barra lateral branca e item ativo em azul suave. O contexto administrativo fica marcado pelo selo violeta "Super Admin". No celular, a lateral vira uma barra superior com navegação rolável.

### Interfaces públicas

A landing (`/` sem sessão), a proposta pública (`/p/[slug]`) e o mapa público mantêm a identidade e as cores próprias, ou as do tenant. Elas aparecem na lista de exceções do porteiro.

## Exceções (conteúdo, não interface)

As cores destes lugares são do usuário, do modelo da proposta ou da marca. A lista exata, com o motivo de cada item, fica em `scripts/test-design-system.ts`:

- landing pública;
- documento da proposta (prévia, PDF, blocos, `/p/`);
- mapa mental (editor e público);
- nós do fluxograma e do funil;
- miniatura de janela da biblioteca do funil;
- ícones de marca e logotipo.

## Ferramentas

As ferramentas da migração ficam em `scripts/design/` e todas rodam em modo de relatório por padrão (`--gravar` grava):

- `tokenizar-cores.py`: cor crua do Tailwind para token semântico;
- `tokenizar-hex.py`: hex de interface para token, com mistura por `color-mix`;
- `texto-sobre-preenchimento.py`: texto fixo sobre destaque para `--fin-text-on-fill`;
- `sombra-dos-cards.py`: o sopro de sombra nos cartões escritos à mão;
- `admin-claro.py`: telas do Super Admin para a base clara.

O porteiro é `scripts/test-design-system.ts`, que roda no `npm test`.

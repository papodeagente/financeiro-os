# Redesenho do módulo financeiro do Entur OS FIN
## Especificação única de execução

Versão 1.0, 2026-09-06. Base: repositório `/Users/brunobarbosa/financeiro-os`, HEAD `26bb399`.
Destinatário: o agente que vai executar. Este documento se basta. Não é preciso ler nada anterior.

---

### Veredito e direção escolhida

Três direções foram julgadas por três juízes. Placar:

| Direção | Juiz 1 | Juiz 2 | Juiz 3 | Média |
|---|---|---|---|---|
| Ferramenta de trabalho (planilha viva) | 53 | 53 | 49 | 51,7 |
| Sistema antes de tela (fundação canônica) | 49 | 49 | 52 | 50,0 |
| Linguagem primeiro (pergunta no título) | 43 | 35 | 38 | 38,7 |

Dois juízes elegeram "Ferramenta de trabalho". O terceiro, único que abriu o repositório, elegeu "Sistema antes de tela" e escreveu que "se as duas primeiras ideias dela forem enxertadas na proposta 3, o resultado é melhor que qualquer uma das duas isolada". Os outros dois disseram o inverso com as mesmas palavras: "vale como espinha dorsal de execução da vencedora" e "o melhor plano de execução das três amarrado à tese menos ambiciosa".

**Decisão: tese visual e redesenho tela a tela de "Ferramenta de trabalho"; mecânica de migração, portões de verificação e fatiamento de "Sistema antes de tela"; treze enxertos pontuais de "Linguagem primeiro".** Os três juízes convergem nisso; não é meio-termo, é a leitura literal dos três pareceres.

"Linguagem primeiro" foi reprovada como direção pelos três, por três motivos: 18 a 24 dias auto-orçados contra 7 a 9; metade do que chama de apresentação é mudança de produto; e o tom de pergunta no H1 ("Vai faltar dinheiro?") empurra o produto para fintech de consumo, o oposto do benchmark pedido. As boas ideias dela foram extraídas uma a uma e estão marcadas no texto com `[enxerto]`.

---

## 1. Diagnóstico em uma página

### 1.1 O defeito de origem

O produto não parece amador por gosto ruim. Parece amador porque nenhuma decisão é a mesma duas vezes. O olho não lê "cinza errado", lê "ninguém decidiu".

O bug fundador está em `src/app/globals.css`. Um único bloco `:root` abre na linha 52 e fecha na 304. Dentro dele, os tokens `--t-*` são declarados duas vezes: com os valores da identidade Entur nas linhas 156 a 247, e de novo nas linhas 251 a 303 como alias dos `--lg-*`. Mesma especificidade, o último vence. O primeiro bloco inteiro é código morto.

```
globals.css:164   --t-green: #004aad;        <- identidade Entur
globals.css:264   --t-green: var(--lg-accent);  <- vence
globals.css:121   --lg-accent: #4F46E5;      <- índigo
```

`--t-green` é o terceiro token mais usado do produto (546 usos) e resolve em índigo. **O azul #004aad não pinta um único pixel do módulo financeiro hoje.**

### 1.2 A correção que os três juízes quase perderam

Verificado no repositório, e isto muda o plano de todo mundo:

```
layout.tsx:35   className="... antialiased dark"
layout.tsx:39   var t = localStorage.getItem('entur-theme') || 'dark';
ThemeContext.tsx:12,15,20   default 'dark'
globals.css:307 .dark { ... }
globals.css:418   --lg-accent: #3B82F6;   <- alias escuro, outro azul
```

**O produto abre no escuro.** Existe um segundo bloco de alias dentro de `.dark`. Editar apenas o `:root` claro não muda um pixel para o usuário que abre o sistema hoje. Duas das três propostas prometiam "40% da percepção de qualidade em meio dia" reescrevendo só o bloco claro; entregariam zero. A Fase 0 desta especificação inclui o flip para claro, obrigatoriamente.

Pior, e ninguém tinha visto: `src/components/ui/card.tsx:18-23` crava `background: '#ffffff'` em `style` inline. No tema escuro, todo Card é branco com texto quase branco. O estilo inline também vence a regra global de raio, o que produz o card de 18px encostado no botão de 0px.

### 1.3 Os números medidos

Medidos agora, com `grep`, em `src/app/financeiro-ag` (10 telas, 5.965 linhas):

| Métrica | Valor | Comentário |
|---|---|---|
| Sistemas de token concorrentes | 4 | `--t-*` 6.222 usos, `--ink*` 468, `--lg-*` 358, shadcn 35 |
| Nomes de token únicos | 203 | em 396 declarações |
| `text-[Npx]` no módulo | **91** | em 9 valores distintos, incluindo 12.5px e 14.5px |
| `text-[Npx]` na base inteira | 1.177 | |
| Tamanhos de fonte em 10px ou menos | 21 no módulo, 642 na base | |
| Blocos `style={{` no módulo | 111 | |
| `<select>` nativo | 23 | `ui/select.tsx` existe, zero uso no financeiro |
| `<label>` / `htmlFor` | 66 / **1** | |
| Atributos `aria-` no módulo inteiro | **1** | |
| `confirm()` e `prompt()` | 10 | inclusive na baixa de recebimento |
| Formatadores `BRL` duplicados | 7 | `formatBRL` já existe em `lib/utils.ts:22` |
| Raios distintos | ~25 | `card.tsx` sozinho usa quatro |
| Formas de sombra | 32 | |
| Larguras de página | 5 | 1400 / 1280 / 1152 / 1024 |
| `<h1>` "Financeiro" na home | 2 | `page.tsx:330` e `:339` |

Três agravantes estruturais:

1. **`.min-shell` envolve o `<main>` de todo o produto** (`AppShell.tsx:150`), apesar do comentário em `globals.css:1303` dizer que é escopado. O bloco 1490 a 1548 zera raio de botão (1497), input (1505), card (1519) e badge (1536), e zera `box-shadow` em `[data-slot="button"]`, o que apaga o anel de foco global de `globals.css:1092`. **Nenhum botão do módulo tem foco visível por teclado.**
2. **`crm-storage.ts:3-11` transforma falha de rede em lista vazia** com `catch { return []; }`. É usado por 9 das 10 telas. Quando o servidor cai, o sistema diz "nenhum lançamento" e o painel mostra R$ 0,00 convincente. O dono lê "minha agência não tem dinheiro".
3. **Primitivos abandonados.** `ui/KpiCard.tsx` e `ui/QuickAction.tsx` têm zero imports. `select.tsx`, `dialog.tsx`, `sheet.tsx`, `tabs.tsx`, `tooltip.tsx` têm zero uso no financeiro. O esforço de ter um design system foi neutralizado por CSS global e por remontagem à mão.

### 1.4 O custo disso para o dono da agência

Na home, aproximadamente 20 alvos clicáveis antes do conteúdo útil, cinco deles decorativos: o seletor de 5 períodos é escrito e nunca lido por nenhum cálculo (`page.tsx:84`, comentário "atualmente visual"). O bloco que responde à pergunta real ("o que vence primeiro") está no rodapé, truncado em 5 itens, ordenado por data de emissão mas exibindo data de vencimento, com a data em ISO cru. Em Contas a pagar, dar baixa custa 3 cliques e 1 modal por conta; 20 contas custam 60 cliques.

---

## 2. Princípios do redesenho

Oito. Cada um tem um teste que dá para rodar em revisão de código.

### P1. Um número em destaque por tela
Exatamente um elemento com a classe `.fin-t-metric` (30px) por tela. Indicadores secundários usam `.fin-t-metric-sm` (20px). Nenhum outro texto da tela alcança 30px.

**Verificação:** `grep -c "fin-t-metric\b" <arquivo>` retorna 1. `grep -rE "text-\[[3-9][0-9]px\]|fontSize: *'?[3-9][0-9]" src/app/financeiro-ag` retorna 0.

**Decisão registrada:** os juízes 1 e 2 acusaram a regra original ("um número herói por dobra") de ser regra de portfólio, porque em Contas a pagar os três totais úteis são simultâneos, e em Fluxo de caixa a comparação entre dois números é a informação. O juiz 3 acusou a ausência da regra de ser o que devolve quatro números de 28px à mesma faixa. Resolvi mantendo a regra e movendo o corte: vários indicadores continuam permitidos, mas só um deles em 30px. Satisfaz as duas críticas e continua verificável por grep.

### P2. Cor é semáforo, não decoração
Cor colorida (fora de `--fin-text`, `--fin-text-2`, `--fin-text-3` e as bordas) só aparece em quatro papéis: valor cujo sinal é informação, chip de estado, a única ação primária da dobra, e faixa de alerta. Proibido atribuir cor por posição.

**Verificação:** `grep -n "nth-child" src/app/globals.css` não retorna nenhuma regra que defina cor. Nenhum array de cores é indexado por `i` no JSX. No máximo um elemento com fundo `--fin-accent` por dobra.

### P3. Escala fechada, arbitrário proibido
Oito degraus tipográficos, seis de espaçamento, três de raio, três de sombra. Proibidos: `text-[Npx]`, `fontSize` inline, as classes de escala do Tailwind (`text-xs/sm/base/lg/xl`) e os fracionários (`py-1.5`, `gap-0.5`, `mt-0.5`).

**Verificação:** `grep -rho "text-\[[0-9.]*px\]" src/app/financeiro-ag | wc -l` retorna 0 (hoje 91).

### P4. Zero estilo inline
Nenhum `style={{}}` em `src/app/financeiro-ag`. Exceção única e explícita: passagem de valor calculado em runtime como custom property (`style={{ '--fin-meter': pct }}`), nunca como propriedade CSS direta.

**Verificação:** `grep -ro "style={{" src/app/financeiro-ag | wc -l` retorna 0 (hoje 111). Pré-requisito: remover o `style` inline de `card.tsx:18-23`, senão o primitivo continua vencendo o sistema por especificidade.

### P5. Primitivo ou nada
Nenhum `<select>`, `<button>`, `<table>`, `<label>` ou `<input>` nativo dentro do módulo.

**Verificação:** `grep -rEo "<(select|table)\b|<button\b|<label\b|<input\b" src/app/financeiro-ag | wc -l` retorna 0 (hoje 23 selects, 42 botões, 4 tabelas, 66 labels).

### P6. Dinheiro tem uma gramática só
Nenhum arquivo formata BRL. Tudo passa por `<Money>`, que delega a `formatBRL` de `lib/utils.ts`. Toda célula de dinheiro é alinhada à direita, `tabular-nums`, mesma família.

**Verificação:** `grep -rn "const BRL\|toLocaleString" src/app/financeiro-ag | wc -l` retorna 0 (hoje 7 formatadores).

### P7. Zero é uma afirmação, não um placeholder
Enquanto o estado for `carregando` ou `erro`, nenhum valor monetário é pintado. Proibidos: `catch` vazio, `.catch(() => [])`, e `toast.success` fora do caminho feliz confirmado.

**Verificação:** `grep -rn "catch {\s*}\|catch { /\* silent" src/app/financeiro-ag` retorna 0. Toda função `load()` tem `try/catch/finally`. `<Money>` recusa por tipo renderizar número quando `estado !== 'ok'`.

`[enxerto de Linguagem primeiro]` O estado vive no tipo do `Money`, não só no envelope externo. Cinto e suspensório no defeito mais grave do produto: se um bloco esquecer o `DataState`, o `Money` ainda assim não pinta zero falso.

### P8. Nada clicável que não faça
Todo controle interativo altera estado observável. Controle inerte é removido, não desabilitado com aparência de ativo.

**Verificação:** toda variável de estado de filtro aparece em pelo menos um `filter`, `reduce` ou `fetch`, além do próprio render do controle. Hoje `periodoHeader` na home falha nesse teste, e a pílula de status "Vencido" em Contas a pagar nunca casa com nada porque o sistema jamais grava esse status.

---

## 3. Tokens canônicos

### 3.1 Estratégia de convivência

**Os tokens antigos continuam existindo.** Nada é renomeado no JSX. Os 6.222 usos de `--t-*`, 468 de `--ink*` e 358 de `--lg-*` permanecem intactos e passam a apontar para a camada nova.

O mecanismo é o mesmo que causou o bug, usado a favor: o bloco de alias das linhas 251 a 303 já vence por ordem de cascata. **Ele é reescrito, não apagado.**

`[enxerto de Sistema antes de tela]` Os juízes 1 e 2 preferiram reescrever a apagar: preserva a ordem de cascata conhecida, mantém o diff local, e a reversão é um commit. Apagar o primeiro bloco expõe 147 arquivos a um comportamento que ninguém observou.

Regra dura: **`--fin-*` é a única camada que declara valor.** Todo o resto é alias de uma linha. Código novo usa apenas `--fin-*`; os nomes antigos entram na lista de avisos do lint.

### 3.2 A tabela definitiva

Valores do tema claro. Contraste medido com WCAG 2.1 contra `#FFFFFF` (superfície) e `#F7F8FC` (fundo da página).

| Token novo | Valor | Contraste | `--t-*` que mapeia | `--ink*` | `--lg-*` | shadcn |
|---|---|---|---|---|---|---|
| `--fin-bg` | `#F7F8FC` | fundo | `--t-bg` | `--ink-bg` | `--lg-bg` | `--background` |
| `--fin-surface` | `#FFFFFF` | superfície | `--t-surface` | `--ink-surface` | `--lg-material-regular` | `--card` |
| `--fin-surface-2` | `#F1F3F9` | hover, cabeçalho de tabela | `--t-surface-hover` | `--ink-surface-2` | `--lg-material-thick` | `--muted` |
| `--fin-surface-sunken` | `#EDF0F7` | linha de total | (novo) | | | |
| `--fin-border` | `#E4E7EF` | 1,24:1 | `--t-border` | `--line` | `--lg-border-base` | `--border` |
| `--fin-border-strong` | `#CBD3E1` | 1,51:1 | `--t-border-hover` | `--line-strong` | `--lg-border-strong` | |
| `--fin-text` | `#1A1A1A` | 17,40 / 16,40 | `--t-text` | `--ink` | `--lg-text` | `--foreground` |
| `--fin-text-2` | `#475569` | 7,58 / 7,14 | `--t-text-secondary` | `--ink-2` | `--lg-text-2` | |
| `--fin-text-3` | `#5B6878` | 5,68 / 5,35 | `--t-text-muted` | `--ink-3` | `--lg-text-3` | `--muted-foreground` |
| `--fin-text-on-fill` | `#FFFFFF` | 8,13 sobre accent | | | | `--primary-foreground` |
| `--fin-accent` | `#004aad` | 8,13 / 7,66 | `--t-green`, `--t-primary`, `--t-accent`, `--t-blue` | | `--lg-accent` | `--primary`, `--ring` |
| `--fin-accent-hover` | `#003B8A` | | `--t-green-hover` | | `--lg-accent-hover` | |
| `--fin-accent-soft` | `#E8EFF9` | accent sobre ele: 7,03 | `--t-green-bg`, `--t-primary-bg`, `--t-blue-bg`, `--t-accent-muted` | | `--lg-accent-fill` | |
| `--fin-accent-ring` | `rgba(0,74,173,0.28)` | anel de foco | | | | |
| `--fin-positive` | `#047857` | 5,48 / 5,17 | `--t-status-success` | `--pos` | `--lg-pos` | |
| `--fin-positive-soft` | `#ECFDF5` | positivo sobre ele: 5,21 | `--t-status-success-bg` | | `--lg-pos-fill` | |
| `--fin-negative` | `#dc2626` | 4,83 / 4,55 | `--t-red`, `--t-status-danger` | `--neg` | `--lg-neg` | `--destructive` |
| `--fin-negative-text` | `#B42318` | 6,57 / 6,01 sobre soft | | | | |
| `--fin-negative-soft` | `#FEF2F2` | | `--t-red-bg`, `--t-status-danger-bg` | | `--lg-neg-fill` | |
| `--fin-warning` | `#d97706` | 3,19, só preenchimento | `--t-amber`, `--t-status-warning` | `--warn` | `--lg-warn` | |
| `--fin-warning-text` | `#B45309` | 5,02 / 4,84 sobre soft | | | | |
| `--fin-warning-soft` | `#FFFBEB` | | `--t-amber-bg`, `--t-status-warning-bg` | | `--lg-warn-fill` | |
| `--fin-info` | `#2563eb` | 5,17 / 4,75 sobre soft | `--t-status-info` | | | |
| `--fin-info-soft` | `#EFF6FF` | | `--t-status-info-bg` | | | |

### 3.3 Correções de contraste que só apareceram na medição

Três valores que as propostas traziam e que **reprovam AA**. Foram corrigidos:

| Proposto | Medido | Substituto | Medido |
|---|---|---|---|
| `#64748B` para texto suave | 4,48:1 sobre `#F7F8FC` | **`#5B6878`** | 5,35:1 |
| `#dc2626` como texto sobre `#FEF2F2` | 4,41:1 | **`#B42318`** | 6,01:1 |
| `#10B981` como positivo (herdado) | 2,54:1 | **`#047857`** | 5,48:1 |

`#64748B` é o valor da identidade para "texto secundário" e passa sobre branco (4,76). Reprova sobre o fundo da página por 0,02. Como ele pinta rótulo de coluna e legenda em cima dos dois fundos, `--fin-text-3` sobe para `#5B6878`. A identidade é preservada onde ela é visível (o azul, o fundo, o texto principal, os três semânticos); o ajuste é de 3% de luminosidade num cinza de apoio.

`#94A3B8` (2,56:1) **é banido de texto.** Sobrevive apenas como `--fin-border-strong` e traço decorativo de gráfico. Isso mata de uma vez os índices mono de 10px, os separadores e os sublinhados de link da home.

### 3.4 Par escuro obrigatório

O produto tem um alternador de tema real no `TopBar`. Os 24 tokens ganham par escuro, redefinido em `.dark`, e nada mais. Todos os pares medidos passam AA sobre a superfície escura.

| Token | Claro | Escuro | Contraste sobre `#172131` |
|---|---|---|---|
| `--fin-bg` | `#F7F8FC` | `#0F1621` | fundo |
| `--fin-surface` | `#FFFFFF` | `#172131` | superfície |
| `--fin-surface-2` | `#F1F3F9` | `#1E2A3B` | |
| `--fin-surface-sunken` | `#EDF0F7` | `#131C29` | |
| `--fin-border` | `#E4E7EF` | `#2A3648` | |
| `--fin-border-strong` | `#CBD3E1` | `#3B4A61` | |
| `--fin-text` | `#1A1A1A` | `#F1F5F9` | 14,76 |
| `--fin-text-2` | `#475569` | `#CBD5E1` | 10,32 |
| `--fin-text-3` | `#5B6878` | `#94A3B8` | 6,31 |
| `--fin-accent` | `#004aad` | `#5B9BFF` | 5,84 |
| `--fin-accent-soft` | `#E8EFF9` | `rgba(91,155,255,0.16)` | |
| `--fin-positive` | `#047857` | `#34D399` | 8,41 |
| `--fin-negative` / `-text` | `#dc2626` / `#B42318` | `#F87171` | 5,85 |
| `--fin-warning-text` | `#B45309` | `#FBBF24` | 9,69 |
| `--fin-info` | `#2563eb` | `#7DA9FF` | |

O par escuro **não é auditado tela a tela nesta rodada** (ver seção 14). Ele existe para garantir que ninguém caia numa tela ilegível, não para ser o tema recomendado.

### 3.5 Tema padrão vira claro

`[enxerto de Linguagem primeiro, confirmado no repositório]` Único juiz que viu isto. Sem esta mudança, toda a Fase 0 é invisível.

1. `layout.tsx:35`: remover `dark` do `className` do `<html>`.
2. `layout.tsx:39`: o script inline passa a ler a chave nova e a assumir claro:
   `var t = localStorage.getItem('entur-theme-v2') || 'light'; if (t === 'dark') document.documentElement.classList.add('dark');`
3. `ThemeContext.tsx:12,15,20`: default `'light'`, chave `'entur-theme-v2'`.

A chave é versionada de propósito. Quem tinha `entur-theme: dark` salvo cai em claro uma vez, sem que ninguém precise limpar `localStorage` remotamente, e continua livre para voltar ao escuro pelo `TopBar`.

### 3.6 Tokens órfãos, apagados no mesmo commit

`--motion-*` (3, zero uso), `--space-*` (10, zero uso no JSX), `--lg-blur-*` (3, valem `none`), `--lg-radius-sm`, `--lg-stat-cyan`, `--lg-stat-pink`, `--t-pillar-bg`, `--t-table-header-bg`, `--t-table-header-text`.

E o inverso: **`--text-h2` é usado em 3 arquivos (`PageHeader.tsx:28`, `funis/page.tsx:288`, `ModalComparacao.tsx:55`) e nunca foi declarado.** `PageHeader size="sm"` renderiza sem tamanho e herda 13px do body. Passa a existir como alias de `.fin-t-title`.

---

## 4. Escala tipográfica

Inter em tudo (`var(--font-inter)`). JetBrains Mono apenas em identificador técnico: código do plano de contas, número de documento, id de transação. **Nunca em dinheiro.**

**Decisão registrada:** "Linguagem primeiro" pedia JetBrains Mono para dinheiro em tabela. Recusado, e o juiz 2 registrou que a proposta vencedora "a refuta corretamente". Mono em 14px numa coluna de valores fica largo e mecânico ao lado do Inter da mesma linha; Inter com `font-variant-numeric: tabular-nums` alinha igual e pertence à página. É também contradição interna da proposta, que defendia alinhamento tabular e mono ao mesmo tempo.

| Classe | Tamanho | Peso | Entrelinha | Tracking | Extras | Uso |
|---|---|---|---|---|---|---|
| `.fin-t-metric` | 30px | 600 | 1.05 | -0.025em | `tabular-nums` | Número grande de destaque. **Um por tela.** |
| `.fin-t-metric-sm` | 20px | 600 | 1.2 | -0.015em | `tabular-nums` | Indicador secundário, total de rodapé, valor no diálogo de baixa |
| `.fin-t-title` | 20px | 600 | 1.25 | -0.01em | | H1 da página. Um por tela |
| `.fin-t-subhead` | 16px | 600 | 1.35 | -0.005em | | Título de seção, de card e de diálogo |
| `.fin-t-body-strong` | 14px | 600 | 1.45 | 0 | | Nome de fornecedor, rótulo de campo, **número de tabela** (com `tabular-nums`) |
| `.fin-t-body` | 14px | 400 | 1.45 | 0 | | Corpo, célula de tabela, valor de campo, texto de botão |
| `.fin-t-caption` | 12px | 400 | 1.4 | 0 | | Apoio: legenda de campo, sublinha de célula, contexto sob número. **Piso do produto** |
| `.fin-t-overline` | 11px | 600 | 1.2 | +0.06em | `uppercase` | Rótulo de métrica, cabeçalho de coluna. Único degrau abaixo de 12px |

**Número de tabela** usa `.fin-t-body-strong` mais `tabular-nums`, aplicado pelo componente `Money`, nunca à mão.

**Abolidos:** 9px, 9.5px, 10px, 12.5px, 13px, 14.5px, 15px, 18px, 24px, 26px, 28px, 34px, 38px, 42px. Os 91 arbitrários do módulo e os 34 valores da base colapsam em 8.

`.fin-t-overline` a 11px é o único abaixo de 12px, e só passa porque é 600 em `#5B6878` maiúsculo. Qualquer outro texto abaixo de 12px é bug.

---

## 5. Espaçamento, raio e sombra

### 5.1 Espaçamento

Grade de 4px, seis degraus: **4, 8, 12, 16, 24, 40**. Uma regra de uso por degrau, verificável em revisão.

| Valor | Regra de uso |
|---|---|
| 4 | Entre glifo e seu texto; entre rótulo e o valor logo abaixo; entre chips |
| 8 | Entre irmãos de um mesmo grupo: botões de uma barra, campos de uma linha |
| 12 | Gap de grade de campos; padding vertical de célula de tabela; gap de itens de lista |
| 16 | Padding interno de card e de painel; gap entre cards de uma faixa |
| 24 | **Único** ritmo vertical entre blocos irmãos da página. Aplicado só pelo `PageShell` |
| 40 | Uma vez por página, entre a faixa de cabeçalho e o primeiro bloco |

**Proibido somar margem de componente com `space-y` do shell.** É o que hoje produz 48px entre cabeçalho e indicadores em Contas a pagar (`mb-6` do `MinimalPageHead` mais `space-y-6` do `PageShell`) contra 24px em todo o resto. Nenhum filho do `PageShell` carrega `margin-bottom` próprio.

Proibidos: `py-1.5`, `gap-0.5`, `mt-0.5`, `mb-2.5`, `mb-10`, `gap-12`.

**Largura de página: 1280px, uma só,** com padding lateral de 24px (16px abaixo de 1024px). Substitui as cinco atuais.

### 5.2 Raio

Três níveis mais um caso especial.

| Token | Valor | Uso |
|---|---|---|
| `--fin-r-sm` | 6px | Chip de estado, badge, caixa de seleção |
| `--fin-r-md` | 10px | Botão, input, select, textarea, item de menu |
| `--fin-r-lg` | 12px | Card, painel, diálogo, sheet, popover. É o `0.75rem` da identidade |
| `--fin-r-dot` | 999px | **Apenas** o ponto de estado de 6px de diâmetro |

**Decisão registrada:** "Sistema antes de tela" abolia a pílula redonda por completo, e o juiz 1 chamou isso de excesso de dureza que "quebra padrão visual fora do módulo". Concordo em parte: a pílula sai dos filtros (viram `Select` e `Segmented`), mas o ponto de 6px do `StatusChip` continua redondo, porque um ponto quadrado de 6px lê como sujeira.

**Pré-requisitos obrigatórios,** sem os quais nada disso funciona:
1. Remover `style={{ background, border, borderRadius, boxShadow }}` de `card.tsx:18-23`. O inline vence a classe.
2. Remover `border-radius: 0` de `globals.css` linhas 1497 (button), 1505 (input/textarea/select), 1519 (card) e 1536 (badge).

Reduz ~25 raios distintos para 3.

### 5.3 Sombra

Três níveis mais o anel de foco. **Card em repouso não tem sombra:** a separação vem da borda 1px `--fin-border` sobre o fundo `--fin-bg`. É esta decisão que elimina 29 das 32 formas atuais.

| Token | Valor | Uso |
|---|---|---|
| `--fin-e0` | `none` | Card, painel, faixa. O padrão de 90% das superfícies |
| `--fin-e1` | `0 4px 12px rgba(16,24,40,0.08)` | Flutuante pequeno: popover, tooltip, menu de select, cabeçalho de tabela em rolagem |
| `--fin-e2` | `0 16px 40px rgba(16,24,40,0.14)` | Diálogo e sheet, os únicos que descolam da página |
| `--fin-ring` | `outline: 2px solid var(--fin-accent); outline-offset: 2px` | `:focus-visible` |

**O foco é `outline`, deliberadamente, e nunca `box-shadow`.** O anel atual (`globals.css:1092`) é `box-shadow` e é anulado por `.min-shell [data-slot="button"] { box-shadow: none }` (linha 1497). Trocar para `outline` é a correção de acessibilidade mais barata de todo o plano: uma linha devolve foco visível a todos os botões do produto.

### 5.4 Movimento

`[enxerto de Linguagem primeiro]` **Proibida animação de conteúdo em tela de dinheiro.** Sem entrada de bloco, sem contador subindo, sem transição de card, sem `transform` em hover de linha. Movimento lê como número instável. Permitido apenas: transição de foco, hover de cor (150ms), e o painel lateral abrindo.

### 5.5 Impressão

Um bloco `@media print` de ~15 linhas entra na fundação, porque um sistema construído sobre "sem sombra, borda 1px, fundo `#F7F8FC`" imprime cinza sobre cinza:

```css
@media print {
  :root { --fin-bg: #FFFFFF; --fin-surface: #FFFFFF; --fin-border: #999999; --fin-surface-2: #FFFFFF; --fin-surface-sunken: #FFFFFF; }
  .fin-no-print, nav, aside, [data-slot="sheet"] { display: none !important; }
  [data-fin-table] thead { display: table-header-group; }
  [data-fin-table] tr { break-inside: avoid; }
  a[href]::after { content: none; }
}
```

Redesenho completo de impressão fica fora de escopo (seção 14). Isto garante legibilidade, não beleza.

---

## 6. Cor semântica

### 6.1 Os cinco papéis

| Papel | Texto | Preenchimento / ícone | Fundo | Borda | Significa |
|---|---|---|---|---|---|
| Positivo | `#047857` | `#047857` | `#ECFDF5` | `#047857` a 24% | Entrada efetivada, variação favorável ao caixa |
| Negativo | `#B42318` sobre soft, `#dc2626` sobre branco | `#dc2626` | `#FEF2F2` | `#dc2626` a 24% | Vencido, saldo negativo, prejuízo, ação destrutiva |
| Aviso | `#B45309` | `#d97706` | `#FFFBEB` | `#d97706` a 24% | Vence em até 7 dias, uso de cartão acima do limite saudável, dado parcial |
| Informação | `#2563eb` | `#2563eb` | `#EFF6FF` | `#2563eb` a 24% | Origem automática, importado do CRM, agendado |
| Neutro | `#1A1A1A` | `#5B6878` | `#F1F3F9` | `#E4E7EF` | Todo o resto, e é a maioria |

O par texto/preenchimento existe porque `#d97706` dá 3,19:1 sobre branco e o chip PENDENTE é a pastilha mais frequente do sistema. A identidade âmbar é preservada onde ela é vista (ícone, barra, borda, fundo); o texto usa o par escurecido.

### 6.2 Regra de entrada da cor

`[da proposta vencedora, mantida literalmente]`

**Cor semântica só entra quando o sinal muda a decisão.**

- Em Contas a pagar, um valor a pagar **não é vermelho**, porque pagar é o esperado. Vermelho fica reservado para vencido.
- Em Contas a receber, um valor a receber **não é verde**. Verde fica reservado para recebido.
- Saldo positivo é neutro, porque não exige ação. Saldo negativo é vermelho, porque exige.
- Toda a coluna de dinheiro colorida de verde e vermelho é ruído em 30 linhas e apaga o sinal onde ele importa.

Isso mata de vez o defeito atual em que "Faturamento" fica verde e "Despesas" vermelho por acidente de posição na grade (`globals.css:1359-1362`, `nth-child`).

### 6.3 Cor nunca é o único portador de significado

**Regra dura:** todo estado carrega um segundo portador. Um dos três: rótulo em texto, glifo com forma distinta, ou ponto de estado antes do texto.

Dois pontos do produto violam isso hoje e são corrigidos por componente, não por disciplina:

| Onde | Hoje | Depois |
|---|---|---|
| Margem do período (cortes em 15% e 8%) | só muda de cor | `<Meter>` com rótulo "Saudável", "Atenção", "Crítico" ao lado do número |
| Utilização de cartão (cortes em 85% e 60%) | só muda de cor | idem |

`[enxerto de Sistema antes de tela]` **Os cortes numéricos (85, 60, 15, 8) saem do JSX para uma função nomeada e exportada**, com os mesmos limites, sem arredondar. Hoje são regra de negócio escondida dentro de um `style` inline, onde ninguém encontra para auditar.

```ts
// src/lib/faixas.ts
export type Faixa = 'saudavel' | 'atencao' | 'critico';
export function faixaUtilizacaoCartao(pct: number): Faixa {
  if (pct > 85) return 'critico';
  if (pct > 60) return 'atencao';
  return 'saudavel';
}
export function faixaMargem(pct: number): Faixa {
  if (pct < 8) return 'critico';
  if (pct < 15) return 'atencao';
  return 'saudavel';
}
export const ROTULO_FAIXA: Record<Faixa, string> = {
  saudavel: 'Saudável', atencao: 'Atenção', critico: 'Crítico',
};
```

### 6.4 Um preenchimento por dobra

No máximo um botão com fundo `--fin-accent` visível por dobra de 800px. Todo o resto é `outline`, `ghost` ou `link`. **Preto (`--ink`) deixa de ser cor de ação.** Hoje existem cinco tratamentos de botão primário no módulo (preto, `--t-green` índigo, `bg-green-600` cru, índigo, gradiente).

---

## 7. Biblioteca de componentes

Todos em `src/components/fin/`. Diretório novo, deliberadamente: não é `ui/` (shadcn, genérico) nem `financeiro/` (o dialeto antigo, que morre).

**Regra de higiene:** ao criar um componente que substitui outro, apagar o substituído no mesmo commit. `ui/KpiCard.tsx` e `ui/QuickAction.tsx` têm zero imports hoje. Se `MetricCard` nascer sem que `ui/KpiCard.tsx` morra, o resultado é mais um dialeto ao lado dos `.min-*` e dos `.kpi-card__*`.

**Atenção:** existe um `KpiCard` homônimo definido dentro de `funis/PainelKPIs.tsx:182`, fora do módulo. Não é o mesmo componente e **não deve ser apagado**.

### 7.1 `Money` (`src/components/fin/Money.tsx`)

Único renderizador de dinheiro do módulo. Substitui os 7 formatadores duplicados e as 25 células com `text-right` sem `tabular-nums`. **Nunca calcula.**

```ts
import { cva, type VariantProps } from 'class-variance-authority';

export const moneyVariants = cva('fin-money tabular-nums', {
  variants: {
    size: {
      caption: 'fin-t-caption',
      body: 'fin-t-body',
      strong: 'fin-t-body-strong',
      metricSm: 'fin-t-metric-sm',
      metric: 'fin-t-metric',
    },
    tone: {
      neutro: 'text-[var(--fin-text)]',
      positivo: 'text-[var(--fin-positive)]',
      negativo: 'text-[var(--fin-negative)]',
      suave: 'text-[var(--fin-text-3)]',
    },
    align: { direita: 'text-right', esquerda: 'text-left' },
  },
  defaultVariants: { size: 'body', tone: 'neutro', align: 'direita' },
});

export type MoneyEstado = 'ok' | 'carregando' | 'indisponivel';

export type MoneyProps = VariantProps<typeof moneyVariants> & {
  /** Valor já calculado pelos helpers auditados. O componente nunca faz aritmética. */
  valor: number | null | undefined;
  /** 'carregando' e 'indisponivel' NUNCA pintam número. Impede o R$ 0,00 falso. */
  estado?: MoneyEstado;
  /** Moeda estrangeira exibida como sublinha em caption, nunca em coluna nova. */
  original?: { valor: number; moeda: string; cambio: number } | null;
  /** 'auto' mostra menos em negativo; 'sempre' força o + em positivo. */
  sinal?: 'auto' | 'nunca' | 'sempre';
  /** Código ISO. Default 'BRL'. Existe para o i18n futuro não exigir reescrita. */
  moeda?: string;
  className?: string;
  'aria-label'?: string;
};
```

Comportamento obrigatório:
- `estado === 'carregando'` renderiza uma barra de esqueleto com a largura do degrau, nunca um número.
- `estado === 'indisponivel'` renderiza `—` em `--fin-text-3` com `title="Não foi possível carregar"`.
- `valor === null | undefined` com `estado === 'ok'` delega a `formatBRL`, **que já devolve travessão**. Não mudar isso.
- `min-width` por degrau (`caption` 72px, `body`/`strong` 112px, `metricSm` 140px, `metric` 200px). **`min-width`, nunca `width`**, para que `R$ 1.234.567,89` não estoure a coluna.

```tsx
<Money valor={conta.valor_final} size="strong" estado={estado} />
<Money valor={kpis?.saldo ?? null} size="metric" estado={estado} />
<Money valor={-total} size="strong" tone="negativo" sinal="auto" />
```

### 7.2 `StatusChip` (`src/components/fin/StatusChip.tsx`)

Um mapa de estado para as 10 telas. Encerra o caso em que PAGO e PARCIAL renderizam a pastilha idêntica, e em que Pagar usa tokens enquanto Receber usa Tailwind cru (PAGO azul, RECEBIDO verde, mesmo conceito).

```ts
export const statusChipVariants = cva(
  'inline-flex items-center gap-1.5 rounded-[var(--fin-r-sm)] px-2 py-0.5 fin-t-caption font-medium border',
  {
    variants: {
      tone: {
        neutro:   'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)] border-[var(--fin-border)]',
        positivo: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)] border-[var(--fin-positive)]/24',
        negativo: 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)] border-[var(--fin-negative)]/24',
        aviso:    'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)] border-[var(--fin-warning)]/24',
        info:     'bg-[var(--fin-info-soft)] text-[var(--fin-info)] border-[var(--fin-info)]/24',
      },
      size: { sm: 'h-5', md: 'h-6 px-2.5' },
    },
    defaultVariants: { tone: 'neutro', size: 'sm' },
  }
);

export type StatusDominio = 'pagar' | 'receber' | 'conciliacao' | 'transferencia' | 'origem' | 'natureza';

export type StatusChipProps = {
  /** Valor cru do banco. NUNCA é renderizado como veio. */
  valor: string;
  dominio: StatusDominio;
  size?: 'sm' | 'md';
  /** Ponto de 6px antes do texto: segundo portador do significado. */
  dot?: boolean;
};
```

O dicionário vive em **um arquivo só**, `src/lib/status-labels.ts`, e é o mesmo consumido por exportação, e-mail e mensagem de erro. Isso resolve o risco levantado pelos três juízes de o suporte passar a operar com dois vocabulários.

```ts
// src/lib/status-labels.ts
export const STATUS_LABELS: Record<StatusDominio, Record<string, { rotulo: string; tone: StatusTone }>> = {
  pagar: {
    PENDENTE:  { rotulo: 'Em aberto',    tone: 'neutro'   },
    PARCIAL:   { rotulo: 'Pago em parte', tone: 'aviso'   },
    PAGO:      { rotulo: 'Pago',          tone: 'positivo' },
    CANCELADO: { rotulo: 'Cancelado',     tone: 'neutro'   },
  },
  // ...
};
/** Fonte única também para CSV e e-mail. */
export function rotuloStatus(dominio: StatusDominio, valor: string): string {
  return STATUS_LABELS[dominio]?.[valor]?.rotulo ?? valor;
}
```

### 7.3 `DeltaIndicator` (`src/components/fin/DeltaIndicator.tsx`)

Variação com polaridade explícita, porque em Contas a pagar subir é ruim e em Contas a receber subir é bom.

```ts
export type DeltaIndicatorProps = {
  /** null significa "sem base de comparação". O componente SOME. Nunca renderiza 0. */
  pct: number | null;
  direcao: 'up' | 'down';
  polaridade: 'subirBom' | 'subirRuim';
  /** "vs. mês anterior" */
  base: string;
  size?: 'caption' | 'body';
};
```

`pct === null` retorna `null`. É o sinal deliberado vindo de `variacaoPct`. Renderizar `0%` ou `+100%` no lugar passa a mentir com cara de precisão.

Carrega três portadores simultâneos, como o código atual já acerta: glifo direcional, sinal, e o texto da base.

### 7.4 `MetricCard` (`src/components/fin/MetricCard.tsx`)

Substitui `ui/KpiCard.tsx` (zero imports) e os cards de indicador remontados à mão na home e em Contas a pagar. **Sem barra de acento colorida, sem índice mono, sem sparkline por padrão.** O tom vem de significado, nunca de posição na grade.

```ts
export const metricCardVariants = cva(
  'flex flex-col gap-1 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-4 text-left',
  {
    variants: {
      emphasis: { destaque: '', padrao: '' },
      interativo: {
        sim: 'cursor-pointer transition-colors hover:bg-[var(--fin-surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2',
        nao: '',
      },
      ativo: { sim: 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]', nao: '' },
    },
    defaultVariants: { emphasis: 'padrao', interativo: 'nao', ativo: 'nao' },
  }
);

export type MetricCardProps = {
  rotulo: string;
  valor: number | null;
  estado: MoneyEstado;
  /**
   * OBRIGATÓRIO e não vazio. Recorte ("vencendo até 30/09, 12 contas"),
   * comparação ("R$ 4.100 a mais que em agosto") ou composição ("em 3 contas").
   * O TypeScript quebra sem ele: é impossível publicar um número solto.
   */
  contexto: string;
  /** 'destaque' renderiza em fin-t-metric (30px). NO MÁXIMO UM POR TELA. */
  emphasis?: 'destaque' | 'padrao';
  tone?: 'neutro' | 'positivo' | 'negativo';
  delta?: DeltaIndicatorProps | null;
  explicacao?: string;
  onClick?: () => void;
  ativo?: boolean;
};
```

`[enxerto de Linguagem primeiro]` `contexto` obrigatório no tipo. Os três juízes salvaram esta ideia: é a única regra de design da rodada que o compilador defende sozinho. Princípio em documento apodrece em seis meses; princípio no tipo não.

### 7.5 `FinTable` (`src/components/fin/FinTable.tsx`)

Camada financeira sobre o `DataTable` existente, que já é a melhor peça do módulo. Adiciona colunas tipadas, linha de total, cabeçalho fixo e os três estados embutidos.

```ts
export type FinColunaBase<T> = {
  id: string;
  cabecalho: string;
  sortable?: boolean;
  /** min-width em px. Nunca width fixa: valor longo não pode estourar. */
  minWidth?: number;
  /** Ordem de colapso declarada. 1 some primeiro. Ver seção 8.4. */
  prioridade?: 1 | 2 | 3;
};

export type FinColuna<T> =
  | (FinColunaBase<T> & { tipo: 'texto'; render: (r: T) => React.ReactNode; acessor?: (r: T) => string | number })
  | (FinColunaBase<T> & {
      tipo: 'dinheiro';
      valor: (r: T) => number;
      /** Sublinha em caption logo abaixo do número, NUNCA coluna extra. */
      sub?: (r: T) => React.ReactNode | null;
      tone?: (r: T) => 'neutro' | 'positivo' | 'negativo';
    })
  | (FinColunaBase<T> & { tipo: 'data'; valor: (r: T) => string | null })
  | (FinColunaBase<T> & { tipo: 'status'; valor: (r: T) => string; dominio: StatusDominio })
  | (FinColunaBase<T> & { tipo: 'acoes'; render: (r: T) => React.ReactNode });

export type FinTableProps<T> = {
  linhas: T[];
  colunas: FinColuna<T>[];
  chave: (r: T) => string;
  densidade?: 'confortavel' | 'compacta';
  estado: 'carregando' | 'erro' | 'ok';
  erro?: { mensagem: string; onTentarDeNovo: () => void } | null;
  vazio: EmptyLessonProps;
  /**
   * Totais são SEMPRE calculados fora, sobre o recorte inteiro, e passados prontos.
   * O componente nunca soma o que está na tela: rotular "Total" sobre a página
   * visível é exatamente a classe de erro que a auditoria corrigiu.
   */
  totais?: { colunaId: string; valor: number; rotulo: string }[];
  onLinhaClick?: (r: T) => void;
};
```

Comportamento obrigatório:
- **Sem zebra.** Remover as duas fontes: `data-table.tsx:169` (pinta ímpares) e `table.tsx:60` (pinta pares). Hoje elas se anulam e todas as linhas ficam tingidas. Separação por borda inferior 1px `--fin-border`, hover `--fin-surface-2`, sem `transform` e sem sombra.
- `tipo: 'dinheiro'` renderiza `<Money>` automaticamente, alinhado à direita.
- `tipo: 'data'` renderiza via `formatDate` de `lib/utils.ts`, que usa `dataLocal`. **Nunca `new Date(iso)`.**
- Cabeçalho ordenável é `<button>` dentro do `<th>`, com `tabIndex`, tratamento de Enter e Espaço, e `aria-sort`. Hoje o `onClick` está no `<TableHead>` e ordenar só funciona com mouse.

### 7.6 `PageHeader` (`src/components/fin/PageHeader.tsx`)

Um cabeçalho para as 10 telas, absorvendo o `PageHeader` e o `MinimalPageHead` concorrentes. **Uma linha, um H1 em `.fin-t-title`, no máximo uma ação primária, filtro nunca no cabeçalho.** Sem `margin-bottom` próprio.

```ts
export type PageHeaderProps = {
  titulo: string;
  /** Uma linha em caption. Opcional e curta. Aceita <Jargao>. */
  subtitulo?: React.ReactNode;
  acaoPrimaria?: { rotulo: string; icone?: LucideIcon; href?: string; onClick?: () => void };
  acoesSecundarias?: { rotulo: string; href?: string; onClick?: () => void }[];
  badge?: React.ReactNode;
  /** Carimbo honesto: só é escrito quando load() TERMINOU com sucesso. */
  atualizadoEm?: Date | null;
  onRecarregar?: () => Promise<void>;
};
```

### 7.7 `FilterBar` (`src/components/fin/FilterBar.tsx`)

Substitui as 13 pílulas em duas fileiras de Contas a pagar, os selects soltos no cabeçalho de DRE, Fluxo e Conciliação, e o segmented inerte da home. Uma linha de 48px.

```ts
export type FilterBarProps = {
  busca?: { valor: string; onChange: (v: string) => void; placeholder: string };
  periodo?: { valor: PeriodoValor; de?: string; ate?: string; onChange: PeriodPickerProps['onChange']; opcoes?: PeriodoChave[] };
  selects?: { id: string; rotulo: string; valor: string; opcoes: { valor: string; rotulo: string }[]; onChange: (v: string) => void }[];
  /**
   * Diz de quanto o filtro cortou. "12 de 340 despesas, R$ 41.320".
   * `soma` vem calculado de fora, sobre o recorte, nunca da página visível.
   */
  resumo: { exibidos: number; total: number; substantivo: string; soma?: number; escopo?: string };
  ativos: number;
  onLimpar?: () => void;
};
```

### 7.8 `PeriodPicker` (`src/components/fin/PeriodPicker.tsx`)

Um controle de período para as 10 telas. **O contrato de retorno é preservado literalmente**, inclusive o terceiro campo.

```ts
export type PeriodoChave =
  | 'MES_ATUAL' | 'PROX_30' | 'PROX_90' | 'VENCIDOS'
  | 'MES_PASSADO' | 'TUDO' | 'PERSONALIZADO';

/**
 * ATENÇÃO: somenteVencidos NÃO é data. É o que faz o filtro "Vencidos"
 * funcionar (pagar/page.tsx:445,454,467). Normalizar este tipo para
 * { de, ate } silencia o filtro sem erro de compilação.
 */
export type PeriodoRange = { de: string; ate: string; somenteVencidos?: boolean };

export type PeriodPickerProps = {
  valor: PeriodoChave;
  de?: string;
  ate?: string;
  onChange: (chave: PeriodoChave, range: PeriodoRange) => void;
  opcoes?: PeriodoChave[];
};
```

### 7.9 `RecordSheet` (`src/components/fin/RecordSheet.tsx`)

Painel lateral para criação e edição, substituindo os Cards inline que empurram filtros e tabela para baixo e que podem abrir dois ao mesmo tempo.

```ts
export type RecordSheetProps = {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
  /** Texto por extenso do que vai acontecer, antes do botão. */
  resumo?: React.ReactNode;
  acaoPrimaria: { rotulo: string; onClick: () => Promise<void> | void; carregando?: boolean; desabilitado?: boolean };
  /** Fluxo de alto volume: mantém o painel aberto e limpa os campos. */
  acaoSalvarEOutro?: { rotulo: string; onClick: () => Promise<void> };
  acaoSecundaria?: { rotulo: string; onClick: () => void };
  /** Avisa antes de fechar com alteração pendente. */
  sujo?: boolean;
  largura?: 480 | 640;
};
```

`[enxerto de Linguagem primeiro]` `acaoSalvarEOutro`, mais foco automático no primeiro campo e memória do último fornecedor e categoria. Os três juízes flagraram o mesmo risco: todas as propostas movem o formulário para painel lateral e todas pioram silenciosamente o caso de maior volume, que é o administrativo lançando 30 despesas seguidas. Sem estes três detalhes, o redesenho fica mais bonito e mais lento, que é a pior troca possível.

Gerencia `role="dialog"`, `aria-modal`, foco inicial, armadilha de foco e fechamento por Escape. Nada disso existe no modal atual de pagamento (`pagar/page.tsx:1183`).

### 7.10 `Field` (`src/components/fin/Field.tsx`)

Resolve de uma vez os 66 `<label>` com 1 `htmlFor`. O campo não consegue nascer sem nome acessível.

```ts
export type FieldProps = {
  rotulo: string;
  obrigatorio?: boolean;
  ajuda?: string;
  erro?: string | null;
  /** O id é gerado por useId e injetado. Impossível esquecer. */
  children: (a: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => React.ReactNode;
};
```

```tsx
<Field rotulo="Fornecedor" obrigatorio erro={erros.fornecedor}>
  {(a) => <Input {...a} value={form.fornecedor_nome} onChange={...} />}
</Field>
```

### 7.11 `MoneyField` (`src/components/fin/MoneyField.tsx`)

Campo de dinheiro com máscara pt-BR. Substitui os `<Input type="number">` crus, que rejeitam `1.500,00` e mostram setas de incremento. Usa `parseMoneyBR` de `lib/money.ts:118`. **Não cria parser novo.**

```ts
export type MoneyFieldProps = {
  rotulo: string;
  valor: number;
  onChange: (v: number) => void;
  obrigatorio?: boolean;
  ajuda?: string;
  erro?: string | null;
  maximo?: number;
  moeda?: string;
  /** "Saldo devedor", "Valor cheio". Preenche o campo com um clique. */
  atalhos?: { rotulo: string; valor: number }[];
  autoFocus?: boolean;
};
```

### 7.12 `EmptyLesson` (`src/components/fin/EmptyLesson.tsx`)

`[enxerto de Linguagem primeiro]` Estado vazio que ensina, não que constata. Os três juízes salvaram esta ideia, e o juiz 1 apontou que ela resolve o buraco que a proposta vencedora deixa aberta ao tirar o checklist de onboarding da primeira dobra.

```ts
export type EmptyLessonProps = {
  motivo: 'sem-dado' | 'sem-resultado' | 'erro';
  titulo: string;
  /** "Aqui aparecem as contas que a agência precisa pagar." */
  oQueE: string;
  /** 1 a 3 passos curtos. Só quando motivo === 'sem-dado'. */
  comoComeca?: string[];
  acao?: { rotulo: string; href?: string; onClick?: () => void };
  acaoSecundaria?: { rotulo: string; onClick: () => void };
  /** Amostra esmaecida do que vai aparecer. aria-hidden. */
  exemplo?: React.ReactNode;
};
```

`motivo: 'sem-resultado'` nunca oferece "cadastrar"; oferece "limpar filtros". A distinção já existe no código atual da home (`page.tsx:690-712`) e é um dos pontos bons a preservar.

### 7.13 `ConfirmDialog` (`src/components/fin/ConfirmDialog.tsx`)

Substitui os 10 `window.confirm` e `window.prompt` do módulo.

```ts
export type ConfirmDialogProps = {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  titulo: string;
  /** O que vai acontecer, por extenso. Não "Confirmar exclusão?". */
  oQueVaiAcontecer: string;
  /** Contexto do objeto: [{rotulo:'Fornecedor', valor:'CVC Turismo'}, ...] */
  detalhes?: { rotulo: string; valor: React.ReactNode }[];
  /** Efeito da operação escrito por extenso. Ver seção 9.10. */
  previa?: React.ReactNode;
  confirmarRotulo: string;
  tone?: 'padrao' | 'destrutivo';
  processando?: boolean;
  onConfirmar: () => Promise<void> | void;
};
```

### 7.14 `DataState` (`src/components/fin/DataState.tsx`)

Envelope obrigatório de todo bloco que consome API.

```ts
export type DataStateProps = {
  estado: 'carregando' | 'erro' | 'ok';
  erro?: { mensagem: string; onTentarDeNovo: () => void } | null;
  /** Avisa que parte dos dados falhou sem derrubar a tela. */
  parcial?: { mensagem: string } | null;
  /** Precisa ter a FORMA do conteúdo real, senão o layout salta. */
  esqueleto: React.ReactNode;
  children: React.ReactNode;
};
```

### 7.15 `Jargao` (`src/components/fin/Jargao.tsx`)

`[enxerto de Linguagem primeiro]` Os três juízes salvaram. É o mecanismo que permite simplificar sem amputar: o dono lê a palavra dele, o administrativo continua achando a palavra que usa com o contador, e a busca do produto encontra a tela pelos dois nomes.

```ts
export type JargaoProps = {
  /** "Resultado do mês" */
  comum: string;
  /** "DRE" */
  tecnico: string;
  explicacao: string;
  comoCalcula?: string;
  /** 'inline' põe o técnico entre parênteses; 'subtitulo' põe embaixo. */
  formato?: 'inline' | 'subtitulo';
};
```

Rota, enum, nome de API e campo do banco **nunca mudam**. O `Jargao` é camada de apresentação.

### 7.16 `Meter` (`src/components/fin/Meter.tsx`)

`[enxerto de Sistema antes de tela]` Barra de proporção que sempre exibe a faixa em texto, além da cor.

```ts
export type MeterProps = {
  pct: number;
  faixa: Faixa;               // de src/lib/faixas.ts
  /** "R$ 3.200 de R$ 10.000" */
  descricao: string;
  size?: 'sm' | 'md';
};
```

### 7.17 `ActionCard` (`src/components/fin/ActionCard.tsx`)

`[enxerto de Sistema antes de tela]` **Renderiza `<a>` sempre que recebe `href`.** Encerra o caso atual em que quatro botões usam `router.push` e quatro cards irmãos usam `<Link>` com aparência idêntica: sem `href` não dá para abrir em nova aba, copiar o endereço, e o leitor de tela não anuncia como link.

```ts
export type ActionCardProps = {
  rotulo: string;
  descricao?: string;
  icone: LucideIcon;
  variante?: 'primaria' | 'secundaria';
} & ({ href: string; onClick?: never } | { onClick: () => void; href?: never });
```

Substituídos e apagados no mesmo commit: `ui/QuickAction.tsx`, `ui/KpiCard.tsx`, `financeiro/MinimalPageHead.tsx`.

---

## 8. Padrões de tela

Regras que **toda** tela do financeiro segue.

### 8.1 Anatomia do cabeçalho

Uma linha de 56px. Nunca duas.

```
[H1 .fin-t-title]  [badge opcional]              [ação secundária]  [AÇÃO PRIMÁRIA]
[subtítulo .fin-t-caption, opcional]             [carimbo .fin-t-caption]
```

- **Um H1 por tela.** A home tem dois hoje (`page.tsx:330` e `:339`); um deles sai.
- **Um badge por tela.** O badge de CRM aparece duas vezes na home; um sai.
- Sem borda inferior decorativa. A separação para o bloco seguinte é o espaço de 40px.
- Filtro **nunca** fica no cabeçalho. Vai para a `FilterBar`.
- O carimbo "Atualizado às HH:MM" só é escrito quando `load()` termina com sucesso.

### 8.2 Ação primária

- No máximo **uma** por tela, alinhada à direita do cabeçalho, com fundo `--fin-accent`.
- Altura 40px no desktop, 44px abaixo de 1024px.
- Ação de linha em tabela é `outline`, nunca preenchida.
- Ação destrutiva nunca aparece preenchida; é `ghost` com ícone e `aria-label`, e sempre passa por `ConfirmDialog`.

### 8.3 Filtro e contagem

- Uma `FilterBar` de uma linha e 48px, logo abaixo do cabeçalho.
- **A contagem sempre diz de quanto cortou:** "12 de 340 despesas, R$ 41.320". Nunca "Lançamentos (12)", que não informa se são 12 de 340 ou 12 de 12.
- O botão "Limpar filtros (N)" só aparece quando há filtro ativo. Esse comportamento já existe e é bom.
- Todo indicador clicável que liga um filtro **precisa acender o controle correspondente na FilterBar**. Hoje o cartão Pendente liga o pseudo-status `ABERTO`, que não existe na fileira de pílulas, e a lista encolhe sem nenhum controle marcado.

### 8.4 Anatomia de tabela

| Item | Regra |
|---|---|
| Altura de linha | 44px confortável (padrão), 36px compacta (Plano de contas, DRE) |
| Padding de célula | 12px vertical, 12px horizontal, 16px na primeira e na última coluna |
| Cabeçalho | 36px, `.fin-t-overline`, `--fin-text-3`, borda inferior 1px, `sticky` com `--fin-e1` ao rolar |
| Zebra | **Nenhuma.** Separação por borda inferior 1px `--fin-border` |
| Hover | `--fin-surface-2`. Sem `transform`, sem sombra |
| Texto | Esquerda |
| Dinheiro | Direita, `tabular-nums`, `.fin-t-body-strong`, `min-width` 112px |
| Data | Esquerda, `dd/mm/aaaa` via `formatDate`, `min-width` 92px |
| Status | Esquerda, coluna de 128px |
| Ações | Direita, coluna fixa de 96px, **uma ação visível** mais menu de excedente |
| Totais | Rodapé com `--fin-surface-sunken`, borda superior 2px, `.fin-t-body-strong`. Calculado fora, sobre o recorte inteiro |
| Máximo de colunas | 7 em 1280px |

**Informação excedente vira sublinha da coluna principal, em `.fin-t-caption`, nunca coluna escondida por breakpoint.** `[enxerto de Sistema antes de tela]` Moeda estrangeira, valor já pago e saldo devedor entram embaixo do número. Em 1280px com zoom de 125% do Windows (1024px efetivos), uma coluna que some por media query some sem o usuário saber que existia.

**Ordem de colapso declarada por `prioridade`:** abaixo de 1024px some `prioridade: 1`, abaixo de 900px some `prioridade: 2`. Cada tela declara a sua ordem na seção 9.

### 8.5 Anatomia de formulário

- Todo formulário vive em `RecordSheet` lateral. **Nunca** inline no meio da página empurrando a tabela.
- **Nunca dois painéis abertos ao mesmo tempo.** Abrir um fecha o outro.
- Agrupado por `FormSection` (que já existe em `src/components/financeiro/FormSection.tsx` e não é importado por ninguém). Três seções: Essencial, Classificação, Avançado.
- Todo campo passa por `Field`. Zero `<label>` solto.
- Campo condicional **não é renderizado** quando não se aplica; não fica visível e desabilitado. Câmbio some quando a moeda é BRL.
- Validação: erro embaixo do campo mais `aria-invalid`, **além** do toast. Hoje só existe o toast, e num formulário de 10 campos o usuário precisa caçar qual falta.
- Rodapé fixo do painel com ação primária, "Salvar e lançar outro" quando fizer sentido, e Cancelar.

### 8.6 A tríade carregamento, vazio e erro

Toda tela declara os três via `DataState`. Nenhuma exceção.

| Estado | Regra |
|---|---|
| Carregando | Esqueleto com a **forma do conteúdo real**. Nenhum valor monetário pintado. Nenhum "Lançamentos (0)" |
| Vazio | `EmptyLesson`, distinguindo `sem-dado` de `sem-resultado`. CTA só no primeiro caso |
| Erro | Mensagem, botão "Tentar de novo". Nunca lista vazia, nunca R$ 0,00 |
| Parcial | Aviso no bloco afetado, sem derrubar a tela |

Correções obrigatórias no caminho de dados:

1. **`crm-storage.ts:3-11` deixa de engolir erro.** `loadEntities` passa a lançar; quem chama decide. É o que hoje transforma queda de rede em "nenhum lançamento" em 9 telas.
2. Toda `load()` ganha `try/catch/finally`. Em `pagar/page.tsx:167-178` não há nenhum: uma rejeição deixa `loading` eternamente `true`.
3. `toast.success` só dispara depois de `load()` ter terminado com sucesso. Hoje "Dados atualizados" dispara mesmo quando falhou, porque o erro foi engolido dentro do `load`.

`[enxerto de Linguagem primeiro]` **Não redesenhar em cima de dado inventado.** Se não existe última sincronização real, o bloco não existe. Se não existe série histórica, a sparkline não aparece. Um elemento fabricado ao lado de dinheiro auditado contamina a credibilidade de tudo em volta.

---

## 9. Especificação tela a tela

### 9.1 Painel do financeiro (`/financeiro-ag`)

**Hoje:** 11 blocos, 843 linhas, ~20 alvos clicáveis antes do conteúdo útil, 16 tamanhos de fonte, zero `aria-`.

**Alvo: 4 blocos.**

1. **Cabeçalho** (56px). H1 "Financeiro" em `.fin-t-title`, badge de CRM (um só), botão "Atualizar" com carimbo honesto embaixo.
2. **Faixa de saldo** (uma superfície, 16px de padding). À esquerda: rótulo "EM CAIXA HOJE" em `.fin-t-overline`, valor em `.fin-t-metric` (o **único** 30px da tela), contexto "em 3 contas bancárias". À direita, separados por linha vertical de 1px, três `MetricCard` em `.fin-t-metric-sm`: A receber, A pagar, Resultado do mês. Sem barra colorida, sem índice mono, sem sparkline.
3. **"Próximos 15 dias"** (`FinTable`, 8 a 10 linhas). **Ordenada por vencimento de verdade, intercalando recebimentos e pagamentos.** Colunas: Vencimento (92px, `dd/mm/aaaa`), Descrição (com contraparte em `.fin-t-body-strong` acima), Origem (`StatusChip` "Do CRM"), Valor (112px, direita, sinal, vermelho só quando a data já passou), Ação (96px, um botão "Dar baixa" ou "Receber"). Linha de total. Resumo no topo: "entram R$ X, saem R$ Y, saldo previsto R$ Z".
4. **Três ações** em uma linha de 40px: "Nova despesa" e "Novo recebimento" com borda, "Conciliar contas" com fundo `--fin-accent` (o único retângulo azul da tela).

**Sai:** o segundo H1 de 42px (`page.tsx:339`) e a segunda borda; a saudação com "Bruno" cravado; o segmented de 5 períodos (inerte, `page.tsx:84`); o link "Ver mais indicadores" a 300px do que revela; a barra colorida por `nth-child`; os índices mono `01`-`04`, `001`-`005`; o banner de cartões (vai para a tela de Cartões); a coluna de CRM com "agora", "312 evts" e o array literal de 14 barras; os 8 cards para 5 destinos; o rodapé com `build` e `BRL UTC-3`.

`[enxerto de Linguagem primeiro]` O nome do usuário vem de `useAuth().user.nome`, como já faz o `TopBar.tsx:33`, e não da string `'Bruno'` (`page.tsx:345`). Se a saudação for mantida em alguma forma, é assim; se for cortada, o padrão de dado fabricado sai do repositório junto.

`[da proposta vencedora]` **Enquanto o `OnboardingChecklist` não estiver 4 de 4, ele é a única coisa que a tela mostra**, e não um card empilhado acima do resto. Agência nova não pode receber uma tela de zeros sem caminho. Preservar a leitura de `localStorage` no mount (`OnboardingChecklist.tsx:32-35`) e a derivação dos 4 passos a partir dos dados reais.

**Componentes:** `PageHeader`, `MetricCard`, `Money`, `FinTable`, `StatusChip`, `ActionCard`, `DataState`, `EmptyLesson`, `OnboardingChecklist` (preservado).

**Colapso:** prioridade 1 = Origem; prioridade 2 = Descrição vira duas linhas.

**Preservar literalmente:**
- `kpiList` (`page.tsx:282-327`): `tone` continua mapeando `pos`/`neg`/`neutral`, e `delta` continua podendo ser `null`, que é o sinal deliberado de "sem base de comparação" vindo de `variacaoPct` (`:274-277`).
- `'|| 0'` nas linhas 286, 297, 308, 319. **Não trocar por `?? undefined`**: `formatBRL` devolve travessão para `null` e `R$ 0,00` para zero. A escolha atual é deliberada.
- A contagem "Movimentações importadas" (`:775`) e o regex de `VND-` (`:782-785`) dependem de `origem` ser exatamente a string `'crm'` minúscula produzida em `:189` e `:198`, e do array já truncado. Se o bloco de CRM sair, esses três cálculos saem junto; se ficar, movem-se sem reescrita.
- `CrmStatusBadge` faz `fetch` próprio com `setInterval` de 60s (`:22-29`). Remontar essa árvore com chave diferente reinicia o intervalo.
- Todos os helpers importados: `calcularSaldoBancario`, `valorMovimentado`, `calcularHistoricoKpis`, `somaPor`, `round2`, `divSegura`, `variacaoPct`, `formatBRL`.

### 9.2 Contas a pagar (`/financeiro-ag/pagar`)

**Hoje:** 1.268 linhas, o maior arquivo do módulo. 13 pílulas em duas fileiras, formulário de 10 campos inline, 2 painéis que podem abrir juntos, 8 colunas.

**Pré-requisito de execução:** este arquivo é quebrado em partes **antes** de qualquer extração de primitivo. Nenhuma das três propostas orçou isso e é o que faz a estimativa de 7 a 9 dias ser otimista. Quebra sugerida: `page.tsx` (composição e estado), `colunas.tsx`, `FormularioConta.tsx`, `PainelCopiarMes.tsx`, `DialogBaixa.tsx`.

**Alvo:**

1. **Cabeçalho.** H1 "Contas a pagar", ação primária "Nova conta", secundária "Copiar mês".
2. **Quatro `MetricCard`** com `contexto` obrigatório dizendo o recorte ativo ("no período selecionado"). Um deles em `emphasis="destaque"`: **Vencido**, porque é o que exige ação. O cartão Custo Comercial, que hoje é `disabled` com aparência de botão, vira `MetricCard` não interativo, visualmente distinto.
3. **`FilterBar` de uma linha:** busca, `PeriodPicker`, `Select` de status, `Select` de categoria, resumo "Vencidas até hoje, 12 de 340 despesas, R$ 41.320".
4. **`FinTable`**, 6 colunas: Fornecedor (com descrição como sublinha), Vencimento, Valor (com moeda estrangeira e saldo devedor como sublinha), Status, Natureza, Ações. Linha de total.
5. **`RecordSheet` de 640px** para o formulário, com três `FormSection`: Essencial (fornecedor, descrição, valor, vencimento), Classificação (categoria, natureza, custo comercial), Pagamento e repetição (forma, cartão, moeda, câmbio, recorrência). **Câmbio não é renderizado quando a moeda é BRL.**
6. **`RecordSheet` de 480px** para Copiar mês, com prévia da contagem e do total (que já existe e é bom).
7. **`ConfirmDialog`** para a baixa, preservando os três números (Valor, Já pago, Saldo devedor), o pré-preenchimento com o saldo devedor e o aviso dinâmico de baixa parcial.

**Sai:** a pílula de status "Vencido", que nunca casa com nada porque o sistema jamais grava esse status (`crm-types.ts:1354` nasce PENDENTE, `page.tsx:341` grava PAGO ou PARCIAL). O período "Vencidos" continua e funciona.

**Componentes:** `PageHeader`, `MetricCard`, `FilterBar`, `PeriodPicker`, `FinTable`, `Money`, `StatusChip`, `RecordSheet`, `Field`, `MoneyField`, `ConfirmDialog`, `DataState`, `EmptyLesson`, `FormSection` (existente).

**Colapso:** prioridade 1 = Natureza; prioridade 2 = Status vira ponto no Fornecedor.

**Preservar literalmente:**
- **`filteredBase` (`:458`) e `filtered` (`:478`) continuam separados.** São dois recortes deliberados: `filteredBase` (período, categoria, busca) alimenta os quatro totais; `filtered` (mais status) alimenta a tabela. Foi assim que o bug de KPI que não batia com a lista foi corrigido. Uma `FilterBar` que memoize a lista errada reintroduz o bug em silêncio.
- **O pseudo-status `'ABERTO'` (`:154`, `:480`, `:700`)** não existe no enum `StatusContaPagar` e é o que faz o cartão Pendente bater com a lista. O `Select` de status é tipado como `StatusContaPagar | 'TODOS' | 'ABERTO'`.
- **`somenteVencidos` (`:445`, `:454`, `:467`)** é o terceiro campo do retorno de `periodoRange` e não é data.
- Os filtros de status `PENDENTE`/`PARCIAL`/`ATRASADO` e a checagem de `CANCELADO` são regra auditada.
- `saldoDevedor`, `valorBRLDaConta`, `ehVencidoEmAberto`, `somaPor`.
- As guardas de duplo envio (`:225`, `:325`, `:381`).

### 9.3 Contas a receber (`/financeiro-ag/receber`)

**Alvo:** espelho exato de Contas a pagar com o sinal invertido. A partir daqui as duas são a mesma tela e devem ser lidas assim.

**Muda:**
1. **Matar o `window.prompt()` da baixa (`receber/page.tsx:144`).** Vira o mesmo `ConfirmDialog` de Contas a pagar, com os três números (Valor, Já recebido, Saldo) e baixa parcial. Este é o item de maior valor da tela.
2. **Unificar a paleta de status** via `StatusChip`. Hoje pagar usa tokens e receber usa Tailwind cru, então PAGO sai azul e RECEBIDO sai verde para o mesmo conceito, e as duas telas irmãs parecem produtos diferentes.
3. Adicionar os toasts de confirmação. A tela nunca dispara nenhum: salvar não confirma nada.

**Preservar literalmente:** o caminho de baixa acumula `valor_recebido` e decide entre `PARCIAL` e `RECEBIDO` comparando com o saldo em aberto, com comentário explícito de que nunca pode marcar integral quando entrou menos. Esse é o cálculo mais delicado da tela.

### 9.4 Conciliação bancária (`/financeiro-ag/conciliacao`)

**Verificado:** `findMatches` já existe (`conciliacao/page.tsx:210`, "Auto-match: find lancamentos that could match an extrato line") e já é chamado no render (`:436`). **O auto-match existe.** Isso libera o enxerto mais valioso da rodada.

`[enxerto de Linguagem primeiro, salvo por dois juízes]` **A tela vira uma fila de decisão de um item por vez**, não duas listas para o olho comparar:

1. **Cabeçalho.** H1 "Conciliação bancária", ação primária "Importar extrato".
2. **`FilterBar`** com o select de conta, que hoje está no cabeçalho.
3. **Progresso textual:** "12 de 47 conferidos, R$ 3.180 sem par", com barra de 4px em `--fin-accent`. É o único uso de cor de marca da tela.
4. **Fila.** No topo, a linha do extrato em `.fin-t-subhead` com data e valor. Abaixo, as sugestões de `findMatches` em ordem de confiança, cada uma como linha de 44px com três botões: "É esta" (`outline`), "Não é nenhuma", "Deixar para depois".
5. Quando `findMatches` volta vazio, cai para a busca manual de lançamento, que é o comportamento atual.
6. **Importação** como zona de arraste com três estados explícitos (aguardando, lendo N linhas, N conciliados e M pendentes) e uma frase que ensina o que é OFX e onde baixar no banco.

**Justificativa da decisão:** os juízes 1 e 2 salvaram esta ideia como "a melhor ideia isolada da rodada"; o juiz 3 alertou que ela pressupõe um auto-match que talvez não exista. Verifiquei: existe. Com o auto-match confirmado, a mudança é de apresentação (reordenar o que já é calculado), não de lógica.

**Preservar literalmente:** `findMatches` e todo o parser de OFX (`:80-81` e o bloco de `match` por tag), inclusive a tolerância de valor e de data.

### 9.5 Cartões corporativos (`/financeiro-ag/cartoes`)

**Muda:**
1. **Remover o fundo azul da página** (`cartoes/page.tsx:153`). É uma das duas telas que pintam corpo e texto de azul e destoam das outras oito. Volta para `--fin-bg`.
2. Largura de 1152px para 1280px.
3. Os cards viram linhas de `FinTable`: Apelido, Bandeira, Titular, Fechamento, Vencimento, Limite, Usado, Utilização.
4. **A utilização usa `Meter`**, com `faixaUtilizacaoCartao` e o rótulo textual ao lado do percentual. Hoje muda de cor em 85% e 60% sem legenda.
5. `window.confirm` de exclusão vira `ConfirmDialog` citando apelido e limite.

**Preservar literalmente:** os cortes 85 e 60, movidos para `faixaUtilizacaoCartao` sem arredondar.

### 9.6 DRE (`/financeiro-ag/dre`)

**Alvo:** demonstrativo impresso, não card. Uma superfície branca, largura 1280px (hoje 1024), `FinTable` em densidade compacta de 36px.

1. **H1 "Resultado do mês"**, com `<Jargao comum="Resultado do mês" tecnico="DRE" formato="subtitulo" />`. **A rota `/dre` não muda.** `[enxerto de Linguagem primeiro]` O termo técnico fica na tela: o dono precisa mandar isso para o contador e o suporte precisa da palavra-chave.
2. O travessão do título atual sai por regra de casa.
3. Hierarquia por indentação de 16px por nível e peso: grupo em `.fin-t-body-strong`, conta em `.fin-t-body`, total em `.fin-t-body-strong` com borda superior 2px e `--fin-surface-sunken`.
4. Valores em `tabular-nums` alinhados à direita, duas colunas de 128px (período e comparativo) mais variação de 72px.
5. Zero cor exceto o vermelho de resultado negativo.
6. O segmented e os dois selects do cabeçalho descem para a `FilterBar`.
7. `[enxerto de Linguagem primeiro]` Cada linha ganha a contagem de lançamentos que a formou, com clique que leva à lista filtrada.

**Preservar literalmente:** todas as fórmulas do demonstrativo, a distinção entre receita da agência e volume intermediado, e os textos dos `MetricExplainer`. **Trocar o travessão desses textos por vírgula ou ponto, preservando a explicação inteira**; são a melhor peça de conteúdo do módulo para quem não é contador.

### 9.7 Fluxo de caixa (`/financeiro-ag/fluxo-caixa`)

1. **O saldo projetado sobe para `.fin-t-metric`** (o único 30px da tela), com a data em que o saldo fica negativo escrita ao lado quando existir: "saldo negativo a partir de 14/10". É a informação que o dono procura.
2. Gráfico e tabela compartilham a mesma escala de tempo e a mesma largura, empilhados, eixo alinhado coluna a coluna.
3. Tabela por dia com duas colunas fixas (entradas, saídas) mais saldo acumulado em `tabular-nums`. A linha do primeiro dia negativo recebe borda esquerda de 3px `--fin-negative` **mais um `StatusChip`**, nunca só cor de fundo.
4. Os 2 selects e o checkbox do cabeçalho vão para a `FilterBar`.
5. `[enxerto de Linguagem primeiro]` **A projeção vinda do funil do CRM vira linha explícita com a origem escrita**, em vez de viver num `title` de hover. Misturar previsão de CRM com dinheiro contratado sem dizer é o tipo de coisa que destrói confiança.

### 9.8 Contas bancárias (`/financeiro-ag/contas-bancarias`)

1. **Remover o fundo azul da página** (`contas-bancarias/page.tsx:154`). Largura 1152 para 1280.
2. Grade de cards vira `FinTable`: Conta, Banco, Agência/conta, Tipo, Saldo (`tabular-nums`, direita), Última conciliação (com `--fin-warning-text` quando passar de 15 dias).
3. **Linha de TOTAL EM CAIXA no rodapé**, que hoje não existe apesar de ser o número que alimenta o KPI da home.
4. `[enxerto de Linguagem primeiro]` Uma linha em `.fin-t-caption` explicando a procedência: **"saldo inicial mais recebido menos pago"**. Os três juízes salvaram: é a dúvida número um de suporte, quando o dono compara o saldo do sistema com o app do banco.
5. Formulário vai para `RecordSheet`. Adicionar os toasts ausentes.

**Preservar literalmente:** `calcularSaldoBancario`, que é a fonte do KPI da home.

### 9.9 Plano de contas (`/financeiro-ag/plano-contas`)

1. Árvore de dois níveis em `FinTable` densidade compacta (36px), com indentação de 16px por nível.
2. **Código em JetBrains Mono 12px em coluna própria de 72px.** É o único lugar legítimo do mono no módulo.
3. Natureza vira `StatusChip`. O marcador de custo comercial vira chip com o texto "Custo comercial", não um ícone de alvo âmbar com `title` (que não aparece no teclado nem no toque).
4. `[enxerto de Sistema antes de tela]` **Cada linha mostra quantos lançamentos usam a categoria**, e essa contagem é citada no `ConfirmDialog` de exclusão. É prevenção de erro: impede excluir uma categoria em uso e descobrir o estrago no DRE.
5. O `window.confirm` de "adicionar contas padrão" vira `ConfirmDialog` listando quantas categorias serão criadas.

### 9.10 Transferências (`/financeiro-ag/transferencias`)

1. A linha vira uma frase legível: "Itaú PJ para Caixa Geral", com seta de 12px entre os nomes, data à esquerda, valor à direita em `tabular-nums`, status em `StatusChip`.
2. Formulário de 4 campos em `RecordSheet` de 480px.
3. `[enxerto de Linguagem primeiro, salvo pelos três juízes]` **Prévia ao vivo do efeito nos dois saldos, antes de confirmar:** "Itaú fica com R$ 12.400 e Nubank com R$ 3.100". Aparece no `RecordSheet` e se repete dentro do `ConfirmDialog` de efetivar e de estornar.
4. Os três `window.confirm` (efetivar, cancelar/estornar, excluir) viram `ConfirmDialog` com a prévia e o valor formatado.

**Justificativa:** transferência é a operação de maior custo de erro e menor rastro visual do módulo, e estorno mexe em dois saldos. Mostrar o efeito, e não apenas o valor, é a diferença entre confirmar e conferir. Custo quase zero, é leitura de dado já calculado.

---

## 10. Texto de interface

### 10.1 Regras de escrita

1. **Sem travessão.** Nem `—` nem `–` em nenhuma string de interface. Trocar por vírgula, ponto ou parênteses. Há 46 linhas com travessão no módulo. **Exceção técnica:** `formatBRL` devolve `'—'` para `null`; isso é dado, não texto de interface, e não muda.
2. **Um nome por objeto.** Hoje convivem "conta", "despesa", "lançamento" e "Conta a Pagar" na mesma tela. O nome é **conta a pagar** / **conta a receber**, e o verbo é **lançar**.
3. **Caixa de frase em tudo:** títulos, botões, rótulos. Sem Caixa Alta Por Palavra. Exceção: `.fin-t-overline`, que é maiúscula por definição.
4. **Enum nunca é renderizado cru.** Passa por `rotuloStatus`. Hoje a coluna Status imprime o valor do banco em caixa alta, e "Referente a" mostra `DESPESA_FIXA` e `OUTROS`.
5. **Sem chrome de desenvolvedor.** "build 2026-09-06", "enturos / fin", "BRL UTC-3" saem do rodapé.
6. **O termo técnico não é apagado, é rebaixado.** Vai para `<Jargao>` ou subtítulo. Rota, enum e nome de API nunca mudam.
7. **Acentuação correta.** Há erros nos textos de apoio ("saidas", "periodo", "contabeis").

### 10.2 Tabela de substituições

| Hoje | Depois | Onde o termo técnico sobrevive |
|---|---|---|
| DRE, Demonstrativo de resultado | Resultado do mês | `<Jargao tecnico="DRE">` no subtítulo, rota `/dre` |
| Plano de contas | Categorias de entrada e saída | `<Jargao tecnico="Plano de contas">`, rota `/plano-contas` |
| Conciliação bancária | Conciliação bancária (mantido) | é o nome que o dono já usa com o banco |
| Lançamentos (12) | 12 de 340 despesas | |
| PENDENTE | Em aberto | valor do banco intacto |
| PARCIAL | Pago em parte | valor do banco intacto |
| PAGO / RECEBIDO | Pago / Recebido | valor do banco intacto |
| DESPESA_FIXA | Despesa fixa | valor do banco intacto |
| COMPRA_UNICA | Compra única | valor do banco intacto |
| Natureza do custo | Tipo de despesa | `<Jargao tecnico="Natureza do custo">` |
| Custo comercial, CAC | Custo para conseguir cliente | `<Jargao tecnico="CAC">` com a explicação |
| Baixa parcial | Pagamento em parte | no aviso do diálogo |
| Categorias contábeis | Categorias | |
| Faturamento (que é o recebido) | Recebido no período | |
| Faturamento de vendas | Volume vendido (não é sua receita) | `<Jargao tecnico="Volume intermediado">` |
| Margem bruta | Margem | com `Meter` e rótulo de faixa |
| Resultado projetado | Saldo previsto | |
| Entradas e saidas por periodo | Entradas e saídas por período | |
| CNAE 7911-2, regime de intermediação | (sai do subtítulo) | dentro do `<Jargao>` de "Volume vendido" |
| Movimentações | Contas a pagar e a receber | |
| Últimas movimentações | Próximos 15 dias | e passa a ser verdade |

**Regra de cobertura:** o dicionário de `src/lib/status-labels.ts` é a fonte única e é consumido também por exportação CSV, e-mail e mensagem de erro. Um status traduzido só na tela e cru no CSV cria dois vocabulários para o suporte, que é o risco que os três juízes levantaram.

---

## 11. Acessibilidade

Checklist verificável. Estado atual: **1 atributo `aria-` no módulo inteiro**.

| # | Item | Verificação |
|---|---|---|
| A1 | Todo campo tem rótulo associado | `grep -ro "<label" src/app/financeiro-ag \| wc -l` igual a `grep -ro "htmlFor" ...`. Ou zero de ambos, porque `Field` gera o par |
| A2 | Todo botão só de ícone tem `aria-label` | Nenhum `<Button>` cujo único filho é um ícone sem `aria-label`. Hoje falham a lixeira e os três X de fechar |
| A3 | Foco visível em todo controle | `outline: 2px solid var(--fin-accent)` com offset 2px. Nenhuma regra com `box-shadow: none` em `[data-slot="button"]` |
| A4 | Contraste AA em todo texto | Nenhum texto em `#94A3B8`. `--fin-text-3` é `#5B6878` (5,35:1 sobre o fundo). Nenhum texto abaixo de 12px exceto `.fin-t-overline` |
| A5 | Alvo de toque | 40px no desktop, 44px abaixo de 1024px. Nenhum `h-7` (28px) em ação de linha, nenhum controle de 34px |
| A6 | Abas com semântica | `role="tablist"`, `role="tab"`, `aria-selected`. Ou usar `ui/tabs.tsx`, que já existe |
| A7 | Toggle com `aria-expanded` e `aria-controls` | Todo revelador de bloco |
| A8 | Diálogo acessível | `role="dialog"`, `aria-modal`, foco inicial, armadilha de foco, Escape. Fornecido por `RecordSheet` e `ConfirmDialog` |
| A9 | Ordenação por teclado | Cabeçalho ordenável é `<button>` com `aria-sort`, responde a Enter e Espaço |
| A10 | Cor com segundo portador | Todo estado tem rótulo, glifo ou ponto. `Meter` sempre exibe a faixa em texto |
| A11 | Gráfico e sparkline | `role="img"` com `aria-label` descrevendo a série, ou `aria-hidden="true"` quando decorativo |
| A12 | Tabela com semântica | `<table>` real com `<th scope="col">`. Nunca grade CSS de divs |
| A13 | Reflow a 200% | Em 1280px com zoom 200% (640px efetivos) nenhum conteúdo é perdido; a tabela rola dentro do próprio container com `overflow-x: auto` e o container tem `tabindex="0"` e `aria-label` |
| A14 | Zoom 125% do Windows | Em 1024px efetivos a tabela colapsa na ordem declarada por `prioridade`, sem estourar o body |
| A15 | Movimento | Nenhuma animação de conteúdo. `prefers-reduced-motion` respeitado nas transições restantes |

---

## 12. Plano de migração

### 12.1 Ordem e motivo

**Dez fatias independentes, uma tela por PR**, depois da fundação. `[enxerto de Sistema antes de tela]` Substitui o faseamento transversal das outras propostas: permite parar no meio sem deixar o produto híbrido por acidente, dá pontos de reversão granulares, e casa com a forma como o Bruno aprova (vendo tela pronta).

`[risco resolvido]` **A ordem é por adjacência de navegação, não por facilidade.** Entre a primeira e a última tela migrada o usuário vive semanas com duas linguagens visuais convivendo; telas vizinhas migradas juntas minimizam a sensação de produto quebrado pela metade.

| # | Etapa | Dias | Motivo da posição |
|---|---|---|---|
| 0 | **Fundação** | 2,0 | Nada funciona antes. Ver 12.2 |
| 1 | **Primitivos** | 3,0 | `Money`, `StatusChip`, `DeltaIndicator`, `Field`, `MoneyField`, `EmptyLesson`, `ConfirmDialog`, `DataState`, `PageHeader`, `Jargao`, `Meter`, `ActionCard`. Sozinhos apagam os 7 formatadores, os 10 `confirm`/`prompt` e os 66 `<label>` |
| 2 | **Contas a pagar** | 2,5 | Maior arquivo, maior densidade de defeitos, define `FinTable`, `FilterBar`, `PeriodPicker` e `RecordSheet`. Inclui a quebra do arquivo de 1.268 linhas |
| 3 | **Contas a receber** | 0,5 | Espelho de 2. Mata o `window.prompt`. Barato porque reusa tudo |
| 4 | **Painel (home)** | 1,5 | Só depois de 2 e 3, porque consome a mesma tabela e os mesmos chips. É a tela que o Bruno vê primeiro, mas é a que mais depende das outras |
| 5 | **Contas bancárias** | 0,5 | Vizinha de Cartões. Simples |
| 6 | **Cartões** | 0,5 | Vizinha de 5. Mesma cirurgia (fundo azul, `Meter`) |
| 7 | **Transferências** | 0,5 | Vizinha de 5 e 6, mesmo domínio de contas |
| 8 | **Plano de contas** | 0,5 | Densidade compacta, primeira da dupla de leitura |
| 9 | **DRE** | 1,0 | Densidade compacta, mesma da 8 |
| 10 | **Fluxo de caixa** | 1,0 | Depende de DRE para a linguagem de projeção |
| 11 | **Conciliação** | 1,5 | Última porque é a que mais muda de forma (fila de decisão) e a que mais se beneficia de todos os primitivos prontos |
| 12 | **Passe final** | 1,0 | Acessibilidade tela a tela, varredura de travessão, glossário |

**Total: 16 dias.** As estimativas de 7 a 9 dias das propostas não contabilizavam a quebra do arquivo de 1.268 linhas nem a fabricação dos 40 estados (10 telas x 4) que hoje não existem e precisam ser provocados para serem revisados.

### 12.2 Fundação (etapa 0, detalhada)

É a única etapa que toca todo o produto de uma vez. Sete itens:

1. **Declarar os 24 `--fin-*`** em `:root`, mais o par escuro em `.dark`.
2. **Reescrever** o bloco de alias de `globals.css:251-303` apontando `--t-*` para `--fin-*`. Reescrever, não apagar. Idem para os `--ink*` (bloco de 1280) e os `--lg-*`.
3. **Flip do tema para claro:** `layout.tsx:35`, `layout.tsx:39` e `ThemeContext.tsx:12,15,20`, com a chave `entur-theme-v2`. **Sem isso a etapa 0 é invisível.**
4. **Remover o `style` inline de `card.tsx:18-23`.** Sem isso, o primitivo continua vencendo o sistema por especificidade, e no tema escuro o card continua branco.
5. **Trocar o anel de foco** de `box-shadow` (`globals.css:1092`) para `outline`, e remover `box-shadow: none` de `.min-shell [data-slot="button"]` (`:1497`).
6. **Remover `border-radius: 0`** das linhas 1497, 1505, 1519 e 1536.
7. **Publicar as escalas** `.fin-t-*` e os degraus de espaço, raio e sombra, mais o bloco `@media print`. Apagar os órfãos e criar o alias `--text-h2`.

**`.min-shell` não é removida na etapa 0.** `[enxerto de Sistema antes de tela]` A classe está no `<main>` global (`AppShell.tsx:150`) e nove páginas fora do financeiro dependem dela. As regras saem **uma por vez, junto com a migração de cada tela**, e o bloco só é apagado quando a última sair.

### 12.3 Como não quebrar a lógica financeira

**Regra absoluta: nenhum PR de redesenho altera um número.**

Antes de cada fatia:

```bash
cd /Users/brunobarbosa/financeiro-os
git checkout -b redesign/<tela>
```

Invariantes que **não podem** ser tocados, verificados em cada PR:

| # | Invariante | Onde |
|---|---|---|
| L1 | `filteredBase` e `filtered` continuam separados | `pagar/page.tsx:458,478` |
| L2 | Pseudo-status `'ABERTO'` continua no tipo do filtro | `pagar/page.tsx:154,480,700` |
| L3 | `somenteVencidos` continua no retorno de `periodoRange` | `pagar/page.tsx:445,454,467` |
| L4 | `'\|\| 0'` não vira `'?? undefined'` | `page.tsx:286,297,308,319` |
| L5 | `delta` null continua escondendo, nunca vira 0 | `page.tsx:274-277` |
| L6 | Data formatada por `formatDate`/`dataLocal`, nunca `new Date(iso)` | `money.ts:167` |
| L7 | Cortes 85/60 e 15/8 idênticos, movidos para `lib/faixas.ts` | |
| L8 | `origem === 'crm'` continua minúsculo | `page.tsx:189,198` |
| L9 | Baixa acumula `valor_recebido` e nunca marca integral com valor menor | `receber/page.tsx` |
| L10 | Nenhuma rota de API, nome de campo ou helper de `money.ts` muda | |

**Verificação de tipos (o comando correto para este repositório):**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

**Nunca `npx tsc`.** Neste repositório `npx tsc` resolve para um pacote falso que sai com código 0 sem checar nada. Um PR "verde" por `npx tsc` não foi verificado.

**Diff de lógica:** em cada PR, rodar e o resultado precisa ser vazio.

```bash
git diff origin/main -- src/lib/ src/app/api/
```

Se este diff não for vazio, o PR não é de redesenho e não entra nesta esteira.

### 12.4 Verificação de cada etapa

**Portões automáticos** (`scripts/check-fin.sh`, rodado no CI como **aviso, não bloqueio**):

```bash
#!/bin/bash
# Portões do redesenho financeiro. Aviso, não bloqueio: não trava entrega urgente.
M=src/app/financeiro-ag
echo "text-[Npx]:      $(grep -rho 'text-\[[0-9.]*px\]' $M | wc -l)   (meta 0, base 91)"
echo "style={{:        $(grep -ro 'style={{' $M | wc -l)   (meta 0, base 111)"
echo "select nativo:   $(grep -ro '<select' $M | wc -l)   (meta 0, base 23)"
echo "confirm/prompt:  $(grep -rn 'confirm(\|prompt(' $M | wc -l)   (meta 0, base 10)"
echo "const BRL:       $(grep -rn 'const BRL' $M | wc -l)   (meta 0, base 7)"
echo "label:           $(grep -ro '<label' $M | wc -l)   htmlFor: $(grep -ro 'htmlFor' $M | wc -l)"
echo "aria-:           $(grep -ro 'aria-' $M | wc -l)   (base 1)"
echo "hex cru:         $(grep -rEo '#[0-9a-fA-F]{6}' $M | wc -l)"
echo "travessao:       $(grep -rc '—\|–' $M | grep -v ':0' | wc -l) arquivos"
```

`[decisão registrada]` O juiz 1 apontou que "allowlist vazia no CI trava a esteira". Concordo: os portões rodam como **aviso**, com os números impressos no log do PR. O número precisa ser monotonicamente decrescente; um PR que aumenta qualquer contador é rejeitado na revisão humana, não pelo CI.

**Portão manual, por fatia:**

1. As quatro combinações de estado provocadas e conferidas: carregando, vazio real, vazio por filtro, erro de rede. Provocar erro com `devtools > Network > Offline`.
2. Conferida em 1280px, em 1280px com zoom 125%, e em tablet retrato.
3. Conferida no tema escuro apenas quanto a legibilidade (nada branco sobre branco).
4. Impressa em PDF, apenas quanto a legibilidade.
5. Um número comparado antes e depois: abrir a tela em `main` e no branch e conferir que o KPI principal e o total da tabela são idênticos.

**Baseline de captura** `[risco resolvido]`: antes do PR da fundação, capturar as rotas autenticadas fora do financeiro que consomem os mesmos tokens: `/grupo`, `/grupos`, `/vendas`, `/funis`, `/admin`. São elas que mudam de índigo para azul Entur sem que ninguém tenha pedido. A conferência dessas cinco é entregável nomeado da etapa 0, com tempo alocado, não "varredura visual".

### 12.5 Deploy

`[risco resolvido]` `fin.enturos.com` roda no Coolify e **push não auto-deploya**. Ordem obrigatória:

1. Push para a branch de staging. **Staging segue a branch `staging`, não `production`.**
2. Trigger manual do deploy de staging.
3. Conferir as cinco rotas de baseline mais a tela migrada.
4. Só então promover para produção, com trigger manual separado.

**A etapa 0 vai para produção sozinha**, antes de qualquer decisão sobre o resto. Ela devolve o azul Entur, o raio dos botões e o foco por teclado a todo o produto. Se o Bruno achar o `#004aad` pesado demais em área preenchida, todo o resto do plano muda, e é melhor descobrir no dia 2 do que no dia 16.

### 12.6 Antes de acender o estado de erro

`[enxerto de Linguagem primeiro, risco resolvido]` Trocar `crm-storage.ts` de "falha vira lista vazia" para "falha vira erro visível" **vai expor instabilidade que hoje está escondida atrás de zeros**. No curto prazo isso aumenta a percepção de que o sistema quebra e provavelmente aumenta tickets, com a confiabilidade exatamente igual.

Duas providências, ambas antes da etapa 1:

1. **Medir a taxa de falha por uma semana.** Instrumentar `loadEntities` para registrar falha sem mudar o comportamento. Corrigir o que der antes de acender o erro.
2. **Combinar com o Bruno**, por escrito, que o pico de ticket é esperado e é o preço de o produto parar de mentir. Mostrar zero por engano é pior que mostrar erro, mas a conta chega no dia do deploy.

### 12.7 Comunicação da mudança

`[risco resolvido]` Remover controle inerte é correto e chega sem aviso. O segmented de período da home e a pílula "Vencido" saem porque nunca funcionaram, mas para quem usa a tela todo dia isso lê como perda de função.

Entregável da etapa 12: uma nota de versão de um parágrafo por tela migrada, e uma faixa dispensável no topo da tela na primeira semana ("Esta tela mudou. O filtro de período agora fica na barra de filtros e o escopo está escrito em cada indicador.").

### 12.8 Dono da fundação

`[risco resolvido]` Nenhuma proposta disse quem revisa a próxima tela nova depois da entrega. Sem isso, daqui a um ano existe um quinto dialeto chamado `--fin-*` ao lado dos `--t-*`, `--ink-*`, `--lg-*` e `.min-*`.

Entregável da etapa 12: um `src/components/fin/README.md` de uma página com as oito regras da seção 2, o comando `check-fin.sh`, e a instrução explícita de que **um nono degrau tipográfico ou um quarto raio exige mudar este documento primeiro**, não adicionar ao lado.

---

## 13. Checklist binário de aceite

Cada item responde sim ou não olhando o resultado.

### Fundação
1. O produto abre no tema claro sem que o usuário mexa em nada.
2. O botão primário da tela de Contas a pagar é `#004aad`, verificado com conta-gotas.
3. `grep -n "background: '#ffffff'" src/components/ui/card.tsx` retorna vazio.
4. Um Tab a partir da barra de endereço mostra um anel azul visível no primeiro botão do módulo.
5. `grep -c "border-radius: 0" src/app/globals.css` não retorna nenhuma ocorrência dentro do bloco `.min-shell` para button, input, card ou badge.
6. Os 24 tokens `--fin-*` têm par declarado em `.dark`.
7. As cinco rotas de baseline (`/grupo`, `/grupos`, `/vendas`, `/funis`, `/admin`) foram abertas e nenhuma está ilegível.

### Sistema
8. `node node_modules/typescript/bin/tsc --noEmit` sai com código 0.
9. `grep -rho "text-\[[0-9.]*px\]" src/app/financeiro-ag | wc -l` retorna 0.
10. `grep -ro "style={{" src/app/financeiro-ag | wc -l` retorna 0.
11. `grep -rn "const BRL" src/app/financeiro-ag | wc -l` retorna 0.
12. `grep -rn "confirm(\|prompt(" src/app/financeiro-ag | wc -l` retorna 0.
13. `grep -ro "<select" src/app/financeiro-ag | wc -l` retorna 0.
14. Contagem de `<label>` igual à de `htmlFor`, ou ambas zero.
15. `grep -rl "—\|–" src/app/financeiro-ag` retorna vazio.
16. `src/components/ui/KpiCard.tsx` e `src/components/ui/QuickAction.tsx` não existem mais. `funis/PainelKPIs.tsx` continua intacto.
17. `git diff main -- src/lib/ src/app/api/` é vazio em todos os PRs de redesenho.

### Tela
18. A home tem exatamente um `<h1>`.
19. A home tem exatamente um elemento em 30px.
20. A home não tem nenhum controle de período.
21. A lista da home está ordenada por vencimento e intercala entradas e saídas.
22. Nenhuma data aparece no formato `2026-09-06` em nenhuma tela.
23. Nenhuma tela mostra "312 evts", "build", "BRL UTC-3" ou o nome "Bruno" cravado.
24. Contas a pagar tem uma linha de filtro, não duas fileiras de pílulas.
25. Contas a pagar mostra "N de M despesas" em algum lugar visível.
26. Não existe mais a opção de status "Vencido" em Contas a pagar.
27. O formulário de Contas a pagar abre em painel lateral e não empurra a tabela.
28. Não é possível abrir o formulário e o Copiar mês ao mesmo tempo.
29. Dar baixa em Contas a receber abre um diálogo, não um `window.prompt`.
30. O mesmo status renderiza com a mesma cor em Pagar e em Receber.
31. As telas de Cartões e Contas bancárias não têm fundo azul.
32. Contas bancárias tem uma linha de total no rodapé.
33. Toda tabela do módulo tem cabeçalho de coluna real.
34. Nenhuma tabela tem zebra.
35. O `Meter` de utilização de cartão mostra a palavra da faixa, além da cor.

### Estados
36. Com a rede desligada, nenhuma das 10 telas mostra R$ 0,00; todas mostram erro com botão de tentar de novo.
37. Com a rede desligada, "Atualizar" na home não dispara toast de sucesso.
38. Durante o carregamento, nenhuma tela mostra R$ 0,00 nem "(0)".
39. O esqueleto da home tem a forma dos 4 blocos, não 4 caixas soltas.
40. Filtrando até zerar, a mensagem oferece limpar filtros, não cadastrar.
41. Em conta nova, a home mostra o onboarding e nada mais até 4 de 4.

### Acessibilidade
42. Nenhum texto do módulo está em `#94A3B8`.
43. Nenhum texto abaixo de 12px, exceto `.fin-t-overline` em 11px.
44. Todo botão só de ícone tem `aria-label`.
45. Ordenar uma coluna funciona com Enter, sem mouse.
46. Em 1280px com zoom 200%, nenhuma tela perde conteúdo.
47. Nenhum alvo clicável abaixo de 40px no desktop.

---

## 14. O que explicitamente NÃO vai ser feito nesta rodada

### 14.1 Baixa em lote (seleção múltipla)

Todas as três propostas vendiam "Pagar selecionadas" como a mudança que corta de verdade o custo da tarefa. É verdade, e é exatamente por isso que **sai daqui**.

**Motivo:** não é apresentação. É uma operação nova: N escritas, o que fazer quando 3 de 20 falham, idempotência de reenvio, baixa parcial dentro do lote, e um rodapé de total que precisa bater com o que foi efetivamente gravado. A auditoria que corrigiu mais de 50 erros de cálculo não cobriu esse caminho porque ele não existia. Entrar de carona numa PR de tipografia é a forma mais eficiente de reabrir a auditoria pela porta dos fundos. Os três juízes convergiram nisso de forma independente.

**Vira item próprio**, com especificação de comportamento parcial e teste.

### 14.2 Baixa direto da linha na home

Pela mesma razão. A lista de "Próximos 15 dias" tem botão "Dar baixa", mas ele **navega para a tela de origem com o registro aberto**; não executa a baixa ali. O caminho de baixa em `receber/page.tsx` acumula `valor_recebido` e decide entre `PARCIAL` e `RECEBIDO` comparando com o saldo em aberto. Expor isso num botão de dashboard sem os três números na frente facilita um erro de dinheiro.

### 14.3 Paginação e virtualização de tabela

As 10 telas carregam tudo e renderizam tudo. Com 340 despesas isso funciona; com 5.000 congela, e o que congela é o DOM, não a consulta. **Não vai ser resolvido aqui**, mas o redesenho não piora o quadro: a `FinTable` renderiza no máximo 7 colunas com uma ação visível por linha, contra as 8 colunas e 3 botões de hoje, ou seja, menos elementos por linha.

Mitigação mínima nesta rodada: teto de 200 linhas renderizadas com aviso "mostrando 200 de N, refine o filtro". Paginação real é item próprio.

### 14.4 Auditoria visual do tema escuro

Os 24 tokens ganham par escuro e o par foi medido contra AA. **Nenhuma das 10 telas é conferida pixel a pixel no escuro.** Garantia entregue: nada branco sobre branco, nada ilegível. Garantia não entregue: que o escuro fique bonito.

**Motivo:** o produto passa a abrir no claro e a identidade Entur é uma identidade clara. Conferir 10 telas x 4 estados x 2 temas é dobrar o custo de verificação por um tema que deixa de ser o padrão.

### 14.5 Redesenho de impressão e exportação

Entra na fundação um `@media print` que garante legibilidade (fundos brancos, bordas visíveis, cabeçalho de tabela repetido, sem quebra dentro de linha). **Não entra** layout de impressão desenhado, cabeçalho com logo, paginação numerada, nem CSV redesenhado.

O que **é** garantido: o dicionário de rótulos é o mesmo na tela e na exportação, então o suporte não passa a operar com dois vocabulários.

### 14.6 Internacionalização

O `Money` aceita `moeda` e o dicionário de status vive em um arquivo único e chaveável, para que o i18n futuro não exija reescrever componente. **Nenhuma string é externalizada nesta rodada.** As larguras usam `min-width`, nunca `width`, para que o símbolo de outra moeda não estoure a coluna.

### 14.7 Mudança de vocabulário do produto

O `<Jargao>` entra e o glossário da seção 10 é aplicado. **O que não entra** é a tese de "Linguagem primeiro" de transformar todo H1 em pergunta ("Vai faltar dinheiro?", "Seu dinheiro hoje").

**Motivo:** os três juízes reprovaram. O benchmark pedido (Linear, Ramp, Stripe) não pergunta nada no H1; escreve "Bills", "Balances". Ferramenta de trabalho com tom de fintech de consumo lê como menos séria. E "uma pergunta por tela" é escolha editorial sem critério objetivo de arbitragem: no dia em que alguém discordar de qual número é a resposta da home, a coerência inteira desmonta.

### 14.8 Remoção da classe `.min-shell`

O bloco `globals.css:1472-1548` **não é apagado nesta rodada**. As regras saem uma a uma, junto com a migração de cada tela, e o bloco só morre quando a décima sair. Nove páginas fora do financeiro dependem dele hoje.

### 14.9 Medição de tempo de tarefa antes e depois

Os três juízes apontaram, corretamente, que o plano mede `grep` e contraste, que são proxies de higiene, e não cronometra a tarefa real. **Concordo que falta, e não entra nesta rodada**, porque exigiria acesso a usuários reais e um protocolo que ninguém tem.

Substituto honesto e barato, entregável da etapa 4: a contabilidade em pixels da primeira dobra, antes e depois, por tela. "Em Contas a pagar, 504px são consumidos antes da primeira linha de dados; depois são 292px, e passam de 3 para 9 linhas visíveis em 1280x800." Não é medição de usuário, mas não é adjetivo.

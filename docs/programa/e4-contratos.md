# E4 — Mudança v1: "Mudar para o EnturOS" (05/11/2026)

Plano: `~/.claude/plans/monta-um-plano-para-serene-prism.md` (seção "Mudança de sistema" e entrega E4).
Análise (só leitura): `~/Documents/EnturOS Financeiro - analise do concorrente/detalhes/` — o que cada lista exporta e com quais colunas (02-pagar-receber.md §1.1 "Grade", 01-contas-bancos.md, 05-venda-fornecedores-config.md, `telas-em-texto/`).
Valem TODAS as regras de `docs/programa/e2-contratos.md` e as de `e3-contratos.md` que couberem. Nome do concorrente em nada; na tela, "sistema anterior".

## O que a agência ganha
Trazer os dados do sistema anterior sem medo: exporta as listas de lá (Excel, CSV ou texto), solta aqui, vê um **ensaio** do que vai ser criado, vinculado ou recusado (com o motivo), **aplica** em blocos, recebe as **provas** de que bateu (saldo de cada conta na data de corte, a pagar/receber em aberto por pessoa, total por mês × categoria) e pode **desfazer** tudo. Durante a mudança **nada sai**: nada de cobrança, WhatsApp, nota, comissão nem aviso ao CRM.

## O que entra na v1
Na ordem: **contas bancárias e cartões** → **categorias e centros de custo** → **pessoas** (clientes e fornecedores) → **títulos em aberto** (a pagar e a receber, com parcelas) → **saldos de abertura** de cada conta na data de corte. Histórico liquidado, vendas, faturas, notas, comissões e metas ficam para a v2 (E7).

## Regras
1. **Leitor de planilha**: XLSX, XLS, CSV (`;` ou `,`, UTF-8 ou Latin-1) e TXT tabulado; datas `dd/mm/aaaa` e serial do Excel; dinheiro `1.234,56`; linha de total do rodapé ignorada; lista cortada ("muitos registros") detectada e avisada (o sistema anterior corta listas grandes: um arquivo por mês).
2. **Mapeamento por cabeçalho**: dicionário de sinônimos por lista (ex.: Pessoa/Cliente/Fornecedor/Razão social; Vencimento; Emissão; Liquidação; Valor/Valor Final; Documento; Descrição; Conta; Empresa; Situação; Movimento Pagar/Receber; Categoria/Grupo; Centro de custo; Venda Nº; Fatura Nº; Vendedor; CPF/CNPJ; E-mail; Telefone). A pessoa confirma ou troca o mapeamento; nunca digita sintaxe. Coluna desconhecida = ignorada e listada.
3. **Identidade** (não duplicar): pessoa por CPF/CNPJ; e-mail/telefone igual só junta com o mesmo nome (regra do CRM); liga com clientes/fornecedores já existentes (escada de `src/lib/fornecedor-sync.ts`); categoria por nome normalizado dentro do tipo; conta bancária por banco+agência+conta ou nome. Título: chave natural (pessoa + documento + vencimento + valor + parcela) para não importar duas vezes o mesmo arquivo.
4. **Ensaio** (padrão): lê, mapeia, identifica e mostra o resultado SEM gravar. **Aplicar** grava em lotes pela fila do agendador, com um `lote_id`; cada registro criado guarda o `lote_id` e a origem (arquivo, linha).
5. **Desfazer**: apaga só o que o lote criou e que ninguém mudou depois (mudado = fica e aparece na lista do que não foi desfeito, com o motivo); nada recalcula o passado em silêncio.
6. **Nada sai**: o lote inteiro roda dentro de `nadaSai` (`src/lib/nada-sai.ts`); régua, cobrança, notas e avisos só ligam em "Concluir mudança".
7. **Saldos de abertura**: na data de corte, o saldo de cada conta é o informado pelo sistema anterior; o razão recebe o lançamento de abertura (`src/lib/razao-servidor.ts`), sem mexer no que já existe.
8. **Provas**: por conta (saldo na data de corte: sistema anterior × EnturOS), por pessoa (em aberto a pagar e a receber), por mês × categoria (títulos importados), com cada diferença explicada (linha recusada, duplicada, sem categoria...). PDF "Prova da mudança" para o contador.
9. **Glossário** "como chamava lá → como chama aqui" e **checklist de paridade** (os 15 blocos do plano, com o que já existe e onde fica) dentro do produto e na busca ⌘K. Só termos de mercado; nada de nome exclusivo do sistema anterior.
10. Permissão: só administrador inicia, aplica, desfaz e conclui.

## Partes
- **A — Servidor** (`src/lib/migracao/*`): leitor, dicionário de sinônimos, mapeamento, identidade, ensaio, aplicação em lote pela fila, desfazer, saldos de abertura, provas (dados e PDF), esquema `MIGRACAO_SCHEMA_SQL` (lotes, arquivos, linhas com resultado e motivo, vínculos origem → registro), rotas `/api/mudanca/*`. Testes com planilhas montadas no formato das listas do sistema anterior (colunas do relatório 02 §1.1 e 01), inclusive lista cortada, linha de total, Latin-1, serial do Excel, duplicado, pessoa com mesmo e-mail e nome diferente, desfazer com registro mudado depois.
- **B — Telas**: assistente "Mudar para o EnturOS" (`/mudanca`): 1) o que exportar de cada lista (passo a passo em palavras, com as colunas a ligar e "um arquivo por mês") → 2) soltar os arquivos → 3) conferir o mapeamento → 4) ensaio (criado/vinculado/recusado com motivo, filtros) → 5) aplicar (barra de progresso) → 6) provas (e PDF) → 7) concluir ou desfazer. Glossário e checklist de paridade em telas próprias e no ⌘K.

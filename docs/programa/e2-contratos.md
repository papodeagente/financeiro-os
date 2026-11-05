# E2 — Dia a dia: contratos entre as partes (05/11/2026)

Plano completo: `~/.claude/plans/monta-um-plano-para-serene-prism.md` (entrega E2).
Análise de referência (só leitura): `~/Documents/EnturOS Financeiro - analise do concorrente/detalhes/`
(relatórios 01–05 e `telas-em-texto/` com cada tela do concorrente: nomes, filtros, colunas, ações).

## Regras para todas as partes
1. **Nome do concorrente em nada** (código, comentário, teste, arquivo, tela, commit). Na tela, quando precisar, "sistema anterior".
2. **Não estragar o que funciona.** Telas e rotas atuais continuam; o novo entra ao lado. Antes de mexer numa área, congelar o comportamento atual em teste.
3. **Vocabulário de mercado, nunca o do concorrente** (05/11, regra do dono: "não pegar nomes exclusivos dele e parecer cópia"). Liberados (termos do mercado): Contas a pagar/receber, Baixa/Liquidar, Em aberto, Em atraso, Pago/Recebido, Extrato de conta, Movimentações, Fechar caixa, Fluxo de caixa (previsto/realizado), DRE, Centro de custo, Rateio, Categoria, Repasse, Taxa DU, RAV, Over, Fee, Fatura, Regras de faturamento, Reembolso, Carnê, Recibo, Juros, Multa, Desconto. Proibidos (nomes/frases do concorrente): "Lei Kandir" como retenção, "Cartão Passagem", "Fornecimento"/"Representação" como nome de tela, "Consulta Global de Log", "Resumo Geral", "Grupos de Usuário"/"Acesso Total", "Taxa de Serviço Oculta/Destacada", "Saldo Excluído", "Gerar Lançamento", "Parcelas adicionais", "Demonstrativo por Categorias", "Lançamentos por ...", e QUALQUER mensagem copiada palavra por palavra das telas dele. Regras e comportamento iguais; textos nossos. Código dele: nunca (não temos e não copiamos).
4. **Telas**: carregar a skill `impeccable` (modo Operate, painel) antes do primeiro JSX; seguir `docs/design-system.md` (só tokens `--fin-*`, verificado por `scripts/test-design-system.ts`) e os componentes de `src/components/fin` (FinTable, FilterBar, RecordSheet, ConfirmDialog, MoneyField, StatusChip, PageHeader, MolduraDaPagina...). Nunca pedir que o usuário digite sintaxe.
5. **Dinheiro**: tabelas novas em centavos `BIGINT` (`paraCentavos`/`deCentavos` em `src/lib/money.ts`); telas em reais. Sempre `tenant_id`.
6. **Esquema**: cada módulo exporta `XXX_SCHEMA_SQL` idempotente e o `initDB` (`src/lib/db.ts`) executa antes de `RAZAO_SCHEMA_SQL`. Tabelas imutáveis/controle entram no `NOT IN` de `src/lib/audit-schema.ts`.
7. **Movimento de caixa** só por `aplicarMovimentoCaixaAtomico(tenant, conta, delta, exec, origem)` (origem obrigatória; grava no razão).
8. **Tarefas agendadas**: exportar uma `DefinicaoTarefa` (ver `src/lib/agendador/nucleo.ts`); quem integra registra em `src/lib/agendador/tarefas.ts`.
9. **Não editar** `package.json` (script de teste), `src/components/PillarSidebar.tsx` nem `src/lib/agendador/tarefas.ts`: informe no relatório final os testes a encadear, os itens de menu e as tarefas a registrar.
10. **Testes**: lógica pura com `scripts/run-tests.mjs`; SQL real com PGlite + `db-de-teste-hook.mjs` (molde: `scripts/test-sql-razao.mjs`). `npx tsc --noEmit` (com `NODE_OPTIONS=--max-old-space-size=10240`) limpo.
11. **Permissões**: até a parte de permissões entrar, use as guardas atuais (`recusaFinanceira`, `recusaExclusao`, `recusaAdmin` em `src/lib/guarda-rota.ts`).

## Contrato da liquidação (parte "baixas", feita pela coordenação)
- `POST /api/baixas` corpo `{ modo: 'previa' | 'gravar', itens: ItemBaixa[], assinatura?: string }`, cabeçalho `Idempotency-Key` ao gravar.
- `ItemBaixa = { titulo_tabela: 'contas_receber'|'contas_pagar', titulo_id, data (AAAA-MM-DD), conta_bancaria_id, forma, valor (reais pagos agora), juros?, multa?, desconto?, taxa?, tratamento_diferenca?: 'deixar_aberto'|'desconto'|'acrescimo'|'credito'|'taxa' }`.
- Prévia devolve por item: encargos sugeridos, saldo depois, diferença, avisos; e `assinatura` exigida para gravar.
- `POST /api/baixas/[id]/estorno` `{ motivo, data? }`; `GET /api/baixas?titulo_tabela=&titulo_id=` (histórico).
- Biblioteca: `src/lib/baixa-calculo.ts` (`calcularEncargos`), `src/lib/baixas-servidor.ts`.

## Contrato do fechamento de período ("Fechar Caixa", coordenação)
- Tabelas `periodos_fechados` / `periodos_eventos`; função SQL `fin_periodo_fechado(tenant, conta, data)`; erro `PERIODO_FECHADO:<data>` → HTTP 423.

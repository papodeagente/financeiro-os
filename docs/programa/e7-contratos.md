# E7 — Mudança v2 e paridade final: contratos (06/11/2026)

Plano: `~/.claude/plans/monta-um-plano-para-serene-prism.md` (seção "Mudança de sistema" e entrega E7).
Valem todas as regras de `e2-contratos.md` e as da mudança v1 (`e4-contratos.md`): nome do concorrente em nada (na tela, "sistema anterior"), termos de mercado, centavos, nada sai durante a mudança, desfazer só o que ninguém mexeu.

## Parte A — o que ficou pronto (mudança v2 e mês em paralelo)

**Listas novas no dicionário** (`src/lib/migracao/dicionario.ts`, etapa depois dos saldos): `liquidados` (contas já liquidadas; a mesma exportação de Contas a Pagar/Receber, reconhecida pelo conteúdo quando a maioria das linhas tem Liquidação, `listaPeloConteudo`), `movimentos` (extrato e movimentações), `vendas` (vendas por produto), `faturas`, `notas`, `comissoes_pagas`, `metas`, `reembolsos`, `creditos`. Leitura em `interpretar-historico.ts`; decisão (a mesma no ensaio e na aplicação) em `plano-historico.ts`; gravação em `gravador-historico.ts`.

**Regra do dinheiro em dobro.** O saldo informado na data de corte já contém todo o dinheiro movido até ali. Cada liquidação antiga (data ≤ corte) entra pela liquidação no servidor (`registrarBaixas`, origem `migracao`, na data e na conta de lá) e, na mesma transação, um lançamento de abertura do mesmo valor no sentido contrário (razão: `tipo 'abertura'`, `tabela 'baixas'`, id da baixa) e o `saldo_inicial` da conta cai o mesmo tanto. Saldo de hoje e saldo na data de corte não mudam; o extrato parte do saldo inicial e chega no informado; o razão soma o saldo. Liquidada depois do corte entra em aberto (regra da v1). Prova em `provas-historico.ts` (`contas_no_corte`).

**Extrato**: a linha que já é baixa (mesma conta, data, valor, lado e pessoa) se liga a ela; a que não é vira conta liquidada (pessoa "Sem pessoa informada" quando falta); transferência entre contas e o que é depois do corte ficam de fora com o motivo.

**Vendas**: as linhas com o mesmo Venda Nº viram UMA venda completa (`salvarVenda`, `origem: 'mudanca'`, `cabecalho.numero_anterior`), com passageiros (tarifa repartida) e componentes (Comissão, Over, Taxa DU, RAV, Fee, Markup, Desconto, Taxa CC). **Venda de origem `mudanca` nunca gera contas** (`salvarVenda` pula a regeração, pendências, carteira e faturas, também ao editar e cancelar): as contas dela são as trazidas com o mesmo Venda Nº, ligadas por `origem_venda_id`/`venda_id` com `origem 'VENDA'` (a posição da venda as lê). `calcularNoBanco` (comissões por função) ignora venda `mudanca` (a comissão dela foi paga lá e fica no registro). Esquema: `vendas_modelo_origem_ok` aceita `mudanca` (ALTER idempotente).

**Registros** (só consulta): `migracao_historico` (faturas, notas emitidas — nunca reemitidas —, comissões já pagas), ligados à venda trazida quando há. **Metas** na pessoa da função (`comissao_metas`, pelo nome da pessoa e da função). **Reembolsos** por `criarReembolso` (SOLICITADO; quando a conta dele já veio nas contas em aberto, passa a APROVADO usando essa conta, sem conta nova). **Créditos** por `criarCredito` (origem `AJUSTE`, `origem_ref` `mudanca:<chave>`; vencido fica fora).

**Desfazer**: estorna cada liquidação trazida (`estornarBaixa`) e devolve a abertura (razão), apaga vendas, registros, reembolsos e créditos que ninguém mexeu, devolve as metas ao valor de antes; o que foi mexido fica com o motivo.

**Mês em paralelo**: lote com `opcoes.modo = 'paralelo'` e `opcoes.mes` (não conta como mudança em andamento, nunca ensaia nem aplica). Comparação pura em `comparar-mes.ts` (`bate`, `data`, `valor`, `so_la`, `so_aqui`; por conta, pessoa e categoria), servidor em `paralelo.ts` (só lê), PDF em `pdf.ts` (`pdfDoMesEmParalelo`).

**Rotas novas**: `GET|POST /api/mudanca/paralelo` (`{ mes }` + Idempotency-Key), `GET /api/mudanca/lotes/[id]/paralelo`, `GET /api/mudanca/lotes/[id]/paralelo/pdf`, `GET /api/mudanca/historico?tipo=&busca=&pagina=`. As de sempre do lote servem os arquivos e as colunas da comparação. Só administrador.

**Telas**: no assistente `/mudanca`, o histórico no passo 1 (bloco recolhível), a aba "Histórico" nas provas, e os passos 8 "Regras e planos" (perguntas que montam o plano de comissão — `PUT /api/comissoes-por-funcao/planos` — e a regra de faturamento do cliente — `POST /api/regras-faturamento`, com a prévia das próximas faturas) e 9 "Mês em paralelo". Tela `/mudanca/historico` (registros trazidos). Checklist de paridade com os itens da E5 e da E7 ligados às telas.

**Testes**: `scripts/test-migracao-historico.ts` (puro) e `scripts/test-sql-migracao-historico.mjs` (PGlite pelas rotas).

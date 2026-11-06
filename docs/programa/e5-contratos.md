# E5 — Venda e turismo: contratos (05/11/2026)

Plano: `~/.claude/plans/monta-um-plano-para-serene-prism.md` (blocos 6 a 11 e 15; entrega E5).
Análise (só leitura): `~/Documents/EnturOS Financeiro - analise do concorrente/detalhes/05-venda-fornecedores-config.md`, `03-cobranca-faturas.md` (§1.9–1.11), `04-fiscal-comissoes.md` e `telas-em-texto/`.
Valem TODAS as regras de `docs/programa/e2-contratos.md` (nome do concorrente em nada; termos de mercado: Taxa DU, RAV, Over, Fee, Fatura, Regras de faturamento, Nota de débito, Reembolso, Crédito do cliente; proibidos: "Taxa de Serviço Oculta/Destacada", "Fornecimento"/"Representação" como nome de tela, "Lei Kandir" como retenção, "Gerar Lançamento", "Saldo Excluído"...).

## O que já existe e NÃO pode piorar
`src/lib/venda-financeiro.ts` (`gerarContasVenda`: contas a receber e a pagar da venda, comissão do fornecedor quando o cliente paga direto), `src/lib/venda-turismo.ts` (linhas net × venda, taxa de serviço), `src/lib/venda-cancelamento.ts`, integração `VENDA_FECHADA` v1 do CRM (`src/lib/crm-integration.ts`), comissões (`src/lib/comissao-*.ts`), NFS-e (`src/lib/nfse-*.ts`). Congelar em teste antes de mexer: contas geradas por uma venda do CRM v1, comissão do mês, cálculo da nota.

## Parte A (alicerce) — a venda completa
- **Modelo**: venda com produtos por tipo (Aéreo, Aéreo agência, Hospedagem, Pacote, Cruzeiro, Seguro, Locação, Receptivo, Ingresso, Outros), **passageiros** por produto (nome, documento, tarifa, taxas), **componentes de receita** por produto com os nomes de mercado (Comissão, Over, Taxa DU, RAV, Fee, Markup, Desconto) — a agência escolhe quais entram na receita (`receitaDaVenda`, configurável e mostrada aberta), **quem cobra cada item** (agência ou fornecedor direto), **moeda e câmbio** por produto (digitável sempre), **fornecedor e representante/intermediário**.
- **Pagamentos da venda por forma**: Dinheiro, Cheque, Boleto, Cartão, Depósito, Pix, Faturar, Outros, Crédito do cliente, Crédito no fornecedor, Retido pelo intermediário, Pago direto ao fornecedor — cada forma vira, **sozinha**, as contas certas (a receber, a pagar, comissão a receber), sem botão de "gerar". Contas baixadas nunca são regeradas (regra de hoje).
- **Posição da venda**: cliente pago/pendente, fornecedor pago/pendente, receita (aberta por componente), alerta "pagar o fornecedor antes de o cliente pagar".
- **Fechar/Reabrir venda** (direitos do catálogo; reabrir com motivo).
- **Contrato com o CRM**: `VENDA_FECHADA` **v2** (passageiros, componentes, quem cobra, moeda, comissão) convive com a v1; o Financeiro anuncia suporte e o CRM passa a mandar v2 (PR no CRM em parte própria). Venda lançada à mão e venda do CRM usam o MESMO modelo e o mesmo gerador.
- **Tela da venda** com as abas Produtos, Pagamentos, Cliente (financeiro do cliente), Fornecedor, Comissões e Posição.
- Exporta para as outras partes: tipos `Venda`, `ProdutoDaVenda`, `Passageiro`, `ComponenteDeReceita`, `PagamentoDaVenda`; `receitaDaVenda`, `contasDaVenda` (sucessor de `gerarContasVenda`, que continua respondendo igual para a v1), `posicaoDaVenda`; esquema `VENDA_SCHEMA_SQL`.

## Parte A — o que ficou pronto (contrato para B–G)
Tudo em português; dinheiro do MODELO em centavos inteiros (`Centavos`), na moeda do produto; pagamentos em centavos de real; contas (JSONB de sempre) em reais.

**Módulos puros (servem tela e servidor):**
- `src/lib/venda-modelo.ts` — tipos `Venda`, `ProdutoDaVenda`, `Passageiro`, `ComponenteDeReceita`, `PagamentoDaVenda`, `ParteDaVenda`, `TipoProduto` (`TIPOS_PRODUTO`, `ROTULO_TIPO_PRODUTO`, `CAMPOS_DO_TIPO`), `TipoComponente` (`TIPOS_COMPONENTE`, `COMPONENTES` com rótulo, natureza e sinal), `FormaDaVenda` (`FORMAS_DA_VENDA`, `FORMAS` com efeito e código da forma de pagamento), `QuemCobra`, `SituacaoDaVenda`. Funções: `normalizarVenda` (devolve `{ venda, erros }`; percentual sem valor vira valor sobre a tarifa; número de cartão mascarado), `normalizarProduto`, `normalizarPagamento`, `totaisDoProduto` (tarifa, taxas, componentes, `valor_cliente`, `valor_fornecedor`, `repasse`, `receita_bruta`, e o mesmo em `brl`), `totaisDaVenda` (inclui `saldo_sem_forma`), `parteDoAcerto` (representante, senão fornecedor), `vencimentoDaParcela`, `emReais`, `reaisParaCentavos`.
  Fórmulas: `valor_cliente = tarifa + taxas + Taxa DU + RAV + Fee + Markup − Desconto`; `valor_fornecedor = tarifa + taxas − Comissão − Over + Taxa CC`; `receita_bruta = valor_cliente − valor_fornecedor − Repasse`. Passageiro e produto com `cancelado_em` não entram (a parte D preenche `cancelado_em`).
- `src/lib/venda-receita.ts` — `ConfigReceita`, `CONFIG_RECEITA_PADRAO` (todos contam), `normalizarConfigReceita`, `receitaDaVenda(venda, config)` → `{ linhas (por componente, com entra/sinal), por_produto, receita, fora_da_receita, faturamento, percentual }`. A escolha muda só a receita mostrada/somada, nunca as contas.
- `src/lib/venda-contas.ts` — `contasDaVenda({ versao: 1, entrada })` = `gerarContasVenda` (idêntico, provado) e `contasDaVenda({ versao: 2, venda, fornecedores?, hoje? })`. Saída `ContasDaVenda` = `ContasGeradas` + `versao`, `pendencias: PendenciaDaVenda[]`, `avisos: AvisoDaVenda[]`. Toda conta v2 leva `origem_item_id` = chave natural (`v2:pag:<pagamento>`, `v2:saldo`, `v2:forn:<parte>:<moeda>`, `v2:comissao:<parte>`, `v2:repasse:<intermediário>`; complemento `…:complemento`), e `venda_modelo: 2`, `venda_chave`, `venda_pagamento_id`, `venda_forma`, `venda_parte_id`, `venda_produtos`, `faturar` (forma Faturar).
  Por forma: Dinheiro/Cheque/Boleto/Cartão/Depósito/Pix/Outros → conta a receber do pagante por parcela; **Faturar** → conta a receber com `faturar: true` (a **parte B** a junta na fatura); **Crédito do cliente** → nenhuma conta, `PendenciaDaVenda { tipo: 'CREDITO_CLIENTE', chave: 'v2:credito:<pagamento>' }` (a **parte D** baixa da carteira e chama `resolverPendencia`); **Crédito no fornecedor** e **Pago direto ao fornecedor** → abatem o acerto daquele fornecedor; **Retido pelo intermediário** → conta a receber DO intermediário (origem `OUTROS`), já sem o repasse. Fornecedor: por pessoa do acerto, saldo positivo = conta a pagar (na moeda quando é uma só), negativo = `COMISSAO_FORNECEDOR` a receber. O que nenhuma forma cobre = conta `v2:saldo` do cliente.
- `src/lib/venda-posicao.ts` — `posicaoDaVenda({ venda, contas_receber, contas_pagar, cobrancas?, pendencias?, config?, hoje })` → `{ cliente, fornecedores[], fornecedor, receita, alertas[] }`; alertas `FORNECEDOR_PAGO_ANTES`, `FORNECEDOR_VENCE_ANTES`, `CLIENTE_EM_ATRASO`, `SALDO_SEM_FORMA`, `PAGAMENTOS_ACIMA_DO_TOTAL`, `CREDITO_PENDENTE`.
- `src/lib/venda-modelo-v1.ts` — `vendaDoV1` (a venda de antes lida no modelo, só para mostrar), `TIPO_DO_V1`, `TIPO_PARA_V1`.
- `src/lib/venda-crm-v2.ts` — `ehVendaV2(payload)`, `lerVendaV2(payload, base)`.

**Servidor:** `src/lib/venda-schema.ts` (`VENDA_SCHEMA_SQL`: `vendas_modelo`, `venda_produtos`, `venda_passageiros`, `venda_componentes`, `venda_pagamentos`, `venda_pendencias`, `venda_eventos` imutável e fora da auditoria). `src/lib/venda-servidor.ts`: `salvarVenda(exec, tenant, venda, { usuario, origem, cabecalho?, evento? })` (um caminho para tela e CRM; venda fechada → `ErroVenda('VENDA_FECHADA', 409)`), `carregarVenda` → `VendaCarregada` (modelo v2 ou a venda de antes traduzida), `regerarContasDaVenda` (conta baixada ou com cobrança valendo nunca muda; a diferença vai para as contas livres do mesmo lado; livre que continua é atualizada no lugar, mantendo categoria, centro de custo, rateio, anexos e observação), `fecharVenda`/`reabrirVenda` (motivo ≥ 10 letras; `conferirFechamento`), `posicaoDaVendaNoBanco`, `contasDaVendaNoBanco`, `listarPendencias`, `resolverPendencia`, `registrarEventoDaVenda`, `situacaoDaVenda`, `versaoDoModelo`, `lerConfigVenda`, `ladoDaConta`, `cabecalhoDaVenda`. Direitos novos no catálogo: `fechar_venda`, `reabrir_venda`.
**Rotas** (contrato em `src/lib/venda-rota.ts`): `POST /api/vendas/completa`, `POST /api/vendas/completa/previa`, `GET|PUT /api/vendas/completa/[id]`, `POST /api/vendas/completa/[id]/fechar` `{ confirmar? }`, `POST /api/vendas/completa/[id]/reabrir` `{ motivo }`, `GET|PUT /api/config/vendas`. Telas: `/vendas/[id]/ficha`, `/vendas/lancar`, `/config/vendas`.

**VENDA_FECHADA v2 (para a parte G, no CRM):** o mesmo envelope e os MESMOS campos da v1 (cliente_*, vendedor_*, crm_venda_id, data_venda, valor_total, custo_total, fornecedores[], plataforma, historico...) mais `versao_venda: 2` e o bloco `venda`. Valores em reais. Ids estáveis por `ref` (reenviar a mesma venda dá as mesmas contas).
```json
{
  "versao_contrato": 2, "versao_venda": 2,
  "crm_venda_id": "deal_123", "cliente_id": "crm_contact_9", "cliente_nome": "Carla Dias", "cliente_cpf_cnpj": "…", "cliente_email": "…",
  "vendedor_id": "crm_user_5", "vendedor_nome": "…", "vendedor_email": "…",
  "data_venda": "2026-11-01", "valor_total": 5760, "custo_total": 5055,
  "fornecedores": [{ "fornecedor_id": "crm_supplier_11", "crm_supplier_id": "11", "fornecedor_nome": "Hotel Mar", "valor_custo": 1900, "valor_venda": 2360 }],
  "venda": {
    "intermediario": { "fornecedor_id": "crm_supplier_33", "crm_supplier_id": "33", "fornecedor_nome": "Agência Parceira", "fornecedor_cnpj": "…" },
    "centro_custo": "", "observacoes": "",
    "produtos": [{
      "ref": "h1", "tipo": "HOSPEDAGEM", "descricao": "Hotel Mar 4 noites", "produto_crm_id": "prod_7",
      "fornecedor": { "fornecedor_id": "crm_supplier_11", "crm_supplier_id": "11", "fornecedor_nome": "Hotel Mar", "fornecedor_cnpj": "…" },
      "representante": null,
      "quem_cobra": "AGENCIA", "moeda": "BRL", "cambio": 1,
      "localizador": "HM123", "data_inicio": "2026-12-20", "data_fim": "2026-12-24", "data_pagamento_fornecedor": "",
      "quantidade": 1, "valor_unitario": 0, "taxas": 0, "detalhes": { "hotel": "Hotel Mar", "regime": "Café" },
      "passageiros": [{ "ref": "a", "nome": "Carla Dias", "tipo": "ADT", "documento": "…", "tarifa": 1000, "taxas": 50, "outras_taxas": 0 }],
      "componentes": [{ "ref": "c1", "tipo": "COMISSAO", "percentual": 10 }, { "tipo": "RAV", "valor": 30, "passageiro_ref": "a" }, { "tipo": "MARKUP", "valor": 200 }]
    }],
    "pagamentos": [
      { "ref": "pix", "forma": "PIX", "valor": 500 },
      { "ref": "bol", "forma": "BOLETO", "valor": 1000, "parcelas": 2, "primeiro_vencimento": "2026-12-10", "intervalo_dias": 0 },
      { "ref": "car", "forma": "CARTAO", "valor": 360, "parcelas": 3, "cartao_tipo": "credito", "detalhe": "aut 123" },
      { "ref": "cre", "forma": "CREDITO_CLIENTE", "valor": 200, "venda_origem_credito": "VND-0007" },
      { "ref": "pd", "forma": "PAGO_DIRETO_FORNECEDOR", "valor": 300, "fornecedor": { "crm_supplier_id": "11", "fornecedor_nome": "Hotel Mar" } },
      { "ref": "pg2", "forma": "BOLETO", "valor": 100, "pagante": { "cliente_id": "crm_contact_10", "nome": "Empresa X", "cpf_cnpj": "…" } }
    ],
    "comissao_vendedor": { "percentual": 5, "valor": 32.75 }
  }
}
```
`tipo`: AEREO, AEREO_AGENCIA, HOSPEDAGEM, PACOTE, CRUZEIRO, SEGURO, LOCACAO, RECEPTIVO, INGRESSO, OUTROS. `quem_cobra`: AGENCIA | FORNECEDOR. Componente `tipo`: COMISSAO, OVER, TAXA_DU, RAV, FEE, MARKUP, DESCONTO, TAXA_CC, REPASSE_INTERMEDIARIO (`valor` OU `percentual` sobre a tarifa; `passageiro_ref` opcional). `forma`: DINHEIRO, CHEQUE, BOLETO, CARTAO, DEPOSITO, PIX, FATURAR, OUTROS, CREDITO_CLIENTE, CREDITO_FORNECEDOR, RETIDO_INTERMEDIARIO, PAGO_DIRETO_FORNECEDOR. Venda fechada no Financeiro não muda pelo CRM (evento processado, histórico e aviso no sino). Mandar a v1 de novo para uma venda v2 devolve a venda à v1. **`PAGAMENTO_CONFIRMADO` de venda v2:** mandar também `pagamento_ref` (o `ref` do pagamento) com a `parcela`; sem ele, o Financeiro só baixa quando uma conta só tem aquele número de parcela (com mais de uma, responde "ambígua" e não baixa nada). A v1 segue igual.

## Partes que vêm depois do alicerce (contratos detalhados quando A terminar)
- **B — Faturas ao cliente, Regras de faturamento e Nota de débito** (fatura corporativa por pagante e regra: diário, semanal, semanal IATA, decendial, quinzenal, mensal, avulso; data base; feriados; prévia das próximas 3; fechar/reabrir; mover itens; ajuste por nota de crédito/débito explicada; o cliente confere e aprova no portal da E3; "Fechar e cobrar" com boleto+Pix da E3; modelos Padrão/Personalizada/Simplificada; exportação CSV/XLSX).
- **C — Fornecedor**: Fatura do fornecedor (com quanto o cliente já pagou), sinal com compensação, acordos de comissão com vigência (comissão, over, Taxa CC DU/RAV, representantes), comissão esperada × recebida por operadora, regras de faturamento do fornecedor passando a valer.
- **D — Cancelamento, reembolso e crédito do cliente**: cancelar por passageiro com data, multa do fornecedor (sugerida pela política) e as 3 escolhas de saldo; reembolso com situação (solicitado → aprovado → pago) e prazo; carteira de crédito do cliente (saldo, validade, uso parcial em venda futura e na liquidação — libera `tratamento_diferenca: 'credito'` da E2), estorno automático da comissão do vendedor, prévia de tudo que muda.
- **E — Notas fiscais por regra e retenções**: regras da nota (pagante, fornecedor, representante), "Gerar notas" com Receitas × Valor da nota × Saldo e nota complementar sugerida, emissão por gatilho, cancelamento sugerido; retenções na fonte (IR/CSLL/PIS/COFINS, "Retenções na fonte (Lei 9.430)") por cliente × produto, nacional/internacional, sobre valor/taxa/DU-RAV; corrigir tomador e base da nota para operadora (`nfse-servico.ts › carregarContexto`, `nfse-calculo.ts › calcularNota`); campos para IBS/CBS.
- **F — Comissões e relatórios de vendas**: funções (vendedor, intermediário, "comissionado sobre"), plano em matriz faixa × produto × função, cálculo no servidor todo dia com prévia, liberar no recebimento ou na venda, Fechar comissões até a data (um erro não trava os outros), Pagar (total ou parcial → conta a pagar), estorno automático, painel do vendedor, "por que recebi isto?"; relatórios Vendas por produto/vendedor/empresa/forma de pagamento, ranking de clientes, tabela dinâmica de vendas, exportação.
- **G — CRM**: `VENDA_FECHADA` v2 no emissor do CRM (`integracaoFinanceiroEmitters.ts`).

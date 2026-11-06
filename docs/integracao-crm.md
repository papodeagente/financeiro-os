# Integração com o CRM: comissão do mês

Contrato entre a Área Comercial do CRM (conta 150002) e o Entur OS Financeiro
para a comissão da equipe comercial da Entur (decisões D31 a D40 de
05/11/2026). O CRM apura; o Financeiro da conta 01 (perfil ecossistema)
controla e paga.

- Código: `src/lib/comissao-do-crm.ts` (regras), `src/lib/comissao-do-crm-servidor.ts`
  (banco, gancho da baixa e agendador), `src/lib/crm-integration.ts`
  (`case COMISSAO_DO_MES` e `enviarEventosDaFila`).
- Testes: `scripts/test-comissao-do-crm.ts` e `scripts/test-sql-comissao-do-crm.mjs`.

## 1. COMISSAO_DO_MES (CRM para o Financeiro)

Um extrato por pessoa e competência, mandado no dia 1º do mês seguinte pelo
mesmo webhook assinado dos outros eventos:

```
POST https://fin.enturos.com/api/v1/crm/webhook/<tenant do Financeiro>
x-crm-signature: HMAC-SHA256(corpo, segredo da integração)
x-crm-timestamp: opcional (assinatura "<carimbo>.<corpo>")

{ "id": "<eventId>", "tipo": "COMISSAO_DO_MES", "payload": { ... } }
```

O `id` do envelope é a chave de idempotência. O `eventId` do payload, quando
vem, precisa ser igual a ele.

```json
{
  "tipo": "COMISSAO_DO_MES",
  "eventId": "9b3f...",
  "versao": 1,
  "competencia": "2026-12",
  "beneficiario": { "usuarioId": 420008, "nome": "Luan Amador", "email": "luan@entur.com.br" },
  "brutoCents": 35000,
  "compensadoCents": 5000,
  "totalCents": 30000,
  "linhas": [
    { "contaId": 9001, "conta": "Agência A", "modelo": "novo", "papel": "vendedor", "parcela": 1,
      "tipo": "comissao", "valorCents": 20000, "gatilho": "1º recebimento", "gatilhoEm": "2026-12-08T12:00:00Z" }
  ],
  "geradoEm": "2027-01-01T03:00:00.000Z"
}
```

Regras de leitura (fora delas, 400 com o motivo):

| Campo | Regra |
|---|---|
| `versao` | 1 (ausente vale 1) |
| `competencia` | `AAAA-MM`, nunca depois do mês corrente |
| `beneficiario.usuarioId` | id do usuário no CRM (número, ou texto; `crm_user_<id>` também serve) |
| `beneficiario.nome` | obrigatório; `email` é usado para achar o cadastro |
| `brutoCents`, `compensadoCents`, `totalCents` | inteiros em centavos |
| `compensadoCents` | zero ou mais: o quanto do bruto cobriu saldo negativo anterior |
| `totalCents` | zero ou mais, e `brutoCents - compensadoCents = totalCents` |
| `linhas` | lista (até 2000); cada `valorCents` inteiro (negativo no estorno); a soma das linhas é o `brutoCents` |
| `geradoEm` | data e hora ISO 8601 (ordena as versões) |

### Respostas

O corpo é a resposta do Financeiro; "enviado" não é "aceito".

| Situação | Status | Corpo |
|---|---|---|
| Primeira versão gravada | 200 | `{ "ok": true, "situacao": "criada", "comissaoId", "contaPagarId" }` |
| Versão nova gravada (inclusive total zero, que cancela) | 200 | `{ "ok": true, "situacao": "atualizada", ... }` |
| Mesmo `id` de novo, ou versão nova igual à paga ou aprovada | 200 | `{ "ok": true, "situacao": "ja_existia", ... }` |
| Conta do Financeiro que não é o ecossistema | 404 | `{ "ok": false, "motivo" }` |
| Payload inválido | 400 | `{ "ok": false, "motivo" }` |
| Versão nova que muda comissão já paga (ou paga em parte) ou já aprovada para pagamento | 409 | `{ "ok": false, "motivo" }` |
| Versão mais antiga (`geradoEm` menor) que a que vale | 409 | `{ "ok": false, "motivo" }` |
| Total zero sem comissão do mês para cancelar | 409 | `{ "ok": false, "motivo" }` |
| Falha do servidor ou entrega concorrente | 5xx | corpo antigo (`recebido`, `processado`, `erro`): tente de novo |

`comissaoId` é `comissao-crm-<AAAA-MM>-<usuarioId>`; `contaPagarId` é
`cp-comissao-comissao-crm-<AAAA-MM>-<usuarioId>`.

Um 4xx é resposta final para aquela versão: mostre o motivo, não repita no
automático. A recusa não conclui o evento no Financeiro (fica como ERRO, com o
motivo): mandar o MESMO `id` depois de corrigir (a conta virou ecossistema, o
extrato foi corrigido) é avaliado de novo.

### O que o Financeiro grava

- `comissoes`, origem `crm`, id `comissao-crm-<AAAA-MM>-<usuarioId>`: competência,
  pessoa (cadastro achado pelo id do CRM `crm_user_<id>`, depois pelo e-mail; sem
  cadastro, nasce como cadastro pendente, como nas vendas do CRM), bruto,
  compensado e total, as linhas no JSON, o `eventId` que vale e as versões
  aceitas. A tela de comissões mostra, mas não recalcula, não aprova e não paga.
- UMA conta a pagar PENDENTE pelo gancho de toda comissão (`comissao-conta.ts`):
  favorecido = o nome da pessoa (como toda conta de comissão; não é fornecedor),
  descrição "Comissão de dezembro/2026, Luan Amador", vencimento no dia 10 do mês
  seguinte à competência, Custos Comerciais (2.6), valor em reais.
- Versão nova (outro `id`, mesma comissão): atualiza só com a conta a pagar
  ainda não paga e sem pagamento aprovado. Total zero cancela a conta pendente
  (nunca apaga). A paga nunca é tocada.

## 2. COMISSAO_PAGA (Financeiro para o CRM)

Quando a conta a pagar de uma comissão do CRM é paga por inteiro (status PAGO,
por qualquer caminho de baixa do servidor: liquidação, tela antiga ou
conciliação), o aviso entra na fila de saída (`crm_eventos_saida`) na mesma
transação da baixa, uma vez só por conta a pagar (id
`comissao-paga:<tenant>:<contaPagarId>`). Baixa parcial não avisa. A comissão
passa a constar como paga.

```json
{
  "id": "comissao-paga:<tenant>:cp-comissao-comissao-crm-2026-12-420008",
  "tipo": "COMISSAO_PAGA", "versao": "v1", "origem": "entur-os", "timestamp": "...",
  "payload": { "competencia": "2026-12", "usuarioId": 420008, "eventIdOrigem": "9b3f...",
               "pagoEm": "2027-01-10", "valorPagoCents": 30000 }
}
```

`usuarioId` volta como veio no extrato; `eventIdOrigem` é o `eventId` da versão
que vale; `valorPagoCents` é o que saiu do caixa (com juros ou desconto da baixa).

O agendador (tarefa `comissao-paga-crm`, a cada 5 minutos, só nas contas do
ecossistema) manda os avisos para o `webhook_url_crm` da integração, com
`x-entur-signature` (HMAC do corpo), `x-entur-signature-ts` (HMAC de
"<x-entur-timestamp>.<corpo>"), `x-entur-event` e `x-entur-event-id`. Falha
fica FALHA e volta com espera crescente (5 min a 8 h); a tarefa também repõe o
aviso de conta paga que não estiver na fila. Os outros eventos pendentes da
conta não saem por ela.

Estorno da baixa depois do aviso não avisa o CRM nesta versão.

## 3. A comissão por faixas de MRR

Na conta do ecossistema, a fonte da comissão é o CRM por padrão
(`tenants.data.fonte_da_comissao`, ausente = `crm`). Enquanto for, gerar a
comissão por faixas (`gerarComissoesMrr`, POST `/api/comissao-mrr`) recusa com
"A comissão agora vem do CRM (Área Comercial). As metas de MRR seguem só para
acompanhamento." e a tela Comissão por MRR mostra o aviso, sem o botão de
gerar; metas e acompanhamento continuam. Para voltar às faixas, grave
`fonte_da_comissao = 'mrr'` na conta (SQL revisado).

## 4. Como conferir depois do deploy

Com a conta 01 no perfil ecossistema e integrada à 150002, mande pelo CRM (ou por
um POST assinado no webhook) um COMISSAO_DO_MES de teste com total de R$ 1,00:
a resposta tem de ser 200 `criada` e a conta "Comissão de <mês>/<ano>, <nome>"
aparece em Contas a pagar vencendo no dia 10; o mesmo `id` de novo responde
`ja_existia`, e uma versão nova com total zero cancela a conta de teste.

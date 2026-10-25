# EnturOS Sites → Financeiro

O Financeiro recebe eventos do Sites por um webhook exclusivo de cada agência.
No Financeiro, abra **Integrações → EnturOS Sites**. Copie o endereço de
recebimento. No Sites, abra **Integrações → Webhooks**, crie um destino com
esse endereço e selecione **Reservas**, **Pagamentos** e **Acertos com parceiros**.
O Sites mostra o segredo apenas na criação. Copie também o ID da empresa
mostrado nessa tela, informe ambos no Financeiro e salve. Envie o teste pelo
Sites e confirme que `teste.ping` aparece em **Eventos recentes**.

O corpo é o envelope da versão 1 do Sites. A assinatura é
`X-EnturOS-Signature: t=<segundos>,v1=<HMAC-SHA256(t.corpo)>`. O Financeiro
rejeita assinatura fora de uma janela de cinco minutos, empresa diferente,
evento de teste de reserva e tipos não financeiros. O par `(tenant_id, id)`
garante idempotência; um mesmo ID com outro corpo recebe `409`. Erros 5xx
fazem o Sites tentar de novo; a fila e o reenvio manual ficam no Sites.

Os eventos são um histórico de conferência, isolado por agência. Eles não
geram `vendas_crm`, `contas_receber` ou `contas_pagar`: a venda ganha já entra
no Financeiro pelo CRM, então criar outra aqui duplicaria o faturamento.
O detalhe de cada pedido soma pagamentos, reembolsos, taxas ajustadas e custos
registrados, sem contar duas vezes eventos repetidos. Se o webhook for ligado
depois da reserva, o valor reservado fica sem dados; confira a ficha no Sites.
Pedidos com mais de uma moeda não exibem total somado.

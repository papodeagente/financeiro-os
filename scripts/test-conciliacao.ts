/**
 * Conciliação plataforma x CRM e fusão de parcelas.
 *
 * O teste central deste arquivo é o de baixo: **valor e data não podem,
 * sozinhos, vincular um pagamento a uma venda.** Duas pessoas pagando o
 * mesmo valor no mesmo dia é rotina numa escola que vende turma, e um
 * vínculo errado leva o dinheiro de um cliente para a venda de outro.
 */
import {
  decidir, pontuar, telefoneComparavel, documentoComparavel,
  type CandidatoVenda, type PagamentoParaConciliar,
} from '../src/lib/plataformas/conciliacao.ts';
import { mesclarParcelas, totaisDaTransacao } from '../src/lib/plataformas/servico.ts';
import { montarParcelas, somaBruto } from '../src/lib/plataformas/comum.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const pagamento = (o: Partial<PagamentoParaConciliar> = {}): PagamentoParaConciliar => ({
  id_transacao: 'tx_1', documento: '12345678900', email: 'ana@x.com',
  telefone: '11999998888', valor: 1200, data: '2026-09-15', ...o,
});

const venda = (o: Partial<CandidatoVenda> = {}): CandidatoVenda => ({
  venda_id: 'v1', cliente_nome: 'Ana', documento: '12345678900', email: 'ana@x.com',
  telefone: '11999998888', valor_total: 1200, data_venda: '2026-09-15',
  id_transacao_externa: '', ja_conciliada: false, ...o,
});

console.log('--- normalização do que identifica ---');
eq(documentoComparavel('123.456.789-00'), '12345678900', 'CPF sai só com dígitos');
eq(documentoComparavel('12.345.678/0001-90'), '12345678000190', 'CNPJ idem');
eq(documentoComparavel('123'), '', 'número que não é CPF nem CNPJ não identifica ninguém');
eq(telefoneComparavel('+55 (11) 99999-8888'), '99998888', 'telefone compara pelos últimos 8 dígitos');
eq(telefoneComparavel('11 9999-8888'), '99998888', 'o mesmo número sem o nono dígito casa');
eq(telefoneComparavel('5511999998888'), '99998888', 'e com código de país também');
eq(telefoneComparavel('123'), '', 'telefone curto demais não compara');

console.log('\n--- pontuação ---');
{
  const p = pontuar(pagamento(), venda());
  eq([p.pontos, p.confianca, p.tem_identidade], [100, 'ALTA', true],
     'documento + e-mail + telefone + valor + dia: confiança alta');
}
{
  const p = pontuar(pagamento(), venda({ id_transacao_externa: 'tx_1' }));
  eq(p.pontos >= 100, true, 'venda que já aponta para a transação é prova, não indício');
}
{
  const p = pontuar(pagamento({ documento: '', email: '' }), venda({ documento: '', email: '' }));
  eq([p.pontos, p.confianca, p.tem_identidade], [40, 'MEDIA', false],
     'só telefone, valor e dia: aparece para conferir, mas não identifica ninguém');
}
{
  const p = pontuar(pagamento({ valor: 1200.01 }), venda({ valor_total: 1200 }));
  eq(p.motivos.includes('mesmo valor'), true, 'um centavo de diferença ainda é o mesmo valor');
}
{
  const p = pontuar(pagamento({ data: '2026-09-22' }), venda({ data_venda: '2026-09-15' }));
  eq(p.motivos.includes('7 dia(s) de diferença'), true, 'sete dias ainda contam');
}
{
  const p = pontuar(pagamento({ data: '2026-12-01' }), venda({ data_venda: '2026-09-15' }));
  eq(p.motivos.some(m => m.includes('diferença')), false, 'dois meses depois já não conta como proximidade');
}

console.log('\n--- decisão: o freio que impede vincular no chute ---');
{
  // O TESTE QUE IMPORTA. Mesmo com valor e data idênticos e a
  // configuração pedindo vínculo automático, sem prova de identidade a
  // resposta nunca pode ser VINCULAR.
  const d = decidir(
    pagamento({ documento: '', email: '', telefone: '' }),
    [venda({ documento: '', email: '', telefone: '' })],
    { vincularAutomatico: true },
  );
  eq(d.acao !== 'VINCULAR', true,
     'valor e data iguais, sem NADA que identifique: jamais vincula sozinho');
  eq(d.acao, 'VENDA_DIRETA',
     'e sem sequer telefone em comum não vira nem sugestão: coincidência de valor e dia não é indício');
}
{
  const d = decidir(pagamento(), [venda()], { vincularAutomatico: true });
  eq([d.acao, d.escolhida?.venda_id], ['VINCULAR', 'v1'], 'com identidade e confiança alta, vincula');
}
{
  const d = decidir(pagamento(), [venda()], { vincularAutomatico: false });
  eq(d.acao, 'SUGERIR', 'a agência que pediu para confirmar antes nunca é atropelada');
}
{
  // Duas vendas do mesmo cliente, mesmo valor, mesmo dia: acontece quando
  // alguém compra duas vagas. Escolher a primeira seria sorteio.
  const d = decidir(
    pagamento(),
    [venda({ venda_id: 'v1' }), venda({ venda_id: 'v2' })],
    { vincularAutomatico: true },
  );
  eq(d.acao, 'SUGERIR', 'empate técnico entre duas vendas vira sugestão');
  eq(d.candidatas.length, 2, 'e as duas candidatas são mostradas para alguém decidir');
}
{
  const d = decidir(pagamento(), [], { vincularAutomatico: true });
  eq([d.acao, d.escolhida], ['VENDA_DIRETA', null], 'sem candidato, é venda direta: resposta, não pendência');
}
{
  const d = decidir(
    pagamento(),
    [venda({ venda_id: 'outra', documento: '99988877766', email: 'outro@x.com', telefone: '11888887777', valor_total: 50, data_venda: '2026-01-01' })],
    { vincularAutomatico: true },
  );
  eq(d.acao, 'VENDA_DIRETA', 'candidato que não se parece com nada não vira sugestão');
}

console.log('\n--- fusão de parcelas: o Asaas manda uma cobrança por vez ---');
{
  const atuais = montarParcelas({ total: 1200, quantidade: 12, status: 'PENDENTE', primeiroVencimento: '2026-01-10' });
  const nova = [{
    numero: 3, total: 12, id_externo: 'pay_3', valor_bruto: 100, valor_taxa: 5, valor_liquido: 95,
    desconto: 0, juros: 0, status: 'RECEBIDO' as const, data_vencimento: '2026-03-10',
    data_prevista_recebimento: '', data_pagamento: '2026-03-09', data_recebimento: '2026-03-10',
    antecipada: false,
  }];
  const m = mesclarParcelas(atuais, nova);
  eq(m.length, 12, 'a parcela que chegou sozinha não apaga as outras onze');
  eq([m[2].status, m[2].data_recebimento], ['RECEBIDO', '2026-03-10'], 'a parcela 3 é atualizada');
  eq(m[3].status, 'PENDENTE', 'a parcela 4 continua como estava');
  eq(somaBruto(m), 1200, 'e a soma continua fechando com o total');
}
{
  // Aviso de mudança de status costuma vir sem repetir as datas. Campo
  // vazio não pode apagar a prova de quando o dinheiro entrou.
  const atuais = [{
    numero: 1, total: 1, id_externo: 'pay_1', valor_bruto: 100, valor_taxa: 5, valor_liquido: 95,
    desconto: 0, juros: 0, status: 'RECEBIDO' as const, data_vencimento: '2026-03-10',
    data_prevista_recebimento: '2026-04-10', data_pagamento: '2026-03-09', data_recebimento: '2026-03-10',
    antecipada: false,
  }];
  const m = mesclarParcelas(atuais, [{ ...atuais[0], data_pagamento: '', data_recebimento: '', valor_taxa: 0, status: 'CHARGEBACK' }]);
  eq([m[0].data_pagamento, m[0].data_recebimento], ['2026-03-09', '2026-03-10'], 'as datas sobrevivem ao aviso incompleto');
  eq([m[0].status, m[0].valor_taxa], ['CHARGEBACK', 5], 'o status novo vale, e a taxa conhecida não some');
}

console.log('\n--- totais: o que é receita, o que é previsão, o que morreu ---');
{
  const parcelas = [
    { numero: 1, total: 3, id_externo: '', valor_bruto: 100, valor_taxa: 5, valor_liquido: 95, desconto: 0, juros: 0, status: 'RECEBIDO' as const, data_vencimento: '', data_prevista_recebimento: '', data_pagamento: '', data_recebimento: '', antecipada: false },
    { numero: 2, total: 3, id_externo: '', valor_bruto: 100, valor_taxa: 5, valor_liquido: 95, desconto: 0, juros: 0, status: 'CONFIRMADO' as const, data_vencimento: '', data_prevista_recebimento: '', data_pagamento: '', data_recebimento: '', antecipada: false },
    { numero: 3, total: 3, id_externo: '', valor_bruto: 100, valor_taxa: 5, valor_liquido: 95, desconto: 0, juros: 0, status: 'ESTORNADO' as const, data_vencimento: '', data_prevista_recebimento: '', data_pagamento: '', data_recebimento: '', antecipada: false },
  ];
  const t = totaisDaTransacao(parcelas);
  eq(t.bruto, 200, 'a parcela estornada sai do bruto: ela não é receita');
  eq(t.recebido, 95, 'recebido é só o que caiu na conta, pelo líquido');
  eq(t.a_receber, 95, 'confirmado ainda é a receber, e é isso que responde "quanto falta entrar"');
  eq(t.estornado, 100, 'e o estornado fica visível, pelo bruto');
}

console.log(`\n${total - falhas}/${total} testes de conciliação passaram`);
process.exit(falhas > 0 ? 1 : 0);

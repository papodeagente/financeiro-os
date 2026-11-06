/**
 * Conciliação com regras aprendidas (src/lib/conciliacao-regras.ts), a parte
 * pura: o que a regra aprende, quando tem certeza e o que ela decide.
 *
 * O que estes testes guardam: valor diferente e pessoa diferente nunca
 * conciliam sozinhos; ambíguo vira escolha; regra contradita recomeça;
 * tarifa de todo mês vira sugestão.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-conciliacao-regras.ts
 */
import {
  aprender, assinaturaDaDescricao, certezaDaRegra, chaveDaRegra, decidir, documentoDaDescricao, podeLigar,
  regraDaLinha, registrarDesfeita, tarifasRecorrentes, pareceTarifa,
  type FatoDaConciliacao, type LinhaParaRegra, type RegraDeConciliacao, type TituloCandidato,
} from '../src/lib/conciliacao-regras.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

const linha = (id: string, valor: number, data: string, descricao: string, conta = 'b1'): LinhaParaRegra => ({ id, conta_bancaria_id: conta, data, valor, descricao });
const fato = (l: LinhaParaRegra, pessoa = 'c1', nome = 'Maria Souza', extra: Partial<FatoDaConciliacao> = {}): FatoDaConciliacao =>
  ({ linha: l, destino: 'TITULO', titulo_tabela: 'contas_receber', pessoa_id: pessoa, pessoa_nome: nome, categoria_id: 'cat', ...extra });
const titulo = (id: string, centavos: number, venc: string, pessoa = 'c1', nome = 'Maria Souza', tabela: TituloCandidato['tabela'] = 'contas_receber'): TituloCandidato =>
  ({ id, tabela, pessoa_id: pessoa, pessoa_nome: nome, aberto_centavos: centavos, data_vencimento: venc, descricao: `Parcela ${id}` });
function treinada(n: number, l = linha('x', 500, '2026-10-05', 'PIX RECEBIDO - MARIA SOUZA')): RegraDeConciliacao {
  let r: RegraDeConciliacao | null = null;
  for (let i = 0; i < n; i++) r = aprender(r, fato(l), 'r1');
  return r!;
}

console.log('--- a descrição sem o que muda ---');
eq(assinaturaDaDescricao('PIX RECEBIDO - MARIA SOUZA 12/10 ID E1234XYZ'), 'maria souza', 'tira operação, datas e códigos');
eq(assinaturaDaDescricao('Pix enviado: "Cp :00360305-CEF MATRIZ"'), 'cef matriz', 'descrição com aspas e código de conta');
eq(assinaturaDaDescricao('TED 341 0001 99'), 'ted', 'sem nome, fica o que tinha letra');
eq(documentoDaDescricao('PIX RECEBIDO 11.222.333/0001-81 EMPRESA X'), '11222333000181', 'CNPJ formatado com dígitos certos');
eq(documentoDaDescricao('PIX 11222333000182 EMPRESA X'), '', 'CNPJ com dígito errado não vale');
eq(documentoDaDescricao('TED 123.456.789-09 JOAO'), '12345678909', 'CPF pontuado');
eq(documentoDaDescricao('CONTA 12345678909'), '', 'onze dígitos soltos não viram CPF');

console.log('--- aprender ---');
{
  const r1 = treinada(1);
  eq([r1.confirmacoes, r1.padrao, r1.sentido, r1.valores_centavos, r1.auto_ligada], [1, 'maria souza', 'ENTRADA', [50000], false], 'primeira conciliação cria a regra, desligada');
  const r3 = treinada(3);
  eq([r3.confirmacoes, certezaDaRegra(r3).nivel, podeLigar(r3).ok], [3, 'alta', true], 'três vezes do mesmo jeito: certeza alta, pode ligar');
  eq([certezaDaRegra(treinada(2)).nivel, podeLigar(treinada(2)).ok], ['media', false], 'duas vezes: ainda não liga');
  const ligada = { ...r3, auto_ligada: true };
  const contradita = aprender(ligada, fato(linha('y', 500, '2026-10-09', 'PIX RECEBIDO - MARIA SOUZA'), 'c2', 'Maria Souza Lima'), 'nova');
  eq([contradita.pessoa_id, contradita.confirmacoes, contradita.auto_ligada, /recomeçou/.test(contradita.auto_suspensa_motivo)], ['c2', 1, false, true], 'outra pessoa na mesma descrição: a regra recomeça e desliga');
  const desfeita = registrarDesfeita(ligada, true);
  eq([desfeita.desfeitas, desfeita.auto_ligada, certezaDaRegra(desfeita).nivel], [1, false, 'media'], 'desfeita: desliga e perde a certeza');
  let volta = desfeita;
  for (let i = 0; i < 3; i++) volta = aprender(volta, fato(linha('z', 500, '2026-10-10', 'PIX RECEBIDO - MARIA SOUZA')), 'r1');
  eq(certezaDaRegra(volta).nivel, 'alta', 'com mais três confirmações volta a ter certeza');
  eq(chaveDaRegra(r3), 'b1|ENTRADA|txt:maria souza', 'chave pela descrição');
  const comDoc = aprender(null, fato(linha('d', 500, '2026-10-05', 'PIX 11.222.333/0001-81 EMPRESA X')), 'r9');
  eq(chaveDaRegra(comDoc), 'b1|ENTRADA|doc:11222333000181', 'com CNPJ, a chave é o CNPJ');
}

console.log('--- achar a regra da linha ---');
{
  const a = { ...treinada(3), id: 'a' };
  const outraConta = { ...treinada(3), id: 'b', conta_bancaria_id: 'b2' };
  eq(regraDaLinha(linha('n', 500, '2026-11-05', 'PIX RECEBIDO MARIA SOUZA 99'), [a, outraConta])?.id, 'a', 'mesma descrição na mesma conta bancária');
  eq(regraDaLinha(linha('n', -500, '2026-11-05', 'PIX ENVIADO MARIA SOUZA'), [a]), null, 'saída não usa regra de entrada');
  const geral = { ...a, id: 'g', conta_bancaria_id: '', pessoa_id: 'c9', pessoa_nome: 'Outra' };
  eq(regraDaLinha(linha('n', 500, '2026-11-05', 'PIX RECEBIDO MARIA SOUZA'), [geral, a])?.id, 'a', 'a da própria conta vence a de qualquer conta');
  const empate = { ...a, id: 'e', pessoa_id: 'c9', pessoa_nome: 'Outra' };
  eq(regraDaLinha(linha('n', 500, '2026-11-05', 'PIX RECEBIDO MARIA SOUZA'), [a, empate]), null, 'duas regras iguais para pessoas diferentes: nenhuma vale');
}

console.log('--- decidir ---');
{
  const l = linha('n', 500, '2026-11-05', 'PIX RECEBIDO - MARIA SOUZA');
  const r = { ...treinada(3), auto_ligada: true };
  eq(decidir(l, r, [titulo('t1', 50000, '2026-11-07')]).tipo, 'sozinha', 'ligada, certeza alta, mesma pessoa, mesmo valor, perto: sozinha');
  const desligada = decidir(l, { ...r, auto_ligada: false }, [titulo('t1', 50000, '2026-11-07')]);
  eq([desligada.tipo, desligada.tipo === 'sugerir' && /não está ligada/.test(desligada.por_que_nao_sozinha)], ['sugerir', true], 'desligada: sugere');
  const valor = decidir(l, r, [titulo('t1', 49999, '2026-11-07')]);
  eq([valor.tipo, valor.tipo === 'sugerir' && /valor diferente/.test(valor.por_que_nao_sozinha)], ['sugerir', true], 'um centavo de diferença: nunca sozinha');
  eq(decidir(l, r, [titulo('t1', 50000, '2026-11-07', 'c2', 'João')]).tipo, 'nada', 'conta de outra pessoa com o mesmo valor: nada');
  const nome = decidir(l, { ...r, pessoa_id: '' }, [titulo('t1', 50000, '2026-11-07', '', 'MARIA SOUZA')]);
  eq(nome.tipo, 'sozinha', 'sem cadastro, a pessoa casa pelo nome normalizado');
  const dois = decidir(l, r, [titulo('t1', 50000, '2026-11-04'), titulo('t2', 50000, '2026-11-08')]);
  eq([dois.tipo, dois.tipo === 'sugerir' && /2 contas/.test(dois.por_que_nao_sozinha)], ['sugerir', true], 'duas contas iguais: escolher');
  const longe = decidir(l, r, [titulo('t1', 50000, '2026-12-05')]);
  eq([longe.tipo, longe.tipo === 'sugerir' && /mais de 10 dias/.test(longe.por_que_nao_sozinha)], ['sugerir', true], 'vencimento a 30 dias: sugere');
  eq(decidir(l, r, [titulo('t1', 50000, '2026-11-05', 'c1', 'Maria Souza', 'contas_pagar')]).tipo, 'nada', 'conta a pagar não serve para entrada');
  eq(decidir(l, null, []).tipo, 'nada', 'sem regra: nada');
  const media = decidir(l, { ...treinada(2), auto_ligada: true }, [titulo('t1', 50000, '2026-11-05')]);
  eq(media.tipo, 'sugerir', 'ligada mas sem certeza alta: sugere');
}
{
  const t = (v: number, d: string) => linha('t', v, d, 'TARIFA PACOTE SERVICOS');
  let r: RegraDeConciliacao | null = null;
  for (const d of ['2026-07-02', '2026-08-02', '2026-09-02']) {
    r = aprender(r, fato(t(-39.9, d), 'f1', 'Banco Itaú', { destino: 'CRIAR', titulo_tabela: 'contas_pagar' }), 'rt');
  }
  const ligada = { ...r!, auto_ligada: true };
  eq(decidir(t(-39.9, '2026-10-02'), ligada, []).tipo, 'sozinha', 'tarifa de valor fixo e igual: lança sozinha');
  const outra = decidir(t(-45, '2026-10-02'), ligada, []);
  eq([outra.tipo, outra.tipo === 'sugerir' && /diferente/.test(outra.por_que_nao_sozinha)], ['sugerir', true], 'tarifa de outro valor: sugere');
  let variavel: RegraDeConciliacao | null = null;
  for (const [v, d] of [[-30, '2026-07-02'], [-35, '2026-08-02'], [-40, '2026-09-02']] as const) {
    variavel = aprender(variavel, fato(t(v, d), 'f1', 'Banco Itaú', { destino: 'CRIAR', titulo_tabela: 'contas_pagar' }), 'rv');
  }
  eq([certezaDaRegra(variavel!).nivel, podeLigar(variavel!).ok], ['media', false], 'valor que muda todo mês: não liga');
}

console.log('--- tarifas que se repetem ---');
{
  eq([pareceTarifa('TARIFA PACOTE SERVICOS'), pareceTarifa('CESTA DE RELACIONAMENTO'), pareceTarifa('PIX ENVIADO JOAO')], [true, true, false], 'o que tem cara de tarifa');
  const ls = [
    linha('a', -39.9, '2026-08-03', 'TARIFA PACOTE SERVICOS'),
    linha('b', -39.9, '2026-09-03', 'TARIFA PACOTE SERVICOS'),
    linha('c', -41.5, '2026-10-05', 'TARIFA PACOTE SERVICOS'),
    linha('d', -12, '2026-10-05', 'TARIFA TED AVULSA'),
    linha('e', -39.9, '2026-10-03', 'TARIFA PACOTE SERVICOS', 'b2'),
    linha('f', 39.9, '2026-10-03', 'ESTORNO TARIFA PACOTE SERVICOS'),
  ];
  const t = tarifasRecorrentes(ls);
  eq(t.map(x => [x.conta_bancaria_id, x.meses.length, x.valor_tipico_centavos, x.dia_tipico, x.proximo_vencimento]), [['b1', 3, 3990, 3, '2026-11-03']], 'a tarifa de três meses vira sugestão com o valor e o dia típicos; a avulsa e a de outra conta não');
  eq(tarifasRecorrentes([linha('a', -10, '2026-01-31', 'TARIFA X'), linha('b', -10, '2026-02-28', 'TARIFA X')])[0].proximo_vencimento, '2026-03-30', 'dia típico cabe no mês seguinte');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);

/**
 * Exportação das listas do grupo A (E7, G3): Contas a Pagar/Receber,
 * Cobranças, Faturas, Notas fiscais, Gerar notas, Fechar e Pagar comissões.
 * Cada lista vira um documento com as colunas da tela, o total e o filtro
 * aplicado (no topo e no nome do arquivo); o Excel sai com os números certos.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-exportacao-listas-a.ts
 */
import * as XLSX from 'xlsx';
import { documentoDasContas, lerFiltro, type LinhaDeConta } from '../src/lib/contas-pagar-receber.ts';
import {
  documentoDasCobrancas, documentoDasFaturas, documentoDasNotas, documentoDeGerarNotas, documentoDoFechamento, documentoDoPagamento,
} from '../src/lib/exportacao/listas-financeiro.ts';
import { nomeDoArquivo, semColunasSensiveis, validarDocumento } from '../src/lib/exportacao/documento.ts';
import { planilhaDoDocumento } from '../src/lib/exportacao/planilha.ts';
import type { Cobranca } from '../src/lib/cobranca/contrato-telas.ts';
import type { ResumoDaFatura } from '../src/lib/fatura-servidor.ts';
import type { NotaFiscal } from '../src/lib/nfse-tipos.ts';
import type { LinhaDaGrade } from '../src/lib/nota-regras.ts';
import type { LinhaDoFechamento } from '../src/lib/comissao-funcoes.ts';
import type { PessoaAPagar } from '../src/lib/comissao-funcoes-servidor.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else console.log(`PASS  ${label}`);
}
const ler = (bytes: Uint8Array) => { const wb = XLSX.read(bytes, { type: 'array' }); return wb.Sheets[wb.SheetNames[0]]; };

// ── Contas a Pagar/Receber ────────────────────────────────────────────────
{
  const base: LinhaDeConta = {
    chave: 'cr:1', tabela: 'contas_receber', tipo: 'receber', id: '1', status: 'PENDENTE', situacao: 'em_atraso', parcial: false, dias_atraso: 4,
    descricao: 'Pacote Lisboa', pessoa: 'Carla Dias', documento: 'NF 12', parcela: '1/3', categoria_id: 'cat1', categoria: 'Venda de pacotes',
    centro_custo_id: '', centro_custo: '', conta_bancaria_id: 'cb1', conta_bancaria: 'Banco Inter', emissao: '2026-10-01', vencimento: '2026-11-02',
    liquidacao: '', valor: 1500.5, baixado: 0, saldo: 1500.5, forma: 'Boleto', venda_id: '', origem: '', moeda: 'BRL', serie_id: '',
    rateio: false, gerada_pelo_sistema: false, sem_baixa: true, cobranca_status: '',
  };
  const pago: LinhaDeConta = { ...base, chave: 'cr:2', id: '2', situacao: 'liquidado', status: 'RECEBIDO', dias_atraso: 0, valor: 200, baixado: 200, saldo: 0, liquidacao: '2026-11-03' };
  const f = lerFiltro(new URLSearchParams('tipo=receber&de=2026-11-01&ate=2026-11-30&situacao=em_atraso&categoria=cat1&conta=cb1'), '2026-11-06');
  const doc = documentoDasContas([base, pago], f);
  eq(doc.titulo, 'Contas a receber', 'título pelo tipo do filtro');
  eq(doc.filtros, [
    { rotulo: 'Tipo', valor: 'A receber' }, { rotulo: 'Vencimento', valor: '01/11/2026 a 30/11/2026' }, { rotulo: 'Situação', valor: 'Em atraso' },
    { rotulo: 'Categoria', valor: 'Venda de pacotes' }, { rotulo: 'Conta bancária', valor: 'Banco Inter' },
  ], 'filtro por extenso, com os nomes (não os ids)');
  eq(doc.colunas.length, 17, 'as mesmas 17 colunas do CSV');
  eq(doc.totais, { valor: 1700.5, baixado: 200, saldo: 1500.5 }, 'totais do recorte');
  eq(doc.linhas[0].situacao, 'Em atraso', 'situação por extenso');
  eq(doc.linhas[1].dias_atraso, null, 'sem atraso fica vazio');
  eq(nomeDoArquivo(doc, 'xlsx'), 'contas-a-receber-a-receber-2026-11-01-a-2026-11-30-em-atraso-venda-de-pacotes-banco-inter.xlsx', 'nome do arquivo com o filtro');
  eq(validarDocumento(doc).ok, true, 'documento passa na validação do servidor');
  const ws = ler(planilhaDoDocumento(doc));
  eq(ws.N6.v, 1500.5, 'valor como número na planilha');
  eq(ws.A8.v, 'Total', 'linha de total');
  eq(ws.N8.v, 1700.5, 'total do valor');
  eq(documentoDasContas([], lerFiltro(new URLSearchParams(''), '2026-11-06')).titulo, 'Contas a pagar e receber', 'sem tipo: as duas');
  eq(documentoDasContas([], lerFiltro(new URLSearchParams(''), '2026-11-06')).totais, null, 'lista vazia sem total');
}

// ── Cobranças ─────────────────────────────────────────────────────────────
{
  const c = (o: Partial<Cobranca>): Cobranca => ({
    id: 'c', conta_id: 'cr', cliente_id: 'p', cliente_nome: 'Carla', descricao: 'Parcela 1', provedor: 'asaas', tipo: 'boleto_pix', status: 'aberta',
    valor: 100, vencimento: '2026-11-10', linha_digitavel: '1234', codigo_barras: null, pix_copia_cola: null, url_boleto: null, url_fatura: null,
    carne_id: null, erro: null, valor_pago: null, pago_em: null, criado_em: '2026-11-01', criado_por: null, ...o,
  });
  const doc = documentoDasCobrancas([c({}), c({ id: 'd', status: 'paga', valor_pago: 99.5, pago_em: '2026-11-09T10:00:00Z' }), c({ id: 'e', status: 'falhou', erro: 'CPF inválido' })],
    { de: '2026-11-01', ate: '2026-11-30', situacao: 'Todas', provedor: 'Asaas' });
  eq(doc.linhas.map(l => l.situacao), ['Aguardando pagamento', 'Paga', 'Não emitida'], 'situação com os rótulos da tela');
  eq(doc.linhas[0].tipo, 'Boleto com Pix', 'como paga por extenso');
  eq(doc.linhas[1].pago_em, '2026-11-09', 'pago em vira data');
  eq(doc.linhas[2].erro, 'CPF inválido', 'motivo da recusa só na que falhou');
  eq(doc.linhas[0].erro, '', 'as outras sem motivo');
  eq(doc.totais, { valor: 300, valor_pago: 99.5 }, 'totais');
  eq(nomeDoArquivo(doc, 'pdf'), 'cobrancas-2026-11-01-a-2026-11-30-todas-asaas.pdf', 'nome com período, situação e provedor');
}

// ── Faturas ───────────────────────────────────────────────────────────────
{
  const r = { id: 'f', numero: 7, pessoa_nome: 'Empresa X', avulsa: true, complementar_de: '', descricao: 'Outubro', periodo_inicio: '2026-10-01', periodo_fim: '2026-10-31',
    emissao: '2026-11-01', vencimento: '2026-11-10', quantidade_itens: 3, total_centavos: 300000, recebido_centavos: 350000,
    situacao_visivel: 'PARCIAL', conferencia: 'APROVADA', cobranca: { id: 'c', status: 'aberta', tipo: 'boleto' } } as unknown as ResumoDaFatura;
  const doc = documentoDasFaturas([r], { campo: 'emissao', de: '2026-11-01', ate: '2026-11-30', situacao: 'Em aberto' }, { aberta: 'Boleto e Pix emitidos' });
  eq(doc.filtros?.[0], { rotulo: 'Emissão', valor: '01/11/2026 a 30/11/2026' }, 'período pela data escolhida');
  eq(doc.linhas[0].descricao, 'Avulsa · Outubro', 'avulsa na descrição');
  eq(doc.linhas[0].periodo, '01/10/2026 a 31/10/2026', 'período da fatura');
  eq(doc.linhas[0].recebido, 300000, 'recebido nunca passa do total');
  eq([doc.linhas[0].situacao, doc.linhas[0].conferencia, doc.linhas[0].cobranca], ['Paga em parte', 'Aprovada pelo cliente', 'Boleto e Pix emitidos'], 'rótulos da tela');
  eq(doc.dinheiro_em, 'centavos', 'faturas em centavos');
  const ws = ler(planilhaDoDocumento(doc));
  eq(ws.H6.v, 3000, 'planilha em reais');
}

// ── Notas fiscais ─────────────────────────────────────────────────────────
{
  const n = (o: Partial<NotaFiscal>) => ({
    id: 'n', numero: '101', emitida_em: '2026-11-03T12:00:00Z', tomador: { razao_social: 'Carla', cpf_cnpj: '123' }, regime: 'INTERMEDIACAO',
    status: 'AUTORIZADA', valor_recebido: 1000, valor_servicos: 200, aliquota_iss: 5, valor_iss: 10, iss_retido: false, valor_liquido: 200,
    ambiente: 'PRODUCAO', erro: '', ...o,
  }) as unknown as NotaFiscal;
  const doc = documentoDasNotas([n({}), n({ id: 'm', status: 'REJEITADA', erro: 'Código de serviço', valor_servicos: 999 })], { de: '2026-11-01', situacao: 'Autorizada' });
  eq(doc.linhas[0].emissao, '2026-11-03', 'emitida em vira data');
  eq(doc.linhas[0].regime, 'Intermediação', 'regime por extenso');
  eq(doc.linhas[1].situacao, 'Recusada', 'recusada com o rótulo da tela');
  eq(doc.totais?.servico, 200, 'total só das autorizadas');
  eq(doc.rotulo_total, 'Total das autorizadas', 'o rótulo diz o que soma');
  eq(doc.filtros, [{ rotulo: 'Emitida', valor: 'desde 01/11/2026' }, { rotulo: 'Situação', valor: 'Autorizada' }], 'filtro aplicado');
}

// ── Gerar notas: a receita é o ganho da agência ───────────────────────────
{
  const l = { venda_id: 'v', venda_numero: 'VND-1', data_venda: '2026-11-02', cliente_nome: 'Carla', produto_id: 'p', produto_descricao: 'Hotel', tipo: 'HOSPEDAGEM',
    rotulo_tipo: 'Hospedagem', cancelado: false, receita: 15000, valor_notas: 10000, saldo: 5000, a_emitir: 5000, regra_id: 'r', regra_descricao: 'Ao pagante',
    situacao: 'COMPLEMENTAR', destinos: [] } as unknown as LinhaDaGrade;
  const doc = documentoDeGerarNotas([l], { de: '2026-11-01', ate: '2026-11-30', mostrar: 'Tudo' });
  eq(doc.colunas.find(c => c.id === 'receita')?.sensivel, true, 'Receitas marcada como sensível');
  eq(doc.linhas[0].situacao, 'Complementar sugerida', 'situação por extenso');
  const sem = semColunasSensiveis(doc, false);
  eq(sem.colunas.some(c => c.id === 'receita'), false, 'sem o direito, a receita não sai');
  eq(sem.totais?.notas, 10000, 'o resto sai');
}

// ── Fechar e Pagar comissões ──────────────────────────────────────────────
{
  const item = { chave: 'k', pessoa_funcao_id: 'pf', pessoa_id: 'u1', pessoa_nome: 'Bia', funcao_nome: 'Vendedor', venda_id: 'v', venda_numero: 'VND-1',
    data_venda: '2026-11-02', mes: '2026-11', descricao: 'Hotel', valor_centavos: 5000, retido_centavos: 500, saldo_centavos: 4500, estorno: false,
    explicacao: null, comissao_centavos: 5000, liberado_centavos: 5000, liberado_retido_centavos: 500 };
  const linhas = [
    { pessoa_funcao_id: 'pf', pessoa_id: 'u1', pessoa_nome: 'Bia', funcao_nome: 'Vendedor', plano_nome: 'Padrão', meta_centavos: 1000000, percentual: 80,
      meta_nao_atingida: false, valor_centavos: 3000, retido_centavos: 500, saldo_centavos: 2500, itens: [item, { ...item, chave: 'k2', estorno: true, valor_centavos: -2000, retido_centavos: 0, saldo_centavos: -2000 }], erros: [] },
    { pessoa_funcao_id: 'pg', pessoa_id: 'u2', pessoa_nome: 'Leo', funcao_nome: 'Vendedor', plano_nome: '', meta_centavos: null, percentual: null,
      meta_nao_atingida: false, valor_centavos: 0, retido_centavos: 0, saldo_centavos: 0, itens: [], erros: ['Sem plano.'] },
  ] as unknown as LinhaDoFechamento[];
  const doc = documentoDoFechamento(linhas, { ate: '2026-11-30', funcao: 'Vendedor' });
  eq(doc.linhas.length, 3, 'um por item, e quem tem pendência numa linha');
  eq(doc.linhas[1].situacao, 'Estorno', 'estorno marcado');
  eq(doc.linhas[2].situacao, 'Sem plano.', 'pendência com o motivo');
  eq(doc.totais, { valor: 3000, retido: 500, saldo: 2500 }, 'total por pessoa, igual ao da tela');
  eq(doc.colunas.some(c => c.sensivel), false, 'a comissão é o objeto da tela: nada sensível');
  eq(nomeDoArquivo(doc, 'xlsx'), 'fechar-comissoes-2026-11-30-vendedor.xlsx', 'nome com a data e a função');

  const pessoas = [{ pessoa_id: 'u1', pessoa_nome: 'Bia', aberto_centavos: 4000, itens: [
    { id: 'i', fechamento_id: 'f', venda_id: 'v', venda_numero: 'VND-1', data_venda: '2026-11-02', descricao: 'Hotel', funcao_nome: 'Vendedor',
      valor_centavos: 5000, retido_centavos: 500, saldo_centavos: 4500, pago_centavos: 500, aberto_centavos: 4000, estorno: false },
  ] }] as PessoaAPagar[];
  const pag = documentoDoPagamento(pessoas);
  eq(pag.linhas[0].aberto, 4000, 'a pagar por item');
  eq(pag.totais, { valor: 5000, retido: 500, pago: 500, aberto: 4000 }, 'totais do pagamento');
  eq(documentoDoPagamento([]).totais, null, 'nada a pagar, sem total');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);

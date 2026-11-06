/**
 * Mudança de sistema (E4, 05/11/2026): de linha da planilha a registro.
 * Puro, sem banco.
 *
 * Aplica o mapeamento confirmado (campo → coluna) a cada linha de dado e
 * devolve o registro já normalizado (datas ISO, dinheiro em centavos,
 * CPF/CNPJ só com dígitos) ou a recusa com código e motivo em palavras.
 * As linhas de agrupamento ("Movimento: Pagar") preenchem o campo das
 * linhas de baixo quando a coluna não existe ou veio vazia.
 */
import type { ContaBancaria } from '../crm-types';
import { definicaoDaLista, type ListaId, type Mapeamento } from './dicionario';
import type { LinhaPreparada } from './leitor';
import {
  dataBR, lerCentavos, lerData, lerDocumento, lerParcela, lerSimNao, normalizar, texto, type Celula,
} from './valores';

export type Movimento = 'pagar' | 'receber';
export type Papel = 'cliente' | 'fornecedor' | 'ambos';

export interface ContaLida {
  nome: string;
  tipo: ContaBancaria['tipo'];
  banco: string;
  agencia: string;
  numero: string;
  saldo: number | null;
  moeda: string;
  ativa: boolean;
  dia_fechamento: number;
  dia_vencimento: number;
}

export interface CategoriaLida { nome: string; grupo: string; tipo: 'RECEITA' | 'DESPESA'; repasse: boolean }
export interface CentroLido { nome: string }

export interface PessoaLida {
  nome: string;
  razao_social: string;
  documento: string;
  email: string;
  telefone: string;
  celular: string;
  tipo_pessoa: 'PF' | 'PJ';
  papel: Papel | null;
  cep: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  codigo: string;
}

export interface TituloLido {
  movimento: Movimento;
  pessoa: string;
  razao_social: string;
  documento_pessoa: string;
  numero: string;
  documento: string;
  descricao: string;
  emissao: string;
  vencimento: string;
  /** Liquidado no sistema anterior DEPOIS da data de corte: entra em aberto. */
  liquidado_depois_do_corte: string | null;
  valor: number;
  categoria: string;
  grupo: string;
  centro_custo: string;
  conta: string;
  empresa: string;
  venda: string;
  fatura: string;
  vendedor: string;
  parcela_numero: number;
  total_parcelas: number;
  forma: string;
  observacoes: string;
}

export interface SaldoLido { conta: string; saldo: number; data: string | null }

export type RegistroLido =
  | { lista: 'contas'; dados: ContaLida }
  | { lista: 'categorias'; dados: CategoriaLida }
  | { lista: 'centros_custo'; dados: CentroLido }
  | { lista: 'pessoas'; dados: PessoaLida }
  | { lista: 'titulos'; dados: TituloLido }
  | { lista: 'saldos'; dados: SaldoLido };

/** Códigos de recusa. A tela filtra por eles; as provas explicam cada diferença por eles. */
export type CodigoDeRecusa =
  | 'falta_coluna' | 'sem_nome' | 'sem_valor' | 'valor_invalido' | 'data_invalida' | 'sem_movimento'
  | 'liquidado' | 'excluido' | 'moeda_estrangeira' | 'outra_empresa' | 'sem_tipo'
  | 'duplicado_no_arquivo' | 'ja_importado' | 'pessoa_ambigua' | 'conta_nao_encontrada' | 'conta_com_movimento'
  | 'linha_de_total' | 'linha_de_agrupamento' | 'aviso_do_arquivo';

export type Interpretacao =
  | { ok: true; registro: RegistroLido; avisos: string[] }
  | { ok: false; codigo: CodigoDeRecusa; motivo: string };

/** Opções do arquivo e do lote que mudam a leitura. */
export interface OpcoesDeLeitura {
  /** Data de corte do lote (AAAA-MM-DD). */
  dataCorte?: string | null;
  /** Arquivo inteiro a pagar ou a receber, quando não há coluna Movimento. */
  movimento?: Movimento | null;
  /** Só estas empresas (nomes como no arquivo). Vazio = todas. */
  empresas?: string[];
}

// ---------------------------------------------------------------------------

export function lerMovimento(v: unknown): Movimento | null {
  const s = normalizar(v);
  if (!s) return null;
  if (/^(p|pagar|a pagar|contas a pagar|conta a pagar|despesa|despesas|saida|debito|d|pagamento)$/.test(s)) return 'pagar';
  if (/^(r|receber|a receber|contas a receber|conta a receber|receita|receitas|entrada|credito|c|recebimento)$/.test(s)) return 'receber';
  if (s.includes('pagar')) return 'pagar';
  if (s.includes('receber')) return 'receber';
  return null;
}

export function lerTipoDeCategoria(v: unknown): 'RECEITA' | 'DESPESA' | null {
  const m = lerMovimento(v);
  if (m === 'pagar') return 'DESPESA';
  if (m === 'receber') return 'RECEITA';
  return null;
}

export function lerTipoDeConta(v: unknown): ContaBancaria['tipo'] {
  const s = normalizar(v);
  if (s.includes('cartao') || s.includes('credito')) return 'CARTAO_CREDITO';
  if (s.includes('caixa') && !s.includes('economica')) return 'CAIXA';
  if (s.includes('poupanca')) return 'POUPANCA';
  if (s.includes('aplica') || s.includes('investimento')) return 'APLICACAO';
  return 'CORRENTE';
}

export function lerPapel(v: unknown): Papel | null {
  const s = normalizar(v);
  if (!s) return null;
  const cli = /client/.test(s);
  const forn = /fornec|operador|consolidador|representa/.test(s);
  if ((cli && forn) || /ambos|os dois/.test(s)) return 'ambos';
  if (cli) return 'cliente';
  if (forn) return 'fornecedor';
  return null;
}

const MOEDA_REAL = new Set(['', 'brl', 'r', 'real', 'reais', 'r$']);
function ehReal(v: string): boolean {
  return MOEDA_REAL.has(normalizar(v)) || texto(v) === 'R$';
}

function dia(v: unknown): number {
  const n = Number(texto(v).replace(/\D/g, ''));
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : 0;
}

/** Valor das células para os campos do mapeamento (com o contexto do agrupamento). */
function leitorDaLinha(celulas: Celula[], mapeamento: Mapeamento, contexto: Record<string, string>) {
  return (campo: string): Celula => {
    const i = mapeamento[campo];
    const v = i === undefined ? null : (celulas[i] ?? null);
    if ((v === null || v === '') && contexto[campo]) return contexto[campo];
    return v;
  };
}

/** Campo da lista que um rótulo de agrupamento representa ("Movimento" → movimento). */
export function campoDoAgrupamento(lista: ListaId, rotulo: string): string | null {
  const def = definicaoDaLista(lista);
  const n = normalizar(rotulo);
  const campo = def?.campos.find(c => c.sinonimos.some(s => normalizar(s) === n));
  return campo?.id ?? null;
}

/** Interpreta uma linha de dado. `contexto` traz os valores dos agrupamentos acima dela. */
export function interpretarLinha(
  lista: ListaId,
  celulas: Celula[],
  mapeamento: Mapeamento,
  opcoes: OpcoesDeLeitura = {},
  contexto: Record<string, string> = {},
): Interpretacao {
  const ler = leitorDaLinha(celulas, mapeamento, contexto);
  const t = (campo: string) => texto(ler(campo));
  switch (lista) {
    case 'contas': {
      const nome = t('nome');
      if (!nome) return { ok: false, codigo: 'sem_nome', motivo: 'Conta sem nome.' };
      const saldoBruto = ler('saldo');
      const saldo = saldoBruto === null || saldoBruto === '' ? null : lerCentavos(saldoBruto);
      if (saldoBruto !== null && saldoBruto !== '' && saldo === null) {
        return { ok: false, codigo: 'valor_invalido', motivo: `O saldo "${texto(saldoBruto)}" não é um valor.` };
      }
      const moeda = t('moeda');
      if (moeda && !ehReal(moeda)) return { ok: false, codigo: 'moeda_estrangeira', motivo: `Conta em ${moeda}: contas em outra moeda ficam para a próxima etapa da mudança.` };
      const ativa = lerSimNao(ler('ativa'));
      return {
        ok: true, avisos: [],
        registro: {
          lista, dados: {
            nome: nome.slice(0, 80), tipo: lerTipoDeConta(ler('tipo') ?? nome), banco: t('banco'), agencia: t('agencia'),
            numero: t('numero'), saldo, moeda: 'BRL', ativa: ativa !== false,
            dia_fechamento: dia(ler('dia_fechamento')), dia_vencimento: dia(ler('dia_vencimento')),
          },
        },
      };
    }
    case 'categorias': {
      const nome = t('nome');
      if (!nome) return { ok: false, codigo: 'sem_nome', motivo: 'Categoria sem nome.' };
      const tipo = lerTipoDeCategoria(ler('tipo'));
      if (!tipo) return { ok: false, codigo: 'sem_tipo', motivo: `A categoria "${nome}" não diz se é receita ou despesa.` };
      return { ok: true, avisos: [], registro: { lista, dados: { nome: nome.slice(0, 80), grupo: t('grupo').slice(0, 80), tipo, repasse: lerSimNao(ler('repasse')) === true } } };
    }
    case 'centros_custo': {
      const nome = t('nome');
      if (!nome) return { ok: false, codigo: 'sem_nome', motivo: 'Centro de custo sem nome.' };
      return { ok: true, avisos: [], registro: { lista, dados: { nome: nome.slice(0, 60) } } };
    }
    case 'pessoas': {
      const nome = t('nome') || t('razao_social');
      if (!nome) return { ok: false, codigo: 'sem_nome', motivo: 'Pessoa sem nome.' };
      const documento = lerDocumento(ler('documento')) || lerDocumento(ler('cnpj')) || lerDocumento(ler('cpf'));
      const avisos: string[] = [];
      const docBruto = t('documento') || t('cnpj') || t('cpf');
      if (docBruto && !documento) avisos.push(`O CPF/CNPJ "${docBruto}" não tem 11 nem 14 dígitos e ficou de fora.`);
      const tp = normalizar(ler('tipo_pessoa'));
      const tipo_pessoa: 'PF' | 'PJ' = documento.length === 14 || /juridica|pj|empresa/.test(tp) ? 'PJ' : 'PF';
      return {
        ok: true, avisos,
        registro: {
          lista, dados: {
            nome: nome.slice(0, 120), razao_social: t('razao_social').slice(0, 160), documento,
            email: t('email').toLowerCase().slice(0, 160), telefone: t('telefone').slice(0, 40), celular: t('celular').slice(0, 40),
            tipo_pessoa, papel: lerPapel(ler('papel')), cep: t('cep'), endereco: t('endereco'), numero: t('numero_endereco'),
            bairro: t('bairro'), cidade: t('cidade'), uf: t('uf').slice(0, 2).toUpperCase(), codigo: t('codigo'),
          },
        },
      };
    }
    case 'saldos': {
      const conta = t('conta');
      if (!conta) return { ok: false, codigo: 'sem_nome', motivo: 'Linha de saldo sem a conta.' };
      const bruto = ler('saldo');
      const saldo = lerCentavos(bruto);
      if (saldo === null) return { ok: false, codigo: 'valor_invalido', motivo: `O saldo "${texto(bruto)}" da conta "${conta}" não é um valor.` };
      const dataBruta = ler('data');
      const data = dataBruta === null || dataBruta === '' ? null : lerData(dataBruta);
      const avisos: string[] = [];
      if (data && opcoes.dataCorte && data !== opcoes.dataCorte) avisos.push(`Saldo de ${dataBR(data)}, e a data de corte é ${dataBR(opcoes.dataCorte)}.`);
      const moeda = t('moeda');
      if (moeda && !ehReal(moeda)) return { ok: false, codigo: 'moeda_estrangeira', motivo: `Saldo em ${moeda}: contas em outra moeda ficam para a próxima etapa da mudança.` };
      return { ok: true, avisos, registro: { lista, dados: { conta, saldo, data } } };
    }
    case 'titulos': {
      const pessoa = t('pessoa') || t('razao_social');
      if (!pessoa) return { ok: false, codigo: 'sem_nome', motivo: 'Lançamento sem a pessoa.' };
      const empresa = t('empresa');
      if (opcoes.empresas?.length && !opcoes.empresas.some(e => normalizar(e) === normalizar(empresa))) {
        return { ok: false, codigo: 'outra_empresa', motivo: `Da empresa "${empresa || 'sem empresa'}", que ficou de fora desta mudança.` };
      }
      const situacao = normalizar(ler('situacao'));
      if (/exclu|cancelad|estornad/.test(situacao)) return { ok: false, codigo: 'excluido', motivo: 'Excluído no sistema anterior.' };
      const vencBruto = ler('vencimento');
      const vencimento = lerData(vencBruto);
      if (!vencimento) {
        return { ok: false, codigo: 'data_invalida', motivo: vencBruto === null || vencBruto === '' ? 'Sem vencimento.' : `O vencimento "${texto(vencBruto)}" não é uma data.` };
      }
      const brutoFinal = ler('valor_final');
      const brutoValor = ler('valor');
      const usado = brutoFinal !== null && brutoFinal !== '' ? brutoFinal : brutoValor;
      const centavos = lerCentavos(usado);
      if (usado === null || usado === '') return { ok: false, codigo: 'sem_valor', motivo: 'Sem valor.' };
      if (centavos === null) return { ok: false, codigo: 'valor_invalido', motivo: `O valor "${texto(usado)}" não é um valor.` };
      if (centavos === 0) return { ok: false, codigo: 'sem_valor', motivo: 'Valor zero.' };
      let movimento = lerMovimento(ler('movimento')) ?? opcoes.movimento ?? null;
      if (!movimento && centavos < 0) movimento = 'pagar';
      if (!movimento) {
        return { ok: false, codigo: 'sem_movimento', motivo: 'Não diz se é a pagar ou a receber. Ligue a coluna Movimento ou escolha para o arquivo inteiro.' };
      }
      const moeda = t('moeda');
      if (moeda && !ehReal(moeda)) return { ok: false, codigo: 'moeda_estrangeira', motivo: `Lançamento em ${moeda}: títulos em outra moeda ficam para a próxima etapa da mudança.` };
      const avisos: string[] = [];
      const liqBruto = ler('liquidacao');
      const liquidacao = liqBruto === null || liqBruto === '' ? null : lerData(liqBruto);
      let liquidadoDepois: string | null = null;
      if (liqBruto !== null && liqBruto !== '' && !liquidacao) {
        return { ok: false, codigo: 'data_invalida', motivo: `A liquidação "${texto(liqBruto)}" não é uma data.` };
      }
      if (liquidacao) {
        if (opcoes.dataCorte && liquidacao > opcoes.dataCorte) {
          liquidadoDepois = liquidacao;
          avisos.push(`Liquidado no sistema anterior em ${dataBR(liquidacao)}, depois da data de corte: entra em aberto, dê a baixa aqui.`);
        } else {
          return { ok: false, codigo: 'liquidado', motivo: `Já liquidado em ${dataBR(liquidacao)}. O histórico liquidado fica para a próxima etapa da mudança.` };
        }
      } else if (/liquidad|quitad|^pago|^recebido|^paga$/.test(situacao)) {
        return { ok: false, codigo: 'liquidado', motivo: 'Já liquidado no sistema anterior. O histórico liquidado fica para a próxima etapa da mudança.' };
      }
      const emissao = lerData(ler('emissao'));
      if (ler('emissao') !== null && ler('emissao') !== '' && !emissao) avisos.push(`A emissão "${t('emissao')}" não é uma data: usei o vencimento.`);
      const parcela = lerParcela(ler('parcela'));
      return {
        ok: true, avisos,
        registro: {
          lista, dados: {
            movimento, pessoa: pessoa.slice(0, 120), razao_social: t('razao_social').slice(0, 160),
            documento_pessoa: lerDocumento(ler('documento_pessoa')),
            numero: t('numero').slice(0, 40), documento: t('documento').slice(0, 60), descricao: t('descricao').slice(0, 300),
            // Emissão depois do vencimento não existe: fica o vencimento.
            emissao: emissao && emissao <= vencimento ? emissao : vencimento,
            vencimento, liquidado_depois_do_corte: liquidadoDepois, valor: Math.abs(centavos),
            categoria: t('categoria').slice(0, 80), grupo: t('grupo').slice(0, 80), centro_custo: t('centro_custo').slice(0, 60),
            conta: t('conta').slice(0, 80), empresa: empresa.slice(0, 80), venda: t('venda').slice(0, 40), fatura: t('fatura').slice(0, 40),
            vendedor: t('vendedor').slice(0, 80), parcela_numero: parcela?.numero ?? 1, total_parcelas: parcela?.total ?? 1,
            forma: t('forma').slice(0, 60), observacoes: t('observacoes').slice(0, 1000),
          },
        },
      };
    }
  }
}

export interface LinhaInterpretada {
  numero: number;
  tipo: LinhaPreparada['tipo'];
  resultado: Interpretacao;
}

/**
 * Interpreta todas as linhas de uma aba preparada. Linhas que não são dado
 * voltam como recusadas com o motivo (total, agrupamento, aviso), para a
 * tela e as provas mostrarem por que ficaram de fora.
 */
export function interpretarLinhas(
  lista: ListaId,
  linhas: readonly LinhaPreparada[],
  mapeamento: Mapeamento,
  opcoes: OpcoesDeLeitura = {},
): LinhaInterpretada[] {
  const contexto: Record<string, string> = {};
  return linhas.map(l => {
    if (l.tipo === 'total') return { numero: l.numero, tipo: l.tipo, resultado: { ok: false, codigo: 'linha_de_total', motivo: 'Linha de total do rodapé: não é um lançamento.' } };
    if (l.tipo === 'aviso') return { numero: l.numero, tipo: l.tipo, resultado: { ok: false, codigo: 'aviso_do_arquivo', motivo: 'Aviso do sistema anterior no meio da lista (lista cortada).' } };
    if (l.tipo === 'agrupamento') {
      const campo = l.agrupamento ? campoDoAgrupamento(lista, l.agrupamento.rotulo) : null;
      if (campo && l.agrupamento) contexto[campo] = l.agrupamento.valor;
      return {
        numero: l.numero, tipo: l.tipo,
        resultado: { ok: false, codigo: 'linha_de_agrupamento', motivo: campo ? `Agrupamento: "${l.agrupamento?.rotulo}: ${l.agrupamento?.valor}" vale para as linhas de baixo.` : 'Linha de agrupamento ou cabeçalho repetido.' },
      };
    }
    return { numero: l.numero, tipo: l.tipo, resultado: interpretarLinha(lista, l.celulas, mapeamento, opcoes, contexto) };
  });
}

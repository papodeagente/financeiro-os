/**
 * AS CONTAS DA VENDA, sozinhas (E5, parte A). Sucessor de `gerarContasVenda`.
 *
 * `contasDaVenda` atende as duas entradas:
 *  - v1 (`{ versao: 1, entrada }`): a venda de hoje (itens próprio/fornecedor,
 *    do CRM v1 e de /vendas/nova). Delega a `gerarContasVenda`, e a saída é
 *    IDÊNTICA à de antes (provado em scripts/test-venda-v1-congelada.ts);
 *  - v2 (`{ versao: 2, venda }`): a venda completa do modelo (venda-modelo.ts),
 *    lançada à mão ou vinda do CRM (VENDA_FECHADA v2).
 *
 * Na v2 cada FORMA de pagamento vira, sem botão de "gerar", as contas certas:
 *  - Dinheiro, Cheque, Boleto, Cartão, Depósito, Pix, Outros: conta a receber
 *    do pagante, uma por parcela;
 *  - Faturar: conta a receber marcada `faturar` (a fatura do cliente é da
 *    parte B);
 *  - Crédito do cliente: nenhuma conta; uma PENDÊNCIA para a carteira de
 *    crédito (parte D) baixar o saldo do cliente;
 *  - Crédito no fornecedor e Pago direto ao fornecedor: nada a receber; o que
 *    a agência deve àquele fornecedor cai na mesma medida;
 *  - Retido pelo intermediário: conta a receber DO intermediário, já sem o
 *    repasse que lhe cabe (ele ficou com o dinheiro).
 * E, do lado do fornecedor, por pessoa do acerto (representante, senão
 * fornecedor): o que a agência deve (líquido) menos o que o cliente pagou
 * direto a ele. Sobra positiva = conta a pagar; negativa = comissão a receber
 * do fornecedor. O repasse ao intermediário vira conta a pagar a ele.
 * O que nenhuma forma cobre vira conta a receber do cliente ("saldo sem
 * forma de pagamento"), para nenhum valor sumir.
 *
 * Toda conta v2 leva `origem_item_id` = a chave natural dela (ex.:
 * `v2:pag:<id>`, `v2:forn:<parte>:<moeda>`): é o que o índice do banco usa
 * contra parcela duplicada e o que a regeração usa para preservar o que já
 * foi baixado (venda-servidor.ts).
 *
 * Arquivo puro.
 */

import { generateId } from './utils';
import { addDias, deCentavos, dividirParcelas, hojeISO, num, round2 } from './money';
import type { ContaPagar, ContaReceber } from './crm-types';
import {
  calcularVencimentoComissao, gerarContasVenda,
  type ContasGeradas, type FornecedorInfo, type ResumoFinanceiro, type VendaInput,
} from './venda-financeiro';
import {
  FORMAS, ROTULO_TIPO_PRODUTO, parteDoAcerto, totaisDaVenda, totaisDoProduto, vencimentoDaParcela,
  type Centavos, type ParteDaVenda, type PagamentoDaVenda, type ProdutoDaVenda, type Venda,
} from './venda-modelo';

export type EntradaContasDaVenda =
  | { versao: 1; entrada: VendaInput }
  | {
      versao: 2;
      venda: Venda;
      /** Cadastro dos fornecedores (prazo de pagamento, regra da comissão). */
      fornecedores?: FornecedorInfo[];
      /** Data de emissão das contas (padrão: hoje no fuso do Brasil). */
      hoje?: string;
    };

/** O que a venda deixa para outra parte resolver (hoje: crédito do cliente → parte D). */
export interface PendenciaDaVenda {
  tipo: 'CREDITO_CLIENTE';
  /** Chave estável (`v2:credito:<pagamento>`), igual entre reprocessamentos. */
  chave: string;
  pagamento_id: string;
  pessoa: ParteDaVenda;
  valor_centavos: Centavos;
  venda_origem_credito: string;
  descricao: string;
}

export interface AvisoDaVenda {
  codigo:
    | 'SALDO_SEM_FORMA' | 'PAGAMENTOS_ACIMA_DO_TOTAL' | 'PAGAMENTO_SEM_FORNECEDOR'
    | 'RETIDO_SEM_INTERMEDIARIO' | 'REPASSE_SEM_INTERMEDIARIO' | 'PRODUTO_SEM_FORNECEDOR' | 'PRODUTO_RECEITA_ZERO'
    /** Gravação (venda-servidor.ts): já se moveu mais do que a venda prevê agora. */
    | 'MOVIDO_ACIMA_DO_PREVISTO'
    /** Gravação: crédito do cliente já usado mudou de valor ou saiu da venda. */
    | 'CREDITO_JA_USADO';
  mensagem: string;
  valor_centavos?: Centavos;
  produto_id?: string;
  pagamento_id?: string;
}

/** Campos que a conta da venda completa carrega além dos de sempre. */
export interface MarcaDaContaV2 {
  venda_modelo: 2;
  /** = origem_item_id. Quem é esta conta dentro da venda. */
  venda_chave: string;
  venda_pagamento_id?: string;
  venda_forma?: string;
  /** Pessoa do acerto (fornecedor/representante/intermediário), para a parte C. */
  venda_parte_id?: string;
  venda_produtos?: string[];
  /** Conta da forma "Faturar": a fatura do cliente (parte B) a junta. */
  faturar?: boolean;
}

export type ContaReceberDaVenda = ContaReceber & Partial<MarcaDaContaV2>;
export type ContaPagarDaVenda = ContaPagar & Partial<MarcaDaContaV2>;

export interface ContasDaVenda extends ContasGeradas {
  versao: 1 | 2;
  contas_receber: ContaReceberDaVenda[];
  contas_pagar: ContaPagarDaVenda[];
  pendencias: PendenciaDaVenda[];
  avisos: AvisoDaVenda[];
}

/** Chave natural de uma conta gerada (v1 ou v2), a mesma que a regeração usa. */
export function chaveDaContaDaVenda(c: Record<string, unknown>): string {
  const item = String(c.origem_item_id ?? '');
  if (item.startsWith('v2:')) return `${item}|${String(c.parcela_numero ?? '')}`;
  return '';
}

export function contasDaVenda(e: EntradaContasDaVenda): ContasDaVenda {
  if (e.versao === 1) {
    return { ...gerarContasVenda(e.entrada), versao: 1, pendencias: [], avisos: [] };
  }
  return contasDaVendaCompleta(e.venda, e.fornecedores ?? [], e.hoje || hojeISO());
}

// ============================================================
// v2
// ============================================================

interface Acerto {
  chave: string;
  parte: ParteDaVenda | null;
  via_representante: boolean;
  produtos: ProdutoDaVenda[];
  /** O que a agência deve ao fornecedor pelos produtos dele (centavos de real). */
  devido: Centavos;
  /** O mesmo na moeda, quando todos os produtos são numa moeda só. */
  devido_moeda: Centavos;
  moedas: Set<string>;
  cambios: Set<number>;
  /** O cliente pagou direto a ele (itens que o fornecedor cobra). */
  pago_direto: Centavos;
  /** Pagamentos "Pago direto ao fornecedor" e "Crédito no fornecedor" apontados a ele. */
  abatido: Centavos;
}

const reais = (c: Centavos) => deCentavos(c);

function contaReceberBase(venda: Venda, hoje: string): Omit<ContaReceberDaVenda, 'id' | 'origem' | 'cliente_id' | 'cliente_nome' | 'descricao' | 'valor_original' | 'valor_final' | 'data_vencimento' | 'parcela_numero' | 'total_parcelas'> {
  return {
    venda_id: venda.id, grupo_id: venda.grupo_id, categoria_id: '', centro_custo: venda.centro_custo || '',
    juros: 0, multa: 0, desconto: 0, data_emissao: hoje, data_recebimento: null, valor_recebido: null,
    conta_bancaria_id: null, forma_recebimento: '', taxa: 0, taxa_plataforma: '',
    boleto_emitido: false, boleto_codigo: '', boleto_url: '', status: 'PENDENTE',
    rateio: [], anexos: [], observacoes: '', origem_venda_id: venda.id, auto_gerado: true, venda_modelo: 2,
  };
}

function contaPagarBase(venda: Venda, hoje: string): Omit<ContaPagarDaVenda, 'id' | 'fornecedor_id' | 'fornecedor_nome' | 'descricao' | 'valor_original' | 'valor_final' | 'moeda' | 'cambio' | 'valor_brl' | 'data_vencimento'> {
  return {
    origem: 'VENDA', venda_id: venda.id, grupo_id: venda.grupo_id, categoria_id: '', centro_custo: venda.centro_custo || '',
    juros: 0, multa: 0, desconto: 0, data_emissao: hoje, data_pagamento: null, valor_pago: null,
    conta_bancaria_id: null, forma_pagamento: '', cartao_id: null, comprovante: '',
    parcela_numero: 1, total_parcelas: 1, natureza_custo: 'VARIAVEL', is_custo_comercial: false,
    status: 'PENDENTE', rateio: [], anexos: [], observacoes: '', origem_venda_id: venda.id, auto_gerado: true, venda_modelo: 2,
  };
}

function nomeDaParte(p: ParteDaVenda | null, padrao: string): string {
  return (p?.nome || '').trim() || padrao;
}

function contasDaVendaCompleta(venda: Venda, fornecedores: FornecedorInfo[], hoje: string): ContasDaVenda {
  const contas_receber: ContaReceberDaVenda[] = [];
  const contas_pagar: ContaPagarDaVenda[] = [];
  const pendencias: PendenciaDaVenda[] = [];
  const avisos: AvisoDaVenda[] = [];
  const cadastro = new Map(fornecedores.map(f => [f.id, f]));
  const totais = totaisDaVenda(venda);
  const numero = venda.numero || venda.id;
  const cliente: ParteDaVenda = venda.cliente;

  // ---- Lado do fornecedor: uma pessoa de acerto por representante/fornecedor ----
  const acertos = new Map<string, Acerto>();
  let itens_proprio = 0;
  let itens_fornecedor = 0;
  for (const p of venda.produtos) {
    if (p.cancelado_em) continue;
    const t = totaisDoProduto(p);
    if (p.quem_cobra === 'FORNECEDOR') itens_fornecedor++; else itens_proprio++;
    if (t.brl.receita_bruta === 0 && t.brl.valor_cliente > 0) {
      avisos.push({ codigo: 'PRODUTO_RECEITA_ZERO', produto_id: p.id, mensagem: `${p.descricao || ROTULO_TIPO_PRODUTO[p.tipo]}: a agência não ganha nada neste produto.` });
    }
    const { chave, parte, via_representante } = parteDoAcerto(p);
    if (!parte && t.brl.valor_fornecedor > 0) {
      avisos.push({ codigo: 'PRODUTO_SEM_FORNECEDOR', produto_id: p.id, mensagem: `${p.descricao || ROTULO_TIPO_PRODUTO[p.tipo]}: falta dizer o fornecedor. A conta a pagar nasce marcada para preencher.` });
    }
    let a = acertos.get(chave);
    if (!a) {
      a = { chave, parte, via_representante, produtos: [], devido: 0, devido_moeda: 0, moedas: new Set(), cambios: new Set(), pago_direto: 0, abatido: 0 };
      acertos.set(chave, a);
    }
    a.produtos.push(p);
    a.devido += t.brl.valor_fornecedor;
    a.devido_moeda += t.valor_fornecedor;
    a.moedas.add(p.moeda);
    a.cambios.add(p.cambio);
    if (p.quem_cobra === 'FORNECEDOR') a.pago_direto += t.brl.valor_cliente;
  }
  const acertosReais = [...acertos.values()].filter(a => a.parte);

  function acertoDoPagamento(pag: PagamentoDaVenda): Acerto | null {
    const f = pag.fornecedor;
    if (f?.id) { const a = acertos.get(`id:${f.id}`); if (a) return a; }
    if (f?.nome) {
      const nome = f.nome.toLowerCase();
      const a = [...acertos.values()].find(x => x.parte && x.parte.nome.toLowerCase() === nome);
      if (a) return a;
    }
    return acertosReais.length === 1 ? acertosReais[0] : null;
  }

  // ---- Pagamentos do cliente, forma a forma ----
  const repasseTotal = totais.repasse;
  let repasseRetido = 0;
  for (const pag of venda.pagamentos) {
    const info = FORMAS[pag.forma];
    const chave = `v2:pag:${pag.id}`;
    if (info.efeito === 'receber_do_cliente' || info.efeito === 'faturar_ao_cliente') {
      const pagante = pag.pagante && (pag.pagante.id || pag.pagante.nome) ? pag.pagante : cliente;
      const n = info.efeito === 'faturar_ao_cliente' ? Math.max(1, pag.parcelas) : pag.parcelas;
      const valores = dividirParcelas(reais(pag.valor_centavos), n);
      const codigo = pag.forma === 'CARTAO' && pag.cartao_tipo === 'debito' ? 'CARTAO_DEBITO' : info.codigo;
      for (let i = 1; i <= n; i++) {
        contas_receber.push({
          ...contaReceberBase(venda, hoje),
          id: generateId(), origem: 'VENDA',
          cliente_id: pagante.id || cliente.id, cliente_nome: nomeDaParte(pagante, cliente.nome),
          descricao: [`Venda ${numero}`, info.rotulo, n > 1 ? `Parcela ${i}/${n}` : ''].filter(Boolean).join(' - '),
          valor_original: valores[i - 1], valor_final: valores[i - 1],
          data_vencimento: vencimentoDaParcela(pag, venda.data_venda, i),
          conta_bancaria_id: pag.conta_bancaria_id, forma_recebimento: codigo,
          parcela_numero: i, total_parcelas: n,
          observacoes: pag.detalhe,
          origem_item_id: chave, venda_chave: chave, venda_pagamento_id: pag.id, venda_forma: pag.forma,
          ...(info.efeito === 'faturar_ao_cliente' ? { faturar: true } : {}),
        });
      }
    } else if (info.efeito === 'credito_do_cliente') {
      const pessoa = pag.pagante && (pag.pagante.id || pag.pagante.nome) ? pag.pagante : cliente;
      pendencias.push({
        tipo: 'CREDITO_CLIENTE', chave: `v2:credito:${pag.id}`, pagamento_id: pag.id, pessoa,
        valor_centavos: pag.valor_centavos, venda_origem_credito: pag.venda_origem_credito,
        descricao: `Venda ${numero} paga com crédito do cliente`,
      });
    } else if (info.efeito === 'abate_do_fornecedor') {
      const a = acertoDoPagamento(pag);
      if (a) a.abatido += pag.valor_centavos;
      else avisos.push({ codigo: 'PAGAMENTO_SEM_FORNECEDOR', pagamento_id: pag.id, valor_centavos: pag.valor_centavos, mensagem: `${info.rotulo}: diga qual fornecedor recebeu, para abater o que a agência deve a ele.` });
    } else if (info.efeito === 'receber_do_intermediario') {
      const inter = venda.intermediario;
      if (!inter) avisos.push({ codigo: 'RETIDO_SEM_INTERMEDIARIO', pagamento_id: pag.id, mensagem: 'Retido pelo intermediário: a venda não diz quem é o intermediário. A conta nasce marcada para preencher.' });
      const retido = Math.min(Math.max(0, repasseTotal - repasseRetido), pag.valor_centavos);
      repasseRetido += retido;
      const aReceber = pag.valor_centavos - retido;
      if (aReceber > 0) {
        contas_receber.push({
          ...contaReceberBase(venda, hoje),
          id: generateId(), origem: 'OUTROS',
          cliente_id: inter?.id || '', cliente_nome: nomeDaParte(inter, 'Intermediário não informado'),
          descricao: `Venda ${numero} - Retido pelo intermediário`,
          valor_original: reais(aReceber), valor_final: reais(aReceber),
          data_vencimento: vencimentoDaParcela(pag, venda.data_venda, 1),
          parcela_numero: 1, total_parcelas: 1,
          observacoes: retido > 0 ? `O intermediário ficou com ${reais(pag.valor_centavos).toFixed(2)}; ${reais(retido).toFixed(2)} são o repasse dele.` : '',
          cliente_da_venda_id: cliente.id, cliente_da_venda_nome: cliente.nome,
          origem_item_id: chave, venda_chave: chave, venda_pagamento_id: pag.id, venda_forma: pag.forma,
          venda_parte_id: inter?.id || '',
          ...(inter ? {} : { fornecedor_pendente: true }),
        });
      }
    }
  }

  // ---- O que nenhuma forma cobre: a receber do cliente ----
  const semPagamentos = venda.pagamentos.length === 0;
  if (totais.saldo_sem_forma > 0) {
    const chave = 'v2:saldo';
    contas_receber.push({
      ...contaReceberBase(venda, hoje),
      id: generateId(), origem: 'VENDA',
      cliente_id: cliente.id, cliente_nome: cliente.nome,
      descricao: semPagamentos ? `Venda ${numero}` : `Venda ${numero} - saldo sem forma de pagamento`,
      valor_original: reais(totais.saldo_sem_forma), valor_final: reais(totais.saldo_sem_forma),
      // A regra da venda de sempre: um mês depois da venda.
      data_vencimento: vencimentoDaParcela({ forma: 'OUTROS', primeiro_vencimento: '', intervalo_dias: 0 }, venda.data_venda, 1),
      parcela_numero: 1, total_parcelas: 1,
      origem_item_id: chave, venda_chave: chave,
    });
    if (!semPagamentos) {
      avisos.push({ codigo: 'SALDO_SEM_FORMA', valor_centavos: totais.saldo_sem_forma, mensagem: `Faltam ${reais(totais.saldo_sem_forma).toFixed(2)} sem forma de pagamento. A conta a receber do cliente já existe; diga a forma quando souber.` });
    }
  } else if (totais.saldo_sem_forma < 0) {
    avisos.push({ codigo: 'PAGAMENTOS_ACIMA_DO_TOTAL', valor_centavos: -totais.saldo_sem_forma, mensagem: `Os pagamentos passam do total da venda em ${reais(-totais.saldo_sem_forma).toFixed(2)}.` });
  }

  // ---- Acerto com cada fornecedor ----
  let totalComissoes = 0;
  for (const a of acertos.values()) {
    const saldo = a.devido - a.pago_direto - a.abatido;
    const forn = a.parte?.id ? cadastro.get(a.parte.id) : undefined;
    const nome = nomeDaParte(a.parte, '');
    const tipos = [...new Set(a.produtos.map(p => ROTULO_TIPO_PRODUTO[p.tipo]))].join(', ');
    const idsProdutos = a.produtos.map(p => p.id);
    const parteId = a.parte?.id || '';
    if (saldo > 0) {
      const umaMoeda = a.moedas.size === 1 && a.cambios.size === 1 && a.pago_direto === 0 && a.abatido === 0;
      const moeda = umaMoeda ? [...a.moedas][0] : 'BRL';
      const cambio = umaMoeda ? [...a.cambios][0] : 1;
      const datas = a.produtos.map(p => p.data_pagamento_fornecedor).filter(Boolean).sort();
      const prazo = num(forn?.regras_faturamento?.prazo_pagamento_dias ?? 30);
      const chave = `v2:forn:${a.chave}:${moeda}`;
      contas_pagar.push({
        ...contaPagarBase(venda, hoje),
        id: generateId(),
        fornecedor_id: parteId, fornecedor_nome: nome,
        descricao: `Venda ${numero} - ${nome || 'Fornecedor não informado'}${tipos ? ` (${tipos})` : ''}`,
        valor_original: umaMoeda ? reais(a.devido_moeda) : reais(saldo),
        valor_final: reais(saldo), moeda: moeda as ContaPagar['moeda'], cambio, valor_brl: reais(saldo),
        data_vencimento: datas[0] || addDias(venda.data_venda, prazo),
        observacoes: a.parte ? (a.pago_direto + a.abatido > 0
          ? `Já descontado o que o cliente pagou direto a ${nome}: ${reais(a.pago_direto + a.abatido).toFixed(2)}.` : '')
          : 'A venda não diz a quem pagar. Edite esta conta para informar o fornecedor.',
        origem_item_id: chave, venda_chave: chave, venda_parte_id: parteId, venda_produtos: idsProdutos,
        fornecedor_pendente: !a.parte,
      });
    } else if (saldo < 0) {
      const chave = `v2:comissao:${a.chave}`;
      totalComissoes += -saldo;
      contas_receber.push({
        ...contaReceberBase(venda, hoje),
        id: generateId(), origem: 'COMISSAO_FORNECEDOR',
        cliente_id: parteId, cliente_nome: nome || 'Fornecedor não informado',
        descricao: `Comissão a receber - ${nome || 'Fornecedor não informado'} - Venda ${numero}`,
        valor_original: reais(-saldo), valor_final: reais(-saldo),
        data_vencimento: calcularVencimentoComissao(venda.data_venda, forn?.regras_faturamento?.regra_vencimento_comissao),
        parcela_numero: 1, total_parcelas: 1,
        observacoes: a.parte ? '' : 'A venda não diz qual fornecedor paga esta comissão. Edite a conta para informar.',
        fornecedor_id: parteId, fornecedor_nome: nome,
        cliente_da_venda_id: cliente.id, cliente_da_venda_nome: cliente.nome,
        valor_pago_direto: reais(a.pago_direto + a.abatido), custo_do_fornecedor: reais(a.devido),
        origem_item_id: chave, venda_chave: chave, venda_parte_id: parteId, venda_produtos: idsProdutos,
        ...(a.parte ? {} : { fornecedor_pendente: true }),
      });
    }
  }

  // ---- Repasse ao intermediário (o que ele não reteve) ----
  const repasseAPagar = repasseTotal - repasseRetido;
  if (repasseAPagar > 0) {
    const inter = venda.intermediario;
    if (!inter) avisos.push({ codigo: 'REPASSE_SEM_INTERMEDIARIO', valor_centavos: repasseAPagar, mensagem: 'Há repasse ao intermediário, mas a venda não diz quem é ele.' });
    const chave = `v2:repasse:${inter?.id || inter?.nome || 'sem'}`;
    contas_pagar.push({
      ...contaPagarBase(venda, hoje),
      id: generateId(),
      fornecedor_id: inter?.id || '', fornecedor_nome: inter?.nome || '',
      descricao: `Venda ${numero} - Repasse ao intermediário${inter?.nome ? ` ${inter.nome}` : ''}`,
      valor_original: reais(repasseAPagar), valor_final: reais(repasseAPagar), moeda: 'BRL', cambio: 1, valor_brl: reais(repasseAPagar),
      data_vencimento: addDias(venda.data_venda, 30),
      is_custo_comercial: true,
      observacoes: inter ? '' : 'Diga quem é o intermediário para pagar o repasse.',
      origem_item_id: chave, venda_chave: chave, venda_parte_id: inter?.id || '',
      fornecedor_pendente: !inter,
    });
  }

  const recebidoDoCliente = contas_receber.filter(c => c.origem === 'VENDA').reduce((s, c) => round2(s + c.valor_final), 0);
  const resumo: ResumoFinanceiro = {
    total_cliente: recebidoDoCliente,
    total_comissoes: reais(totalComissoes),
    total_custos: reais(totais.valor_fornecedor),
    lucro_previsto: reais(totais.receita_bruta),
    desconto_aplicado: reais(totais.componentes.DESCONTO),
    itens_proprio,
    itens_fornecedor,
  };
  return {
    versao: 2,
    contas_receber,
    contas_pagar,
    resumo,
    itens_processados: venda.produtos.filter(p => !p.cancelado_em).map(p => p.id),
    pendencias,
    avisos,
  };
}

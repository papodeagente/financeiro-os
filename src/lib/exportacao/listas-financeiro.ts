/**
 * EXPORTAÇÃO (E7, G3): o documento de cada lista que a tela já tem inteira
 * no navegador (Cobranças, Faturas, Notas fiscais, Gerar notas, Fechar e
 * Pagar comissões). A tela chama a função com as linhas do filtro e manda o
 * documento para POST /api/exportacao. Arquivo puro (sem React).
 *
 * As colunas são as da tela, por extenso (o que na tela é sublinha vira
 * coluna própria: ISS, valor pago, descrição). O filtro aplicado vai em
 * `filtros`, que entra no topo do arquivo e no nome dele.
 */
import type { Cobranca } from '../cobranca/contrato-telas';
import { nomeDoProvedor, ROTULO_DO_TIPO as TIPO_DA_COBRANCA, SITUACAO_DA_COBRANCA } from '../cobranca/regras-telas';
import type { ResumoDaFatura } from '../fatura-servidor';
import { ROTULO_CONFERENCIA, ROTULO_SITUACAO as SITUACAO_DA_FATURA } from '../fatura-regras';
import type { NotaFiscal, StatusNota } from '../nfse-tipos';
import { ROTULO_SITUACAO_DA_LINHA, type LinhaDaGrade } from '../nota-regras';
import type { LinhaDoFechamento } from '../comissao-funcoes';
import type { PessoaAPagar } from '../comissao-funcoes-servidor';
import { rotuloDoPeriodo, type DocumentoExportado, type FiltroAplicado } from './documento';

const somar = <T>(itens: readonly T[], f: (x: T) => number) => itens.reduce((a, x) => a + (f(x) || 0), 0);
const periodo = (rotulo: string, de?: string | null, ate?: string | null): FiltroAplicado[] =>
  (de || ate ? [{ rotulo, valor: rotuloDoPeriodo(de || null, ate || null) }] : []);
const se = (rotulo: string, valor: string | null | undefined): FiltroAplicado[] => (valor ? [{ rotulo, valor }] : []);

// ─── Cobranças ──────────────────────────────────────────────────────────────

export function documentoDasCobrancas(linhas: readonly Cobranca[], f: { de?: string; ate?: string; situacao?: string; provedor?: string; busca?: string }): DocumentoExportado {
  return {
    titulo: 'Cobranças',
    filtros: [...periodo('Vencimento', f.de, f.ate), ...se('Situação', f.situacao), ...se('Provedor', f.provedor), ...se('Busca', f.busca)],
    colunas: [
      { id: 'vencimento', rotulo: 'Vencimento', tipo: 'data' },
      { id: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { id: 'descricao', rotulo: 'Descrição', tipo: 'texto' },
      { id: 'tipo', rotulo: 'Como paga', tipo: 'texto' },
      { id: 'provedor', rotulo: 'Provedor', tipo: 'texto' },
      { id: 'situacao', rotulo: 'Situação', tipo: 'texto' },
      { id: 'valor', rotulo: 'Valor', tipo: 'dinheiro' },
      { id: 'valor_pago', rotulo: 'Valor pago', tipo: 'dinheiro' },
      { id: 'pago_em', rotulo: 'Pago em', tipo: 'data' },
      { id: 'linha', rotulo: 'Linha digitável', tipo: 'texto' },
      { id: 'erro', rotulo: 'Motivo da recusa', tipo: 'texto' },
    ],
    linhas: linhas.map(c => ({
      vencimento: c.vencimento, cliente: c.cliente_nome || 'Cliente', descricao: c.descricao, tipo: TIPO_DA_COBRANCA[c.tipo] ?? c.tipo,
      provedor: nomeDoProvedor(c.provedor), situacao: SITUACAO_DA_COBRANCA[c.status]?.rotulo ?? c.status, valor: c.valor,
      valor_pago: c.valor_pago, pago_em: c.pago_em ? c.pago_em.slice(0, 10) : null, linha: c.linha_digitavel ?? '', erro: c.status === 'falhou' ? c.erro ?? '' : '',
    })),
    totais: linhas.length ? { valor: Math.round(somar(linhas, c => c.valor) * 100) / 100, valor_pago: Math.round(somar(linhas, c => c.valor_pago ?? 0) * 100) / 100 } : null,
    orientacao: 'paisagem',
  };
}

// ─── Faturas ────────────────────────────────────────────────────────────────

const periodoDaFatura = (i: string | null | undefined, f: string | null | undefined) =>
  i && f ? rotuloDoPeriodo(i, f) : i ? rotuloDoPeriodo(i, null) : '';

export function documentoDasFaturas(linhas: readonly ResumoDaFatura[], f: { campo?: 'vencimento' | 'emissao'; de?: string; ate?: string; situacao?: string; busca?: string }, rotuloCobranca: Record<string, string> = {}): DocumentoExportado {
  return {
    titulo: 'Faturas',
    filtros: [...periodo(f.campo === 'emissao' ? 'Emissão' : 'Vencimento', f.de, f.ate), ...se('Situação', f.situacao), ...se('Busca', f.busca)],
    colunas: [
      { id: 'numero', rotulo: 'Nº', tipo: 'texto' },
      { id: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { id: 'descricao', rotulo: 'Descrição', tipo: 'texto' },
      { id: 'periodo', rotulo: 'Período', tipo: 'texto' },
      { id: 'emissao', rotulo: 'Emissão', tipo: 'data' },
      { id: 'vencimento', rotulo: 'Vencimento', tipo: 'data' },
      { id: 'itens', rotulo: 'Itens', tipo: 'inteiro' },
      { id: 'total', rotulo: 'Total', tipo: 'dinheiro' },
      { id: 'recebido', rotulo: 'Recebido', tipo: 'dinheiro' },
      { id: 'situacao', rotulo: 'Situação', tipo: 'texto' },
      { id: 'conferencia', rotulo: 'Conferência do cliente', tipo: 'texto' },
      { id: 'cobranca', rotulo: 'Cobrança', tipo: 'texto' },
    ],
    linhas: linhas.map(r => ({
      numero: String(r.numero ?? ''), cliente: r.pessoa_nome || 'Cliente',
      descricao: [r.avulsa ? 'Avulsa' : '', r.complementar_de ? 'Complementar' : '', r.descricao].filter(Boolean).join(' · '),
      periodo: periodoDaFatura(r.periodo_inicio, r.periodo_fim), emissao: r.emissao ?? null, vencimento: r.vencimento || null,
      itens: r.quantidade_itens, total: r.total_centavos, recebido: Math.min(r.recebido_centavos, r.total_centavos),
      situacao: SITUACAO_DA_FATURA[r.situacao_visivel] ?? r.situacao_visivel,
      conferencia: ROTULO_CONFERENCIA[r.conferencia as keyof typeof ROTULO_CONFERENCIA] ?? String(r.conferencia ?? ''),
      cobranca: r.cobranca ? rotuloCobranca[r.cobranca.status] ?? r.cobranca.status : 'Não emitida',
    })),
    totais: linhas.length ? {
      itens: somar(linhas, r => r.quantidade_itens), total: somar(linhas, r => r.total_centavos),
      recebido: somar(linhas, r => Math.min(r.recebido_centavos, r.total_centavos)),
    } : null,
    dinheiro_em: 'centavos',
    orientacao: 'paisagem',
  };
}

// ─── Notas fiscais ──────────────────────────────────────────────────────────

export const ROTULO_DA_NOTA: Record<StatusNota, string> = {
  RASCUNHO: 'Rascunho', PROCESSANDO: 'Na prefeitura', AUTORIZADA: 'Autorizada', REJEITADA: 'Recusada', CANCELADA: 'Cancelada',
};

export function documentoDasNotas(linhas: readonly NotaFiscal[], f: { de?: string; ate?: string; situacao?: string; busca?: string }): DocumentoExportado {
  const validas = linhas.filter(n => n.status === 'AUTORIZADA');
  return {
    titulo: 'Notas fiscais',
    filtros: [...periodo('Emitida', f.de, f.ate), ...se('Situação', f.situacao), ...se('Cliente', f.busca)],
    colunas: [
      { id: 'numero', rotulo: 'Número', tipo: 'texto' },
      { id: 'emissao', rotulo: 'Emitida em', tipo: 'data' },
      { id: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { id: 'documento', rotulo: 'CPF/CNPJ', tipo: 'texto' },
      { id: 'regime', rotulo: 'Regime', tipo: 'texto' },
      { id: 'situacao', rotulo: 'Situação', tipo: 'texto' },
      { id: 'recebido', rotulo: 'Valor recebido', tipo: 'dinheiro' },
      { id: 'servico', rotulo: 'Serviço', tipo: 'dinheiro' },
      { id: 'aliquota', rotulo: 'Alíquota do ISS', tipo: 'percentual' },
      { id: 'iss', rotulo: 'ISS', tipo: 'dinheiro' },
      { id: 'retido', rotulo: 'Total retido', tipo: 'dinheiro' },
      { id: 'liquido', rotulo: 'Líquido', tipo: 'dinheiro' },
      { id: 'ambiente', rotulo: 'Ambiente', tipo: 'texto' },
      { id: 'erro', rotulo: 'Motivo', tipo: 'texto' },
    ],
    linhas: linhas.map(n => ({
      numero: n.numero || '', emissao: n.emitida_em ? n.emitida_em.slice(0, 10) : null, cliente: n.tomador?.razao_social || 'Cliente não informado',
      documento: n.tomador?.cpf_cnpj ?? '', regime: n.regime === 'INTERMEDIACAO' ? 'Intermediação' : 'Receita própria',
      situacao: ROTULO_DA_NOTA[n.status] ?? n.status, recebido: n.valor_recebido, servico: n.valor_servicos, aliquota: n.aliquota_iss,
      iss: n.valor_iss, retido: n.total_retido ?? (n.iss_retido ? n.valor_iss : 0), liquido: n.valor_liquido,
      ambiente: n.ambiente === 'HOMOLOGACAO' ? 'Homologação' : 'Produção', erro: n.erro ?? '',
    })),
    totais: linhas.length ? {
      recebido: somar(validas, n => n.valor_recebido), servico: somar(validas, n => n.valor_servicos), iss: somar(validas, n => n.valor_iss),
      retido: somar(validas, n => n.total_retido ?? (n.iss_retido ? n.valor_iss : 0)), liquido: somar(validas, n => n.valor_liquido),
    } : null,
    rotulo_total: 'Total das autorizadas',
    orientacao: 'paisagem',
  };
}

// ─── Gerar notas ────────────────────────────────────────────────────────────

export function documentoDeGerarNotas(linhas: readonly LinhaDaGrade[], f: { de?: string; ate?: string; mostrar?: string; busca?: string }): DocumentoExportado {
  return {
    titulo: 'Gerar notas',
    filtros: [...periodo('Vendas', f.de, f.ate), ...se('Mostrar', f.mostrar), ...se('Busca', f.busca)],
    colunas: [
      { id: 'venda', rotulo: 'Venda', tipo: 'texto' },
      { id: 'data_venda', rotulo: 'Data da venda', tipo: 'data' },
      { id: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { id: 'produto', rotulo: 'Produto', tipo: 'texto' },
      { id: 'tipo', rotulo: 'Tipo de produto', tipo: 'texto' },
      { id: 'regra', rotulo: 'Regra da nota', tipo: 'texto' },
      // A receita da agência é o ganho dela: só sai para quem pode ver.
      { id: 'receita', rotulo: 'Receitas', tipo: 'dinheiro', sensivel: true },
      { id: 'notas', rotulo: 'Valor das notas', tipo: 'dinheiro' },
      { id: 'saldo', rotulo: 'Saldo', tipo: 'dinheiro' },
      { id: 'a_emitir', rotulo: 'A emitir pela regra', tipo: 'dinheiro' },
      { id: 'situacao', rotulo: 'Situação', tipo: 'texto' },
    ],
    linhas: linhas.map(l => ({
      venda: l.venda_numero || 'Venda', data_venda: l.data_venda || null, cliente: l.cliente_nome, produto: l.produto_descricao || l.rotulo_tipo,
      tipo: l.rotulo_tipo, regra: l.regra_descricao, receita: l.receita, notas: l.valor_notas, saldo: l.saldo, a_emitir: l.a_emitir,
      situacao: ROTULO_SITUACAO_DA_LINHA[l.situacao] ?? l.situacao,
    })),
    totais: linhas.length ? {
      receita: somar(linhas, l => l.receita), notas: somar(linhas, l => l.valor_notas), saldo: somar(linhas, l => l.saldo), a_emitir: somar(linhas, l => l.a_emitir),
    } : null,
    dinheiro_em: 'centavos',
    orientacao: 'paisagem',
  };
}

// ─── Fechar comissões ───────────────────────────────────────────────────────

/** Uma linha por item que entra no fechamento; quem tem pendência sai numa linha só, com o motivo. */
export function documentoDoFechamento(linhas: readonly LinhaDoFechamento[], f: { ate: string; funcao?: string }): DocumentoExportado {
  const out: DocumentoExportado['linhas'] = [];
  for (const l of linhas) {
    const meta = l.meta_centavos === null ? null : l.meta_centavos;
    if (!l.itens.length || l.erros.length) {
      out.push({
        pessoa: l.pessoa_nome, funcao: l.funcao_nome, plano: l.plano_nome, meta, atingido: l.percentual,
        venda: '', data_venda: null, descricao: '', valor: l.valor_centavos, retido: l.retido_centavos, saldo: l.saldo_centavos,
        situacao: l.erros.length ? l.erros.join(' ') : l.meta_nao_atingida ? 'Meta não atingida' : 'Nada a fechar',
      });
      continue;
    }
    for (const i of l.itens) {
      out.push({
        pessoa: l.pessoa_nome, funcao: l.funcao_nome, plano: l.plano_nome, meta, atingido: l.percentual,
        venda: i.venda_numero, data_venda: i.data_venda || null, descricao: i.descricao,
        valor: i.valor_centavos, retido: i.retido_centavos, saldo: i.saldo_centavos,
        situacao: i.estorno ? 'Estorno' : l.meta_nao_atingida ? 'Meta não atingida' : 'Entra no fechamento',
      });
    }
  }
  return {
    titulo: 'Fechar comissões',
    filtros: [{ rotulo: 'Até', valor: rotuloDoPeriodo(f.ate, f.ate) }, ...se('Função', f.funcao)],
    colunas: [
      { id: 'pessoa', rotulo: 'Pessoa', tipo: 'texto' },
      { id: 'funcao', rotulo: 'Função', tipo: 'texto' },
      { id: 'plano', rotulo: 'Plano', tipo: 'texto' },
      { id: 'meta', rotulo: 'Meta do mês', tipo: 'dinheiro' },
      { id: 'atingido', rotulo: '% da meta', tipo: 'percentual' },
      { id: 'venda', rotulo: 'Venda', tipo: 'texto' },
      { id: 'data_venda', rotulo: 'Data da venda', tipo: 'data' },
      { id: 'descricao', rotulo: 'Item', tipo: 'texto' },
      { id: 'valor', rotulo: 'Comissão', tipo: 'dinheiro' },
      { id: 'retido', rotulo: 'Retido', tipo: 'dinheiro' },
      { id: 'saldo', rotulo: 'Saldo', tipo: 'dinheiro' },
      { id: 'situacao', rotulo: 'Situação', tipo: 'texto' },
    ],
    linhas: out,
    totais: linhas.length ? {
      valor: somar(linhas, l => l.valor_centavos), retido: somar(linhas, l => l.retido_centavos), saldo: somar(linhas, l => l.saldo_centavos),
    } : null,
    dinheiro_em: 'centavos',
    orientacao: 'paisagem',
  };
}

// ─── Pagar comissões ────────────────────────────────────────────────────────

/** Uma linha por item fechado e ainda não pago. */
export function documentoDoPagamento(pessoas: readonly PessoaAPagar[]): DocumentoExportado {
  const linhas: DocumentoExportado['linhas'] = [];
  for (const p of pessoas) {
    for (const i of p.itens) {
      linhas.push({
        pessoa: p.pessoa_nome, funcao: i.funcao_nome, venda: i.venda_numero, data_venda: i.data_venda || null, descricao: i.descricao,
        valor: i.valor_centavos, retido: i.retido_centavos, pago: i.pago_centavos, aberto: i.aberto_centavos, estorno: i.estorno ? 'Estorno' : '',
      });
    }
  }
  const itens = pessoas.flatMap(p => p.itens);
  return {
    titulo: 'Pagar comissões',
    filtros: [],
    colunas: [
      { id: 'pessoa', rotulo: 'Pessoa', tipo: 'texto' },
      { id: 'funcao', rotulo: 'Função', tipo: 'texto' },
      { id: 'venda', rotulo: 'Venda', tipo: 'texto' },
      { id: 'data_venda', rotulo: 'Data da venda', tipo: 'data' },
      { id: 'descricao', rotulo: 'Item', tipo: 'texto' },
      { id: 'valor', rotulo: 'Comissão', tipo: 'dinheiro' },
      { id: 'retido', rotulo: 'Retido', tipo: 'dinheiro' },
      { id: 'pago', rotulo: 'Já pago', tipo: 'dinheiro' },
      { id: 'aberto', rotulo: 'A pagar', tipo: 'dinheiro' },
      { id: 'estorno', rotulo: 'Observação', tipo: 'texto' },
    ],
    linhas,
    totais: itens.length ? {
      valor: somar(itens, i => i.valor_centavos), retido: somar(itens, i => i.retido_centavos),
      pago: somar(itens, i => i.pago_centavos), aberto: somar(itens, i => i.aberto_centavos),
    } : null,
    dinheiro_em: 'centavos',
    orientacao: 'paisagem',
  };
}

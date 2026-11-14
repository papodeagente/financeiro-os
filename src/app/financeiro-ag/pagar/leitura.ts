import { ROTULO_DO_TIPO, type Divergencia, type RespostaDaLeitura } from '@/lib/leitura-documento';
import type { FormState } from './tipos';

/**
 * "Ler boleto ou nota" no formulário de conta a pagar (05/11/2026): como a
 * leitura entra no formulário. Puro, para os testes.
 *
 * Regras:
 *  - Só preenche campo VAZIO. O que a pessoa já digitou fica como está (e a
 *    tela diz quais ficaram).
 *  - Cada campo preenchido ganha a frase de origem ("Conferido pelo código do
 *    boleto", "Lido do documento. Confira."). Editar o campo apaga a origem.
 *  - Valor e vencimento em divergência não são preenchidos: a pessoa escolhe.
 *  - Nada aqui grava. O arquivo entra em `anexos` e só é salvo com a conta.
 */

export type CampoLido = 'fornecedor' | 'descricao' | 'valor' | 'vencimento' | 'categoria';

export type LeituraNoFormulario = {
  resposta: RespostaDaLeitura;
  /** Frase de origem dos campos preenchidos pela leitura. */
  origens: Partial<Record<CampoLido, string>>;
  /** Campos que a leitura trazia, mas a pessoa já tinha preenchido. */
  mantidos: CampoLido[];
  /** Divergências em que a pessoa já escolheu um lado. */
  resolvidas: Divergencia['campo'][];
};

export const ROTULO_DO_CAMPO: Record<CampoLido, string> = {
  fornecedor: 'Fornecedor',
  descricao: 'Descrição',
  valor: 'Valor',
  vencimento: 'Vencimento',
  categoria: 'Categoria',
};

const CONFIRA = 'Lido do documento. Confira.';
const PELO_BOLETO = 'Conferido pelo código do boleto.';

export function aplicarLeitura(form: FormState, r: RespostaDaLeitura): FormState {
  const { leitura, sugestoes, anexo } = r;
  const origens: LeituraNoFormulario['origens'] = {};
  const mantidos: CampoLido[] = [];
  const f: FormState = { ...form };

  const cadastro = sugestoes.fornecedor;
  const nomeLido = cadastro?.nome || leitura.fornecedor_nome;
  if (nomeLido) {
    if (!f.fornecedor_nome.trim()) {
      f.fornecedor_nome = nomeLido;
      f.fornecedor_id = cadastro?.id ?? '';
      origens.fornecedor = cadastro
        ? cadastro.como === 'documento'
          ? 'Do cadastro de fornecedores, pelo CNPJ.'
          : 'Do cadastro de fornecedores, pelo nome. Confira.'
        : 'Lido do documento. Ainda não está no cadastro.';
    } else mantidos.push('fornecedor');
  }
  if (!f.fornecedor_cnpj) f.fornecedor_cnpj = leitura.fornecedor_cnpj || cadastro?.documento || '';

  const descricao = leitura.descricao
    || (leitura.numero_documento ? `${ROTULO_DO_TIPO[leitura.tipo_documento]} ${leitura.numero_documento}` : '');
  if (descricao) {
    if (!f.descricao.trim()) {
      f.descricao = descricao;
      origens.descricao = CONFIRA;
    } else mantidos.push('descricao');
  }

  if (leitura.valor !== null) {
    if (f.valor_original === 0 && f.moeda === 'BRL') {
      f.valor_original = leitura.valor;
      origens.valor = leitura.valor_origem === 'boleto' ? PELO_BOLETO : CONFIRA;
    } else mantidos.push('valor');
  }

  if (leitura.vencimento) {
    if (!f.data_vencimento) {
      f.data_vencimento = leitura.vencimento;
      origens.vencimento = leitura.vencimento_origem === 'boleto' ? PELO_BOLETO : CONFIRA;
    } else mantidos.push('vencimento');
  }

  const categoria = sugestoes.categorias[0];
  if (categoria) {
    if (!f.categoria_id) {
      f.categoria_id = categoria.id;
      origens.categoria = origemDaCategoria(categoria.vezes);
    } else if (f.categoria_id !== categoria.id) mantidos.push('categoria');
  }

  if (!f.forma_pagamento) {
    if (leitura.boleto) f.forma_pagamento = 'BOLETO';
    else if (leitura.chave_pix) f.forma_pagamento = 'PIX';
  }
  if (!f.numero_documento) f.numero_documento = leitura.numero_documento;
  // A linha vai como foi lida, mesmo sem conferir: o campo mostra o problema
  // e a pessoa corrige ali.
  if (!f.linha_digitavel && leitura.boleto) f.linha_digitavel = leitura.boleto.linha_digitavel.replace(/\D/g, '');
  if (!f.chave_pix) f.chave_pix = leitura.chave_pix;
  if (!f.anexos.some((a) => a.url === anexo.url)) f.anexos = [...f.anexos, anexo];

  f.leitura = { resposta: r, origens, mantidos, resolvidas: [] };
  return f;
}

/**
 * A pessoa mexeu no campo: a origem não vale mais. Mexer no nome do
 * fornecedor que a LEITURA ligou ao cadastro desfaz esse vínculo; o vínculo
 * de uma conta que já existia (edição, conta do CRM) não é tocado.
 */
export function esquecerOrigem(form: FormState, campo: CampoLido): FormState {
  if (!form.leitura?.origens[campo]) return form;
  const origens = { ...form.leitura.origens };
  delete origens[campo];
  const extra: Partial<FormState> = campo === 'fornecedor' ? { fornecedor_id: '' } : {};
  return { ...form, ...extra, leitura: { ...form.leitura, origens } };
}

/** Escolha numa divergência entre o documento e o código do boleto. */
export function escolherNaDivergencia(form: FormState, d: Divergencia, lado: 'documento' | 'boleto'): FormState {
  if (!form.leitura) return form;
  const bruto = lado === 'boleto' ? d.bruto_boleto : d.bruto_documento;
  const origem = lado === 'boleto' ? 'Você escolheu o do código do boleto.' : 'Você escolheu o do documento.';
  const base = d.campo === 'valor'
    ? { ...form, valor_original: Number(bruto) }
    : { ...form, data_vencimento: bruto };
  return {
    ...base,
    leitura: {
      ...form.leitura,
      origens: { ...form.leitura.origens, [d.campo]: origem },
      resolvidas: [...form.leitura.resolvidas.filter((c) => c !== d.campo), d.campo],
    },
  };
}

/** O fornecedor lido foi cadastrado agora pela pessoa. */
export function ligarFornecedorCadastrado(form: FormState, cadastro: { id: string; nome: string }): FormState {
  if (!form.leitura) return form;
  const r = form.leitura.resposta;
  return {
    ...form,
    fornecedor_id: cadastro.id,
    fornecedor_nome: cadastro.nome,
    leitura: {
      ...form.leitura,
      resposta: {
        ...r,
        sugestoes: {
          ...r.sugestoes,
          sugerir_criar: false,
          fornecedor: { id: cadastro.id, nome: cadastro.nome, documento: form.fornecedor_cnpj, como: 'documento' },
        },
      },
      origens: { ...form.leitura.origens, fornecedor: 'Cadastrado agora no cadastro de fornecedores.' },
    },
  };
}

/** A pessoa pediu para usar o valor e/ou o vencimento da linha digitável conferida. */
export function usarDoBoleto(form: FormState, dados: { valor: number | null; vencimento: string | null }): FormState {
  const f: FormState = { ...form };
  if (dados.valor !== null) f.valor_original = dados.valor;
  if (dados.vencimento) f.data_vencimento = dados.vencimento;
  if (form.leitura) {
    const origens = { ...form.leitura.origens };
    const resolvidas = form.leitura.resolvidas.slice();
    if (dados.valor !== null) {
      origens.valor = PELO_BOLETO;
      if (!resolvidas.includes('valor')) resolvidas.push('valor');
    }
    if (dados.vencimento) {
      origens.vencimento = PELO_BOLETO;
      if (!resolvidas.includes('vencimento')) resolvidas.push('vencimento');
    }
    f.leitura = { ...form.leitura, origens, resolvidas };
  }
  return f;
}

/** Frase de origem da categoria sugerida pelo histórico do fornecedor. */
export function origemDaCategoria(vezes: number): string {
  return vezes === 1 ? 'Usada 1 vez para este fornecedor. Confira.' : `Usada ${vezes} vezes para este fornecedor.`;
}

/** Categoria escolhida entre as sugeridas: entra com a frase de origem. */
export function escolherCategoriaSugerida(form: FormState, categoria: { id: string; vezes: number }): FormState {
  if (!form.leitura) return { ...form, categoria_id: categoria.id };
  return {
    ...form,
    categoria_id: categoria.id,
    leitura: { ...form.leitura, origens: { ...form.leitura.origens, categoria: origemDaCategoria(categoria.vezes) } },
  };
}

/**
 * Outro arquivo no lugar do primeiro: o que a leitura anterior preencheu e a
 * pessoa não mexeu volta a ficar vazio (senão o segundo documento não
 * entraria), e o arquivo anterior sai dos anexos. O que a pessoa digitou fica.
 */
export function trocarLeitura(form: FormState, r: RespostaDaLeitura): FormState {
  if (!form.leitura) return aplicarLeitura(form, r);
  const o = form.leitura.origens;
  const anterior = form.leitura.resposta.leitura;
  const f: FormState = { ...form };
  if (o.fornecedor) { f.fornecedor_nome = ''; f.fornecedor_id = ''; }
  if (o.descricao) f.descricao = '';
  if (o.valor) f.valor_original = 0;
  if (o.vencimento) f.data_vencimento = '';
  if (o.categoria) f.categoria_id = '';
  if (f.fornecedor_cnpj === anterior.fornecedor_cnpj) f.fornecedor_cnpj = '';
  if (f.numero_documento === anterior.numero_documento) f.numero_documento = '';
  if (anterior.boleto && f.linha_digitavel === anterior.boleto.linha_digitavel.replace(/\D/g, '')) f.linha_digitavel = '';
  if (f.chave_pix === anterior.chave_pix) f.chave_pix = '';
  return aplicarLeitura(descartarLeitura(f), r);
}

/** Descarta a leitura: os campos ficam; o arquivo sai dos anexos. */
export function descartarLeitura(form: FormState): FormState {
  if (!form.leitura) return form;
  const url = form.leitura.resposta.anexo.url;
  return { ...form, anexos: form.anexos.filter((a) => a.url !== url), leitura: null };
}

/**
 * O que está por trás de um título (E7, frente D, 06/11/2026): as abas
 * "Itens" e "Comissões" da conta a pagar/receber, e o anexo livre.
 *
 * Itens: os produtos da venda que originou a conta (venda completa: os do
 * fornecedor da conta, ou todos para a conta do cliente; venda do CRM: os
 * itens), os itens da fatura ao cliente, os da fatura do fornecedor e o
 * detalhe da conta de comissão.
 * Comissões: as dos vendedores e das funções sobre a venda da conta, a
 * comissão de fornecedor e o que a conta de comissão paga. Cada parte só
 * aparece para quem tem o direito (ganho da agência, comissão da equipe ou
 * a própria).
 *
 * Só leitura (menos o anexo). Banco sem alguma tabela (antigo ou teste): a
 * parte dela fica vazia, sem erro (to_regclass não falha).
 */
import type { ExecutorSQL } from './caixa-atomico';
import { deCentavos, num, round2 } from './money';
import { anexosDe, MAX_ANEXOS_POR_TITULO, type Anexo } from './anexos-do-titulo';
import type { TabelaDoTitulo } from './contas-excluidas';

export interface ItemDaOrigem {
  /** De onde veio a linha. */
  fonte: 'venda' | 'venda_crm' | 'fatura' | 'fatura_fornecedor' | 'comissao';
  descricao: string;
  /** Linha de baixo: fornecedor, localizador, datas, venda. */
  detalhe: string;
  quantidade: number | null;
  /** Em reais quando `moeda` é BRL; senão na moeda. */
  valor: number;
  moeda: string;
  cancelado: boolean;
}

export interface ComissaoDoTitulo {
  quem: string;
  /** "Vendedor", nome da função, "Fornecedor" ... */
  papel: string;
  descricao: string;
  valor: number;
  situacao: string;
}

export interface OrigemDoTitulo {
  origem: { tipo: 'venda' | 'fatura' | 'fatura_fornecedor' | 'comissao' | 'manual'; rotulo: string; venda_id: string | null; fatura_id: string | null };
  itens: ItemDaOrigem[];
  comissoes: ComissaoDoTitulo[];
  /** Comissões escondidas por falta de direito (a tela explica). */
  comissoes_ocultas: boolean;
  anexos: Anexo[];
}

export interface DireitosDaOrigem {
  /** Ganho da agência (comissão de fornecedor, over). */
  verGanho: boolean;
  /** Comissão de todos os vendedores. */
  verEquipe: boolean;
  /** Só a própria (vendedor). */
  verPropria: boolean;
  usuarioId: string;
}

const txt = (v: unknown) => (v == null ? '' : String(v));
const dataBR = (v: unknown) => {
  const s = txt(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';
};

async function existe(exec: ExecutorSQL, tabela: string): Promise<boolean> {
  const { rows } = await exec.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${tabela}`]);
  return rows[0]?.ok === true;
}

export async function lerTitulo(exec: ExecutorSQL, tenantId: string, tabela: TabelaDoTitulo, id: string): Promise<Record<string, unknown> | null> {
  const { rows } = await exec.query(`SELECT data FROM ${tabela} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  return rows[0] ? (rows[0].data as Record<string, unknown>) : null;
}

/** A venda da conta (a regra de sempre: venda_id, origem_venda_id). */
export function vendaDoTitulo(d: Record<string, unknown>): string | null {
  return txt(d.origem_venda_id) || txt(d.venda_id) || null;
}

function juntar(...partes: string[]): string {
  return partes.map(p => p.trim()).filter(Boolean).join(' · ');
}

async function itensDaVenda(exec: ExecutorSQL, tenantId: string, vendaId: string, d: Record<string, unknown>): Promise<ItemDaOrigem[]> {
  // Venda completa: os produtos (os da conta, quando ela diz quais).
  if (await existe(exec, 'venda_produtos')) {
    const ids = Array.isArray(d.venda_produtos) ? (d.venda_produtos as unknown[]).map(txt).filter(Boolean) : [];
    // Datas como texto: o driver devolveria Date no fuso do servidor.
    const { rows } = await exec.query(
      `SELECT id, tipo, descricao, fornecedor_nome, fornecedor_externo, localizador, data_inicio::text AS data_inicio, data_fim::text AS data_fim, quantidade, moeda,
              valor_unitario_centavos, taxas_centavos, cancelado_em
         FROM venda_produtos WHERE tenant_id = $1 AND venda_id = $2 ${ids.length ? 'AND id = ANY($3::text[])' : ''}
        ORDER BY sequencia, id`,
      ids.length ? [tenantId, vendaId, ids] : [tenantId, vendaId],
    );
    if (rows.length) {
      return rows.map(r => {
        const qtd = Math.max(1, Math.round(num(r.quantidade)));
        const total = (num(r.valor_unitario_centavos) * qtd + num(r.taxas_centavos));
        const periodo = r.data_inicio ? `${dataBR(r.data_inicio)}${r.data_fim ? ` a ${dataBR(r.data_fim)}` : ''}` : '';
        return {
          fonte: 'venda' as const,
          descricao: txt(r.descricao) || txt(r.tipo),
          detalhe: juntar(txt(r.fornecedor_nome) || txt(r.fornecedor_externo), r.localizador ? `Localizador ${txt(r.localizador)}` : '', periodo),
          quantidade: qtd,
          valor: round2(deCentavos(total)),
          moeda: txt(r.moeda) || 'BRL',
          cancelado: Boolean(r.cancelado_em),
        };
      });
    }
  }
  // Venda do CRM (modelo de antes): os itens da venda.
  if (await existe(exec, 'itens_venda')) {
    const { rows } = await exec.query(
      `SELECT data, status FROM itens_venda WHERE tenant_id = $1 AND venda_id = $2 ORDER BY sequencia, id`, [tenantId, vendaId]);
    return rows.map(r => {
      const x = (r.data ?? {}) as Record<string, unknown>;
      const periodo = x.data_inicio ? `${dataBR(x.data_inicio)}${x.data_fim ? ` a ${dataBR(x.data_fim)}` : ''}` : '';
      return {
        fonte: 'venda_crm' as const,
        descricao: txt(x.descricao) || txt(x.tipo),
        detalhe: juntar(txt(x.fornecedor_nome), x.localizador ? `Localizador ${txt(x.localizador)}` : '', periodo),
        quantidade: null,
        valor: round2(num(x.valor_venda)),
        moeda: txt(x.moeda) || 'BRL',
        cancelado: txt(r.status) === 'cancelado',
      };
    });
  }
  return [];
}

async function itensDaFatura(exec: ExecutorSQL, tenantId: string, faturaId: string): Promise<ItemDaOrigem[]> {
  if (!(await existe(exec, 'fatura_itens'))) return [];
  const { rows } = await exec.query(
    `SELECT venda_numero, data_venda::text AS data_venda, descricao, valor_centavos, taxas_servico_centavos FROM fatura_itens
      WHERE tenant_id = $1 AND fatura_id = $2 ORDER BY data_venda NULLS LAST, venda_numero`,
    [tenantId, faturaId],
  );
  return rows.map(r => ({
    fonte: 'fatura' as const,
    descricao: txt(r.descricao) || `Venda ${txt(r.venda_numero)}`,
    detalhe: juntar(r.venda_numero ? `Venda ${txt(r.venda_numero)}` : '', dataBR(r.data_venda)),
    quantidade: null,
    valor: round2(deCentavos(num(r.valor_centavos) + num(r.taxas_servico_centavos))),
    moeda: 'BRL',
    cancelado: false,
  }));
}

async function itensDaFaturaDoFornecedor(exec: ExecutorSQL, tenantId: string, faturaId: string): Promise<ItemDaOrigem[]> {
  if (!(await existe(exec, 'fatura_fornecedor_itens'))) return [];
  const { rows } = await exec.query(
    `SELECT venda_numero, descricao, valor_centavos, moeda, valor_moeda_centavos FROM fatura_fornecedor_itens
      WHERE tenant_id = $1 AND fatura_id = $2 AND ativo ORDER BY venda_numero, conta_pagar_id`,
    [tenantId, faturaId],
  );
  return rows.map(r => ({
    fonte: 'fatura_fornecedor' as const,
    descricao: txt(r.descricao) || `Venda ${txt(r.venda_numero)}`,
    detalhe: juntar(r.venda_numero ? `Venda ${txt(r.venda_numero)}` : '', txt(r.moeda) && txt(r.moeda) !== 'BRL' ? `${txt(r.moeda)} ${(num(r.valor_moeda_centavos) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''),
    quantidade: null,
    valor: round2(deCentavos(num(r.valor_centavos))),
    moeda: 'BRL',
    cancelado: false,
  }));
}

/** As linhas que a própria conta de comissão guarda (o que ela paga). */
function itensDaContaDeComissao(d: Record<string, unknown>): ItemDaOrigem[] {
  const detalhe = Array.isArray(d.comissao_detalhe) ? d.comissao_detalhe as Array<Record<string, unknown>> : [];
  return detalhe.map(x => ({
    fonte: 'comissao' as const,
    descricao: txt(x.descricao) || 'Comissão',
    detalhe: juntar(x.venda_numero ? `Venda ${txt(x.venda_numero)}` : '', txt(x.funcao)),
    quantidade: null,
    valor: round2(deCentavos(num(x.centavos))),
    moeda: 'BRL',
    cancelado: false,
  }));
}

const SITUACAO_DA_COMISSAO: Record<string, string> = {
  PENDENTE: 'A pagar', APROVADA: 'Aprovada', PAGA: 'Paga', CANCELADA: 'Cancelada', ESTORNADA: 'Estornada',
};

async function comissoesDaVenda(
  exec: ExecutorSQL, tenantId: string, vendaId: string, direitos: DireitosDaOrigem,
): Promise<{ lista: ComissaoDoTitulo[]; ocultas: boolean }> {
  const lista: ComissaoDoTitulo[] = [];
  let ocultas = false;
  const podeVer = (pessoa: string) => direitos.verEquipe || (direitos.verPropria && pessoa !== '' && pessoa === direitos.usuarioId);
  if (await existe(exec, 'comissoes')) {
    const { rows } = await exec.query(`SELECT data FROM comissoes WHERE tenant_id = $1 AND venda_id = $2 ORDER BY id`, [tenantId, vendaId]);
    for (const r of rows) {
      const c = (r.data ?? {}) as Record<string, unknown>;
      if (!podeVer(txt(c.vendedor_id))) { ocultas = true; continue; }
      lista.push({
        quem: txt(c.vendedor_nome) || 'Vendedor', papel: 'Vendedor',
        descricao: juntar(txt(c.plano_nome), num(c.percentual_aplicado) ? `${num(c.percentual_aplicado).toLocaleString('pt-BR')}% de ${round2(num(c.valor_base)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''),
        valor: round2(num(c.valor_comissao)), situacao: SITUACAO_DA_COMISSAO[txt(c.status)] ?? txt(c.status),
      });
    }
  }
  if (await existe(exec, 'comissao_lancamentos')) {
    const { rows } = await exec.query(
      `SELECT pessoa_id, pessoa_nome, funcao_nome, descricao, valor_centavos, fechado_centavos FROM comissao_lancamentos
        WHERE tenant_id = $1 AND venda_id = $2 ORDER BY pessoa_nome, funcao_nome, chave`,
      [tenantId, vendaId],
    );
    for (const r of rows) {
      if (!podeVer(txt(r.pessoa_id))) { ocultas = true; continue; }
      const valor = num(r.valor_centavos);
      lista.push({
        quem: txt(r.pessoa_nome) || 'Pessoa', papel: txt(r.funcao_nome) || 'Função', descricao: txt(r.descricao),
        valor: round2(deCentavos(valor)), situacao: num(r.fechado_centavos) >= valor && valor !== 0 ? 'Fechada' : 'Em aberto',
      });
    }
  }
  return { lista, ocultas };
}

/** Comissão de fornecedor ligada à venda (ganho da agência). */
async function comissaoDeFornecedor(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<ComissaoDoTitulo[]> {
  const { rows } = await exec.query(
    `SELECT data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem' = 'COMISSAO_FORNECEDOR'
        AND COALESCE(NULLIF(venda_id, ''), data->>'origem_venda_id', data->>'venda_id') = $2`,
    [tenantId, vendaId],
  );
  return rows.map(r => {
    const c = (r.data ?? {}) as Record<string, unknown>;
    return {
      quem: txt(c.fornecedor_nome) || txt(c.cliente_nome) || 'Fornecedor', papel: 'Comissão de fornecedor',
      descricao: txt(c.descricao), valor: round2(num(c.valor_final)),
      situacao: txt(c.status) === 'RECEBIDO' ? 'Recebida' : txt(c.status) === 'PARCIAL' ? 'Recebida em parte' : 'A receber',
    };
  });
}

export async function origemDoTitulo(
  exec: ExecutorSQL, tenantId: string, tabela: TabelaDoTitulo, d: Record<string, unknown>, direitos: DireitosDaOrigem,
): Promise<OrigemDoTitulo> {
  const vendaId = vendaDoTitulo(d);
  const faturaId = txt(d.fatura_id) || null;
  const faturaFornecedorId = txt(d.fatura_fornecedor_id) || null;
  const deComissao = Boolean(d.comissao_pagamento_id || (Array.isArray(d.comissao_detalhe) && d.comissao_detalhe.length));

  let origem: OrigemDoTitulo['origem'] = { tipo: 'manual', rotulo: 'Lançada à mão', venda_id: null, fatura_id: null };
  let itens: ItemDaOrigem[] = [];
  if (faturaFornecedorId) {
    origem = { tipo: 'fatura_fornecedor', rotulo: `Fatura do fornecedor ${txt(d.fatura_fornecedor_numero)}`.trim(), venda_id: null, fatura_id: faturaFornecedorId };
    itens = await itensDaFaturaDoFornecedor(exec, tenantId, faturaFornecedorId);
  } else if (faturaId) {
    origem = { tipo: 'fatura', rotulo: `Fatura ${txt(d.fatura_numero)}`.trim(), venda_id: null, fatura_id: faturaId };
    itens = await itensDaFatura(exec, tenantId, faturaId);
  } else if (deComissao) {
    origem = { tipo: 'comissao', rotulo: 'Pagamento de comissões', venda_id: null, fatura_id: null };
    itens = itensDaContaDeComissao(d);
  } else if (vendaId) {
    origem = { tipo: 'venda', rotulo: 'Venda', venda_id: vendaId, fatura_id: null };
    itens = await itensDaVenda(exec, tenantId, vendaId, d);
  }

  let comissoes: ComissaoDoTitulo[] = [];
  let ocultas = false;
  if (deComissao) {
    // A conta de comissão: o que ela paga é a própria comissão da pessoa.
    const pessoa = txt(d.comissao_pessoa_id);
    if (direitos.verEquipe || (direitos.verPropria && pessoa === direitos.usuarioId)) {
      comissoes = itensDaContaDeComissao(d).map(i => ({
        quem: txt(tabela === 'contas_pagar' ? d.fornecedor_nome : d.cliente_nome), papel: i.detalhe.split(' · ').pop() || 'Comissão',
        descricao: i.descricao, valor: i.valor, situacao: tabela === 'contas_pagar' ? 'Nesta conta' : 'A devolver',
      }));
    } else ocultas = true;
  } else if (vendaId) {
    const daVenda = await comissoesDaVenda(exec, tenantId, vendaId, direitos);
    comissoes = daVenda.lista;
    ocultas = daVenda.ocultas;
    if (direitos.verGanho) comissoes = [...(await comissaoDeFornecedor(exec, tenantId, vendaId)), ...comissoes];
    else ocultas = true;
  }
  return { origem, itens, comissoes, comissoes_ocultas: ocultas, anexos: anexosDe(d) };
}

// ---------------------------------------------------------------------------
// Anexo livre

export class ErroDoAnexo extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/** Acrescenta um anexo à lista do título (trava a linha). Devolve a lista e a versão nova. */
export async function anexarAoTitulo(
  exec: ExecutorSQL, tenantId: string, tabela: TabelaDoTitulo, id: string, anexo: Anexo,
): Promise<{ anexos: Anexo[]; _versao: string }> {
  const { rows } = await exec.query(`SELECT data FROM ${tabela} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  if (!rows[0]) throw new ErroDoAnexo('Esta conta não existe mais. Recarregue a lista.', 404);
  const lista = anexosDe(rows[0].data as Record<string, unknown>);
  if (lista.length >= MAX_ANEXOS_POR_TITULO) throw new ErroDoAnexo(`Esta conta já tem ${MAX_ANEXOS_POR_TITULO} anexos. Tire um antes de pôr outro.`);
  return gravarLista(exec, tenantId, tabela, id, [...lista, anexo]);
}

/** Tira um anexo da lista (o arquivo fica guardado: o histórico continua apontando para ele). */
export async function tirarAnexoDoTitulo(
  exec: ExecutorSQL, tenantId: string, tabela: TabelaDoTitulo, id: string, url: string,
): Promise<{ anexos: Anexo[]; _versao: string }> {
  const { rows } = await exec.query(`SELECT data FROM ${tabela} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  if (!rows[0]) throw new ErroDoAnexo('Esta conta não existe mais. Recarregue a lista.', 404);
  const d = rows[0].data as Record<string, unknown>;
  const lista = anexosDe(d);
  if (!lista.some(a => a.url === url)) throw new ErroDoAnexo('Este anexo já não está na conta.', 404);
  // O comprovante da baixa não sai por aqui: ele é a prova do pagamento.
  if (txt(d.comprovante) && txt(d.comprovante) === url) throw new ErroDoAnexo('Este é o comprovante da baixa: ele só sai estornando a baixa.', 409);
  return gravarLista(exec, tenantId, tabela, id, lista.filter(a => a.url !== url));
}

async function gravarLista(
  exec: ExecutorSQL, tenantId: string, tabela: TabelaDoTitulo, id: string, lista: Anexo[],
): Promise<{ anexos: Anexo[]; _versao: string }> {
  const { rows } = await exec.query(
    `UPDATE ${tabela} SET data = jsonb_set(data, '{anexos}', $3::jsonb, true), updated_at = clock_timestamp()
      WHERE id = $1 AND tenant_id = $2
      RETURNING (FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000000))::bigint::text AS v`,
    [id, tenantId, JSON.stringify(lista)],
  );
  return { anexos: lista, _versao: txt(rows[0]?.v) };
}

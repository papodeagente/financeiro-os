/**
 * Conferência do extrato da operadora (E6, 05/11/2026): o lado do servidor.
 * A regra está em conferencia-operadora.ts; aqui é ler o arquivo, achar as
 * vendas, gravar a conferência e as decisões das pessoas.
 *
 *  - LEITURA UMA VEZ SÓ: a leitura da IA é guardada pelo hash do arquivo no
 *    mesmo lugar do "Ler boleto ou nota" (leituras_de_documento), com a chave
 *    `operadora:<hash>` para nunca se misturar com a leitura de boleto do
 *    mesmo PDF. O mesmo arquivo de novo = a mesma leitura, sem custo.
 *  - NADA GRAVA SEM CONFIRMAR: ler devolve uma prévia. A conferência só nasce
 *    quando a pessoa confirma, e a gravação relê a leitura guardada pelo hash
 *    (nunca as linhas que a tela mandou).
 *  - O MESMO ARQUIVO não vira duas conferências.
 *  - CANCELAMENTO é proposta: a conferência nunca mexe na venda nem nas contas.
 *  - FECHAR trava a conferência; reabrir pede motivo.
 *
 * Não importa nada do Next: os testes rodam contra um Postgres real.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { generateId } from './utils';
import { hojeISO, num, paraBRL, paraCentavos } from './money';
import type { ItemVendaData } from './crm-types';
import { calcularComissao } from './venda-financeiro';
import { lerPlanilha, decodificarTexto } from './migracao/leitor';
import { detectarTipo } from './arquivos';
import type { MimeLegivel } from './leitura-documento-ia';
import type { ConteudoParaLer } from './conferencia-operadora-ia';
import {
  casarLinha, comissaoPorOperadora, compararLinha, conferirLinhas, normalizarLocalizador, podeFechar, linhaResolvida, sinalDoTipo,
  type ComissaoDaOperadora, type Diferenca, type ExtratoLido, type ItemParaCasar, type LinhaLida, type PropostaDeCancelamento,
  type Situacao, type TipoDeLinha,
} from './conferencia-operadora';
import { registrarComissoesDoExtrato } from './fornecedor-servidor';

export class ErroConferencia extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = 'ErroConferencia';
  }
}

/** Chave da leitura guardada: separada da leitura de boleto do mesmo arquivo. */
export function chaveDaLeitura(hashDoArquivo: string): string {
  return `operadora:${hashDoArquivo}`;
}

const MAX_TEXTO = 400_000;
export const MAX_ARQUIVO = 10 * 1024 * 1024;

/** `crm`: o extrato de comissão que o CRM leu na Conciliação e mandou (E7 frente E). */
export type OrigemDoExtrato = 'pdf' | 'imagem' | 'planilha' | 'csv' | 'email' | 'crm';

/** O que fica guardado da leitura (pelo hash): o extrato limpo e de onde ele veio. */
export interface LeituraGuardada { extrato: ExtratoLido; origem: OrigemDoExtrato }

/** A leitura guardada deste arquivo, se já foi lida (e só desta agência). */
export async function leituraGuardada(exec: ExecutorSQL, tenantId: string, hash: string): Promise<{ leitura: LeituraGuardada; nome: string } | null> {
  const { rows } = await exec.query(
    `SELECT extracao, nome_original FROM leituras_de_documento WHERE tenant_id = $1 AND hash = $2 AND estado = 'pronto'`,
    [tenantId, chaveDaLeitura(hash)],
  );
  const l = rows[0]?.extracao as LeituraGuardada | undefined;
  if (!l || !l.extrato || !Array.isArray(l.extrato.linhas)) return null;
  return { leitura: l, nome: String(rows[0].nome_original ?? '') };
}

/**
 * O que a IA vai ler: PDF e foto como estão; planilha (XLSX, XLS, ODS) e CSV
 * viram texto com as colunas separadas por tabulação, aba por aba.
 */
export function conteudoDoArquivo(nome: string, bytes: Uint8Array): { conteudo: ConteudoParaLer; origem: OrigemDoExtrato } {
  if (bytes.length === 0) throw new ErroConferencia('O arquivo está vazio.');
  if (bytes.length > MAX_ARQUIVO) throw new ErroConferencia('O arquivo tem mais de 10MB. Envie um período menor.', 413);
  const ext = (nome.split('.').pop() ?? '').toLowerCase();
  const tipo = detectarTipo(bytes, ext);
  const mimes: Record<string, MimeLegivel> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  if (tipo && mimes[tipo.ext]) {
    if (tipo.ext !== 'pdf' && bytes.length > 5 * 1024 * 1024) throw new ErroConferencia('A foto tem mais de 5MB. Envie o PDF ou uma foto menor.', 413);
    return {
      conteudo: { tipo: 'arquivo', mime: mimes[tipo.ext], base64: Buffer.from(bytes).toString('base64') },
      origem: tipo.ext === 'pdf' ? 'pdf' : 'imagem',
    };
  }
  if (['xlsx', 'xls', 'ods', 'csv', 'txt'].includes(ext)) {
    let texto: string;
    if (ext === 'csv' || ext === 'txt') {
      texto = decodificarTexto(bytes).texto;
    } else {
      try {
        const planilha = lerPlanilha(nome, bytes);
        texto = planilha.abas
          .map(aba => `## ${aba.nome}\n${aba.linhas.map(l => l.map(c => (c === null || c === undefined ? '' : String(c))).join('\t')).filter(l => l.trim()).join('\n')}`)
          .join('\n\n');
      } catch {
        throw new ErroConferencia('Não deu para abrir esta planilha. Salve como XLSX ou CSV e envie de novo.', 415);
      }
    }
    if (!texto.trim()) throw new ErroConferencia('O arquivo não tem linhas.');
    if (texto.length > MAX_TEXTO) throw new ErroConferencia('O extrato é grande demais para uma leitura. Envie um período menor.', 413);
    return { conteudo: { tipo: 'texto', texto, origem: ext === 'csv' || ext === 'txt' ? 'csv' : 'planilha' }, origem: ext === 'csv' || ext === 'txt' ? 'csv' : 'planilha' };
  }
  throw new ErroConferencia('Aceito PDF, foto, planilha (XLSX, XLS, ODS) ou CSV. Para e-mail, cole o texto.', 415);
}

// ── As vendas que podem casar ─────────────────────────────────────────────

type Dados = Record<string, unknown>;

/**
 * Itens de venda candidatos: os que têm um localizador do extrato (no item ou
 * no produto da venda) e os das vendas perto das datas do extrato (para casar
 * pelo passageiro quando a linha não traz localizador).
 */
export async function carregarItensParaCasar(
  exec: ExecutorSQL, tenantId: string, e: ExtratoLido, opcoes: { itemIds?: string[] } = {},
): Promise<ItemParaCasar[]> {
  const locs = [...new Set(e.linhas.map(l => l.localizador).filter(l => l.length >= 5))];
  const datas = e.linhas.map(l => l.data).filter((d): d is string => !!d).sort();
  const de = datas[0] ?? e.periodo_de ?? null;
  const ate = datas[datas.length - 1] ?? e.periodo_ate ?? null;
  const { rows } = await exec.query(
    `SELECT i.id AS item_id, i.venda_id, i.fornecedor_id, i.data AS item, v.data AS venda, COALESCE(v.data->>'status', v.status) AS venda_status
       FROM itens_venda i
       JOIN vendas_crm v ON v.id = i.venda_id AND v.tenant_id = i.tenant_id
      WHERE i.tenant_id = $1 AND COALESCE(i.status, 'ativo') = 'ativo'
        AND (
          upper(regexp_replace(COALESCE(i.data->>'localizador', ''), '[^A-Za-z0-9]', '', 'g')) = ANY($2::text[])
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.data->'produtos') = 'array' THEN v.data->'produtos' ELSE '[]'::jsonb END) p
                      WHERE upper(regexp_replace(COALESCE(p->>'localizador', ''), '[^A-Za-z0-9]', '', 'g')) = ANY($2::text[]))
          OR ($3::text IS NOT NULL AND COALESCE(v.data->>'data_venda', '') BETWEEN to_char($3::date - 180, 'YYYY-MM-DD') AND to_char($4::date + 30, 'YYYY-MM-DD'))
          OR i.id = ANY($5::text[])
        )
      LIMIT 5000`,
    [tenantId, locs, de, ate ?? de, opcoes.itemIds ?? []],
  );
  if (rows.length === 0) return [];
  const itemIds = rows.map(r => String(r.item_id));
  const { rows: pagar } = await exec.query(
    `SELECT id, data FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_item_id' = ANY($2::text[])
        AND COALESCE(data->>'status', '') <> 'CANCELADO'`,
    [tenantId, itemIds],
  );
  const { rows: comissoes } = await exec.query(
    `SELECT id, data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_item_id' = ANY($2::text[])
        AND data->>'origem' = 'COMISSAO_FORNECEDOR' AND COALESCE(data->>'status', '') <> 'CANCELADO'`,
    [tenantId, itemIds],
  );
  const pagarDo = new Map(pagar.map(p => [String((p.data as Dados).origem_item_id), p]));
  const comissaoDo = new Map(comissoes.map(c => [String((c.data as Dados).origem_item_id), c]));
  const v2 = await contasDaVendaCompleta(exec, tenantId, rows);
  return rows.map(r => {
    const item = (r.item ?? {}) as ItemVendaData & Dados;
    const venda = (r.venda ?? {}) as Dados;
    const moeda = item.moeda || 'BRL';
    const cambio = num(item.cambio) || 1;
    const produtos = Array.isArray(venda.produtos) ? (venda.produtos as Dados[]) : [];
    const localizadores = [...new Set([
      normalizarLocalizador(item.localizador),
      ...produtos
        .filter(p => !p.id || p.id === r.item_id || p.id === item.produto_id || produtos.length === 1 || String(p.fornecedor_id ?? '') === String(r.fornecedor_id ?? ''))
        .map(p => normalizarLocalizador(p.localizador)),
    ].filter(l => l.length >= 5))];
    const passageiros = [
      ...(Array.isArray(venda.passageiros) ? (venda.passageiros as Dados[]).map(p => String(p.nome ?? '')) : []),
      String(venda.cliente_nome ?? ''),
    ].filter(Boolean);
    // Venda completa (E5): as contas são por pessoa do acerto, e a pessoa é
    // o representante quando há (é ele quem manda o extrato).
    const doV2 = v2.get(String(r.item_id));
    const cp = doV2 ? doV2.pagar : pagarDo.get(String(r.item_id));
    const cc = doV2 ? doV2.comissao : comissaoDo.get(String(r.item_id));
    const comissaoItem = paraBRL(calcularComissao(item, undefined).comissao_valor, moeda, cambio);
    const ccDados = (cc?.data ?? {}) as Dados;
    const cpDados = (cp?.data ?? {}) as Dados;
    const custoDoItem = paraBRL(num(item.valor_custo), moeda, cambio);
    const contaSoDoItem = (d: Dados) => !doV2 || (Array.isArray(d.venda_produtos) && (d.venda_produtos as unknown[]).length === 1);
    return {
      item_id: String(r.item_id),
      venda_id: String(r.venda_id),
      venda_numero: String(venda.numero ?? ''),
      venda_status: String(r.venda_status ?? '').toUpperCase(),
      data_venda: String(venda.data_venda ?? '').slice(0, 10),
      data_servico: String(item.data_inicio ?? '').slice(0, 10),
      localizadores,
      passageiros,
      fornecedor_id: doV2?.parte_id || String(r.fornecedor_id ?? ''),
      fornecedor_nome: doV2?.parte_nome || String(item.fornecedor_nome ?? ''),
      meio: item.meio_pagamento === 'fornecedor' ? 'fornecedor' : 'proprio',
      custo_centavos: paraCentavos(cp && contaSoDoItem(cpDados) ? num(cpDados.valor_final) : custoDoItem),
      venda_centavos: paraCentavos(paraBRL(num(item.valor_venda), moeda, cambio)),
      comissao_centavos: paraCentavos(cc && contaSoDoItem(ccDados) ? num(ccDados.valor_final) : comissaoItem),
      conta_pagar: cp ? { id: String(cp.id), valor_centavos: paraCentavos(num(cpDados.valor_final)), status: String(cpDados.status ?? '') } : null,
      conta_comissao: cc ? {
        id: String(cc.id), valor_centavos: paraCentavos(num(ccDados.valor_final)), status: String(ccDados.status ?? ''),
        recebido_centavos: ['RECEBIDO', 'PARCIAL'].includes(String(ccDados.status ?? '')) ? paraCentavos(num(ccDados.valor_recebido) || (ccDados.status === 'RECEBIDO' ? num(ccDados.valor_final) : 0)) : 0,
      } : null,
    } satisfies ItemParaCasar;
  });
}

interface ContasDoItemV2 {
  parte_id: string;
  parte_nome: string;
  pagar: Dados | undefined;
  comissao: Dados | undefined;
}

/**
 * Venda completa (E5, modelo 2): o item de venda é derivado de um produto
 * (`data.produto_id`), e as contas são da PESSOA DO ACERTO (representante,
 * senão fornecedor), por venda: `v2:forn:…` a pagar e `v2:comissao:…` a
 * receber, com a lista dos produtos que cobrem (`venda_produtos`). Devolve,
 * por item, a conta de cada lado que cobre aquele produto e quem é a pessoa.
 */
async function contasDaVendaCompleta(exec: ExecutorSQL, tenantId: string, rows: Dados[]): Promise<Map<string, ContasDoItemV2>> {
  const saida = new Map<string, ContasDoItemV2>();
  const itens = rows
    .map(r => ({ r, item: (r.item ?? {}) as Dados }))
    .filter(x => Number(x.item.modelo_venda) === 2 && String(x.item.produto_id ?? ''));
  if (itens.length === 0) return saida;
  const vendas = [...new Set(itens.map(x => String(x.r.venda_id)))];
  // Conta que entrou na fatura do fornecedor fica cancelada, mas continua dizendo o custo.
  const { rows: pagar } = await exec.query(
    `SELECT id, data FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_venda_id' = ANY($2::text[])
        AND data->>'origem_item_id' LIKE 'v2:forn:%'
        AND (COALESCE(data->>'status', '') <> 'CANCELADO' OR COALESCE(data->>'fatura_fornecedor_id', '') <> '')`,
    [tenantId, vendas],
  );
  const { rows: receber } = await exec.query(
    `SELECT id, data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = ANY($2::text[])
        AND data->>'origem_item_id' LIKE 'v2:comissao:%' AND data->>'origem' = 'COMISSAO_FORNECEDOR'
        AND COALESCE(data->>'status', '') <> 'CANCELADO'`,
    [tenantId, vendas],
  );
  const representantes = new Map<string, { id: string; nome: string }>();
  const { rows: temTabela } = await exec.query(`SELECT to_regclass('public.venda_produtos') IS NOT NULL AS ok`);
  if (temTabela[0]?.ok === true) {
    const { rows: ps } = await exec.query(
      `SELECT venda_id, id, representante_id, representante_nome FROM venda_produtos WHERE tenant_id = $1 AND venda_id = ANY($2::text[])`,
      [tenantId, vendas],
    );
    for (const p of ps) {
      if (String(p.representante_id ?? '') || String(p.representante_nome ?? '')) {
        representantes.set(`${p.venda_id}|${p.id}`, { id: String(p.representante_id ?? ''), nome: String(p.representante_nome ?? '') });
      }
    }
  }
  const cobre = (c: Dados, vendaId: string, produtoId: string) => {
    const d = (c.data ?? {}) as Dados;
    return String(d.origem_venda_id ?? '') === vendaId && Array.isArray(d.venda_produtos) && (d.venda_produtos as unknown[]).map(String).includes(produtoId);
  };
  for (const { r, item } of itens) {
    const vendaId = String(r.venda_id);
    const produtoId = String(item.produto_id);
    // A conta mais recente primeiro (o complemento depois da original não muda a pessoa).
    const cp = pagar.find(c => cobre(c, vendaId, produtoId) && !String(((c.data ?? {}) as Dados).origem_item_id ?? '').includes(':complemento'))
      ?? pagar.find(c => cobre(c, vendaId, produtoId));
    const cc = receber.find(c => cobre(c, vendaId, produtoId));
    const rep = representantes.get(`${vendaId}|${produtoId}`);
    const daConta = (cp?.data ?? cc?.data ?? null) as Dados | null;
    saida.set(String(r.item_id), {
      parte_id: rep?.id || String(daConta?.fornecedor_id ?? '') || String(r.fornecedor_id ?? ''),
      parte_nome: rep?.nome || String(daConta?.fornecedor_nome ?? '') || String(item.fornecedor_nome ?? ''),
      pagar: cp, comissao: cc,
    });
  }
  return saida;
}

// ── Prévia e gravação ─────────────────────────────────────────────────────

export async function conferenciaDoArquivo(exec: ExecutorSQL, tenantId: string, hash: string): Promise<{ id: string; status: string } | null> {
  const { rows } = await exec.query(`SELECT id, status FROM conferencias_operadora WHERE tenant_id = $1 AND arquivo_hash = $2`, [tenantId, hash]);
  return rows[0] ? { id: String(rows[0].id), status: String(rows[0].status) } : null;
}

export async function previaDaConferencia(
  exec: ExecutorSQL, tenantId: string, e: ExtratoLido, operadora: { id?: string; nome?: string } | null,
) {
  const itens = await carregarItensParaCasar(exec, tenantId, e);
  const r = conferirLinhas(e, itens, operadora);
  return {
    checagem: { avisos: r.checagem.avisos, soma: r.checagem.soma, soma_confere: r.checagem.soma_confere },
    resumo: r.resumo,
    linhas: r.linhas.map(l => ({
      ordem: l.ordem, ...l.lida, valido: l.checagem.valido, motivos_invalida: l.checagem.motivos,
      situacao: l.comparacao.situacao, como_casou: l.casamento.como, ambiguos: l.casamento.ambiguos,
      venda_id: l.casamento.item?.venda_id ?? '', venda_numero: l.casamento.item?.venda_numero ?? '',
      diferencas: l.comparacao.diferencas, proposta: l.comparacao.proposta,
    })),
  };
}

export interface QuemConfere { usuarioId?: string; usuarioNome?: string }

/**
 * Grava a conferência a partir da leitura guardada. `extrato` vem da leitura
 * (a rota relê pelo hash), nunca do corpo da requisição.
 */
export async function criarConferencia(
  exec: ExecutorSQL,
  tenantId: string,
  args: {
    hash: string; extrato: ExtratoLido; arquivo_nome: string; origem: OrigemDoExtrato;
    fornecedor_id: string; fornecedor_nome: string; periodo_de?: string | null; periodo_ate?: string | null; quem: QuemConfere;
  },
): Promise<{ id: string }> {
  const ja = await conferenciaDoArquivo(exec, tenantId, args.hash);
  if (ja) throw new ErroConferencia('Este arquivo já foi conferido. Abra a conferência que existe.', 409);
  const nome = args.fornecedor_nome.trim() || args.extrato.operadora_nome;
  if (!nome) throw new ErroConferencia('Diga de qual operadora é o extrato.');
  const e: ExtratoLido = {
    ...args.extrato,
    periodo_de: args.periodo_de || args.extrato.periodo_de,
    periodo_ate: args.periodo_ate || args.extrato.periodo_ate,
  };
  const itens = await carregarItensParaCasar(exec, tenantId, e);
  const r = conferirLinhas(e, itens, { id: args.fornecedor_id, nome });
  const id = generateId();
  await exec.query(
    `INSERT INTO conferencias_operadora (id, tenant_id, arquivo_hash, arquivo_nome, origem, fornecedor_id, fornecedor_nome, operadora_cnpj,
                                         periodo_de, periodo_ate, total_bruto_centavos, total_comissao_centavos, total_liquido_centavos,
                                         soma_liquido_centavos, avisos, criada_por, criada_por_nome, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11,$12,$13,$14,$15::jsonb,$16,$17,$18::jsonb)`,
    [id, tenantId, args.hash, args.arquivo_nome.slice(0, 160), args.origem, args.fornecedor_id, nome.slice(0, 160), e.operadora_cnpj,
      e.periodo_de, e.periodo_ate, e.total_bruto_centavos, e.total_comissao_centavos, e.total_liquido_centavos,
      r.checagem.soma.liquido, JSON.stringify(r.checagem.avisos), args.quem.usuarioId ?? null, args.quem.usuarioNome ?? null,
      JSON.stringify({ nome: `Extrato ${nome}${e.periodo_de ? ` ${e.periodo_de}` : ''}` })],
  );
  for (const l of r.linhas) {
    await exec.query(
      `INSERT INTO conferencias_operadora_linhas (id, tenant_id, conferencia_id, ordem, data, localizador, passageiro, descricao, tipo,
                                                  bruto_centavos, taxas_centavos, comissao_centavos, liquido_centavos, valido, motivos_invalida,
                                                  situacao, como_casou, ambiguos, venda_id, venda_numero, item_id, diferencas,
                                                  comissao_esperada_centavos, proposta, proposta_status)
       VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21,$22::jsonb,$23,$24::jsonb,$25)`,
      [generateId(), tenantId, id, l.ordem, l.lida.data, l.lida.localizador, l.lida.passageiro, l.lida.descricao, l.lida.tipo,
        l.lida.bruto_centavos, l.lida.taxas_centavos, l.lida.comissao_centavos, l.lida.liquido_centavos, l.checagem.valido,
        JSON.stringify(l.checagem.motivos), l.comparacao.situacao, l.casamento.como, l.casamento.ambiguos,
        l.casamento.item?.venda_id ?? '', l.casamento.item?.venda_numero ?? '', l.casamento.item?.item_id ?? '',
        JSON.stringify(l.comparacao.diferencas), l.comparacao.comissao_esperada_centavos,
        l.comparacao.proposta ? JSON.stringify(l.comparacao.proposta) : null, l.comparacao.proposta ? 'proposta' : null],
    );
  }
  await sincronizarComissoesDoExtrato(exec, tenantId, id);
  return { id };
}

/** Referência estável da linha no registro de comissões do fornecedor. */
export function referenciaDaLinha(conferenciaId: string, ordem: number): string {
  return `conferencia:${conferenciaId}:${ordem}`;
}

/**
 * O que a operadora diz que pagou de comissão vai para o lado do fornecedor
 * (E5, parte C: "Comissão de fornecedores" mostra "No extrato"). Uma linha
 * por linha do extrato com comissão (venda soma, cancelamento devolve),
 * ligada à venda casada. Refeito inteiro a cada mudança de casamento (criar,
 * ligar à mão, casar de novo), para a venda de cada linha acompanhar.
 * Sem o cadastro da operadora (ou sem a tabela, em base antiga), não grava.
 */
export async function sincronizarComissoesDoExtrato(exec: ExecutorSQL, tenantId: string, conferenciaId: string): Promise<number> {
  const { rows: tem } = await exec.query(`SELECT to_regclass('public.fornecedor_extrato_comissoes') IS NOT NULL AS ok`);
  if (tem[0]?.ok !== true) return 0;
  const { rows: cab } = await exec.query(
    `SELECT fornecedor_id, periodo_de::text AS de, periodo_ate::text AS ate, created_at::text AS criada FROM conferencias_operadora WHERE tenant_id = $1 AND id = $2`,
    [tenantId, conferenciaId],
  );
  if (!cab.length) return 0;
  await exec.query(
    `DELETE FROM fornecedor_extrato_comissoes WHERE tenant_id = $1 AND origem = 'extrato' AND referencia LIKE $2`,
    [tenantId, `conferencia:${conferenciaId}:%`],
  );
  const parteId = String(cab[0].fornecedor_id ?? '');
  if (!parteId) return 0;
  const reserva = String(cab[0].ate ?? '') || String(cab[0].de ?? '') || String(cab[0].criada ?? '').slice(0, 10) || hojeISO();
  const { rows } = await exec.query(
    `SELECT ordem, data::text AS data_txt, localizador, tipo, comissao_centavos, venda_id FROM conferencias_operadora_linhas
      WHERE tenant_id = $1 AND conferencia_id = $2 AND tipo IN ('venda', 'cancelamento') AND COALESCE(comissao_centavos, 0) <> 0 ORDER BY ordem`,
    [tenantId, conferenciaId],
  );
  return registrarComissoesDoExtrato(exec, tenantId, rows.map(r => ({
    parte_id: parteId,
    data: String(r.data_txt ?? '') || reserva,
    valor_centavos: sinalDoTipo(String(r.tipo) as TipoDeLinha) * Number(r.comissao_centavos),
    venda_id: String(r.venda_id ?? '') || null,
    localizador: String(r.localizador ?? ''),
    referencia: referenciaDaLinha(conferenciaId, Number(r.ordem)),
    origem: 'extrato' as const,
  })));
}

// ── Ler ───────────────────────────────────────────────────────────────────

export interface ConferenciaNaTela {
  id: string;
  arquivo_nome: string;
  origem: string;
  fornecedor_id: string;
  fornecedor_nome: string;
  periodo_de: string | null;
  periodo_ate: string | null;
  status: 'ABERTA' | 'FECHADA';
  total_liquido_centavos: number | null;
  soma_liquido_centavos: number;
  avisos: string[];
  criada_em: string;
  criada_por_nome: string | null;
  fechada_em: string | null;
  fechada_por: string | null;
  reaberta_motivo: string | null;
  contagem: { CONFERIDO: number; DIVERGENTE: number; NAO_ENCONTRADO: number; resolvidas: number; total: number; propostas: number };
}

export interface LinhaNaTela {
  id: string;
  ordem: number;
  data: string | null;
  localizador: string;
  passageiro: string;
  descricao: string;
  tipo: TipoDeLinha;
  bruto_centavos: number | null;
  taxas_centavos: number | null;
  comissao_centavos: number | null;
  liquido_centavos: number | null;
  valido: boolean;
  motivos_invalida: string[];
  situacao: Situacao;
  como_casou: string;
  ambiguos: number;
  venda_id: string;
  venda_numero: string;
  item_id: string;
  diferencas: Diferenca[];
  comissao_esperada_centavos: number;
  comissao_recebida_centavos: number;
  tem_conta_de_comissao: boolean;
  proposta: PropostaDeCancelamento | null;
  proposta_status: 'proposta' | 'descartada' | 'resolvida' | null;
  aceita_motivo: string | null;
  aceita_por: string | null;
  resolvida: boolean;
}

const nulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function conferenciaDe(r: Dados, contagem: ConferenciaNaTela['contagem']): ConferenciaNaTela {
  return {
    id: String(r.id), arquivo_nome: String(r.arquivo_nome ?? ''), origem: String(r.origem ?? ''),
    fornecedor_id: String(r.fornecedor_id ?? ''), fornecedor_nome: String(r.fornecedor_nome ?? ''),
    periodo_de: (r.de_txt as string | null) ?? null, periodo_ate: (r.ate_txt as string | null) ?? null,
    status: r.status === 'FECHADA' ? 'FECHADA' : 'ABERTA',
    total_liquido_centavos: nulo(r.total_liquido_centavos), soma_liquido_centavos: Number(r.soma_liquido_centavos ?? 0),
    avisos: Array.isArray(r.avisos) ? (r.avisos as string[]) : [],
    criada_em: String(r.criada_txt ?? ''), criada_por_nome: (r.criada_por_nome as string | null) ?? null,
    fechada_em: (r.fechada_txt as string | null) ?? null, fechada_por: (r.fechada_por as string | null) ?? null,
    reaberta_motivo: (r.reaberta_motivo as string | null) ?? null,
    contagem,
  };
}

const COLUNAS_CONFERENCIA = `*, periodo_de::text AS de_txt, periodo_ate::text AS ate_txt, created_at::text AS criada_txt, fechada_em::text AS fechada_txt`;

export async function listarConferencias(exec: ExecutorSQL, tenantId: string): Promise<ConferenciaNaTela[]> {
  const { rows } = await exec.query(
    `SELECT ${COLUNAS_CONFERENCIA} FROM conferencias_operadora WHERE tenant_id = $1 ORDER BY periodo_de DESC NULLS LAST, created_at DESC LIMIT 300`,
    [tenantId],
  );
  if (rows.length === 0) return [];
  const { rows: cont } = await exec.query(
    `SELECT conferencia_id, situacao, valido, aceita_motivo IS NOT NULL AS aceita, proposta_status
       FROM conferencias_operadora_linhas WHERE tenant_id = $1 AND conferencia_id = ANY($2::text[])`,
    [tenantId, rows.map(r => String(r.id))],
  );
  return rows.map(r => {
    const c = { CONFERIDO: 0, DIVERGENTE: 0, NAO_ENCONTRADO: 0, resolvidas: 0, total: 0, propostas: 0 };
    for (const l of cont) {
      if (l.conferencia_id !== r.id) continue;
      c.total += 1;
      c[l.situacao as Situacao] += 1;
      if (l.proposta_status === 'proposta') c.propostas += 1;
      if (linhaResolvida({ situacao: l.situacao as Situacao, valido: l.valido === true, aceita: l.aceita === true, proposta_pendente: l.proposta_status === 'proposta' })) c.resolvidas += 1;
    }
    return conferenciaDe(r, c);
  });
}

async function travarConferencia(exec: ExecutorSQL, tenantId: string, id: string, paraMudar: boolean): Promise<Dados> {
  const { rows } = await exec.query(
    `SELECT ${COLUNAS_CONFERENCIA} FROM conferencias_operadora WHERE id = $1 AND tenant_id = $2${paraMudar ? ' FOR UPDATE' : ''}`,
    [id, tenantId],
  );
  if (rows.length === 0) throw new ErroConferencia('Conferência não encontrada.', 404);
  if (paraMudar && rows[0].status === 'FECHADA') throw new ErroConferencia('Esta conferência está fechada. Reabra para mudar.', 409);
  return rows[0];
}

/**
 * A conta de comissão de uma linha: na venda de antes, a do item
 * (`origem_item_id`); na venda completa (E5), a da pessoa do acerto naquela
 * venda que cobre o produto do item (o item é `<venda>:<produto>`).
 */
const COMISSAO_DA_LINHA = `(c.data->>'origem_item_id' = l.item_id
  OR (l.venda_id <> '' AND c.data->>'origem_venda_id' = l.venda_id AND c.data->>'origem_item_id' LIKE 'v2:comissao:%'
      AND jsonb_typeof(c.data->'venda_produtos') = 'array'
      AND c.data->'venda_produtos' ? substr(l.item_id, length(l.venda_id) + 2)))`;

async function linhasDaConferencia(exec: ExecutorSQL, tenantId: string, id: string): Promise<LinhaNaTela[]> {
  const { rows } = await exec.query(
    `SELECT l.*, l.data::text AS data_txt,
            COALESCE((SELECT CASE WHEN c.data->>'status' IN ('RECEBIDO','PARCIAL')
                                  THEN round(COALESCE(NULLIF(c.data->>'valor_recebido','')::numeric,
                                                      CASE WHEN c.data->>'status' = 'RECEBIDO' THEN (c.data->>'valor_final')::numeric ELSE 0 END) * 100)
                                  ELSE 0 END
                        FROM contas_receber c
                       WHERE c.tenant_id = l.tenant_id AND l.item_id <> '' AND ${COMISSAO_DA_LINHA}
                         AND c.data->>'origem' = 'COMISSAO_FORNECEDOR' AND COALESCE(c.data->>'status','') <> 'CANCELADO'
                       LIMIT 1), 0) AS recebido,
            EXISTS (SELECT 1 FROM contas_receber c WHERE c.tenant_id = l.tenant_id AND l.item_id <> '' AND ${COMISSAO_DA_LINHA}
                       AND c.data->>'origem' = 'COMISSAO_FORNECEDOR' AND COALESCE(c.data->>'status','') <> 'CANCELADO') AS tem_comissao
       FROM conferencias_operadora_linhas l
      WHERE l.tenant_id = $1 AND l.conferencia_id = $2 ORDER BY l.ordem`,
    [tenantId, id],
  );
  return rows.map(r => {
    const proposta_status = (r.proposta_status as LinhaNaTela['proposta_status']) ?? null;
    const base = {
      id: String(r.id), ordem: Number(r.ordem), data: (r.data_txt as string | null) ?? null,
      localizador: String(r.localizador ?? ''), passageiro: String(r.passageiro ?? ''), descricao: String(r.descricao ?? ''),
      tipo: String(r.tipo) as TipoDeLinha,
      bruto_centavos: nulo(r.bruto_centavos), taxas_centavos: nulo(r.taxas_centavos), comissao_centavos: nulo(r.comissao_centavos), liquido_centavos: nulo(r.liquido_centavos),
      valido: r.valido === true, motivos_invalida: Array.isArray(r.motivos_invalida) ? (r.motivos_invalida as string[]) : [],
      situacao: String(r.situacao) as Situacao, como_casou: String(r.como_casou ?? ''), ambiguos: Number(r.ambiguos ?? 0),
      venda_id: String(r.venda_id ?? ''), venda_numero: String(r.venda_numero ?? ''), item_id: String(r.item_id ?? ''),
      diferencas: Array.isArray(r.diferencas) ? (r.diferencas as Diferenca[]) : [],
      comissao_esperada_centavos: Number(r.comissao_esperada_centavos ?? 0),
      comissao_recebida_centavos: Number(r.recebido ?? 0), tem_conta_de_comissao: r.tem_comissao === true,
      proposta: (r.proposta as PropostaDeCancelamento | null) ?? null, proposta_status,
      aceita_motivo: (r.aceita_motivo as string | null) ?? null, aceita_por: (r.aceita_por as string | null) ?? null,
    };
    return {
      ...base,
      resolvida: linhaResolvida({ situacao: base.situacao, valido: base.valido, aceita: !!base.aceita_motivo, proposta_pendente: proposta_status === 'proposta' }),
    };
  });
}

async function anteriorAberta(exec: ExecutorSQL, tenantId: string, c: Dados): Promise<{ periodo_de: string | null } | null> {
  if (!c.de_txt) return null;
  const { rows } = await exec.query(
    `SELECT periodo_de::text AS de FROM conferencias_operadora
      WHERE tenant_id = $1 AND id <> $2 AND status = 'ABERTA' AND periodo_de < $3::date
        AND ((fornecedor_id <> '' AND fornecedor_id = $4) OR lower(fornecedor_nome) = lower($5))
      ORDER BY periodo_de LIMIT 1`,
    [tenantId, c.id, c.de_txt, String(c.fornecedor_id ?? ''), String(c.fornecedor_nome ?? '')],
  );
  return rows[0] ? { periodo_de: (rows[0].de as string | null) ?? null } : null;
}

export async function detalheDaConferencia(exec: ExecutorSQL, tenantId: string, id: string) {
  const c = await travarConferencia(exec, tenantId, id, false);
  const linhas = await linhasDaConferencia(exec, tenantId, id);
  const contagem = { CONFERIDO: 0, DIVERGENTE: 0, NAO_ENCONTRADO: 0, resolvidas: 0, total: linhas.length, propostas: 0 };
  for (const l of linhas) {
    contagem[l.situacao] += 1;
    if (l.resolvida) contagem.resolvidas += 1;
    if (l.proposta_status === 'proposta') contagem.propostas += 1;
  }
  const fechar = podeFechar(
    linhas.map(l => ({ ordem: l.ordem, situacao: l.situacao, valido: l.valido, aceita: !!l.aceita_motivo, proposta_pendente: l.proposta_status === 'proposta' })),
    await anteriorAberta(exec, tenantId, c),
  );
  const comissao = comissaoPorOperadora(linhas
    .filter(l => l.item_id && (l.tipo === 'venda' || l.tipo === 'cancelamento' || l.tipo === 'reembolso'))
    .map(l => ({
      operadora: String(c.fornecedor_nome ?? ''), tipo: l.tipo, comissao_informada_centavos: l.comissao_centavos,
      comissao_esperada_centavos: l.comissao_esperada_centavos, comissao_recebida_centavos: l.comissao_recebida_centavos,
      tem_conta_de_comissao: l.tem_conta_de_comissao,
    })));
  return { conferencia: conferenciaDe(c, contagem), linhas, fechar, comissao: comissao[0] ?? null };
}

/** Comissão esperada × informada × recebida, por operadora, nas conferências do período. */
export async function comissaoGeral(exec: ExecutorSQL, tenantId: string, de: string | null, ate: string | null): Promise<ComissaoDaOperadora[]> {
  const { rows } = await exec.query(
    `SELECT c.id FROM conferencias_operadora c
      WHERE c.tenant_id = $1 AND ($2::date IS NULL OR c.periodo_ate IS NULL OR c.periodo_ate >= $2::date)
        AND ($3::date IS NULL OR c.periodo_de IS NULL OR c.periodo_de <= $3::date)`,
    [tenantId, de, ate],
  );
  const todas: Parameters<typeof comissaoPorOperadora>[0][number][] = [];
  for (const r of rows) {
    const d = await detalheDaConferencia(exec, tenantId, String(r.id));
    for (const l of d.linhas) {
      if (!l.item_id || !(l.tipo === 'venda' || l.tipo === 'cancelamento' || l.tipo === 'reembolso')) continue;
      todas.push({
        operadora: d.conferencia.fornecedor_nome, tipo: l.tipo, comissao_informada_centavos: l.comissao_centavos,
        comissao_esperada_centavos: l.comissao_esperada_centavos, comissao_recebida_centavos: l.comissao_recebida_centavos,
        tem_conta_de_comissao: l.tem_conta_de_comissao,
      });
    }
  }
  return comissaoPorOperadora(todas);
}

// ── O que as pessoas decidem ──────────────────────────────────────────────

function lidaDaLinha(r: Dados): LinhaLida {
  return {
    data: (r.data_txt as string | null) ?? null, localizador: String(r.localizador ?? ''), passageiro: String(r.passageiro ?? ''),
    descricao: String(r.descricao ?? ''), tipo: String(r.tipo) as TipoDeLinha,
    bruto_centavos: nulo(r.bruto_centavos), taxas_centavos: nulo(r.taxas_centavos), comissao_centavos: nulo(r.comissao_centavos), liquido_centavos: nulo(r.liquido_centavos),
  };
}

async function travarLinha(exec: ExecutorSQL, tenantId: string, conferenciaId: string, linhaId: string): Promise<Dados> {
  const { rows } = await exec.query(
    `SELECT *, data::text AS data_txt FROM conferencias_operadora_linhas WHERE id = $1 AND tenant_id = $2 AND conferencia_id = $3 FOR UPDATE`,
    [linhaId, tenantId, conferenciaId],
  );
  if (rows.length === 0) throw new ErroConferencia('Linha não encontrada.', 404);
  return rows[0];
}

async function regravarComparacao(exec: ExecutorSQL, tenantId: string, linhaId: string, l: LinhaLida, item: ItemParaCasar | null, como: string, statusAnterior: string | null) {
  const comp = compararLinha(l, item);
  // Proposta já decidida (descartada) não volta; resolvida quando a venda foi cancelada.
  const proposta_status = comp.proposta ? (statusAnterior === 'descartada' ? 'descartada' : 'proposta') : (statusAnterior === 'proposta' ? 'resolvida' : statusAnterior);
  await exec.query(
    `UPDATE conferencias_operadora_linhas
        SET situacao = $3, como_casou = $4, ambiguos = 0, venda_id = $5, venda_numero = $6, item_id = $7, diferencas = $8::jsonb,
            comissao_esperada_centavos = $9, proposta = $10::jsonb, proposta_status = $11, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    [linhaId, tenantId, comp.situacao, item ? como : 'nenhum', item?.venda_id ?? '', item?.venda_numero ?? '', item?.item_id ?? '',
      JSON.stringify(comp.diferencas), comp.comissao_esperada_centavos, comp.proposta ? JSON.stringify(comp.proposta) : null, proposta_status],
  );
}

/**
 * Ações numa linha: aceitar (com motivo), tirar o aceite, ligar à venda à
 * mão, descartar a proposta de cancelamento.
 */
export async function acaoNaLinha(
  exec: ExecutorSQL, tenantId: string, conferenciaId: string, linhaId: string,
  acao: 'aceitar' | 'desfazer_aceite' | 'ligar' | 'descartar_proposta',
  dados: { motivo?: string; item_id?: string }, quem: QuemConfere,
): Promise<void> {
  await travarConferencia(exec, tenantId, conferenciaId, true);
  const r = await travarLinha(exec, tenantId, conferenciaId, linhaId);
  const motivo = String(dados.motivo ?? '').trim();
  const nome = quem.usuarioNome || quem.usuarioId || '';
  if (acao === 'aceitar') {
    if (motivo.length < 3) throw new ErroConferencia('Escreva por que esta linha está certa assim.');
    await exec.query(
      `UPDATE conferencias_operadora_linhas SET aceita_motivo = $3, aceita_por = $4, aceita_em = NOW(), updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [linhaId, tenantId, motivo.slice(0, 300), nome],
    );
    return;
  }
  if (acao === 'desfazer_aceite') {
    await exec.query(
      `UPDATE conferencias_operadora_linhas SET aceita_motivo = NULL, aceita_por = NULL, aceita_em = NULL, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [linhaId, tenantId],
    );
    return;
  }
  if (acao === 'descartar_proposta') {
    if (r.proposta_status !== 'proposta') throw new ErroConferencia('Esta linha não tem cancelamento proposto.', 409);
    if (motivo.length < 3) throw new ErroConferencia('Escreva por que o cancelamento não vale para a venda.');
    await exec.query(
      `UPDATE conferencias_operadora_linhas SET proposta_status = 'descartada', aceita_motivo = $3, aceita_por = $4, aceita_em = NOW(), updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [linhaId, tenantId, `Cancelamento não aplicado: ${motivo}`.slice(0, 300), nome],
    );
    return;
  }
  if (acao === 'ligar') {
    const itemId = String(dados.item_id ?? '');
    if (!itemId) throw new ErroConferencia('Escolha a venda.');
    const lida = lidaDaLinha(r);
    const candidatos = await carregarItensParaCasar(exec, tenantId, {
      operadora_nome: '', operadora_cnpj: '', periodo_de: null, periodo_ate: null,
      total_bruto_centavos: null, total_comissao_centavos: null, total_liquido_centavos: null, linhas: [],
    }, { itemIds: [itemId] });
    const item = candidatos.find(i => i.item_id === itemId) ?? null;
    if (!item) throw new ErroConferencia('Venda não encontrada.', 404);
    await regravarComparacao(exec, tenantId, linhaId, lida, item, 'manual', (r.proposta_status as string | null) ?? null);
    await sincronizarComissoesDoExtrato(exec, tenantId, conferenciaId);
    return;
  }
  throw new ErroConferencia('Ação desconhecida.');
}

/**
 * Casa de novo as linhas que não foram decididas à mão (a venda pode ter
 * chegado do CRM depois, ou ter sido cancelada): proposta de cancelamento
 * cuja venda já foi cancelada vira "resolvida".
 */
export async function recasarConferencia(exec: ExecutorSQL, tenantId: string, conferenciaId: string): Promise<{ mudaram: number }> {
  const c = await travarConferencia(exec, tenantId, conferenciaId, true);
  const { rows } = await exec.query(
    `SELECT *, data::text AS data_txt FROM conferencias_operadora_linhas WHERE tenant_id = $1 AND conferencia_id = $2 ORDER BY ordem FOR UPDATE`,
    [tenantId, conferenciaId],
  );
  const lidas = rows.map(lidaDaLinha);
  const itens = await carregarItensParaCasar(exec, tenantId, {
    operadora_nome: String(c.fornecedor_nome ?? ''), operadora_cnpj: '', periodo_de: (c.de_txt as string | null) ?? null, periodo_ate: (c.ate_txt as string | null) ?? null,
    total_bruto_centavos: null, total_comissao_centavos: null, total_liquido_centavos: null, linhas: lidas,
  }, { itemIds: rows.filter(r => r.como_casou === 'manual' && r.item_id).map(r => String(r.item_id)) });
  const operadora = { id: String(c.fornecedor_id ?? ''), nome: String(c.fornecedor_nome ?? '') };
  let mudaram = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let item: ItemParaCasar | null;
    let como: string;
    if (r.como_casou === 'manual' && r.item_id) {
      item = itens.find(x => x.item_id === r.item_id) ?? null;
      como = 'manual';
      if (!item) continue;
    } else {
      const cas = casarLinha(lidas[i], itens, operadora);
      item = cas.item;
      como = cas.como;
    }
    const antes = `${r.situacao}|${r.item_id}|${JSON.stringify(r.diferencas)}|${r.proposta_status}`;
    await regravarComparacao(exec, tenantId, String(r.id), lidas[i], item, como, (r.proposta_status as string | null) ?? null);
    const { rows: depois } = await exec.query(`SELECT situacao, item_id, diferencas, proposta_status FROM conferencias_operadora_linhas WHERE id = $1`, [r.id]);
    const d = depois[0];
    if (`${d.situacao}|${d.item_id}|${JSON.stringify(d.diferencas)}|${d.proposta_status}` !== antes) mudaram += 1;
  }
  await sincronizarComissoesDoExtrato(exec, tenantId, conferenciaId);
  return { mudaram };
}

export async function fecharConferencia(exec: ExecutorSQL, tenantId: string, id: string, quem: QuemConfere): Promise<void> {
  await travarConferencia(exec, tenantId, id, true);
  const d = await detalheDaConferencia(exec, tenantId, id);
  if (!d.fechar.ok) throw new ErroConferencia(d.fechar.motivos.join(' '), 409);
  await exec.query(
    `UPDATE conferencias_operadora SET status = 'FECHADA', fechada_em = NOW(), fechada_por = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId, quem.usuarioNome || quem.usuarioId || null],
  );
}

export async function reabrirConferencia(exec: ExecutorSQL, tenantId: string, id: string, motivo: string, quem: QuemConfere): Promise<void> {
  const m = motivo.trim();
  if (m.length < 3) throw new ErroConferencia('Escreva por que a conferência está sendo reaberta.');
  const { rows } = await exec.query(`SELECT status FROM conferencias_operadora WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  if (rows.length === 0) throw new ErroConferencia('Conferência não encontrada.', 404);
  if (rows[0].status !== 'FECHADA') throw new ErroConferencia('Esta conferência já está aberta.', 409);
  await exec.query(
    `UPDATE conferencias_operadora SET status = 'ABERTA', reaberta_em = NOW(), reaberta_por = $3, reaberta_motivo = $4, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId, quem.usuarioNome || quem.usuarioId || null, m.slice(0, 300)],
  );
}

/** Para a tela escolher a venda à mão: itens com o texto no localizador, número da venda ou passageiro. */
export async function buscarItensDeVenda(exec: ExecutorSQL, tenantId: string, termo: string): Promise<{ item_id: string; venda_numero: string; descricao: string; localizador: string; data_venda: string; fornecedor_nome: string }[]> {
  const t = termo.trim();
  if (t.length < 2) return [];
  const loc = normalizarLocalizador(t);
  const { rows } = await exec.query(
    `SELECT i.id, i.data AS item, v.data AS venda FROM itens_venda i JOIN vendas_crm v ON v.id = i.venda_id AND v.tenant_id = i.tenant_id
      WHERE i.tenant_id = $1 AND (
        ($2 <> '' AND upper(regexp_replace(COALESCE(i.data->>'localizador',''), '[^A-Za-z0-9]', '', 'g')) LIKE $2 || '%')
        OR v.data->>'numero' ILIKE '%' || $3 || '%'
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.data->'passageiros') = 'array' THEN v.data->'passageiros' ELSE '[]'::jsonb END) p
                    WHERE p->>'nome' ILIKE '%' || $3 || '%'))
      ORDER BY v.data->>'data_venda' DESC LIMIT 20`,
    [tenantId, loc, t],
  );
  return rows.map(r => {
    const item = (r.item ?? {}) as Dados;
    const venda = (r.venda ?? {}) as Dados;
    return {
      item_id: String(r.id), venda_numero: String(venda.numero ?? ''), descricao: String(item.descricao ?? ''),
      localizador: String(item.localizador ?? ''), data_venda: String(venda.data_venda ?? ''), fornecedor_nome: String(item.fornecedor_nome ?? ''),
    };
  });
}

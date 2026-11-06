/**
 * Notas fiscais por regra no banco (E5, parte E): regras, a grade "Gerar
 * notas", a prévia, a emissão (pela tela e pelos gatilhos, na fila do
 * agendador), o cancelamento sugerido e a configuração.
 *
 * A emissão fala com o MESMO emissor da nota de antes (nfse-emissor.ts), com
 * a mesma regra de ouro: a nota é gravada PROCESSANDO antes de falar com o
 * emissor, e falha de transporte nunca vira REJEITADA (fica "resultado
 * desconhecido", viva, bloqueando outra igual). A chave da geração é única
 * entre as notas vivas: a mesma nota não sai duas vezes nem com duas abas
 * abertas, nem com a tela e o gatilho ao mesmo tempo.
 *
 * Nada aqui cancela nota sozinho: o cancelamento é sugerido.
 */
import pool from './db';
import { generateId } from './utils';
import { hojeISO, round2 } from './money';
import type { ExecutorSQL } from './caixa-atomico';
import { gravarChaveDaAgencia } from './encargos-servidor';
import { nadaSai } from './nada-sai';
import { nadaSaiDaAgencia } from './migracao/estado';
import { enfileirarTarefa, type TarefaReivindicada } from './agendador/fila';
import { janelaDeMinutos, type DefinicaoTarefa } from './agendador/nucleo';
import { nomeDoCliente, documentoDoCliente } from './cliente-nome';
import { enderecoDoCliente } from './cliente-documento';
import { calcularNota, pendenciasParaEmitir } from './nfse-calculo';
import { emissorDaConfig, type CapacidadesEmissor } from './nfse-emissor';
import { carregarConfigFiscal, carregarEmitente, notaAposFalhaDeTransmissao, tomadorDoFornecedor } from './nfse-servico';
import { disponibilidadeDoEnvio } from './nfse-email';
import type { NotaFiscal, TomadorNota } from './nfse-tipos';
import { carregarVenda, lerConfigVenda } from './venda-servidor';
import type { ParteDaVenda } from './venda-modelo';
import { listarRetencoes } from './nota-retencoes-servidor';
import { TRIBUTOS_RETIDOS, type RetencaoDoCliente } from './nota-retencoes';
import {
  ROTULO_DESTINO, analisarVenda, assinaturaDaPrevia, combinacaoDaRegra, normalizarRegra, notaExistenteDe,
  type AnaliseDaVenda, type DestinoDaNota, type EstadoDaVenda, type LinhaDaGrade, type NotaExistente, type NotaPrevista,
  type RegraDaNota, type SugestaoDeCancelamento,
} from './nota-regras';

// ============================================================
// Erros e configuração
// ============================================================

export class ErroNota extends Error {
  constructor(public codigo: string, mensagem: string, public status = 400, public detalhes?: unknown) {
    super(mensagem);
    this.name = 'ErroNota';
  }
}

export interface ConfigNotas {
  /** Os gatilhos das regras emitem sozinhos (desligado: só "Gerar notas"). */
  automatico: boolean;
  /** Pedir ao emissor que mande a nota ao pagante por e-mail. */
  enviar_ao_cliente: boolean;
}

export const CONFIG_NOTAS_PADRAO: ConfigNotas = { automatico: false, enviar_ao_cliente: true };

export function normalizarConfigNotas(v: unknown): ConfigNotas {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    automatico: o.automatico === true,
    enviar_ao_cliente: o.enviar_ao_cliente === undefined ? CONFIG_NOTAS_PADRAO.enviar_ao_cliente : o.enviar_ao_cliente === true,
  };
}

export async function lerConfigNotas(exec: ExecutorSQL, tenantId: string): Promise<ConfigNotas> {
  const { rows } = await exec.query(
    `SELECT data->'notas_config' AS c FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
    [tenantId],
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  return normalizarConfigNotas(rows[0]?.c);
}

export async function gravarConfigNotas(exec: ExecutorSQL, tenantId: string, v: unknown): Promise<ConfigNotas> {
  const c = normalizarConfigNotas(v);
  await gravarChaveDaAgencia(exec, tenantId, 'notas_config', c);
  return c;
}

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));

// ============================================================
// Regras
// ============================================================

export async function listarRegras(exec: ExecutorSQL, tenantId: string): Promise<RegraDaNota[]> {
  const { rows } = await exec.query(
    `SELECT id, ativa, data FROM nota_regras WHERE tenant_id = $1 ORDER BY ativa DESC, data->>'descricao', id`,
    [tenantId],
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  return rows.map(r => normalizarRegra({ ...(r.data as Record<string, unknown>), id: r.id, ativa: r.ativa !== false }).regra);
}

export async function salvarRegra(exec: ExecutorSQL, tenantId: string, entrada: unknown, usuario: { id: string }): Promise<RegraDaNota> {
  const { regra, erros } = normalizarRegra(entrada);
  if (erros.length) throw new ErroNota('DADOS', erros[0].mensagem, 400, erros);
  const combinacao = combinacaoDaRegra(regra);
  if (regra.ativa) {
    const { rows } = await exec.query(
      `SELECT id, data->>'descricao' AS d FROM nota_regras WHERE tenant_id = $1 AND combinacao = $2 AND ativa AND id <> $3`,
      [tenantId, combinacao, regra.id],
    );
    if (rows.length) {
      throw new ErroNota('REGRA_REPETIDA', `Já existe a regra "${txt(rows[0].d)}" para esta mesma combinação. Ajuste a que existe ou mude os filtros desta.`, 409, { id: rows[0].id });
    }
  }
  const id = regra.id || generateId();
  const dados = { ...regra, id };
  await exec.query(
    `INSERT INTO nota_regras (id, tenant_id, ativa, combinacao, data, criado_por) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (id) DO UPDATE SET ativa = EXCLUDED.ativa, combinacao = EXCLUDED.combinacao, data = EXCLUDED.data, updated_at = NOW()
     WHERE nota_regras.tenant_id = EXCLUDED.tenant_id`,
    [id, tenantId, regra.ativa, combinacao, JSON.stringify(dados), usuario.id],
  );
  const { rows } = await exec.query(`SELECT id, ativa, data FROM nota_regras WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!rows.length) throw new ErroNota('NAO_ENCONTRADA', 'Regra não encontrada.', 404);
  return normalizarRegra({ ...(rows[0].data as Record<string, unknown>), id, ativa: rows[0].ativa !== false }).regra;
}

export async function apagarRegra(exec: ExecutorSQL, tenantId: string, id: string): Promise<boolean> {
  const r = await exec.query(`DELETE FROM nota_regras WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return (r.rowCount ?? 0) > 0;
}

// ============================================================
// A venda no banco: notas, estado e análise
// ============================================================

/** As notas (todas as situações) ligadas à venda: as da regra e as por conta. */
export async function notasDaVenda(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<NotaExistente[]> {
  const { rows } = await exec.query(
    `SELECT n.data, c.data->>'origem' AS origem_conta
       FROM notas_fiscais n
       LEFT JOIN contas_receber c ON c.tenant_id = n.tenant_id AND c.id = n.conta_receber_id
      WHERE n.tenant_id = $1
        AND (n.venda_id = $2 OR COALESCE(c.data->>'origem_venda_id', c.data->>'venda_id', '') = $2)
      ORDER BY n.created_at`,
    [tenantId, vendaId],
  );
  return rows.map(r => notaExistenteDe({ ...(r.data as Record<string, unknown>), status: txt((r.data as Record<string, unknown>)?.status) }, txt(r.origem_conta)));
}

/** O que já aconteceu na venda, para os gatilhos. */
export async function estadoDaVenda(exec: ExecutorSQL, tenantId: string, vendaId: string, forcar: { fatura_fechada?: boolean } = {}): Promise<EstadoDaVenda> {
  const { rows: cr } = await exec.query(
    `SELECT data FROM contas_receber WHERE tenant_id = $1 AND (data->>'origem_venda_id' = $2 OR venda_id = $2)`,
    [tenantId, vendaId],
  );
  const { rows: cp } = await exec.query(
    `SELECT data FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`,
    [tenantId, vendaId],
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  const vivas = cr.map(r => r.data as Record<string, unknown>).filter(d => txt(d.status).toUpperCase() !== 'CANCELADO');
  const doCliente = vivas.filter(d => (txt(d.origem) || 'VENDA') === 'VENDA');
  const comissao = new Set<string>();
  for (const d of vivas) {
    if (txt(d.origem) === 'COMISSAO_FORNECEDOR' && txt(d.status).toUpperCase() === 'RECEBIDO') {
      const id = txt(d.venda_parte_id) || txt(d.fornecedor_id) || txt(d.cliente_id);
      if (id) comissao.add(id);
    }
  }
  // A agência pagou o fornecedor já descontando a comissão: está acertada.
  for (const r of cp) {
    const d = r.data as Record<string, unknown>;
    if (txt(d.status).toUpperCase() === 'PAGO' && !txt(d.origem_item_id).startsWith('v2:repasse')) {
      const id = txt(d.venda_parte_id) || txt(d.fornecedor_id);
      if (id) comissao.add(id);
    }
  }
  return {
    cliente_quitado: doCliente.length > 0 && doCliente.every(d => txt(d.status).toUpperCase() === 'RECEBIDO'),
    fatura_fechada: forcar.fatura_fechada === true
      || vivas.some(d => d.faturar === true && Boolean(txt(d.fatura_fechada_em))),
    comissao_acertada: [...comissao],
  };
}

export interface ContextoDaAnalise {
  regras?: RegraDaNota[];
  retencoes?: RetencaoDoCliente[];
  estado?: EstadoDaVenda | null;
}

export interface AnaliseNoBanco extends AnaliseDaVenda {
  venda_id: string;
  venda_cancelada: boolean;
}

export async function analisarVendaNoBanco(exec: ExecutorSQL, tenantId: string, vendaId: string, ctx: ContextoDaAnalise = {}): Promise<AnaliseNoBanco | null> {
  const carregada = await carregarVenda(exec, tenantId, vendaId);
  if (!carregada) return null;
  const { rows } = await exec.query(`SELECT status, data->>'status' AS s FROM vendas_crm WHERE tenant_id = $1 AND id = $2`, [tenantId, vendaId]);
  const st = `${txt(rows[0]?.status)}|${txt(rows[0]?.s)}`.toUpperCase();
  const venda_cancelada = /\bCANCELAD[OA]\b/.test(st);
  const regras = ctx.regras ?? await listarRegras(exec, tenantId);
  const retencoes = ctx.retencoes ?? await listarRetencoes(exec, tenantId);
  const config = await lerConfigVenda(exec, tenantId);
  const notas = await notasDaVenda(exec, tenantId, vendaId);
  const analise = analisarVenda({
    venda: carregada.venda, regras, notas, retencoes, config_receita: config.receita, venda_cancelada, estado: ctx.estado ?? null,
  });
  return { ...analise, venda_id: vendaId, venda_cancelada };
}

// ============================================================
// A grade de "Gerar notas"
// ============================================================

export interface FiltroDaGrade {
  de: string;
  ate: string;
  /** Só linhas com algo a fazer (a emitir, complementar ou acima). */
  so_pendentes?: boolean;
  busca?: string;
}

export interface GradeDeNotas {
  linhas: LinhaDaGrade[];
  cancelar: SugestaoDeCancelamento[];
  totais: { receita: number; valor_notas: number; saldo: number; a_emitir: number };
  /** Vendas do período que ficaram de fora pelo limite. */
  vendas_fora: number;
  tem_regras: boolean;
}

export const LIMITE_DE_VENDAS_NA_GRADE = 300;

export async function gradeDeNotas(exec: ExecutorSQL, tenantId: string, f: FiltroDaGrade): Promise<GradeDeNotas> {
  const { rows } = await exec.query(
    `SELECT id FROM vendas_crm
      WHERE tenant_id = $1
        AND COALESCE(NULLIF(data->>'data_venda', ''), to_char(created_at, 'YYYY-MM-DD')) BETWEEN $2 AND $3
      ORDER BY COALESCE(NULLIF(data->>'data_venda', ''), to_char(created_at, 'YYYY-MM-DD')) DESC, id
      LIMIT $4`,
    [tenantId, f.de, f.ate, LIMITE_DE_VENDAS_NA_GRADE + 1],
  );
  const ids = rows.map(r => txt(r.id)).slice(0, LIMITE_DE_VENDAS_NA_GRADE);
  const regras = await listarRegras(exec, tenantId);
  const retencoes = await listarRetencoes(exec, tenantId);
  const linhas: LinhaDaGrade[] = [];
  const cancelar: SugestaoDeCancelamento[] = [];
  const busca = (f.busca ?? '').trim().toLowerCase();
  for (const id of ids) {
    const a = await analisarVendaNoBanco(exec, tenantId, id, { regras, retencoes });
    if (!a) continue;
    cancelar.push(...a.cancelar);
    for (const l of a.linhas) {
      if (busca && !`${l.venda_numero} ${l.cliente_nome} ${l.produto_descricao}`.toLowerCase().includes(busca)) continue;
      if (f.so_pendentes && !['A_EMITIR', 'COMPLEMENTAR', 'ACIMA', 'CANCELADA', 'SEM_REGRA'].includes(l.situacao)) continue;
      linhas.push(l);
    }
  }
  const soma = (k: 'receita' | 'valor_notas' | 'saldo' | 'a_emitir') => linhas.reduce((s, l) => s + l[k], 0);
  return {
    linhas, cancelar,
    totais: { receita: soma('receita'), valor_notas: soma('valor_notas'), saldo: soma('saldo'), a_emitir: soma('a_emitir') },
    vendas_fora: Math.max(0, rows.length - ids.length),
    tem_regras: regras.some(r => r.ativa),
  };
}

// ============================================================
// Prévia: as notas que vão sair, com tomador completo e pendências
// ============================================================

export interface SelecaoDeNotas {
  venda_id: string;
  /** Produtos marcados na grade. Vazio: a venda inteira. */
  produto_ids?: string[];
}

export interface NotaDaPrevia extends NotaPrevista {
  tomador_nota: TomadorNota | null;
  valida: boolean;
  /** O e-mail ao cliente vai ser pedido ao emissor? E por quê. */
  envio: { pedido: boolean; motivo: string };
  aliquota_iss: number;
  valor_iss: number;
  iss_e_estimativa: boolean;
}

export interface PreviaDeNotas {
  notas: NotaDaPrevia[];
  /** O que impede todas (configuração fiscal, emissor). */
  pendencias_gerais: string[];
  assinatura: string;
  cancelar: SugestaoDeCancelamento[];
}

async function tomadorDaParte(exec: ExecutorSQL, tenantId: string, destino: DestinoDaNota, p: ParteDaVenda | null): Promise<TomadorNota | null> {
  if (!p) return null;
  const ids = [p.id, p.id_externo].filter(Boolean) as string[];
  const procurarCliente = async () => {
    if (!ids.length) return null;
    const { rows } = await exec.query(
      `SELECT data FROM clientes WHERE tenant_id = $1 AND (id = ANY($2::text[]) OR external_id = ANY($2::text[])) LIMIT 1`,
      [tenantId, ids],
    ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
    return (rows[0]?.data ?? null) as Record<string, unknown> | null;
  };
  const procurarFornecedor = async () => {
    if (!ids.length) return null;
    const { rows } = await exec.query(
      `SELECT nome_fantasia, cnpj, data FROM fornecedores_crm WHERE tenant_id = $1 AND (id = ANY($2::text[]) OR crm_supplier_id = ANY($2::text[]) OR external_id = ANY($2::text[])) LIMIT 1`,
      [tenantId, ids],
    ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
    if (!rows[0]) return null;
    const d = (rows[0].data ?? {}) as Record<string, unknown>;
    return { ...d, nome_fantasia: d.nome_fantasia || rows[0].nome_fantasia, cnpj: d.cnpj || rows[0].cnpj };
  };
  if (destino === 'PAGANTE') {
    const c = await procurarCliente();
    if (c) {
      return {
        cpf_cnpj: documentoDoCliente(c) || txt(p.documento), razao_social: nomeDoCliente(c) || p.nome,
        email: txt(c.email), inscricao_municipal: txt(c.inscricao_municipal), endereco: enderecoDoCliente(c),
      };
    }
    const f = await procurarFornecedor();
    if (f) return tomadorDoFornecedor(f);
  } else {
    const f = await procurarFornecedor();
    if (f) return tomadorDoFornecedor(f);
    const c = await procurarCliente();
    if (c) {
      return {
        cpf_cnpj: documentoDoCliente(c) || txt(p.documento), razao_social: nomeDoCliente(c) || p.nome,
        email: txt(c.email), inscricao_municipal: txt(c.inscricao_municipal), endereco: enderecoDoCliente(c),
      };
    }
  }
  return {
    cpf_cnpj: txt(p.documento), razao_social: p.nome, email: '', inscricao_municipal: '',
    endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' },
  };
}

const CAPACIDADES_FECHADAS: CapacidadesEmissor = {
  deducoes: true, aliquota_por_nota: true, intermediario: true,
  retencao_fonte: false, reforma_tributaria: false, nbs: false, email_ao_tomador: false,
};

/** Recorta a nota prevista aos produtos marcados (retenção na mesma proporção). */
function recortar(p: NotaPrevista, produtos: string[] | undefined): NotaPrevista | null {
  if (!produtos?.length) return p;
  const itens = p.itens.filter(i => produtos.includes(i.produto_id));
  if (!itens.length) return null;
  if (itens.length === p.itens.length) return p;
  const valor = itens.reduce((s, i) => s + i.valor_centavos, 0);
  const f = p.valor_centavos > 0 ? valor / p.valor_centavos : 0;
  const retencoes = p.retencoes
    ? (() => {
        const por_tributo = { ...p.retencoes!.por_tributo };
        for (const t of TRIBUTOS_RETIDOS) por_tributo[t] = Math.round(por_tributo[t] * f);
        return { ...p.retencoes!, por_tributo, total: TRIBUTOS_RETIDOS.reduce((s, t) => s + por_tributo[t], 0) };
      })()
    : null;
  return { ...p, itens, valor_centavos: valor, retencoes };
}

export async function previaDeNotas(exec: ExecutorSQL, tenantId: string, selecao: SelecaoDeNotas[], ctx: ContextoDaAnalise & { so_gatilho_cumprido?: boolean; chaves?: string[] } = {}): Promise<PreviaDeNotas> {
  const config = await carregarConfigFiscal(tenantId);
  const emitente = await carregarEmitente(tenantId);
  const configNotas = await lerConfigNotas(exec, tenantId);
  let capacidades = CAPACIDADES_FECHADAS;
  let issEstimativa = false;
  try {
    capacidades = emissorDaConfig(config).capacidades;
    issEstimativa = !capacidades.aliquota_por_nota;
  } catch {
    // Sem emissor: a pendência geral abaixo explica.
  }
  const pendencias_gerais = pendenciasParaEmitir({
    provedor: config.provedor,
    temCertificado: Boolean(config.certificado?.referencia_gateway),
    certificadoValidoAte: config.certificado?.validade_fim,
    hoje: hojeISO(),
    item_lista_servico: config.item_lista_servico,
    cnae: config.cnae,
    aliquota_iss: config.aliquota_iss,
    emitente_cnpj: emitente.cnpj,
    emitente_inscricao_municipal: emitente.inscricao_municipal,
    // O tomador é conferido nota a nota, abaixo.
    tomador_documento: '-', tomador_nome: '-',
    padrao_nacional: config.provedor === 'aceleraapi',
    cod_municipio_ibge: config.cod_municipio_ibge,
    cod_tributacao_nacional: config.cod_tributacao_nacional,
    simples_nacional: config.simples_nacional,
    regime_apuracao: config.regime_apuracao,
  });
  const regras = ctx.regras ?? await listarRegras(exec, tenantId);
  const retencoes = ctx.retencoes ?? await listarRetencoes(exec, tenantId);
  const notas: NotaDaPrevia[] = [];
  const cancelar: SugestaoDeCancelamento[] = [];
  const vistas = new Set<string>();
  for (const s of selecao) {
    if (!s.venda_id || vistas.has(s.venda_id)) continue;
    vistas.add(s.venda_id);
    const estado = ctx.estado !== undefined ? ctx.estado : await estadoDaVenda(exec, tenantId, s.venda_id);
    const a = await analisarVendaNoBanco(exec, tenantId, s.venda_id, { regras, retencoes, estado });
    if (!a) continue;
    cancelar.push(...a.cancelar);
    for (const bruta of a.previstas) {
      const p = recortar(bruta, s.produto_ids);
      if (!p || p.valor_centavos <= 0) continue;
      if (ctx.chaves && !ctx.chaves.includes(p.chave)) continue;
      if (ctx.so_gatilho_cumprido && !p.gatilho_cumprido) continue;
      const tomador = await tomadorDaParte(exec, tenantId, p.destino, p.tomador);
      const pend = [...p.pendencias];
      if (tomador) {
        const daPessoa = p.destino === 'PAGANTE' ? 'O cliente' : p.destino === 'FORNECEDOR' ? 'O fornecedor' : 'O representante';
        if (!tomador.cpf_cnpj.trim()) pend.push(`${daPessoa} "${tomador.razao_social || 'sem nome'}" está sem CPF ou CNPJ no cadastro, e a prefeitura exige o documento do tomador.`);
        if (!tomador.razao_social.trim()) pend.push(`${daPessoa} desta nota está sem nome no cadastro.`);
      }
      if (p.retencoes && p.retencoes.total > 0 && !capacidades.retencao_fonte) {
        pend.push('O cliente retém tributos na fonte e o emissor configurado não declara retenção na nota. Troque o emissor em Configurações › Fiscal ou emita esta nota à mão no portal do emissor.');
      }
      const calc = calcularNota({
        regime: 'PRESTACAO_DIRETA', forma_base: 'VALOR_COMISSAO', valor_recebido: p.valor_centavos / 100,
        valor_total_venda: p.valor_centavos / 100, custo_fornecedores: 0, aliquota_iss: config.aliquota_iss,
        iss_retido: Boolean(p.retencoes?.reter_iss) || config.iss_retido_padrao,
      });
      pend.push(...calc.erros);
      const envioPossivel = disponibilidadeDoEnvio({ emissorEnvia: capacidades.email_ao_tomador, emailDoTomador: tomador?.email });
      const envio = p.destino !== 'PAGANTE'
        ? { pedido: false, motivo: 'A nota ao fornecedor e ao representante não é enviada por e-mail.' }
        : !configNotas.enviar_ao_cliente
          ? { pedido: false, motivo: 'O envio ao cliente está desligado nas regras da nota.' }
          : envioPossivel.liberado
            ? { pedido: true, motivo: `O emissor manda o PDF e o XML para ${tomador?.email} assim que a nota for autorizada.` }
            : { pedido: false, motivo: envioPossivel.motivo };
      notas.push({
        ...p, pendencias: pend, tomador_nota: tomador, valida: pend.length === 0 && pendencias_gerais.length === 0 && Boolean(tomador),
        envio, aliquota_iss: calc.aliquota_iss, valor_iss: Math.round(calc.valor_iss * 100), iss_e_estimativa: issEstimativa,
      });
    }
  }
  return { notas, pendencias_gerais, assinatura: assinaturaDaPrevia(notas), cancelar };
}

// ============================================================
// Emissão
// ============================================================

export interface ResultadoDaEmissao {
  emitidas: NotaFiscal[];
  recusadas: Array<{ chave: string; motivo: string }>;
}

async function gravarNotaNoExecutor(exec: ExecutorSQL, tenantId: string, nota: NotaFiscal): Promise<void> {
  await exec.query(
    `INSERT INTO notas_fiscais (id, tenant_id, conta_receber_id, venda_id, cliente_id, status, referencia_gateway, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, referencia_gateway = EXCLUDED.referencia_gateway, data = EXCLUDED.data, updated_at = NOW()
     WHERE notas_fiscais.tenant_id = EXCLUDED.tenant_id`,
    [nota.id, tenantId, nota.conta_receber_id, nota.venda_id, nota.cliente_id, nota.status, nota.protocolo || '', JSON.stringify(nota)],
  );
}

const reaisDe = (c: number) => round2(c / 100);

/** A NotaFiscal (o formato de sempre) de uma nota prevista. */
export function notaFiscalDaPrevia(p: NotaDaPrevia, config: Awaited<ReturnType<typeof carregarConfigFiscal>>, capacidades: CapacidadesEmissor, autor: string, gatilho: string): NotaFiscal {
  const valor = reaisDe(p.valor_centavos);
  const r = p.retencoes;
  const issRetido = Boolean(r?.reter_iss) || config.iss_retido_padrao;
  const valorIss = reaisDe(p.valor_iss);
  const ret = (t: 'IR' | 'CSLL' | 'PIS' | 'COFINS') => reaisDe(r?.por_tributo[t] ?? 0);
  const totalFederal = reaisDe(r?.total ?? 0);
  const reforma = capacidades.reforma_tributaria;
  return {
    id: generateId(),
    conta_receber_id: '',
    venda_id: p.venda_id,
    cliente_id: p.tomador?.id ?? '',
    tomador: p.tomador_nota!,
    regime: 'INTERMEDIACAO',
    forma_base: 'VALOR_COMISSAO',
    intermediario: null,
    valor_recebido: valor,
    valor_servicos: valor,
    valor_deducoes: 0,
    desconto_incondicionado: 0,
    base_calculo: valor,
    aliquota_iss: p.aliquota_iss,
    valor_iss: valorIss,
    iss_retido: issRetido,
    valor_liquido: Math.max(0, round2(valor - (issRetido ? valorIss : 0) - totalFederal)),
    discriminacao: p.discriminacao,
    item_lista_servico: config.item_lista_servico,
    codigo_tributacao_municipio: config.codigo_tributacao_municipio,
    cnae: config.cnae,
    serie_rps: config.serie_rps,
    enviar_email: p.envio.pedido,
    codigo_nbs: '',
    cst: reforma ? p.ibs_cbs.cst : '',
    classificacao_tributaria: reforma ? p.ibs_cbs.classificacao_tributaria : '',
    indicador_operacao: reforma ? p.ibs_cbs.indicador_operacao : '',
    aliquota_inss: 0,
    valor_inss_retido: 0,
    aliquota_ir: r?.aliquotas_medias.IR ?? 0,
    valor_ir_retido: ret('IR'),
    aliquota_csll: r?.aliquotas_medias.CSLL ?? 0,
    valor_csll_retido: ret('CSLL'),
    aliquota_pis: r?.aliquotas_medias.PIS ?? 0,
    valor_pis_retido: ret('PIS'),
    aliquota_cofins: r?.aliquotas_medias.COFINS ?? 0,
    valor_cofins_retido: ret('COFINS'),
    total_retido: round2(totalFederal + (issRetido ? valorIss : 0)),
    observacoes: p.complementar ? 'Nota complementar.' : '',
    status: 'PROCESSANDO',
    ambiente: config.ambiente,
    numero: '', codigo_verificacao: '', protocolo: '', link_pdf: '', link_xml: '', erro: '',
    emitida_em: new Date().toISOString(),
    autorizada_em: '', cancelada_em: '', motivo_cancelamento: '',
    emitida_por: autor,
    origem: 'REGRA',
    destino: p.destino,
    regra_id: p.regra_id,
    chave_geracao: p.chave,
    itens: p.itens.map(i => ({ produto_id: i.produto_id, descricao: i.descricao, valor_centavos: i.valor_centavos })),
    complementar_de: p.complementar_de,
    gatilho,
    ibs_cbs: {
      cst: p.ibs_cbs.cst, classificacao_tributaria: p.ibs_cbs.classificacao_tributaria, indicador_operacao: p.ibs_cbs.indicador_operacao,
      aliquota_ibs: p.ibs_cbs.aliquota_ibs, aliquota_cbs: p.ibs_cbs.aliquota_cbs, situacao: 'CONFIRMAR_COM_O_CONTADOR',
    },
    ...({ tomador_chave: p.tomador_chave, informacoes: p.informacoes, envio_ao_cliente: p.envio } as Record<string, unknown>),
  } as NotaFiscal;
}

/**
 * Emite as notas da seleção. Recalcula tudo no servidor: os números da tela
 * não valem. Com `assinatura`, a emissão só acontece se a prévia de agora é
 * a mesma que a pessoa viu (senão, 409 com a prévia nova).
 */
export async function emitirNotasDaRegra(
  exec: ExecutorSQL, tenantId: string,
  pedido: { selecao: SelecaoDeNotas[]; chaves?: string[]; assinatura?: string },
  autor: { id: string; nome: string },
  opcoes: { gatilho?: string; so_gatilho_cumprido?: boolean; estado?: EstadoDaVenda | null } = {},
): Promise<ResultadoDaEmissao> {
  const motivo = nadaSai();
  if (motivo) throw new ErroNota('NADA_SAI', `Nenhuma nota sai agora: ${motivo}.`, 423);
  const previa = await previaDeNotas(exec, tenantId, pedido.selecao, {
    chaves: pedido.chaves, so_gatilho_cumprido: opcoes.so_gatilho_cumprido, ...(opcoes.estado !== undefined ? { estado: opcoes.estado } : {}),
  });
  if (pedido.assinatura && pedido.assinatura !== previa.assinatura) {
    throw new ErroNota('PREVIA_MUDOU', 'Os valores mudaram desde a prévia. Confira a prévia nova antes de emitir.', 409, previa);
  }
  if (previa.pendencias_gerais.length) throw new ErroNota('CONFIGURACAO', previa.pendencias_gerais.join(' '), 400, previa.pendencias_gerais);
  // Emissão por empresa (E7): cada nota sai pelo emissor da empresa da venda.
  // Uma empresa só: o emissor de sempre, carregado uma vez.
  const porEmpresa = new Map<string, { config: Awaited<ReturnType<typeof carregarConfigFiscal>>; emitente: Awaited<ReturnType<typeof carregarEmitente>>; emissor: ReturnType<typeof emissorDaConfig> }>();
  const doEmissor = async (empresa: string) => {
    let e = porEmpresa.get(empresa);
    if (!e) {
      const config = await carregarConfigFiscal(tenantId, empresa);
      e = { config, emitente: await carregarEmitente(tenantId, empresa), emissor: emissorDaConfig(config) };
      porEmpresa.set(empresa, e);
    }
    return e;
  };
  const vendasDasNotas = [...new Set(previa.notas.map(p => p.venda_id).filter(Boolean))];
  const empresaDaVenda = new Map<string, string>();
  if (vendasDasNotas.length) {
    const { rows } = await exec.query(
      `SELECT id, COALESCE(NULLIF(data->>'empresa_id', ''), 'principal') AS e FROM vendas_crm WHERE tenant_id = $1 AND id = ANY($2::text[])`,
      [tenantId, vendasDasNotas]);
    for (const r of rows) empresaDaVenda.set(String(r.id), String(r.e));
  }
  const resultado: ResultadoDaEmissao = { emitidas: [], recusadas: [] };
  for (const p of previa.notas) {
    if (!p.valida) { resultado.recusadas.push({ chave: p.chave, motivo: p.pendencias.join(' ') || 'Nota com pendência.' }); continue; }
    let daEmpresa: Awaited<ReturnType<typeof doEmissor>>;
    try {
      daEmpresa = await doEmissor(empresaDaVenda.get(p.venda_id) ?? 'principal');
    } catch (e) {
      resultado.recusadas.push({ chave: p.chave, motivo: e instanceof Error ? e.message : 'O emissor de notas desta empresa não está configurado.' });
      continue;
    }
    const { config, emitente, emissor } = daEmpresa;
    const nota = notaFiscalDaPrevia(p, config, emissor.capacidades, autor.nome || autor.id || 'Sistema', opcoes.gatilho ?? 'tela');
    try {
      await gravarNotaNoExecutor(exec, tenantId, nota);
    } catch (e) {
      if ((e as { code?: string })?.code === '23505') {
        resultado.recusadas.push({ chave: p.chave, motivo: 'Esta nota já foi emitida (outra aba ou o gatilho chegou antes).' });
        continue;
      }
      throw e;
    }
    try {
      const r = await emissor.emitir({ nota, config, emitente });
      const atualizada: NotaFiscal = {
        ...nota, status: r.status, numero: r.numero || nota.numero, codigo_verificacao: r.codigo_verificacao || nota.codigo_verificacao,
        protocolo: r.protocolo || r.referencia || nota.protocolo, link_pdf: r.link_pdf, link_xml: r.link_xml, erro: r.erro,
        autorizada_em: r.status === 'AUTORIZADA' ? new Date().toISOString() : '',
      };
      await gravarNotaNoExecutor(exec, tenantId, atualizada);
      resultado.emitidas.push(atualizada);
    } catch (e) {
      const registrada = notaAposFalhaDeTransmissao(nota, e);
      await gravarNotaNoExecutor(exec, tenantId, registrada);
      if (registrada.status === 'REJEITADA') resultado.recusadas.push({ chave: p.chave, motivo: registrada.erro });
      else resultado.emitidas.push(registrada);
    }
  }
  return resultado;
}

// ============================================================
// Gatilhos: a tarefa do agendador e o processador da fila
// ============================================================

export const TAREFA_NOTA_POR_GATILHO = 'nota_por_gatilho';

/** Erro que pede à fila para tentar de novo mais tarde, sem gastar tentativa. */
class AdiarNota extends Error {
  constructor(public adiarAte: string, mensagem: string) { super(mensagem); }
}

/** Vendas que tiveram dinheiro mexido nos últimos dias (candidatas a gatilho). */
async function vendasComMovimento(exec: ExecutorSQL, tenantId: string): Promise<string[]> {
  const { rows } = await exec.query(
    `SELECT v FROM (
       SELECT COALESCE(NULLIF(data->>'origem_venda_id', ''), NULLIF(venda_id, '')) AS v FROM contas_receber
        WHERE tenant_id = $1 AND updated_at > NOW() - INTERVAL '3 days' AND UPPER(COALESCE(data->>'status', status)) = 'RECEBIDO'
       UNION
       SELECT NULLIF(data->>'origem_venda_id', '') AS v FROM contas_pagar
        WHERE tenant_id = $1 AND updated_at > NOW() - INTERVAL '3 days' AND UPPER(COALESCE(data->>'status', status)) = 'PAGO'
     ) x WHERE v IS NOT NULL ORDER BY v LIMIT 200`,
    [tenantId],
  );
  return rows.map(r => txt(r.v));
}

/** Põe na fila as notas cujo gatilho já aconteceu. Devolve quantas entraram. */
export async function enfileirarNotasDaVenda(exec: ExecutorSQL, tenantId: string, vendaId: string, forcar: { fatura_fechada?: boolean } = {}): Promise<number> {
  const estado = await estadoDaVenda(exec, tenantId, vendaId, forcar);
  const a = await analisarVendaNoBanco(exec, tenantId, vendaId, { estado });
  if (!a) return 0;
  let n = 0;
  for (const p of a.previstas) {
    if (!p.gatilho_cumprido || p.pendencias.length) continue;
    const entrou = await enfileirarTarefa(exec, {
      tenantId, tipo: TAREFA_NOTA_POR_GATILHO, chaveIdem: p.chave,
      dados: { venda_id: vendaId, chave: p.chave, gatilho: p.gatilho, fatura_fechada: forcar.fatura_fechada === true },
    });
    if (entrou) n++;
  }
  return n;
}

/**
 * Chamado pela fatura do cliente ao fechar (parte B): as notas com gatilho
 * "quando a fatura fechar" das vendas dela entram na fila.
 */
export async function aoFecharFatura(exec: ExecutorSQL, tenantId: string, vendaIds: string[]): Promise<number> {
  const config = await lerConfigNotas(exec, tenantId);
  if (!config.automatico) return 0;
  let n = 0;
  for (const v of [...new Set(vendaIds)].filter(Boolean)) n += await enfileirarNotasDaVenda(exec, tenantId, v, { fatura_fechada: true });
  return n;
}

/** Processador da fila: emite UMA nota prevista, se ela ainda é devida. */
export async function processarNotaPorGatilho(t: TarefaReivindicada): Promise<Record<string, unknown>> {
  if (!pool) throw new Error('Banco indisponível');
  const exec = pool as unknown as ExecutorSQL;
  const vendaId = txt(t.dados.venda_id);
  const chave = txt(t.dados.chave) || t.chave_idem;
  const motivo = await nadaSaiDaAgencia(exec, t.tenant_id);
  if (motivo) throw new AdiarNota(new Date(Date.now() + 60 * 60 * 1000).toISOString(), `Nada sai: ${motivo}.`);
  const config = await lerConfigNotas(exec, t.tenant_id);
  if (!config.automatico) return { venda_id: vendaId, pulada: 'emissão automática desligada' };
  const estado = await estadoDaVenda(exec, t.tenant_id, vendaId, { fatura_fechada: t.dados.fatura_fechada === true });
  const previa = await previaDeNotas(exec, t.tenant_id, [{ venda_id: vendaId }], { estado, chaves: [chave], so_gatilho_cumprido: true });
  const nota = previa.notas[0];
  if (!nota) return { venda_id: vendaId, chave, nada_a_emitir: true };
  if (previa.pendencias_gerais.length || !nota.valida) {
    // Volta para a fila e, depois das tentativas, fica para revisão.
    throw new Error([...previa.pendencias_gerais, ...nota.pendencias].join(' ') || 'Nota com pendência.');
  }
  const r = await emitirNotasDaRegra(exec, t.tenant_id, { selecao: [{ venda_id: vendaId }], chaves: [chave] }, { id: '', nome: 'Emissão automática' }, {
    gatilho: nota.gatilho, so_gatilho_cumprido: true, estado,
  });
  if (r.recusadas.length && !r.emitidas.length) throw new Error(r.recusadas.map(x => x.motivo).join(' '));
  return { venda_id: vendaId, chave, emitidas: r.emitidas.map(n => ({ id: n.id, status: n.status })), recusadas: r.recusadas.length };
}

/**
 * Tarefa do agendador (a cada 15 minutos): nas agências com emissão
 * automática ligada, olha as vendas com dinheiro mexido nos últimos dias e
 * põe na fila as notas cujo gatilho aconteceu. Respeita "nada sai".
 */
export const tarefaNotasPorGatilho: DefinicaoTarefa = {
  nome: 'notas-por-gatilho',
  janela: janelaDeMinutos(15),
  agencias: async ({ exec }) => {
    const { rows } = await exec.query(
      `SELECT DISTINCT r.tenant_id FROM nota_regras r
        WHERE r.ativa AND r.tenant_id <> ''
          AND EXISTS (SELECT 1 FROM jsonb_each(COALESCE(r.data->'destinos', '{}'::jsonb)) d
                       WHERE (d.value->>'ligado')::boolean IS TRUE AND COALESCE(d.value->>'gatilho', 'MANUAL') <> 'MANUAL')
        ORDER BY 1`,
    ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
    return rows.map(r => txt(r.tenant_id));
  },
  executar: async ({ exec }, tenantId) => {
    const motivo = await nadaSaiDaAgencia(exec, tenantId);
    if (motivo) return { na_fila: 0, motivo: `nada sai: ${motivo}` };
    const config = await lerConfigNotas(exec, tenantId);
    if (!config.automatico) return { na_fila: 0, motivo: 'emissão automática desligada' };
    let na_fila = 0;
    const vendas = await vendasComMovimento(exec, tenantId);
    for (const v of vendas) na_fila += await enfileirarNotasDaVenda(exec, tenantId, v);
    return { vendas: vendas.length, na_fila };
  },
};

/** Para a tela: o rótulo do destino da nota já emitida. */
export function rotuloDoDestinoDaNota(n: Pick<NotaFiscal, 'destino'>): string {
  return n.destino ? ROTULO_DESTINO[n.destino] : 'Por conta a receber';
}

/**
 * Núcleo da cobrança no servidor (E3, 05/11/2026).
 *
 * Caminho de uma cobrança:
 * 1. prévia → gravar: a linha nasce como `emitindo` (índice único: uma
 *    cobrança valendo por conta), dentro de uma transação;
 * 2. emissão: uma só = na hora; várias = pela fila do agendador, 2 chamadas
 *    por segundo por agência, com disjuntor por agência × provedor;
 * 3. o aviso do provedor (aviso.ts) baixa a conta sozinho.
 *
 * Nada de rede dentro de transação: a chamada ao provedor acontece entre
 * duas gravações curtas. A primeira marca a tentativa (`tentativas`); se a
 * resposta se perde (timeout), a próxima tentativa CONSULTA pela referência
 * antes de criar — o Asaas não tem chave de idempotência.
 */
import { createHash } from 'node:crypto';
import pool from '../db';
import { emTransacao, type ExecutorSQL } from '../caixa-atomico';
import { addDias, deCentavos, hojeISO } from '../money';
import { generateId } from '../utils';
import { nadaSai } from '../nada-sai';
import { carregarCredenciais } from '../plataformas/servico';
import { enfileirarTarefa, type TarefaReivindicada } from '../agendador/fila';
import { horaDeBrasilia } from '../agendador/nucleo';
import { criarAdapterAsaas } from './asaas';
import { criarAdapterPagarme, CAPACIDADES_PAGARME } from './pagarme';
import { CAPACIDADES_ASAAS } from './asaas';
import { aguardarVez } from './limitador';
import { ambienteDeCobranca } from './http';
import { referenciaDaCobranca, referenciaDoCarne } from './referencia';
import { encargosDaCobranca, lerConfigCobranca, type CanalCobranca, type ConfigCobranca } from './config';
import {
  codigoDoMotivo, comoAlterar, conferirCarne, descricaoPeloModelo, faltasDoCliente, planejarItem, resumoParaConta, tipoRecusado,
  type ItemPlanejado,
} from './calculo';
import { avisarCrm, crmLigado, type CobrancaParaCrm } from './crm';
import {
  ErroCobranca, ErroProvedor, ehProvedorCobranca, STATUS_EM_ABERTO,
  type AdapterCobranca, type CapacidadesCobranca, type ClienteDaCobranca, type CobrancaNoProvedor,
  type EncargosDaCobranca, type MudancaDeCobranca, type PedidoDeCobranca, type ProvedorCobranca,
  type StatusCobranca, type TipoCobranca, type TipoEmissao,
} from './tipos';

export const TAREFA_EMITIR = 'cobranca_emitir';
export const TAREFA_ATUALIZAR = 'cobranca_atualizar';

/** Disjuntor por agência × provedor: 5 falhas seguidas param as chamadas por 15 minutos. */
export const FALHAS_PARA_ABRIR_DISJUNTOR = 5;
export const MINUTOS_DISJUNTOR_COBRANCA = 15;
/** Conta já vencida: a cobrança sai com vencimento daqui a N dias (a prévia avisa). */
export const DIAS_PARA_VENCIDAS = 3;

export function capacidadesDe(provedor: ProvedorCobranca): CapacidadesCobranca {
  return provedor === 'asaas' ? CAPACIDADES_ASAAS : CAPACIDADES_PAGARME;
}

export function nomeDoProvedor(provedor: string): string {
  return provedor === 'asaas' ? 'Asaas' : provedor === 'pagarme' ? 'Pagar.me' : provedor;
}

export function hojeEmBrasilia(agora = new Date()): string {
  return horaDeBrasilia(agora).data;
}

// ---------------------------------------------------------------------------
// Linha da cobrança

export interface LinhaCobranca {
  id: string;
  tenant_id: string;
  titulo_tabela: string;
  titulo_id: string;
  cliente_id: string | null;
  provedor: ProvedorCobranca;
  id_externo: string | null;
  referencia: string;
  tipo: TipoCobranca;
  status: StatusCobranca;
  valor_centavos: number;
  vencimento: string;
  descricao: string;
  linha_digitavel: string;
  codigo_barras: string;
  pix_copia_cola: string;
  pix_qrcode_url: string;
  url_boleto: string;
  url_fatura: string;
  url_link: string;
  carne_id: string | null;
  carne_parcela: number | null;
  carne_id_externo: string | null;
  conta_bancaria_id: string | null;
  encargos: EncargosDaCobranca | null;
  pago_centavos: number | null;
  taxa_centavos: number | null;
  pago_em: string | null;
  baixa_id: string | null;
  tentativas: number;
  erro: string | null;
  substitui_id: string | null;
  dados: Record<string, unknown>;
  criado_por: string | null;
  criado_por_nome: string | null;
  criado_em: string;
  atualizado_em: string;
}

/** As colunas da cobrança, com datas em texto; `p` prefixa a tabela (ex.: 'c.'). */
function colunas(p = ''): string {
  return `${p}id, ${p}tenant_id, ${p}titulo_tabela, ${p}titulo_id, ${p}cliente_id, ${p}provedor, ${p}id_externo, ${p}referencia,
  ${p}tipo, ${p}status, ${p}valor_centavos, ${p}vencimento::text AS vencimento, ${p}descricao, ${p}linha_digitavel, ${p}codigo_barras,
  ${p}pix_copia_cola, ${p}pix_qrcode_url, ${p}url_boleto, ${p}url_fatura, ${p}url_link, ${p}carne_id, ${p}carne_parcela,
  ${p}carne_id_externo, ${p}conta_bancaria_id, ${p}encargos, ${p}pago_centavos, ${p}taxa_centavos, ${p}pago_em::text AS pago_em,
  ${p}baixa_id, ${p}tentativas, ${p}erro, ${p}substitui_id, ${p}dados, ${p}criado_por, ${p}criado_por_nome,
  ${p}criado_em::text AS criado_em, ${p}atualizado_em::text AS atualizado_em`;
}
const COLUNAS = colunas();
export const COLUNAS_DA_COBRANCA = COLUNAS;

export function lerLinha(r: Record<string, unknown>): LinhaCobranca {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(r.id), tenant_id: String(r.tenant_id), titulo_tabela: String(r.titulo_tabela), titulo_id: String(r.titulo_id),
    cliente_id: (r.cliente_id as string | null) ?? null, provedor: String(r.provedor) as ProvedorCobranca,
    id_externo: (r.id_externo as string | null) ?? null, referencia: String(r.referencia), tipo: String(r.tipo) as TipoCobranca,
    status: String(r.status) as StatusCobranca, valor_centavos: Number(r.valor_centavos ?? 0),
    vencimento: String(r.vencimento ?? '').slice(0, 10), descricao: String(r.descricao ?? ''),
    linha_digitavel: String(r.linha_digitavel ?? ''), codigo_barras: String(r.codigo_barras ?? ''),
    pix_copia_cola: String(r.pix_copia_cola ?? ''), pix_qrcode_url: String(r.pix_qrcode_url ?? ''),
    url_boleto: String(r.url_boleto ?? ''), url_fatura: String(r.url_fatura ?? ''), url_link: String(r.url_link ?? ''),
    carne_id: (r.carne_id as string | null) ?? null, carne_parcela: n(r.carne_parcela),
    carne_id_externo: (r.carne_id_externo as string | null) ?? null, conta_bancaria_id: (r.conta_bancaria_id as string | null) || null,
    encargos: (r.encargos as EncargosDaCobranca | null) ?? null, pago_centavos: n(r.pago_centavos), taxa_centavos: n(r.taxa_centavos),
    pago_em: (r.pago_em as string | null) ?? null, baixa_id: (r.baixa_id as string | null) ?? null,
    tentativas: Number(r.tentativas ?? 0), erro: (r.erro as string | null) ?? null, substitui_id: (r.substitui_id as string | null) ?? null,
    dados: (r.dados ?? {}) as Record<string, unknown>, criado_por: (r.criado_por as string | null) ?? null,
    criado_por_nome: (r.criado_por_nome as string | null) ?? null, criado_em: String(r.criado_em ?? ''), atualizado_em: String(r.atualizado_em ?? ''),
  };
}

export async function carregarCobranca(exec: ExecutorSQL, tenantId: string, id: string, travar = false): Promise<LinhaCobranca | null> {
  const { rows } = await exec.query(
    `SELECT ${COLUNAS} FROM cobrancas WHERE tenant_id = $1 AND id = $2${travar ? ' FOR UPDATE' : ''}`,
    [tenantId, id],
  );
  return rows.length ? lerLinha(rows[0]) : null;
}

async function exigirCobranca(exec: ExecutorSQL, tenantId: string, id: string, travar = false): Promise<LinhaCobranca> {
  const c = await carregarCobranca(exec, tenantId, id, travar);
  if (!c) throw new ErroCobranca('Cobrança não encontrada.', 404);
  return c;
}

export interface QuemFez { usuarioId?: string | null; usuarioNome?: string | null }

export async function registrarEvento(
  exec: ExecutorSQL, tenantId: string, cobrancaId: string, tipo: string,
  de: StatusCobranca | null, para: StatusCobranca | null, detalhe: Record<string, unknown> = {}, quem: QuemFez = {},
): Promise<void> {
  await exec.query(
    `INSERT INTO cobranca_eventos (id, tenant_id, cobranca_id, tipo, de_status, para_status, detalhe, usuario_id, usuario_nome)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [generateId(), tenantId, cobrancaId, tipo, de, para, JSON.stringify(detalhe), quem.usuarioId ?? null, quem.usuarioNome ?? null],
  );
}

/**
 * Reflete a cobrança na conta a receber: o resumo (`cobranca`) para listas e
 * filtros, e os campos de boleto que as telas antigas já leem.
 */
export async function marcarNaConta(exec: ExecutorSQL, c: LinhaCobranca): Promise<void> {
  const valendo = STATUS_EM_ABERTO.includes(c.status) || c.status === 'paga';
  await exec.query(
    `UPDATE contas_receber
        SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
              'cobranca', $3::jsonb,
              'boleto_emitido', $4::boolean,
              'boleto_codigo', $5::text,
              'boleto_url', $6::text),
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    [c.titulo_id, c.tenant_id, JSON.stringify(resumoParaConta(c)), valendo && c.status !== 'emitindo',
      valendo ? c.linha_digitavel : '', valendo ? (c.url_boleto || c.url_fatura || c.url_link) : ''],
  );
}

// ---------------------------------------------------------------------------
// Disjuntor por agência × provedor

export async function disjuntorAbertoAte(exec: ExecutorSQL, tenantId: string, provedor: string): Promise<string | null> {
  const { rows } = await exec.query(
    `SELECT aberto_ate::text AS ate FROM cobranca_disjuntor
      WHERE tenant_id = $1 AND provedor = $2 AND aberto_ate IS NOT NULL AND aberto_ate > NOW()`,
    [tenantId, provedor],
  );
  return (rows[0]?.ate as string | undefined) ?? null;
}

export async function registrarSucessoNoDisjuntor(exec: ExecutorSQL, tenantId: string, provedor: string): Promise<void> {
  await exec.query(
    `INSERT INTO cobranca_disjuntor (tenant_id, provedor, falhas_seguidas, aberto_ate, ultimo_erro, atualizado_em)
     VALUES ($1, $2, 0, NULL, NULL, NOW())
     ON CONFLICT (tenant_id, provedor) DO UPDATE SET falhas_seguidas = 0, aberto_ate = NULL, atualizado_em = NOW()`,
    [tenantId, provedor],
  );
}

export async function registrarFalhaNoDisjuntor(
  exec: ExecutorSQL, tenantId: string, provedor: string, erro: string, esperarSegundos: number | null = null,
): Promise<void> {
  await exec.query(
    `INSERT INTO cobranca_disjuntor (tenant_id, provedor, falhas_seguidas, ultimo_erro, aberto_ate, atualizado_em)
     VALUES ($1, $2, 1, $3, CASE WHEN $4::int IS NOT NULL THEN NOW() + ($4::int || ' seconds')::interval END, NOW())
     ON CONFLICT (tenant_id, provedor) DO UPDATE SET
       falhas_seguidas = cobranca_disjuntor.falhas_seguidas + 1,
       ultimo_erro = EXCLUDED.ultimo_erro,
       atualizado_em = NOW(),
       aberto_ate = CASE
         WHEN $4::int IS NOT NULL THEN GREATEST(COALESCE(cobranca_disjuntor.aberto_ate, NOW()), NOW() + ($4::int || ' seconds')::interval)
         WHEN cobranca_disjuntor.falhas_seguidas + 1 >= ${FALHAS_PARA_ABRIR_DISJUNTOR}
           THEN NOW() + INTERVAL '${MINUTOS_DISJUNTOR_COBRANCA} minutes'
         ELSE cobranca_disjuntor.aberto_ate END`,
    [tenantId, provedor, erro.slice(0, 1000), esperarSegundos != null ? Math.ceil(esperarSegundos) : null],
  );
}

/** Erro que a fila entende como "tente de novo depois desta hora, sem gastar tentativa". */
export class AdiarTarefa extends Error {
  readonly adiarAte: string;
  constructor(ate: string, motivo: string) {
    super(motivo);
    this.name = 'AdiarTarefa';
    this.adiarAte = ate;
  }
}

// ---------------------------------------------------------------------------
// Provedor da agência

/** Fábrica do adapter (trocável nos testes). */
export type FabricaDeAdapter = (provedor: ProvedorCobranca, tenantId: string, config: ConfigCobranca) => Promise<AdapterCobranca>;

const fabricaPadrao: FabricaDeAdapter = async (provedor, tenantId, config) => {
  const conf = await carregarCredenciais(tenantId, provedor);
  if (!conf || !conf.config.ativo || !conf.cred.api_key) {
    throw new ErroCobranca(`Ligue a integração com o ${nomeDoProvedor(provedor)} em Configurações › Integrações antes de emitir.`, 409, 'PROVEDOR_DESLIGADO');
  }
  const antesDeChamar = () => aguardarVez(tenantId);
  return provedor === 'asaas'
    ? criarAdapterAsaas({ apiKey: conf.cred.api_key, notificacoesDoProvedor: config.notificacoes_do_provedor, antesDeChamar })
    : criarAdapterPagarme({ secretKey: conf.cred.api_key, contaPsp: config.pagarme_conta_psp, antesDeChamar });
};

let fabrica: FabricaDeAdapter = fabricaPadrao;

/** Troca a fábrica de adapters (testes). Devolve a função que desfaz. */
export function definirFabricaDeAdapter(f: FabricaDeAdapter): () => void {
  const antes = fabrica;
  fabrica = f;
  return () => { fabrica = antes; };
}

export function adapterDaAgencia(provedor: ProvedorCobranca, tenantId: string, config: ConfigCobranca): Promise<AdapterCobranca> {
  return fabrica(provedor, tenantId, config);
}

/** Conta bancária da integração (onde o dinheiro do provedor cai). */
async function contaDaIntegracao(tenantId: string, provedor: ProvedorCobranca): Promise<string | null> {
  try {
    const conf = await carregarCredenciais(tenantId, provedor);
    return conf?.config.conta_bancaria_id || null;
  } catch {
    return null;
  }
}

/** Onde a baixa entra: a conta escolhida em Cobrança, senão a da integração. */
export async function contaDaCobranca(tenantId: string, provedor: ProvedorCobranca, config: ConfigCobranca): Promise<string | null> {
  return config.conta_bancaria_id || await contaDaIntegracao(tenantId, provedor);
}

// ---------------------------------------------------------------------------
// Cliente

export async function clienteDaConta(exec: ExecutorSQL, tenantId: string, clienteId: string, nomeNaConta: string): Promise<ClienteDaCobranca> {
  const { rows } = clienteId
    ? await exec.query(`SELECT id, nome, cpf_cnpj, data FROM clientes WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, clienteId])
    : { rows: [] as Record<string, unknown>[] };
  const r = rows[0];
  const d = ((r?.data ?? {}) as Record<string, unknown>);
  const txt = (v: unknown) => String(v ?? '').trim();
  const endereco = txt(d.cep) || txt(d.logradouro)
    ? {
        cep: txt(d.cep), logradouro: txt(d.logradouro), numero: txt(d.numero), complemento: txt(d.complemento),
        bairro: txt(d.bairro), cidade: txt(d.cidade), uf: txt(d.estado || d.uf),
      }
    : null;
  return {
    id: clienteId,
    nome: txt(r?.nome) || txt(d.nome_completo) || txt(d.razao_social) || txt(nomeNaConta),
    documento: (txt(r?.cpf_cnpj) || txt(d.cpf) || txt(d.cnpj)).replace(/\D/g, ''),
    email: txt(d.email),
    telefone: (txt(d.whatsapp) || txt(d.telefone_principal) || txt(d.telefone)).replace(/\D/g, ''),
    endereco,
  };
}

// ---------------------------------------------------------------------------
// Prévia e gravação

export interface PedidoDeEmissao {
  itens: Array<{ conta_id: string; vencimento?: string }>;
  provedor?: ProvedorCobranca;
  tipo?: TipoEmissao | 'link' | 'carne';
  /** Contas já vencidas saem com este vencimento (senão, a prévia pede uma data). */
  vencimento_vencidas?: string;
  /** Texto da cobrança; vazio = a descrição da conta. */
  descricao?: string;
}

export interface ItemDaPrevia extends ItemPlanejado {
  ok: boolean;
}

export interface PreviaDeEmissao {
  provedor: ProvedorCobranca;
  tipo: TipoCobranca;
  capacidades: CapacidadesCobranca;
  conta_bancaria_id: string | null;
  itens: ItemDaPrevia[];
  prontas: number;
  com_erro: number;
  total_centavos: number;
  total: number;
  encargos: EncargosDaCobranca | null;
  assinatura: string;
}

function assinar(partes: unknown): string {
  return createHash('sha256').update(JSON.stringify(partes)).digest('hex').slice(0, 32);
}

function descricaoDa(config: ConfigCobranca, agencia: string, pedida: string | undefined, it: ItemPlanejado): string {
  return descricaoPeloModelo(config.descricao_modelo, { descricao: it.descricao, parcela: it.parcela, agencia, pedida });
}

/** Cobranças já gravadas com esta chave de idempotência (repetição do mesmo pedido). */
async function cobrancasDaChave(exec: ExecutorSQL, tenantId: string, chave: string | undefined): Promise<LinhaCobranca[]> {
  if (!chave) return [];
  const { rows } = await exec.query(
    `SELECT ${COLUNAS} FROM cobrancas WHERE tenant_id = $1 AND dados->>'idempotencia' = $2 ORDER BY carne_parcela NULLS FIRST, criado_em, id`,
    [tenantId, chave.slice(0, 200)],
  );
  return rows.map(lerLinha);
}

/** A prévia: o que sai, por quanto, quando, e o que impede cada conta. */
export async function previaDaEmissao(
  exec: ExecutorSQL, tenantId: string, pedido: PedidoDeEmissao, hoje: string, travar = false,
): Promise<PreviaDeEmissao> {
  const ids = [...new Set((pedido.itens ?? []).map(i => String(i?.conta_id ?? '').trim()).filter(Boolean))];
  if (!ids.length) throw new ErroCobranca('Escolha ao menos uma conta a receber.');
  if (ids.length > 500) throw new ErroCobranca('Até 500 contas por vez.');
  const { config, politica } = await lerConfigCobranca(exec, tenantId);
  const provedor = pedido.provedor ?? (config.provedor_padrao || null);
  if (!ehProvedorCobranca(provedor)) throw new ErroCobranca('Escolha o provedor da cobrança (Asaas ou Pagar.me) em Configurações › Cobrança.', 409, 'SEM_PROVEDOR');
  const caps = capacidadesDe(provedor);
  const tipo: TipoCobranca = pedido.tipo ?? (config.tipo_padrao === 'boleto_pix' && !caps.boletoComPix ? 'boleto' : config.tipo_padrao);
  const recusa = tipoRecusado(caps, nomeDoProvedor(provedor), tipo);
  if (recusa) throw new ErroCobranca(recusa, 409, tipo === 'carne' ? 'SEM_CARNE' : null);

  const { rows } = await exec.query(
    `SELECT cr.id, cr.data,
            EXISTS (SELECT 1 FROM cobrancas c WHERE c.tenant_id = cr.tenant_id AND c.titulo_tabela = 'contas_receber'
                     AND c.titulo_id = cr.id AND c.status IN ('emitindo','aberta','vencida')) AS valendo
       FROM contas_receber cr WHERE cr.tenant_id = $1 AND cr.id = ANY($2::text[])${travar ? ' FOR UPDATE OF cr' : ''}`,
    [tenantId, ids],
  );
  const porId = new Map(rows.map(r => [String(r.id), r]));
  const venc = new Map((pedido.itens ?? []).map(i => [String(i?.conta_id ?? ''), i?.vencimento]));
  const clientes = new Map<string, ClienteDaCobranca>();
  const itens: ItemDaPrevia[] = [];
  for (const id of ids) {
    const r = porId.get(id);
    if (!r) {
      itens.push({ conta_id: id, descricao: '', cliente_id: '', cliente_nome: '', parcela: '', valor_centavos: 0, vencimento: '', erros: ['Conta a receber não encontrada.'], avisos: [], ok: false });
      continue;
    }
    const d = (r.data ?? {}) as Record<string, unknown>;
    const it = planejarItem({ id, dados: d, cobranca_valendo: r.valendo === true }, hoje, {
      vencimento: tipo === 'link' ? addDias(hoje, config.dias_link) : venc.get(id) || undefined,
      // Conta já vencida sai com vencimento daqui a 3 dias (com aviso na prévia), a não ser que a tela peça outra data.
      vencimento_vencidas: pedido.vencimento_vencidas || addDias(hoje, DIAS_PARA_VENCIDAS),
    });
    const chave = it.cliente_id || `nome:${it.cliente_nome}`;
    if (!clientes.has(chave)) clientes.set(chave, await clienteDaConta(exec, tenantId, it.cliente_id, it.cliente_nome));
    const faltas = faltasDoCliente(clientes.get(chave)!, provedor, tipo);
    if (faltas.length) it.erros.push(`Complete o cadastro do cliente: falta ${faltas.join(', ')}.`);
    if (!it.cliente_id) it.erros.push('A conta não está ligada a um cliente cadastrado.');
    itens.push({ ...it, ok: it.erros.length === 0 });
  }
  const prontas = itens.filter(i => i.ok);
  const total_centavos = prontas.reduce((a, i) => a + i.valor_centavos, 0);
  return {
    provedor, tipo, capacidades: caps,
    conta_bancaria_id: await contaDaCobranca(tenantId, provedor, config),
    itens, prontas: prontas.length, com_erro: itens.length - prontas.length,
    total_centavos, total: deCentavos(total_centavos),
    encargos: encargosDaCobranca(config, politica),
    // Independe da ordem em que a tela mandou as contas.
    assinatura: assinar([provedor, tipo, prontas.map(i => [i.conta_id, i.valor_centavos, i.vencimento]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]),
  };
}

export interface ResultadoGravacao {
  /** Null quando o pedido foi uma repetição (nada novo foi conferido). */
  previa: PreviaDeEmissao | null;
  cobrancas: LinhaCobranca[];
  /** Emitidas na fila (lote): a tela acompanha pela lista. */
  na_fila: number;
  /** Contas puladas (erro na prévia ou cobrança já valendo). */
  puladas: Array<{ conta_id: string; motivo: string }>;
  /** O mesmo pedido (mesma Idempotency-Key) já tinha sido gravado: devolve o que foi feito. */
  repetido?: boolean;
}

function novoIdDeCobranca(): string {
  return `c${generateId()}`;
}

/**
 * Grava as cobranças da prévia (só as contas sem erro) e emite: uma só na
 * hora, várias pela fila. `assinatura` (da prévia) impede gravar algo
 * diferente do que a tela mostrou; `idempotencia` (cabeçalho
 * Idempotency-Key) faz o mesmo pedido repetido devolver o que já foi feito.
 */
export async function gravarEmissao(
  tenantId: string,
  pedido: PedidoDeEmissao,
  o: { assinatura?: string; quem?: QuemFez; hoje?: string; idempotencia?: string },
): Promise<ResultadoGravacao> {
  if (pool && o.idempotencia) {
    const ja = await cobrancasDaChave(pool as unknown as ExecutorSQL, tenantId, o.idempotencia);
    if (ja.length) return { previa: null, cobrancas: ja, na_fila: ja.filter(c => c.status === 'emitindo').length, puladas: [], repetido: true };
  }
  const motivo = nadaSai();
  if (motivo) throw new ErroCobranca(`Nenhuma cobrança sai agora (${motivo}). Tente de novo quando terminar.`, 409, 'NADA_SAI');
  const hoje = o.hoje ?? hojeEmBrasilia();
  const tipoPedido = pedido.tipo;
  if (tipoPedido === 'carne') throw new ErroCobranca('Carnê tem caminho próprio: use "Gerar carnê".');
  const r = await emTransacao(async exec => {
    const previa = await previaDaEmissao(exec, tenantId, pedido, hoje, true);
    if (o.assinatura && o.assinatura !== previa.assinatura) {
      throw new ErroCobranca('As contas mudaram desde a prévia. Revise e confirme de novo.', 409, 'ASSINATURA_VENCIDA');
    }
    if (!previa.prontas) {
      const primeiro = previa.itens[0]?.erros[0] ?? 'Nenhuma conta pronta para cobrar.';
      throw new ErroCobranca(primeiro, 409, codigoDoMotivo(primeiro));
    }
    const { config, nome_agencia: agencia } = await lerConfigCobranca(exec, tenantId);
    const dados = JSON.stringify(o.idempotencia ? { idempotencia: o.idempotencia.slice(0, 200) } : {});
    const criadas: LinhaCobranca[] = [];
    const puladas: Array<{ conta_id: string; motivo: string }> = [];
    for (const it of previa.itens) {
      if (!it.ok) { puladas.push({ conta_id: it.conta_id, motivo: it.erros[0] ?? 'Não pode ser cobrada.' }); continue; }
      const id = novoIdDeCobranca();
      const { rows } = await exec.query(
        `INSERT INTO cobrancas (id, tenant_id, titulo_tabela, titulo_id, cliente_id, provedor, referencia, tipo, status,
                                valor_centavos, vencimento, descricao, conta_bancaria_id, encargos, criado_por, criado_por_nome, dados)
         VALUES ($1, $2, 'contas_receber', $3, $4, $5, $6, $7, 'emitindo', $8, $9::date, $10, $11, $12::jsonb, $13, $14, $15::jsonb)
         ON CONFLICT DO NOTHING
         RETURNING ${COLUNAS}`,
        [id, tenantId, it.conta_id, it.cliente_id || null, previa.provedor, referenciaDaCobranca(tenantId, id), previa.tipo,
          it.valor_centavos, it.vencimento, descricaoDa(config, agencia, pedido.descricao, it), previa.conta_bancaria_id,
          JSON.stringify(previa.tipo === 'link' ? null : previa.encargos), o.quem?.usuarioId ?? null, o.quem?.usuarioNome ?? null, dados],
      );
      if (!rows.length) { puladas.push({ conta_id: it.conta_id, motivo: 'Esta conta já tem cobrança emitida.' }); continue; }
      const linha = lerLinha(rows[0]);
      await registrarEvento(exec, tenantId, id, 'criada', null, 'emitindo', { valor_centavos: linha.valor_centavos, vencimento: linha.vencimento }, o.quem);
      await marcarNaConta(exec, linha);
      criadas.push(linha);
    }
    if (criadas.length > 1) {
      for (const c of criadas) await enfileirarTarefa(exec, { tenantId, tipo: TAREFA_EMITIR, chaveIdem: c.id, dados: { cobranca_id: c.id } });
    }
    return { previa, criadas, puladas };
  });

  if (r.criadas.length === 1) {
    const feita = await executarEmissao(tenantId, r.criadas[0].id, { origem: 'agora' });
    return { previa: r.previa, cobrancas: [feita], na_fila: feita.status === 'emitindo' ? 1 : 0, puladas: r.puladas };
  }
  return { previa: r.previa, cobrancas: r.criadas, na_fila: r.criadas.length, puladas: r.puladas };
}

// ---------------------------------------------------------------------------
// Emissão no provedor

function pedidoDaLinha(c: LinhaCobranca): PedidoDeCobranca {
  return {
    referencia: c.referencia,
    tipo: (c.tipo === 'pix' || c.tipo === 'boleto' || c.tipo === 'boleto_pix') ? c.tipo : 'boleto_pix',
    valor_centavos: c.valor_centavos,
    vencimento: c.vencimento,
    descricao: c.descricao,
    encargos: c.encargos,
  };
}

async function gravarEmitida(
  exec: ExecutorSQL, c: LinhaCobranca, prov: CobrancaNoProvedor,
  dados: { linha_digitavel: string; codigo_barras: string; pix_copia_cola: string; pix_qrcode_url: string; url_boleto: string; url_fatura: string },
  extra: { url_link?: string; status?: StatusCobranca } = {},
): Promise<LinhaCobranca> {
  const status: StatusCobranca = extra.status
    ?? (prov.status === 'paga' || prov.status === 'cancelada' || prov.status === 'estornada' ? prov.status : prov.status === 'vencida' ? 'vencida' : 'aberta');
  const { rows } = await exec.query(
    `UPDATE cobrancas SET status = CASE WHEN status IN ('paga','estornada','cancelada') THEN status ELSE $3 END, id_externo = COALESCE(id_externo, $4), linha_digitavel = $5, codigo_barras = $6, pix_copia_cola = $7,
            pix_qrcode_url = $8, url_boleto = $9, url_fatura = $10, url_link = COALESCE(NULLIF($11, ''), url_link),
            valor_centavos = CASE WHEN $12::bigint > 0 THEN $12::bigint ELSE valor_centavos END,
            vencimento = COALESCE(NULLIF($13, '')::date, vencimento),
            carne_id_externo = COALESCE(NULLIF($14, ''), carne_id_externo),
            erro = NULL, atualizado_em = NOW()
      WHERE tenant_id = $1 AND id = $2
      RETURNING ${COLUNAS}`,
    [c.tenant_id, c.id, status, prov.id_externo, dados.linha_digitavel, dados.codigo_barras, dados.pix_copia_cola,
      dados.pix_qrcode_url, dados.url_boleto || prov.url_boleto, dados.url_fatura || prov.url_fatura, extra.url_link ?? '',
      prov.valor_centavos, prov.vencimento, prov.id_carne],
  );
  const nova = lerLinha(rows[0]);
  await registrarEvento(exec, c.tenant_id, c.id, 'emitida', c.status, nova.status, { id_externo: prov.id_externo, tentativas: c.tentativas });
  await marcarNaConta(exec, nova);
  return nova;
}

async function gravarFalha(exec: ExecutorSQL, c: LinhaCobranca, erro: string, definitiva: boolean): Promise<LinhaCobranca> {
  const { rows } = await exec.query(
    `UPDATE cobrancas SET erro = $3, status = CASE WHEN $4::boolean THEN 'falhou' ELSE status END, atualizado_em = NOW()
      WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUNAS}`,
    [c.tenant_id, c.id, erro.slice(0, 1000), definitiva],
  );
  const nova = lerLinha(rows[0]);
  await registrarEvento(exec, c.tenant_id, c.id, definitiva ? 'falhou' : 'tentativa_falhou', c.status, nova.status, { erro: erro.slice(0, 500) });
  if (definitiva) await marcarNaConta(exec, nova);
  return nova;
}

function paraCrm(c: LinhaCobranca): CobrancaParaCrm {
  return {
    id: c.id, titulo_id: c.titulo_id, cliente_id: c.cliente_id, tipo: c.tipo, provedor: c.provedor, status: c.status,
    valor_centavos: c.valor_centavos, vencimento: c.vencimento, descricao: c.descricao, linha_digitavel: c.linha_digitavel,
    pix_copia_cola: c.pix_copia_cola, url_boleto: c.url_boleto, url_fatura: c.url_fatura, url_link: c.url_link,
    pago_centavos: c.pago_centavos, pago_em: c.pago_em,
  };
}

export { paraCrm as cobrancaParaCrm };

/**
 * Fala com o provedor para UMA cobrança em `emitindo`.
 *
 * - `origem: 'fila'`: erro passageiro é relançado (a fila repete com
 *   espera crescente); disjuntor aberto adia sem gastar tentativa.
 * - `origem: 'agora'`: erro passageiro coloca a cobrança na fila e devolve
 *   a linha ainda `emitindo` (a tela diz "seguimos tentando").
 */
export async function executarEmissao(
  tenantId: string, cobrancaId: string, o: { origem: 'agora' | 'fila' },
): Promise<LinhaCobranca> {
  if (!pool) throw new ErroCobranca('Banco indisponível.', 503);
  const exec = pool as unknown as ExecutorSQL;
  const c = await exigirCobranca(exec, tenantId, cobrancaId);
  if (c.status !== 'emitindo') return c;
  if (c.tipo === 'carne') return c; // o carnê sai inteiro por executarCarne

  const aberto = await disjuntorAbertoAte(exec, tenantId, c.provedor);
  if (aberto) {
    if (o.origem === 'fila') throw new AdiarTarefa(aberto, `O ${nomeDoProvedor(c.provedor)} falhou várias vezes seguidas nesta agência; nova tentativa às ${aberto}.`);
    await enfileirarTarefa(exec, { tenantId, tipo: TAREFA_EMITIR, chaveIdem: c.id, dados: { cobranca_id: c.id }, proximaEm: aberto });
    return c;
  }

  // Marca a tentativa ANTES de chamar: se a resposta se perder, a próxima
  // sabe que precisa consultar pela referência.
  const marcada = await exec.query(
    `UPDATE cobrancas SET tentativas = tentativas + 1, atualizado_em = NOW()
      WHERE tenant_id = $1 AND id = $2 AND status = 'emitindo' RETURNING tentativas`,
    [tenantId, cobrancaId],
  );
  if (!marcada.rows.length) return exigirCobranca(exec, tenantId, cobrancaId);
  const tentativa = Number(marcada.rows[0].tentativas);

  const { config } = await lerConfigCobranca(exec, tenantId);
  let adapter: AdapterCobranca;
  try {
    adapter = await adapterDaAgencia(c.provedor, tenantId, config);
  } catch (e) {
    if (e instanceof ErroCobranca) return emTransacao(tx => gravarFalha(tx, c, e.message, true));
    throw e;
  }

  try {
    let prov: CobrancaNoProvedor | null = null;
    let urlLink = '';
    if (c.tipo === 'link') {
      if (!adapter.criarLink) throw new ErroProvedor('recusa', `O ${adapter.nome} não cria link de pagamento.`);
      const cliente = await clienteDaConta(exec, tenantId, c.cliente_id ?? '', '');
      const link = await adapter.criarLink({
        referencia: c.referencia, nome: (cliente.nome ? `${c.descricao} · ${cliente.nome}` : c.descricao).slice(0, 64),
        descricao: c.descricao, valor_centavos: c.valor_centavos, vence_em: c.vencimento,
      });
      urlLink = link.url;
      prov = {
        id_externo: link.id_externo, status: 'aberta', valor_centavos: c.valor_centavos, vencimento: c.vencimento,
        referencia: c.referencia, id_carne: '', numero_parcela: 0, url_boleto: '', url_fatura: link.url, bruto: link,
      };
    } else {
      // Repetição (a anterior pode ter chegado ao provedor): procura antes de criar.
      if (tentativa > 1) prov = await adapter.consultarPorReferencia(c.referencia);
      if (!prov) {
        const cliente = await clienteDaConta(exec, tenantId, c.cliente_id ?? '', '');
        const idCliente = await adapter.acharOuCriarCliente(cliente);
        prov = await adapter.emitir(idCliente, cliente, pedidoDaLinha(c));
      }
    }
    const dados = c.tipo === 'link'
      ? { linha_digitavel: '', codigo_barras: '', pix_copia_cola: '', pix_qrcode_url: '', url_boleto: '', url_fatura: urlLink }
      : await adapter.dadosDePagamento(prov, c.tipo);
    await registrarSucessoNoDisjuntor(exec, tenantId, c.provedor);
    const pronta = await emTransacao(tx => gravarEmitida(tx, c, prov!, dados, { url_link: urlLink }));
    if (pronta.status === 'aberta' || pronta.status === 'vencida') {
      await avisarCrm(exec, tenantId, 'COBRANCA_EMITIDA', paraCrm(pronta), `cobranca-emitida:${tenantId}:${pronta.id}`);
    }
    return pronta;
  } catch (e) {
    if (!(e instanceof ErroProvedor)) throw e;
    if (e.passageiro || e.tipo === 'credencial') {
      await registrarFalhaNoDisjuntor(exec, tenantId, c.provedor, e.message, e.tipo === 'limite' ? (e.esperarSegundos ?? 60) : null);
    }
    if (!e.passageiro) {
      // O provedor disse não: repetir não muda nada. Fica "falhou" com a frase dele.
      return emTransacao(tx => gravarFalha(tx, c, e.message, true));
    }
    const atual = await emTransacao(tx => gravarFalha(tx, c, e.message, false));
    if (o.origem === 'fila') throw e;
    await enfileirarTarefa(exec, {
      tenantId, tipo: TAREFA_EMITIR, chaveIdem: c.id, dados: { cobranca_id: c.id },
      proximaEm: new Date(ambienteDeCobranca().agora() + 60_000).toISOString(),
    });
    return atual;
  }
}

/** Processador da fila: emite uma cobrança. */
export async function processarTarefaDeEmissao(t: TarefaReivindicada): Promise<Record<string, unknown>> {
  const id = String(t.dados.cobranca_id ?? t.chave_idem);
  const c = await executarEmissao(t.tenant_id, id, { origem: 'fila' });
  return { cobranca_id: c.id, status: c.status };
}

/** Processador da fila: busca de novo linha e Pix (2ª via feita fora, parcela de carnê). */
export async function processarTarefaDeAtualizacao(t: TarefaReivindicada): Promise<Record<string, unknown>> {
  if (!pool) throw new Error('Banco indisponível');
  const exec = pool as unknown as ExecutorSQL;
  const id = String(t.dados.cobranca_id ?? t.chave_idem);
  const c = await carregarCobranca(exec, t.tenant_id, id);
  if (!c || !c.id_externo || !STATUS_EM_ABERTO.includes(c.status) || c.status === 'emitindo') return { cobranca_id: id, pulada: true };
  const aberto = await disjuntorAbertoAte(exec, t.tenant_id, c.provedor);
  if (aberto) throw new AdiarTarefa(aberto, 'Disjuntor aberto.');
  const { config } = await lerConfigCobranca(exec, t.tenant_id);
  const adapter = await adapterDaAgencia(c.provedor, t.tenant_id, config);
  try {
    const prov = await adapter.consultar(c.id_externo);
    if (!prov) return { cobranca_id: id, nao_encontrada: true };
    const dados = await adapter.dadosDePagamento(prov, c.tipo);
    await registrarSucessoNoDisjuntor(exec, t.tenant_id, c.provedor);
    await emTransacao(async tx => {
      const atual = await exigirCobranca(tx, t.tenant_id, id, true);
      if (!STATUS_EM_ABERTO.includes(atual.status)) return;
      const { rows } = await tx.query(
        `UPDATE cobrancas SET linha_digitavel = $3, codigo_barras = $4, pix_copia_cola = $5, pix_qrcode_url = $6,
                url_boleto = COALESCE(NULLIF($7, ''), url_boleto), url_fatura = COALESCE(NULLIF($8, ''), url_fatura), atualizado_em = NOW()
          WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUNAS}`,
        [t.tenant_id, id, dados.linha_digitavel, dados.codigo_barras, dados.pix_copia_cola, dados.pix_qrcode_url,
          dados.url_boleto || prov.url_boleto, dados.url_fatura || prov.url_fatura],
      );
      await marcarNaConta(tx, lerLinha(rows[0]));
    });
    return { cobranca_id: id, atualizada: true };
  } catch (e) {
    if (e instanceof ErroProvedor && e.passageiro) {
      await registrarFalhaNoDisjuntor(exec, t.tenant_id, c.provedor, e.message, e.tipo === 'limite' ? (e.esperarSegundos ?? 60) : null);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Carnê (Asaas)

export interface PedidoDeCarneNaTela {
  conta_ids: string[];
  provedor?: ProvedorCobranca;
  descricao?: string;
}

export interface PreviaDoCarne extends PreviaDeEmissao {
  erros_do_carne: string[];
  valor_parcela_centavos: number;
  primeiro_vencimento: string;
}

export async function previaDoCarne(exec: ExecutorSQL, tenantId: string, p: PedidoDeCarneNaTela, hoje: string, travar = false): Promise<PreviaDoCarne> {
  const previa = await previaDaEmissao(exec, tenantId, { itens: (p.conta_ids ?? []).map(conta_id => ({ conta_id })), provedor: p.provedor, tipo: 'carne', descricao: p.descricao }, hoje, travar);
  const ordenados = [...previa.itens].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const erros = conferirCarne(ordenados);
  if (previa.com_erro) erros.unshift('Resolva as contas com problema antes de gerar o carnê.');
  return {
    ...previa,
    itens: ordenados,
    erros_do_carne: erros,
    valor_parcela_centavos: ordenados[0]?.valor_centavos ?? 0,
    primeiro_vencimento: ordenados[0]?.vencimento ?? '',
    assinatura: assinar([previa.assinatura, 'carne']),
  };
}

export async function gravarCarne(
  tenantId: string, p: PedidoDeCarneNaTela, o: { assinatura?: string; quem?: QuemFez; hoje?: string; idempotencia?: string },
): Promise<{ carne_id: string; cobrancas: LinhaCobranca[] }> {
  if (pool && o.idempotencia) {
    const ja = await cobrancasDaChave(pool as unknown as ExecutorSQL, tenantId, o.idempotencia);
    if (ja.length && ja[0].carne_id) return executarCarne(tenantId, ja[0].carne_id);
  }
  const motivo = nadaSai();
  if (motivo) throw new ErroCobranca(`Nenhuma cobrança sai agora (${motivo}). Tente de novo quando terminar.`, 409, 'NADA_SAI');
  const hoje = o.hoje ?? hojeEmBrasilia();
  const carneId = generateId();
  await emTransacao(async exec => {
    const previa = await previaDoCarne(exec, tenantId, p, hoje, true);
    if (o.assinatura && o.assinatura !== previa.assinatura) throw new ErroCobranca('As contas mudaram desde a prévia. Revise e confirme de novo.', 409, 'ASSINATURA_VENCIDA');
    if (previa.erros_do_carne.length) throw new ErroCobranca(previa.erros_do_carne[0], 409, codigoDoMotivo(previa.erros_do_carne[0]));
    const { config, nome_agencia: agencia } = await lerConfigCobranca(exec, tenantId);
    const refCarne = referenciaDoCarne(tenantId, carneId);
    let n = 0;
    for (const it of previa.itens) {
      n++;
      const id = novoIdDeCobranca();
      const { rows } = await exec.query(
        `INSERT INTO cobrancas (id, tenant_id, titulo_tabela, titulo_id, cliente_id, provedor, referencia, tipo, status,
                                valor_centavos, vencimento, descricao, conta_bancaria_id, encargos, carne_id, carne_parcela, dados,
                                criado_por, criado_por_nome)
         VALUES ($1, $2, 'contas_receber', $3, $4, $5, $6, 'carne', 'emitindo', $7, $8::date, $9, $10, $11::jsonb, $12, $13, $14::jsonb, $15, $16)
         ON CONFLICT DO NOTHING RETURNING ${COLUNAS}`,
        [id, tenantId, it.conta_id, it.cliente_id || null, previa.provedor, referenciaDaCobranca(tenantId, id), it.valor_centavos,
          it.vencimento, descricaoDa(config, agencia, p.descricao, it), previa.conta_bancaria_id, JSON.stringify(previa.encargos),
          carneId, n, JSON.stringify({
            referencia_carne: refCarne, parcelas: previa.itens.length,
            ...(o.idempotencia ? { idempotencia: o.idempotencia.slice(0, 200) } : {}),
          }), o.quem?.usuarioId ?? null, o.quem?.usuarioNome ?? null],
      );
      if (!rows.length) throw new ErroCobranca('Uma das contas já tem cobrança emitida. Revise e confirme de novo.', 409, 'JA_TEM_COBRANCA');
      const linha = lerLinha(rows[0]);
      await registrarEvento(exec, tenantId, id, 'criada', null, 'emitindo', { carne_id: carneId, parcela: n }, o.quem);
      await marcarNaConta(exec, linha);
    }
  });
  return executarCarne(tenantId, carneId);
}

async function linhasDoCarne(exec: ExecutorSQL, tenantId: string, carneId: string): Promise<LinhaCobranca[]> {
  const { rows } = await exec.query(`SELECT ${COLUNAS} FROM cobrancas WHERE tenant_id = $1 AND carne_id = $2 ORDER BY carne_parcela`, [tenantId, carneId]);
  return rows.map(lerLinha);
}

/** Emite o carnê inteiro no provedor (na hora) e põe na fila a busca da linha de cada parcela. */
export async function executarCarne(tenantId: string, carneId: string): Promise<{ carne_id: string; cobrancas: LinhaCobranca[] }> {
  if (!pool) throw new ErroCobranca('Banco indisponível.', 503);
  const exec = pool as unknown as ExecutorSQL;
  const linhas = await linhasDoCarne(exec, tenantId, carneId);
  if (!linhas.length) throw new ErroCobranca('Carnê não encontrado.', 404);
  const pendentes = linhas.filter(l => l.status === 'emitindo');
  if (!pendentes.length) return { carne_id: carneId, cobrancas: linhas };
  const primeira = linhas[0];
  const refCarne = String(primeira.dados.referencia_carne ?? referenciaDoCarne(tenantId, carneId));
  const { config } = await lerConfigCobranca(exec, tenantId);
  const adapter = await adapterDaAgencia(primeira.provedor, tenantId, config);
  if (!adapter.emitirCarne) throw new ErroCobranca(`O ${adapter.nome} não emite carnê.`, 409, 'SEM_CARNE');
  await exec.query(`UPDATE cobrancas SET tentativas = tentativas + 1 WHERE tenant_id = $1 AND carne_id = $2 AND status = 'emitindo'`, [tenantId, carneId]);
  const repeticao = primeira.tentativas > 0;
  try {
    let carne = repeticao && adapter.consultarCarnePorReferencia ? await adapter.consultarCarnePorReferencia(refCarne) : null;
    if (!carne) {
      const cliente = await clienteDaConta(exec, tenantId, primeira.cliente_id ?? '', '');
      const idCliente = await adapter.acharOuCriarCliente(cliente);
      carne = await adapter.emitirCarne(idCliente, cliente, {
        referencia: refCarne, valor_parcela_centavos: primeira.valor_centavos, parcelas: linhas.length,
        primeiro_vencimento: primeira.vencimento, descricao: primeira.descricao, encargos: primeira.encargos,
      });
    }
    await registrarSucessoNoDisjuntor(exec, tenantId, primeira.provedor);
    const porNumero = new Map(carne.parcelas.map(p => [p.numero_parcela, p]));
    const prontas = await emTransacao(async tx => {
      const saida: LinhaCobranca[] = [];
      for (const l of linhas) {
        const prov = porNumero.get(l.carne_parcela ?? 0);
        if (!prov || l.status !== 'emitindo') { saida.push(l); continue; }
        saida.push(await gravarEmitida(tx, l, { ...prov, id_carne: carne!.id_externo }, {
          linha_digitavel: '', codigo_barras: '', pix_copia_cola: '', pix_qrcode_url: '', url_boleto: prov.url_boleto, url_fatura: prov.url_fatura,
        }));
        await enfileirarTarefa(tx, { tenantId, tipo: TAREFA_ATUALIZAR, chaveIdem: `${l.id}:emissao`, dados: { cobranca_id: l.id } });
      }
      return saida;
    });
    for (const l of prontas) {
      if (l.status === 'aberta') await avisarCrm(exec, tenantId, 'COBRANCA_EMITIDA', paraCrm(l), `cobranca-emitida:${tenantId}:${l.id}`);
    }
    return { carne_id: carneId, cobrancas: prontas };
  } catch (e) {
    if (!(e instanceof ErroProvedor)) throw e;
    if (e.passageiro || e.tipo === 'credencial') {
      await registrarFalhaNoDisjuntor(exec, tenantId, primeira.provedor, e.message, e.tipo === 'limite' ? (e.esperarSegundos ?? 60) : null);
    }
    const definitiva = !e.passageiro;
    const saida = await emTransacao(async tx => {
      const r: LinhaCobranca[] = [];
      for (const l of pendentes) r.push(await gravarFalha(tx, l, e.message, definitiva));
      return r;
    });
    if (definitiva) return { carne_id: carneId, cobrancas: saida };
    throw new ErroCobranca(`${e.message} O carnê ficou pendente: tente gerar de novo em alguns minutos (nada sai em dobro).`, 503);
  }
}

/** PDF do carnê, direto do provedor. */
export async function pdfDoCarne(tenantId: string, cobrancaId: string): Promise<{ conteudo: ArrayBuffer; tipo: string }> {
  if (!pool) throw new ErroCobranca('Banco indisponível.', 503);
  const exec = pool as unknown as ExecutorSQL;
  const c = await exigirCobranca(exec, tenantId, cobrancaId);
  if (c.tipo !== 'carne' || !c.carne_id_externo) throw new ErroCobranca('Esta cobrança não é de um carnê emitido.', 404);
  const { config } = await lerConfigCobranca(exec, tenantId);
  const adapter = await adapterDaAgencia(c.provedor, tenantId, config);
  if (!adapter.pdfDoCarne) throw new ErroCobranca(`O ${adapter.nome} não gera o PDF do carnê.`, 409);
  return adapter.pdfDoCarne(c.carne_id_externo);
}

// ---------------------------------------------------------------------------
// 2ª via, cancelamento, estorno, envio

function validarMudanca(m: MudancaDeCobranca, hoje: string): MudancaDeCobranca {
  const r: MudancaDeCobranca = {};
  if (m.vencimento !== undefined) {
    const v = String(m.vencimento).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ErroCobranca('Informe o novo vencimento.', 400, 'VENCIMENTO_INVALIDO');
    if (v < hoje) throw new ErroCobranca('O novo vencimento precisa ser hoje ou depois.', 400, 'VENCIMENTO_INVALIDO');
    r.vencimento = v;
  }
  if (m.valor_centavos !== undefined) {
    const v = Math.round(Number(m.valor_centavos));
    if (!Number.isFinite(v) || v <= 0) throw new ErroCobranca('Informe um valor maior que zero.');
    r.valor_centavos = v;
  }
  return r;
}

/**
 * 2ª via: novo vencimento e/ou valor. Onde o provedor altera, altera (e
 * busca a linha e o QR de novo); onde não altera, cancela a atual e emite
 * outra, ligada à anterior (`substitui_id`).
 */
export async function alterarCobranca(
  tenantId: string, cobrancaId: string, mudancaPedida: MudancaDeCobranca, o: { quem?: QuemFez; hoje?: string } = {},
): Promise<LinhaCobranca> {
  if (!pool) throw new ErroCobranca('Banco indisponível.', 503);
  const motivo = nadaSai();
  if (motivo) throw new ErroCobranca(`Nenhuma cobrança sai agora (${motivo}).`, 409, 'NADA_SAI');
  const exec = pool as unknown as ExecutorSQL;
  const hoje = o.hoje ?? hojeEmBrasilia();
  const mudanca = validarMudanca(mudancaPedida, hoje);
  const c = await exigirCobranca(exec, tenantId, cobrancaId);
  if (c.status !== 'aberta' && c.status !== 'vencida') throw new ErroCobranca('Só dá para fazer 2ª via de cobrança em aberto ou vencida.', 409);
  if (!c.id_externo) throw new ErroCobranca('Esta cobrança ainda não foi emitida no provedor.', 409);
  const caps = capacidadesDe(c.provedor);
  const como = comoAlterar(caps, c.tipo, c, mudanca);
  if (como === 'nada') return c;
  const { config } = await lerConfigCobranca(exec, tenantId);
  const adapter = await adapterDaAgencia(c.provedor, tenantId, config);

  if (como === 'alterar') {
    const prov = await adapter.alterar(c.id_externo, mudanca, pedidoDaLinha(c));
    const dados = await adapter.dadosDePagamento(prov, c.tipo);
    const nova = await emTransacao(async tx => {
      const vencimento = mudanca.vencimento ?? c.vencimento;
      const { rows } = await tx.query(
        `UPDATE cobrancas SET valor_centavos = $3, vencimento = $4::date, status = CASE WHEN $4::date >= $5::date THEN 'aberta' ELSE status END,
                linha_digitavel = $6, codigo_barras = $7, pix_copia_cola = $8, pix_qrcode_url = $9,
                url_boleto = COALESCE(NULLIF($10, ''), url_boleto), url_fatura = COALESCE(NULLIF($11, ''), url_fatura), atualizado_em = NOW()
          WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUNAS}`,
        [tenantId, c.id, mudanca.valor_centavos ?? c.valor_centavos, vencimento, hoje, dados.linha_digitavel, dados.codigo_barras,
          dados.pix_copia_cola, dados.pix_qrcode_url, dados.url_boleto || prov.url_boleto, dados.url_fatura || prov.url_fatura],
      );
      const l = lerLinha(rows[0]);
      await registrarEvento(tx, tenantId, c.id, 'segunda_via', c.status, l.status,
        { antes: { valor_centavos: c.valor_centavos, vencimento: c.vencimento }, depois: { valor_centavos: l.valor_centavos, vencimento: l.vencimento } }, o.quem);
      await marcarNaConta(tx, l);
      return l;
    });
    await avisarCrm(exec, tenantId, 'COBRANCA_EMITIDA', paraCrm(nova), `cobranca-emitida:${tenantId}:${nova.id}:${nova.atualizado_em}`);
    return nova;
  }

  // Reemitir: cancela no provedor e emite outra (link e parcela de carnê viram boleto/Pix comum).
  if (c.tipo !== 'link') await adapter.cancelar(c.id_externo);
  const novoId = novoIdDeCobranca();
  const tipoNovo: TipoCobranca = c.tipo === 'carne' ? (caps.boletoComPix ? 'boleto_pix' : 'boleto') : c.tipo;
  await emTransacao(async tx => {
    const { rows } = await tx.query(
      `UPDATE cobrancas SET status = 'cancelada', dados = dados || jsonb_build_object('substituida_por', $3::text), atualizado_em = NOW()
        WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUNAS}`,
      [tenantId, c.id, novoId],
    );
    await registrarEvento(tx, tenantId, c.id, 'substituida', c.status, 'cancelada', { por: novoId }, o.quem);
    const velha = lerLinha(rows[0]);
    const { rows: nr } = await tx.query(
      `INSERT INTO cobrancas (id, tenant_id, titulo_tabela, titulo_id, cliente_id, provedor, referencia, tipo, status,
                              valor_centavos, vencimento, descricao, conta_bancaria_id, encargos, substitui_id, criado_por, criado_por_nome)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'emitindo', $9, $10::date, $11, $12, $13::jsonb, $14, $15, $16)
       RETURNING ${COLUNAS}`,
      [novoId, tenantId, velha.titulo_tabela, velha.titulo_id, velha.cliente_id, velha.provedor, referenciaDaCobranca(tenantId, novoId),
        tipoNovo, mudanca.valor_centavos ?? velha.valor_centavos, mudanca.vencimento ?? velha.vencimento, velha.descricao,
        velha.conta_bancaria_id, JSON.stringify(velha.encargos), velha.id, o.quem?.usuarioId ?? null, o.quem?.usuarioNome ?? null],
    );
    await registrarEvento(tx, tenantId, novoId, 'criada', null, 'emitindo', { segunda_via_de: velha.id }, o.quem);
    await marcarNaConta(tx, lerLinha(nr[0]));
  });
  return executarEmissao(tenantId, novoId, { origem: 'agora' });
}

/** Cancela no provedor e aqui. Link: só aqui (desativar no painel do provedor). */
export async function cancelarCobranca(
  tenantId: string, cobrancaId: string, o: { motivo?: string; quem?: QuemFez } = {},
): Promise<{ cobranca: LinhaCobranca; aviso?: string }> {
  if (!pool) throw new ErroCobranca('Banco indisponível.', 503);
  const exec = pool as unknown as ExecutorSQL;
  const c = await exigirCobranca(exec, tenantId, cobrancaId);
  // Cancelar de novo (duplo clique, repetição): o efeito já aconteceu.
  if (c.status === 'cancelada') return { cobranca: c };
  if (!STATUS_EM_ABERTO.includes(c.status)) throw new ErroCobranca('Esta cobrança não está em aberto.', 409);
  let aviso: string | undefined;
  if (c.tipo === 'link') {
    aviso = `O link foi desativado aqui. Desative também no painel do ${nomeDoProvedor(c.provedor)} para ninguém pagar por ele.`;
  } else if (c.id_externo || c.tentativas > 0) {
    const { config } = await lerConfigCobranca(exec, tenantId);
    const adapter = await adapterDaAgencia(c.provedor, tenantId, config);
    let idExterno = c.id_externo;
    if (!idExterno) idExterno = (await adapter.consultarPorReferencia(c.referencia))?.id_externo ?? null;
    if (idExterno) await adapter.cancelar(idExterno);
  }
  const nova = await emTransacao(async tx => {
    const { rows } = await tx.query(
      `UPDATE cobrancas SET status = 'cancelada', atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2
          AND status IN ('emitindo','aberta','vencida') RETURNING ${COLUNAS}`,
      [tenantId, c.id],
    );
    if (!rows.length) return exigirCobranca(tx, tenantId, c.id);
    const l = lerLinha(rows[0]);
    await registrarEvento(tx, tenantId, c.id, 'cancelada', c.status, 'cancelada', { motivo: o.motivo ?? '' }, o.quem);
    await marcarNaConta(tx, l);
    return l;
  });
  return { cobranca: nova, aviso };
}

/**
 * Devolve ao cliente um pagamento feito (Pix). O dinheiro volta pelo
 * provedor; quando ele avisa o estorno, a baixa é desfeita sozinha.
 */
export async function pedirEstorno(
  tenantId: string, cobrancaId: string, o: { motivo: string; quem?: QuemFez },
): Promise<LinhaCobranca> {
  if (!pool) throw new ErroCobranca('Banco indisponível.', 503);
  const exec = pool as unknown as ExecutorSQL;
  const motivo = String(o.motivo ?? '').trim();
  if (motivo.length < 3) throw new ErroCobranca('Informe o motivo da devolução.');
  const c = await exigirCobranca(exec, tenantId, cobrancaId);
  if (c.status !== 'paga') throw new ErroCobranca('Só dá para devolver cobrança paga.', 409);
  const caps = capacidadesDe(c.provedor);
  const formaPaga = String(c.dados.forma_paga ?? (c.tipo === 'pix' ? 'pix' : ''));
  if (!caps.estornoPix || formaPaga !== 'pix') throw new ErroCobranca('A devolução pelo sistema vale para pagamento por Pix. Para boleto, devolva por transferência e estorne a baixa.', 409);
  const { config } = await lerConfigCobranca(exec, tenantId);
  const adapter = await adapterDaAgencia(c.provedor, tenantId, config);
  if (!adapter.estornar) throw new ErroCobranca(`O ${adapter.nome} não devolve pagamento pela integração.`, 409);
  const idPagamento = String(c.dados.pagamento_id ?? '') || c.id_externo;
  if (!idPagamento) throw new ErroCobranca('Pagamento não identificado no provedor.', 409);
  await adapter.estornar(idPagamento, null, motivo);
  await emTransacao(tx => registrarEvento(tx, tenantId, c.id, 'devolucao_pedida', c.status, c.status, { motivo }, o.quem));
  return c;
}

/** Pede ao CRM para mandar a cobrança ao cliente por e-mail ou WhatsApp. */
export async function enviarCobranca(
  tenantId: string, cobrancaId: string, canal: CanalCobranca, o: { quem?: QuemFez; idempotencia?: string } = {},
): Promise<{ enviado: true; canal: CanalCobranca; repetido?: boolean }> {
  if (pool && o.idempotencia) {
    // O mesmo pedido repetido (duplo clique): não manda duas vezes.
    const { rows } = await (pool as unknown as ExecutorSQL).query(
      `SELECT 1 FROM cobranca_eventos WHERE tenant_id = $1 AND cobranca_id = $2 AND tipo = 'envio_pedido' AND detalhe->>'idempotencia' = $3 LIMIT 1`,
      [tenantId, cobrancaId, o.idempotencia.slice(0, 200)],
    );
    if (rows.length) return { enviado: true, canal, repetido: true };
  }
  if (!pool) throw new ErroCobranca('Banco indisponível.', 503);
  if (canal !== 'email' && canal !== 'whatsapp') throw new ErroCobranca('Escolha e-mail ou WhatsApp.');
  const motivo = nadaSai();
  if (motivo) throw new ErroCobranca(`Nada é enviado agora (${motivo}).`, 409, 'NADA_SAI');
  const exec = pool as unknown as ExecutorSQL;
  const c = await exigirCobranca(exec, tenantId, cobrancaId);
  if (c.status !== 'aberta' && c.status !== 'vencida') throw new ErroCobranca('Só dá para enviar cobrança em aberto ou vencida.', 409);
  if (!(await crmLigado(exec, tenantId))) {
    throw new ErroCobranca('O envio por e-mail e WhatsApp sai pelo CRM. Ligue a integração com o CRM em Configurações.', 409);
  }
  await avisarCrm(exec, tenantId, 'COBRANCA_ENVIAR', paraCrm(c), `cobranca-enviar:${tenantId}:${c.id}:${generateId()}`, { canal });
  await emTransacao(tx => registrarEvento(tx, tenantId, c.id, 'envio_pedido', c.status, c.status,
    { canal, ...(o.idempotencia ? { idempotencia: o.idempotencia.slice(0, 200) } : {}) }, o.quem));
  return { enviado: true, canal };
}

// ---------------------------------------------------------------------------
// Leitura

export interface FiltrosDaLista {
  status?: string[];
  provedor?: string;
  tipo?: string;
  vencimento_de?: string;
  vencimento_ate?: string;
  cliente_id?: string;
  titulo_id?: string;
  busca?: string;
  pagina?: number;
  por_pagina?: number;
}

export interface ItemDaLista extends LinhaCobranca {
  cliente_nome: string;
  conta_descricao: string;
  valor: number;
}

export interface TotaisDaLista {
  /** Em aberto (emitindo + aberta + vencida). */
  aberto: { quantidade: number; valor: number };
  vencido: { quantidade: number; valor: number };
  /** Pagas, pelo valor pago. */
  pago: { quantidade: number; valor: number };
  falhou: { quantidade: number };
}

export async function listarCobrancas(
  exec: ExecutorSQL, tenantId: string, f: FiltrosDaLista, contasPermitidas: string[] | null,
): Promise<{
  itens: ItemDaLista[]; total: number; pagina: number; por_pagina: number;
  totais: TotaisDaLista; por_status: Record<string, { quantidade: number; valor: number }>;
}> {
  const cond: string[] = ['c.tenant_id = $1'];
  const v: unknown[] = [tenantId];
  const add = (sql: string, valor: unknown) => { v.push(valor); cond.push(sql.replace('?', `$${v.length}`)); };
  if (f.provedor) add('c.provedor = ?', f.provedor);
  if (f.tipo) add('c.tipo = ?', f.tipo);
  if (f.vencimento_de) add('c.vencimento >= ?::date', f.vencimento_de);
  if (f.vencimento_ate) add('c.vencimento <= ?::date', f.vencimento_ate);
  if (f.cliente_id) add('c.cliente_id = ?', f.cliente_id);
  if (f.titulo_id) add('c.titulo_id = ?', f.titulo_id);
  if (f.busca && f.busca.trim()) {
    v.push(`%${f.busca.trim().replace(/[%_\\]/g, m => `\\${m}`)}%`);
    const n = `$${v.length}`;
    cond.push(`(c.descricao ILIKE ${n} OR COALESCE(cr.data->>'cliente_nome', '') ILIKE ${n} OR c.linha_digitavel ILIKE ${n})`);
  }
  if (contasPermitidas !== null) add(`(COALESCE(c.conta_bancaria_id, '') = '' OR c.conta_bancaria_id = ANY(?::text[]))`, contasPermitidas);
  // Os totais valem para os mesmos filtros, sem o de situação (a tela mostra todos os cartões).
  const whereSemStatus = cond.join(' AND ');
  const vSemStatus = [...v];
  const status = (f.status ?? []).flatMap(s => (s === 'em_aberto' ? [...STATUS_EM_ABERTO] : [s]))
    .filter(s => ['emitindo', 'aberta', 'vencida', 'paga', 'cancelada', 'estornada', 'falhou'].includes(s));
  if (status.length) add('c.status = ANY(?::text[])', status);
  const where = cond.join(' AND ');
  const porPagina = Math.min(200, Math.max(1, Math.round(Number(f.por_pagina) || 50)));
  const pagina = Math.max(1, Math.round(Number(f.pagina) || 1));
  // Da conta: a mais recente primeiro; na lista geral: por vencimento.
  const ordem = f.titulo_id ? 'c.criado_em DESC, c.id DESC' : 'c.vencimento ASC NULLS LAST, c.criado_em DESC';
  const { rows } = await exec.query(
    `SELECT ${colunas('c.')},
            COALESCE(cr.data->>'cliente_nome', '') AS cliente_nome, COALESCE(cr.data->>'descricao', '') AS conta_descricao,
            COUNT(*) OVER () AS total_linhas
       FROM cobrancas c
       LEFT JOIN contas_receber cr ON cr.tenant_id = c.tenant_id AND cr.id = c.titulo_id
      WHERE ${where}
      ORDER BY ${ordem}
      LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`,
    v,
  );
  const { rows: tot } = await exec.query(
    `SELECT c.status, COUNT(*)::int AS n, COALESCE(SUM(c.valor_centavos), 0)::bigint AS centavos,
            COALESCE(SUM(COALESCE(c.pago_centavos, c.valor_centavos)), 0)::bigint AS pagos
       FROM cobrancas c LEFT JOIN contas_receber cr ON cr.tenant_id = c.tenant_id AND cr.id = c.titulo_id
      WHERE ${whereSemStatus} GROUP BY c.status`,
    vSemStatus,
  );
  const por_status: Record<string, { quantidade: number; valor: number }> = {};
  const totais: TotaisDaLista = { aberto: { quantidade: 0, valor: 0 }, vencido: { quantidade: 0, valor: 0 }, pago: { quantidade: 0, valor: 0 }, falhou: { quantidade: 0 } };
  let abertoCentavos = 0;
  for (const t of tot) {
    const st = String(t.status) as StatusCobranca;
    const n = Number(t.n);
    por_status[st] = { quantidade: n, valor: deCentavos(t.centavos as string) };
    if (STATUS_EM_ABERTO.includes(st)) { totais.aberto.quantidade += n; abertoCentavos += Number(t.centavos); }
    if (st === 'vencida') totais.vencido = { quantidade: n, valor: deCentavos(t.centavos as string) };
    if (st === 'paga') totais.pago = { quantidade: n, valor: deCentavos(t.pagos as string) };
    if (st === 'falhou') totais.falhou = { quantidade: n };
  }
  totais.aberto.valor = deCentavos(abertoCentavos);
  return {
    itens: rows.map(r => ({
      ...lerLinha(r), cliente_nome: String(r.cliente_nome ?? ''), conta_descricao: String(r.conta_descricao ?? ''),
      valor: deCentavos(r.valor_centavos as string),
    })),
    total: Number(rows[0]?.total_linhas ?? 0),
    pagina,
    por_pagina: porPagina,
    totais,
    por_status,
  };
}

export async function detalheDaCobranca(exec: ExecutorSQL, tenantId: string, id: string) {
  const c = await exigirCobranca(exec, tenantId, id);
  const { rows: eventos } = await exec.query(
    `SELECT id, tipo, de_status, para_status, detalhe, usuario_nome, criado_em::text AS criado_em
       FROM cobranca_eventos WHERE tenant_id = $1 AND cobranca_id = $2 ORDER BY criado_em, id`,
    [tenantId, id],
  );
  const { rows: conta } = await exec.query(
    `SELECT data->>'descricao' AS descricao, data->>'cliente_nome' AS cliente_nome, data->>'status' AS status
       FROM contas_receber WHERE tenant_id = $1 AND id = $2`,
    [tenantId, c.titulo_id],
  );
  return {
    ...c,
    valor: deCentavos(c.valor_centavos),
    valor_pago: c.pago_centavos != null ? deCentavos(c.pago_centavos) : null,
    taxa: c.taxa_centavos != null ? deCentavos(c.taxa_centavos) : null,
    capacidades: capacidadesDe(c.provedor),
    conta: conta[0] ?? null,
    eventos,
  };
}

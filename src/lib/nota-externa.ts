/**
 * NOTA EMITIDA FORA DO SISTEMA (E7, 06/11/2026).
 *
 * A agência emitiu a nota no portal da prefeitura (tomador do exterior,
 * emissor fora do ar, nota antiga do sistema anterior) e quer que ela conte
 * aqui: na venda (o saldo de "Gerar notas" cai), na conta a receber (a trava
 * de uma nota por conta vale) e na lista de notas. A nota entra AUTORIZADA (ou
 * CANCELADA, quando a mudança traz o histórico), marcada `emitida_fora`, e
 * nunca vai ao emissor: cancelar aqui só registra (a tela avisa para cancelar
 * também no portal).
 *
 * Idempotente pela chave prestador|série|número: registrar a mesma nota de
 * novo (duplo clique, a mudança rodando outra vez) devolve a que já está, sem
 * criar outra.
 *
 * Para a mudança de sistema (frente da mudança v2): `registrarNotasEmitidasFora`
 * recebe a lista inteira e responde item a item, sem parar no primeiro erro;
 * passe `origem: 'MUDANCA'`. Cada item usa o formato `NotaDeFora` abaixo.
 */
import { generateId } from './utils';
import { hojeISO, round2 } from './money';
import type { ExecutorSQL } from './caixa-atomico';
import type { NotaFiscal } from './nfse-tipos';

export class ErroNotaExterna extends Error {
  codigo: string;
  status: number;
  detalhes?: unknown;
  constructor(codigo: string, mensagem: string, status = 400, detalhes?: unknown) {
    super(mensagem);
    this.name = 'ErroNotaExterna';
    this.codigo = codigo;
    this.status = status;
    this.detalhes = detalhes;
  }
}

/** O que se informa de uma nota emitida fora. Dinheiro em centavos. */
export interface NotaDeFora {
  numero: string;
  /** Série do RPS/DPS, quando houver. */
  serie: string;
  /** AAAA-MM-DD. */
  data_emissao: string;
  valor_centavos: number;
  /** ISS da nota, quando a pessoa sabe. */
  iss_centavos: number | null;
  aliquota_iss: number | null;
  tomador: {
    nome: string;
    cpf_cnpj: string;
    email: string;
    estrangeiro: boolean;
    documento_estrangeiro: string;
    pais: string;
  };
  discriminacao: string;
  /** Ligações opcionais: a venda e/ou a conta a receber que a nota cobre. */
  venda_id: string;
  /** O número da venda, quando a pessoa (ou a mudança) não tem o id. */
  venda_numero: string;
  conta_receber_id: string;
  cliente_id: string;
  codigo_verificacao: string;
  link_pdf: string;
  link_xml: string;
  /** CNPJ de quem emitiu. Vazio: o da agência. */
  prestador_cnpj: string;
  situacao: 'AUTORIZADA' | 'CANCELADA';
  cancelada_em: string;
  motivo_cancelamento: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v: unknown, max = 300) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
const digitos = (v: unknown) => txt(v, 40).replace(/\D/g, '');

function dataValida(v: unknown): string {
  const s = txt(v, 10);
  return ISO.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) ? s : '';
}

function centavosOuNulo(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function urlOuVazio(v: unknown): string {
  const s = txt(v, 1000);
  return /^https?:\/\//i.test(s) ? s : '';
}

/** Limpa a entrada e diz o que falta, em frases para a tela. */
export function normalizarNotaDeFora(v: unknown, hoje: string = hojeISO()): { nota: NotaDeFora; erros: string[] } {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const t = (o.tomador && typeof o.tomador === 'object' ? o.tomador : {}) as Record<string, unknown>;
  const estrangeiro = t.estrangeiro === true;
  const situacao = o.situacao === 'CANCELADA' ? 'CANCELADA' : 'AUTORIZADA';
  const nota: NotaDeFora = {
    numero: txt(o.numero, 30).replace(/\s+/g, ''),
    serie: txt(o.serie, 10).toUpperCase(),
    data_emissao: dataValida(o.data_emissao),
    valor_centavos: Math.round(Number(o.valor_centavos) || 0),
    iss_centavos: centavosOuNulo(o.iss_centavos),
    aliquota_iss: o.aliquota_iss === null || o.aliquota_iss === undefined || o.aliquota_iss === '' ? null : Math.max(0, Math.min(100, Number(o.aliquota_iss) || 0)),
    tomador: {
      nome: txt(t.nome, 200),
      cpf_cnpj: digitos(t.cpf_cnpj),
      email: txt(t.email, 200),
      estrangeiro,
      documento_estrangeiro: estrangeiro ? txt(t.documento_estrangeiro, 60) : '',
      pais: estrangeiro ? txt(t.pais, 60) : '',
    },
    discriminacao: txt(o.discriminacao, 1000),
    venda_id: txt(o.venda_id, 200),
    venda_numero: txt(o.venda_numero, 60),
    conta_receber_id: txt(o.conta_receber_id, 200),
    cliente_id: txt(o.cliente_id, 200),
    codigo_verificacao: txt(o.codigo_verificacao, 60),
    link_pdf: urlOuVazio(o.link_pdf),
    link_xml: urlOuVazio(o.link_xml),
    prestador_cnpj: digitos(o.prestador_cnpj),
    situacao,
    cancelada_em: situacao === 'CANCELADA' ? dataValida(o.cancelada_em) : '',
    motivo_cancelamento: situacao === 'CANCELADA' ? txt(o.motivo_cancelamento, 300) : '',
  };
  const erros: string[] = [];
  if (!nota.numero) erros.push('Informe o número da nota, como está no documento da prefeitura.');
  if (!nota.data_emissao) erros.push('Informe a data de emissão da nota.');
  else if (nota.data_emissao > hoje) erros.push('A data de emissão não pode ser depois de hoje.');
  if (!(nota.valor_centavos > 0)) erros.push('Informe o valor da nota.');
  if (!nota.tomador.nome) erros.push('Informe o nome de quem recebeu a nota (o tomador).');
  if (!estrangeiro && nota.tomador.cpf_cnpj && ![11, 14].includes(nota.tomador.cpf_cnpj.length)) {
    erros.push('O CPF ou CNPJ do tomador está incompleto.');
  }
  if (!estrangeiro && !nota.tomador.cpf_cnpj) {
    erros.push('Informe o CPF ou CNPJ do tomador. Se ele é do exterior, marque "Tomador do exterior".');
  }
  if (nota.iss_centavos !== null && nota.iss_centavos > nota.valor_centavos) erros.push('O ISS não pode passar do valor da nota.');
  return { nota, erros };
}

/** A chave da nota de fora: prestador|série|número (sem zeros à esquerda no número). */
export function chaveDaNotaDeFora(n: Pick<NotaDeFora, 'numero' | 'serie' | 'prestador_cnpj'>): string {
  const numero = n.numero.replace(/^0+(?=.)/, '');
  return `fora:${n.prestador_cnpj}|${n.serie}|${numero}`;
}

/** A NotaFiscal (o formato de sempre) de uma nota emitida fora. */
export function notaFiscalDeFora(
  n: NotaDeFora, ctx: { id: string; autor: string; origem: 'TELA' | 'MUDANCA'; venda_id: string; cliente_id: string; agora: string },
): NotaFiscal {
  const valor = round2(n.valor_centavos / 100);
  const iss = n.iss_centavos !== null ? round2(n.iss_centavos / 100)
    : n.aliquota_iss !== null ? round2(valor * n.aliquota_iss / 100) : 0;
  // Meio-dia em Brasília: a data não "vira" ao mostrar em outro fuso.
  const emitidaEm = `${n.data_emissao}T15:00:00.000Z`;
  return {
    id: ctx.id,
    conta_receber_id: n.conta_receber_id,
    venda_id: ctx.venda_id,
    cliente_id: ctx.cliente_id,
    tomador: {
      cpf_cnpj: n.tomador.cpf_cnpj,
      razao_social: n.tomador.nome,
      email: n.tomador.email,
      inscricao_municipal: '',
      endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' },
      ...(n.tomador.estrangeiro ? { estrangeiro: true, documento_estrangeiro: n.tomador.documento_estrangeiro, pais: n.tomador.pais } : {}),
    },
    regime: 'INTERMEDIACAO',
    forma_base: 'VALOR_COMISSAO',
    intermediario: null,
    valor_recebido: valor,
    valor_servicos: valor,
    valor_deducoes: 0,
    desconto_incondicionado: 0,
    base_calculo: valor,
    aliquota_iss: n.aliquota_iss ?? (valor > 0 && iss > 0 ? round2(iss / valor * 100) : 0),
    valor_iss: iss,
    iss_retido: false,
    valor_liquido: valor,
    discriminacao: n.discriminacao,
    item_lista_servico: '',
    codigo_tributacao_municipio: '',
    cnae: '',
    serie_rps: n.serie,
    status: n.situacao,
    ambiente: 'PRODUCAO',
    numero: n.numero,
    codigo_verificacao: n.codigo_verificacao,
    protocolo: '',
    link_pdf: n.link_pdf,
    link_xml: n.link_xml,
    enviar_email: false,
    erro: '',
    emitida_em: emitidaEm,
    autorizada_em: emitidaEm,
    cancelada_em: n.situacao === 'CANCELADA' ? `${n.cancelada_em || n.data_emissao}T15:00:00.000Z` : '',
    motivo_cancelamento: n.motivo_cancelamento,
    emitida_por: ctx.autor,
    observacoes: ctx.origem === 'MUDANCA' ? 'Nota trazida na mudança de sistema.' : 'Nota emitida fora do sistema e registrada aqui.',
    data_competencia: n.data_emissao,
    emitida_fora: true,
    chave_externa: chaveDaNotaDeFora(n),
    registro_origem: ctx.origem,
    ...({ registrada_em: ctx.agora } as Record<string, unknown>),
  } as NotaFiscal;
}

async function cnpjDaAgencia(exec: ExecutorSQL, tenantId: string): Promise<string> {
  const { rows } = await exec.query(
    `SELECT data->>'cnpj' AS cnpj FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
    [tenantId],
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  return digitos(rows[0]?.cnpj);
}

async function notaPelaChave(exec: ExecutorSQL, tenantId: string, chave: string): Promise<NotaFiscal | null> {
  const { rows } = await exec.query(
    `SELECT data FROM notas_fiscais WHERE tenant_id = $1 AND data->>'chave_externa' = $2 LIMIT 1`,
    [tenantId, chave],
  );
  return (rows[0]?.data ?? null) as NotaFiscal | null;
}

/**
 * Registra UMA nota emitida fora. Devolve a nota e se ela já estava
 * registrada (`repetida`). Erros de dado: ErroNotaExterna 400; conta com
 * outra nota valendo: 409. Chame dentro de uma transação (usa SAVEPOINT).
 */
export async function registrarNotaEmitidaFora(
  exec: ExecutorSQL, tenantId: string, entrada: unknown,
  autor: { id: string; nome: string }, opcoes: { origem?: 'TELA' | 'MUDANCA'; hoje?: string } = {},
): Promise<{ nota: NotaFiscal; repetida: boolean }> {
  const { nota: n, erros } = normalizarNotaDeFora(entrada, opcoes.hoje);
  if (erros.length) throw new ErroNotaExterna('DADOS', erros[0], 400, erros);
  if (!n.prestador_cnpj) n.prestador_cnpj = await cnpjDaAgencia(exec, tenantId);
  const chave = chaveDaNotaDeFora(n);
  const ja = await notaPelaChave(exec, tenantId, chave);
  if (ja) return { nota: ja, repetida: true };

  // As ligações: a conta diz a venda e o cliente quando eles não vieram.
  let vendaId = n.venda_id;
  let clienteId = n.cliente_id;
  if (n.conta_receber_id) {
    const { rows } = await exec.query(
      `SELECT venda_id, cliente_id, data->>'origem_venda_id' AS v FROM contas_receber WHERE tenant_id = $1 AND id = $2`,
      [tenantId, n.conta_receber_id],
    );
    if (!rows.length) throw new ErroNotaExterna('CONTA', 'A conta a receber informada não existe nesta agência.', 404);
    vendaId = vendaId || txt(rows[0].v) || txt(rows[0].venda_id);
    clienteId = clienteId || txt(rows[0].cliente_id);
  }
  if (!vendaId && n.venda_numero) {
    const { rows } = await exec.query(
      `SELECT id FROM vendas_crm WHERE tenant_id = $1 AND (data->>'numero' = $2 OR id = $2) ORDER BY created_at DESC LIMIT 2`,
      [tenantId, n.venda_numero],
    );
    if (!rows.length) throw new ErroNotaExterna('VENDA', `Nenhuma venda com o número ${n.venda_numero} nesta agência.`, 404);
    if (rows.length > 1) throw new ErroNotaExterna('VENDA', `Há mais de uma venda com o número ${n.venda_numero}. Registre a nota pela ficha da venda.`, 409);
    vendaId = txt(rows[0].id);
  }
  if (vendaId) {
    const { rows } = await exec.query(`SELECT cliente_id FROM vendas_crm WHERE tenant_id = $1 AND id = $2`, [tenantId, vendaId]);
    if (!rows.length) throw new ErroNotaExterna('VENDA', 'A venda informada não existe nesta agência.', 404);
    clienteId = clienteId || txt(rows[0].cliente_id);
  }

  const nota = notaFiscalDeFora(n, {
    id: generateId(), autor: autor.nome || autor.id || 'Sistema', origem: opcoes.origem ?? 'TELA',
    venda_id: vendaId, cliente_id: clienteId, agora: new Date().toISOString(),
  });
  await exec.query('SAVEPOINT nota_de_fora');
  try {
    await exec.query(
      `INSERT INTO notas_fiscais (id, tenant_id, conta_receber_id, venda_id, cliente_id, status, referencia_gateway, data)
       VALUES ($1, $2, $3, $4, $5, $6, '', $7::jsonb)`,
      [nota.id, tenantId, nota.conta_receber_id, nota.venda_id, nota.cliente_id, nota.status, JSON.stringify(nota)],
    );
    await exec.query('RELEASE SAVEPOINT nota_de_fora');
  } catch (e) {
    await exec.query('ROLLBACK TO SAVEPOINT nota_de_fora');
    if ((e as { code?: string })?.code === '23505') {
      const outra = await notaPelaChave(exec, tenantId, chave);
      if (outra) return { nota: outra, repetida: true };
      throw new ErroNotaExterna('CONTA_COM_NOTA', 'Esta conta a receber já tem uma nota valendo. Cancele a outra antes ou registre a nota sem a conta.', 409);
    }
    throw e;
  }
  return { nota, repetida: false };
}

export interface ResultadoDoLote {
  indice: number;
  ok: boolean;
  nota_id?: string;
  repetida?: boolean;
  erro?: string;
}

/**
 * Registra uma lista (a mudança de sistema). Cada item é independente: um
 * erro de dado não para os outros nem desfaz os anteriores (cada um tem o seu
 * SAVEPOINT). Como `registrarNotaEmitidaFora`, chame DENTRO de uma transação
 * (`emTransacao`).
 */
export async function registrarNotasEmitidasFora(
  exec: ExecutorSQL, tenantId: string, lista: unknown[],
  autor: { id: string; nome: string }, opcoes: { origem?: 'TELA' | 'MUDANCA'; hoje?: string } = {},
): Promise<ResultadoDoLote[]> {
  const saida: ResultadoDoLote[] = [];
  for (let i = 0; i < lista.length; i++) {
    try {
      const r = await registrarNotaEmitidaFora(exec, tenantId, lista[i], autor, { origem: opcoes.origem ?? 'MUDANCA', hoje: opcoes.hoje });
      saida.push({ indice: i, ok: true, nota_id: r.nota.id, repetida: r.repetida });
    } catch (e) {
      if (!(e instanceof ErroNotaExterna)) throw e;
      saida.push({ indice: i, ok: false, erro: e.message });
    }
  }
  return saida;
}

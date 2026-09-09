/**
 * Orquestração da emissão de NFS-e: o que precisa de banco.
 *
 * O cálculo puro está em ./nfse-calculo e a conversa com o gateway em
 * ./nfse-emissor. Aqui é onde os dois se encontram com a venda, a conta a
 * receber e o cliente.
 */

import pool from './db';
import { generateId } from './utils';
import { hojeISO, num, round2 } from './money';
import { nomeDoCliente, documentoDoCliente } from './cliente-nome';
import {
  calcularNota,
  montarDiscriminacao,
  pendenciasParaEmitir,
  regimeSugerido,
} from './nfse-calculo';
import {
  ErroFiscal,
  emissorDaConfig,
  type DadosEmitente,
} from './nfse-emissor';
import type {
  ConfigFiscal,
  FormaBaseIntermediacao,
  IntermediarioNota,
  NotaFiscal,
  RegimeNota,
  TomadorNota,
} from './nfse-tipos';

export const CONFIG_FISCAL_ID = 'config-fiscal-singleton';

/** Configuração de fábrica. Agência de viagens no item 9.02 da LC 116. */
export function configFiscalPadrao(): ConfigFiscal {
  return {
    id: CONFIG_FISCAL_ID,
    provedor: '',
    ambiente: 'HOMOLOGACAO',
    token: '',
    certificado: null,
    item_lista_servico: '9.02',
    codigo_tributacao_municipio: '',
    cnae: '7911200',
    aliquota_iss: 2,
    iss_retido_padrao: false,
    optante_simples_nacional: false,
    incentivador_cultural: false,
    natureza_operacao: 'Tributação no município',
    regime_padrao: 'INTERMEDIACAO',
    forma_base_intermediacao: 'VALOR_COMISSAO',
    intermediario_padrao: null,
    serie_rps: '1',
    discriminacao_padrao:
      'Agenciamento de viagem — {cliente} — venda {venda} {parcela}',
    emissao_automatica: false,
  };
}

/** Mostra só os últimos dígitos do token. O resto nunca sai do servidor. */
export function mascararToken(token: string): string {
  const t = String(token ?? '').trim();
  if (!t) return '';
  if (t.length <= 4) return '••••';
  return `••••${t.slice(-4)}`;
}

/** Config sem o token, pronta para ir ao navegador. */
export function configParaCliente(config: ConfigFiscal): ConfigFiscal {
  const { token, ...resto } = config;
  return { ...resto, token: '', token_mascarado: mascararToken(token ?? '') };
}

export async function carregarConfigFiscal(tenantId: string): Promise<ConfigFiscal> {
  if (!pool) return configFiscalPadrao();
  const { rows } = await pool.query(
    `SELECT data FROM config_fiscal WHERE id = $1 AND tenant_id = $2`,
    [CONFIG_FISCAL_ID, tenantId],
  );
  const gravado = (rows[0]?.data ?? {}) as Partial<ConfigFiscal>;
  return { ...configFiscalPadrao(), ...gravado, id: CONFIG_FISCAL_ID };
}

export async function salvarConfigFiscal(
  tenantId: string,
  config: ConfigFiscal,
): Promise<void> {
  if (!pool) return;
  // UPDATE e, se não existir, INSERT — mesmo caminho de config_apis, que não
  // depende de qual chave única a tabela tem no momento.
  const atualizado = await pool.query(
    `UPDATE config_fiscal SET data = $3, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    [CONFIG_FISCAL_ID, tenantId, JSON.stringify(config)],
  );
  if ((atualizado.rowCount ?? 0) === 0) {
    await pool.query(
      `INSERT INTO config_fiscal (id, tenant_id, data) VALUES ($1, $2, $3)`,
      [CONFIG_FISCAL_ID, tenantId, JSON.stringify(config)],
    );
  }
}

export async function carregarEmitente(tenantId: string): Promise<DadosEmitente> {
  const vazio: DadosEmitente = {
    cnpj: '', inscricao_municipal: '', razao_social: '', nome_fantasia: '',
    endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' },
    optante_simples_nacional: false,
    incentivador_cultural: false,
    regime_tributario: '',
  };
  if (!pool) return vazio;
  const { rows } = await pool.query(
    `SELECT data FROM agencia WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  const a = (rows[0]?.data ?? {}) as Record<string, unknown>;
  const end = (a.endereco ?? {}) as Record<string, string>;
  return {
    cnpj: String(a.cnpj ?? ''),
    inscricao_municipal: String(a.inscricao_municipal ?? ''),
    razao_social: String(a.razao_social ?? ''),
    nome_fantasia: String(a.nome_fantasia ?? ''),
    endereco: {
      cep: String(end.cep ?? ''), logradouro: String(end.logradouro ?? ''),
      numero: String(end.numero ?? ''), complemento: String(end.complemento ?? ''),
      bairro: String(end.bairro ?? ''), cidade: String(end.cidade ?? ''),
      estado: String(end.estado ?? ''),
    },
    optante_simples_nacional: String(a.regime_tributario ?? '') === 'SIMPLES',
    incentivador_cultural: false,
    regime_tributario: String(a.regime_tributario ?? ''),
  };
}

function tomadorDoCliente(cliente: Record<string, unknown> | null): TomadorNota {
  const end = ((cliente?.endereco ?? {}) as Record<string, string>) || {};
  return {
    cpf_cnpj: documentoDoCliente(cliente ?? undefined),
    razao_social: nomeDoCliente(cliente ?? undefined),
    email: String(cliente?.email ?? ''),
    inscricao_municipal: String(cliente?.inscricao_municipal ?? ''),
    endereco: {
      cep: String(end.cep ?? ''), logradouro: String(end.logradouro ?? ''),
      numero: String(end.numero ?? ''), complemento: String(end.complemento ?? ''),
      bairro: String(end.bairro ?? ''), cidade: String(end.cidade ?? ''),
      estado: String(end.estado ?? ''),
    },
  };
}

export interface ContextoDaNota {
  conta: Record<string, unknown>;
  venda: Record<string, unknown> | null;
  cliente: Record<string, unknown> | null;
}

/** Carrega a conta a receber com a venda e o cliente dela. */
export async function carregarContexto(
  tenantId: string,
  contaReceberId: string,
): Promise<ContextoDaNota | null> {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT data FROM contas_receber WHERE id = $1 AND tenant_id = $2`,
    [contaReceberId, tenantId],
  );
  if (rows.length === 0) return null;
  const conta = rows[0].data as Record<string, unknown>;

  const vendaId = String(conta.origem_venda_id || conta.venda_id || '');
  let venda: Record<string, unknown> | null = null;
  if (vendaId) {
    const r = await pool.query(
      `SELECT data FROM vendas_crm WHERE id = $1 AND tenant_id = $2`,
      [vendaId, tenantId],
    );
    venda = (r.rows[0]?.data ?? null) as Record<string, unknown> | null;
  }

  const clienteId = String(conta.cliente_id || venda?.cliente_id || '');
  let cliente: Record<string, unknown> | null = null;
  if (clienteId) {
    const r = await pool.query(
      `SELECT data FROM clientes WHERE id = $1 AND tenant_id = $2`,
      [clienteId, tenantId],
    );
    cliente = (r.rows[0]?.data ?? null) as Record<string, unknown> | null;
  }
  return { conta, venda, cliente };
}

/**
 * Quanto o cliente pagou nesta parcela.
 *
 * A nota acompanha o dinheiro que entrou, não o que foi prometido: numa conta
 * paga em parte, a nota é do valor recebido. Conta quitada sem valor_recebido
 * gravado (lançamento antigo) vale pelo valor da conta.
 */
export function valorRecebidoDaConta(conta: Record<string, unknown>): number {
  const recebido = round2(num(conta.valor_recebido));
  if (recebido > 0) return recebido;
  if (String(conta.status ?? '') === 'RECEBIDO') return round2(num(conta.valor_final));
  return 0;
}

export interface PreviaDaNota {
  pode_emitir: boolean;
  pendencias: string[];
  avisos: string[];
  erros: string[];
  regime: RegimeNota;
  forma_base: FormaBaseIntermediacao;
  valor_recebido: number;
  valor_total_venda: number;
  custo_fornecedores: number;
  valor_servicos: number;
  valor_deducoes: number;
  base_calculo: number;
  aliquota_iss: number;
  valor_iss: number;
  valor_liquido: number;
  comissao_da_parcela: number;
  repasse_da_parcela: number;
  discriminacao: string;
  tomador: TomadorNota;
  /** Nota já emitida para esta conta, quando existe. */
  nota_existente: NotaFiscal | null;
}

export interface OpcoesDaNota {
  regime?: RegimeNota;
  forma_base?: FormaBaseIntermediacao;
  discriminacao?: string;
  aliquota_iss?: number;
  iss_retido?: boolean;
  deducao_manual?: number | null;
  desconto_incondicionado?: number;
  intermediario?: IntermediarioNota | null;
}

/**
 * Monta a prévia da nota: os números que vão sair, as pendências que impedem
 * e os avisos que quem emite precisa ler antes de clicar.
 */
export async function montarPrevia(
  tenantId: string,
  contaReceberId: string,
  opcoes: OpcoesDaNota = {},
): Promise<PreviaDaNota | null> {
  const ctx = await carregarContexto(tenantId, contaReceberId);
  if (!ctx) return null;
  const config = await carregarConfigFiscal(tenantId);
  const emitente = await carregarEmitente(tenantId);
  const notaExistente = await notaDaConta(tenantId, contaReceberId);

  const valorRecebido = valorRecebidoDaConta(ctx.conta);
  const valorTotalVenda = round2(
    num(ctx.venda?.valor_final) || num(ctx.venda?.valor_total_venda) || num(ctx.venda?.valor_total),
  );
  const custo = round2(num(ctx.venda?.valor_total_custo) || num(ctx.venda?.custo_total));

  const regime = opcoes.regime
    ?? (config.regime_padrao === 'INTERMEDIACAO'
      ? regimeSugerido(valorTotalVenda, custo)
      : config.regime_padrao);
  const formaBase = opcoes.forma_base ?? config.forma_base_intermediacao;
  const aliquota = opcoes.aliquota_iss ?? config.aliquota_iss;
  const issRetido = opcoes.iss_retido ?? config.iss_retido_padrao;

  const calculo = calcularNota({
    regime,
    forma_base: formaBase,
    valor_recebido: valorRecebido,
    valor_total_venda: valorTotalVenda,
    custo_fornecedores: custo,
    aliquota_iss: aliquota,
    iss_retido: issRetido,
    desconto_incondicionado: opcoes.desconto_incondicionado ?? 0,
    deducao_manual: opcoes.deducao_manual ?? null,
  });

  const tomador = tomadorDoCliente(ctx.cliente);
  const pendencias = pendenciasParaEmitir({
    provedor: config.provedor,
    temCertificado: Boolean(config.certificado?.referencia_gateway),
    certificadoValidoAte: config.certificado?.validade_fim,
    hoje: hojeISO(),
    item_lista_servico: config.item_lista_servico,
    cnae: config.cnae,
    aliquota_iss: aliquota,
    emitente_cnpj: emitente.cnpj,
    emitente_inscricao_municipal: emitente.inscricao_municipal,
    tomador_documento: tomador.cpf_cnpj,
    tomador_nome: tomador.razao_social,
  });

  const totalParcelas = Math.max(1, Math.floor(num(ctx.conta.total_parcelas)) || 1);
  const numeroParcela = Math.max(1, Math.floor(num(ctx.conta.parcela_numero)) || 1);
  const discriminacao = opcoes.discriminacao
    ?? montarDiscriminacao(config.discriminacao_padrao, {
      cliente: tomador.razao_social,
      venda: String(ctx.venda?.numero ?? ctx.venda?.id ?? ''),
      parcela: totalParcelas > 1 ? `(parcela ${numeroParcela}/${totalParcelas})` : '',
      descricao: String(ctx.conta.descricao ?? ''),
      repasse: calculo.repasse_da_parcela.toFixed(2),
    });

  return {
    pode_emitir: pendencias.length === 0 && calculo.erros.length === 0 && !notaExistente,
    pendencias,
    avisos: calculo.avisos,
    erros: calculo.erros,
    regime,
    forma_base: formaBase,
    valor_recebido: valorRecebido,
    valor_total_venda: valorTotalVenda,
    custo_fornecedores: custo,
    valor_servicos: calculo.valor_servicos,
    valor_deducoes: calculo.valor_deducoes,
    base_calculo: calculo.base_calculo,
    aliquota_iss: calculo.aliquota_iss,
    valor_iss: calculo.valor_iss,
    valor_liquido: calculo.valor_liquido,
    comissao_da_parcela: calculo.comissao_da_parcela,
    repasse_da_parcela: calculo.repasse_da_parcela,
    discriminacao,
    tomador,
    nota_existente: notaExistente,
  };
}

/** Nota viva (não rejeitada, não cancelada) de uma conta a receber. */
export async function notaDaConta(
  tenantId: string,
  contaReceberId: string,
): Promise<NotaFiscal | null> {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT data FROM notas_fiscais
      WHERE tenant_id = $1 AND conta_receber_id = $2
        AND status IN ('RASCUNHO', 'PROCESSANDO', 'AUTORIZADA')
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, contaReceberId],
  );
  return (rows[0]?.data ?? null) as NotaFiscal | null;
}

async function gravarNota(tenantId: string, nota: NotaFiscal): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO notas_fiscais
       (id, tenant_id, conta_receber_id, venda_id, cliente_id, status, referencia_gateway, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status,
           referencia_gateway = EXCLUDED.referencia_gateway,
           data = EXCLUDED.data,
           updated_at = NOW()
     WHERE notas_fiscais.tenant_id = EXCLUDED.tenant_id`,
    [
      nota.id, tenantId, nota.conta_receber_id, nota.venda_id, nota.cliente_id,
      nota.status, nota.protocolo || '', JSON.stringify(nota),
    ],
  );
}

/** Erro de duplicidade do índice único, traduzido para quem usa. */
function ehDuplicata(e: unknown): boolean {
  return Boolean(
    e && typeof e === 'object'
    && String((e as { code?: string }).code ?? '') === '23505',
  );
}

/**
 * Emite a nota de uma conta a receber.
 *
 * A nota é gravada ANTES de falar com o gateway, com status PROCESSANDO. Se a
 * transmissão falhar, o registro fica com o motivo em vez de desaparecer —
 * uma emissão que some sem deixar rastro é a pior falha possível aqui, porque
 * ninguém sabe se a nota saiu ou não.
 */
export async function emitirNota(
  tenantId: string,
  contaReceberId: string,
  opcoes: OpcoesDaNota,
  autor: { id: string; nome: string },
): Promise<NotaFiscal> {
  const previa = await montarPrevia(tenantId, contaReceberId, opcoes);
  if (!previa) throw new ErroFiscal('Conta a receber não encontrada.');
  if (previa.nota_existente) {
    throw new ErroFiscal(
      'Esta parcela já tem nota emitida. Cancele a nota atual antes de emitir outra.',
    );
  }
  if (previa.pendencias.length > 0) {
    throw new ErroFiscal(previa.pendencias.join(' '));
  }
  if (previa.erros.length > 0) {
    throw new ErroFiscal(previa.erros.join(' '));
  }

  const config = await carregarConfigFiscal(tenantId);
  const emitente = await carregarEmitente(tenantId);
  const ctx = await carregarContexto(tenantId, contaReceberId);
  const agora = new Date().toISOString();

  const nota: NotaFiscal = {
    id: generateId(),
    conta_receber_id: contaReceberId,
    venda_id: String(ctx?.conta.origem_venda_id || ctx?.conta.venda_id || ''),
    cliente_id: String(ctx?.conta.cliente_id || ''),
    tomador: previa.tomador,
    regime: previa.regime,
    forma_base: previa.forma_base,
    intermediario: opcoes.intermediario ?? config.intermediario_padrao,
    valor_recebido: previa.valor_recebido,
    valor_servicos: previa.valor_servicos,
    valor_deducoes: previa.valor_deducoes,
    desconto_incondicionado: opcoes.desconto_incondicionado ?? 0,
    base_calculo: previa.base_calculo,
    aliquota_iss: previa.aliquota_iss,
    valor_iss: previa.valor_iss,
    iss_retido: opcoes.iss_retido ?? config.iss_retido_padrao,
    valor_liquido: previa.valor_liquido,
    discriminacao: previa.discriminacao,
    item_lista_servico: config.item_lista_servico,
    codigo_tributacao_municipio: config.codigo_tributacao_municipio,
    cnae: config.cnae,
    serie_rps: config.serie_rps,
    status: 'PROCESSANDO',
    ambiente: config.ambiente,
    numero: '', codigo_verificacao: '', protocolo: '',
    link_pdf: '', link_xml: '', erro: '',
    emitida_em: agora,
    autorizada_em: '', cancelada_em: '', motivo_cancelamento: '',
    emitida_por: autor.nome || autor.id,
  };

  try {
    await gravarNota(tenantId, nota);
  } catch (e) {
    if (ehDuplicata(e)) {
      throw new ErroFiscal('Esta parcela já tem nota emitida.');
    }
    throw e;
  }

  const emissor = emissorDaConfig(config);
  try {
    const r = await emissor.emitir({ nota, config, emitente });
    const atualizada: NotaFiscal = {
      ...nota,
      status: r.status,
      numero: r.numero || nota.numero,
      codigo_verificacao: r.codigo_verificacao || nota.codigo_verificacao,
      protocolo: r.protocolo || r.referencia || nota.protocolo,
      link_pdf: r.link_pdf, link_xml: r.link_xml,
      erro: r.erro,
      autorizada_em: r.status === 'AUTORIZADA' ? new Date().toISOString() : '',
    };
    await gravarNota(tenantId, atualizada);
    return atualizada;
  } catch (e) {
    const rejeitada: NotaFiscal = {
      ...nota,
      status: 'REJEITADA',
      erro: e instanceof Error ? e.message : 'Falha ao transmitir a nota.',
    };
    await gravarNota(tenantId, rejeitada);
    return rejeitada;
  }
}

/** Pergunta ao gateway em que pé está uma nota que ficou PROCESSANDO. */
export async function atualizarStatus(
  tenantId: string,
  notaId: string,
): Promise<NotaFiscal | null> {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT data FROM notas_fiscais WHERE id = $1 AND tenant_id = $2`,
    [notaId, tenantId],
  );
  const nota = (rows[0]?.data ?? null) as NotaFiscal | null;
  if (!nota) return null;
  if (nota.status !== 'PROCESSANDO') return nota;

  const config = await carregarConfigFiscal(tenantId);
  const emissor = emissorDaConfig(config);
  const referencia = nota.protocolo || nota.id;
  const r = await emissor.consultar(referencia, config);
  const atualizada: NotaFiscal = {
    ...nota,
    status: r.status,
    numero: r.numero || nota.numero,
    codigo_verificacao: r.codigo_verificacao || nota.codigo_verificacao,
    link_pdf: r.link_pdf || nota.link_pdf,
    link_xml: r.link_xml || nota.link_xml,
    erro: r.erro || nota.erro,
    autorizada_em:
      r.status === 'AUTORIZADA' && !nota.autorizada_em
        ? new Date().toISOString()
        : nota.autorizada_em,
  };
  await gravarNota(tenantId, atualizada);
  return atualizada;
}

/**
 * Cancela a nota na prefeitura.
 *
 * Nota fiscal não se apaga: ela é cancelada, com motivo e data, e o registro
 * continua no sistema. Apagar a linha destruiria a trilha de um documento que
 * a prefeitura tem do outro lado.
 */
export async function cancelarNota(
  tenantId: string,
  notaId: string,
  motivo: string,
): Promise<NotaFiscal> {
  if (!pool) throw new ErroFiscal('Banco indisponível.');
  const { rows } = await pool.query(
    `SELECT data FROM notas_fiscais WHERE id = $1 AND tenant_id = $2`,
    [notaId, tenantId],
  );
  const nota = (rows[0]?.data ?? null) as NotaFiscal | null;
  if (!nota) throw new ErroFiscal('Nota não encontrada.');
  if (nota.status === 'CANCELADA') return nota;
  if (!motivo.trim()) throw new ErroFiscal('Informe o motivo do cancelamento.');

  const config = await carregarConfigFiscal(tenantId);

  // Nota que nunca chegou à prefeitura não precisa ser cancelada lá.
  if (nota.status === 'REJEITADA' || nota.status === 'RASCUNHO') {
    const local: NotaFiscal = {
      ...nota,
      status: 'CANCELADA',
      cancelada_em: new Date().toISOString(),
      motivo_cancelamento: motivo.trim(),
    };
    await gravarNota(tenantId, local);
    return local;
  }

  const emissor = emissorDaConfig(config);
  await emissor.cancelar(nota.protocolo || nota.id, motivo.trim(), config);
  const cancelada: NotaFiscal = {
    ...nota,
    status: 'CANCELADA',
    cancelada_em: new Date().toISOString(),
    motivo_cancelamento: motivo.trim(),
  };
  await gravarNota(tenantId, cancelada);
  return cancelada;
}

export async function listarNotas(tenantId: string): Promise<NotaFiscal[]> {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT data FROM notas_fiscais WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 500`,
    [tenantId],
  );
  return rows.map(r => r.data as NotaFiscal);
}

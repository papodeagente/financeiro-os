/**
 * ENVIO AGENDADO DE RELATÓRIO E LINK DE LEITURA (E7, G3), servidor.
 *
 * Cada envio: monta o relatório com os filtros salvos e o período do envio,
 * com os direitos de QUEM CRIOU o agendamento (gravados na criação: ver o
 * ganho da agência, só as próprias vendas); guarda uma cópia atrás de um link
 * de leitura (token sorteado, só o hash no banco, validade, revogável); e
 * pede ao CRM que mande o e-mail (evento RELATORIO_ENVIAR, pelo mesmo
 * `emitirEventoCRM` da cobrança). Sem CRM ligado, o link fica na tela e no
 * sino. Respeita "nada sai": durante a mudança de sistema, nada é enviado.
 *
 * Tarefa do agendador: `tarefaRelatoriosAgendados` (registrar em
 * src/lib/agendador/tarefas.ts).
 */
import { randomBytes } from 'node:crypto';
import type { ExecutorSQL } from '../caixa-atomico';
import { nadaSai } from '../nada-sai';
import { mudancaSegurandoSaidas } from '../migracao/estado';
import { crmLigado } from '../cobranca/crm';
import { cifrar, cofreDisponivel, decifrar } from '../cofre';
import { criarNotificacao } from '../notificacoes';
import { getDefaultPublicBase } from '../proposta-link';
import { janelaDeMinutos, type DefinicaoTarefa } from '../agendador/nucleo';
import { documentoDoRelatorio, lerConsulta, montarRelatorioDeVendas } from '../relatorios-vendas-servidor';
import type { DocumentoExportado } from '../exportacao/documento';
import { payloadDoEnvio } from './payload';
import { documentoFinanceiroDoAgendamento, ehRelatorioFinanceiro, SemDireitoNoEnvio } from './financeiro-servidor';
import { hashDoTokenDeLeitura, novoTokenDeLeitura } from './token';
import {
  LIMITES_DO_AGENDAMENTO, brasilia, descricaoDoAgendamento, periodoDoEnvio, proximoEnvio,
  situacaoDoLink, tokenTemFormato, urlDaLeitura,
  resultadoDoEnvioDoRelatorio, type DadosDoAgendamento, type FormatoDoAnexo, type Frequencia, type PeriodoDoEnvio, type RelatorioAgendavel, type SituacaoDoLink,
} from './regras';

export const EVENTO_CRM_RELATORIO = 'RELATORIO_ENVIAR';

const rotuloDoPeriodoCurto = (de: string, ate: string) => (de === ate ? `dia ${de.split('-').reverse().join('/')}` : `de ${de.split('-').reverse().join('/')} a ${ate.split('-').reverse().join('/')}`);

type Linha = Record<string, unknown>;
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : null);
const novoId = (p: string) => `${p}-${randomBytes(9).toString('base64url')}`;

export interface Agendamento extends DadosDoAgendamento {
  id: string;
  tenant_id: string;
  criado_por: string;
  criado_por_nome: string;
  ver_receita: boolean;
  vendedor_id: string | null;
  proximo_envio: string | null;
  ultimo_envio: string | null;
  ultimo_resultado: string;
  descricao: string;
}

export interface AutorDoAgendamento { id: string; nome: string; verReceita: boolean; vendedorId: string | null }

function agendamentoDaLinha(r: Linha): Agendamento {
  const dados = {
    nome: txt(r.nome), relatorio: txt(r.relatorio) as RelatorioAgendavel, consulta: txt(r.consulta),
    frequencia: txt(r.frequencia) as Frequencia, dia_semana: Number(r.dia_semana), dia_mes: Number(r.dia_mes), hora: Number(r.hora),
    periodo: txt(r.periodo) as PeriodoDoEnvio, formato: txt(r.formato) as FormatoDoAnexo,
    destinatarios: Array.isArray(r.destinatarios) ? (r.destinatarios as unknown[]).map(String) : JSON.parse(txt(r.destinatarios) || '[]'),
    validade_dias: Number(r.validade_dias), ativo: r.ativo === true || r.ativo === 't',
  };
  return {
    ...dados, id: txt(r.id), tenant_id: txt(r.tenant_id), criado_por: txt(r.criado_por), criado_por_nome: txt(r.criado_por_nome),
    ver_receita: r.ver_receita === true || r.ver_receita === 't', vendedor_id: r.vendedor_id ? txt(r.vendedor_id) : null,
    proximo_envio: iso(r.proximo_envio), ultimo_envio: iso(r.ultimo_envio), ultimo_resultado: txt(r.ultimo_resultado),
    descricao: descricaoDoAgendamento(dados),
  };
}

export async function listarAgendamentos(exec: ExecutorSQL, tenantId: string): Promise<Agendamento[]> {
  const { rows } = await exec.query(`SELECT * FROM relatorios_agendados WHERE tenant_id = $1 ORDER BY ativo DESC, nome`, [tenantId]);
  return rows.map(agendamentoDaLinha);
}

export async function lerAgendamento(exec: ExecutorSQL, tenantId: string, id: string): Promise<Agendamento | null> {
  const { rows } = await exec.query(`SELECT * FROM relatorios_agendados WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return rows.length ? agendamentoDaLinha(rows[0]) : null;
}

/** Cria ou altera. Os direitos gravados são os de quem salva por último. */
export async function salvarAgendamento(
  exec: ExecutorSQL, tenantId: string, id: string | null, d: DadosDoAgendamento, autor: AutorDoAgendamento, agora: Date,
): Promise<Agendamento> {
  const proximo = d.ativo ? proximoEnvio(d, agora).toISOString() : null;
  const valores = [d.nome, d.relatorio, d.consulta, d.frequencia, d.dia_semana, d.dia_mes, d.hora, d.periodo, d.formato,
    JSON.stringify(d.destinatarios), d.validade_dias, d.ativo, autor.id, autor.nome, autor.verReceita, autor.vendedorId, proximo];
  if (id) {
    const { rows } = await exec.query(
      `UPDATE relatorios_agendados SET nome = $3, relatorio = $4, consulta = $5, frequencia = $6, dia_semana = $7, dia_mes = $8, hora = $9,
         periodo = $10, formato = $11, destinatarios = $12::jsonb, validade_dias = $13, ativo = $14, criado_por = $15, criado_por_nome = $16,
         ver_receita = $17, vendedor_id = $18, proximo_envio = $19, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id, ...valores],
    );
    if (!rows.length) throw new ErroDoAgendamento('NAO_ACHOU', 'Envio agendado não encontrado.', 404);
    return agendamentoDaLinha(rows[0]);
  }
  const { rows } = await exec.query(
    `INSERT INTO relatorios_agendados (tenant_id, id, nome, relatorio, consulta, frequencia, dia_semana, dia_mes, hora, periodo, formato,
       destinatarios, validade_dias, ativo, criado_por, criado_por_nome, ver_receita, vendedor_id, proximo_envio)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18, $19) RETURNING *`,
    [tenantId, novoId('ra'), ...valores],
  );
  return agendamentoDaLinha(rows[0]);
}

export async function alterarAtivo(exec: ExecutorSQL, tenantId: string, id: string, ativo: boolean, agora: Date): Promise<Agendamento> {
  const a = await lerAgendamento(exec, tenantId, id);
  if (!a) throw new ErroDoAgendamento('NAO_ACHOU', 'Envio agendado não encontrado.', 404);
  const proximo = ativo ? proximoEnvio(a, agora).toISOString() : null;
  const { rows } = await exec.query(
    `UPDATE relatorios_agendados SET ativo = $3, proximo_envio = $4, updated_at = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, id, ativo, proximo],
  );
  return agendamentoDaLinha(rows[0]);
}

/** Apaga o agendamento e revoga todos os links dele. */
export async function apagarAgendamento(exec: ExecutorSQL, tenantId: string, id: string, usuario: string): Promise<boolean> {
  await exec.query(`UPDATE relatorios_leituras SET revogado_em = NOW(), revogado_por = $3 WHERE tenant_id = $1 AND agendamento_id = $2 AND revogado_em IS NULL`, [tenantId, id, usuario]);
  const { rows } = await exec.query(`DELETE FROM relatorios_agendados WHERE tenant_id = $1 AND id = $2 RETURNING id`, [tenantId, id]);
  return rows.length > 0;
}

export class ErroDoAgendamento extends Error {
  codigo: string;
  status: number;
  constructor(codigo: string, mensagem: string, status = 400) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status;
  }
}

// ============================================================
// Relatório do envio
// ============================================================

/**
 * Monta o documento do relatório agendado para o período, com os direitos de
 * quem criou. Vendas: os direitos gravados ao salvar. DRE, fluxo e visão
 * geral: os direitos de hoje de quem salvou (financeiro-servidor.ts).
 */
export async function documentoDoAgendamento(
  exec: ExecutorSQL, tenantId: string, a: Pick<Agendamento, 'relatorio' | 'consulta' | 'ver_receita' | 'vendedor_id'> & { criado_por?: string },
  de: string, ate: string, hoje?: string,
): Promise<DocumentoExportado> {
  if (ehRelatorioFinanceiro(a.relatorio)) {
    const doc = await documentoFinanceiroDoAgendamento(exec, tenantId, { relatorio: a.relatorio, consulta: a.consulta, criado_por: a.criado_por ?? '' }, de, ate, hoje ?? ate);
    return limitarLinhas(doc);
  }
  if (a.relatorio !== 'vendas') throw new ErroDoAgendamento('RELATORIO', 'Relatório desconhecido.');
  const q = new URLSearchParams(a.consulta);
  q.set('de', de);
  q.set('ate', ate);
  const lida = lerConsulta(q);
  if (!lida.ok) throw new ErroDoAgendamento('CONSULTA', lida.erro);
  const r = await montarRelatorioDeVendas(exec, tenantId, lida.consulta, { verReceita: a.ver_receita, vendedorId: a.vendedor_id ?? undefined });
  return limitarLinhas(documentoDoRelatorio(r, lida.consulta));
}

/** O link guarda até LIMITES_DO_AGENDAMENTO.linhasNoLink linhas (o total considera todas). */
function limitarLinhas(doc: DocumentoExportado): DocumentoExportado {
  if (doc.linhas.length > LIMITES_DO_AGENDAMENTO.linhasNoLink) {
    return {
      ...doc, linhas: doc.linhas.slice(0, LIMITES_DO_AGENDAMENTO.linhasNoLink),
      nota: `${doc.nota ? `${doc.nota} ` : ''}Mostrando as primeiras ${LIMITES_DO_AGENDAMENTO.linhasNoLink.toLocaleString('pt-BR')} de ${doc.linhas.length.toLocaleString('pt-BR')} linhas; o total considera todas.`,
    };
  }
  return doc;
}

// ============================================================
// Link de leitura
// ============================================================

export interface LeituraCriada { id: string; token: string; url: string; expira_em: string }

export async function criarLeitura(
  exec: ExecutorSQL, tenantId: string, agendamentoId: string | null, doc: DocumentoExportado, validadeDias: number, agora: Date, base?: string,
): Promise<LeituraCriada> {
  const token = novoTokenDeLeitura();
  const id = novoId('rl');
  const expira = new Date(agora.getTime() + validadeDias * 86_400_000).toISOString();
  const cifrado = cofreDisponivel() ? JSON.stringify(cifrar(token)) : null;
  await exec.query(
    `INSERT INTO relatorios_leituras (id, tenant_id, agendamento_id, token_hash, token_cifrado, titulo, documento, criado_em, expira_em)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9)`,
    [id, tenantId, agendamentoId, hashDoTokenDeLeitura(token), cifrado, doc.titulo, JSON.stringify(doc), agora.toISOString(), expira],
  );
  return { id, token, url: urlDaLeitura(base || getDefaultPublicBase(), token), expira_em: expira };
}

export interface LeituraPublica { id: string; tenant_id: string; titulo: string; documento: DocumentoExportado; criado_em: string; expira_em: string; agencia: string }

/** O link pelo token: só se existir, estiver valendo e não revogado. Conta o acesso. */
export async function acharLeitura(exec: ExecutorSQL, token: string, agora: Date, contar = true): Promise<LeituraPublica | null> {
  if (!tokenTemFormato(token)) return null;
  const { rows } = await exec.query(`SELECT * FROM relatorios_leituras WHERE token_hash = $1`, [hashDoTokenDeLeitura(token)]);
  const r = rows[0];
  if (!r || situacaoDoLink({ expira_em: r.expira_em as string, revogado_em: (r.revogado_em as string) ?? null }, agora) !== 'valendo') return null;
  if (contar) await exec.query(`UPDATE relatorios_leituras SET acessos = acessos + 1, ultimo_acesso = $2 WHERE id = $1`, [r.id, agora.toISOString()]);
  const { rows: ag } = await exec.query(`SELECT data->>'nome_fantasia' AS f, data->>'razao_social' AS r, data->>'nome' AS n FROM agencia WHERE tenant_id = $1 LIMIT 1`, [r.tenant_id])
    .catch(() => ({ rows: [] as Linha[] }));
  const doc = (typeof r.documento === 'string' ? JSON.parse(r.documento) : r.documento) as DocumentoExportado;
  return {
    id: txt(r.id), tenant_id: txt(r.tenant_id), titulo: txt(r.titulo), documento: doc,
    criado_em: iso(r.criado_em)!, expira_em: iso(r.expira_em)!, agencia: txt(ag[0]?.f || ag[0]?.r || ag[0]?.n),
  };
}

export interface LeituraDaLista { id: string; titulo: string; criado_em: string; expira_em: string; situacao: SituacaoDoLink; acessos: number; ultimo_acesso: string | null; url: string | null }

/** O endereço do link guardado pelo cofre (null se não houver cofre ou não abrir). */
function urlGuardada(cifrado: unknown, base?: string): string | null {
  if (!cifrado) return null;
  try {
    return urlDaLeitura(base || getDefaultPublicBase(), decifrar(typeof cifrado === 'string' ? JSON.parse(cifrado) : cifrado));
  } catch {
    return null;
  }
}

/** Os links de um envio. `comEndereco`: o endereço dos que valem (para quem pode mandar o relatório). */
export async function listarLeituras(exec: ExecutorSQL, tenantId: string, agendamentoId: string, agora: Date, comEndereco = false): Promise<LeituraDaLista[]> {
  const { rows } = await exec.query(
    `SELECT id, titulo, criado_em, expira_em, revogado_em, acessos, ultimo_acesso, token_cifrado FROM relatorios_leituras
      WHERE tenant_id = $1 AND agendamento_id = $2 ORDER BY criado_em DESC LIMIT 30`,
    [tenantId, agendamentoId],
  );
  return rows.map(r => {
    const situacao = situacaoDoLink({ expira_em: r.expira_em as string, revogado_em: (r.revogado_em as string) ?? null }, agora);
    return {
      id: txt(r.id), titulo: txt(r.titulo), criado_em: iso(r.criado_em)!, expira_em: iso(r.expira_em)!, situacao,
      acessos: Number(r.acessos) || 0, ultimo_acesso: iso(r.ultimo_acesso),
      url: comEndereco && situacao === 'valendo' ? urlGuardada(r.token_cifrado) : null,
    };
  });
}

export async function revogarLeitura(exec: ExecutorSQL, tenantId: string, id: string, usuario: string): Promise<boolean> {
  const { rows } = await exec.query(
    `UPDATE relatorios_leituras SET revogado_em = NOW(), revogado_por = $3 WHERE tenant_id = $1 AND id = $2 AND revogado_em IS NULL RETURNING id`,
    [tenantId, id, usuario],
  );
  return rows.length > 0;
}

// ============================================================
// Envio
// ============================================================

export interface ResultadoDoEnvio {
  situacao: 'enviado' | 'na_fila' | 'so_link' | 'pulado' | 'falhou';
  canal: 'crm' | 'link' | '';
  detalhe: string;
  url?: string;
  expira_em?: string;
  de?: string;
  ate?: string;
  linhas?: number;
}

const FRASE: Record<ResultadoDoEnvio['situacao'], string> = {
  enviado: 'Enviado pelo CRM',
  na_fila: 'Na fila do CRM',
  so_link: 'Link de leitura pronto (CRM não ligado)',
  pulado: 'Não enviado',
  falhou: 'Falhou',
};

/**
 * Monta e envia UM relatório agendado. `previsto` identifica o envio da
 * agenda (o mesmo envio não sai duas vezes); `manual` é o "Enviar agora".
 */
export async function enviarAgendamento(
  exec: ExecutorSQL, a: Agendamento, agora: Date, opcoes: { previsto?: Date | null; manual?: boolean; base?: string } = {},
): Promise<ResultadoDoEnvio> {
  const tenantId = a.tenant_id;
  const previsto = opcoes.previsto ?? null;
  const registrar = async (r: ResultadoDoEnvio, leituraId: string | null) => {
    await exec.query(
      `INSERT INTO relatorios_envios (id, tenant_id, agendamento_id, previsto_para, de, ate, canal, situacao, detalhe, leitura_id, linhas, manual)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT DO NOTHING`,
      [novoId('re'), tenantId, a.id, previsto ? previsto.toISOString() : null, r.de ?? '', r.ate ?? '', r.canal, r.situacao, r.detalhe.slice(0, 500), leituraId, r.linhas ?? 0, Boolean(opcoes.manual)],
    );
    await exec.query(
      `UPDATE relatorios_agendados SET ultimo_envio = $3, ultimo_resultado = $4 WHERE tenant_id = $1 AND id = $2`,
      [tenantId, a.id, agora.toISOString(), `${FRASE[r.situacao]}${r.detalhe ? `: ${r.detalhe}` : ''}`.slice(0, 300)],
    );
    return r;
  };

  const motivo = nadaSai() ?? (await mudancaSegurandoSaidas(exec, tenantId));
  if (motivo) return registrar({ situacao: 'pulado', canal: '', detalhe: `nada sai durante ${motivo}` }, null);

  // Quem criou ainda está na agência? Sem a pessoa, o envio para (os direitos eram dela).
  const { rows: pessoa } = await exec.query(
    `SELECT 1 FROM usuarios WHERE id = $1 AND (tenant_id = $2 OR tenant_id = '') AND COALESCE(data->>'ativo', 'true') <> 'false' LIMIT 1`,
    [a.criado_por, tenantId],
  ).catch(() => ({ rows: [] as Linha[] }));
  if (a.criado_por && !pessoa.length) {
    return registrar({ situacao: 'pulado', canal: '', detalhe: `${a.criado_por_nome || 'quem criou'} não está mais ativo na agência; salve o envio de novo com outra pessoa` }, null);
  }

  const dia = brasilia(previsto ?? agora).data;
  const { de, ate } = periodoDoEnvio(a.periodo, dia);
  let leitura: LeituraCriada;
  let doc: DocumentoExportado;
  try {
    doc = await documentoDoAgendamento(exec, tenantId, a, de, ate, dia);
    leitura = await criarLeitura(exec, tenantId, a.id, doc, a.validade_dias, agora, opcoes.base);
  } catch (e) {
    // Quem salvou perdeu o direito (ou a conta salva sumiu): não envia e fica o motivo.
    if (e instanceof SemDireitoNoEnvio) return registrar({ situacao: 'pulado', canal: '', detalhe: e.message, de, ate }, null);
    return registrar({ situacao: 'falhou', canal: '', detalhe: e instanceof Error ? e.message : 'erro ao montar', de, ate }, null);
  }
  const base = { url: leitura.url, expira_em: leitura.expira_em, de, ate, linhas: doc.linhas.length };

  if (!(await crmLigado(exec, tenantId))) {
    // Sem CRM, o sino avisa que o link está pronto (o endereço fica na tela de envios, para quem pode mandar).
    if (!opcoes.manual) {
      await criarNotificacao({
        tenantId, tipo: 'RELATORIO_AGENDADO_PRONTO',
        titulo: `Relatório pronto: ${a.nome}`,
        descricao: `${doc.titulo}, ${rotuloDoPeriodoCurto(de, ate)}. O CRM não está ligado: copie o link de leitura e mande para ${a.destinatarios.length === 1 ? a.destinatarios[0] : `${a.destinatarios.length} pessoas`}.`,
        link: `/relatorios/envios?abrir=${encodeURIComponent(a.id)}`,
        data: { agendamento_id: a.id, leitura_id: leitura.id }, chaveDeduplicacao: `relatorio-pronto:${leitura.id}`,
      }, exec).catch(() => undefined);
    }
    return registrar({ ...base, situacao: 'so_link', canal: 'link', detalhe: '' }, leitura.id);
  }
  const { emitirEventoCRM } = await import('../crm-integration');
  const payload = payloadDoEnvio(a, doc, leitura, de, ate);
  const chave = `relatorio:${a.id}:${previsto ? previsto.toISOString() : `manual:${agora.toISOString()}`}`;
  const resposta = await emitirEventoCRM(EVENTO_CRM_RELATORIO, payload as unknown as Record<string, unknown>, { tenantId, idempotency_key: chave });
  const r = resultadoDoEnvioDoRelatorio(resposta);
  return registrar({ ...base, situacao: r.situacao, canal: 'crm', detalhe: r.detalhe }, leitura.id);
}

// ============================================================
// Tarefa do agendador
// ============================================================

/** Os envios vencidos de uma agência: cada um sai uma vez e a agenda anda. */
export async function enviosDaVez(exec: ExecutorSQL, tenantId: string, agora: Date, base?: string): Promise<{ enviados: number; resultados: ResultadoDoEnvio[] }> {
  const { rows } = await exec.query(
    `SELECT * FROM relatorios_agendados WHERE tenant_id = $1 AND ativo AND proximo_envio IS NOT NULL AND proximo_envio <= $2 ORDER BY proximo_envio LIMIT 20`,
    [tenantId, agora.toISOString()],
  );
  const resultados: ResultadoDoEnvio[] = [];
  for (const r of rows) {
    const a = agendamentoDaLinha(r);
    const previsto = new Date(a.proximo_envio!);
    // Anda a agenda primeiro, condicionado ao valor lido: duas chamadas juntas não mandam duas vezes.
    const proximo = proximoEnvio(a, agora > previsto ? agora : previsto).toISOString();
    const { rows: pegou } = await exec.query(
      `UPDATE relatorios_agendados SET proximo_envio = $3 WHERE tenant_id = $1 AND id = $2 AND proximo_envio = $4 RETURNING id`,
      [tenantId, a.id, proximo, r.proximo_envio],
    );
    if (!pegou.length) continue;
    // Atraso grande (servidor parado por dias): manda uma vez só, com a data prevista.
    resultados.push(await enviarAgendamento(exec, a, agora, { previsto, base }));
  }
  return { enviados: resultados.filter(r => r.situacao !== 'pulado' && r.situacao !== 'falhou').length, resultados };
}

export const tarefaRelatoriosAgendados: DefinicaoTarefa = {
  nome: 'relatorios-agendados',
  janela: janelaDeMinutos(15),
  agencias: async ({ exec, agora }) => {
    const { rows } = await exec.query(
      `SELECT DISTINCT tenant_id FROM relatorios_agendados WHERE ativo AND proximo_envio IS NOT NULL AND proximo_envio <= $1 ORDER BY tenant_id`,
      [agora.toISOString()],
    ).catch(() => ({ rows: [] as Linha[] }));
    return rows.map(r => txt(r.tenant_id));
  },
  executar: async ({ exec, agora }, tenantId) => {
    const r = await enviosDaVez(exec, tenantId, agora);
    return { enviados: r.enviados, total: r.resultados.length };
  },
};

/** Histórico dos envios de um agendamento (para a tela). */
export async function historicoDeEnvios(exec: ExecutorSQL, tenantId: string, agendamentoId: string) {
  const { rows } = await exec.query(
    `SELECT id, previsto_para, de, ate, canal, situacao, detalhe, leitura_id, linhas, manual, criado_em FROM relatorios_envios
      WHERE tenant_id = $1 AND agendamento_id = $2 ORDER BY criado_em DESC LIMIT 30`,
    [tenantId, agendamentoId],
  );
  return rows.map(r => ({
    id: txt(r.id), previsto_para: iso(r.previsto_para), de: txt(r.de), ate: txt(r.ate), canal: txt(r.canal), situacao: txt(r.situacao),
    frase: FRASE[txt(r.situacao) as ResultadoDoEnvio['situacao']] ?? txt(r.situacao), detalhe: txt(r.detalhe), leitura_id: r.leitura_id ? txt(r.leitura_id) : null,
    linhas: Number(r.linhas) || 0, manual: r.manual === true || r.manual === 't', criado_em: iso(r.criado_em)!,
  }));
}

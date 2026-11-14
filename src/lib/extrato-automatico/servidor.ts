/**
 * Extrato automático no servidor (06/11/2026, E6 parte B).
 * Plano aprovado: docs/plano-extrato-automatico.md. Regras puras em
 * ./regras.ts; o que é de cada banco, nos adaptadores (./registro.ts).
 *
 * - EXTRATO_AUTOMATICO_SCHEMA_SQL: conexão por conta bancária, segredo
 *   cifrado em tabela própria (um SELECT de diagnóstico na conexão nunca traz
 *   material sensível) e o histórico de leituras.
 * - salvarConexao / desconectar: o certificado, a chave e o ClientSecret vão
 *   para o cofre (AES-256-GCM, ./cofre.ts) e nunca voltam ao navegador.
 * - sincronizarConexao: uma leitura de UMA conta. Serial por conta (índice
 *   único parcial: só uma leitura EXECUTANDO por conexão) e idempotente por
 *   janela (o id da leitura é conexão + hora de Brasília; a mesma janela não
 *   roda duas vezes). As linhas entram pela mesma deduplicação do arquivo.
 * - tarefaExtratoAutomatico: a DefinicaoTarefa do agendador (de hora em
 *   hora). Quem integra registra em src/lib/agendador/tarefas.ts.
 *
 * A chamada ao banco acontece FORA de transação; só a gravação do que veio é
 * transacional. Segredo decifrado só existe dentro de sincronizar/validar.
 */
import type { ExecutorSQL } from '../caixa-atomico';
import { cifrar, decifrar } from '../cofre';
import { criarNotificacao } from '../notificacoes';
import { deCentavos } from '../money';
import { gravarExtratoSincronizado, type LinhaSincronizada } from '../extrato-importacao';
import { horaDeBrasilia, janelaDeMinutos, type DefinicaoTarefa } from '../agendador/nucleo';
import { generateId } from '../utils';
import {
  FalhaColeta, ehFalhaColeta,
  type AmbienteDoAdaptador, type CredencialDecifrada, type JanelaColeta, type SaldoNormalizado, type TransacaoNormalizada,
} from './contrato';
import { adaptadorDe } from './registro';
import { clienteHttpMtls } from './http-mtls';
import {
  MINUTOS_PARA_ABANDONAR, avisoDoCertificado, decidirAposFalha, dividirJanela, janelaDaSincronizacao,
  proximaLeituraAposSucesso, saudeDaConexao, type Saude, type StatusConexao,
} from './regras';

export { EXTRATO_AUTOMATICO_SCHEMA_SQL } from './schema';

export class ErroExtratoAutomatico extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = 'ErroExtratoAutomatico';
  }
}

// ---------------------------------------------------------------------------
// Leitura das conexões (o que a tela vê: nunca o segredo)

export interface ConexaoBancaria {
  id: string;
  conta_bancaria_id: string;
  conta_nome: string;
  provedor: string;
  provedor_nome: string;
  status: StatusConexao;
  apelido: string;
  vezes_por_dia: number;
  expira_em: string | null;
  conta_detectada: string | null;
  ultima_sincronizacao_em: string | null;
  ultima_janela: { de: string; ate: string } | null;
  proxima_sincronizacao_em: string | null;
  falhas_consecutivas: number;
  ultimo_erro: { motivo: string; mensagem: string; em: string } | null;
  saldo_banco: number | null;
  saldo_banco_em: string | null;
  conectada_em: string;
  saude: Saude;
}

type Linha = Record<string, unknown>;

function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
function dia(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  // Colunas DATE são lidas como texto (::text) justamente para não passar
  // por fuso; se vier Date, a parte da data em UTC é a data gravada.
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function paraConexao(r: Linha, agora: Date): ConexaoBancaria {
  const erro = (r.ultimo_erro ?? null) as ConexaoBancaria['ultimo_erro'];
  const provedor = String(r.provedor);
  const de = dia(r.ultima_janela_de);
  const ate = dia(r.ultima_janela_ate);
  const c: Omit<ConexaoBancaria, 'saude'> = {
    id: String(r.id),
    conta_bancaria_id: String(r.conta_bancaria_id),
    conta_nome: String(r.conta_nome ?? ''),
    provedor,
    provedor_nome: adaptadorDe(provedor)?.apresentacao.nome ?? provedor,
    status: String(r.status) as StatusConexao,
    apelido: String(r.apelido ?? ''),
    vezes_por_dia: Number(r.vezes_por_dia ?? 1),
    expira_em: dia(r.expira_em),
    conta_detectada: r.conta_detectada ? String(r.conta_detectada) : null,
    ultima_sincronizacao_em: iso(r.ultima_sincronizacao_em),
    ultima_janela: de && ate ? { de, ate } : null,
    proxima_sincronizacao_em: iso(r.proxima_sincronizacao_em),
    falhas_consecutivas: Number(r.falhas_consecutivas ?? 0),
    ultimo_erro: erro,
    saldo_banco: r.saldo_banco_centavos === null || r.saldo_banco_centavos === undefined ? null : deCentavos(r.saldo_banco_centavos as string),
    saldo_banco_em: dia(r.saldo_banco_em),
    conectada_em: iso(r.conectada_em) ?? '',
  };
  return {
    ...c,
    saude: saudeDaConexao({
      status: c.status,
      ultimaSincronizacaoEm: c.ultima_sincronizacao_em,
      falhasConsecutivas: c.falhas_consecutivas,
      ultimoErro: c.ultimo_erro,
      expiraEm: c.expira_em,
      proximaSincronizacaoEm: c.proxima_sincronizacao_em,
    }, agora),
  };
}

const COLUNAS = `c.id, c.conta_bancaria_id, c.provedor, c.status, c.apelido, c.vezes_por_dia, c.expira_em::text AS expira_em,
  c.conta_detectada, c.ultima_sincronizacao_em, c.ultima_janela_de::text AS ultima_janela_de, c.ultima_janela_ate::text AS ultima_janela_ate,
  c.proxima_sincronizacao_em, c.falhas_consecutivas, c.ultimo_erro, c.saldo_banco_centavos::text AS saldo_banco_centavos,
  c.saldo_banco_em::text AS saldo_banco_em, c.conectada_em, COALESCE(b.data->>'nome', '') AS conta_nome`;

/**
 * Conexões da agência. `contas` = contas liberadas para a pessoa (null =
 * todas): conexão de conta não liberada não aparece.
 */
export async function listarConexoes(exec: ExecutorSQL, tenantId: string, contas: readonly string[] | null, agora = new Date()): Promise<ConexaoBancaria[]> {
  const { rows } = await exec.query(
    `SELECT ${COLUNAS} FROM conexoes_bancarias c
       LEFT JOIN contas_bancarias b ON b.id = c.conta_bancaria_id AND b.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND ($2::text[] IS NULL OR c.conta_bancaria_id = ANY($2::text[]))
      ORDER BY conta_nome, c.id`,
    [tenantId, contas === null ? null : [...contas]],
  );
  return rows.map(r => paraConexao(r, agora));
}

export async function lerConexao(exec: ExecutorSQL, tenantId: string, conexaoId: string, agora = new Date()): Promise<ConexaoBancaria | null> {
  const { rows } = await exec.query(
    `SELECT ${COLUNAS} FROM conexoes_bancarias c
       LEFT JOIN contas_bancarias b ON b.id = c.conta_bancaria_id AND b.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND c.id = $2`,
    [tenantId, conexaoId],
  );
  return rows[0] ? paraConexao(rows[0], agora) : null;
}

export interface LeituraDoHistorico {
  id: string;
  origem: string;
  status: string;
  janela: { de: string; ate: string } | null;
  inseridas: number;
  atualizadas: number;
  duplicadas: number;
  paginas: number;
  motivo: string | null;
  mensagem: string | null;
  iniciada_em: string;
  terminada_em: string | null;
}

export async function historicoDeLeituras(exec: ExecutorSQL, tenantId: string, conexaoId: string, limite = 20): Promise<LeituraDoHistorico[]> {
  const { rows } = await exec.query(
    `SELECT id, origem, status, janela_de::text AS de, janela_ate::text AS ate, inseridas, atualizadas, duplicadas, paginas,
            motivo, mensagem, iniciada_em, terminada_em
       FROM sincronizacoes_bancarias WHERE tenant_id = $1 AND conexao_id = $2
      ORDER BY iniciada_em DESC, id DESC LIMIT $3`,
    [tenantId, conexaoId, Math.min(100, Math.max(1, limite))],
  );
  return rows.map(r => ({
    id: String(r.id), origem: String(r.origem), status: String(r.status),
    janela: r.de && r.ate ? { de: String(r.de), ate: String(r.ate) } : null,
    inseridas: Number(r.inseridas), atualizadas: Number(r.atualizadas), duplicadas: Number(r.duplicadas), paginas: Number(r.paginas),
    motivo: r.motivo ? String(r.motivo) : null, mensagem: r.mensagem ? String(r.mensagem) : null,
    iniciada_em: iso(r.iniciada_em) ?? '', terminada_em: iso(r.terminada_em),
  }));
}

// ---------------------------------------------------------------------------
// Conectar, renovar e desconectar

/** O que a tela manda (os arquivos já lidos como texto no navegador). */
export interface CredencialRecebida {
  clientId?: unknown;
  clientSecret?: unknown;
  certificadoPem?: unknown;
  chavePrivadaPem?: unknown;
  extras?: unknown;
}

export function montarCredencial(c: CredencialRecebida | null | undefined): CredencialDecifrada {
  const extras: Record<string, string> = {};
  if (c?.extras && typeof c.extras === 'object' && !Array.isArray(c.extras)) {
    for (const [k, v] of Object.entries(c.extras as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim() && /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k)) extras[k] = v.trim().slice(0, 200);
    }
  }
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    clientId: s(c?.clientId, 300),
    clientSecret: s(c?.clientSecret, 500),
    certificadoPem: s(c?.certificadoPem, 64_000) || null,
    chavePrivadaPem: s(c?.chavePrivadaPem, 64_000) || null,
    extras,
  };
}

/**
 * Para RENOVAR o certificado: o que não veio na tela (ClientId e
 * ClientSecret, que o banco mantém na renovação) sai do segredo gravado.
 */
export async function completarComSegredoGravado(
  exec: ExecutorSQL, tenantId: string, contaId: string, nova: CredencialDecifrada,
): Promise<CredencialDecifrada> {
  if (nova.clientId && nova.clientSecret) return nova;
  const { rows } = await exec.query(
    `SELECT s.envelope FROM conexoes_bancarias c JOIN conexoes_bancarias_segredo s ON s.conexao_id = c.id AND s.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND c.conta_bancaria_id = $2`,
    [tenantId, contaId],
  );
  if (!rows.length) return nova;
  let antiga: CredencialDecifrada;
  try {
    antiga = JSON.parse(decifrar(rows[0].envelope)) as CredencialDecifrada;
  } catch {
    return nova;
  }
  return {
    clientId: nova.clientId || antiga.clientId,
    clientSecret: nova.clientSecret || antiga.clientSecret,
    certificadoPem: nova.certificadoPem ?? antiga.certificadoPem,
    chavePrivadaPem: nova.chavePrivadaPem ?? antiga.chavePrivadaPem,
    extras: { ...(antiga.extras ?? {}), ...nova.extras },
  };
}

/**
 * Grava (ou renova) a conexão de uma conta, depois de validada no banco.
 * Renovar mantém o id da conexão: o histórico de extrato e de conciliação
 * fica inteiro; só o envelope do segredo é trocado.
 */
export async function salvarConexao(exec: ExecutorSQL, p: {
  tenantId: string;
  contaId: string;
  provedor: string;
  credencial: CredencialDecifrada;
  expiraEm: string | null;
  apelido?: string;
  vezesPorDia?: number;
  contaDetectada?: string | null;
  saldo?: SaldoNormalizado | null;
  usuario?: string;
  agora?: Date;
}): Promise<{ id: string; renovada: boolean }> {
  const adaptador = adaptadorDe(p.provedor);
  if (!adaptador || !adaptador.capacidades.coletaAutomatica) throw new ErroExtratoAutomatico('Este banco ainda não tem leitura automática.', 400);
  const { rows: conta } = await exec.query(`SELECT id FROM contas_bancarias WHERE id = $1 AND tenant_id = $2`, [p.contaId, p.tenantId]);
  if (!conta.length) throw new ErroExtratoAutomatico('Conta bancária não encontrada nesta agência.', 404);
  const envelope = cifrar(JSON.stringify(p.credencial));
  const agora = p.agora ?? new Date();
  const vezes = Math.min(4, Math.max(1, Math.round(p.vezesPorDia ?? 1)));
  const { rows: antes } = await exec.query(`SELECT id FROM conexoes_bancarias WHERE tenant_id = $1 AND conta_bancaria_id = $2`, [p.tenantId, p.contaId]);
  const id = antes[0] ? String(antes[0].id) : generateId();
  await exec.query(
    `INSERT INTO conexoes_bancarias (id, tenant_id, conta_bancaria_id, provedor, status, apelido, vezes_por_dia, expira_em,
        conta_detectada, proxima_sincronizacao_em, falhas_consecutivas, ultimo_erro, saldo_banco_centavos, saldo_banco_em,
        conectada_por, conectada_em, updated_at)
     VALUES ($1, $2, $3, $4, 'ATIVA', $5, $6, $7::date, $8, $9::timestamptz, 0, NULL, $10, $11::date, $12, $9::timestamptz, NOW())
     ON CONFLICT (tenant_id, conta_bancaria_id) DO UPDATE SET
       provedor = EXCLUDED.provedor, status = 'ATIVA', apelido = EXCLUDED.apelido, vezes_por_dia = EXCLUDED.vezes_por_dia,
       expira_em = EXCLUDED.expira_em, conta_detectada = COALESCE(EXCLUDED.conta_detectada, conexoes_bancarias.conta_detectada),
       proxima_sincronizacao_em = EXCLUDED.proxima_sincronizacao_em, falhas_consecutivas = 0, ultimo_erro = NULL,
       saldo_banco_centavos = COALESCE(EXCLUDED.saldo_banco_centavos, conexoes_bancarias.saldo_banco_centavos),
       saldo_banco_em = COALESCE(EXCLUDED.saldo_banco_em, conexoes_bancarias.saldo_banco_em),
       conectada_por = EXCLUDED.conectada_por, conectada_em = EXCLUDED.conectada_em, updated_at = NOW()`,
    [id, p.tenantId, p.contaId, p.provedor, (p.apelido ?? '').trim().slice(0, 80), vezes, p.expiraEm,
      p.contaDetectada ?? null, agora.toISOString(), p.saldo ? p.saldo.disponivelCentavos : null, p.saldo?.apuradoEm ?? null,
      p.usuario ?? null],
  );
  await exec.query(
    `INSERT INTO conexoes_bancarias_segredo (conexao_id, tenant_id, envelope, expira_em, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::date, NOW())
     ON CONFLICT (conexao_id) DO UPDATE SET envelope = EXCLUDED.envelope, expira_em = EXCLUDED.expira_em, updated_at = NOW()
      WHERE conexoes_bancarias_segredo.tenant_id = EXCLUDED.tenant_id`,
    [id, p.tenantId, JSON.stringify(envelope), p.expiraEm],
  );
  return { id, renovada: antes.length > 0 };
}

/** Desconectar apaga o segredo na hora e mantém o extrato já importado. */
export async function desconectar(exec: ExecutorSQL, tenantId: string, conexaoId: string): Promise<boolean> {
  const { rows } = await exec.query(
    `UPDATE conexoes_bancarias SET status = 'DESCONECTADA', proxima_sincronizacao_em = NULL, updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, conexaoId],
  );
  if (!rows.length) return false;
  await exec.query(`DELETE FROM conexoes_bancarias_segredo WHERE tenant_id = $1 AND conexao_id = $2`, [tenantId, conexaoId]);
  return true;
}

// ---------------------------------------------------------------------------
// Sincronizar uma conta

export type ResultadoLeitura =
  | { resultado: 'ok'; sincronizacao_id: string; inseridas: number; atualizadas: number; duplicadas: number; janela: JanelaColeta; parcial: boolean }
  | { resultado: 'falhou'; sincronizacao_id: string | null; motivo: string; mensagem: string; status: StatusConexao }
  | { resultado: 'ja_feita' | 'em_andamento' | 'desconectada' | 'sem_coleta' | 'nao_encontrada'; mensagem: string };

export interface OpcoesLeitura {
  origem: 'agendada' | 'manual';
  ambiente: AmbienteDoAdaptador;
  emTransacao: <T>(fn: (tx: ExecutorSQL) => Promise<T>) => Promise<T>;
  agora?: Date;
  pedidaPor?: string;
  /** Tempo restante para esta leitura, em ms (o agendador passa o dele). */
  restanteMs?: () => number;
}

/** Id da leitura: a mesma conexão na mesma hora (ou no mesmo minuto, se pedida na tela) roda uma vez. */
export function idDaLeitura(conexaoId: string, origem: 'agendada' | 'manual', agora: Date): string {
  const b = horaDeBrasilia(agora);
  const hora = `${b.data}T${String(b.hora).padStart(2, '0')}`;
  return origem === 'agendada'
    ? `ag:${conexaoId}:${hora}`
    : `man:${conexaoId}:${hora}:${String(b.minuto).padStart(2, '0')}`;
}

function paraLinha(t: TransacaoNormalizada): LinhaSincronizada {
  return {
    id_externo: t.idExterno,
    data: t.data,
    valor: deCentavos(t.valorCentavos),
    descricao: t.descricao,
    pendente: t.pendente,
    saldo: t.saldoAposCentavos === null ? null : deCentavos(t.saldoAposCentavos),
    categoria_origem: t.categoriaOrigem,
  };
}

async function avisar(exec: ExecutorSQL, tenantId: string, chave: string, titulo: string, descricao: string): Promise<void> {
  await criarNotificacao({
    tenantId, tipo: 'EXTRATO_AUTOMATICO', titulo, descricao, link: '/financeiro-ag/extrato-automatico', chaveDeduplicacao: chave,
  }, exec);
}

async function registrarFalha(
  exec: ExecutorSQL, tenantId: string, conexao: Linha, sincId: string | null, f: FalhaColeta, agora: Date,
): Promise<ResultadoLeitura> {
  const d = decidirAposFalha({ motivo: f.motivo, falhasAntes: Number(conexao.falhas_consecutivas ?? 0), aguardarSegundos: f.aguardarSegundos, agora });
  const erro = { motivo: f.motivo, mensagem: f.mensagemUsuario, em: agora.toISOString() };
  await exec.query(
    `UPDATE conexoes_bancarias SET status = $3, falhas_consecutivas = $4, proxima_sincronizacao_em = $5::timestamptz,
            ultimo_erro = $6::jsonb, updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2 AND status <> 'DESCONECTADA'`,
    [tenantId, conexao.id, d.status, d.falhasConsecutivas, d.proximaEm ? d.proximaEm.toISOString() : null, JSON.stringify(erro)],
  );
  if (sincId) {
    await exec.query(
      `UPDATE sincronizacoes_bancarias SET status = 'FALHOU', motivo = $3, mensagem = $4, terminada_em = NOW()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, sincId, f.motivo, f.mensagemUsuario],
    );
  }
  if (d.avisar) {
    const nome = String(conexao.conta_nome || 'conta');
    const hoje = horaDeBrasilia(agora).data;
    if (d.status === 'EXPIRADA') {
      await avisar(exec, tenantId, `extrato:expirada:${conexao.id}:${hoje}`, `O extrato automático da ${nome} parou`, `${f.mensagemUsuario} Enquanto isso, dá para importar o arquivo na conciliação.`);
    } else {
      await avisar(exec, tenantId, `extrato:falhas:${conexao.id}:${hoje}`, `O extrato da ${nome} não chega há ${d.falhasConsecutivas} leituras`, f.mensagemUsuario);
    }
  }
  return { resultado: 'falhou', sincronizacao_id: sincId, motivo: f.motivo, mensagem: f.mensagemUsuario, status: d.status };
}

/**
 * Uma leitura da conta: reserva a leitura (serial e única por janela), lê o
 * banco fora de transação, grava o que veio numa transação só.
 */
export async function sincronizarConexao(
  exec: ExecutorSQL, tenantId: string, conexaoId: string, o: OpcoesLeitura,
): Promise<ResultadoLeitura> {
  const agora = o.agora ?? new Date();
  const hoje = horaDeBrasilia(agora).data;
  const { rows } = await exec.query(
    `SELECT c.*, c.expira_em::text AS expira_txt, c.ultima_janela_ate::text AS ultima_ate_txt, COALESCE(b.data->>'nome', '') AS conta_nome,
            b.id AS conta_existe
       FROM conexoes_bancarias c LEFT JOIN contas_bancarias b ON b.id = c.conta_bancaria_id AND b.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND c.id = $2`,
    [tenantId, conexaoId],
  );
  const conexao = rows[0];
  if (!conexao) return { resultado: 'nao_encontrada', mensagem: 'Conexão não encontrada nesta agência.' };
  if (conexao.status === 'DESCONECTADA') return { resultado: 'desconectada', mensagem: 'Esta conta não está mais conectada ao banco.' };
  if (!conexao.conta_existe) {
    // A conta bancária foi apagada (ex.: limpeza dos dados): a conexão não
    // tem mais para onde levar o extrato. Desliga e apaga o segredo.
    await desconectar(exec, tenantId, conexaoId);
    return { resultado: 'desconectada', mensagem: 'A conta bancária desta conexão não existe mais.' };
  }
  const adaptador = adaptadorDe(String(conexao.provedor));
  if (!adaptador || !adaptador.capacidades.coletaAutomatica || !adaptador.coletar) {
    return { resultado: 'sem_coleta', mensagem: 'Este banco ainda não tem leitura automática.' };
  }

  // Leitura parada há muito tempo = o processo caiu no meio: libera.
  await exec.query(
    `UPDATE sincronizacoes_bancarias SET status = 'ABANDONADA', terminada_em = NOW(), mensagem = 'A leitura parou no meio e foi liberada.'
      WHERE tenant_id = $1 AND conexao_id = $2 AND status = 'EXECUTANDO' AND iniciada_em < $3::timestamptz`,
    [tenantId, conexaoId, new Date(agora.getTime() - MINUTOS_PARA_ABANDONAR * 60_000).toISOString()],
  );
  const sincId = idDaLeitura(conexaoId, o.origem, agora);
  const { rows: reservada } = await exec.query(
    `INSERT INTO sincronizacoes_bancarias (id, tenant_id, conexao_id, origem, status, pedida_por, iniciada_em)
     VALUES ($1, $2, $3, $4, 'EXECUTANDO', $5, $6::timestamptz)
     ON CONFLICT DO NOTHING RETURNING id`,
    [sincId, tenantId, conexaoId, o.origem, o.pedidaPor ?? null, agora.toISOString()],
  );
  if (!reservada.length) {
    const { rows: mesma } = await exec.query(`SELECT status FROM sincronizacoes_bancarias WHERE id = $1 AND tenant_id = $2`, [sincId, tenantId]);
    if (mesma.length && mesma[0].status !== 'EXECUTANDO') {
      return { resultado: 'ja_feita', mensagem: o.origem === 'manual' ? 'A conta acabou de ser lida. Tente de novo em um minuto.' : 'Esta conta já foi lida nesta hora.' };
    }
    return { resultado: 'em_andamento', mensagem: 'O extrato desta conta já está sendo lido. Aguarde um instante.' };
  }

  // Certificado vencido: nem chama o banco.
  const expira = conexao.expira_txt ? String(conexao.expira_txt).slice(0, 10) : null;
  if (expira && expira < hoje) {
    const aviso = avisoDoCertificado(expira, hoje);
    return registrarFalha(exec, tenantId, conexao, sincId, new FalhaColeta('CERTIFICADO_EXPIRADO', aviso?.frase ?? 'O certificado venceu. Renove a integração no banco.'), agora);
  }

  try {
    const { rows: seg } = await exec.query(
      `SELECT envelope FROM conexoes_bancarias_segredo WHERE tenant_id = $1 AND conexao_id = $2`,
      [tenantId, conexaoId],
    );
    if (!seg.length) throw new FalhaColeta('CREDENCIAL_INVALIDA', 'A credencial desta conexão não está mais guardada. Conecte a conta de novo.');
    let cred: CredencialDecifrada;
    try {
      cred = JSON.parse(decifrar(seg[0].envelope)) as CredencialDecifrada;
    } catch {
      throw new FalhaColeta('CREDENCIAL_INVALIDA', 'Não conseguimos abrir a credencial guardada. Conecte a conta de novo com os arquivos do banco.');
    }

    const janela = janelaDaSincronizacao({ ultimaJanelaAte: conexao.ultima_ate_txt ? String(conexao.ultima_ate_txt).slice(0, 10) : null, hoje });
    const blocos = dividirJanela(janela, adaptador.capacidades.janelaMaximaDias);
    const transacoes: TransacaoNormalizada[] = [];
    let saldo: SaldoNormalizado | null = null;
    let paginas = 0;
    let coberta = null as JanelaColeta | null;
    for (const bloco of blocos) {
      // Sem tempo para o próximo bloco: grava o que já veio, continua na próxima.
      if (coberta && o.restanteMs && o.restanteMs() < 20_000) break;
      const r = await adaptador.coletar(cred, bloco, o.ambiente);
      transacoes.push(...r.transacoes);
      if (r.saldo) saldo = r.saldo;
      paginas += r.paginasLidas;
      const inicio: string = coberta ? coberta.de : r.janelaCoberta.de;
      coberta = { de: inicio, ate: r.janelaCoberta.ate };
    }
    const cob = coberta ?? janela;
    const parcial = cob.ate < janela.ate;

    const gravado = await o.emTransacao(async tx => {
      const g = await gravarExtratoSincronizado(tx, tenantId, String(conexao.conta_bancaria_id), {
        conexao_id: conexaoId, sincronizacao_id: sincId, rotulo: `Leitura automática · ${adaptador.apresentacao.nome}`,
      }, transacoes.map(paraLinha));
      await tx.query(
        `UPDATE conexoes_bancarias SET status = 'ATIVA', falhas_consecutivas = 0, ultimo_erro = NULL,
                ultima_sincronizacao_em = $3::timestamptz, ultima_janela_de = $4::date, ultima_janela_ate = $5::date,
                proxima_sincronizacao_em = $6::timestamptz,
                saldo_banco_centavos = COALESCE($7::bigint, saldo_banco_centavos), saldo_banco_em = COALESCE($8::date, saldo_banco_em),
                updated_at = NOW()
          WHERE tenant_id = $1 AND id = $2 AND status <> 'DESCONECTADA'`,
        [tenantId, conexaoId, agora.toISOString(), cob.de, cob.ate,
          (parcial ? new Date(agora.getTime() + 5 * 60_000) : proximaLeituraAposSucesso(agora, Number(conexao.vezes_por_dia ?? 1))).toISOString(),
          saldo ? String(saldo.disponivelCentavos) : null, saldo?.apuradoEm ?? null],
      );
      await tx.query(
        `UPDATE sincronizacoes_bancarias SET status = 'OK', janela_de = $3::date, janela_ate = $4::date,
                inseridas = $5, atualizadas = $6, duplicadas = $7, paginas = $8, terminada_em = NOW(),
                mensagem = $9
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, sincId, cob.de, cob.ate, g.inseridas, g.atualizadas, g.duplicadas, paginas,
          parcial ? 'Parte do período ficou para a próxima leitura.' : null],
      );
      return g;
    });
    return { resultado: 'ok', sincronizacao_id: sincId, inseridas: gravado.inseridas, atualizadas: gravado.atualizadas, duplicadas: gravado.duplicadas, janela: cob, parcial };
  } catch (e) {
    if (ehFalhaColeta(e)) return registrarFalha(exec, tenantId, conexao, sincId, e, agora);
    // Erro nosso (banco de dados, código): registra sem detalhe técnico na tela.
    console.error(`[extrato-automatico] leitura ${sincId} falhou:`, e instanceof Error ? e.message : 'erro');
    return registrarFalha(exec, tenantId, conexao, sincId,
      new FalhaColeta('DESCONHECIDO', 'A leitura não terminou por um erro do nosso lado. Tentamos de novo sozinhos.', 900), agora);
  }
}

// ---------------------------------------------------------------------------
// Avisos de certificado e a tarefa do agendador

/**
 * Aviso no sino a 30 dias e a 7 dias do vencimento (uma vez cada marco), e
 * conexão vencida vira EXPIRADA. Devolve quantos avisos criou.
 */
export async function avisarCertificados(exec: ExecutorSQL, tenantId: string, agora: Date): Promise<number> {
  const hoje = horaDeBrasilia(agora).data;
  const { rows } = await exec.query(
    `SELECT c.id, c.status, c.expira_em::text AS expira, COALESCE(b.data->>'nome', '') AS conta_nome
       FROM conexoes_bancarias c LEFT JOIN contas_bancarias b ON b.id = c.conta_bancaria_id AND b.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND c.status IN ('ATIVA', 'ATENCAO') AND c.expira_em IS NOT NULL`,
    [tenantId],
  );
  let n = 0;
  for (const r of rows) {
    const aviso = avisoDoCertificado(String(r.expira), hoje);
    if (!aviso) continue;
    const nome = String(r.conta_nome || 'conta');
    if (aviso.nivel === 'vencido') {
      await exec.query(
        `UPDATE conexoes_bancarias SET status = 'EXPIRADA', proxima_sincronizacao_em = NULL,
                ultimo_erro = $3::jsonb, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, r.id, JSON.stringify({ motivo: 'CERTIFICADO_EXPIRADO', mensagem: aviso.frase, em: agora.toISOString() })],
      );
      await avisar(exec, tenantId, `extrato:certificado:${r.id}:${r.expira}:vencido`, `O certificado da ${nome} venceu`, aviso.frase);
    } else {
      const marco = aviso.nivel === 'urgente' ? '7' : '30';
      await avisar(exec, tenantId, `extrato:certificado:${r.id}:${r.expira}:${marco}`, `O certificado da ${nome} vence em ${aviso.dias} ${aviso.dias === 1 ? 'dia' : 'dias'}`, aviso.frase);
    }
    n++;
  }
  return n;
}

/** Conexões na hora de ler, da mais atrasada para a mais nova. */
export async function conexoesNaHora(exec: ExecutorSQL, tenantId: string, agora: Date, limite = 20): Promise<string[]> {
  const { rows } = await exec.query(
    `SELECT id FROM conexoes_bancarias
      WHERE tenant_id = $1 AND status IN ('ATIVA', 'ATENCAO')
        AND proxima_sincronizacao_em IS NOT NULL AND proxima_sincronizacao_em <= $2::timestamptz
      ORDER BY proxima_sincronizacao_em, id LIMIT $3`,
    [tenantId, agora.toISOString(), limite],
  );
  return rows.map(r => String(r.id));
}

/**
 * Monta a tarefa com o cliente HTTP do banco (o real em produção, um simulado
 * nos testes). De hora em hora: avisos de certificado e, uma conta por vez,
 * as leituras que estão na hora, até 20 por agência e dentro do tempo.
 */
export function criarTarefaExtratoAutomatico(ambiente: () => AmbienteDoAdaptador): DefinicaoTarefa {
  return {
    nome: 'extrato-automatico',
    janela: janelaDeMinutos(60),
    agencias: async ({ exec, agora }) => {
      const limite = new Date(agora.getTime() + 31 * 86_400_000).toISOString().slice(0, 10);
      const { rows } = await exec.query(
        `SELECT DISTINCT tenant_id FROM conexoes_bancarias
          WHERE tenant_id <> '' AND status IN ('ATIVA', 'ATENCAO')
            AND ((proxima_sincronizacao_em IS NOT NULL AND proxima_sincronizacao_em <= $1::timestamptz)
                 OR (expira_em IS NOT NULL AND expira_em <= $2::date))
          ORDER BY tenant_id LIMIT 50`,
        [agora.toISOString(), limite],
      );
      return rows.map(r => String(r.tenant_id));
    },
    executar: async (ctx, tenantId) => {
      const avisos = await avisarCertificados(ctx.exec, tenantId, ctx.agora);
      const ids = await conexoesNaHora(ctx.exec, tenantId, ctx.agora);
      const resumo = { avisos, lidas: 0, falhas: 0, puladas: 0, linhas_novas: 0 };
      const amb = ambiente();
      for (const id of ids) {
        if (ctx.restanteMs() < 25_000) { resumo.puladas++; continue; }
        const r = await sincronizarConexao(ctx.exec, tenantId, id, {
          origem: 'agendada', ambiente: amb, emTransacao: ctx.emTransacao, agora: ctx.agora, restanteMs: ctx.restanteMs,
        });
        if (r.resultado === 'ok') { resumo.lidas++; resumo.linhas_novas += r.inseridas; }
        else if (r.resultado === 'falhou') resumo.falhas++;
        else resumo.puladas++;
      }
      return resumo;
    },
  };
}

/** A tarefa de verdade (cliente mTLS). Registrar em src/lib/agendador/tarefas.ts. */
export const tarefaExtratoAutomatico: DefinicaoTarefa = criarTarefaExtratoAutomatico(() => ({ http: clienteHttpMtls }));

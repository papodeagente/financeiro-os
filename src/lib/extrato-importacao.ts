/**
 * Gravação de um extrato importado. Saiu de dentro da rota para que o
 * andamento possa ser contado (a tela mostra a barra de progresso com o
 * número real de linhas conferidas) e para que dê para testar contra um
 * Postgres de verdade.
 *
 * Quem chama abre e fecha a transação: aqui só se lê e se grava.
 */
import { generateId } from './utils';
import { round2, num, paraISO } from './money';

const TABLE = 'extrato_bancario';

export interface LinhaImportada {
  data: string;
  descricao: string;
  valor: number;
  fitid?: string;
}

export interface Andamento {
  /** Linhas do arquivo já conferidas (gravadas ou reconhecidas como repetidas). */
  feitas: number;
  total: number;
  inseridas: number;
  duplicadas: number;
}

export interface ResultadoImportacao {
  inseridas: number;
  duplicadas: number;
  total: number;
}

interface Executor {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

/** `origem` da linha que chegou sozinha pela API do banco. */
export const ORIGEM_SINCRONIZACAO = 'SINCRONIZACAO';

type Gemeas = Map<string, string[]>;

/**
 * Linhas já gravadas agrupadas por data + valor, para reconhecer o mesmo
 * lançamento vindo pela outra porta (arquivo × leitura automática), que tem
 * outro identificador. Uma linha só serve de gêmea uma vez.
 */
function gemeasPorDataEValor(existentes: Record<string, unknown>[], filtro: (d: Record<string, unknown>) => boolean): Gemeas {
  const mapa: Gemeas = new Map();
  for (const r of existentes) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    if (!filtro(d)) continue;
    const k = `${paraISO(typeof d.data === 'string' ? d.data : '')}|${round2(num(d.valor)).toFixed(2)}`;
    const lista = mapa.get(k) ?? [];
    lista.push(String(d.id ?? r.id ?? ''));
    mapa.set(k, lista);
  }
  return mapa;
}

function tirarGemea(g: Gemeas, data: string, valor: number): string | null {
  const lista = g.get(`${data}|${round2(valor).toFixed(2)}`);
  return lista && lista.length ? lista.shift() ?? null : null;
}

/**
 * Chave de idempotência de uma linha de extrato.
 * Quando o banco fornece FITID (OFX), ele é a identidade oficial da transação
 * e basta. Sem FITID (CSV), a tupla conta + data + valor + descrição é o mais
 * próximo disso — duas linhas realmente idênticas no mesmo dia são
 * indistinguíveis e por definição não podem ser separadas.
 *
 * Extrato automático (06/11/2026): a linha que chega pela API do banco traz
 * o identificador do banco em `id_externo`, que vale como o FITID (e vem
 * antes dele). Linhas antigas não têm o campo: a chave delas não muda.
 */
export function chaveLinha(contaId: string, l: { data?: unknown; valor?: unknown; descricao?: unknown; fitid?: unknown; id_externo?: unknown }): string {
  const externo = typeof l.id_externo === 'string' ? l.id_externo.trim() : '';
  if (externo) return `${contaId}|ext:${externo}`;
  const fitid = typeof l.fitid === 'string' ? l.fitid.trim() : '';
  if (fitid) return `${contaId}|fitid:${fitid}`;
  const data = paraISO(typeof l.data === 'string' ? l.data : '');
  const valor = round2(num(l.valor)).toFixed(2);
  const desc = String(l.descricao ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${contaId}|${data}|${valor}|${desc}`;
}

/**
 * Todas as identidades de uma linha JÁ GRAVADA: a do banco, o FITID do
 * arquivo e, sem nenhum dos dois, a impressão digital. A linha que veio por
 * arquivo e depois ganhou o identificador do banco continua reconhecida pelo
 * FITID numa reimportação do mesmo arquivo.
 */
export function chavesDaLinhaGravada(contaId: string, d: { data?: unknown; valor?: unknown; descricao?: unknown; fitid?: unknown; id_externo?: unknown }): string[] {
  const chaves = [chaveLinha(contaId, d)];
  const externo = typeof d.id_externo === 'string' ? d.id_externo.trim() : '';
  const fitid = typeof d.fitid === 'string' ? d.fitid.trim() : '';
  if (externo && fitid) chaves.push(`${contaId}|fitid:${fitid}`);
  return chaves;
}

/**
 * De quantas em quantas linhas avisar o andamento: no máximo uns cem avisos
 * por arquivo, que é mais do que a barra consegue mostrar e pouco o bastante
 * para não pesar na resposta.
 */
export function passoDoAviso(total: number): number {
  return Math.max(1, Math.ceil(total / 100));
}

/**
 *  - Idempotente: linha já existente na conta (FITID, ou data+valor+descrição)
 *    é ignorada, então reimportar o mesmo arquivo não duplica nada.
 *  - O andamento é avisado a cada `passoDoAviso` linhas e sempre na última.
 */
export async function importarExtrato(
  exec: Executor,
  tenantId: string,
  contaId: string,
  arquivoOrigem: string,
  linhas: readonly LinhaImportada[],
  aoAndar?: (a: Andamento) => void,
): Promise<ResultadoImportacao> {
  // A conta precisa ser desta agência: extrato em conta alheia ou inventada
  // não entra (e depois não vira conciliação).
  const { rows: conta } = await exec.query(
    `SELECT id FROM contas_bancarias WHERE id = $1 AND tenant_id = $2`,
    [contaId, tenantId],
  );
  if (conta.length === 0) throw new Error('Conta bancária não encontrada nesta agência.');
  // Duas importações da mesma conta ao mesmo tempo liam a mesma lista de
  // chaves e inseriam a mesma linha duas vezes (auditoria 04/11, FIN2-20).
  // A trava (até o fim da transação de quem chama) põe uma atrás da outra:
  // a segunda lê o que a primeira gravou. Trava consultiva, para não
  // bloquear as baixas que movem o saldo dessa conta.
  await exec.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`extrato:${tenantId}:${contaId}`]);

  // Chaves já existentes na conta — base da deduplicação.
  const { rows: existentes } = await exec.query(
    `SELECT data FROM ${TABLE} WHERE tenant_id = $1 AND conta_bancaria_id = $2`,
    [tenantId, contaId],
  );
  const vistas = new Set<string>(
    existentes.flatMap(r => chavesDaLinhaGravada(contaId, (r.data ?? {}) as Record<string, unknown>)),
  );
  // Linhas que chegaram sozinhas do banco (extrato automático) têm a chave do
  // banco, não o FITID do arquivo: o mesmo lançamento num arquivo baixado
  // depois é reconhecido pela data e pelo valor, uma linha por uma linha.
  // Sem extrato automático na conta, a lista é vazia e nada muda.
  const gemeas = gemeasPorDataEValor(existentes, r => r.origem === ORIGEM_SINCRONIZACAO && !r.fitid);

  const importadoEm = new Date().toISOString();
  const total = linhas.length;
  const passo = passoDoAviso(total);
  let inseridas = 0;
  let duplicadas = 0;
  // Saldo corrente acumulado sobre TODAS as linhas do arquivo (inclusive as
  // ignoradas), para que a coluna saldo reflita o extrato original.
  let saldo = 0;

  for (let i = 0; i < total; i++) {
    const l = linhas[i];
    const valor = round2(num(l.valor));
    saldo = round2(saldo + valor);
    const chave = chaveLinha(contaId, l);
    if (vistas.has(chave)) {
      duplicadas++;
    } else if (tirarGemea(gemeas, paraISO(l.data), valor)) {
      vistas.add(chave);
      duplicadas++;
    } else {
      vistas.add(chave);
      const fitid = typeof l.fitid === 'string' ? l.fitid.trim() : '';
      const item = {
        id: generateId(),
        conta_bancaria_id: contaId,
        data: paraISO(l.data),
        descricao: String(l.descricao ?? ''),
        valor,
        tipo: valor >= 0 ? 'CREDITO' : 'DEBITO',
        saldo,
        status_conciliacao: 'PENDENTE',
        lancamento_vinculado_id: null,
        lancamento_vinculado_tipo: null,
        observacao_conciliacao: '',
        importado_em: importadoEm,
        arquivo_origem: arquivoOrigem,
        // FITID do OFX: identidade da transação no banco, guardada para que
        // reimportações futuras reconheçam a linha mesmo se a descrição mudar.
        ...(fitid ? { fitid } : {}),
      };
      // O índice único por FITID (EXTRATO_FITID_UNICO_SQL) é a segunda
      // barreira: mesmo fora da trava, a mesma transação bancária não entra
      // duas vezes na mesma conta.
      const { rows: gravada } = await exec.query(
        `INSERT INTO ${TABLE} (id, tenant_id, conta_bancaria_id, status_conciliacao, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [item.id, tenantId, contaId, 'PENDENTE', JSON.stringify(item)],
      );
      if (gravada.length > 0) inseridas++;
      else duplicadas++;
    }
    const feitas = i + 1;
    if (aoAndar && (feitas % passo === 0 || feitas === total)) {
      aoAndar({ feitas, total, inseridas, duplicadas });
    }
  }

  return { inseridas, duplicadas, total };
}

/**
 * Índice único da transação bancária por conta (FITID do OFX). Linhas sem
 * FITID (CSV) seguem deduplicadas pela chave data+valor+descrição dentro da
 * trava da importação; duas linhas legitimamente iguais no mesmo dia, sem
 * FITID, continuam sendo uma limitação conhecida.
 *
 * Se a base já tiver duplicatas antigas, o índice não é criado (o boot não
 * pode cair por isso) e um aviso vai para o log; a trava continua valendo.
 */
export const EXTRATO_FITID_UNICO_SQL = `
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_extrato_fitid
    ON extrato_bancario (tenant_id, conta_bancaria_id, (data->>'fitid'))
    WHERE COALESCE(data->>'fitid', '') <> '';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'uq_extrato_fitid nao criado: ha linhas duplicadas por FITID';
END $$;
`;

/**
 * O mesmo índice para o identificador do banco que chega pela leitura
 * automática (06/11/2026). Linhas de arquivo não têm o campo e ficam de fora.
 */
export const EXTRATO_ID_EXTERNO_UNICO_SQL = `
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_extrato_id_externo
    ON extrato_bancario (tenant_id, conta_bancaria_id, (data->>'id_externo'))
    WHERE COALESCE(data->>'id_externo', '') <> '';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'uq_extrato_id_externo nao criado: ha linhas duplicadas pelo identificador do banco';
END $$;
CREATE INDEX IF NOT EXISTS idx_extrato_tenant_conta ON extrato_bancario (tenant_id, conta_bancaria_id);
`;

// ---------------------------------------------------------------------------
// Extrato que chega sozinho pela API do banco (06/11/2026)

export interface LinhaSincronizada {
  /** Identificador do banco (null = o banco não informa; vale a impressão digital). */
  id_externo: string | null;
  data: string;
  /** Reais, com sinal. */
  valor: number;
  descricao: string;
  pendente: boolean;
  /** Saldo depois do lançamento, em reais, quando o banco informa. */
  saldo: number | null;
  categoria_origem: string | null;
}

export interface ResultadoSincronizacao {
  inseridas: number;
  /** Já existiam e mudaram (pendente que virou efetivado). */
  atualizadas: number;
  /** Já existiam (pelo identificador do banco, ou a mesma linha vinda de arquivo). */
  duplicadas: number;
  total: number;
}

/**
 * Grava as linhas lidas na API do banco. Mesma trava, mesma chave e mesmo
 * índice único da importação de arquivo (o identificador do banco no lugar do
 * FITID), então ler a mesma janela duas vezes não duplica nada.
 *
 * - Linha nova: entra como PENDENTE de conciliação, com `origem` SINCRONIZACAO.
 * - Linha que já veio por arquivo (sem o identificador do banco): é
 *   reconhecida por data + valor, ganha o identificador e não duplica.
 * - Lançamento pendente que virou efetivado: atualiza descrição, saldo e
 *   `pendente`, preservando id, situação e vínculos de conciliação. É o único
 *   caso em que uma linha do extrato muda.
 *
 * Quem chama abre e fecha a transação.
 */
export async function gravarExtratoSincronizado(
  exec: Executor,
  tenantId: string,
  contaId: string,
  origem: { conexao_id: string; sincronizacao_id: string; rotulo: string },
  linhas: readonly LinhaSincronizada[],
): Promise<ResultadoSincronizacao> {
  const { rows: conta } = await exec.query(
    `SELECT id FROM contas_bancarias WHERE id = $1 AND tenant_id = $2`,
    [contaId, tenantId],
  );
  if (conta.length === 0) throw new Error('Conta bancária não encontrada nesta agência.');
  await exec.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`extrato:${tenantId}:${contaId}`]);

  const { rows: existentes } = await exec.query(
    `SELECT id, data FROM ${TABLE} WHERE tenant_id = $1 AND conta_bancaria_id = $2`,
    [tenantId, contaId],
  );
  const porChave = new Map<string, Record<string, unknown>>();
  for (const r of existentes) {
    const d: Record<string, unknown> = { ...((r.data ?? {}) as Record<string, unknown>), id: String(r.id) };
    for (const k of chavesDaLinhaGravada(contaId, d)) porChave.set(k, d);
  }
  // Gêmeas: linhas que vieram por arquivo, sem o identificador do banco.
  const gemeas = gemeasPorDataEValor(
    existentes.map(r => ({ ...r, data: { ...((r.data ?? {}) as Record<string, unknown>), id: String(r.id) } })),
    d => d.origem !== ORIGEM_SINCRONIZACAO && !(typeof d.id_externo === 'string' && d.id_externo),
  );

  const agora = new Date().toISOString();
  let inseridas = 0, atualizadas = 0, duplicadas = 0;

  for (const l of linhas) {
    const valor = round2(num(l.valor));
    const data = paraISO(l.data);
    const idExterno = typeof l.id_externo === 'string' && l.id_externo.trim() ? l.id_externo.trim() : null;
    const chave = chaveLinha(contaId, { id_externo: idExterno, data, valor, descricao: l.descricao });
    const ja = porChave.get(chave);
    if (ja) {
      if (ja.pendente === true && l.pendente === false) {
        const nova = { ...ja, pendente: false, descricao: String(l.descricao ?? ja.descricao ?? ''), ...(l.saldo !== null ? { saldo: round2(l.saldo) } : {}), efetivado_em: agora };
        await exec.query(
          `UPDATE ${TABLE} SET data = $3::jsonb, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
          [ja.id, tenantId, JSON.stringify(nova)],
        );
        porChave.set(chave, nova);
        atualizadas++;
      } else {
        duplicadas++;
      }
      continue;
    }
    if (idExterno) {
      const gemea = tirarGemea(gemeas, data, valor);
      if (gemea) {
        // A mesma transação já entrou por arquivo: ela ganha o identificador
        // do banco (a próxima leitura a reconhece direto) e nada duplica.
        await exec.query(
          `UPDATE ${TABLE} SET data = data || $3::jsonb, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
          [gemea, tenantId, JSON.stringify({ id_externo: idExterno, conexao_id: origem.conexao_id, confirmado_pelo_banco_em: agora })],
        );
        porChave.set(chave, { id: gemea, id_externo: idExterno });
        duplicadas++;
        continue;
      }
    }
    const item = {
      id: generateId(),
      conta_bancaria_id: contaId,
      data,
      descricao: String(l.descricao ?? ''),
      valor,
      tipo: valor >= 0 ? 'CREDITO' : 'DEBITO',
      saldo: l.saldo !== null && l.saldo !== undefined ? round2(l.saldo) : null,
      status_conciliacao: 'PENDENTE',
      lancamento_vinculado_id: null,
      lancamento_vinculado_tipo: null,
      observacao_conciliacao: '',
      importado_em: agora,
      // A tela atual mostra a procedência por aqui; a origem fica explícita abaixo.
      arquivo_origem: origem.rotulo,
      origem: ORIGEM_SINCRONIZACAO,
      conexao_id: origem.conexao_id,
      sincronizacao_id: origem.sincronizacao_id,
      pendente: l.pendente === true,
      ...(idExterno ? { id_externo: idExterno } : {}),
      ...(l.categoria_origem ? { categoria_origem: l.categoria_origem } : {}),
    };
    const { rows: gravada } = await exec.query(
      `INSERT INTO ${TABLE} (id, tenant_id, conta_bancaria_id, status_conciliacao, data, created_at, updated_at)
       VALUES ($1, $2, $3, 'PENDENTE', $4::jsonb, NOW(), NOW())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [item.id, tenantId, contaId, JSON.stringify(item)],
    );
    if (gravada.length > 0) {
      inseridas++;
      porChave.set(chave, item);
    } else {
      duplicadas++;
    }
  }
  return { inseridas, atualizadas, duplicadas, total: linhas.length };
}

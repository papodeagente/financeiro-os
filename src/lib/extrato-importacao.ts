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

/**
 * Chave de idempotência de uma linha de extrato.
 * Quando o banco fornece FITID (OFX), ele é a identidade oficial da transação
 * e basta. Sem FITID (CSV), a tupla conta + data + valor + descrição é o mais
 * próximo disso — duas linhas realmente idênticas no mesmo dia são
 * indistinguíveis e por definição não podem ser separadas.
 */
export function chaveLinha(contaId: string, l: { data?: unknown; valor?: unknown; descricao?: unknown; fitid?: unknown }): string {
  const fitid = typeof l.fitid === 'string' ? l.fitid.trim() : '';
  if (fitid) return `${contaId}|fitid:${fitid}`;
  const data = paraISO(typeof l.data === 'string' ? l.data : '');
  const valor = round2(num(l.valor)).toFixed(2);
  const desc = String(l.descricao ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${contaId}|${data}|${valor}|${desc}`;
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
  // Chaves já existentes na conta — base da deduplicação.
  const { rows: existentes } = await exec.query(
    `SELECT data FROM ${TABLE} WHERE tenant_id = $1 AND conta_bancaria_id = $2`,
    [tenantId, contaId],
  );
  const vistas = new Set<string>(
    existentes.map(r => chaveLinha(contaId, (r.data ?? {}) as Record<string, unknown>)),
  );

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
      await exec.query(
        `INSERT INTO ${TABLE} (id, tenant_id, conta_bancaria_id, status_conciliacao, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())`,
        [item.id, tenantId, contaId, 'PENDENTE', JSON.stringify(item)],
      );
      inseridas++;
    }
    const feitas = i + 1;
    if (aoAndar && (feitas % passo === 0 || feitas === total)) {
      aoAndar({ feitas, total, inseridas, duplicadas });
    }
  }

  return { inseridas, duplicadas, total };
}

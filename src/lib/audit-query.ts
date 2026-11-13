import type { LogAuditoria } from './crm-types';

export const AUDIT_EXPORT_LIMIT = 50_000;
export class AuditFilterError extends Error {}

/** Filtros compartilhados pela listagem e exportação. Valores nunca viram SQL. */
export function buildAuditFilter(params: URLSearchParams, tenantId: string) {
  const values: unknown[] = [tenantId];
  const clauses = ['tenant_id = $1'];
  const add = (expression: string, value: unknown) => {
    values.push(value);
    clauses.push(`${expression} $${values.length}`);
  };
  const integer = (key: string, fallback: number, max: number) => {
    const raw = params.get(key);
    if (!raw) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) {
      throw new AuditFilterError(`Parâmetro ${key} inválido.`);
    }
    return Number(raw);
  };
  const page = integer('page', 1, 1_000_000);
  const pageSize = integer('pageSize', 50, 100);
  for (const [key, column] of [
    ['modulo', 'modulo'], ['acao', 'acao'], ['usuario', 'usuario_id'],
    ['origem', "COALESCE(data->>'origem', 'SISTEMA')"],
  ]) {
    const value = params.get(key)?.trim();
    if (value && value !== 'TODOS') {
      if (value.length > 200) throw new AuditFilterError('Filtro muito longo.');
      add(`${column} =`, value);
    }
  }
  const inicio = params.get('inicio');
  const fim = params.get('fim');
  for (const [key, raw, operator] of [['inicio', inicio, '>='], ['fim', fim, '<=']]) {
    if (!raw) continue;
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || !Number.isFinite(Date.parse(raw))
      || new Date(`${raw.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== raw.slice(0, 10)) {
      throw new AuditFilterError(`Data ${key} inválida.`);
    }
    add(`created_at ${operator}`, new Date(raw).toISOString());
  }
  if (inicio && fim && Date.parse(inicio) > Date.parse(fim)) {
    throw new AuditFilterError('A data inicial deve ser anterior à data final.');
  }
  const q = params.get('q')?.trim();
  if (q) {
    if (q.length > 200) throw new AuditFilterError('A busca deve ter até 200 caracteres.');
    values.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    clauses.push(`concat_ws(' ', data->>'descricao', data->>'usuario_nome', modulo,
      acao, entidade, entidade_id, data->>'entidade_nome', data->>'request_id',
      data->>'rota', data->>'alteracoes') ILIKE $${values.length}`);
  }
  return { where: clauses.join(' AND '), values, page, pageSize };
}

const scalar = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
};

/** Identidade e data usam as colunas persistidas pelo servidor. */
export function normalizeAuditRow(row: Record<string, unknown>): LogAuditoria {
  const data = row.data && typeof row.data === 'object' ? row.data as Record<string, unknown> : {};
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : scalar(row.created_at);
  const changes = Array.isArray(data.alteracoes) ? data.alteracoes : [];
  return {
    id: scalar(row.id), timestamp: createdAt,
    usuario_id: scalar(row.usuario_id), usuario_nome: scalar(data.usuario_nome) || 'Sistema',
    perfil: scalar(data.perfil), acao: scalar(row.acao) as LogAuditoria['acao'],
    modulo: scalar(row.modulo), entidade: scalar(row.entidade), entidade_id: scalar(row.entidade_id),
    entidade_nome: scalar(data.entidade_nome), descricao: scalar(data.descricao),
    origem: (scalar(data.origem) || 'SISTEMA') as LogAuditoria['origem'],
    rota: scalar(data.rota), metodo: scalar(data.metodo), request_id: scalar(data.request_id),
    alteracoes: changes.filter((a): a is Record<string, unknown> => !!a && typeof a === 'object').map(a => ({
      campo: scalar(a.campo), valor_anterior: scalar(a.valor_anterior), valor_novo: scalar(a.valor_novo),
    })),
  };
}

/** Escapa aspas, separadores, quebras e fórmulas ao abrir em planilhas. */
export function auditCsvCell(value: unknown): string {
  let text = scalar(value);
  if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function auditCsv(items: LogAuditoria[]): string {
  const headers = ['Data/hora (UTC)', 'Usuário', 'ID usuário', 'Perfil', 'Ação', 'Módulo', 'Entidade', 'ID registro', 'Descrição', 'Origem', 'Alterações', 'Operação', 'Rota'];
  const rows = items.map(item => [item.timestamp, item.usuario_nome, item.usuario_id, item.perfil,
    item.acao, item.modulo, item.entidade, item.entidade_id, item.descricao, item.origem,
    JSON.stringify(item.alteracoes), item.request_id, item.rota]);
  return '\uFEFF' + [headers, ...rows].map(row => row.map(auditCsvCell).join(';')).join('\r\n');
}

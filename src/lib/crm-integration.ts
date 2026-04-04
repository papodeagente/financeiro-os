import pool, { initDB } from './db';
import { generateId } from './utils';
import { createHmac } from 'crypto';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

interface CrmConfig {
  ativo: boolean;
  webhook_url_entur: string;
  webhook_url_crm: string;
  api_key_entur: string;
  api_key_crm: string;
  retry_max: number;
  circuit_breaker_threshold: number;
  circuit_breaker_status: 'fechado' | 'aberto' | 'semi-aberto';
}

interface CrmStatus {
  ativo: boolean;
  circuit_breaker: 'fechado' | 'aberto' | 'semi-aberto';
  eventos_pendentes: number;
  eventos_falha: number;
  eventos_processados_hoje: number;
  ultimo_evento_saida: { tipo: string; status: string; timestamp: string } | null;
  ultimo_evento_entrada: { tipo: string; processado: boolean; timestamp: string } | null;
}

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

function hmacSign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

const BACKOFF_MINUTES = [1, 5, 30, 120, 480]; // 1min, 5min, 30min, 2h, 8h

function calcNextRetry(tentativas: number): Date {
  const idx = Math.min(tentativas, BACKOFF_MINUTES.length - 1);
  const ms = BACKOFF_MINUTES[idx] * 60 * 1000;
  return new Date(Date.now() + ms);
}

async function getCrmConfig(): Promise<CrmConfig | null> {
  if (!pool) return null;
  await initDB();
  const { rows } = await pool.query("SELECT data FROM crm_config WHERE id = 'singleton'");
  if (rows.length === 0) return null;
  return rows[0].data as CrmConfig;
}

// ──────────────────────────────────────────
// emitirEventoCRM — fire-and-forget
// ──────────────────────────────────────────

export async function emitirEventoCRM(
  tipo: string,
  payload: Record<string, unknown>,
  opcoes?: { idempotency_key?: string }
): Promise<void> {
  try {
    if (!pool) return;
    await initDB();

    const id = opcoes?.idempotency_key || generateId();
    const timestamp = new Date().toISOString();
    const eventBody = { id, tipo, timestamp, versao: 'v1', origem: 'entur-os', payload };

    // Insert as PENDENTE
    await pool.query(
      `INSERT INTO crm_eventos_saida (id, tipo, status, tentativas, data, created_at, updated_at)
       VALUES ($1, $2, 'PENDENTE', 0, $3, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [id, tipo, JSON.stringify(eventBody)]
    );

    const config = await getCrmConfig();
    if (!config || !config.ativo || config.circuit_breaker_status === 'aberto') {
      return;
    }

    if (!config.webhook_url_crm) return;

    const bodyStr = JSON.stringify(eventBody);
    const signature = hmacSign(bodyStr, config.api_key_crm || '');
    const start = Date.now();

    try {
      const res = await fetch(config.webhook_url_crm, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-entur-event': tipo,
          'x-entur-signature': signature,
          'x-entur-event-id': id,
          'x-entur-timestamp': timestamp,
        },
        body: bodyStr,
        signal: AbortSignal.timeout(5000),
      });

      const latencia = Date.now() - start;

      if (res.ok) {
        await pool.query(
          `UPDATE crm_eventos_saida SET status = 'ENVIADO', latencia_ms = $2, updated_at = NOW() WHERE id = $1`,
          [id, latencia]
        );
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      // Delivery failed — schedule retry
      const tentativas = 1;
      const proxima = calcNextRetry(tentativas);
      await pool.query(
        `UPDATE crm_eventos_saida SET status = 'FALHA', tentativas = $2, proxima_tentativa = $3, updated_at = NOW() WHERE id = $1`,
        [id, tentativas, proxima.toISOString()]
      );

      // Check circuit breaker
      const { rows } = await pool.query(
        `SELECT COUNT(*) as cnt FROM crm_eventos_saida WHERE status = 'FALHA' AND created_at > NOW() - INTERVAL '1 hour'`
      );
      const failCount = parseInt(rows[0].cnt, 10);
      if (failCount >= (config.circuit_breaker_threshold || 10)) {
        await pool.query(
          `UPDATE crm_config SET data = jsonb_set(data, '{circuit_breaker_status}', '"aberto"'), updated_at = NOW() WHERE id = 'singleton'`
        );
      }
    }
  } catch {
    // Never propagate errors from CRM integration
  }
}

// ──────────────────────────────────────────
// processarEventoCRM — inbound events
// ──────────────────────────────────────────

export async function processarEventoCRM(
  tipo: string,
  payload: Record<string, unknown>,
  idempotency_key: string
): Promise<{ processado: boolean; acao: string; erro?: string }> {
  try {
    if (!pool) return { processado: false, acao: 'sem banco de dados' };
    await initDB();

    // Check idempotency
    const { rows: existing } = await pool.query(
      `SELECT id FROM crm_eventos_entrada WHERE idempotency_key = $1`,
      [idempotency_key]
    );
    if (existing.length > 0) {
      return { processado: true, acao: 'duplicata ignorada' };
    }

    const id = generateId();
    await pool.query(
      `INSERT INTO crm_eventos_entrada (id, idempotency_key, tipo, status, processado, data, created_at)
       VALUES ($1, $2, $3, 'RECEBIDO', false, $4, NOW())`,
      [id, idempotency_key, tipo, JSON.stringify({ tipo, payload, received_at: new Date().toISOString() })]
    );

    let acao = '';

    switch (tipo) {
      case 'VENDA_FECHADA': {
        const vendaId = generateId();
        const vendaData = {
          id: vendaId,
          cliente_id: payload.cliente_id || '',
          vendedor_id: payload.vendedor_id || '',
          grupo_id: payload.entur_grupo_id || '',
          proposta_id: payload.entur_proposta_id || '',
          crm_venda_id: payload.crm_venda_id || '',
          valor_total: payload.valor_total || 0,
          moeda: payload.moeda || 'BRL',
          status: 'vendido',
          origem: 'crm',
          data_venda: new Date().toISOString(),
        };
        await pool.query(
          `INSERT INTO vendas_crm (id, cliente_id, vendedor_id, status, data, created_at, updated_at)
           VALUES ($1, $2, $3, 'vendido', $4, NOW(), NOW())`,
          [vendaId, vendaData.cliente_id, vendaData.vendedor_id, JSON.stringify(vendaData)]
        );

        // Create contas_receber for each parcela
        const parcelas = (payload.condicoes_pagamento as Array<Record<string, unknown>>) || [];
        for (const parcela of parcelas) {
          const parcelaId = generateId();
          const parcelaData = {
            id: parcelaId,
            venda_id: vendaId,
            cliente_id: vendaData.cliente_id,
            parcela: parcela.parcela,
            valor: parcela.valor,
            vencimento: parcela.vencimento,
            forma_pagamento: parcela.forma_pagamento,
            status: 'pendente',
            origem: 'crm',
          };
          await pool.query(
            `INSERT INTO contas_receber (id, venda_id, cliente_id, status, data, created_at, updated_at)
             VALUES ($1, $2, $3, 'pendente', $4, NOW(), NOW())`,
            [parcelaId, vendaId, vendaData.cliente_id, JSON.stringify(parcelaData)]
          );
        }

        // Create contas_pagar for each fornecedor
        const fornecedores = (payload.fornecedores as Array<Record<string, unknown>>) || [];
        for (const forn of fornecedores) {
          const fornId = generateId();
          const fornData = {
            id: fornId,
            venda_id: vendaId,
            fornecedor_id: forn.fornecedor_id || '',
            servico: forn.servico,
            valor_custo: forn.valor_custo,
            vencimento: forn.vencimento_pagamento,
            status: 'pendente',
            origem: 'crm',
          };
          await pool.query(
            `INSERT INTO contas_pagar (id, fornecedor_id, status, data, created_at, updated_at)
             VALUES ($1, $2, 'pendente', $3, NOW(), NOW())`,
            [fornId, fornData.fornecedor_id, JSON.stringify(fornData)]
          );
        }
        acao = `venda criada (${vendaId}), ${parcelas.length} receber, ${fornecedores.length} pagar`;
        break;
      }

      case 'PAGAMENTO_CONFIRMADO': {
        const { entur_venda_id, parcela: numParcela, valor, data_pagamento } = payload;
        const { rows: receber } = await pool.query(
          `SELECT id, data FROM contas_receber WHERE venda_id = $1`,
          [entur_venda_id]
        );
        for (const row of receber) {
          const d = row.data as Record<string, unknown>;
          if (d.parcela === numParcela) {
            d.status = 'RECEBIDO';
            d.data_pagamento = data_pagamento;
            d.valor_recebido = valor;
            await pool.query(
              `UPDATE contas_receber SET status = 'RECEBIDO', data = $2, updated_at = NOW() WHERE id = $1`,
              [row.id, JSON.stringify(d)]
            );
          }
        }
        acao = `pagamento confirmado parcela ${numParcela}`;
        break;
      }

      case 'PAGAMENTO_ATRASADO': {
        const { entur_venda_id: vendaIdAtr, parcela: parcAtr } = payload;
        const { rows: receberAtr } = await pool.query(
          `SELECT id, data FROM contas_receber WHERE venda_id = $1`,
          [vendaIdAtr]
        );
        for (const row of receberAtr) {
          const d = row.data as Record<string, unknown>;
          if (d.parcela === parcAtr) {
            d.status = 'ATRASADO';
            d.dias_atraso = payload.dias_atraso;
            await pool.query(
              `UPDATE contas_receber SET status = 'ATRASADO', data = $2, updated_at = NOW() WHERE id = $1`,
              [row.id, JSON.stringify(d)]
            );
          }
        }
        acao = `parcela ${parcAtr} marcada como atrasada`;
        break;
      }

      case 'CLIENTE_ATUALIZADO': {
        const { cliente_id, campos_alterados } = payload;
        if (cliente_id && campos_alterados) {
          const { rows: cliRows } = await pool.query(
            `SELECT data FROM clientes WHERE id = $1`,
            [cliente_id]
          );
          if (cliRows.length > 0) {
            const merged = { ...cliRows[0].data, ...(campos_alterados as Record<string, unknown>) };
            await pool.query(
              `UPDATE clientes SET data = $2, updated_at = NOW() WHERE id = $1`,
              [cliente_id, JSON.stringify(merged)]
            );
          }
        }
        acao = `cliente ${cliente_id} atualizado`;
        break;
      }

      case 'PROPOSTA_VISUALIZADA': {
        const { proposta_id, timestamp, duracao_segundos } = payload;
        if (proposta_id) {
          const { rows: propRows } = await pool.query(
            `SELECT data FROM propostas WHERE id = $1`,
            [proposta_id]
          );
          if (propRows.length > 0) {
            const propData = propRows[0].data as Record<string, unknown>;
            const views = (propData.visualizacoes as Array<unknown>) || [];
            views.push({ timestamp, duracao_segundos, origem: 'crm' });
            propData.visualizacoes = views;
            await pool.query(
              `UPDATE propostas SET data = $2, updated_at = NOW() WHERE id = $1`,
              [proposta_id, JSON.stringify(propData)]
            );
          }
        }
        acao = `visualizacao registrada para proposta ${proposta_id}`;
        break;
      }

      default:
        acao = `tipo desconhecido: ${tipo}`;
    }

    // Mark as processed
    await pool.query(
      `UPDATE crm_eventos_entrada SET processado = true, status = 'PROCESSADO' WHERE id = $1`,
      [id]
    );

    return { processado: true, acao };
  } catch (e) {
    const erro = e instanceof Error ? e.message : 'Erro desconhecido';
    // Try to record the error
    try {
      if (pool) {
        await pool.query(
          `UPDATE crm_eventos_entrada SET erro = $2 WHERE idempotency_key = $1`,
          [idempotency_key, erro]
        );
      }
    } catch { /* ignore */ }
    return { processado: false, acao: 'erro no processamento', erro };
  }
}

// ──────────────────────────────────────────
// statusIntegracaoCRM
// ──────────────────────────────────────────

export async function statusIntegracaoCRM(): Promise<CrmStatus> {
  const defaults: CrmStatus = {
    ativo: false,
    circuit_breaker: 'fechado',
    eventos_pendentes: 0,
    eventos_falha: 0,
    eventos_processados_hoje: 0,
    ultimo_evento_saida: null,
    ultimo_evento_entrada: null,
  };

  try {
    if (!pool) return defaults;
    await initDB();

    const config = await getCrmConfig();
    if (config) {
      defaults.ativo = config.ativo;
      defaults.circuit_breaker = config.circuit_breaker_status || 'fechado';
    }

    const pendentes = await pool.query(
      `SELECT COUNT(*) as cnt FROM crm_eventos_saida WHERE status = 'PENDENTE'`
    );
    defaults.eventos_pendentes = parseInt(pendentes.rows[0].cnt, 10);

    const falhas = await pool.query(
      `SELECT COUNT(*) as cnt FROM crm_eventos_saida WHERE status = 'FALHA'`
    );
    defaults.eventos_falha = parseInt(falhas.rows[0].cnt, 10);

    const hoje = await pool.query(
      `SELECT COUNT(*) as cnt FROM crm_eventos_entrada WHERE processado = true AND created_at > CURRENT_DATE`
    );
    defaults.eventos_processados_hoje = parseInt(hoje.rows[0].cnt, 10);

    const ultimoSaida = await pool.query(
      `SELECT tipo, status, created_at FROM crm_eventos_saida ORDER BY created_at DESC LIMIT 1`
    );
    if (ultimoSaida.rows.length > 0) {
      defaults.ultimo_evento_saida = {
        tipo: ultimoSaida.rows[0].tipo,
        status: ultimoSaida.rows[0].status,
        timestamp: ultimoSaida.rows[0].created_at,
      };
    }

    const ultimoEntrada = await pool.query(
      `SELECT tipo, processado, created_at FROM crm_eventos_entrada ORDER BY created_at DESC LIMIT 1`
    );
    if (ultimoEntrada.rows.length > 0) {
      defaults.ultimo_evento_entrada = {
        tipo: ultimoEntrada.rows[0].tipo,
        processado: ultimoEntrada.rows[0].processado,
        timestamp: ultimoEntrada.rows[0].created_at,
      };
    }

    return defaults;
  } catch {
    return defaults;
  }
}

// ──────────────────────────────────────────
// retentarEventosFalha
// ──────────────────────────────────────────

export async function retentarEventosFalha(ids?: string[]): Promise<{
  retentados: number;
  sucesso: number;
  falha: number;
}> {
  const result = { retentados: 0, sucesso: 0, falha: 0 };
  try {
    if (!pool) return result;
    await initDB();

    const config = await getCrmConfig();
    if (!config || !config.ativo || !config.webhook_url_crm) return result;

    let query = `SELECT id, tipo, tentativas, data FROM crm_eventos_saida WHERE status = 'FALHA'`;
    const params: string[] = [];
    if (ids && ids.length > 0) {
      query += ` AND id = ANY($1)`;
      params.push(ids as unknown as string);
    }
    query += ` ORDER BY created_at ASC LIMIT 50`;

    const { rows } = ids && ids.length > 0
      ? await pool.query(query, [ids])
      : await pool.query(query);

    for (const row of rows) {
      result.retentados++;
      const bodyStr = JSON.stringify(row.data);
      const signature = hmacSign(bodyStr, config.api_key_crm || '');
      const start = Date.now();

      try {
        const res = await fetch(config.webhook_url_crm, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-entur-event': row.tipo,
            'x-entur-signature': signature,
            'x-entur-event-id': row.id,
            'x-entur-timestamp': new Date().toISOString(),
          },
          body: bodyStr,
          signal: AbortSignal.timeout(5000),
        });

        const latencia = Date.now() - start;

        if (res.ok) {
          await pool.query(
            `UPDATE crm_eventos_saida SET status = 'ENVIADO', latencia_ms = $2, updated_at = NOW() WHERE id = $1`,
            [row.id, latencia]
          );
          result.sucesso++;
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch {
        const tentativas = (row.tentativas || 0) + 1;
        const proxima = calcNextRetry(tentativas);
        await pool.query(
          `UPDATE crm_eventos_saida SET tentativas = $2, proxima_tentativa = $3, updated_at = NOW() WHERE id = $1`,
          [row.id, tentativas, proxima.toISOString()]
        );
        result.falha++;
      }
    }

    return result;
  } catch {
    return result;
  }
}

// ──────────────────────────────────────────
// Verify inbound HMAC signature
// ──────────────────────────────────────────

export async function verificarAssinaturaCRM(body: string, signature: string): Promise<boolean> {
  try {
    const config = await getCrmConfig();
    if (!config || !config.api_key_entur) return false;
    const expected = hmacSign(body, config.api_key_entur);
    return expected === signature;
  } catch {
    return false;
  }
}

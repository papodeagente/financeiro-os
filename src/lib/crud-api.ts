import { NextResponse } from 'next/server';
import pool, { initDB } from './db';
import { getTenantId } from './tenant';
import { getSession } from './auth';
import { bloqueioFinanceiro } from './permissoes';
import { recusaDoPost, preservarCamposDerivados, CAMPOS_DERIVADOS } from './guarda-baixa';

export interface CrudOpcoes {
  /**
   * Exige permissão de financeiro para ler e escrever nesta tabela.
   *
   * Sem isto, o perfil VENDEDOR (que por definição não acessa o financeiro)
   * conseguia ler e gravar qualquer tabela financeira chamando a API direto:
   * a restrição existia só na interface.
   */
  somenteFinanceiro?: boolean;
  /**
   * Impede que o POST crie ou rebaixe uma conta em estado de baixa.
   *
   * O POST é um upsert cego que NÃO move caixa; só o PUT move. Duas coisas
   * perigosas passavam por aqui:
   *
   *  1. Criar direto com status PAGO/RECEBIDO deixava o saldo sem o
   *     lançamento e, ao excluir a conta, o estorno CRIAVA dinheiro do nada.
   *  2. Regravar por cima de uma conta já baixada a rebaixava para PENDENTE
   *     sem estornar; o PUT seguinte debitava o caixa de novo (era assim que
   *     pagar a mesma comissão duas vezes debitava duas vezes).
   *
   * Baixa é operação do PUT, que roda em transação com guarda otimista.
   */
  protegerBaixa?: boolean;
}

// As regras puras vivem em ./guarda-baixa para poderem ser testadas sem
// arrastar next/server para o executor de testes.

/** Devolve a resposta de recusa, ou null quando a requisição pode seguir. */
async function guardaFinanceira(opcoes: CrudOpcoes, modo: 'ler' | 'escrever') {
  if (!opcoes.somenteFinanceiro) return null;
  const bloqueio = bloqueioFinanceiro(await getSession(), modo);
  if (!bloqueio) return null;
  return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
}

export function createCrudHandlers(tableName: string, indexColumns: string[] = [], opcoes: CrudOpcoes = {}) {
  async function GET() {
    try {
      await initDB();
      if (!pool) return NextResponse.json([]);
      const recusa = await guardaFinanceira(opcoes, 'ler');
      if (recusa) return recusa;
      const tenantId = await getTenantId();
      const { rows } = await pool.query(
        `SELECT data FROM ${tableName} WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId]
      );
      return NextResponse.json(rows.map(r => r.data));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  async function POST(req: Request) {
    try {
      await initDB();
      const item = await req.json();
      if (!item || typeof item !== 'object' || !item.id || typeof item.id !== 'string') {
        return NextResponse.json({ error: 'Invalid payload: id is required' }, { status: 400 });
      }
      if (!pool) return NextResponse.json(item);
      const recusa = await guardaFinanceira(opcoes, 'escrever');
      if (recusa) return recusa;
      const tenantId = await getTenantId();

      if (opcoes.protegerBaixa) {
        const { rows: existente } = await pool.query(
          `SELECT data->>'status' AS status FROM ${tableName} WHERE id = $1 AND tenant_id = $2`,
          [item.id, tenantId],
        );
        const recusaBaixa = recusaDoPost(
          String((item as Record<string, unknown>).status ?? ''),
          existente.length > 0 ? String(existente[0].status ?? '') : null,
        );
        if (recusaBaixa) {
          return NextResponse.json({ error: recusaBaixa.erro }, { status: recusaBaixa.status });
        }
      }

      // Build dynamic upsert with tenant_id
      const paramValues: unknown[] = [item.id, tenantId, JSON.stringify(item)];
      const insertCols = ['id', 'tenant_id', 'data'];
      const insertVals = ['$1', '$2', '$3'];
      const updateSets = ['data = $3', 'updated_at = NOW()'];

      indexColumns.forEach((col, i) => {
        const paramNum = i + 4;
        paramValues.push((item as Record<string, unknown>)[col] ?? '');
        insertCols.push(col);
        insertVals.push(`$${paramNum}`);
        updateSets.push(`${col} = $${paramNum}`);
      });

      // Guarda de tenant no conflito: id já existente de OUTRO tenant não
      // pode ser sobrescrito por upsert (vira no-op silencioso).
      await pool.query(
        `INSERT INTO ${tableName} (${insertCols.join(', ')}, created_at, updated_at)
         VALUES (${insertVals.join(', ')}, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET ${updateSets.join(', ')}
         WHERE ${tableName}.tenant_id = EXCLUDED.tenant_id`,
        paramValues
      );

      return NextResponse.json(item);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  return { GET, POST };
}

export function createCrudItemHandlers(tableName: string, indexColumns: string[] = [], opcoes: CrudOpcoes = {}) {
  async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      await initDB();
      const { id } = await params;
      if (!pool) return NextResponse.json(null);
      const recusa = await guardaFinanceira(opcoes, 'ler');
      if (recusa) return recusa;
      const tenantId = await getTenantId();
      const { rows } = await pool.query(
        `SELECT data FROM ${tableName} WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(rows[0].data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      await initDB();
      const { id } = await params;
      if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });
      const item = await req.json();
      if (!item || typeof item !== 'object') {
        return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
      }
      if (!pool) return NextResponse.json(item);
      const recusa = await guardaFinanceira(opcoes, 'escrever');
      if (recusa) return recusa;
      const tenantId = await getTenantId();

      // Campos derivados ficam com o valor que está no banco, não com o que
      // veio do cliente.
      //
      // A tela de contas bancárias envia { ...existing, nome, banco, ... },
      // e `existing` carrega o saldo_atual lido quando a página abriu. Se uma
      // baixa aconteceu nesse meio-tempo, editar o nome da conta regravava o
      // saldo antigo por cima — uma correção de texto apagava recebimentos
      // reais. Todo o cuidado do UPDATE atômico do caixa era anulado aqui.
      if (CAMPOS_DERIVADOS.some(c => c in (item as Record<string, unknown>))) {
        const { rows: atual } = await pool.query(
          `SELECT data FROM ${tableName} WHERE id = $1 AND tenant_id = $2`,
          [id, tenantId],
        );
        preservarCamposDerivados(
          item as Record<string, unknown>,
          atual.length > 0 ? ((atual[0].data ?? {}) as Record<string, unknown>) : null,
        );
      }

      const paramValues: unknown[] = [id, tenantId, JSON.stringify(item)];
      const setClauses = ['data = $3', 'updated_at = NOW()'];

      indexColumns.forEach((col, i) => {
        const paramNum = i + 4;
        paramValues.push((item as Record<string, unknown>)[col] ?? '');
        setClauses.push(`${col} = $${paramNum}`);
      });

      await pool.query(
        `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $2`,
        paramValues
      );

      return NextResponse.json(item);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      await initDB();
      const { id } = await params;
      if (pool) {
        const recusa = await guardaFinanceira(opcoes, 'escrever');
        if (recusa) return recusa;
        const tenantId = await getTenantId();
        await pool.query(
          `DELETE FROM ${tableName} WHERE id = $1 AND tenant_id = $2`,
          [id, tenantId]
        );
      }
      return NextResponse.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  return { GET, PUT, DELETE };
}

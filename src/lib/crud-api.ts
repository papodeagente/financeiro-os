import { NextResponse } from 'next/server';
import pool, { initDB } from './db';
import { getTenantId } from './tenant';
import { getSession } from './auth';
import { bloqueioFinanceiro, podeExcluir, podeVerTodasVendas } from './permissoes';
import { recusaDoPost, sqlPreservarDerivados, STATUS_DE_BAIXA } from './guarda-baixa';
import { contasPermitidas, pode } from './permissoes-servidor';
import { filtrarPorConta, type FiltroDeConta } from './filtro-de-conta';
import { MENSAGEM_CONFLITO, SQL_VERSAO, semMarcasDeControle, versaoLida } from './versao-do-registro';

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
   * Leitura aberta a quem está logado, mas gravar exige editar o financeiro.
   * Para tabelas que o vendedor precisa ver (planos, metas) e nunca alterar:
   * um vendedor que grava o próprio plano de comissão está fixando quanto
   * vai receber.
   */
  escritaFinanceira?: boolean;
  /**
   * Coluna com o id do vendedor. Quem só vê as próprias vendas (VENDEDOR)
   * só lê as linhas em que ela é o próprio usuário.
   */
  colunaDoVendedor?: string;
  /**
   * Efeito colateral depois de gravar (POST ou PUT), com o item já salvo.
   *
   * Existe porque algumas tabelas carregam consequência financeira que não
   * pode depender da tela lembrar de chamar outra rota: a comissão de
   * vendedor vira conta a pagar aqui, qualquer que seja o caminho de
   * gravação. Falha no gancho NÃO desfaz a gravação (ela já aconteceu) e
   * volta como `aviso` na resposta, para a tela mostrar.
   */
  aposGravar?: (tenantId: string, item: Record<string, unknown>) => Promise<void>;
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
  /**
   * Ajusta o item antes do upsert do POST. Vale para o cadastro novo; na
   * regravação os campos derivados continuam vindo do banco. Contas
   * bancárias usam para nascer com saldo_atual = saldo_inicial (FIN2-01).
   */
  normalizarCadastro?: (item: Record<string, unknown>) => void;
  /**
   * Confere (e pode ajustar) o item antes do upsert do POST. Devolve a
   * mensagem de recusa (400) ou null. Contas usam para o rateio (05/11/2026).
   */
  validarCadastro?: (item: Record<string, unknown>) => string | null;
  /**
   * Permissão por conta bancária (05/11/2026): quem tem contas liberadas por
   * perfil de acesso ou pela restrição própria não lê linhas de outras
   * contas. Sem restrição (o padrão), a leitura é a mesma de antes.
   */
  filtroDeConta?: FiltroDeConta;
  /**
   * Aviso de edição simultânea (06/11/2026): a leitura devolve `_versao` em
   * cada registro e o PUT que manda a versão lida responde 409
   * (`conflito: true`) quando outra pessoa gravou depois. PUT sem `_versao`
   * grava como sempre.
   */
  versao?: boolean;
  /** Mensagem do 409 de edição simultânea (padrão: a genérica). */
  mensagemConflito?: string;
}

/** O registro lido, com a versão quando a tabela usa o aviso de edição simultânea. */
function comVersao(opcoes: CrudOpcoes, r: Record<string, unknown>): Record<string, unknown> {
  const data = (r.data ?? {}) as Record<string, unknown>;
  return opcoes.versao ? { ...data, _versao: String(r.v ?? '') } : data;
}

// As regras puras vivem em ./guarda-baixa para poderem ser testadas sem
// arrastar next/server para o executor de testes.

/** Devolve a resposta de recusa, ou null quando a requisição pode seguir. */
async function guardaFinanceira(opcoes: CrudOpcoes, modo: 'ler' | 'escrever') {
  const exige = opcoes.somenteFinanceiro || (modo === 'escrever' && opcoes.escritaFinanceira);
  if (!exige) return null;
  const sessao = await getSession();
  const bloqueio = bloqueioFinanceiro(sessao, modo);
  if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
  // Abaixo do teto do papel, o perfil de acesso ainda pode tirar o acesso.
  if (await pode(sessao, modo === 'escrever' ? 'editar_financeiro' : 'ver_financeiro')) return null;
  return NextResponse.json({ error: 'Seu perfil de acesso não inclui isto no financeiro.' }, { status: 403 });
}

/** Contas liberadas para a sessão, só quando a tabela filtra por conta. */
async function contasDaLeitura(opcoes: CrudOpcoes): Promise<string[] | null> {
  if (!opcoes.filtroDeConta) return null;
  return contasPermitidas(await getSession());
}

/** O cadastro de conta bancária (por id) está liberado para a sessão? */
async function contaDoCadastroLiberada(opcoes: CrudOpcoes, id: string): Promise<boolean> {
  if (!opcoes.filtroDeConta?.cadastro) return true;
  const contas = await contasDaLeitura(opcoes);
  return contas === null || contas.includes(id);
}

/** Excluir exige o perfil que exclui, em qualquer tabela (FIN-03). */
async function guardaExclusao() {
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
  if (podeExcluir(sessao) && await pode(sessao, 'excluir')) return null;
  return NextResponse.json({ error: 'Seu perfil nao pode excluir registros.' }, { status: 403 });
}

/** Id do vendedor que a leitura deve filtrar, ou null quando vê tudo. */
async function vendedorDaLeitura(opcoes: CrudOpcoes): Promise<string | null> {
  if (!opcoes.colunaDoVendedor) return null;
  const sessao = await getSession();
  if (podeVerTodasVendas(sessao)) return null;
  // Sem sessão ou sem id: filtra por um valor que não casa com nada.
  return sessao?.userId || '__sem_usuario__';
}

/** Roda o efeito colateral da tabela. Erro vira aviso, nunca desfaz a gravação. */
async function rodarGancho(opcoes: CrudOpcoes, tenantId: string, item: Record<string, unknown>): Promise<string | null> {
  if (!opcoes.aposGravar) return null;
  try {
    await opcoes.aposGravar(tenantId, item);
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'efeito colateral falhou';
    console.error('[crud] aposGravar falhou:', msg);
    return msg;
  }
}

export function createCrudHandlers(tableName: string, indexColumns: string[] = [], opcoes: CrudOpcoes = {}) {
  async function GET() {
    try {
      await initDB();
      if (!pool) return NextResponse.json([]);
      const recusa = await guardaFinanceira(opcoes, 'ler');
      if (recusa) return recusa;
      const tenantId = await getTenantId();
      const vendedor = await vendedorDaLeitura(opcoes);
      const colunas = opcoes.versao ? `data, ${SQL_VERSAO} AS v` : 'data';
      const { rows } = vendedor === null
        ? await pool.query(
          `SELECT ${colunas} FROM ${tableName} WHERE tenant_id = $1 ORDER BY created_at DESC`,
          [tenantId])
        : await pool.query(
          `SELECT ${colunas} FROM ${tableName} WHERE tenant_id = $1 AND ${opcoes.colunaDoVendedor} = $2 ORDER BY created_at DESC`,
          [tenantId, vendedor]);
      const contas = await contasDaLeitura(opcoes);
      return NextResponse.json(filtrarPorConta(rows.map(r => comVersao(opcoes, r)), opcoes.filtroDeConta, contas));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  async function POST(req: Request) {
    try {
      await initDB();
      const recebido = await req.json();
      if (!recebido || typeof recebido !== 'object' || !recebido.id || typeof recebido.id !== 'string') {
        return NextResponse.json({ error: 'Invalid payload: id is required' }, { status: 400 });
      }
      // `_versao` é controle da tela, nunca vai para o registro.
      const item = semMarcasDeControle(recebido as Record<string, unknown>) as Record<string, unknown> & { id: string };
      if (!pool) return NextResponse.json(item);
      const recusa = await guardaFinanceira(opcoes, 'escrever');
      if (recusa) return recusa;
      const tenantId = await getTenantId();
      // O POST é upsert: regravar uma conta bancária não liberada é recusado
      // (criar uma conta nova continua valendo).
      if (!(await contaDoCadastroLiberada(opcoes, item.id))) {
        const { rows: existe } = await pool.query(
          `SELECT 1 FROM ${tableName} WHERE id = $1 AND tenant_id = $2`, [item.id, tenantId]);
        if (existe.length > 0) {
          return NextResponse.json({ error: 'Esta conta bancária não está liberada para você.' }, { status: 403 });
        }
      }

      if (opcoes.protegerBaixa) {
        // Criar já baixado é recusado antes de qualquer SQL.
        const recusaBaixa = recusaDoPost(String((item as Record<string, unknown>).status ?? ''), null);
        if (recusaBaixa) {
          return NextResponse.json({ error: recusaBaixa.erro }, { status: recusaBaixa.status });
        }
      }

      opcoes.normalizarCadastro?.(item as Record<string, unknown>);
      const invalido = opcoes.validarCadastro?.(item as Record<string, unknown>) ?? null;
      if (invalido) return NextResponse.json({ error: invalido }, { status: 400 });

      // Build dynamic upsert with tenant_id
      const paramValues: unknown[] = [item.id, tenantId, JSON.stringify(item)];
      const insertCols = ['id', 'tenant_id', 'data'];
      const insertVals = ['$1', '$2', '$3'];
      // Campos derivados (saldo_atual) ficam com o valor do banco na
      // regravação, decidido DENTRO do UPDATE: o POST era um caminho para
      // escrever o saldo calculado sem lançamento (FIN2-01).
      const updateSets = [`data = ${sqlPreservarDerivados(tableName, '$3::jsonb')}`, 'updated_at = NOW()'];

      indexColumns.forEach((col, i) => {
        const paramNum = i + 4;
        paramValues.push((item as Record<string, unknown>)[col] ?? '');
        insertCols.push(col);
        insertVals.push(`$${paramNum}`);
        updateSets.push(`${col} = $${paramNum}`);
      });

      // Guarda de tenant no conflito: id já existente de OUTRO tenant não
      // pode ser sobrescrito por upsert. Com protegerBaixa, a linha já
      // baixada também não é regravada, e a checagem está no próprio UPDATE:
      // ler o status antes e gravar depois deixava uma baixa concorrente ser
      // rebaixada a PENDENTE sem estorno (FIN2-03).
      let guardaBaixa = '';
      if (opcoes.protegerBaixa) {
        paramValues.push(STATUS_DE_BAIXA);
        guardaBaixa = ` AND COALESCE(${tableName}.data->>'status', '') <> ALL ($${paramValues.length}::text[])`;
      }
      const { rows: gravadas } = await pool.query(
        `INSERT INTO ${tableName} (${insertCols.join(', ')}, created_at, updated_at)
         VALUES (${insertVals.join(', ')}, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET ${updateSets.join(', ')}
         WHERE ${tableName}.tenant_id = EXCLUDED.tenant_id${guardaBaixa}
         RETURNING data`,
        paramValues
      );
      if (gravadas.length === 0) {
        if (opcoes.protegerBaixa) {
          const { rows: atual } = await pool.query(
            `SELECT data->>'status' AS status FROM ${tableName} WHERE id = $1 AND tenant_id = $2`,
            [item.id, tenantId],
          );
          const recusaBaixa = atual.length > 0 ? recusaDoPost('', String(atual[0].status ?? '')) : null;
          if (recusaBaixa) return NextResponse.json({ error: recusaBaixa.erro }, { status: recusaBaixa.status });
        }
        // Id de outra agência: nada foi gravado.
        return NextResponse.json({ error: 'Registro não encontrado' }, { status: 404 });
      }
      const salvo = (gravadas[0].data ?? item) as Record<string, unknown>;

      const aviso = await rodarGancho(opcoes, tenantId, salvo);
      return NextResponse.json(aviso ? { ...salvo, aviso } : salvo);
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
      const vendedor = await vendedorDaLeitura(opcoes);
      const colunas = opcoes.versao ? `data, ${SQL_VERSAO} AS v` : 'data';
      const { rows } = vendedor === null
        ? await pool.query(
          `SELECT ${colunas} FROM ${tableName} WHERE id = $1 AND tenant_id = $2`,
          [id, tenantId])
        : await pool.query(
          `SELECT ${colunas} FROM ${tableName} WHERE id = $1 AND tenant_id = $2 AND ${opcoes.colunaDoVendedor} = $3`,
          [id, tenantId, vendedor]);
      if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const contas = await contasDaLeitura(opcoes);
      if (filtrarPorConta([rows[0].data as Record<string, unknown>], opcoes.filtroDeConta, contas).length === 0) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      return NextResponse.json(comVersao(opcoes, rows[0]));
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
      const recebido = await req.json();
      if (!recebido || typeof recebido !== 'object') {
        return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
      }
      const lida = opcoes.versao ? versaoLida(recebido as Record<string, unknown>) : null;
      const item = semMarcasDeControle(recebido as Record<string, unknown>);
      if (!pool) return NextResponse.json(item);
      const recusa = await guardaFinanceira(opcoes, 'escrever');
      if (recusa) return recusa;
      if (!(await contaDoCadastroLiberada(opcoes, id))) {
        return NextResponse.json({ error: 'Esta conta bancária não está liberada para você.' }, { status: 403 });
      }
      const tenantId = await getTenantId();

      // Campos derivados ficam com o valor que está no banco, não com o que
      // veio do cliente.
      //
      // A tela de contas bancárias envia { ...existing, nome, banco, ... },
      // e `existing` carrega o saldo_atual lido quando a página abriu. Se uma
      // baixa aconteceu nesse meio-tempo, editar o nome da conta regravava o
      // saldo antigo por cima. A preservação acontece DENTRO do UPDATE: ler o
      // saldo antes e gravar depois ainda perdia a baixa que caísse entre os
      // dois (FIN2-03).
      const paramValues: unknown[] = [id, tenantId, JSON.stringify(item)];
      const setClauses = [`data = ${sqlPreservarDerivados(tableName, '$3::jsonb')}`, 'updated_at = NOW()'];

      indexColumns.forEach((col, i) => {
        const paramNum = i + 4;
        paramValues.push((item as Record<string, unknown>)[col] ?? '');
        setClauses.push(`${col} = $${paramNum}`);
      });

      let guardaBaixa = '';
      if (opcoes.protegerBaixa) {
        paramValues.push(STATUS_DE_BAIXA);
        guardaBaixa = ` AND COALESCE(data->>'status', '') <> ALL ($${paramValues.length}::text[])`;
      }
      // Edição simultânea: só grava se ninguém gravou depois da leitura.
      let guardaVersao = '';
      if (lida !== null) {
        paramValues.push(lida);
        guardaVersao = ` AND ${SQL_VERSAO} = $${paramValues.length}`;
      }
      const { rows: gravadas } = await pool.query(
        `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $2${guardaBaixa}${guardaVersao} RETURNING data`,
        paramValues
      );
      if (gravadas.length === 0 && lida !== null) {
        const { rows: existe } = await pool.query(
          `SELECT ${SQL_VERSAO} AS v FROM ${tableName} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
        if (existe.length > 0 && String(existe[0].v) !== lida) {
          return NextResponse.json({ error: opcoes.mensagemConflito ?? MENSAGEM_CONFLITO, conflito: true }, { status: 409 });
        }
      }
      if (gravadas.length === 0) {
        return NextResponse.json(
          { error: opcoes.protegerBaixa ? 'Registro não encontrado ou já baixado' : 'Registro não encontrado' },
          { status: opcoes.protegerBaixa ? 409 : 404 },
        );
      }
      const salvo = (gravadas[0].data ?? item) as Record<string, unknown>;

      const aviso = await rodarGancho(opcoes, tenantId, { ...salvo, id });
      return NextResponse.json(aviso ? { ...salvo, aviso } : salvo);
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
        const recusa = (await guardaExclusao()) ?? (await guardaFinanceira(opcoes, 'escrever'));
        if (recusa) return recusa;
        if (!(await contaDoCadastroLiberada(opcoes, id))) {
          return NextResponse.json({ error: 'Esta conta bancária não está liberada para você.' }, { status: 403 });
        }
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

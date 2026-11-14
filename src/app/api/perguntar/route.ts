import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession, type SessionPayload } from '@/lib/auth';
import { chaveAnthropic, type Consulta } from '@/lib/config-apis';
import { registrarEventoAuditoria } from '@/lib/audit';
import { hojeISO } from '@/lib/money';
import { bloqueioFinanceiro, podeVerTodasVendas } from '@/lib/permissoes';
import { contasPermitidas, pode, tenantDaSessao } from '@/lib/permissoes-servidor';
import { escopoDaSessao, type ExecutorEmpresas } from '@/lib/empresas-servidor';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { executarFerramenta, temAlgumDireito, type ContextoDaPergunta, type DireitosDaPergunta } from '@/lib/perguntar/ferramentas';
import { MODELO_DA_PERGUNTA, responderPergunta } from '@/lib/perguntar/orquestrar';
import { concluirPergunta, reservarPergunta, usoDoDia } from '@/lib/perguntar/uso';
import { recusaModulo } from '@/lib/guarda-rota';

/**
 * Perguntar em texto (E7, fechamento).
 *
 *   GET   → { chave_ligada, pode_perguntar, uso: { usados, limite }, como_ligar }
 *   POST  { pergunta } → { texto, resultados: [{ titulo, numeros, filtro, link, linhas, recusado? }], uso }
 *
 * A IA não acessa o banco: escolhe entre consultas fixas (lib/perguntar/
 * ferramentas.ts), que rodam com os direitos de quem perguntou (contas e
 * empresas liberadas, ganho da agência, só as próprias vendas). A chave é a
 * da agência; o limite é por agência, a cada 24 horas.
 */
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };
const COMO_LIGAR = 'A pergunta em texto usa a chave de IA da agência. Um administrador cadastra a chave em Configurações › Integrações › IA, e a caixa passa a responder na hora.';

async function direitosDa(sessao: SessionPayload, exec: ExecutorSQL): Promise<DireitosDaPergunta> {
  const verFinanceiro = bloqueioFinanceiro(sessao, 'ler') === null && await pode(sessao, 'ver_financeiro');
  const [contaBancaria, resumoSaldo, relatorios, verReceita] = await Promise.all([
    pode(sessao, 'ver_conta_bancaria'), pode(sessao, 'resumo_saldo'), pode(sessao, 'acessar_relatorios'), pode(sessao, 'ver_colunas_comissao'),
  ]);
  return {
    verFinanceiro,
    verSaldos: verFinanceiro && contaBancaria && resumoSaldo,
    relatorios,
    verReceita,
    vendedorId: podeVerTodasVendas(sessao) ? null : (sessao.userId || '-'),
    contasLiberadas: await contasPermitidas(sessao),
    empresas: (await escopoDaSessao(sessao, exec as unknown as ExecutorEmpresas)).visiveis,
  };
}

export async function GET() {
  const semModulo = await recusaModulo('ia');
  if (semModulo) return semModulo;
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401, headers: HEADERS });
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503, headers: HEADERS });
  const exec = pool as unknown as ExecutorSQL;
  const tenantId = tenantDaSessao(sessao);
  const direitos = await direitosDa(sessao, exec);
  const ia = await chaveAnthropic(pool as unknown as Consulta, tenantId, MODELO_DA_PERGUNTA);
  return NextResponse.json({
    chave_ligada: Boolean(ia),
    pode_perguntar: temAlgumDireito(direitos),
    uso: await usoDoDia(exec, tenantId),
    como_ligar: COMO_LIGAR,
  }, { headers: HEADERS });
}

export async function POST(req: Request) {
  const semModulo = await recusaModulo('ia');
  if (semModulo) return semModulo;
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401, headers: HEADERS });
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503, headers: HEADERS });
  const exec = pool as unknown as ExecutorSQL;
  const tenantId = tenantDaSessao(sessao);
  if (!tenantId) return NextResponse.json({ error: 'Agência não identificada.' }, { status: 403, headers: HEADERS });

  const direitos = await direitosDa(sessao, exec);
  // Sem nenhum direito que a caixa use, nem chama a IA.
  if (!temAlgumDireito(direitos)) {
    return NextResponse.json({ error: 'Seu acesso não inclui o financeiro nem os relatórios.', codigo: 'SEM_DIREITO' }, { status: 403, headers: HEADERS });
  }
  const corpo = (await req.json().catch(() => null)) as { pergunta?: unknown } | null;
  const pergunta = String(corpo?.pergunta ?? '').replace(/\s+/g, ' ').trim();
  if (pergunta.length < 3) return NextResponse.json({ error: 'Escreva a pergunta.' }, { status: 400, headers: HEADERS });
  if (pergunta.length > 500) return NextResponse.json({ error: 'Pergunta longa demais: até 500 letras.' }, { status: 400, headers: HEADERS });

  const ia = await chaveAnthropic(pool as unknown as Consulta, tenantId, MODELO_DA_PERGUNTA);
  if (!ia) return NextResponse.json({ error: COMO_LIGAR, codigo: 'sem_chave_ia' }, { status: 400, headers: HEADERS });

  const reserva = await emTransacao(e => reservarPergunta(e, { tenantId, usuarioId: sessao.userId || '', pergunta }));
  if (reserva.tipo === 'limite') {
    return NextResponse.json({
      error: `A agência chegou ao limite de ${reserva.uso.limite} perguntas em 24 horas. Tente de novo mais tarde.`, codigo: 'LIMITE', uso: reserva.uso,
    }, { status: 429, headers: HEADERS });
  }

  const ctx: ContextoDaPergunta = { exec, tenantId, hoje: hojeISO(), direitos };
  try {
    const r = await responderPergunta({
      apiKey: ia.api_key, modelo: MODELO_DA_PERGUNTA, pergunta, hoje: ctx.hoje,
      executar: (nome, entrada) => executarFerramenta(ctx, nome, entrada),
    });
    const ferramentas = r.resultados.map(x => (x.recusado ? `${x.ferramenta}:recusado` : x.ferramenta));
    await concluirPergunta(exec, { tenantId, id: reserva.id, estado: r.ok ? 'respondida' : 'falhou', ferramentas, rodadas: r.rodadas });
    await registrarEventoAuditoria({
      session: sessao, tenantId, acao: 'VISUALIZAR', modulo: 'Financeiro', entidade: 'perguntas_ia', entidadeId: reserva.id,
      descricao: `Perguntou em texto: "${pergunta.slice(0, 160)}" (consultas: ${ferramentas.join(', ') || 'nenhuma'}).`,
    }).catch(() => undefined);
    const uso = await usoDoDia(exec, tenantId);
    if (!r.ok) return NextResponse.json({ error: r.erro, resultados: r.resultados, uso }, { status: r.status, headers: HEADERS });
    return NextResponse.json({ texto: r.texto, resultados: r.resultados, uso }, { headers: HEADERS });
  } catch (e) {
    await concluirPergunta(exec, { tenantId, id: reserva.id, estado: 'falhou', ferramentas: [], rodadas: 0 }).catch(() => undefined);
    console.error('[perguntar]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível responder agora. Tente de novo.' }, { status: 500, headers: HEADERS });
  }
}

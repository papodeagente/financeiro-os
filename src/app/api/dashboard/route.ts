import { NextResponse } from 'next/server';

import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { addDias, hojeISO } from '@/lib/money';
import { carregarDashboard, type DashboardFinanceiro } from '@/lib/dashboard-financeiro';

/**
 * A Central de Inteligência Financeira: uma requisição, quinze agregações.
 *
 * POR QUE UMA ROTA PRÓPRIA. O CRUD genérico devolve a tabela inteira do tenant
 * sem filtro nem paginação, e o painel antigo baixava sete tabelas para somar
 * no navegador. Aqui a conta acontece onde os dados estão.
 *
 * GUARDA FINANCEIRA, E ESTA PARTE IMPORTA. Saldo em caixa, margem e posição de
 * fornecedor são dados de dono. As rotas de contas a receber e de contas
 * bancárias não exigem permissão de financeiro hoje — quem tem sessão lê tudo.
 * Esta rota exige, e é por isso que o dashboard novo não amplia essa brecha.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Dias entre duas datas civis, contando os dois extremos. */
function tamanhoEmDias(de: string, ate: string): number {
  const ms = Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export async function GET(req: Request) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });

    const recusa = bloqueioFinanceiro(await getSession(), 'ler');
    if (recusa) return NextResponse.json({ error: recusa.erro }, { status: recusa.status });

    const tenantId = await getTenantId();
    const url = new URL(req.url);
    const hoje = hojeISO();

    // Período padrão: o mês corrente. Parâmetro fora de forma é ignorado em
    // silêncio de propósito — um período inválido não pode derrubar o painel.
    const deBruto = url.searchParams.get('de') ?? '';
    const ateBruto = url.searchParams.get('ate') ?? '';
    const de = DATA.test(deBruto) ? deBruto : `${hoje.slice(0, 7)}-01`;
    const ate = DATA.test(ateBruto) && ateBruto >= de ? ateBruto : hoje;

    // A janela anterior tem o MESMO tamanho e termina no dia anterior ao início.
    // Comparar um mês cheio com um mês pela metade é o jeito mais fácil de
    // anunciar uma queda que não existe.
    const dias = tamanhoEmDias(de, ate);
    const ateAnterior = addDias(de, -1);
    const deAnterior = addDias(ateAnterior, -(dias - 1));

    const dados: DashboardFinanceiro = await carregarDashboard(pool, {
      tenantId, de, ate, hoje, deAnterior, ateAnterior,
    });

    return NextResponse.json(dados, {
      // O painel é relido a cada troca de período; o navegador não pode servir
      // um retrato velho de dinheiro.
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

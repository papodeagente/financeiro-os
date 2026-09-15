import { NextResponse } from 'next/server';

import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { hojeISO } from '@/lib/money';
import { carregarDashboard, type DashboardFinanceiro } from '@/lib/dashboard-financeiro';
import {
  PERIODOS_NA_ORDEM, janelaDeComparacao, resolverPeriodo, type ChaveDePeriodo,
} from '@/lib/periodo-financeiro';

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
const CHAVES = new Set<string>(PERIODOS_NA_ORDEM);

export async function GET(req: Request) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });

    const recusa = bloqueioFinanceiro(await getSession(), 'ler');
    if (recusa) return NextResponse.json({ error: recusa.erro }, { status: recusa.status });

    const tenantId = await getTenantId();
    const url = new URL(req.url);
    const hoje = hojeISO();

    // A CHAVE do período, não só as datas.
    //
    // Sem ela o servidor não tem como saber COM O QUE comparar: "Este ano"
    // compara com o mesmo intervalo do ano passado (turismo é sazonal), e os
    // demais comparam com a janela anterior de mesmo tamanho. Antes a rota
    // recalculava sempre a janela anterior, então a tela escrevia "vs. ano
    // passado" e o número comparava com abril a dezembro. O rótulo nomeava uma
    // janela e o cálculo usava outra.
    const chaveBruta = String(url.searchParams.get('periodo') ?? '');
    const chave: ChaveDePeriodo = CHAVES.has(chaveBruta) ? (chaveBruta as ChaveDePeriodo) : 'PERSONALIZADO';

    const deBruto = url.searchParams.get('de') ?? '';
    const ateBruto = url.searchParams.get('ate') ?? '';
    // Parâmetro fora de forma é ignorado em silêncio de propósito: um período
    // inválido não pode derrubar o painel.
    const janela = resolverPeriodo(chave, hoje, {
      de: DATA.test(deBruto) ? deBruto : undefined,
      ate: DATA.test(ateBruto) ? ateBruto : undefined,
    });
    const { de, ate } = janela;
    // A janela de comparação sai do MESMO módulo que a tela usa para rotular.
    const anterior = janelaDeComparacao(janela);
    const deAnterior = anterior.de;
    const ateAnterior = anterior.ate;

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

import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin, recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { gravarChaveDaAgencia } from '@/lib/encargos-servidor';
import { listarConfigs } from '@/lib/plataformas/servico';
import { lerConfigCobranca, normalizarConfigCobranca, type ConfigCobranca } from '@/lib/cobranca/config';
import { configParaTela, configDaTela, type ConfigNaTela } from '@/lib/cobranca/config-tela';
import { respostaDeErroDaCobranca } from '@/lib/cobranca/rota';

// Configurações › Cobrança (E3, 05/11/2026). Guardada em agencia.data.cobranca.
//   GET → { provedor_padrao ('asaas'|'pagarme'|''), tipo_padrao, conta_bancaria_id, juros_am_pct, multa_pct,
//           desconto_pct, desconto_dias, encargos_da_politica (true = os números vêm da política de
//           Configurações › Financeiro), regua: { ligada, dias: number[] (−5 = cinco dias antes),
//           canais: { email, whatsapp } }, descricao_modelo ({descricao}, {parcela}, {agencia}),
//           provedores: [{ id, conectado, capacidades, conta_bancaria_id }],
//           e ainda: tolerancia_dias, pagarme_conta_psp, notificacoes_do_provedor, dias_link, encargos, politica_cobranca }
//   PUT (só administrador) o mesmo formato, sem `provedores`/`encargos_da_politica` → o GET atualizado.
//        Enviar juros/multa/desconto grava números próprios da cobrança; `usar_politica: true` volta à política.
export const dynamic = 'force-dynamic';

async function resposta(exec: ExecutorSQL, tenantId: string) {
  const { config, politica } = await lerConfigCobranca(exec, tenantId);
  const integracoes = await listarConfigs(tenantId);
  return configParaTela(config, politica, integracoes);
}

export async function GET() {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  try {
    return NextResponse.json(await resposta(pool as unknown as ExecutorSQL, await getTenantId()));
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'config');
  }
}

export async function PUT(req: Request) {
  const recusa = await recusaAdmin();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = (await req.json().catch(() => null)) as (Partial<ConfigNaTela> & Partial<ConfigCobranca>) | null;
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  const tenantId = await getTenantId();
  try {
    await emTransacao(async exec => {
      const { config, politica } = await lerConfigCobranca(exec, tenantId);
      await gravarChaveDaAgencia(exec, tenantId, 'cobranca', normalizarConfigCobranca(configDaTela(config, politica, corpo)));
    });
    return NextResponse.json(await resposta(pool as unknown as ExecutorSQL, tenantId));
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'config');
  }
}

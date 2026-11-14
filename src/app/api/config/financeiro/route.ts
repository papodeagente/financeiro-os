import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin, recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { normalizarPolitica, type PoliticaCobranca } from '@/lib/baixa-calculo';
import { normalizarAvisos } from '@/lib/avisos-vencimento';
import { normalizarAvisoWhatsApp, telefonesInvalidos } from '@/lib/avisos-vencimento-whatsapp';
import { ErroEncargos, gravarChaveDaAgencia, salvarCategoriasDosEncargos } from '@/lib/encargos-servidor';
import { lerChavesDaEmpresa, temConfigPropria, type ExecutorEmpresas } from '@/lib/empresas-servidor';
import { empresaDoPedido } from '@/lib/empresas-rota';


// Configurações › Financeiro (05/11/2026):
//  - politica_cobranca: juros, multa, tolerância e desconto por antecipação
//    que a liquidação SUGERE (a pessoa sempre pode mudar na hora);
//  - categorias_encargos: em que categoria do resultado entram juros, multa,
//    desconto e taxa registrados na liquidação;
//  - avisos_vencimento: quais avisos de vencimento vão para o sino;
//  - avisos_vencimento_whatsapp (E7): o resumo do dia pelo WhatsApp do CRM para
//    os números da equipe cadastrados (desligado por padrão; da agência inteira).
// O PUT grava só as chaves enviadas, sem tocar o resto do cadastro.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ politica_cobranca: null, categorias_encargos: {}, avisos_vencimento: normalizarAvisos(null) });
  const tenantId = await getTenantId();
  const { empresa, recusa: recusaEmpresa } = await empresaDoPedido(req);
  if (recusaEmpresa) return recusaEmpresa;
  if (empresa) {
    // Empresa além da principal: o que ela gravou e, no resto, o da agência.
    const exec = pool as unknown as ExecutorEmpresas;
    const c = await lerChavesDaEmpresa(exec, tenantId, empresa, ['politica_cobranca', 'categorias_encargos', 'avisos_vencimento']);
    return NextResponse.json({
      politica_cobranca: c.politica_cobranca ?? null,
      categorias_encargos: c.categorias_encargos ?? {},
      avisos_vencimento: normalizarAvisos(c.avisos_vencimento),
      empresa_id: empresa,
      ...(await temConfigPropria(exec, tenantId, empresa, 'financeiro')),
    });
  }
  const { rows } = await pool.query(
    `SELECT data->'politica_cobranca' AS p, data->'categorias_encargos' AS c, data->'avisos_vencimento' AS a,
            data->'avisos_vencimento_whatsapp' AS w
       FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
    [tenantId],
  );
  return NextResponse.json({
    politica_cobranca: rows[0]?.p ?? null,
    categorias_encargos: rows[0]?.c ?? {},
    avisos_vencimento: normalizarAvisos(rows[0]?.a),
    avisos_vencimento_whatsapp: normalizarAvisoWhatsApp(rows[0]?.w),
  });
}

export async function PUT(req: Request) {
  const recusa = await recusaAdmin();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = (await req.json().catch(() => ({}))) as {
    politica_cobranca?: Partial<PoliticaCobranca>;
    categorias_encargos?: unknown;
    avisos_vencimento?: unknown;
    avisos_vencimento_whatsapp?: unknown;
  };
  const tenantId = await getTenantId();
  const { empresa, recusa: recusaEmpresa } = await empresaDoPedido(req);
  if (recusaEmpresa) return recusaEmpresa;
  if ('avisos_vencimento_whatsapp' in corpo) {
    const ruins = telefonesInvalidos(corpo.avisos_vencimento_whatsapp);
    if (ruins.length) {
      return NextResponse.json({ error: `${ruins.length === 1 ? 'Este número não parece' : 'Estes números não parecem'} um celular do Brasil com DDD: ${ruins.join(', ')}.` }, { status: 400 });
    }
    const w = normalizarAvisoWhatsApp(corpo.avisos_vencimento_whatsapp);
    if (w.ligado && !w.telefones.length) {
      return NextResponse.json({ error: 'Cadastre pelo menos um número para receber o aviso pelo WhatsApp.' }, { status: 400 });
    }
  }
  try {
    const resposta = await emTransacao(async exec => {
      const r: Record<string, unknown> = {};
      if ('politica_cobranca' in corpo) {
        r.politica_cobranca = normalizarPolitica(corpo.politica_cobranca);
        await gravarChaveDaAgencia(exec, tenantId, 'politica_cobranca', r.politica_cobranca, empresa);
      }
      if ('categorias_encargos' in corpo) {
        r.categorias_encargos = await salvarCategoriasDosEncargos(exec, tenantId, corpo.categorias_encargos, empresa);
      }
      // Os avisos de vencimento valem para a agência inteira (o sino é um só).
      if ('avisos_vencimento' in corpo && !empresa) {
        r.avisos_vencimento = normalizarAvisos(corpo.avisos_vencimento);
        await gravarChaveDaAgencia(exec, tenantId, 'avisos_vencimento', r.avisos_vencimento);
      }
      // O resumo pelo WhatsApp também é da agência inteira (E7).
      if ('avisos_vencimento_whatsapp' in corpo && !empresa) {
        r.avisos_vencimento_whatsapp = normalizarAvisoWhatsApp(corpo.avisos_vencimento_whatsapp);
        await gravarChaveDaAgencia(exec, tenantId, 'avisos_vencimento_whatsapp', r.avisos_vencimento_whatsapp);
      }
      return r;
    });
    return NextResponse.json(resposta);
  } catch (e) {
    if (e instanceof ErroEncargos) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { gravarChaveDaAgencia } from '@/lib/encargos-servidor';
import { ehSecaoPorEmpresa } from '@/lib/empresas';
import {
  adaptadorDeChaves, copiarConfiguracao, type AdaptadorDaSecao, type ExecutorEmpresas,
} from '@/lib/empresas-servidor';
import { respostaDeErroDaEmpresa } from '@/lib/empresas-rota';
import { carregarConfigFiscal, configParaCliente, salvarConfigFiscal } from '@/lib/nfse-servico';
import type { ConfigFiscal } from '@/lib/nfse-tipos';

// "Copiar de outra empresa" (E7): leva a configuração de uma seção de uma
// empresa para outra, menos o que é da própria empresa (token e conexão do
// emissor, certificado, CNPJ). Só administrador.
//   POST { secao: 'financeiro'|'cobranca'|'vendas'|'notas', de, para } → { secao, para, config }
export const dynamic = 'force-dynamic';

/** Notas: a configuração fiscal de cada empresa (linha própria em config_fiscal). */
const adaptadorDeNotas: AdaptadorDaSecao = {
  async ler(_exec, tenantId, empresaId) {
    return { ...(await carregarConfigFiscal(tenantId, empresaId)) } as unknown as Record<string, unknown>;
  },
  async gravar(_exec, tenantId, empresaId, valor) {
    const atual = await carregarConfigFiscal(tenantId, empresaId);
    await salvarConfigFiscal(tenantId, { ...atual, ...(valor as Partial<ConfigFiscal>) } as ConfigFiscal, empresaId);
  },
};

export async function POST(req: Request) {
  const recusa = await recusaAdmin();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = (await req.json().catch(() => null)) as { secao?: unknown; de?: unknown; para?: unknown } | null;
  const secao = corpo?.secao;
  if (!ehSecaoPorEmpresa(secao)) return NextResponse.json({ error: 'Escolha o que copiar.' }, { status: 400 });
  const de = typeof corpo?.de === 'string' ? corpo.de.trim() : '';
  const para = typeof corpo?.para === 'string' ? corpo.para.trim() : '';
  try {
    const tenantId = await getTenantId();
    if (secao === 'notas') {
      // A configuração fiscal não roda em transação (o token passa pelo cofre).
      const config = await copiarConfiguracao(pool as unknown as ExecutorEmpresas, tenantId, secao, de, para, adaptadorDeNotas);
      return NextResponse.json({ secao, para, config: configParaCliente(config as unknown as ConfigFiscal) });
    }
    const adaptador = adaptadorDeChaves(secao, (exec, t, chave, valor) => gravarChaveDaAgencia(exec as unknown as ExecutorSQL, t, chave, valor));
    const config = await emTransacao(exec => copiarConfiguracao(exec as unknown as ExecutorEmpresas, tenantId, secao, de, para, adaptador));
    return NextResponse.json({ secao, para, config });
  } catch (e) {
    return respostaDeErroDaEmpresa(e);
  }
}

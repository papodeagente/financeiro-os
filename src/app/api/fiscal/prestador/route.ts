import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { carregarConfigFiscal, carregarEmitente } from '@/lib/nfse-servico';
import { ErroFiscal, emissorDaConfig } from '@/lib/nfse-emissor';
import { EmissorAceleraAPI } from '@/lib/nfse-acelera';

/**
 * Sincroniza o cadastro do prestador com o emissor e devolve as pendências
 * que ele mesmo aponta.
 *
 * No padrão nacional o prestador não viaja em cada nota: ele é configurado
 * uma vez no emissor. Sem este passo a emissão falha com "pendências na
 * configuração" e ninguém descobre qual campo está faltando — a lista vem
 * do outro lado, então é de lá que ela tem que ser lida.
 */
export async function POST() {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const tenantId = await getTenantId();
    const [config, emitente] = await Promise.all([
      carregarConfigFiscal(tenantId),
      carregarEmitente(tenantId),
    ]);

    const emissor = emissorDaConfig(config);
    if (!(emissor instanceof EmissorAceleraAPI)) {
      return NextResponse.json(
        { error: 'O emissor configurado não tem cadastro de prestador para sincronizar.' },
        { status: 400 },
      );
    }
    await emissor.configurarPrestador({ config, emitente });
    const pendencias = await emissor.pendencias(config);
    return NextResponse.json(pendencias);
  } catch (e) {
    const msg = e instanceof ErroFiscal
      ? e.message
      : e instanceof Error ? e.message : 'Erro ao sincronizar o prestador.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/** Só lê as pendências, sem reenviar o cadastro. */
export async function GET() {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const config = await carregarConfigFiscal(await getTenantId());
    const emissor = emissorDaConfig(config);
    if (!(emissor instanceof EmissorAceleraAPI)) {
      return NextResponse.json({ pronto: true, itens: [] });
    }
    return NextResponse.json(await emissor.pendencias(config));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

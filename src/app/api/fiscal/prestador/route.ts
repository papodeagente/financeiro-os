import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import {
  carregarConfigFiscal,
  carregarEmitente,
  configParaCliente,
  salvarConfigFiscal,
} from '@/lib/nfse-servico';
import type { ConfigFiscal } from '@/lib/nfse-tipos';
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
export async function POST(req: Request) {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const tenantId = await getTenantId();
    const [gravada, emitente] = await Promise.all([
      carregarConfigFiscal(tenantId),
      carregarEmitente(tenantId),
    ]);

    // SINCRONIZAR SALVA ANTES. A versão anterior sincronizava o que estava
    // GRAVADO, não o que estava na tela, e a solução era um aviso pedindo
    // "salve antes de sincronizar". Quem não lia o aviso mandava a
    // configuração velha e recebia do emissor a reclamação dos campos que
    // acabara de preencher. Passo escondido é bug.
    let config = gravada;
    try {
      const corpo = (await req.json()) as Partial<ConfigFiscal> | null;
      if (corpo && typeof corpo === 'object') {
        config = {
          ...gravada,
          ...corpo,
          id: gravada.id,
          // Token e certificado nunca chegam do navegador: só a rota de
          // conexão e a de certificado mexem neles.
          token: gravada.token,
          token_mascarado: undefined,
          certificado: gravada.certificado,
          empresa_id: gravada.empresa_id,
        };
        await salvarConfigFiscal(tenantId, config);
      }
    } catch {
      // Sem corpo, sincroniza o que já está gravado.
      config = gravada;
    }

    const emissor = emissorDaConfig(config);
    if (!(emissor instanceof EmissorAceleraAPI)) {
      return NextResponse.json(
        { error: 'O emissor configurado não tem cadastro de prestador para sincronizar.' },
        { status: 400 },
      );
    }
    await emissor.configurarPrestador({ config, emitente });
    const pendencias = await emissor.pendencias(config);
    return NextResponse.json({ ...pendencias, config: configParaCliente(config) });
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

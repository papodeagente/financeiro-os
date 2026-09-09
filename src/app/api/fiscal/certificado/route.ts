import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { generateId } from '@/lib/utils';
import {
  carregarConfigFiscal,
  configParaCliente,
  salvarConfigFiscal,
} from '@/lib/nfse-servico';
import { ErroFiscal, emissorDaConfig } from '@/lib/nfse-emissor';

/** Certificado A1 costuma ter menos de 10 KB; 2 MB já é folga generosa. */
const TAMANHO_MAXIMO = 2 * 1024 * 1024;

/**
 * Recebe o certificado digital A1 e repassa ao gateway.
 *
 * O ARQUIVO NÃO É GRAVADO AQUI. Ele viaja para o gateway, que é quem assina
 * as notas, e o sistema guarda só a referência devolvida mais a validade,
 * para avisar antes de vencer. Uma cópia do .pfx no banco seria um segundo
 * lugar de onde o certificado pode vazar, sem nenhum ganho.
 *
 * A senha também não é gravada: ela existe apenas durante esta requisição.
 */
export async function POST(req: Request) {
  try {
    await initDB();
    const sessao = await getSession();
    const bloqueio = bloqueioFinanceiro(sessao, 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const tenantId = await getTenantId();

    const form = await req.formData();
    const arquivo = form.get('arquivo');
    const senha = String(form.get('senha') ?? '');
    const email = String(form.get('email') ?? '');

    if (!(arquivo instanceof File) || arquivo.size === 0) {
      return NextResponse.json({ error: 'Selecione o arquivo do certificado (.pfx ou .p12).' }, { status: 400 });
    }
    if (arquivo.size > TAMANHO_MAXIMO) {
      return NextResponse.json({ error: 'Arquivo grande demais para ser um certificado A1.' }, { status: 400 });
    }
    if (!senha) {
      return NextResponse.json({ error: 'Informe a senha do certificado.' }, { status: 400 });
    }
    const nome = arquivo.name || 'certificado.pfx';
    if (!/\.(pfx|p12)$/i.test(nome)) {
      return NextResponse.json(
        { error: 'O certificado A1 é um arquivo .pfx ou .p12. Certificado A3 (token ou cartão) não pode ser usado por um sistema que emite sozinho.' },
        { status: 400 },
      );
    }

    const config = await carregarConfigFiscal(tenantId);
    if (!config.provedor) {
      return NextResponse.json(
        { error: 'Escolha e salve o emissor de nota antes de enviar o certificado.' },
        { status: 400 },
      );
    }

    const emissor = emissorDaConfig(config);
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const meta = await emissor.enviarCertificado({
      arquivo: bytes,
      nome_arquivo: nome,
      senha,
      email,
      // O emissor precisa da config para saber ambiente e token.
      config,
    } as Parameters<typeof emissor.enviarCertificado>[0]);

    const novo = {
      ...config,
      certificado: {
        ...meta,
        id: generateId(),
        enviado_em: new Date().toISOString(),
        enviado_por: sessao?.nome || sessao?.email || '',
      },
    };
    await salvarConfigFiscal(tenantId, novo);
    return NextResponse.json({ config: configParaCliente(novo) });
  } catch (e) {
    const msg = e instanceof ErroFiscal
      ? e.message
      : e instanceof Error ? e.message : 'Erro ao enviar o certificado.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/** Remove o certificado da configuração. A nota deixa de poder ser emitida. */
export async function DELETE() {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const tenantId = await getTenantId();
    const config = await carregarConfigFiscal(tenantId);
    const novo = { ...config, certificado: null };
    await salvarConfigFiscal(tenantId, novo);
    return NextResponse.json({ config: configParaCliente(novo) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

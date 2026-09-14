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
import { ErroFiscal } from '@/lib/nfse-emissor';
import {
  EmissorAceleraAPI,
  acharEmpresaPorCnpj,
  chaveOperacaoMascarada,
  criarEmpresaAcelera,
  regenerarTokenEmpresa,
} from '@/lib/nfse-acelera';

/**
 * Conecta ESTA agência à AceleraAPI.
 *
 * A agência não cola token nenhum: o sistema cadastra a empresa dela com a
 * chave de desenvolvedor da operação (ACELERA_API_KEY, do servidor) e guarda
 * o token `ace_` que volta. É isso que faz "configuração única, cada um emite
 * a própria nota" num sistema multi-tenant.
 *
 * O TOKEN VEM UMA VEZ SÓ. Por isso ele é gravado antes de qualquer outra
 * coisa: se a configuração do prestador falhar depois, a agência continua
 * conectada e é só tentar de novo. Gravar por último arriscaria perder o
 * token e deixar uma empresa órfã no cadastro.
 */
export async function POST(req: Request) {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const tenantId = await getTenantId();

    const [config, emitente] = await Promise.all([
      carregarConfigFiscal(tenantId),
      carregarEmitente(tenantId),
    ]);

    // `empresa_id` no corpo liga a agência a uma empresa específica da conta,
    // para o caso de já existir cadastro feito por fora.
    let escolhida: number | null = null;
    try {
      const corpo = await req.json();
      const n = Number(corpo?.empresa_id);
      if (Number.isFinite(n) && n > 0) escolhida = n;
    } catch {
      escolhida = null;
    }

    let empresaId = escolhida ?? config.empresa_id;
    let token = escolhida ? '' : String(config.token ?? '');

    if (empresaId && token) {
      return NextResponse.json({
        config: configParaCliente(config),
        ja_conectada: true,
      });
    }

    if (empresaId && !token) {
      // Empresa já conhecida, token perdido: regenerar. Cadastrar de novo
      // criaria um segundo cadastro para o mesmo CNPJ, e duas empresas no
      // mesmo emitente significam duas numerações de nota.
      token = await regenerarTokenEmpresa(empresaId);
    } else {
      // RECONECTAR NÃO PODE DUPLICAR. Depois de desconectar, o CNPJ da
      // agência continua cadastrado na conta: reaproveita aquele registro em
      // vez de criar outro.
      const existente = await acharEmpresaPorCnpj(emitente.cnpj);
      if (existente) {
        empresaId = existente.id;
        token = await regenerarTokenEmpresa(existente.id);
      } else {
        const empresa = await criarEmpresaAcelera({
          cnpj: emitente.cnpj,
          razao_social: emitente.razao_social,
          nome_fantasia: emitente.nome_fantasia,
          uf: emitente.endereco.estado,
        });
        empresaId = empresa.id;
        token = empresa.token;
      }
    }

    const conectada = {
      ...config,
      provedor: 'aceleraapi' as const,
      empresa_id: empresaId,
      token,
    };
    await salvarConfigFiscal(tenantId, conectada);

    // A configuração do prestador é melhor-esforço: se faltar município ou
    // código de tributação, a resposta já diz o que falta e a agência
    // continua conectada.
    let pendencias: { pronto: boolean; itens: string[] } = { pronto: false, itens: [] };
    try {
      const emissor = new EmissorAceleraAPI();
      if (conectada.cod_municipio_ibge && conectada.cod_tributacao_nacional) {
        await emissor.configurarPrestador({ config: conectada, emitente });
      }
      pendencias = await emissor.pendencias(conectada);
    } catch (e) {
      pendencias = {
        pronto: false,
        itens: [e instanceof Error ? e.message : 'Não foi possível ler as pendências.'],
      };
    }

    return NextResponse.json({
      config: configParaCliente(conectada),
      empresa_id: empresaId,
      chave_operacao: chaveOperacaoMascarada(),
      pendencias,
    });
  } catch (e) {
    const msg = e instanceof ErroFiscal
      ? e.message
      : e instanceof Error ? e.message : 'Erro ao conectar a agência.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/** Gera um token novo para a empresa, revogando o anterior. */
export async function PUT() {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const tenantId = await getTenantId();
    const config = await carregarConfigFiscal(tenantId);
    if (!config.empresa_id) {
      return NextResponse.json(
        { error: 'Esta agência ainda não está conectada à AceleraAPI.' },
        { status: 400 },
      );
    }
    const token = await regenerarTokenEmpresa(config.empresa_id);
    const novo = { ...config, token };
    await salvarConfigFiscal(tenantId, novo);
    return NextResponse.json({ config: configParaCliente(novo) });
  } catch (e) {
    const msg = e instanceof ErroFiscal
      ? e.message
      : e instanceof Error ? e.message : 'Erro ao gerar o token.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/**
 * Desconecta a agência da AceleraAPI.
 *
 * Limpa o vínculo DESTE sistema: id da empresa, credencial e o certificado.
 * O certificado sai junto de propósito — ele foi enviado sob a credencial
 * antiga e vive do lado da AceleraAPI, então mantê-lo aqui mostraria
 * "certificado enviado" numa conexão que não tem certificado nenhum.
 *
 * O cadastro da empresa NÃO é apagado lá. Notas já emitidas continuam
 * existindo, e reconectar com o mesmo CNPJ reaproveita o mesmo cadastro.
 */
export async function DELETE() {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const tenantId = await getTenantId();
    const config = await carregarConfigFiscal(tenantId);

    const desconectada = {
      ...config,
      empresa_id: null,
      token: '',
      certificado: null,
    };
    await salvarConfigFiscal(tenantId, desconectada);
    return NextResponse.json({
      config: configParaCliente(desconectada),
      empresa_anterior: config.empresa_id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao desconectar.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/** Empresas da conta de operação, para escolher uma já existente. */
export async function GET() {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const { listarEmpresasAcelera } = await import('@/lib/nfse-acelera');
    return NextResponse.json({
      chave_operacao: chaveOperacaoMascarada(),
      empresas: await listarEmpresasAcelera(),
    });
  } catch (e) {
    const msg = e instanceof ErroFiscal
      ? e.message
      : e instanceof Error ? e.message : 'Erro ao listar empresas.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

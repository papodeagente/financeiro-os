import pool from '@/lib/db';
import { garantirVinculoFiscal, ErroVinculoFiscal, type Consulta as ConsultaVinculo } from '@/lib/vinculo-fiscal';
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

    // O empresa_id NUNCA vem do corpo (FIN-02): com ele, uma agência ligava a
    // própria conta à empresa de outra e o sistema regenerava o token dela.
    let empresaId = config.empresa_id;
    let token = String(config.token ?? '');

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
      await garantirVinculoFiscal(pool as unknown as ConsultaVinculo, tenantId, empresaId, emitente.cnpj);
      token = await regenerarTokenEmpresa(empresaId);
    } else {
      // RECONECTAR NÃO PODE DUPLICAR. Depois de desconectar, o CNPJ da
      // agência continua cadastrado na conta: reaproveita aquele registro em
      // vez de criar outro.
      const existente = await acharEmpresaPorCnpj(emitente.cnpj);
      if (existente) {
        // CNPJ já cadastrado no emissor: só reaproveita se a empresa é DESTA
        // agência. O CNPJ é digitado pela própria agência e não prova nada.
        await garantirVinculoFiscal(pool as unknown as ConsultaVinculo, tenantId, existente.id, emitente.cnpj);
        empresaId = existente.id;
        token = await regenerarTokenEmpresa(existente.id);
      } else {
        const empresa = await criarEmpresaAcelera({
          cnpj: emitente.cnpj,
          razao_social: emitente.razao_social,
          nome_fantasia: emitente.nome_fantasia,
          uf: emitente.endereco.estado,
        });
        await garantirVinculoFiscal(pool as unknown as ConsultaVinculo, tenantId, empresa.id, emitente.cnpj);
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
      // A chave de operação é do SaaS, não da agência: não tem por que
      // trafegar para o navegador de um tenant, nem mascarada.
      pendencias,
    });
  } catch (e) {
    const msg = e instanceof ErroFiscal || e instanceof ErroVinculoFiscal
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
    await garantirVinculoFiscal(pool as unknown as ConsultaVinculo, tenantId, config.empresa_id);
    const token = await regenerarTokenEmpresa(config.empresa_id);
    const novo = { ...config, token };
    await salvarConfigFiscal(tenantId, novo);
    return NextResponse.json({ config: configParaCliente(novo) });
  } catch (e) {
    const msg = e instanceof ErroFiscal || e instanceof ErroVinculoFiscal
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

/**
 * A empresa DESTA agência, e só ela.
 *
 * Antes esta rota devolvia todas as empresas cadastradas na conta de operação
 * — ou seja, o CNPJ e a razão social de TODAS as agências do SaaS para
 * qualquer usuário com acesso ao financeiro de uma delas — mais os dígitos da
 * chave de operação. Listar o vizinho nunca foi necessário para configurar a
 * própria nota.
 */
export async function GET() {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const config = await carregarConfigFiscal(await getTenantId());
    return NextResponse.json({
      empresa_id: config.empresa_id,
      conectada: Boolean(config.empresa_id && config.token),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

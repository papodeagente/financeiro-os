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

    let empresaId = config.empresa_id;
    let token = String(config.token ?? '');

    if (empresaId && token) {
      return NextResponse.json({
        config: configParaCliente(config),
        ja_conectada: true,
      });
    }

    if (empresaId && !token) {
      // Empresa cadastrada mas sem token guardado: cadastrar de novo criaria
      // um segundo cadastro para o mesmo CNPJ. O caminho é regenerar.
      token = await regenerarTokenEmpresa(empresaId);
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

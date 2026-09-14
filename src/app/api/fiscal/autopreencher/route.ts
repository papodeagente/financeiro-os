import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
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
import { EmissorAceleraAPI, consultarCnpj } from '@/lib/nfse-acelera';

/**
 * Busca na Receita tudo o que dá para preencher sozinho.
 *
 * O que chega de lá: razão social, nome fantasia, endereço completo, código
 * IBGE do município e CNAE. Com isso a agência para de digitar dado que o
 * governo já tem, e o código IBGE — que ninguém sabe de cabeça e é
 * obrigatório no padrão nacional — deixa de ser um campo de adivinhação.
 *
 * O QUE NÃO DÁ PARA BUSCAR, e por quê:
 *  - inscrição municipal: é da prefeitura, não da Receita. Nenhuma consulta
 *    de CNPJ traz. No padrão nacional ela é opcional, então não trava nada.
 *  - código de tributação nacional: depende do serviço prestado, não da
 *    empresa. Quem define é a contabilidade.
 *
 * Só preenche campo VAZIO. O que a agência digitou à mão é mais confiável
 * que a base da Receita, que atrasa para refletir mudança de endereço.
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

    const cadastro = await consultarCnpj(emitente.cnpj, config);

    // ---- Cadastro da agência ----
    const preenchidos: string[] = [];
    if (pool) {
      const { rows } = await pool.query(
        `SELECT id, data FROM agencia WHERE tenant_id = $1 LIMIT 1`,
        [tenantId],
      );
      if (rows.length > 0) {
        const atual = (rows[0].data ?? {}) as Record<string, unknown>;
        const endAtual = (atual.endereco ?? {}) as Record<string, string>;

        const manter = (valorAtual: unknown, novo: string, rotulo: string) => {
          const atualTxt = String(valorAtual ?? '').trim();
          if (atualTxt) return atualTxt;
          if (novo) preenchidos.push(rotulo);
          return novo;
        };

        const novaAgencia = {
          ...atual,
          razao_social: manter(atual.razao_social, cadastro.razao_social, 'razão social'),
          nome_fantasia: manter(atual.nome_fantasia, cadastro.nome_fantasia, 'nome fantasia'),
          endereco: {
            ...endAtual,
            cep: manter(endAtual.cep, cadastro.endereco.cep, 'CEP'),
            logradouro: manter(endAtual.logradouro, cadastro.endereco.logradouro, 'logradouro'),
            numero: manter(endAtual.numero, cadastro.endereco.numero, 'número'),
            complemento: String(endAtual.complemento ?? '') || cadastro.endereco.complemento,
            bairro: manter(endAtual.bairro, cadastro.endereco.bairro, 'bairro'),
            cidade: manter(endAtual.cidade, cadastro.endereco.cidade, 'cidade'),
            estado: manter(endAtual.estado, cadastro.endereco.estado, 'estado'),
          },
        };
        await pool.query(
          `UPDATE agencia SET data = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
          [rows[0].id, tenantId, JSON.stringify(novaAgencia)],
        );
      }
    }

    // ---- Configuração fiscal ----
    const novaConfig = { ...config };
    if (!String(config.cod_municipio_ibge ?? '').trim() && cadastro.cod_municipio_ibge) {
      novaConfig.cod_municipio_ibge = cadastro.cod_municipio_ibge;
      preenchidos.push('código do município');
    }
    if (!String(config.cnae ?? '').trim() && cadastro.cnae) {
      novaConfig.cnae = cadastro.cnae;
      preenchidos.push('CNAE');
    }
    await salvarConfigFiscal(tenantId, novaConfig);

    // Com município e código de tributação preenchidos, já dá para empurrar o
    // cadastro do prestador e devolver as pendências que realmente sobraram.
    let pendencias: { pronto: boolean; itens: string[] } = { pronto: false, itens: [] };
    if (novaConfig.provedor === 'aceleraapi' && novaConfig.token) {
      const emissor = new EmissorAceleraAPI();
      try {
        if (novaConfig.cod_municipio_ibge && novaConfig.cod_tributacao_nacional) {
          await emissor.configurarPrestador({
            config: novaConfig,
            emitente: { ...emitente, razao_social: emitente.razao_social || cadastro.razao_social },
          });
        }
        pendencias = await emissor.pendencias(novaConfig);
      } catch (e) {
        pendencias = {
          pronto: false,
          itens: [e instanceof Error ? e.message : 'Não foi possível ler as pendências.'],
        };
      }
    }

    // O município é conferido aqui porque o código acabou de ser descoberto:
    // dizer "preenchi São Paulo" sem avisar que São Paulo não emite pelo
    // nacional seria entregar um dado certo e uma conclusão errada.
    let municipio: { emite: boolean; detalhe: string; convenio: string } | null = null;
    if (novaConfig.cod_municipio_ibge) {
      try {
        const r = await new EmissorAceleraAPI().municipioEmite(novaConfig.cod_municipio_ibge);
        municipio = { emite: r.emite, detalhe: r.detalhe, convenio: r.convenio };
      } catch {
        municipio = null;
      }
    }

    return NextResponse.json({
      config: configParaCliente(novaConfig),
      cadastro: { ...cadastro, situacao: cadastro.situacao },
      preenchidos,
      pendencias,
      municipio,
    });
  } catch (e) {
    const msg = e instanceof ErroFiscal
      ? e.message
      : e instanceof Error ? e.message : 'Erro ao buscar os dados do CNPJ.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

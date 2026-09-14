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
  consultarCnpj,
  criarEmpresaAcelera,
  regenerarTokenEmpresa,
} from '@/lib/nfse-acelera';
import { codigoDoItem, itemSugerido } from '@/lib/lc116-servicos';
import type { ConfigFiscal } from '@/lib/nfse-tipos';

/**
 * Configura a nota fiscal da agência do início ao fim, num clique.
 *
 * POR QUE ISTO EXISTE. A configuração estava espalhada em quatro botões que
 * precisavam ser apertados na ordem certa: conectar, preencher pelo CNPJ,
 * salvar, sincronizar. Errar a ordem — ou pular o "salvar" — fazia o emissor
 * reclamar de campos que a pessoa tinha acabado de preencher na tela. Ordem
 * escondida é bug, não instrução.
 *
 * Aqui cada passo é tentado na sequência e o resultado de todos volta junto,
 * dito em português. Um passo que falha não derruba os outros: o que der para
 * adiantar, adianta, e a resposta diz exatamente o que sobrou.
 */

interface Passo {
  nome: string;
  ok: boolean;
  detalhe: string;
}

export async function POST(req: Request) {
  const passos: Passo[] = [];
  const anota = (nome: string, ok: boolean, detalhe = '') => {
    passos.push({ nome, ok, detalhe });
  };

  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const tenantId = await getTenantId();

    const gravada = await carregarConfigFiscal(tenantId);
    let emitente = await carregarEmitente(tenantId);

    // O que está na tela entra antes de qualquer coisa: é o dado mais novo.
    let config: ConfigFiscal = gravada;
    try {
      const corpo = (await req.json()) as Partial<ConfigFiscal> | null;
      if (corpo && typeof corpo === 'object') {
        config = {
          ...gravada,
          ...corpo,
          id: gravada.id,
          token: gravada.token,
          token_mascarado: undefined,
          certificado: gravada.certificado,
          empresa_id: gravada.empresa_id,
        };
      }
    } catch {
      config = gravada;
    }
    config.provedor = config.provedor || 'aceleraapi';

    if (!String(emitente.cnpj ?? '').replace(/\D+/g, '')) {
      return NextResponse.json(
        {
          error: 'A agência está sem CNPJ. Preencha em Configurações › Agência e tente de novo.',
          passos,
        },
        { status: 400 },
      );
    }

    // ---- 1. Conectar ----
    if (config.empresa_id && config.token) {
      anota('Conexão com a AceleraAPI', true, `Empresa #${config.empresa_id}, já conectada.`);
    } else {
      try {
        const existente = await acharEmpresaPorCnpj(emitente.cnpj);
        if (existente) {
          config.empresa_id = existente.id;
          config.token = await regenerarTokenEmpresa(existente.id);
          anota('Conexão com a AceleraAPI', true, `Empresa #${existente.id} reaproveitada.`);
        } else {
          const nova = await criarEmpresaAcelera({
            cnpj: emitente.cnpj,
            razao_social: emitente.razao_social,
            nome_fantasia: emitente.nome_fantasia,
            uf: emitente.endereco.estado,
          });
          config.empresa_id = nova.id;
          config.token = nova.token;
          anota('Conexão com a AceleraAPI', true, `Empresa #${nova.id} cadastrada.`);
        }
        // Grava assim que o token aparece: ele vem uma vez só.
        await salvarConfigFiscal(tenantId, config);
      } catch (e) {
        anota('Conexão com a AceleraAPI', false, e instanceof Error ? e.message : 'Falhou.');
        await salvarConfigFiscal(tenantId, config);
        return NextResponse.json({ config: configParaCliente(config), passos, pendencias: null });
      }
    }

    // ---- 2. Dados da Receita ----
    const faltando = (v: unknown) => !String(v ?? '').trim();
    try {
      const cadastro = await consultarCnpj(emitente.cnpj, config);
      const trouxe: string[] = [];

      if (faltando(config.cod_municipio_ibge) && cadastro.cod_municipio_ibge) {
        config.cod_municipio_ibge = cadastro.cod_municipio_ibge;
        trouxe.push('município');
      }
      if (faltando(config.cnae) && cadastro.cnae) {
        config.cnae = cadastro.cnae;
        trouxe.push('CNAE');
      }
      if (cadastro.simples_nacional > 0) {
        config.simples_nacional = cadastro.simples_nacional as 1 | 2 | 3;
        trouxe.push('Simples Nacional');
      }
      if (faltando(config.cod_tributacao_nacional)) {
        const codigo = codigoDoItem(itemSugerido(cadastro.cnae || config.cnae));
        if (codigo) {
          config.cod_tributacao_nacional = codigo;
          trouxe.push('código de tributação (pela atividade)');
        }
      }
      // Razão social vazia impede o cadastro do prestador; a Receita resolve.
      if (faltando(emitente.razao_social) && cadastro.razao_social) {
        emitente = { ...emitente, razao_social: cadastro.razao_social };
      }
      anota(
        'Dados da Receita',
        true,
        trouxe.length > 0 ? `Preencheu ${trouxe.join(', ')}.` : 'Nada a preencher: já estava tudo lá.',
      );
    } catch (e) {
      // Falhar aqui não impede configurar com o que a pessoa digitou.
      anota('Dados da Receita', false, e instanceof Error ? e.message : 'Não consultou.');
    }

    await salvarConfigFiscal(tenantId, config);

    // ---- 3. O que ainda falta, dito por campo ----
    const faltas: string[] = [];
    if (String(config.cod_municipio_ibge ?? '').replace(/\D+/g, '').length !== 7) {
      faltas.push('o município da agência (procure a cidade pelo nome)');
    }
    if (faltando(config.cod_tributacao_nacional)) {
      faltas.push('o serviço que a agência presta (procure por "agenciamento")');
    }
    if (!config.certificado?.referencia_gateway) {
      faltas.push('o certificado digital A1');
    }
    if (faltas.length > 0) {
      anota('Pronto para sincronizar', false, `Falta ${faltas.join('; ')}.`);
      return NextResponse.json({
        config: configParaCliente(config),
        passos,
        pendencias: { pronto: false, itens: faltas },
      });
    }

    // ---- 4. Cadastrar o prestador e ler o que o emissor diz ----
    const emissor = new EmissorAceleraAPI();
    try {
      await emissor.configurarPrestador({ config, emitente });
      anota('Cadastro do prestador', true, 'Enviado ao emissor.');
    } catch (e) {
      anota('Cadastro do prestador', false, e instanceof Error ? e.message : 'Falhou.');
    }

    let pendencias: { pronto: boolean; itens: string[] } = { pronto: false, itens: [] };
    try {
      pendencias = await emissor.pendencias(config);
      anota(
        'Conferência no emissor',
        pendencias.pronto,
        pendencias.pronto
          ? 'O emissor está pronto para emitir.'
          : pendencias.itens.join('; ') || 'O emissor ainda não está pronto.',
      );
    } catch (e) {
      anota('Conferência no emissor', false, e instanceof Error ? e.message : 'Não respondeu.');
    }

    // Município conferido no fim: o código pode ter acabado de ser descoberto.
    let municipio: { emite: boolean; detalhe: string; convenio: string } | null = null;
    try {
      const r = await emissor.municipioEmite(config.cod_municipio_ibge);
      municipio = { emite: r.emite, detalhe: r.detalhe, convenio: r.convenio };
      anota(
        'Município',
        r.emite,
        r.emite
          ? `${r.detalhe} emite pelo Emissor Nacional.`
          : `${r.detalhe} não emite pelo Emissor Nacional: a prefeitura mantém sistema próprio.`,
      );
    } catch {
      municipio = null;
    }

    return NextResponse.json({
      config: configParaCliente(config),
      passos,
      pendencias,
      municipio,
    });
  } catch (e) {
    const msg = e instanceof ErroFiscal
      ? e.message
      : e instanceof Error ? e.message : 'Erro ao configurar.';
    return NextResponse.json({ error: msg, passos }, { status: 400 });
  }
}

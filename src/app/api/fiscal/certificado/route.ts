import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { generateId } from '@/lib/utils';
import {
  carregarConfigFiscal,
  carregarEmitente,
  configParaCliente,
  salvarConfigFiscal,
} from '@/lib/nfse-servico';
import { ErroFiscal, emissorDaConfig } from '@/lib/nfse-emissor';
import {
  acharEmpresaPorCnpj,
  criarEmpresaAcelera,
  regenerarTokenEmpresa,
} from '@/lib/nfse-acelera';
import { ErroCertificado, lerCertificadoA1 } from '@/lib/certificado-a1';
import type { ConfigFiscal } from '@/lib/nfse-tipos';

/** Certificado A1 costuma ter menos de 10 KB; 2 MB já é folga generosa. */
const TAMANHO_MAXIMO = 2 * 1024 * 1024;

function digitos(v: unknown): string {
  return String(v ?? '').replace(/\D+/g, '');
}

/**
 * Recebe o certificado digital A1. É a porta de entrada da configuração.
 *
 * O CERTIFICADO É LIDO AQUI ANTES DE IR PARA O EMISSOR, por três motivos:
 *  1. Dele saem CNPJ, razão social, validade e responsável. Pedir isso digitado
 *     é pedir erro num dado que está no arquivo.
 *  2. Senha errada, arquivo que não é .pfx, e-CPF em vez de e-CNPJ e
 *     certificado vencido são recusados na hora, com o motivo em português,
 *     sem gastar uma chamada ao emissor.
 *  3. Se a agência já tem CNPJ cadastrado e o certificado é de OUTRO CNPJ, a
 *     recusa acontece antes de qualquer nota sair em nome errado.
 *
 * Com o CNPJ em mãos, a agência é cadastrada no emissor (ou reaproveitada, se
 * o CNPJ já existe lá) e só então o certificado é enviado. Um upload faz o
 * caminho inteiro: não existe mais "conectar antes".
 *
 * O ARQUIVO E A SENHA NÃO SÃO GRAVADOS. Ficam só os metadados lidos do
 * certificado e a referência devolvida pelo emissor.
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

    // ---- 1. Ler o certificado ----
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const lido = lerCertificadoA1(bytes, senha);
    if (lido.vencido) {
      return NextResponse.json(
        {
          error: `Este certificado venceu em ${lido.validade_fim.split('-').reverse().join('/')}. Peça um novo à sua certificadora antes de enviar.`,
          certificado: lido,
        },
        { status: 400 },
      );
    }

    // ---- 2. Casar com a agência ----
    const emitente = await carregarEmitente(tenantId);
    const cnpjAgencia = digitos(emitente.cnpj);
    if (cnpjAgencia && cnpjAgencia !== lido.cnpj) {
      return NextResponse.json(
        {
          error:
            `O certificado é do CNPJ ${lido.cnpj} (${lido.razao_social}), mas a agência está `
            + `cadastrada com o CNPJ ${cnpjAgencia}. Confira em Configurações › Agência qual está certo. `
            + 'Nota emitida com certificado de outra empresa sai em nome errado.',
          certificado: lido,
        },
        { status: 400 },
      );
    }

    // Sem CNPJ na agência, o certificado preenche. Razão social também, se
    // estiver vazia — a do certificado é a da Receita.
    if (pool && (!cnpjAgencia || !String(emitente.razao_social ?? '').trim())) {
      const { rows } = await pool.query(
        `SELECT id, data FROM agencia WHERE tenant_id = $1 LIMIT 1`,
        [tenantId],
      );
      if (rows.length > 0) {
        const atual = (rows[0].data ?? {}) as Record<string, unknown>;
        const nova = {
          ...atual,
          cnpj: cnpjAgencia || lido.cnpj,
          razao_social: String(atual.razao_social ?? '').trim() || lido.razao_social,
        };
        await pool.query(
          `UPDATE agencia SET data = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
          [rows[0].id, tenantId, JSON.stringify(nova)],
        );
      }
    }

    // ---- 3. Garantir a empresa no emissor ----
    let config: ConfigFiscal = await carregarConfigFiscal(tenantId);
    config.provedor = config.provedor || 'aceleraapi';

    if (config.provedor === 'aceleraapi' && !(config.empresa_id && config.token)) {
      const existente = await acharEmpresaPorCnpj(lido.cnpj);
      if (existente) {
        config = { ...config, empresa_id: existente.id, token: await regenerarTokenEmpresa(existente.id) };
      } else {
        const nova = await criarEmpresaAcelera({
          cnpj: lido.cnpj,
          razao_social: emitente.razao_social || lido.razao_social,
          nome_fantasia: emitente.nome_fantasia,
          uf: emitente.endereco.estado,
        });
        config = { ...config, empresa_id: nova.id, token: nova.token };
      }
      // O token vem uma vez só: grava antes de seguir.
      await salvarConfigFiscal(tenantId, config);
    }

    // ---- 4. Enviar ao emissor ----
    const emissor = emissorDaConfig(config);
    const meta = await emissor.enviarCertificado({
      arquivo: bytes,
      nome_arquivo: nome,
      senha,
      email,
      config,
    } as Parameters<typeof emissor.enviarCertificado>[0]);

    // O que foi lido do arquivo é a fonte da validade e do titular: o emissor
    // nem sempre devolve, e quando devolve é o mesmo certificado.
    const novo: ConfigFiscal = {
      ...config,
      certificado: {
        id: generateId(),
        referencia_gateway: meta.referencia_gateway,
        nome_arquivo: nome,
        cnpj: lido.cnpj,
        titular: lido.razao_social || meta.titular,
        validade_inicio: lido.validade_inicio,
        validade_fim: lido.validade_fim,
        responsavel_nome: lido.responsavel_nome,
        responsavel_cpf: lido.responsavel_cpf,
        emissor: lido.emissor,
        impressao_digital: lido.impressao_digital,
        enviado_em: new Date().toISOString(),
        enviado_por: sessao?.nome || sessao?.email || '',
      },
    };
    await salvarConfigFiscal(tenantId, novo);

    return NextResponse.json({
      config: configParaCliente(novo),
      certificado: lido,
      // A tela usa isto para dizer "e a empresa já está conectada".
      empresa_id: novo.empresa_id,
    });
  } catch (e) {
    const msg = e instanceof ErroCertificado || e instanceof ErroFiscal
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

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { chaveAnthropic, type Consulta } from '@/lib/config-apis';
import { detectarTipo } from '@/lib/arquivos';
import { pastaComprovantes } from '@/lib/comprovantes';
import { registrarEventoAuditoria } from '@/lib/audit';
import { hojeISO } from '@/lib/money';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { conferirLeitura, jsonDaResposta, normalizarExtracao, type ExtracaoDoDocumento } from '@/lib/leitura-documento';
import { lerDocumentoComIa, MODELO_PADRAO_LEITURA, type MimeLegivel } from '@/lib/leitura-documento-ia';
import {
  concluirLeitura, desistirDaLeitura, reservarLeitura, sugestoesParaLeitura,
} from '@/lib/leitura-documento-servidor';

/**
 * "Ler boleto ou nota" (05/11/2026). Recebe um PDF ou foto (campo `file`),
 * devolve o que foi lido, conferido pelo leitor puro do boleto, com o
 * fornecedor do cadastro e as categorias que a agência já usou para ele.
 *
 * NÃO grava conta nenhuma: a resposta é uma prévia para a pessoa conferir no
 * formulário. O arquivo fica guardado entre os comprovantes privados da
 * agência e só vira anexo quando a conta é salva.
 *
 * Mesmo arquivo de novo (mesmo hash) = mesma leitura, sem chamar a IA.
 */

const MAX_PDF = 8 * 1024 * 1024;
// A IA recusa imagem acima de 5MB.
const MAX_IMAGEM = 5 * 1024 * 1024;
const EXTENSAO: Record<MimeLegivel, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};

export async function POST(req: Request) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  try {
    const recusa = await recusaFinanceira('escrever');
    if (recusa) return recusa;
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco de dados indisponível.' }, { status: 500 });
    const exec = pool as unknown as ExecutorSQL;
    const sessao = await getSession();
    const tenantId = await getTenantId();

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: 'Envie o arquivo do boleto ou da nota.' }, { status: 400 });
    }
    const arquivo = form.get('file');
    if (!(arquivo instanceof File) || arquivo.size === 0) {
      return NextResponse.json({ error: 'Envie o arquivo do boleto ou da nota.' }, { status: 400 });
    }
    if (arquivo.size > MAX_PDF) {
      return NextResponse.json({ error: 'O arquivo tem mais de 8MB. Envie uma versão menor ou uma foto.' }, { status: 413 });
    }

    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    // O tipo vem dos primeiros bytes, não do nome nem do navegador.
    const tipo = detectarTipo(bytes, '');
    const mime = tipo && (tipo.mime as MimeLegivel) in EXTENSAO ? (tipo.mime as MimeLegivel) : null;
    if (!mime) {
      return NextResponse.json({ error: 'Aceito PDF ou foto (JPG, PNG ou WEBP).' }, { status: 415 });
    }
    if (mime !== 'application/pdf' && bytes.length > MAX_IMAGEM) {
      return NextResponse.json({ error: 'A foto tem mais de 5MB. Tire outra com menos resolução ou envie o PDF.' }, { status: 413 });
    }

    const hash = createHash('sha256').update(bytes).digest('hex');
    const nomeArquivo = `leitura-${hash.slice(0, 40)}.${EXTENSAO[mime]}`;
    const nomeOriginal = (arquivo.name || `documento.${EXTENSAO[mime]}`).slice(0, 120);
    const usuarioId = sessao?.userId ?? '';

    const reserva = await reservarLeitura(exec, { tenantId, hash, nomeOriginal, mime, tamanho: bytes.length, usuarioId });
    if (reserva.tipo === 'em_curso') {
      return NextResponse.json({ error: 'Este arquivo já está sendo lido. Aguarde alguns segundos e tente de novo.' }, { status: 409 });
    }
    if (reserva.tipo === 'limite') {
      return NextResponse.json({ error: 'Muitas leituras na última hora. Tente de novo mais tarde ou preencha à mão.' }, { status: 429 });
    }

    let extracao: ExtracaoDoDocumento;
    let repetida = false;
    if (reserva.tipo === 'guardada') {
      extracao = reserva.extracao;
      repetida = true;
    } else {
      const ia = await chaveAnthropic(pool as unknown as Consulta, tenantId, MODELO_PADRAO_LEITURA);
      if (!ia) {
        await desistirDaLeitura(exec, tenantId, hash);
        return NextResponse.json({
          error: 'A leitura por IA precisa da chave de IA da agência. Um administrador cadastra em Configurações, Integração com IA.',
          codigo: 'sem_chave_ia',
        }, { status: 400 });
      }
      try {
        // A chave é a da agência; o modelo é o atual. A tela de IA não escolhe
        // mais modelo, e o que ficou gravado de antes pode já ter sido aposentado.
        const resposta = await lerDocumentoComIa({
          apiKey: ia.api_key, modelo: MODELO_PADRAO_LEITURA, base64: Buffer.from(bytes).toString('base64'), mime,
        });
        if (!resposta.ok) {
          await desistirDaLeitura(exec, tenantId, hash);
          return NextResponse.json({ error: resposta.erro }, { status: resposta.status });
        }
        const json = jsonDaResposta(resposta.texto);
        if (!json) {
          await desistirDaLeitura(exec, tenantId, hash);
          return NextResponse.json({ error: 'A IA respondeu num formato que não deu para ler. Tente de novo ou preencha à mão.' }, { status: 502 });
        }
        extracao = normalizarExtracao(json);
        await guardarArquivo(tenantId, nomeArquivo, bytes);
        await registrarEventoAuditoria({
          tenantId,
          acao: 'ENVIAR',
          modulo: 'Financeiro',
          entidade: 'leituras_de_documento',
          entidadeId: hash.slice(0, 40),
          descricao: `Leu por IA o documento ${nomeOriginal} (${bytes.length} bytes). Nada foi gravado nas contas.`,
        });
        await concluirLeitura(exec, { tenantId, hash, extracao, arquivo: nomeArquivo, modelo: resposta.modelo });
      } catch (e) {
        // Qualquer falha no meio libera a chave: a próxima tentativa lê de novo.
        await desistirDaLeitura(exec, tenantId, hash).catch(() => {});
        throw e;
      }
    }
    // Guardada mas sem o arquivo em disco (outra máquina, pasta limpa): grava de novo.
    if (repetida) await guardarArquivo(tenantId, nomeArquivo, bytes);

    const leitura = conferirLeitura(extracao, hojeISO());
    const sugestoes = await sugestoesParaLeitura(exec, tenantId, { nome: leitura.fornecedor_nome, documento: leitura.fornecedor_cnpj });

    return NextResponse.json({
      leitura,
      sugestoes,
      anexo: { nome: nomeOriginal, url: `/api/comprovantes/${nomeArquivo}` },
      hash,
      repetida,
      // Dito em voz alta: nada foi gravado nas contas.
      gravado: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Grava na pasta privada da agência. O nome é o hash: o mesmo arquivo não duplica. */
async function guardarArquivo(tenantId: string, nome: string, bytes: Uint8Array): Promise<void> {
  const dir = await pastaComprovantes(tenantId);
  try {
    await writeFile(path.join(dir, nome), bytes, { flag: 'wx' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'EEXIST') throw e;
  }
}

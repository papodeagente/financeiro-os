import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { chaveAnthropic, type Consulta } from '@/lib/config-apis';
import { detectarTipo } from '@/lib/arquivos';
import { registrarEventoAuditoria } from '@/lib/audit';
import { hojeISO } from '@/lib/money';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { jsonDaResposta, type ExtracaoDoDocumento } from '@/lib/leitura-documento';
import type { MimeLegivel } from '@/lib/leitura-documento-ia';
import { concluirLeitura, desistirDaLeitura, reservarLeitura } from '@/lib/leitura-documento-servidor';
import { conferirFontesNoTexto, normalizarVoucherLido } from '@/lib/venda-voucher';
import { lerVoucherComIa, MODELO_PADRAO_LEITURA, type VoucherParaLer } from '@/lib/venda-voucher-ia';
import {
  chaveDoVoucher, hashValido, lerVoucherGuardado, rascunhoDaLeitura, type OrigemDoVoucher, type VoucherGuardado,
} from '@/lib/venda-voucher-servidor';

/**
 * Lançar a venda pelo voucher (E7, fechamento).
 *
 *   POST  multipart `file` (PDF ou foto do voucher) ou JSON `{ texto }` (o
 *         e-mail da operadora colado). Lê por IA, com a chave da agência, e
 *         devolve o RASCUNHO da venda: `{ hash, repetida, rascunho: { venda,
 *         origens, avisos, vazios }, gravado: false }`.
 *   GET   ?hash=  o rascunho da leitura guardada (a ficha abre por aqui).
 *
 * NÃO grava venda nenhuma: a ficha mostra o rascunho, a pessoa confere e só o
 * "Salvar" grava, por POST /api/vendas/completa (origem manual, ABERTA). O
 * mesmo documento de novo devolve a mesma leitura, sem chamar a IA.
 */
export const dynamic = 'force-dynamic';

const MAX_PDF = 8 * 1024 * 1024;
const MAX_IMAGEM = 5 * 1024 * 1024;
const MIN_TEXTO = 30;
const MAX_TEXTO = 100_000;
const MIMES: ReadonlySet<string> = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

export async function GET(req: Request) {
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
  const exec = pool as unknown as ExecutorSQL;
  const hash = hashValido(new URL(req.url).searchParams.get('hash'));
  if (!hash) return NextResponse.json({ error: 'Leitura não encontrada.' }, { status: 404 });
  const tenantId = await getTenantId();
  const guardado = await lerVoucherGuardado(exec, tenantId, hash);
  if (!guardado) return NextResponse.json({ error: 'Leitura não encontrada. Leia o voucher de novo.' }, { status: 404 });
  const rascunho = await rascunhoDaLeitura(exec, tenantId, guardado, hojeISO());
  return NextResponse.json({ hash, origem: guardado.origem, arquivo_nome: guardado.nome, rascunho, gravado: false });
}

export async function POST(req: Request) {
  // Quem lança venda completa (POST /api/vendas/completa) é quem pode ler o voucher.
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
  const exec = pool as unknown as ExecutorSQL;
  try {
    const sessao = await getSession();
    const tenantId = await getTenantId();

    let conteudo: VoucherParaLer;
    let origem: OrigemDoVoucher;
    let bytes: Uint8Array;
    let nome: string;
    let textoColado = '';
    if ((req.headers.get('content-type') ?? '').includes('application/json')) {
      const corpo = (await req.json().catch(() => null)) as { texto?: unknown } | null;
      textoColado = String(corpo?.texto ?? '').trim();
      if (textoColado.length < MIN_TEXTO) return NextResponse.json({ error: 'Cole o texto do e-mail da operadora.' }, { status: 400 });
      if (textoColado.length > MAX_TEXTO) return NextResponse.json({ error: 'O texto é grande demais. Envie o voucher em PDF.' }, { status: 413 });
      conteudo = { tipo: 'texto', texto: textoColado };
      origem = 'email';
      bytes = new TextEncoder().encode(textoColado);
      nome = 'E-mail colado';
    } else {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return NextResponse.json({ error: 'Envie o voucher em PDF ou foto, ou cole o e-mail.' }, { status: 400 });
      }
      const arquivo = form.get('file');
      if (!(arquivo instanceof File) || arquivo.size === 0) {
        return NextResponse.json({ error: 'Envie o voucher em PDF ou foto, ou cole o e-mail.' }, { status: 400 });
      }
      if (arquivo.size > MAX_PDF) return NextResponse.json({ error: 'O arquivo tem mais de 8MB. Envie uma versão menor.' }, { status: 413 });
      bytes = new Uint8Array(await arquivo.arrayBuffer());
      // O tipo vem dos primeiros bytes, não do nome nem do navegador.
      const tipo = detectarTipo(bytes, '');
      const mime = tipo && MIMES.has(tipo.mime) ? (tipo.mime as MimeLegivel) : null;
      if (!mime) return NextResponse.json({ error: 'Aceito PDF ou foto (JPG, PNG ou WEBP). Para e-mail, cole o texto.' }, { status: 415 });
      if (mime !== 'application/pdf' && bytes.length > MAX_IMAGEM) {
        return NextResponse.json({ error: 'A foto tem mais de 5MB. Envie o PDF ou uma foto menor.' }, { status: 413 });
      }
      conteudo = { tipo: 'arquivo', mime, base64: Buffer.from(bytes).toString('base64') };
      origem = mime === 'application/pdf' ? 'pdf' : 'imagem';
      nome = (arquivo.name || 'voucher').slice(0, 120);
    }

    const hash = createHash('sha256').update(bytes).digest('hex');
    const chave = chaveDoVoucher(hash);
    const reserva = await reservarLeitura(exec, {
      tenantId, hash: chave, nomeOriginal: nome, mime: origem, tamanho: bytes.length, usuarioId: sessao?.userId ?? '',
    });
    if (reserva.tipo === 'em_curso') return NextResponse.json({ error: 'Este documento já está sendo lido. Aguarde alguns segundos.' }, { status: 409 });
    if (reserva.tipo === 'limite') return NextResponse.json({ error: 'Muitas leituras na última hora. Tente de novo mais tarde ou lance à mão.' }, { status: 429 });

    let guardado: VoucherGuardado;
    let repetida = false;
    if (reserva.tipo === 'guardada') {
      guardado = reserva.extracao as unknown as VoucherGuardado;
      repetida = true;
    } else {
      const ia = await chaveAnthropic(pool as unknown as Consulta, tenantId, MODELO_PADRAO_LEITURA);
      if (!ia) {
        await desistirDaLeitura(exec, tenantId, chave);
        return NextResponse.json({
          error: 'A leitura por IA precisa da chave de IA da agência. Um administrador cadastra em Configurações, Integração com IA.',
          codigo: 'sem_chave_ia',
        }, { status: 400 });
      }
      try {
        const resposta = await lerVoucherComIa({ apiKey: ia.api_key, modelo: MODELO_PADRAO_LEITURA, conteudo });
        if (!resposta.ok) {
          await desistirDaLeitura(exec, tenantId, chave);
          return NextResponse.json({ error: resposta.erro }, { status: resposta.status });
        }
        const json = jsonDaResposta(resposta.texto);
        if (!json) {
          await desistirDaLeitura(exec, tenantId, chave);
          return NextResponse.json({ error: 'A IA respondeu num formato que não deu para ler. Tente de novo ou lance à mão.' }, { status: 502 });
        }
        let voucher = normalizarVoucherLido(json);
        let descartados = 0;
        // E-mail colado: o trecho citado tem de estar no texto.
        if (origem === 'email') ({ lido: voucher, descartados } = conferirFontesNoTexto(voucher, textoColado));
        guardado = { voucher, origem, nome, descartados };
        await concluirLeitura(exec, { tenantId, hash: chave, extracao: guardado as unknown as ExtracaoDoDocumento, arquivo: '', modelo: resposta.modelo });
        await registrarEventoAuditoria({
          tenantId, acao: 'ENVIAR', modulo: 'Financeiro', entidade: 'leituras_de_documento', entidadeId: hash.slice(0, 40),
          descricao: `Leu por IA o voucher ${nome} (${voucher.produtos.length} ${voucher.produtos.length === 1 ? 'produto' : 'produtos'}). Nenhuma venda foi gravada.`,
        }).catch(() => {});
      } catch (e) {
        // Qualquer falha no meio libera a chave: a próxima tentativa lê de novo.
        await desistirDaLeitura(exec, tenantId, chave).catch(() => {});
        throw e;
      }
    }

    const rascunho = await rascunhoDaLeitura(exec, tenantId, guardado, hojeISO());
    return NextResponse.json({ hash, origem: guardado.origem, arquivo_nome: guardado.nome, repetida, rascunho, gravado: false });
  } catch (e) {
    console.error('[vendas/voucher]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível ler o voucher. Tente de novo ou lance à mão.' }, { status: 500 });
  }
}

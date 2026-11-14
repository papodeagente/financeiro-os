import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import { chaveAnthropic, type Consulta } from '@/lib/config-apis';
import { registrarEventoAuditoria } from '@/lib/audit';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { jsonDaResposta, type ExtracaoDoDocumento } from '@/lib/leitura-documento';
import { concluirLeitura, desistirDaLeitura, reservarLeitura, sugestoesParaLeitura } from '@/lib/leitura-documento-servidor';
import { lerExtratoDeOperadoraComIa, MODELO_PADRAO_LEITURA, type ConteudoParaLer } from '@/lib/conferencia-operadora-ia';
import { normalizarExtratoLido } from '@/lib/conferencia-operadora';
import {
  chaveDaLeitura, conferenciaDoArquivo, conteudoDoArquivo, ErroConferencia, previaDaConferencia, type LeituraGuardada, type OrigemDoExtrato,
} from '@/lib/conferencia-operadora-servidor';

/**
 * Ler o extrato de uma operadora (E6, 05/11/2026). Recebe o arquivo (campo
 * `file`: PDF, foto, planilha ou CSV) ou o texto do e-mail (JSON `{ texto }`),
 * e devolve a PRÉVIA da conferência: o que foi lido, as regras de soma e data,
 * e o casamento com as vendas. NÃO grava conferência nenhuma; quem grava é
 * POST /api/conferencia-operadora, depois que a pessoa confirma.
 *
 * Mesmo arquivo de novo (mesmo hash) = mesma leitura, sem chamar a IA. A
 * chave de IA é a da agência, como no "Ler boleto ou nota".
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const semModulo = await recusaModulo('extrato');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('conciliar');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
  const exec = pool as unknown as ExecutorSQL;
  try {
    const sessao = await getSession();
    const tenantId = await getTenantId();

    let conteudo: ConteudoParaLer;
    let origem: OrigemDoExtrato;
    let bytes: Uint8Array;
    let nome: string;
    if ((req.headers.get('content-type') ?? '').includes('application/json')) {
      const corpo = (await req.json().catch(() => null)) as { texto?: unknown } | null;
      const texto = String(corpo?.texto ?? '').trim();
      if (texto.length < 20) return NextResponse.json({ error: 'Cole o texto do e-mail da operadora.' }, { status: 400 });
      if (texto.length > 200_000) return NextResponse.json({ error: 'O texto é grande demais. Envie o anexo do e-mail.' }, { status: 413 });
      conteudo = { tipo: 'texto', texto, origem: 'email' };
      origem = 'email';
      bytes = new TextEncoder().encode(texto);
      nome = 'E-mail colado';
    } else {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return NextResponse.json({ error: 'Envie o arquivo do extrato.' }, { status: 400 });
      }
      const arquivo = form.get('file');
      if (!(arquivo instanceof File) || arquivo.size === 0) return NextResponse.json({ error: 'Envie o arquivo do extrato.' }, { status: 400 });
      bytes = new Uint8Array(await arquivo.arrayBuffer());
      nome = (arquivo.name || 'extrato').slice(0, 120);
      const lido = conteudoDoArquivo(nome, bytes);
      conteudo = lido.conteudo;
      origem = lido.origem;
    }

    const hash = createHash('sha256').update(bytes).digest('hex');
    const chave = chaveDaLeitura(hash);
    const reserva = await reservarLeitura(exec, {
      tenantId, hash: chave, nomeOriginal: nome, mime: origem, tamanho: bytes.length, usuarioId: sessao?.userId ?? '',
    });
    if (reserva.tipo === 'em_curso') return NextResponse.json({ error: 'Este extrato já está sendo lido. Aguarde alguns segundos.' }, { status: 409 });
    if (reserva.tipo === 'limite') return NextResponse.json({ error: 'Muitas leituras na última hora. Tente de novo mais tarde.' }, { status: 429 });

    let guardada: LeituraGuardada;
    let repetida = false;
    if (reserva.tipo === 'guardada') {
      guardada = reserva.extracao as unknown as LeituraGuardada;
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
        const resposta = await lerExtratoDeOperadoraComIa({ apiKey: ia.api_key, modelo: MODELO_PADRAO_LEITURA, conteudo });
        if (!resposta.ok) {
          await desistirDaLeitura(exec, tenantId, chave);
          return NextResponse.json({ error: resposta.erro }, { status: resposta.status });
        }
        const json = jsonDaResposta(resposta.texto);
        if (!json) {
          await desistirDaLeitura(exec, tenantId, chave);
          return NextResponse.json({ error: 'A IA respondeu num formato que não deu para ler. Tente de novo.' }, { status: 502 });
        }
        guardada = { extrato: normalizarExtratoLido(json), origem };
        await concluirLeitura(exec, { tenantId, hash: chave, extracao: guardada as unknown as ExtracaoDoDocumento, arquivo: '', modelo: resposta.modelo });
        await registrarEventoAuditoria({
          tenantId, acao: 'ENVIAR', modulo: 'Financeiro', entidade: 'leituras_de_documento', entidadeId: hash.slice(0, 40),
          descricao: `Leu por IA o extrato de operadora ${nome} (${guardada.extrato.linhas.length} linhas). Nada foi gravado na conferência.`,
        }).catch(() => {});
      } catch (e) {
        await desistirDaLeitura(exec, tenantId, chave).catch(() => {});
        throw e;
      }
    }

    const extrato = guardada.extrato;
    const sugestoes = await sugestoesParaLeitura(exec, tenantId, { nome: extrato.operadora_nome, documento: extrato.operadora_cnpj });
    const operadora = sugestoes.fornecedor ? { id: sugestoes.fornecedor.id, nome: sugestoes.fornecedor.nome } : (extrato.operadora_nome ? { nome: extrato.operadora_nome } : null);
    const previa = await previaDaConferencia(exec, tenantId, extrato, operadora);
    return NextResponse.json({
      hash, origem: guardada.origem, arquivo_nome: nome, repetida,
      extrato: { ...extrato, linhas: undefined, total_linhas: extrato.linhas.length },
      operadora_sugerida: sugestoes.fornecedor,
      previa,
      ja_conferido: await conferenciaDoArquivo(exec, tenantId, hash),
      gravado: false,
    });
  } catch (e) {
    if (e instanceof ErroConferencia) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[conferencia-operadora/ler]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível ler o extrato.' }, { status: 500 });
  }
}

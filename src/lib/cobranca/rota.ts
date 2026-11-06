/**
 * Apoio das rotas de cobrança (os arquivos de rota só exportam handlers).
 *
 * As respostas seguem o contrato que as telas da parte B assumem
 * (src/lib/cobranca/contrato-telas.ts): dinheiro em REAIS, erro como
 * `{ error, codigo? }`, e os nomes de campo de lá. Campos a mais (centavos,
 * detalhes) vão junto e não atrapalham.
 */
import { NextResponse } from 'next/server';
import { getSession } from '../auth';
import { respostaPeriodoFechado } from '../guarda-rota';
import { deCentavos, paraCentavos } from '../money';
import { codigoDoMotivo } from './calculo';
import { ErroCobranca, ErroProvedor, type CodigoErroCobranca } from './tipos';
import type { LinhaCobranca, PreviaDeEmissao, PreviaDoCarne, QuemFez, ResultadoGravacao } from './servidor';

/** Erro de cobrança → resposta com a frase pronta e o código para a tela. */
export function respostaDeErroDaCobranca(e: unknown, contexto: string): NextResponse {
  if (e instanceof ErroCobranca) {
    return NextResponse.json({ error: e.message, ...(e.codigo ? { codigo: e.codigo } : {}) }, { status: e.status });
  }
  if (e instanceof ErroProvedor) {
    const codigo: CodigoErroCobranca | null = e.tipo === 'credencial' ? 'CREDENCIAL_INVALIDA'
      : e.tipo === 'limite' ? 'LIMITE_DO_PROVEDOR'
        : e.passageiro ? 'PROVEDOR_FORA' : null;
    // Passageiro: 503 (tente de novo); o provedor recusou: 422 com a frase dele.
    return NextResponse.json(
      { error: e.message, ...(codigo ? { codigo } : {}), provedor: true, passageiro: e.passageiro },
      { status: e.passageiro ? 503 : e.tipo === 'credencial' ? 409 : 422 },
    );
  }
  const periodo = respostaPeriodoFechado(e);
  if (periodo) return periodo;
  console.error(`[cobranca] ${contexto}:`, e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'Não foi possível concluir. Nada foi cobrado em dobro; tente de novo.' }, { status: 500 });
}

const ouNulo = (v: string | null | undefined) => (v ? v : null);

/**
 * A cobrança como a tela usa (`Cobranca` de contrato-telas.ts): valores em
 * reais, `conta_id`, vazios como null. Os campos da linha vão junto.
 */
export function cobrancaParaTela(c: LinhaCobranca & { cliente_nome?: string; conta_descricao?: string; fatura_numero?: number | null }) {
  return {
    ...c,
    // Cobrança de uma fatura (E7): o envio por e-mail pode levar o documento da fatura.
    fatura_numero: Number(c.fatura_numero) > 0 ? Number(c.fatura_numero) : null,
    conta_id: c.titulo_id,
    cliente_id: c.cliente_id ?? '',
    cliente_nome: c.cliente_nome ?? '',
    valor: deCentavos(c.valor_centavos),
    linha_digitavel: ouNulo(c.linha_digitavel),
    codigo_barras: ouNulo(c.codigo_barras),
    pix_copia_cola: ouNulo(c.pix_copia_cola),
    // Link de pagamento: a página do provedor faz o papel do boleto e da fatura.
    url_boleto: ouNulo(c.url_boleto || c.url_link),
    url_fatura: ouNulo(c.url_fatura || c.url_link),
    url_link: ouNulo(c.url_link),
    carne_id: c.carne_id,
    erro: c.erro,
    valor_pago: c.pago_centavos != null ? deCentavos(c.pago_centavos) : null,
    taxa: c.taxa_centavos != null ? deCentavos(c.taxa_centavos) : null,
    pago_em: c.pago_em,
    criado_por: c.criado_por_nome ?? c.criado_por,
    pendencia: typeof c.dados?.pendencia === 'string' && c.dados.pendencia ? c.dados.pendencia : null,
    pendencia_em: typeof c.dados?.pendencia_em === 'string' ? c.dados.pendencia_em : null,
    taxa_boleto: Number(c.dados?.taxa_boleto_centavos ?? 0) > 0 ? deCentavos(Number(c.dados.taxa_boleto_centavos)) : null,
    // Negativação (E7): só a situação, para a lista mostrar e o menu oferecer a janela certa.
    negativacao: c.dados?.negativacao && typeof c.dados.negativacao === 'object'
      ? { status: String((c.dados.negativacao as Record<string, unknown>).status ?? '') }
      : null,
  };
}

/** Prévia de emissão no formato da tela. */
export function previaParaTela(p: PreviaDeEmissao) {
  return {
    ...p,
    itens: p.itens.map(i => ({
      ...i,
      motivo: i.erros[0] ?? null,
      codigo: codigoDoMotivo(i.erros[0]),
      aviso: i.avisos[0] ?? null,
      valor: deCentavos(i.valor_centavos),
      tipo: p.tipo,
    })),
    prontos: p.prontas,
  };
}

/** Gravação de emissão no formato da tela. */
export function gravacaoParaTela(r: ResultadoGravacao) {
  const itens = [
    ...r.cobrancas.map(c => ({ conta_id: c.titulo_id, ok: c.status !== 'falhou', cobranca_id: c.id, status: c.status, erro: c.erro })),
    ...r.puladas.map(p => ({ conta_id: p.conta_id, ok: false, cobranca_id: null, status: null, erro: p.motivo })),
  ];
  return {
    itens,
    na_fila: r.na_fila > 0,
    emitidas: r.cobrancas.filter(c => c.status === 'aberta' || c.status === 'vencida' || c.status === 'paga').length,
    quantidade_na_fila: r.na_fila,
    repetido: r.repetido === true,
    cobrancas: r.cobrancas.map(c => cobrancaParaTela(c)),
  };
}

/** Prévia do carnê no formato da tela. */
export function previaDoCarneParaTela(p: PreviaDoCarne) {
  const doCarne = p.erros_do_carne[0] ?? null;
  return {
    provedor: p.provedor,
    capacidades: p.capacidades,
    cliente_nome: p.itens[0]?.cliente_nome ?? '',
    parcelas: p.itens.map((i, n) => ({
      conta_id: i.conta_id, numero: n + 1, valor: deCentavos(i.valor_centavos), vencimento: i.vencimento,
      ok: i.ok && !doCarne, motivo: i.erros[0] ?? doCarne,
    })),
    erros: p.erros_do_carne,
    valor_parcela: deCentavos(p.valor_parcela_centavos),
    primeiro_vencimento: p.primeiro_vencimento,
    total: p.total,
    assinatura: p.assinatura,
  };
}

export async function quemEsta(): Promise<QuemFez> {
  const s = await getSession();
  return { usuarioId: s?.userId ?? null, usuarioNome: s?.nome ?? null };
}

/** Reais da tela → centavos (undefined quando não veio). */
export function centavosDe(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? paraCentavos(n) : undefined;
}

export async function lerCorpo<T>(req: Request): Promise<T | null> {
  return (await req.json().catch(() => null)) as T | null;
}

export function chaveDe(req: Request): string | undefined {
  const k = req.headers.get('idempotency-key')?.trim();
  return k ? k.slice(0, 200) : undefined;
}

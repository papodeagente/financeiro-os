/**
 * A fatura para o cliente ler e salvar em PDF pelo portal (E7, 06/11/2026).
 *
 * É o mesmo documento que a agência imprime (`/financeiro-ag/faturas/<id>/imprimir`,
 * os três modelos), aberto pelo link pessoal do cliente: é o "documento da
 * fatura" que o "Enviar por e-mail" manda (escolha Fatura ou Boleto e Fatura).
 *
 * Recorte (lista de permissão, como o resto do portal):
 *   · só fatura FECHADA, da MESMA agência e do MESMO cliente do link;
 *   · os campos que a folha impressa mostra, nada além (sem regra, eventos,
 *     permissões, ids de venda, custo ou margem);
 *   · documento do cliente mascarado; linha e Pix só da cobrança em aberto.
 */
import type { ExecutorSQL } from '../caixa-atomico';
import type { CampoDaFatura, ConfigRetencoes, ModeloDeFatura, TotaisDaFatura } from '../fatura-regras';
import type { Emitente, ItemParaDocumento, Sacado } from '../fatura-documento';
import { documentoMascarado } from './portal-regras';

/** O que a folha da fatura precisa para ser desenhada (a ficha interna também serve). */
export interface DadosDaFolhaDaFatura {
  fatura: {
    numero: number;
    pessoa_nome: string;
    emissao: string | null;
    criado_em: string;
    vencimento: string;
    periodo_inicio: string | null;
    periodo_fim: string | null;
    solicitante: string;
    centro_custo: string;
    observacoes: string;
    modelo: ModeloDeFatura;
    campos: CampoDaFatura[];
    retencoes: ConfigRetencoes;
  };
  itens: ItemParaDocumento[];
  notas: Array<{ id: string; tipo: 'CREDITO' | 'DEBITO'; valor_centavos: number; motivo: string }>;
  totais: TotaisDaFatura;
  emitente: Emitente;
  sacado: Sacado;
  instrucoes: string;
  cobranca: { vencimento: string | null; linha_digitavel: string; pix_copia_cola: string } | null;
}

/** Caminho público do documento da fatura (sem o domínio). */
export function caminhoDaFaturaNoPortal(token: string, faturaId: string): string {
  return `/c/${token}/fatura/${encodeURIComponent(faturaId)}`;
}

/**
 * A fatura do cliente do link, no formato da folha, ou null (404): não é
 * dele, não é desta agência, não está fechada ou não existe.
 */
export async function documentoDaFaturaNoPortal(
  exec: ExecutorSQL, link: { tenant_id: string; cliente_id: string }, faturaId: unknown,
): Promise<DadosDaFolhaDaFatura | null> {
  if (typeof faturaId !== 'string' || !faturaId || faturaId.length > 100) return null;
  const { detalheDaFatura } = await import('../fatura-servidor');
  const { cabecalhoDoDocumento } = await import('../fatura-rota');
  const d = await detalheDaFatura(exec, link.tenant_id, faturaId).catch(() => null);
  if (!d || d.fatura.pessoa_id !== link.cliente_id || d.fatura.situacao !== 'FECHADA') return null;
  const f = d.fatura;
  const cab = await cabecalhoDoDocumento(exec, link.tenant_id, f.pessoa_id, f.pessoa_nome);
  const viva = d.cobranca && (d.cobranca.status === 'aberta' || d.cobranca.status === 'vencida');
  return {
    fatura: {
      numero: f.numero, pessoa_nome: f.pessoa_nome, emissao: f.emissao, criado_em: f.criado_em, vencimento: f.vencimento,
      periodo_inicio: f.periodo_inicio, periodo_fim: f.periodo_fim, solicitante: f.solicitante, centro_custo: f.centro_custo,
      observacoes: f.observacoes, modelo: f.modelo, campos: f.campos, retencoes: f.retencoes,
    },
    itens: d.itens.map(i => ({
      conta_id: i.conta_id, venda_numero: i.venda_numero, data_venda: i.data_venda, descricao: i.descricao, valor_centavos: i.valor_centavos,
      detalhes: {
        produtos: i.detalhes.produtos.map(p => ({
          tipo: p.tipo, descricao: p.descricao, fornecedor_nome: p.fornecedor_nome, localizador: p.localizador,
          data_inicio: p.data_inicio, data_fim: p.data_fim, passageiros: p.passageiros,
        })),
        centro_custo: i.detalhes.centro_custo,
        solicitante: i.detalhes.solicitante,
      },
    })),
    notas: d.notas.map(n => ({ id: n.id, tipo: n.tipo, valor_centavos: n.valor_centavos, motivo: n.motivo })),
    totais: d.totais,
    emitente: cab.emitente,
    sacado: { ...cab.sacado, id: '', email: '', documento: documentoMascarado(cab.sacado.documento) },
    instrucoes: typeof cab.agencia.instrucoes_fatura === 'string' ? cab.agencia.instrucoes_fatura.slice(0, 2000) : '',
    cobranca: viva && d.cobranca
      ? { vencimento: d.cobranca.vencimento, linha_digitavel: d.cobranca.linha_digitavel, pix_copia_cola: d.cobranca.pix_copia_cola }
      : null,
  };
}

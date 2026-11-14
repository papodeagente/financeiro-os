/**
 * EXPORTAÇÃO (E7, G3): Reembolsos e Crédito do cliente como documento de
 * exportação. As duas listas chegam inteiras à tela (o filtro roda no
 * servidor, sem página), então a tela monta o documento e manda para
 * POST /api/exportacao. Arquivo puro; valores em centavos.
 */
import type { CarteiraDoCliente } from '../credito-cliente-servidor';
import type { Reembolso, SituacaoDoReembolso, TipoDeReembolso } from '../reembolsos-servidor';
import { rotuloDoPeriodo, type DocumentoExportado, type FiltroAplicado } from './documento';

const SITUACAO: Record<SituacaoDoReembolso, string> = { SOLICITADO: 'Solicitado', APROVADO: 'Aprovado', PAGO: 'Pago', CANCELADO: 'Cancelado' };
const SENTIDO: Record<TipoDeReembolso, string> = { CLIENTE: 'Ao cliente', FORNECEDOR: 'Do fornecedor' };
/** Filtro da tela: o reembolso do fornecedor pode ser a receber (dele) ou a pagar (a ele). */
export type SentidoDoFiltro = TipoDeReembolso | 'DO_FORNECEDOR' | 'AO_FORNECEDOR';
const SENTIDO_DO_FILTRO: Record<SentidoDoFiltro, string> = { ...SENTIDO, DO_FORNECEDOR: 'Do fornecedor', AO_FORNECEDOR: 'Ao fornecedor' };
const sentidoDaLinha = (r: Reembolso): string =>
  r.tipo === 'FORNECEDOR' && (r as { sentido?: string }).sentido === 'PAGAR' ? 'Ao fornecedor' : (SENTIDO[r.tipo] ?? r.tipo);
const FILTRO_SITUACAO: Record<string, string> = {
  em_andamento: 'Em andamento', SOLICITADO: 'Solicitados', APROVADO: 'Aprovados', PAGO: 'Pagos', CANCELADO: 'Cancelados',
};

export interface FiltroDosReembolsos { de: string; ate: string; tipo: '' | SentidoDoFiltro; situacao: string; busca: string }

export function filtrosDosReembolsos(f: FiltroDosReembolsos): FiltroAplicado[] {
  const out: FiltroAplicado[] = [];
  if (f.de || f.ate) out.push({ rotulo: 'Prazo', valor: rotuloDoPeriodo(f.de, f.ate) });
  if (f.situacao !== 'todas') out.push({ rotulo: 'Situação', valor: FILTRO_SITUACAO[f.situacao] ?? f.situacao });
  if (f.tipo) out.push({ rotulo: 'Sentido', valor: SENTIDO_DO_FILTRO[f.tipo] });
  if (f.busca.trim()) out.push({ rotulo: 'Busca', valor: f.busca.trim() });
  return out;
}

export function documentoDosReembolsos(lista: readonly Reembolso[], f: FiltroDosReembolsos): DocumentoExportado {
  const andamento = lista.filter(r => r.situacao === 'SOLICITADO' || r.situacao === 'APROVADO');
  return {
    titulo: 'Reembolsos',
    filtros: filtrosDosReembolsos(f),
    colunas: [
      { id: 'prazo', rotulo: 'Prazo', tipo: 'data' },
      { id: 'pessoa', rotulo: 'Para quem / de quem', tipo: 'texto' },
      { id: 'descricao', rotulo: 'Descrição', tipo: 'texto' },
      { id: 'sentido', rotulo: 'Sentido', tipo: 'texto' },
      { id: 'venda', rotulo: 'Venda', tipo: 'texto' },
      { id: 'situacao', rotulo: 'Situação', tipo: 'texto' },
      { id: 'pago_em', rotulo: 'Pago em', tipo: 'data' },
      { id: 'valor', rotulo: 'Valor', tipo: 'dinheiro' },
    ],
    linhas: lista.map(r => ({
      prazo: r.prazo, pessoa: r.pessoa_nome, descricao: r.descricao, sentido: sentidoDaLinha(r), venda: r.venda_numero,
      situacao: r.atrasado && (r.situacao === 'SOLICITADO' || r.situacao === 'APROVADO') ? 'Prazo vencido' : (r.credito_id && r.situacao === 'PAGO' ? 'Pago (virou crédito)' : SITUACAO[r.situacao] ?? r.situacao),
      pago_em: r.pago_em, valor: r.valor_centavos,
    })),
    totais: { valor: andamento.reduce((a, r) => a + r.valor_centavos, 0) },
    rotulo_total: 'Em andamento no filtro',
    dinheiro_em: 'centavos',
  };
}

export interface FiltroDosCreditos { busca: string; mostrar: 'com_saldo' | 'todos' }

export function documentoDosCreditos(lista: readonly CarteiraDoCliente[], f: FiltroDosCreditos): DocumentoExportado {
  const filtros: FiltroAplicado[] = [{ rotulo: 'Mostrar', valor: f.mostrar === 'com_saldo' ? 'Só quem tem saldo' : 'Todos os clientes' }];
  if (f.busca.trim()) filtros.push({ rotulo: 'Busca', valor: f.busca.trim() });
  const soma = (k: 'disponivel' | 'vencendo' | 'total_recebido' | 'total_usado') => lista.reduce((a, c) => a + c[k], 0);
  return {
    titulo: 'Crédito do cliente',
    filtros,
    colunas: [
      { id: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
      { id: 'creditos', rotulo: 'Créditos com saldo', tipo: 'inteiro' },
      { id: 'disponivel', rotulo: 'Disponível', tipo: 'dinheiro' },
      { id: 'vencendo', rotulo: 'Vence em 30 dias', tipo: 'dinheiro' },
      { id: 'validade', rotulo: 'Próxima validade', tipo: 'data' },
      { id: 'recebido', rotulo: 'Já entrou', tipo: 'dinheiro' },
      { id: 'usado', rotulo: 'Já usado', tipo: 'dinheiro' },
    ],
    linhas: lista.map(c => ({
      cliente: c.cliente_nome || 'Cliente', creditos: c.creditos_ativos, disponivel: c.disponivel, vencendo: c.vencendo,
      validade: c.proxima_validade, recebido: c.total_recebido, usado: c.total_usado,
    })),
    totais: {
      creditos: lista.reduce((a, c) => a + c.creditos_ativos, 0),
      disponivel: soma('disponivel'), vencendo: soma('vencendo'), recebido: soma('total_recebido'), usado: soma('total_usado'),
    },
    dinheiro_em: 'centavos',
  };
}

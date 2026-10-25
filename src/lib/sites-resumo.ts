/** Resumo de um pedido a partir do histórico do Sites, sem criar lançamentos no Financeiro. */
export interface LinhaSites {
  tipo: string;
  dados: Record<string, unknown>;
  reserva_id?: string | null;
  agregado_versao: number;
  criado_em: string | Date;
}

const centavos = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const id = (v: unknown): string | null => v == null ? null : String(v);

export function resumoDoPedidoSites(eventos: LinhaSites[]) {
  const moedas = new Set<string>();
  const reservas = new Map<string, { versao: number; data: number; valor: number }>();
  const pagamentos = new Map<string, { data: number; valor: number; taxa: number }>();
  const taxas = new Map<string, { data: number; valor: number }>();
  const reembolsos = new Map<string, { data: number; valor: number }>();
  const custos = new Map<string, { data: number; valor: number }>();

  for (const e of eventos) {
    const d = e.dados;
    if (typeof d.moeda === 'string' && /^[A-Z]{3}$/.test(d.moeda)) moedas.add(d.moeda);
    const data = new Date(e.criado_em).getTime();
    if (!Number.isFinite(data)) continue;
    const reservaId = id(d.reservaId ?? e.reserva_id);
    if (e.tipo.startsWith('reserva.') && reservaId) {
      const valor = e.tipo === 'reserva.recusada' || (e.tipo === 'reserva.cancelada' && d.parcial !== true)
        ? 0 : centavos(d.totalCentavos);
      if (valor !== null) {
        const prev = reservas.get(reservaId);
        if (!prev || e.agregado_versao > prev.versao || (e.agregado_versao === prev.versao && data >= prev.data))
          reservas.set(reservaId, { versao: e.agregado_versao, data, valor });
      }
    }
    if (e.tipo === 'pagamento.recebido') {
      const chave = id(d.pagamentoId ?? d.idExterno), valor = centavos(d.valorCentavos);
      if (chave && valor !== null && (!pagamentos.has(chave) || data >= pagamentos.get(chave)!.data))
        pagamentos.set(chave, { data, valor, taxa: centavos(d.taxaCentavos) ?? 0 });
    }
    if (e.tipo === 'taxa.ajustada') {
      const chave = id(d.pagamentoId), valor = centavos(d.finalCentavos);
      if (chave && valor !== null && (!taxas.has(chave) || data >= taxas.get(chave)!.data)) taxas.set(chave, { data, valor });
    }
    if (e.tipo === 'reembolso.efetuado') {
      const chave = id(d.reembolsoId), valor = centavos(d.valorCentavos);
      if (chave && valor !== null && (!reembolsos.has(chave) || data >= reembolsos.get(chave)!.data)) reembolsos.set(chave, { data, valor });
    }
    if (e.tipo === 'custo.registrado') {
      const chave = id(d.custoId), valor = centavos(d.realCentavos);
      if (chave && valor !== null && (!custos.has(chave) || data >= custos.get(chave)!.data)) custos.set(chave, { data, valor });
    }
  }

  const totalReservadoCentavos = reservas.size ? [...reservas.values()].reduce((s, v) => s + v.valor, 0) : null;
  const recebidoCentavos = [...pagamentos.values()].reduce((s, v) => s + v.valor, 0);
  const reembolsadoCentavos = [...reembolsos.values()].reduce((s, v) => s + v.valor, 0);
  const taxaCentavos = [...pagamentos.entries()].reduce((s, [chave, p]) => s + (taxas.get(chave)?.valor ?? p.taxa), 0);
  const custoCentavos = [...custos.values()].reduce((s, v) => s + v.valor, 0);
  const recebidoLiquidoCentavos = recebidoCentavos - reembolsadoCentavos - taxaCentavos;
  return {
    moedas: [...moedas],
    totalReservadoCentavos,
    recebidoCentavos, reembolsadoCentavos, taxaCentavos, custoCentavos, recebidoLiquidoCentavos,
    diferencaCentavos: totalReservadoCentavos === null ? null : totalReservadoCentavos - (recebidoCentavos - reembolsadoCentavos),
    quantidades: { reservas: reservas.size, pagamentos: pagamentos.size, reembolsos: reembolsos.size, custos: custos.size },
  };
}

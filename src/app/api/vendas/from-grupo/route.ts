import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId, minPositivo } from '@/lib/utils';
import { calcProposta } from '@/lib/calculations';
import type { GrupoViagem } from '@/lib/types';
import type { VendaCRM, ProdutoVenda } from '@/lib/crm-types';

export async function POST(req: Request) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB not initialized' }, { status: 500 });

    const { grupo_id, status = 'RESERVADO' } = await req.json();
    if (!grupo_id) return NextResponse.json({ error: 'grupo_id obrigatorio' }, { status: 400 });

    const { rows: grupoRows } = await pool.query(`SELECT data FROM grupos WHERE id = $1`, [grupo_id]);
    if (grupoRows.length === 0) return NextResponse.json({ error: 'Grupo nao encontrado' }, { status: 404 });
    const grupo: GrupoViagem = grupoRows[0].data;

    const pricing = calcProposta(grupo);
    const { rows: countRows } = await pool.query(`SELECT COUNT(*) as c FROM vendas_crm`);
    const num = `VND-${String(parseInt(countRows[0].c) + 1).padStart(4, '0')}`;

    const id = generateId();
    const produtos: ProdutoVenda[] = [];
    const periodos = grupo.periodos || [];

    // TKT → AEREO products
    for (let i = 0; i < grupo.tkt.trechos.length; i++) {
      const trecho = grupo.tkt.trechos[i];
      const infoTrecho = grupo.trechos[i];
      const melhorAdt = minPositivo(trecho.fontes.map(f => f.valor_adt));
      const bestFonte = trecho.fontes.find(f => f.valor_adt === melhorAdt && melhorAdt > 0) || trecho.fontes[0];
      const pc = bestFonte?.partida_chegada || '';

      produtos.push({
        id: generateId(),
        tipo: 'AEREO',
        descricao: `Aereo${pc ? ` — ${pc}` : ` — Trecho ${i + 1}`}`,
        fornecedor_id: '',
        fornecedor_nome: bestFonte?.nome || '',
        data_inicio: infoTrecho?.data || '',
        data_fim: '',
        localizador: '',
        cia_aerea: bestFonte?.nome || '',
        trecho: pc,
        hotel_nome: '',
        tipo_apto: '',
        regime: '',
        valor_custo: melhorAdt,
        valor_venda: melhorAdt,
        comissao_fornecedor: 0,
        moeda: 'BRL',
        cambio: grupo.cambio['tkt']?.valor || 1,
        status: 'RESERVADO',
        aprovador: '', solicitante: '', centro_custo: '', projeto: '',
      });
    }

    // HTL → HOTEL products
    for (let i = 0; i < grupo.htl.hoteis.length; i++) {
      const hotel = grupo.htl.hoteis[i];
      const per = periodos[i];
      let bestFonteName = '';
      let bestDbl = Infinity;
      for (const f of hotel.fontes) {
        if (f.valor_dbl !== null && f.valor_dbl > 0 && f.valor_dbl < bestDbl) {
          bestDbl = f.valor_dbl;
          bestFonteName = f.nome;
        }
      }

      produtos.push({
        id: generateId(),
        tipo: 'HOTEL',
        descricao: `Hotel — ${per?.hotel || bestFonteName || 'Hotel'}`,
        fornecedor_id: '',
        fornecedor_nome: bestFonteName,
        data_inicio: per?.check_in || '',
        data_fim: per?.check_out || '',
        localizador: '',
        cia_aerea: '',
        trecho: '',
        hotel_nome: per?.hotel || bestFonteName || '',
        tipo_apto: 'DBL',
        regime: hotel.info.pensao || '',
        valor_custo: bestDbl === Infinity ? 0 : bestDbl,
        valor_venda: bestDbl === Infinity ? 0 : bestDbl,
        comissao_fornecedor: 0,
        moeda: 'BRL',
        cambio: grupo.cambio['htl']?.valor || 1,
        status: 'RESERVADO',
        aprovador: '', solicitante: '', centro_custo: '', projeto: '',
      });
    }

    // REC → RECEPTIVO products
    for (const passeio of grupo.rec.passeios) {
      const melhorAdt = minPositivo(passeio.fornecedores.map(f => f.valor_adt));
      if (melhorAdt <= 0 && !passeio.nome) continue;
      const bestForn = passeio.fornecedores.find(f => f.valor_adt === melhorAdt && melhorAdt > 0);
      produtos.push({
        id: generateId(),
        tipo: 'RECEPTIVO',
        descricao: `Receptivo — ${passeio.nome || 'Passeio'}`,
        fornecedor_id: '',
        fornecedor_nome: bestForn?.nome || '',
        data_inicio: passeio.data || '',
        data_fim: '',
        localizador: '', cia_aerea: '', trecho: '', hotel_nome: '', tipo_apto: '', regime: '',
        valor_custo: melhorAdt,
        valor_venda: melhorAdt,
        comissao_fornecedor: 0,
        moeda: 'BRL',
        cambio: grupo.cambio['rec']?.valor || 1,
        status: 'RESERVADO',
        aprovador: '', solicitante: '', centro_custo: '', projeto: '',
      });
    }

    // CAR → CARRO products
    for (const transp of grupo.car.transportes) {
      const melhor = minPositivo(transp.empresas.map(e => e.valor_veiculo));
      if (melhor <= 0) continue;
      const bestEmp = transp.empresas.find(e => e.valor_veiculo === melhor);
      produtos.push({
        id: generateId(),
        tipo: 'CARRO',
        descricao: `Transfer — ${transp.origem || ''} → ${transp.destino || ''}`,
        fornecedor_id: '',
        fornecedor_nome: bestEmp?.nome || '',
        data_inicio: '', data_fim: '',
        localizador: '', cia_aerea: '', trecho: '', hotel_nome: '', tipo_apto: '', regime: '',
        valor_custo: melhor,
        valor_venda: melhor,
        comissao_fornecedor: 0,
        moeda: 'BRL',
        cambio: grupo.cambio['car']?.valor || 1,
        status: 'RESERVADO',
        aprovador: '', solicitante: '', centro_custo: '', projeto: '',
      });
    }

    // SEG → SEGURO product
    const segDbl = minPositivo(grupo.seg.seguradoras.map(s => s.valor_dbl));
    if (segDbl > 0) {
      const bestSeg = grupo.seg.seguradoras.find(s => s.valor_dbl === segDbl);
      produtos.push({
        id: generateId(),
        tipo: 'SEGURO',
        descricao: `Seguro — ${bestSeg?.nome || 'Seguro Viagem'}`,
        fornecedor_id: '',
        fornecedor_nome: bestSeg?.nome || '',
        data_inicio: '', data_fim: '',
        localizador: '', cia_aerea: '', trecho: '', hotel_nome: '', tipo_apto: '', regime: '',
        valor_custo: segDbl,
        valor_venda: segDbl,
        comissao_fornecedor: 0,
        moeda: 'BRL',
        cambio: grupo.cambio['seg']?.valor || 1,
        status: 'RESERVADO',
        aprovador: '', solicitante: '', centro_custo: '', projeto: '',
      });
    }

    // ING → INGRESSO products
    for (const atr of grupo.ing.atrativos) {
      const melhorAdt = minPositivo(atr.fontes.map(f => f.valor_adt));
      if (melhorAdt <= 0 && !atr.nome) continue;
      const bestFonte = atr.fontes.find(f => f.valor_adt === melhorAdt && melhorAdt > 0);
      produtos.push({
        id: generateId(),
        tipo: 'INGRESSO',
        descricao: `Ingresso — ${atr.nome || 'Atrativo'}`,
        fornecedor_id: '',
        fornecedor_nome: bestFonte?.nome || '',
        data_inicio: atr.data || '',
        data_fim: '',
        localizador: '', cia_aerea: '', trecho: '', hotel_nome: '', tipo_apto: '', regime: '',
        valor_custo: melhorAdt,
        valor_venda: melhorAdt,
        comissao_fornecedor: 0,
        moeda: 'BRL',
        cambio: grupo.cambio['ing']?.valor || 1,
        status: 'RESERVADO',
        aprovador: '', solicitante: '', centro_custo: '', projeto: '',
      });
    }

    // NAVIO → CRUZEIRO product
    const navioDbl = minPositivo(grupo.navio.fornecedores.map(f => f.valor_dbl));
    if (navioDbl > 0) {
      const bestNav = grupo.navio.fornecedores.find(f => f.valor_dbl === navioDbl);
      produtos.push({
        id: generateId(),
        tipo: 'CRUZEIRO',
        descricao: `Cruzeiro — ${grupo.navio_info.nome_cruzeiro || bestNav?.nome || 'Navio'}`,
        fornecedor_id: '',
        fornecedor_nome: bestNav?.nome || '',
        data_inicio: grupo.navio_info.embarque || '',
        data_fim: grupo.navio_info.desembarque || '',
        localizador: '', cia_aerea: '', trecho: '', hotel_nome: '', tipo_apto: '', regime: '',
        valor_custo: navioDbl,
        valor_venda: navioDbl,
        comissao_fornecedor: 0,
        moeda: 'BRL',
        cambio: grupo.cambio['navio']?.valor || 1,
        status: 'RESERVADO',
        aprovador: '', solicitante: '', centro_custo: '', projeto: '',
      });
    }

    const valorTotalCusto = produtos.reduce((acc, p) => acc + p.valor_custo * p.cambio, 0);
    const dblAvista = pricing.totalPaxAvista['dbl'] || 0;

    const venda: VendaCRM = {
      id, numero: num,
      data_venda: new Date().toISOString().split('T')[0],
      tipo: 'GRUPO',
      grupo_id,
      cliente_id: '',
      vendedor_id: '',
      passageiros: [],
      pagantes: [],
      produtos,
      valor_total_custo: valorTotalCusto,
      valor_total_venda: dblAvista * 2, // DBL = 2 PAX default estimate
      markup_realizado: 0,
      desconto: 0,
      valor_final: dblAvista * 2,
      forma_pagamento: 'AVISTA_PIX',
      parcelas: grupo.params.parcelas,
      pagamento_detalhado: [],
      status: status as 'ORCAMENTO' | 'RESERVADO' | 'CONFIRMADO' | 'CANCELADO' | 'CONCLUIDO',
      motivo_cancelamento: '',
      recibo_emitido: false,
      intermediario_id: null,
      comissao_intermediario: 0,
      centro_custo: '',
      numero_po: '',
      anexos: [],
      observacoes: `Gerado automaticamente do produto ${grupo.grp_id}`,
      campos_personalizados: {},
    };

    await pool.query(
      `INSERT INTO vendas_crm (id, cliente_id, vendedor_id, status, data) VALUES ($1, $2, $3, $4, $5)`,
      [id, '', '', status, JSON.stringify(venda)]
    );

    // Update grupo pipeline
    const newStatus = status === 'RESERVADO' ? 'RESERVA' : 'VENDA';
    const updatedGrupo = { ...grupo, venda_crm_id: id, status_pipeline: newStatus };
    await pool.query(
      `UPDATE grupos SET data = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(updatedGrupo), grupo_id]
    );

    return NextResponse.json({ id, numero: num });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

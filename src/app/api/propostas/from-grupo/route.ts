import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { calcProposta } from '@/lib/calculations';
import { minPositivo, calcDiarias } from '@/lib/utils';
import type { GrupoViagem } from '@/lib/types';
import { getTenantId } from '@/lib/tenant';
import { emitirEventoCRM } from '@/lib/crm-integration';

function fmtDate(d: string | null): string {
  if (!d) return '';
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR');
}

function fmtBRL(v: number): string {
  if (!v) return 'R$ 0,00';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export async function POST(req: NextRequest) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB not initialized' }, { status: 500 });

    const tenantId = await getTenantId();
    const { grupo_id, template_id } = await req.json();
    if (!grupo_id) return NextResponse.json({ error: 'grupo_id obrigatorio' }, { status: 400 });

    const { rows: grupoRows } = await pool.query(`SELECT data FROM grupos WHERE id = $1 AND tenant_id = $2`, [grupo_id, tenantId]);
    if (grupoRows.length === 0) return NextResponse.json({ error: 'Grupo nao encontrado' }, { status: 404 });
    const grupo: GrupoViagem = grupoRows[0].data;

    // Load template if specified
    let templateVisual: Record<string, unknown> | null = null;
    if (template_id) {
      const { rows: tmplRows } = await pool.query(`SELECT data FROM templates_proposta WHERE id = $1 AND tenant_id = $2`, [template_id, tenantId]);
      if (tmplRows.length > 0) {
        const tmpl = tmplRows[0].data;
        templateVisual = tmpl.visual || null;
      }
    }

    const { rows: countRows } = await pool.query(`SELECT COUNT(*) as c FROM propostas WHERE tenant_id = $1`, [tenantId]);
    const num = `PROP-${String(parseInt(countRows[0].c) + 1).padStart(4, '0')}`;

    // --- Compute pricing ---
    const pricing = calcProposta(grupo);
    const p = grupo.params;

    // --- Extract best suppliers for each service ---
    const id = generateId();
    const destino = grupo.origem_destino || '';
    const periodos = grupo.periodos || [];
    const dataInicio = periodos[0]?.check_in || '';
    const dataFim = periodos[periodos.length - 1]?.check_out || '';
    const totalDias = calcDiarias(dataInicio, dataFim);
    const totalNoites = totalDias > 0 ? totalDias : 0;

    // --- Build ViagemEstruturada ---
    const alojamentos = grupo.htl.hoteis.map((h, hIdx) => {
      const per = periodos[hIdx];
      // Find best fonte name
      const tipos = ['sgl', 'dbl', 'tpl', 'qdp', 'chd'] as const;
      let bestFonteName = '';
      let bestTotal = Infinity;
      for (const f of h.fontes) {
        const sum = tipos.reduce((acc, t) => acc + (f[`valor_${t}`] || 0), 0);
        if (sum > 0 && sum < bestTotal) { bestTotal = sum; bestFonteName = f.nome; }
      }

      // Mantém a descrição PURA (vinda da API ou digitada). Pensão,
      // check-in/out e política CHD vão pra campos estruturados próprios
      // no AlojamentoData — o HotelModal renderiza cada um em sua seção.
      // Quando não há descrição nem info_adicional, deixamos string vazia.
      const descricaoPura = h.info.hotel_descricao
        || h.info.info_adicional
        || '';

      return {
        id: generateId(),
        destino_nome: per?.destino || '',
        hotel_nome: per?.hotel || bestFonteName || 'Hotel',
        hotel_estrelas: h.info.hotel_estrelas || undefined,
        hotel_imagem: h.info.hotel_imagem || '',
        hotel_galeria: h.info.hotel_galeria || [],
        hotel_descricao: descricaoPura,
        hotel_link: h.info.hotel_link || '',
        check_in: per?.check_in || '',
        check_out: per?.check_out || '',
        check_in_hora: h.info.check_in_hora || undefined,
        check_out_hora: h.info.check_out_hora || undefined,
        pensao_descricao: h.info.pensao || undefined,
        politica_chd: h.info.politica_chd || undefined,
        noites: calcDiarias(per?.check_in || null, per?.check_out || null),
        regime: (h.info.pensao?.toUpperCase()?.startsWith('ALL') ? 'AI'
          : h.info.pensao?.toUpperCase()?.startsWith('CAFE') ? 'BB'
          : h.info.pensao?.toUpperCase()?.startsWith('MEIA') ? 'HB'
          : h.info.pensao?.toUpperCase()?.startsWith('PENS') ? 'FB'
          : 'RO') as 'RO' | 'BB' | 'HB' | 'FB' | 'AI',
        lat: h.info.hotel_lat,
        lng: h.info.hotel_lng,
      };
    });

    const transportes: Array<{ id: string; tipo: string; data: string; origem: string; destino: string; companhia?: string; horario_saida?: string; horario_chegada?: string; detalhes?: string; numero_voo?: string }> = grupo.tkt.trechos.map((trecho, tIdx) => {
      const infoTrecho = grupo.trechos[tIdx];
      // Find best fonte with partida_chegada
      let bestFonte = trecho.fontes.find(f => f.partida_chegada);
      if (!bestFonte) bestFonte = trecho.fontes[0];
      const pc = bestFonte?.partida_chegada || '';

      return {
        id: generateId(),
        tipo: 'VOO',
        data: infoTrecho?.data || '',
        origem: pc.split('→')[0]?.trim()?.split(' ')[0] || '',
        destino: pc.split('→')[1]?.trim()?.split(' ')[0] || '',
        horario_saida: pc.split('→')[0]?.trim()?.split(' ').slice(1).join(' ') || '',
        horario_chegada: pc.split('→')[1]?.trim()?.split(' ').slice(1).join(' ') || '',
        companhia: bestFonte?.nome || '',
        detalhes: pc,
      };
    });

    // Add CAR transports
    for (const transp of grupo.car.transportes) {
      const melhor = minPositivo(transp.empresas.map(e => e.valor_veiculo));
      const bestEmpresa = transp.empresas.find(e => e.valor_veiculo === melhor && melhor > 0);
      if (transp.origem || transp.destino) {
        transportes.push({
          id: generateId(),
          tipo: 'TRANSFER',
          data: '',
          origem: transp.origem || '',
          destino: transp.destino || '',
          companhia: bestEmpresa?.nome || '',
          horario_saida: '',
          horario_chegada: '',
          detalhes: bestEmpresa ? `${bestEmpresa.nome} — ${fmtBRL(bestEmpresa.valor_veiculo || 0)}/veículo` : '',
        });
      }
    }

    const destinosRoteiro = periodos.map((per, i) => ({
      id: generateId(),
      nome: per.destino || `Destino ${i + 1}`,
      descricao: '',
      dias_inicio: i + 1,
      dias_fim: i + 1,
      alojamento_ids: alojamentos[i] ? [alojamentos[i].id] : [],
    }));

    const viagem = {
      duracao_dias: totalDias + 1,
      duracao_noites: totalNoites,
      destinos: destinosRoteiro,
      alojamentos,
      transportes,
      interesses_tags: [],
    };

    // --- Build sections ---
    const secoes: Array<{ id: string; tipo: string; ordem: number; visivel: boolean; conteudo: Record<string, unknown> }> = [];
    let ordem = 0;

    // 1. Intro text
    secoes.push({
      id: generateId(), tipo: 'TEXTO', ordem: ordem++, visivel: true,
      conteudo: {
        titulo: `Viagem — ${destino}`,
        corpo: grupo.descricao_orcamento || '',
        alinhamento: 'center',
      },
    });

    // 2. ALOJAMENTO sections (HTL) — rich hotel cards with gallery, map, click-to-expand
    for (let hIdx = 0; hIdx < grupo.htl.hoteis.length; hIdx++) {
      const hotel = grupo.htl.hoteis[hIdx];
      const per = periodos[hIdx];
      const aloj = alojamentos[hIdx];
      if (!aloj) continue;

      // Find best DBL price for preco_noite/preco_total
      let bestDbl = Infinity;
      for (const f of hotel.fontes) {
        if (f.valor_dbl !== null && f.valor_dbl > 0 && f.valor_dbl < bestDbl) bestDbl = f.valor_dbl;
      }
      const noites = calcDiarias(per?.check_in || null, per?.check_out || null);
      const precoNoite = hotel.info.hotel_preco_noite || (bestDbl < Infinity && noites > 0 ? Math.round(bestDbl / noites) : 0);
      const precoTotal = bestDbl < Infinity ? bestDbl : 0;

      secoes.push({
        id: aloj.id, tipo: 'ALOJAMENTO', ordem: ordem++, visivel: true,
        conteudo: {
          ...aloj,
          rating: hotel.info.hotel_rating || undefined,
          reviews_count: hotel.info.hotel_reviews_count || undefined,
          amenities: hotel.info.hotel_amenities || [],
          // Proximidades vão direto pro conteúdo do bloco. HotelModal
          // pode renderizar como "O que tem por perto" (toggle default on).
          proximidades: hotel.info.hotel_proximidades || [],
          mostrar_proximidades: (hotel.info.hotel_proximidades?.length || 0) > 0,
          mostrar_avaliacao_google: true,
          mostrar_amenities: true,
          mostrar_galeria: true,
          preco_noite: precoNoite,
          preco_total: precoTotal,
          viagem_noturna: false,
          quarto_tipo: '',
          bebidas: '',
        },
      });
    }

    // 3. TRANSPORTE sections (TKT) — flight cards with airline, route, click-to-expand
    for (let tIdx = 0; tIdx < grupo.tkt.trechos.length; tIdx++) {
      const transp = transportes[tIdx];
      if (!transp) continue;

      const trecho = grupo.tkt.trechos[tIdx];
      const bestFonte = trecho.fontes.find(f => f.partida_chegada) || trecho.fontes.find(f => (f.valor_adt ?? 0) > 0) || trecho.fontes[0];
      const pc = bestFonte?.partida_chegada || '';

      // Parse flight details from partida_chegada format: "GRU 14:30 → DXB 22:40"
      const parts = pc.split('→').map(s => s.trim());
      const origemParts = parts[0]?.split(' ') || [];
      const destParts = parts[1]?.split(' ') || [];

      // Quando o trecho veio da SearchAPI (Google Flights), usamos o
      // snapshot rico salvo em trecho.voo_api — assim RichFlightCard
      // recebe logo da cia, segmentos, bagagem, CO2, classe e legroom.
      const voo = trecho.voo_api;

      secoes.push({
        id: transp.id, tipo: 'TRANSPORTE', ordem: ordem++, visivel: true,
        conteudo: {
          ...transp,
          companhia: voo?.companhia || bestFonte?.nome || transp.companhia || '',
          companhia_logo: voo?.companhia_logo,
          numero_voo: voo?.numero_voo || transp.numero_voo || '',
          aeroporto_origem_nome: voo?.aeroporto_origem_nome,
          aeroporto_destino_nome: voo?.aeroporto_destino_nome,
          data_chegada: voo?.data_chegada,
          horario_saida: voo?.horario_saida || origemParts.slice(1).join(' ') || '',
          horario_chegada: voo?.horario_chegada || destParts.slice(1).join(' ') || '',
          distancia_km: 0,
          tempo_estimado: voo?.duracao || '',
          aeronave: voo?.aeronave,
          classe: voo?.classe,
          bagagem: voo?.bagagem,
          legroom: voo?.legroom,
          emissao_carbono_kg: voo?.emissao_carbono_kg,
          escalas: voo?.escalas,
          escalas_info: voo?.escalas_info,
          segmentos: voo?.segmentos,
          muitas_vezes_atrasado: voo?.muitas_vezes_atrasado,
          valor: voo?.valor ?? (bestFonte?.valor_adt ?? 0),
        },
      });
    }

    // 4. Receptivo / Passeios (REC)
    for (const passeio of grupo.rec.passeios) {
      const melhorAdt = minPositivo(passeio.fornecedores.map(f => f.valor_adt));
      const melhorChd = minPositivo(passeio.fornecedores.map(f => f.valor_chd));
      if (melhorAdt <= 0 && melhorChd <= 0 && !passeio.nome) continue;

      const bestForn = passeio.fornecedores.find(f => f.valor_adt === melhorAdt && melhorAdt > 0);
      const detalhes: string[] = [];
      if (passeio.data) detalhes.push(`Data: ${fmtDate(passeio.data)}`);
      if (bestForn?.nome) detalhes.push(`Fornecedor: ${bestForn.nome}`);
      if (bestForn?.deadline) detalhes.push(`Deadline: ${fmtDate(bestForn.deadline)}`);
      if (bestForn?.info) detalhes.push(bestForn.info);

      secoes.push({
        id: generateId(), tipo: 'SERVICO', ordem: ordem++, visivel: true,
        conteudo: {
          icone: '🎯',
          titulo: `Receptivo${passeio.nome ? ` — ${passeio.nome}` : ''}`,
          descricao: passeio.data ? fmtDate(passeio.data) : '',
          detalhes,
          imagem: '',
          valor: melhorAdt,
          exibir_valor: false,
        },
      });
    }

    // 5. Guia (GUIA)
    for (let dIdx = 0; dIdx < grupo.guia.destinos.length; dIdx++) {
      const dest = grupo.guia.destinos[dIdx];
      const melhor = minPositivo(dest.fornecedores.map(f => f.valor_total));
      if (melhor <= 0) continue;

      const bestForn = dest.fornecedores.find(f => f.valor_total === melhor);
      const per = periodos[dIdx];
      const detalhes: string[] = [];
      if (dest.inicio && dest.termino) detalhes.push(`${fmtDate(dest.inicio)} a ${fmtDate(dest.termino)}`);
      if (bestForn?.nome) detalhes.push(`Guia: ${bestForn.nome}`);
      if (bestForn?.telefone) detalhes.push(`Tel: ${bestForn.telefone}`);
      if (bestForn?.deadline) detalhes.push(`Deadline: ${fmtDate(bestForn.deadline)}`);
      if (bestForn?.anotacoes) detalhes.push(bestForn.anotacoes);

      secoes.push({
        id: generateId(), tipo: 'SERVICO', ordem: ordem++, visivel: true,
        conteudo: {
          icone: '🧑‍🏫',
          titulo: `Guia${per?.destino ? ` — ${per.destino}` : ''}`,
          descricao: bestForn?.nome || '',
          detalhes,
          imagem: '',
          valor: melhor,
          exibir_valor: false,
        },
      });
    }

    // 6. Transporte (CAR)
    for (const transp of grupo.car.transportes) {
      const melhor = minPositivo(transp.empresas.map(e => e.valor_veiculo));
      if (melhor <= 0 && !transp.origem && !transp.destino) continue;

      const bestEmp = transp.empresas.find(e => e.valor_veiculo === melhor && melhor > 0);
      const detalhes: string[] = [];
      if (bestEmp?.nome) detalhes.push(`Empresa: ${bestEmp.nome}`);
      if (melhor > 0) detalhes.push(`Valor veículo: ${fmtBRL(melhor)}`);
      if (bestEmp?.contato) detalhes.push(`Contato: ${bestEmp.contato}`);
      if (bestEmp?.deadline) detalhes.push(`Deadline: ${fmtDate(bestEmp.deadline)}`);

      secoes.push({
        id: generateId(), tipo: 'SERVICO', ordem: ordem++, visivel: true,
        conteudo: {
          icone: '🚐',
          titulo: `Carro${transp.origem || transp.destino ? ` — ${transp.origem || ''} → ${transp.destino || ''}` : ''}`,
          descricao: bestEmp?.nome || '',
          detalhes,
          imagem: '',
          valor: melhor,
          exibir_valor: false,
        },
      });
    }

    // 7. Seguro (SEG)
    {
      const segTipos = ['sgl', 'dbl', 'tpl', 'qdp'] as const;
      const hasSeg = grupo.seg.seguradoras.some(s => segTipos.some(t => {
        const v = s[`valor_${t}` as keyof typeof s] as number | null;
        return v !== null && v > 0;
      }));
      if (hasSeg) {
        // Find best per type
        const bestPerType: Record<string, { nome: string; valor: number }> = {};
        for (const t of segTipos) {
          const key = `valor_${t}` as keyof typeof grupo.seg.seguradoras[0];
          const best = minPositivo(grupo.seg.seguradoras.map(s => s[key] as number | null));
          const bestSeg = grupo.seg.seguradoras.find(s => (s[key] as number) === best && best > 0);
          if (bestSeg && best > 0) bestPerType[t] = { nome: bestSeg.nome, valor: best };
        }

        const detalhes: string[] = [];
        for (const t of segTipos) {
          if (bestPerType[t]) detalhes.push(`${t.toUpperCase()}: ${fmtBRL(bestPerType[t].valor)} (${bestPerType[t].nome})`);
        }
        const primaryBest = bestPerType['dbl'] || bestPerType['sgl'] || Object.values(bestPerType)[0];
        if (primaryBest) {
          const bestSeg = grupo.seg.seguradoras.find(s => s.nome === primaryBest.nome);
          if (bestSeg?.descricao) detalhes.push(bestSeg.descricao);
          if (bestSeg?.deadline) detalhes.push(`Deadline: ${fmtDate(bestSeg.deadline)}`);
        }

        secoes.push({
          id: generateId(), tipo: 'SERVICO', ordem: ordem++, visivel: true,
          conteudo: {
            icone: '🛡️',
            titulo: 'Seguro',
            descricao: primaryBest?.nome || '',
            detalhes,
            imagem: '',
            valor: primaryBest?.valor || 0,
            exibir_valor: false,
          },
        });
      }
    }

    // 8. Ingressos (ING)
    for (const atr of grupo.ing.atrativos) {
      const melhorAdt = minPositivo(atr.fontes.map(f => f.valor_adt));
      if (melhorAdt <= 0 && !atr.nome) continue;

      const bestFonte = atr.fontes.find(f => f.valor_adt === melhorAdt && melhorAdt > 0);
      const detalhes: string[] = [];
      if (atr.data) detalhes.push(`Data: ${fmtDate(atr.data)}`);
      if (bestFonte?.nome) detalhes.push(`Fonte: ${bestFonte.nome}`);
      if (bestFonte?.info) detalhes.push(bestFonte.info);

      secoes.push({
        id: generateId(), tipo: 'SERVICO', ordem: ordem++, visivel: true,
        conteudo: {
          icone: '🎟️',
          titulo: `Ingresso${atr.nome ? ` — ${atr.nome}` : ''}`,
          descricao: atr.data ? fmtDate(atr.data) : '',
          detalhes,
          imagem: '',
          valor: melhorAdt,
          exibir_valor: false,
        },
      });
    }

    // 9. Cruzeiro (NAVIO)
    {
      const navTipos = ['sgl', 'dbl', 'tpl', 'qdp', 'chd'] as const;
      const hasNavio = grupo.navio.fornecedores.some(f => navTipos.some(t => {
        const v = f[`valor_${t}` as keyof typeof f] as number | null;
        return v !== null && v > 0;
      }));
      if (hasNavio) {
        const ni = grupo.navio_info;
        const detalhes: string[] = [];
        if (ni.cidade_embarque) detalhes.push(`Embarque: ${ni.cidade_embarque}`);
        if (ni.cidade_desembarque) detalhes.push(`Desembarque: ${ni.cidade_desembarque}`);
        if (ni.embarque && ni.desembarque) detalhes.push(`${fmtDate(ni.embarque)} a ${fmtDate(ni.desembarque)} (${calcDiarias(ni.embarque, ni.desembarque)} noites)`);

        // Best DBL price
        const bestDbl = minPositivo(grupo.navio.fornecedores.map(f => f.valor_dbl));
        const bestForn = grupo.navio.fornecedores.find(f => f.valor_dbl === bestDbl && bestDbl > 0);
        if (bestForn) detalhes.push(`Fornecedor: ${bestForn.nome}`);
        if (grupo.navio.deadline) detalhes.push(`Deadline: ${fmtDate(grupo.navio.deadline)}`);
        if (grupo.navio.info_adicional) detalhes.push(grupo.navio.info_adicional);

        secoes.push({
          id: generateId(), tipo: 'SERVICO', ordem: ordem++, visivel: true,
          conteudo: {
            icone: '🚢',
            titulo: `Navio${ni.nome_cruzeiro ? ` — ${ni.nome_cruzeiro}` : ''}`,
            descricao: `${ni.cidade_embarque || ''} → ${ni.cidade_desembarque || ''}`,
            detalhes,
            imagem: '',
            valor: bestDbl,
            exibir_valor: false,
          },
        });
      }
    }

    // 10. Brinde
    {
      const bestPreco = minPositivo(grupo.brinde.fornecedores.map(f => f.valor_unidade));
      if (bestPreco > 0) {
        const bestForn = grupo.brinde.fornecedores.find(f => f.valor_unidade === bestPreco);
        const detalhes: string[] = [];
        if (bestForn?.nome) detalhes.push(`Fornecedor: ${bestForn.nome}`);
        if (bestForn?.descricao) detalhes.push(bestForn.descricao);
        if (bestForn?.prazo_entrega) detalhes.push(`Prazo: ${bestForn.prazo_entrega}`);
        if (bestForn?.deadline) detalhes.push(`Deadline: ${fmtDate(bestForn.deadline)}`);

        secoes.push({
          id: generateId(), tipo: 'SERVICO', ordem: ordem++, visivel: true,
          conteudo: {
            icone: '🎁',
            titulo: 'Brinde',
            descricao: bestForn?.descricao || '',
            detalhes,
            imagem: '',
            valor: bestPreco,
            exibir_valor: false,
          },
        });
      }
    }

    // 11. Roteiro from periodos
    if (periodos.length > 0) {
      const dias = periodos.map((per, i) => {
        const atividades: string[] = [];

        // Add passeios for this period
        for (const passeio of grupo.rec.passeios) {
          if (passeio.nome && (passeio.data === per.check_in || !passeio.data)) {
            atividades.push(passeio.nome);
          }
        }

        // Add atrativos for this period
        for (const atr of grupo.ing.atrativos) {
          if (atr.nome && atr.data === per.check_in) {
            atividades.push(atr.nome);
          }
        }

        return {
          numero: i + 1,
          titulo: `${per.destino}${per.hotel ? ` — ${per.hotel}` : ''}`,
          descricao: `${fmtDate(per.check_in)} a ${fmtDate(per.check_out)}`,
          imagem: '',
          atividades,
          refeicoes_inclusas: '',
        };
      });
      secoes.push({
        id: generateId(), tipo: 'ROTEIRO_DIA', ordem: ordem++, visivel: true,
        conteudo: { dias },
      });
    }

    // 12. Inclusos / Não inclusos
    {
      const inclusos: string[] = [];
      const hasTkt = grupo.tkt.trechos.some(t => t.fontes.some(f => (f.valor_adt ?? 0) > 0));
      const hasHtl = grupo.htl.hoteis.some(h => h.fontes.some(f => (f.valor_dbl ?? 0) > 0));
      const hasRec = grupo.rec.passeios.some(p => p.fornecedores.some(f => (f.valor_adt ?? 0) > 0));
      const hasCar = grupo.car.transportes.some(t => t.empresas.some(e => (e.valor_veiculo ?? 0) > 0));
      const hasGuia = grupo.guia.destinos.some(d => d.fornecedores.some(f => (f.valor_total ?? 0) > 0));
      const hasSeg = grupo.seg.seguradoras.some(s => (s.valor_sgl ?? 0) > 0 || (s.valor_dbl ?? 0) > 0);
      const hasNavio = grupo.navio.fornecedores.some(f => (f.valor_dbl ?? 0) > 0);
      const hasIng = grupo.ing.atrativos.some(a => a.fontes.some(f => (f.valor_adt ?? 0) > 0));
      const hasBrinde = grupo.brinde.fornecedores.some(f => (f.valor_unidade ?? 0) > 0);

      if (hasTkt) inclusos.push('Passagem aérea');
      if (hasHtl) {
        const pensoes = grupo.htl.hoteis.map((_, i) => periodos[i]?.hotel).filter(Boolean);
        inclusos.push(`Hospedagem${pensoes.length > 0 ? ` (${pensoes.join(', ')})` : ''}`);
      }
      if (hasCar) inclusos.push('Transfer / Transporte terrestre');
      if (hasRec) {
        const passeioNames = grupo.rec.passeios.filter(p => p.nome).map(p => p.nome);
        inclusos.push(passeioNames.length > 0 ? `Passeios: ${passeioNames.join(', ')}` : 'Passeios');
      }
      if (hasGuia) inclusos.push('Guia acompanhante');
      if (hasSeg) inclusos.push('Seguro viagem');
      if (hasNavio) inclusos.push(`Cruzeiro (${grupo.navio_info.nome_cruzeiro || ''})`);
      if (hasIng) {
        const atrNames = grupo.ing.atrativos.filter(a => a.nome).map(a => a.nome);
        inclusos.push(atrNames.length > 0 ? `Ingressos: ${atrNames.join(', ')}` : 'Ingressos');
      }
      if (hasBrinde) inclusos.push('Brinde exclusivo');

      secoes.push({
        id: generateId(), tipo: 'INCLUSOS', ordem: ordem++, visivel: true,
        conteudo: {
          inclusos,
          nao_inclusos: ['Refeições não mencionadas', 'Passeios opcionais', 'Gorjetas', 'Despesas pessoais'],
        },
      });
    }

    // 13. Valores — computed from calcProposta + detalhamento por pessoa
    //
    // Estrutura: opções por tipo de apto (DBL/TPL/QDP/SGL conforme houver)
    // + bloco "detalhamento_pax" com Adulto/Criança e total geral quando
    // o produto tem lista de passageiros cadastrados na aba INFO.
    {
      const tiposValor = ['sgl', 'dbl', 'tpl', 'qdp'] as const;
      const tipoLabels: Record<string, string> = { sgl: 'Individual', dbl: 'Duplo', tpl: 'Triplo', qdp: 'Quádruplo' };
      const tipoPax: Record<string, number> = { sgl: 1, dbl: 2, tpl: 3, qdp: 4 };

      const passageirosLista = grupo.passageiros || [];
      const qtdAdt = passageirosLista.filter(pp => pp.tipo === 'ADT').length;
      const qtdChd = passageirosLista.filter(pp => pp.tipo === 'CHD').length;
      const temPassageiros = passageirosLista.length > 0;

      // Apto preferencial dos adultos: bate qtd_adt com SGL/DBL/TPL/QDP
      // (1→SGL, 2→DBL, 3→TPL, 4→QDP). 5+ ou 0: DBL como referência geral.
      const aptoAdulto: 'sgl' | 'dbl' | 'tpl' | 'qdp' =
        (['sgl', 'dbl', 'tpl', 'qdp'] as const)[qtdAdt - 1] || 'dbl';

      const opcoes = tiposValor
        .filter(t => (pricing.totalAvista[t] || 0) > 0)
        .map((t) => {
          const parcelas: Array<{ forma: string; valor_parcela: number; valor_total: number; destaque: boolean }> = [];

          // À vista PIX
          if (pricing.totalPaxAvista[t] > 0) {
            parcelas.push({
              forma: 'À vista (PIX)',
              valor_parcela: pricing.totalPaxAvista[t],
              valor_total: pricing.totalPaxAvista[t],
              destaque: true,
            });
          }

          // Parcelado cartão
          if (p.parcelas > 0 && pricing.totalPaxCartao[t] > 0) {
            parcelas.push({
              forma: `${p.parcelas}x Cartão`,
              valor_parcela: pricing.parcelaPaxCC[t],
              valor_total: pricing.totalPaxCartao[t],
              destaque: false,
            });
          }

          // Parcelado boleto
          if (p.parcelas > 0 && p.tx_boleto > 0 && pricing.totalPaxBoleto[t] > 0) {
            parcelas.push({
              forma: `${p.parcelas}x Boleto`,
              valor_parcela: pricing.parcelaPaxBoleto[t],
              valor_total: pricing.totalPaxBoleto[t],
              destaque: false,
            });
          }

          return {
            titulo: `Apto ${tipoLabels[t]} — por pessoa${tipoPax[t] > 1 ? ` (${tipoPax[t]} ocupantes)` : ''}`,
            valor_total: pricing.totalPaxAvista[t],
            // Destaca o apto que casa com a quantidade de adultos da
            // proposta; senão, DBL como referência mais comum.
            destaque: temPassageiros ? t === aptoAdulto : t === 'dbl',
            parcelas,
          };
        });

      // Adiciona CHD quando há crianças (na lista ou nos trechos legados)
      const hasChd = qtdChd > 0 || grupo.trechos.some(t => t.qtd_chd > 0);
      if (hasChd && (pricing.totalPaxAvista['chd'] || 0) > 0) {
        const chdParcelas: Array<{ forma: string; valor_parcela: number; valor_total: number; destaque: boolean }> = [{
          forma: 'À vista (PIX)',
          valor_parcela: pricing.totalPaxAvista['chd'],
          valor_total: pricing.totalPaxAvista['chd'],
          destaque: true,
        }];
        if (p.parcelas > 0 && pricing.totalPaxCartao['chd'] > 0) {
          chdParcelas.push({
            forma: `${p.parcelas}x Cartão`,
            valor_parcela: pricing.parcelaPaxCC['chd'],
            valor_total: pricing.totalPaxCartao['chd'],
            destaque: false,
          });
        }
        opcoes.push({
          titulo: 'Criança — por pessoa',
          valor_total: pricing.totalPaxAvista['chd'],
          destaque: false,
          parcelas: chdParcelas,
        });
      }

      // Detalhamento por pessoa: total real da proposta considerando os
      // passageiros cadastrados. Esse é o card destaque que o cliente vê.
      let detalhamentoPax: Record<string, unknown> | undefined;
      if (temPassageiros) {
        const precoAdt = pricing.totalPaxAvista[aptoAdulto] || 0;
        const precoChd = pricing.totalPaxAvista['chd'] || 0;
        const totalGeral = qtdAdt * precoAdt + qtdChd * precoChd;
        const parcelaAdt = p.parcelas > 1 ? (pricing.parcelaPaxCC[aptoAdulto] || 0) : 0;
        const parcelaChd = p.parcelas > 1 ? (pricing.parcelaPaxCC['chd'] || 0) : 0;
        const totalParcela = qtdAdt * parcelaAdt + qtdChd * parcelaChd;

        detalhamentoPax = {
          qtd_adt: qtdAdt,
          qtd_chd: qtdChd,
          idades_chd: passageirosLista.filter(pp => pp.tipo === 'CHD').map(pp => pp.idade ?? 0),
          preco_adt: precoAdt,
          preco_chd: precoChd,
          apto_adulto: aptoAdulto,
          apto_adulto_label: tipoLabels[aptoAdulto],
          total_geral: totalGeral,
          parcelas: p.parcelas > 1 ? p.parcelas : 0,
          parcela_adt: parcelaAdt,
          parcela_chd: parcelaChd,
          total_parcela: totalParcela,
        };
      }

      // Quebra do custo como linha informativa (rodapé sutil)
      const breakdown = pricing.lines
        .filter(l => l.dbl > 0 || l.sgl > 0)
        .map(l => `${l.label}: ${fmtBRL(l.dbl || l.sgl)}`)
        .join(' · ');

      secoes.push({
        id: generateId(), tipo: 'VALORES', ordem: ordem++, visivel: true,
        conteudo: {
          opcoes: opcoes.length > 0 ? opcoes : [{
            titulo: 'Pacote Completo',
            valor_total: 0,
            destaque: true,
            parcelas: [{ forma: 'À vista PIX', valor_parcela: 0, valor_total: 0, destaque: true }],
          }],
          detalhamento_pax: detalhamentoPax,
          observacoes_valores: breakdown || '',
          validade: '',
        },
      });
    }

    // 14. CTA
    secoes.push({
      id: generateId(), tipo: 'CTA', ordem: ordem++, visivel: true,
      conteudo: {
        texto_botao: 'Quero reservar!',
        numero_whatsapp: '',
        mensagem_predefinida: `Olá! Tenho interesse na viagem para ${destino}.`,
      },
    });

    // --- Build proposta ---
    const proposta = {
      id, numero: num, versao: 1, versao_anterior_id: null,
      cliente_id: '', cliente_nome: '', vendedor_id: '', vendedor_nome: '',
      template_id: template_id || '', grupo_id,
      idioma: 'pt-BR',
      visual: templateVisual ? { ...templateVisual } : {
        tema: 'luxo', layout: 'DISCOVERY',
        cor_primaria: '#d4a853', cor_secundaria: '#1a1a1a', cor_texto: '#e5e5e5',
        cor_fundo: '#0a0a0a', fonte: 'Inter', imagem_capa: '', estilo_capa: 'MINIMAL',
      },
      viagem,
      cabecalho: (() => {
        const passageirosCount = grupo.passageiros?.length || 0;
        const qtdAdt = grupo.passageiros?.filter(pp => pp.tipo === 'ADT').length || 0;
        const qtdChd = grupo.passageiros?.filter(pp => pp.tipo === 'CHD').length || 0;
        const paxLabel = passageirosCount > 0
          ? `${qtdAdt} adulto${qtdAdt !== 1 ? 's' : ''}${qtdChd > 0 ? ` + ${qtdChd} criança${qtdChd !== 1 ? 's' : ''}` : ''}`
          : '';
        const datasLabel = dataInicio && dataFim
          ? `${fmtDate(dataInicio)} a ${fmtDate(dataFim)}`
          : '';
        const partes = [datasLabel, totalNoites > 0 ? `${totalNoites} noite${totalNoites !== 1 ? 's' : ''}` : '', paxLabel]
          .filter(Boolean)
          .join(' · ');

        return {
          titulo: destino ? `${destino}` : 'Sua próxima viagem',
          subtitulo: partes,
          mensagem_abertura: 'Preparamos esta proposta com cuidado, considerando cada detalhe da sua viagem. Os valores e itens descritos refletem fielmente o que combinamos.',
          data_proposta: new Date().toISOString().split('T')[0],
          validade: '',
        };
      })(),
      secoes,
      rodape: { mensagem: '', nome_vendedor: '', telefone_vendedor: '', whatsapp_vendedor: '', email_vendedor: '' },
      status: 'RASCUNHO',
      link_publico: '',
      envios: [], venda_id: null, data_conversao: null,
      aceite: null, feedbacks: [], visualizacoes: [], leads: [],
      criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
    };

    await pool.query(
      `INSERT INTO propostas (id, tenant_id, numero, cliente_id, vendedor_id, status, data) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, tenantId, num, '', '', 'RASCUNHO', JSON.stringify(proposta)]
    );

    // Link proposta back to grupo and advance pipeline
    const updatedGrupo = { ...grupo, proposta_id: id, status_pipeline: 'PROPOSTA' };
    await pool.query(
      `UPDATE grupos SET data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify(updatedGrupo), grupo_id, tenantId]
    );

    // CRM: notify that a proposta was generated for this product so the
    // CRM can attach the visual document to the contact/deal. SEM efeito
    // financeiro — apenas referência ao link e número.
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    const host = req.headers.get('host') || 'fin.enturos.com';
    const baseUrl = `${proto}://${host}`;
    const valorTotalRef = (pricing.totalAvista['dbl'] || pricing.totalAvista['sgl'] || 0);
    emitirEventoCRM('PROPOSTA_GERADA', {
      grupo_id,
      proposta_id: id,
      numero: num,
      titulo: `Viagem — ${destino}`,
      link_publico: `${baseUrl}/p/${id.slice(0, 8)}`,
      link_editor:  `${baseUrl}/propostas/${id}`,
      valor_total_referencia: valorTotalRef,
      moeda: 'BRL',
      data_inicio: dataInicio,
      data_fim: dataFim,
      template_id: template_id || null,
      status: 'PROPOSTA',
    }, { tenantId });

    return NextResponse.json({ id, numero: num });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

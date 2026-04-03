import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId } from '@/lib/utils';

export async function POST(req: Request) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB not initialized' }, { status: 500 });

    const { grupo_id } = await req.json();
    if (!grupo_id) return NextResponse.json({ error: 'grupo_id obrigatorio' }, { status: 400 });

    // Fetch grupo
    const { rows: grupoRows } = await pool.query(`SELECT data FROM grupos WHERE id = $1`, [grupo_id]);
    if (grupoRows.length === 0) return NextResponse.json({ error: 'Grupo nao encontrado' }, { status: 404 });
    const grupo = grupoRows[0].data;

    // Count existing propostas for numbering
    const { rows: countRows } = await pool.query(`SELECT COUNT(*) as c FROM propostas`);
    const num = `PROP-${String(parseInt(countRows[0].c) + 1).padStart(4, '0')}`;

    // Build proposta from grupo data
    const id = generateId();
    const destino = grupo.origem_destino || '';
    const periodos = grupo.periodos || [];
    const dataInicio = periodos[0]?.check_in || '';
    const dataFim = periodos[periodos.length - 1]?.check_out || '';

    // Build servico blocks from grupo services
    const secoes: Array<{ id: string; tipo: string; ordem: number; visivel: boolean; conteudo: Record<string, unknown> }> = [];
    let ordem = 0;

    // Intro text
    secoes.push({
      id: generateId(), tipo: 'TEXTO', ordem: ordem++, visivel: true,
      conteudo: { titulo: `Viagem — ${destino}`, corpo: '', alinhamento: 'center' },
    });

    // Flight services
    const tktTrechos = grupo.tkt?.trechos || [];
    if (tktTrechos.length > 0) {
      for (const t of tktTrechos) {
        secoes.push({
          id: generateId(), tipo: 'SERVICO', ordem: ordem++, visivel: true,
          conteudo: {
            icone: '✈️',
            titulo: `${t.origem || ''} → ${t.destino || ''}`,
            descricao: `${t.cia || ''} ${t.voo || ''} — ${t.data ? new Date(t.data + 'T12:00:00').toLocaleDateString('pt-BR') : ''}`,
            detalhes: [],
            imagem: '',
            valor: 0,
            exibir_valor: false,
          },
        });
      }
    }

    // Hotel services
    const hoteis = grupo.htl?.hoteis || [];
    for (const h of hoteis) {
      const periodo = periodos.find((p: { destino: string }) => p.destino === h.destino);
      secoes.push({
        id: generateId(), tipo: 'SERVICO', ordem: ordem++, visivel: true,
        conteudo: {
          icone: '🏨',
          titulo: h.nome || 'Hotel',
          descricao: `${h.destino || ''} — ${h.categoria || ''}\n${periodo?.check_in ? new Date(periodo.check_in + 'T12:00:00').toLocaleDateString('pt-BR') : ''} a ${periodo?.check_out ? new Date(periodo.check_out + 'T12:00:00').toLocaleDateString('pt-BR') : ''}`,
          detalhes: [],
          imagem: '',
          valor: 0,
          exibir_valor: false,
        },
      });
    }

    // Roteiro from periodos
    if (periodos.length > 0) {
      const dias = periodos.map((p: { destino: string; check_in: string; check_out: string; hotel: string }, i: number) => ({
        numero: i + 1,
        titulo: `${p.destino}${p.hotel ? ` — ${p.hotel}` : ''}`,
        descricao: `${p.check_in ? new Date(p.check_in + 'T12:00:00').toLocaleDateString('pt-BR') : ''} a ${p.check_out ? new Date(p.check_out + 'T12:00:00').toLocaleDateString('pt-BR') : ''}`,
        imagem: '',
        atividades: [],
        refeicoes_inclusas: '',
      }));
      secoes.push({
        id: generateId(), tipo: 'ROTEIRO_DIA', ordem: ordem++, visivel: true,
        conteudo: { dias },
      });
    }

    // Inclusos/Nao inclusos
    secoes.push({
      id: generateId(), tipo: 'INCLUSOS', ordem: ordem++, visivel: true,
      conteudo: {
        inclusos: [
          tktTrechos.length > 0 ? 'Passagem aerea' : '',
          hoteis.length > 0 ? 'Hospedagem' : '',
          'Transfer aeroporto/hotel',
          'Seguro viagem',
        ].filter(Boolean),
        nao_inclusos: ['Refeicoes nao mencionadas', 'Passeios opcionais', 'Gorjetas'],
      },
    });

    // Valores
    secoes.push({
      id: generateId(), tipo: 'VALORES', ordem: ordem++, visivel: true,
      conteudo: {
        opcoes: [{
          titulo: 'Pacote Completo',
          valor_total: 0,
          destaque: true,
          parcelas: [{ forma: 'A vista PIX', valor_parcela: 0, valor_total: 0, destaque: true }],
        }],
        observacoes_valores: '',
        validade: '',
      },
    });

    // CTA
    secoes.push({
      id: generateId(), tipo: 'CTA', ordem: ordem++, visivel: true,
      conteudo: {
        texto_botao: 'Quero reservar!',
        numero_whatsapp: '',
        mensagem_predefinida: `Ola! Tenho interesse na viagem para ${destino}.`,
      },
    });

    const proposta = {
      id, numero: num, versao: 1, versao_anterior_id: null,
      cliente_id: '', cliente_nome: '', vendedor_id: '', vendedor_nome: '',
      template_id: '', grupo_id,
      visual: {
        tema: 'padrao', cor_primaria: '#004aad', cor_secundaria: '#0a0a14', cor_texto: '#1a1a2e',
        cor_fundo: '#ffffff', fonte: 'Inter', imagem_capa: '', estilo_capa: 'FULLSCREEN',
      },
      cabecalho: {
        titulo: `Proposta de Viagem — ${destino}`,
        subtitulo: dataInicio && dataFim
          ? `${new Date(dataInicio + 'T12:00:00').toLocaleDateString('pt-BR')} a ${new Date(dataFim + 'T12:00:00').toLocaleDateString('pt-BR')}`
          : '',
        mensagem_abertura: '',
        data_proposta: new Date().toISOString().split('T')[0],
        validade: '',
      },
      secoes,
      rodape: { mensagem: '', nome_vendedor: '', telefone_vendedor: '', whatsapp_vendedor: '', email_vendedor: '' },
      status: 'RASCUNHO',
      link_publico: '',
      envios: [], venda_id: null, data_conversao: null,
      aceite: null, feedbacks: [],
      criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
    };

    await pool.query(
      `INSERT INTO propostas (id, numero, cliente_id, vendedor_id, status, data) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, num, '', '', 'RASCUNHO', JSON.stringify(proposta)]
    );

    return NextResponse.json({ id, numero: num });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

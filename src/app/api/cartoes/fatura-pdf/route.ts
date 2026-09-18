import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { podeEditarFinanceiro } from '@/lib/permissoes';
import { conciliarFatura, resumirImportacao, type ItemDaFatura } from '@/lib/cartao-lancamentos';

/**
 * Lê a fatura do cartão em PDF e devolve os lançamentos reconhecidos.
 *
 * NÃO grava nada. A resposta é uma PRÉVIA que a tela mostra para a pessoa
 * conferir antes de lançar. Escrever dívida direto da saída de um modelo,
 * sem ninguém olhar, é o tipo de automação que ninguém consegue auditar
 * depois.
 *
 * O PDF vai inteiro para o Claude como documento: ele lê PDF nativamente,
 * então não há extração de texto no meio para perder coluna de tabela.
 */

const MAX_PDF = 12 * 1024 * 1024;
const MODELO_PADRAO = 'claude-sonnet-4-5-20250929';
const TIMEOUT_MS = 120000;

const INSTRUCAO = `Você recebe a fatura de um cartão de crédito brasileiro em PDF.

Extraia TODOS os lançamentos de compra. Devolva SOMENTE um JSON válido, sem
texto antes ou depois, no formato:

{"lancamentos":[{"descricao":"...","valor":0.00,"data":"AAAA-MM-DD","parcela_numero":1,"total_parcelas":1}]}

Regras:
- "valor" é o valor DAQUELA parcela como aparece na fatura, em reais, ponto
  como separador decimal. Nunca o valor total da compra.
- Quando a linha indicar parcela (por exemplo "PARC 03/12", "03/12",
  "3 de 12"), preencha parcela_numero e total_parcelas. Sem indicação, use
  1 e 1.
- "data" é a data da compra que aparece na linha. Se a fatura só mostrar
  dia e mês, use o ano da fatura. Se não houver data na linha, use a data
  de fechamento da fatura.
- NÃO inclua: pagamento de fatura anterior, estorno, crédito, juros,
  encargos, anuidade, IOF, saldo anterior, ajustes. Só compras.
- Valor negativo é crédito ou estorno: NÃO inclua.
- Não invente lançamento. Se não conseguir ler um valor com certeza, omita
  a linha em vez de chutar.`;

export async function POST(req: Request) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });

    const session = await getSession();
    if (!podeEditarFinanceiro(session ?? {})) {
      return NextResponse.json({ error: 'Sem permissao' }, { status: 403 });
    }
    const tenantId = await getTenantId();

    const form = await req.formData();
    const arquivo = form.get('file');
    const cartaoId = String(form.get('cartao_id') ?? '');
    if (!cartaoId) return NextResponse.json({ error: 'Escolha o cartão.' }, { status: 400 });
    if (!(arquivo instanceof File) || arquivo.size === 0) {
      return NextResponse.json({ error: 'Envie o PDF da fatura.' }, { status: 400 });
    }
    if (arquivo.type !== 'application/pdf') {
      return NextResponse.json({ error: 'O arquivo precisa ser um PDF.' }, { status: 400 });
    }
    if (arquivo.size > MAX_PDF) {
      return NextResponse.json({ error: 'A fatura tem mais de 12MB.' }, { status: 400 });
    }

    // A chave da IA é a mesma configurada em Configurações, Integração com IA.
    const { rows } = await pool.query(
      `SELECT data FROM config_apis WHERE tenant_id = $1 LIMIT 1`, [tenantId],
    );
    const cfg = (rows[0]?.data ?? {}) as Record<string, { api_key?: string; modelo?: string; ativo?: boolean }>;
    const ia = cfg.anthropic;
    if (!ia?.ativo || !ia?.api_key) {
      return NextResponse.json(
        { error: 'A leitura por IA precisa da chave da Anthropic, em Configurações, Integração com IA.' },
        { status: 400 },
      );
    }

    const base64 = Buffer.from(await arquivo.arrayBuffer()).toString('base64');

    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), TIMEOUT_MS);
    let bruto = '';
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': ia.api_key,
          'anthropic-version': '2023-06-01',
        },
        signal: controle.signal,
        body: JSON.stringify({
          model: ia.modelo || MODELO_PADRAO,
          max_tokens: 8000,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
              { type: 'text', text: INSTRUCAO },
            ],
          }],
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        return NextResponse.json(
          { error: `A leitura da fatura falhou (${res.status}). ${txt.slice(0, 200)}` },
          { status: 502 },
        );
      }
      const corpo = await res.json();
      bruto = String(corpo?.content?.[0]?.text ?? '');
    } catch (e) {
      const abortou = e instanceof Error && e.name === 'AbortError';
      return NextResponse.json(
        { error: abortou ? 'A leitura demorou demais. Tente uma fatura menor.' : 'Não foi possível falar com a IA.' },
        { status: 504 },
      );
    } finally {
      clearTimeout(timer);
    }

    // O modelo às vezes embrulha o JSON em cerca de código. Recortar é mais
    // honesto do que pedir "sem markdown" e torcer.
    const inicio = bruto.indexOf('{');
    const fim = bruto.lastIndexOf('}');
    let itens: ItemDaFatura[] = [];
    try {
      const json = JSON.parse(bruto.slice(inicio, fim + 1));
      itens = (Array.isArray(json?.lancamentos) ? json.lancamentos : [])
        .map((l: Record<string, unknown>) => ({
          descricao: String(l.descricao ?? '').slice(0, 200),
          valor: Number(l.valor) || 0,
          data: String(l.data ?? '').slice(0, 10),
          parcela_numero: Number(l.parcela_numero) || 1,
          total_parcelas: Number(l.total_parcelas) || 1,
        }))
        // Valor zero ou negativo não é compra: é estorno, crédito ou erro
        // de leitura. Nos três casos, não vira dívida.
        .filter((l: ItemDaFatura) => l.valor > 0 && /^\d{4}-\d{2}-\d{2}$/.test(l.data));
    } catch {
      return NextResponse.json(
        { error: 'A IA respondeu num formato que não deu para ler. Tente de novo ou lance à mão.' },
        { status: 502 },
      );
    }

    // O que já existe no sistema para este cartão, para não lançar de novo.
    const { rows: existentesRows } = await pool.query(
      `SELECT id, data->>'compra_id' AS compra_id
         FROM contas_pagar
        WHERE tenant_id = $1 AND data->>'cartao_id' = $2
          AND COALESCE(data->>'status', '') <> 'CANCELADO'`,
      [tenantId, cartaoId],
    );
    const idsExistentes = existentesRows.map(r => String(r.id));
    const comprasConhecidas = existentesRows
      .map(r => String(r.compra_id ?? ''))
      .filter(Boolean);

    const conciliados = conciliarFatura(itens, cartaoId, idsExistentes, comprasConhecidas);

    return NextResponse.json({
      itens: conciliados,
      resumo: resumirImportacao(conciliados),
      // Dito em voz alta: nada foi gravado ainda.
      gravado: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

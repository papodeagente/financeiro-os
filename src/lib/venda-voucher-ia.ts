/**
 * "Lançar pelo voucher" (E7, fechamento): a chamada à IA.
 *
 * O mesmo caminho do "Ler boleto ou nota" e da conferência do extrato da
 * operadora: a chave é a da agência (Configurações, Integração com IA), o
 * modelo é o atual, o PDF vai inteiro como documento, a foto como imagem e o
 * e-mail colado como texto. Uma chamada por documento; quem guarda a leitura
 * para não pagar duas vezes é a rota, pelo hash.
 *
 * `fetcher` é parâmetro para os testes trocarem a IA por um falso, sem rede.
 */
import { MODELO_PADRAO_LEITURA, type MimeLegivel, type RespostaDaIa } from './leitura-documento-ia';
import { INSTRUCAO_VOUCHER } from './venda-voucher';

export { MODELO_PADRAO_LEITURA };
const TIMEOUT_MS = 150_000;

export type VoucherParaLer =
  | { tipo: 'arquivo'; mime: MimeLegivel; base64: string }
  | { tipo: 'texto'; texto: string };

export async function lerVoucherComIa(args: {
  apiKey: string;
  modelo: string;
  conteudo: VoucherParaLer;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<RespostaDaIa> {
  const fetcher = args.fetcher ?? fetch;
  const c = args.conteudo;
  const bloco = c.tipo === 'arquivo'
    ? (c.mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: c.base64 } }
      : { type: 'image', source: { type: 'base64', media_type: c.mime, data: c.base64 } })
    : { type: 'text', text: `E-mail da operadora, colado pela agência:\n<documento>\n${c.texto}\n</documento>` };

  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), args.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': args.apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: controle.signal,
      body: JSON.stringify({
        model: args.modelo,
        max_tokens: 32000,
        messages: [{ role: 'user', content: [bloco, { type: 'text', text: INSTRUCAO_VOUCHER }] }],
      }),
    });
    if (!res.ok) {
      // A mensagem do provedor pode trazer detalhe da conta; a tela recebe a frase nossa.
      const chaveRecusada = res.status === 401 || res.status === 403;
      return {
        ok: false,
        status: 502,
        erro: chaveRecusada
          ? 'A chave de IA da agência foi recusada. Confira em Configurações, Integração com IA.'
          : `A leitura não deu certo agora (código ${res.status}). Tente de novo em instantes ou lance à mão.`,
      };
    }
    const corpo = await res.json() as { content?: Array<{ type?: string; text?: string }>; stop_reason?: string; model?: string };
    if (corpo.stop_reason === 'refusal') return { ok: false, status: 422, erro: 'A IA não leu este documento. Lance a venda à mão.' };
    if (corpo.stop_reason === 'max_tokens') {
      return { ok: false, status: 422, erro: 'O documento é grande demais para uma leitura. Envie só o voucher desta venda.' };
    }
    // Com raciocínio ligado, o primeiro bloco pode não ser o texto.
    const texto = (corpo.content ?? [])
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('\n');
    if (!texto.trim()) return { ok: false, status: 502, erro: 'A IA não devolveu nada legível. Tente de novo ou lance à mão.' };
    return { ok: true, texto, modelo: String(corpo.model ?? args.modelo) };
  } catch (e) {
    const abortou = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      status: 504,
      erro: abortou
        ? 'A leitura demorou demais. Envie um arquivo menor ou lance à mão.'
        : 'Não foi possível falar com a IA agora. Tente de novo ou lance à mão.',
    };
  } finally {
    clearTimeout(timer);
  }
}

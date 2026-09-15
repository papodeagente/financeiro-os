/**
 * Cofre de segredos por tenant.
 *
 * Chave de API de plataforma de pagamento move dinheiro: com ela dá para
 * consultar vendas, e em alguns casos estornar. Guardar em texto puro num
 * JSONB, como `config_apis` faz hoje, significa que um dump do banco vira
 * acesso à conta de pagamento de todas as agências.
 *
 * Cifra simétrica AES-256-GCM, que além de cifrar AUTENTICA: mexer no
 * texto cifrado quebra a decifra em vez de devolver lixo silencioso.
 *
 * A chave mestra vive em variável de ambiente, nunca no banco. Perder a
 * variável significa refazer as conexões: isso é consequência conhecida e
 * está no runbook, não é surpresa.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/** Envelope gravado no banco. `v` existe para trocar de algoritmo um dia
 *  sem precisar adivinhar como o registro antigo foi escrito. */
export interface Envelope {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
}

const ALGORITMO = 'aes-256-gcm';
const NOME_VAR = 'INTEGRACOES_MASTER_KEY';

export class ErroCofre extends Error {}

/**
 * Chave de 32 bytes derivada da variável de ambiente.
 *
 * Aceita hex de 64 caracteres (o formato recomendado) e, para não travar
 * quem colou uma frase, deriva por SHA-256. Frase curta continua sendo
 * recusada: derivar de "123" daria uma chave válida e uma falsa sensação
 * de segurança.
 */
function chaveMestra(): Buffer {
  const bruta = (process.env[NOME_VAR] ?? '').trim();
  if (!bruta) {
    throw new ErroCofre(
      `A variável ${NOME_VAR} não está definida. Sem ela o sistema não guarda credencial de plataforma.`,
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(bruta)) return Buffer.from(bruta, 'hex');
  if (bruta.length < 32) {
    throw new ErroCofre(
      `A variável ${NOME_VAR} é curta demais. Use 64 caracteres hexadecimais, por exemplo o resultado de: openssl rand -hex 32`,
    );
  }
  return createHash('sha256').update(bruta).digest();
}

/** O cofre está utilizável? A tela usa para avisar antes de o usuário
 *  digitar uma chave e receber erro só no salvar. */
export function cofreDisponivel(): boolean {
  try {
    chaveMestra();
    return true;
  } catch {
    return false;
  }
}

export function cifrar(texto: string): Envelope {
  const chave = chaveMestra();
  // 12 bytes é o IV recomendado para GCM. Novo a cada gravação: reusar IV
  // com a mesma chave quebra a cifra, não só enfraquece.
  const iv = randomBytes(12);
  const c = createCipheriv(ALGORITMO, chave, iv);
  const ct = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
}

export function decifrar(envelope: unknown): string {
  const e = envelope as Partial<Envelope> | null;
  // Checa PRESENÇA, não verdade: segredo vazio produz `ct` vazio, que é um
  // envelope legítimo. Testar por falsidade recusava o próprio envelope
  // que esta função acabou de gerar.
  const campoOk = (v: unknown) => typeof v === 'string';
  if (!e || typeof e !== 'object' || e.v !== 1
      || !campoOk(e.iv) || !campoOk(e.tag) || !campoOk(e.ct)
      || !e.iv || !e.tag) {
    throw new ErroCofre('Envelope inválido ou gravado por outra versão.');
  }
  const chave = chaveMestra();
  const d = createDecipheriv(ALGORITMO, chave, Buffer.from(e.iv, 'base64'));
  d.setAuthTag(Buffer.from(e.tag, 'base64'));
  try {
    return Buffer.concat([d.update(Buffer.from(e.ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    // Acontece quando a chave mestra mudou ou o registro foi adulterado.
    // Os dois casos precisam de ação humana, então a mensagem diz isso.
    throw new ErroCofre(
      'Não foi possível decifrar a credencial. A chave mestra mudou, ou o registro foi alterado. Cadastre a credencial de novo.',
    );
  }
}

/**
 * Máscara para exibir na tela. NUNCA devolver o segredo ao navegador: a
 * tela só precisa provar que existe algo gravado.
 */
export function mascarar(segredo: string): string {
  const s = (segredo ?? '').trim();
  if (!s) return '';
  if (s.length <= 8) return '•'.repeat(s.length);
  return `${s.slice(0, 4)}${'•'.repeat(Math.min(12, s.length - 8))}${s.slice(-4)}`;
}

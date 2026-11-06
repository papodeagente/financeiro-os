/**
 * Conferência local do certificado e da chave que a agência enviou, antes de
 * qualquer chamada ao banco. É aqui que se pegam os três erros que mais geram
 * suporte: o ZIP enviado inteiro, os dois arquivos trocados e o certificado
 * vencido. Usa só o `crypto` do Node (nada a instalar).
 *
 * Nunca devolve nem registra o conteúdo dos arquivos: só a validade e o
 * motivo da recusa, em frase pronta.
 */
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { horaDeBrasilia } from '../agendador/nucleo';
import { FalhaColeta } from './contrato';

export interface MaterialConferido {
  /** Validade do certificado, 'YYYY-MM-DD' (data de Brasília). */
  expiraEm: string;
  /** Impressão digital SHA-256, para a tela mostrar qual certificado está gravado. */
  impressaoDigital: string;
}

/** 'YYYY-MM-DD' → 'DD/MM/AAAA'. */
export function dataBR(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

function pareceCompactado(texto: string): boolean {
  // ZIP começa com "PK\x03\x04"; lido como texto no navegador, sobra "PK" e
  // caracteres de controle. Arquivo PEM é texto puro.
  return texto.startsWith('PK') || /[\u0000-\u0008\u000e-\u001f]/.test(texto.slice(0, 200));
}

const temCertificado = (t: string) => /-----BEGIN CERTIFICATE-----/.test(t);
const temChave = (t: string) => /-----BEGIN (RSA |EC |ENCRYPTED )?PRIVATE KEY-----/.test(t);

/**
 * Confere o par certificado + chave. Lança FalhaColeta com a frase para a
 * agência; devolve a validade quando está tudo certo.
 */
export function conferirCertificadoEChave(
  certificadoPem: string | null, chavePrivadaPem: string | null, hoje: string,
  nomeDoBanco: string,
): MaterialConferido {
  const cert = String(certificadoPem ?? '').trim();
  const chave = String(chavePrivadaPem ?? '').trim();
  if (!cert) throw new FalhaColeta('CERTIFICADO_INVALIDO', 'Envie o arquivo do certificado (o que termina em .crt).');
  if (!chave) throw new FalhaColeta('CERTIFICADO_INVALIDO', 'Envie o arquivo da chave (o que termina em .key).');
  if (pareceCompactado(cert) || pareceCompactado(chave)) {
    throw new FalhaColeta('CERTIFICADO_INVALIDO', 'Envie os arquivos .crt e .key separados, não o arquivo compactado. Descompacte o ZIP baixado e escolha cada um no seu campo.');
  }
  if ((temChave(cert) && !temCertificado(cert)) || (temCertificado(chave) && !temChave(chave))) {
    throw new FalhaColeta('CERTIFICADO_INVALIDO', 'O certificado e a chave parecem trocados. Confira: o arquivo .crt vai no campo do certificado e o .key no campo da chave.');
  }
  if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(chave)) {
    throw new FalhaColeta('CERTIFICADO_INVALIDO', `A chave enviada tem senha. Use o arquivo .key exatamente como o ${nomeDoBanco} entregou.`);
  }
  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(cert);
  } catch {
    throw new FalhaColeta('CERTIFICADO_INVALIDO', `O arquivo do certificado não foi reconhecido. Envie o arquivo .crt baixado no ${nomeDoBanco}.`);
  }
  let chaveObj: ReturnType<typeof createPrivateKey>;
  try {
    chaveObj = createPrivateKey(chave);
  } catch {
    throw new FalhaColeta('CERTIFICADO_INVALIDO', `O arquivo da chave não foi reconhecido. Envie o arquivo .key baixado no ${nomeDoBanco}.`);
  }
  if (!x509.checkPrivateKey(chaveObj)) {
    throw new FalhaColeta('CERTIFICADO_INVALIDO', 'O certificado e a chave são de integrações diferentes. Baixe os dois arquivos da mesma integração.');
  }
  const fim = new Date(x509.validTo);
  if (Number.isNaN(fim.getTime())) {
    throw new FalhaColeta('CERTIFICADO_INVALIDO', `Não deu para ler a validade do certificado. Envie o arquivo .crt baixado no ${nomeDoBanco}.`);
  }
  const expiraEm = horaDeBrasilia(fim).data;
  if (expiraEm < hoje) {
    throw new FalhaColeta('CERTIFICADO_EXPIRADO', `Este certificado venceu em ${dataBR(expiraEm)}. Renove a integração no ${nomeDoBanco} e envie os arquivos novos.`);
  }
  return { expiraEm, impressaoDigital: x509.fingerprint256 };
}

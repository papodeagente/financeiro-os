/**
 * Certificado e chave em PEM para os testes do extrato automático, no formato
 * dos arquivos .crt e .key que o banco entrega na integração. Gerados na
 * hora: nenhum certificado real entra no repositório.
 */
import forge from 'node-forge';

const { pki } = forge;

export interface ParDeTeste {
  certificadoPem: string;
  chavePrivadaPem: string;
}

export function gerarParPemDeTeste(o: { inicio?: Date; dias?: number; cn?: string } = {}): ParDeTeste {
  // 1024 bits só para o teste rodar rápido; nada disto sai do processo.
  const chaves = pki.rsa.generateKeyPair(1024);
  const cert = pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = String(Math.floor(Math.random() * 1e9) + 1).padStart(2, '0');
  const inicio = o.inicio ?? new Date('2026-01-01T12:00:00Z');
  cert.validity.notBefore = inicio;
  cert.validity.notAfter = new Date(inicio.getTime() + (o.dias ?? 365) * 86_400_000);
  const nome = [{ name: 'commonName', value: o.cn ?? 'integracao-teste' }, { name: 'countryName', value: 'BR' }];
  cert.setSubject(nome);
  cert.setIssuer([{ name: 'commonName', value: 'AC TESTE BANCO' }, { name: 'countryName', value: 'BR' }]);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  return { certificadoPem: pki.certificateToPem(cert), chavePrivadaPem: pki.privateKeyToPem(chaves.privateKey) };
}

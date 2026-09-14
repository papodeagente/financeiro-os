/**
 * Gera um .pfx de teste com a cara de um e-CNPJ ICP-Brasil.
 *
 * Existe porque não dá para commitar um certificado real, e o parser precisa
 * ser testado contra a estrutura exata que a ICP-Brasil usa: otherName no
 * subjectAltName com os OIDs 2.16.76.1.3.x e CN "RAZAO SOCIAL:CNPJ".
 */
import forge from 'node-forge';

const { asn1, pki } = forge;

function otherName(oid: string, texto: string): forge.asn1.Asn1 {
  return asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oid).getBytes()),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, forge.util.encodeUtf8(texto)),
    ]),
  ]);
}

export interface OpcoesPfx {
  cnpj?: string;
  razao_social?: string;
  senha?: string;
  /** Anos de validade a partir de `inicio`. Negativo gera certificado vencido. */
  anos?: number;
  inicio?: Date;
  responsavel_nome?: string;
  responsavel_cpf?: string;
  /** Sem os OIDs da ICP-Brasil (só o CN), para testar a segunda fonte. */
  semOids?: boolean;
  /** Certificado de pessoa física: sem CNPJ em lugar nenhum. */
  pessoaFisica?: boolean;
}

export function gerarPfxDeTeste(o: OpcoesPfx = {}): { bytes: Uint8Array; senha: string } {
  const cnpj = o.cnpj ?? '12345678000199';
  const razao = o.razao_social ?? 'AGENCIA DE VIAGENS TESTE LTDA';
  const senha = o.senha ?? 'segredo123';
  const inicio = o.inicio ?? new Date('2026-01-01T00:00:00Z');
  const anos = o.anos ?? 1;
  const cpf = o.responsavel_cpf ?? '11122233344';

  // 1024 bits só para o teste rodar rápido; nada disto sai do processo.
  const chaves = pki.rsa.generateKeyPair(1024);
  const cert = pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = inicio;
  cert.validity.notAfter = new Date(inicio.getTime() + anos * 365 * 86_400_000);

  const cn = o.pessoaFisica ? 'FULANO DA SILVA:' + cpf : `${razao}:${cnpj}`;
  cert.setSubject([{ name: 'commonName', value: cn }, { name: 'countryName', value: 'BR' }]);
  cert.setIssuer([{ name: 'commonName', value: 'AC TESTE ICP-BRASIL' }, { name: 'countryName', value: 'BR' }]);

  const nomes: forge.asn1.Asn1[] = [];
  if (!o.semOids) {
    if (!o.pessoaFisica) nomes.push(otherName('2.16.76.1.3.3', cnpj));
    nomes.push(otherName('2.16.76.1.3.2', o.responsavel_nome ?? 'MARIA RESPONSAVEL'));
    // nascimento (8) + CPF (11) + NIS (11) + RG (15) + emissor/UF (6)
    nomes.push(otherName('2.16.76.1.3.4', '01011990' + cpf + '00000000000' + '000000000000000' + 'SSPSP '));
  }
  const san = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, nomes);

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { id: '2.5.29.17', critical: false, value: san } as unknown as forge.pki.CertificateExtension,
  ]);
  cert.sign(chaves.privateKey, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], senha, {
    algorithm: '3des',
    friendlyName: razao,
  });
  const der = asn1.toDer(p12).getBytes();
  const bytes = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) bytes[i] = der.charCodeAt(i);
  return { bytes, senha };
}

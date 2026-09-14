/**
 * Leitura do certificado digital A1 (e-CNPJ ICP-Brasil, arquivo .pfx/.p12).
 *
 * POR QUE LER O CERTIFICADO. Ele é o primeiro documento que a agência tem em
 * mãos e já carrega o CNPJ, a razão social, a validade e quem responde pela
 * empresa. Pedir isso digitado é pedir erro de digitação num dado que está a
 * um clique. Com o CNPJ do certificado o resto da configuração fiscal se
 * puxa sozinho (empresa no emissor, dados da Receita, município, CNAE).
 *
 * O QUE ELE NÃO TEM, e por isso continua vindo de outro lugar: endereço,
 * código IBGE, CNAE, inscrição municipal, enquadramento no Simples. Isso é da
 * Receita, não do certificado.
 *
 * NADA É GUARDADO. Esta função recebe bytes e senha, devolve texto e esquece.
 * O arquivo e a senha seguem só para o emissor, que é quem assina a nota.
 *
 * Os campos ICP-Brasil vivem no subjectAltName como otherName:
 *   2.16.76.1.3.3  CNPJ da pessoa jurídica (14 dígitos)
 *   2.16.76.1.3.2  nome do responsável pelo certificado
 *   2.16.76.1.3.4  dados do responsável: nascimento DDMMAAAA (8) + CPF (11)
 *                  + NIS/PIS (11) + RG (15) + órgão emissor e UF (6)
 * O CN do subject vem como "RAZAO SOCIAL:CNPJ" e serve de segunda fonte.
 */

import forge from 'node-forge';

export interface DadosDoCertificado {
  cnpj: string;
  razao_social: string;
  /** ISO YYYY-MM-DD. */
  validade_inicio: string;
  validade_fim: string;
  vencido: boolean;
  /** Dias até vencer. Negativo quando já venceu. */
  dias_para_vencer: number;
  responsavel_nome: string;
  responsavel_cpf: string;
  /** Autoridade certificadora que emitiu. */
  emissor: string;
  /** Impressão digital SHA-1 do certificado, para conferência. */
  impressao_digital: string;
}

/** Erro com texto pronto para quem está na tela. */
export class ErroCertificado extends Error {
  readonly motivo: 'senha' | 'formato' | 'sem_certificado' | 'sem_cnpj';
  constructor(motivo: ErroCertificado['motivo'], mensagem: string) {
    super(mensagem);
    this.name = 'ErroCertificado';
    this.motivo = motivo;
  }
}

const OID_CNPJ = '2.16.76.1.3.3';
const OID_RESPONSAVEL_NOME = '2.16.76.1.3.2';
const OID_RESPONSAVEL_DADOS = '2.16.76.1.3.4';

function digitos(v: string): string {
  return String(v ?? '').replace(/\D+/g, '');
}

function dataISO(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * Lê os otherName do subjectAltName como {oid: valor}.
 *
 * O node-forge não interpreta otherName: entrega os nós ASN.1 crus. A
 * estrutura é SEQUENCE { OID, [0] EXPLICIT valor }, e o valor na ICP-Brasil
 * vem como OCTET STRING ou PrintableString — nos dois casos, bytes de texto.
 */
function outrosNomes(cert: forge.pki.Certificate): Record<string, string> {
  const achados: Record<string, string> = {};
  const ext = cert.getExtension('subjectAltName') as
    | { altNames?: Array<{ type: number; value: unknown }> }
    | null
    | undefined;
  const altNames = ext?.altNames ?? [];
  for (const alt of altNames) {
    if (alt.type !== 0) continue;
    const nos = Array.isArray(alt.value) ? (alt.value as forge.asn1.Asn1[]) : [];
    if (nos.length < 2) continue;
    let oid = '';
    try {
      oid = forge.asn1.derToOid(String(nos[0].value));
    } catch {
      continue;
    }
    const valorNo = nos[1];
    const interno = Array.isArray(valorNo.value) ? (valorNo.value as forge.asn1.Asn1[])[0] : valorNo;
    const bruto = interno && typeof interno.value === 'string' ? interno.value : '';
    // Os bytes chegam como "binary string" do node-forge: cada char é um byte.
    achados[oid] = forge.util.decodeUtf8(bruto).trim();
  }
  return achados;
}

/** Entre os certificados do arquivo, o da empresa: o que não é CA e tem CNPJ. */
function escolherCertificado(certs: forge.pki.Certificate[]): forge.pki.Certificate | null {
  if (certs.length === 0) return null;
  const naoCA = certs.filter(c => {
    const bc = c.getExtension('basicConstraints') as { cA?: boolean } | null | undefined;
    return !bc?.cA;
  });
  const candidatos = naoCA.length > 0 ? naoCA : certs;
  const comCnpj = candidatos.find(c => Boolean(outrosNomes(c)[OID_CNPJ]));
  return comCnpj ?? candidatos[0];
}

/**
 * Abre o .pfx com a senha e devolve o que ele diz sobre a empresa.
 *
 * `hoje` existe para os testes não dependerem do relógio.
 */
export function lerCertificadoA1(
  arquivo: Uint8Array,
  senha: string,
  hoje: Date = new Date(),
): DadosDoCertificado {
  if (!arquivo || arquivo.byteLength === 0) {
    throw new ErroCertificado('formato', 'O arquivo do certificado está vazio.');
  }

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    // Bytes -> "binary string" (um char por byte), o formato interno do
    // node-forge. A codificação padrão do createBuffer já é a crua.
    const der = forge.util.createBuffer(
      Array.from(arquivo, b => String.fromCharCode(b)).join(''),
    );
    const asn1 = forge.asn1.fromDer(der);
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // O node-forge sinaliza senha errada pelo MAC ou pela decifra do PBE.
    if (/password|MAC|decrypt|Invalid PKCS#12 PFX/i.test(msg) && /password|MAC|decrypt/i.test(msg)) {
      throw new ErroCertificado(
        'senha',
        'A senha do certificado não confere. Ela é a mesma usada na instalação do certificado no computador.',
      );
    }
    throw new ErroCertificado(
      'formato',
      'Este arquivo não é um certificado A1 (.pfx ou .p12). Certificado A3, em token ou cartão, não pode ser enviado.',
    );
  }

  const sacolas = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certs = (sacolas[forge.pki.oids.certBag] ?? [])
    .map(b => b.cert)
    .filter((c): c is forge.pki.Certificate => Boolean(c));
  const cert = escolherCertificado(certs);
  if (!cert) {
    throw new ErroCertificado(
      'sem_certificado',
      'O arquivo abriu, mas não tem certificado dentro. Confira se é o .pfx exportado com a chave.',
    );
  }

  const outros = outrosNomes(cert);
  const cn = String(cert.subject.getField('CN')?.value ?? '');
  const [cnRazao, cnCnpj] = cn.includes(':') ? cn.split(':', 2) : [cn, ''];

  const cnpj = digitos(outros[OID_CNPJ] ?? '') || digitos(cnCnpj);
  if (cnpj.length !== 14) {
    throw new ErroCertificado(
      'sem_cnpj',
      'Este certificado não é de CNPJ (e-CNPJ). Certificado de pessoa física não emite nota da empresa.',
    );
  }

  const dadosResp = digitos(outros[OID_RESPONSAVEL_DADOS] ?? '');
  const responsavelCpf = dadosResp.length >= 19 ? dadosResp.slice(8, 19) : '';

  const fim = cert.validity.notAfter;
  const dias = Math.floor((fim.getTime() - hoje.getTime()) / 86_400_000);

  return {
    cnpj,
    razao_social: (cnRazao || '').trim(),
    validade_inicio: dataISO(cert.validity.notBefore),
    validade_fim: dataISO(fim),
    vencido: dias < 0,
    dias_para_vencer: dias,
    responsavel_nome: (outros[OID_RESPONSAVEL_NOME] ?? '').trim(),
    responsavel_cpf: responsavelCpf,
    emissor: String(cert.issuer.getField('CN')?.value ?? '').trim(),
    impressao_digital: forge.md.sha1
      .create()
      .update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes())
      .digest()
      .toHex()
      .toUpperCase()
      .replace(/(.{2})(?=.)/g, '$1:'),
  };
}

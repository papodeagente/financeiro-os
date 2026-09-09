/**
 * Transmissão da NFS-e para a prefeitura, através de um gateway.
 *
 * POR QUE UM GATEWAY. Cada município tem seu próprio jeito de receber a nota:
 * padrão ABRASF em versões diferentes, layouts próprios, webservices SOAP com
 * XML assinado. O gateway resolve isso: a agência sobe o certificado A1 uma
 * vez e o mesmo formato de chamada atende qualquer prefeitura.
 *
 * O CERTIFICADO NÃO FICA AQUI. O arquivo .pfx e a senha são repassados ao
 * gateway na hora do envio e o sistema guarda só a referência devolvida por
 * ele, mais os dados de validade para avisar do vencimento. Guardar uma cópia
 * do certificado seria criar um segundo lugar de onde ele pode vazar, sem
 * ganho nenhum: quem assina a nota é o gateway.
 */

import type {
  AmbienteFiscal,
  CertificadoDigital,
  ConfigFiscal,
  NotaFiscal,
  StatusNota,
} from './nfse-tipos';

export interface ResultadoTransmissao {
  status: StatusNota;
  /** Identificador da nota no gateway, para consultar e cancelar depois. */
  referencia: string;
  numero: string;
  codigo_verificacao: string;
  protocolo: string;
  link_pdf: string;
  link_xml: string;
  /** Texto pronto para mostrar ao usuário quando a prefeitura recusou. */
  erro: string;
}

export interface DadosEmitente {
  cnpj: string;
  inscricao_municipal: string;
  razao_social: string;
  nome_fantasia: string;
  endereco: {
    cep: string;
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    estado: string;
  };
  optante_simples_nacional: boolean;
  incentivador_cultural: boolean;
  regime_tributario: string;
}

export interface EmissorNFSe {
  readonly nome: string;
  /** Sobe o certificado A1 e devolve os metadados que o gateway reconheceu. */
  enviarCertificado(entrada: {
    arquivo: Uint8Array;
    nome_arquivo: string;
    senha: string;
    email: string;
  }): Promise<Omit<CertificadoDigital, 'id' | 'enviado_em' | 'enviado_por'>>;
  emitir(entrada: {
    nota: NotaFiscal;
    config: ConfigFiscal;
    emitente: DadosEmitente;
  }): Promise<ResultadoTransmissao>;
  consultar(referencia: string, config: ConfigFiscal): Promise<ResultadoTransmissao>;
  cancelar(referencia: string, motivo: string, config: ConfigFiscal): Promise<ResultadoTransmissao>;
}

/** Erro que já vem com texto para o usuário final. */
export class ErroFiscal extends Error {
  readonly detalhe: string;
  constructor(mensagem: string, detalhe = '') {
    super(mensagem);
    this.name = 'ErroFiscal';
    this.detalhe = detalhe;
  }
}

const TIMEOUT_MS = 45_000;

function somenteDigitos(v: string): string {
  return String(v ?? '').replace(/\D+/g, '');
}

/**
 * Junta as mensagens de erro que o gateway devolve. Os formatos variam
 * (string, {message}, {error}, lista de {campo, mensagem}) e uma nota
 * rejeitada sem motivo legível é uma nota que ninguém consegue corrigir.
 */
export function textoDoErro(corpo: unknown): string {
  if (!corpo) return '';
  if (typeof corpo === 'string') return corpo.trim();
  if (Array.isArray(corpo)) {
    return corpo.map(textoDoErro).filter(Boolean).join(' · ');
  }
  if (typeof corpo === 'object') {
    const o = corpo as Record<string, unknown>;
    const direto = o.message ?? o.mensagem ?? o.error ?? o.erro ?? o.motivo;
    const partes: string[] = [];
    if (typeof direto === 'string' && direto.trim()) partes.push(direto.trim());
    for (const chave of ['errors', 'erros', 'validacao', 'details']) {
      if (o[chave]) {
        const t = textoDoErro(o[chave]);
        if (t && !partes.includes(t)) partes.push(t);
      }
    }
    if (partes.length > 0) return partes.join(' · ');
  }
  return '';
}

async function requisicao(
  url: string,
  init: RequestInit,
  token: string,
): Promise<{ ok: boolean; status: number; corpo: unknown }> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controle.signal,
      headers: { 'x-api-key': token, ...(init.headers ?? {}) },
    });
    const texto = await res.text();
    let corpo: unknown = texto;
    try {
      corpo = texto ? JSON.parse(texto) : null;
    } catch {
      corpo = texto;
    }
    return { ok: res.ok, status: res.status, corpo };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ErroFiscal(
        'O emissor de nota não respondeu a tempo. A nota pode ter sido enviada: consulte antes de emitir de novo.',
      );
    }
    throw new ErroFiscal(
      'Não foi possível falar com o emissor de nota.',
      e instanceof Error ? e.message : '',
    );
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// PlugNotas
// ============================================================

const PLUGNOTAS_URLS: Record<AmbienteFiscal, string> = {
  HOMOLOGACAO: 'https://api.sandbox.plugnotas.com.br',
  PRODUCAO: 'https://api.plugnotas.com.br',
};

function campo(o: unknown, ...caminhos: string[]): string {
  if (!o || typeof o !== 'object') return '';
  const alvo = o as Record<string, unknown>;
  for (const c of caminhos) {
    const v = c.split('.').reduce<unknown>(
      (acc, parte) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[parte] : undefined),
      alvo,
    );
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
}

/** Traduz o estado que o gateway usa para o estado do sistema. */
export function statusDoGateway(bruto: string): StatusNota {
  const s = String(bruto ?? '').toUpperCase();
  if (s.includes('CANCEL')) return 'CANCELADA';
  if (s.includes('REJEIT') || s.includes('ERRO') || s.includes('DENEG')) return 'REJEITADA';
  if (s.includes('CONCLUID') || s.includes('AUTORIZ') || s.includes('EMITID') || s === 'SUCESSO') {
    return 'AUTORIZADA';
  }
  return 'PROCESSANDO';
}

/** Data ISO (YYYY-MM-DD) a partir do que o gateway mandar. */
function dataISO(v: string): string {
  const t = String(v ?? '').trim();
  if (!t) return '';
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return '';
}

export class EmissorPlugNotas implements EmissorNFSe {
  readonly nome = 'PlugNotas';

  private base(config: ConfigFiscal): string {
    return PLUGNOTAS_URLS[config.ambiente] ?? PLUGNOTAS_URLS.HOMOLOGACAO;
  }

  private token(config: ConfigFiscal): string {
    const t = String(config.token ?? '').trim();
    if (!t) {
      throw new ErroFiscal('O token do emissor de nota não está configurado.');
    }
    return t;
  }

  async enviarCertificado(entrada: {
    arquivo: Uint8Array;
    nome_arquivo: string;
    senha: string;
    email: string;
    config?: ConfigFiscal;
  }): Promise<Omit<CertificadoDigital, 'id' | 'enviado_em' | 'enviado_por'>> {
    const config = entrada.config as ConfigFiscal;
    const form = new FormData();
    form.append(
      'arquivo',
      new Blob([new Uint8Array(entrada.arquivo)], { type: 'application/x-pkcs12' }),
      entrada.nome_arquivo || 'certificado.pfx',
    );
    form.append('senha', entrada.senha);
    if (entrada.email) form.append('email', entrada.email);

    const { ok, corpo } = await requisicao(
      `${this.base(config)}/certificado`,
      { method: 'POST', body: form },
      this.token(config),
    );
    if (!ok) {
      const detalhe = textoDoErro(corpo);
      throw new ErroFiscal(
        detalhe
          || 'O emissor recusou o certificado. Confira o arquivo e a senha.',
      );
    }
    return {
      referencia_gateway: campo(corpo, 'id', 'data.id', 'certificado.id'),
      nome_arquivo: entrada.nome_arquivo,
      cnpj: somenteDigitos(campo(corpo, 'cnpj', 'data.cnpj', 'documento')),
      titular: campo(corpo, 'nome', 'data.nome', 'razaoSocial', 'data.razaoSocial'),
      validade_inicio: dataISO(campo(corpo, 'dataInicio', 'data.dataInicio', 'validadeInicio')),
      validade_fim: dataISO(campo(corpo, 'vencimento', 'data.vencimento', 'dataVencimento', 'validade')),
    };
  }

  /** Corpo da NFS-e no formato do gateway. Exportado para poder ser testado. */
  montarPayload(entrada: {
    nota: NotaFiscal;
    config: ConfigFiscal;
    emitente: DadosEmitente;
  }): Record<string, unknown> {
    const { nota, config, emitente } = entrada;
    const corpo: Record<string, unknown> = {
      // idIntegracao é a trava anti-duplicata do lado do gateway: reenviar o
      // mesmo id não gera uma segunda nota.
      idIntegracao: nota.id,
      prestador: {
        cpfCnpj: somenteDigitos(emitente.cnpj),
        inscricaoMunicipal: somenteDigitos(emitente.inscricao_municipal),
      },
      tomador: {
        cpfCnpj: somenteDigitos(nota.tomador.cpf_cnpj),
        razaoSocial: nota.tomador.razao_social,
        email: nota.tomador.email || undefined,
        inscricaoMunicipal: somenteDigitos(nota.tomador.inscricao_municipal) || undefined,
        endereco: {
          cep: somenteDigitos(nota.tomador.endereco.cep) || undefined,
          logradouro: nota.tomador.endereco.logradouro || undefined,
          numero: nota.tomador.endereco.numero || undefined,
          complemento: nota.tomador.endereco.complemento || undefined,
          bairro: nota.tomador.endereco.bairro || undefined,
          codigoCidade: undefined,
          descricaoCidade: nota.tomador.endereco.cidade || undefined,
          estado: nota.tomador.endereco.estado || undefined,
        },
      },
      servico: [
        {
          codigo: config.codigo_tributacao_municipio || undefined,
          codigoTributacao: config.codigo_tributacao_municipio || undefined,
          discriminacao: nota.discriminacao,
          cnae: somenteDigitos(config.cnae) || undefined,
          iss: {
            aliquota: nota.aliquota_iss,
            tipoTributacao: undefined,
            exigibilidade: undefined,
            retido: nota.iss_retido,
          },
          valor: {
            servico: nota.valor_servicos,
            deducoes: nota.valor_deducoes || undefined,
            desconto: nota.desconto_incondicionado || undefined,
            baseCalculo: nota.base_calculo,
            issRetido: nota.iss_retido ? nota.valor_iss : undefined,
          },
          itemListaServico: config.item_lista_servico || undefined,
        },
      ],
      rps: { serie: config.serie_rps || undefined },
      naturezaOperacao: config.natureza_operacao || undefined,
      optanteSimplesNacional: emitente.optante_simples_nacional,
      incentivadorCultural: emitente.incentivador_cultural,
    };

    // Bloco do intermediário: só existe quando um terceiro intermediou a
    // operação. Mandar vazio faz a prefeitura recusar.
    if (nota.intermediario && somenteDigitos(nota.intermediario.cpf_cnpj)) {
      corpo.intermediario = {
        cpfCnpj: somenteDigitos(nota.intermediario.cpf_cnpj),
        razaoSocial: nota.intermediario.razao_social,
        inscricaoMunicipal: somenteDigitos(nota.intermediario.inscricao_municipal) || undefined,
      };
    }
    return corpo;
  }

  async emitir(entrada: {
    nota: NotaFiscal;
    config: ConfigFiscal;
    emitente: DadosEmitente;
  }): Promise<ResultadoTransmissao> {
    const payload = this.montarPayload(entrada);
    const { ok, corpo } = await requisicao(
      `${this.base(entrada.config)}/nfse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([payload]),
      },
      this.token(entrada.config),
    );
    if (!ok) {
      return {
        status: 'REJEITADA',
        referencia: entrada.nota.id,
        numero: '', codigo_verificacao: '', protocolo: '',
        link_pdf: '', link_xml: '',
        erro: textoDoErro(corpo) || 'O emissor recusou a nota.',
      };
    }
    return {
      status: 'PROCESSANDO',
      referencia: campo(corpo, 'protocolo', 'data.protocolo', 'documents.0.idIntegracao') || entrada.nota.id,
      numero: '', codigo_verificacao: '',
      protocolo: campo(corpo, 'protocolo', 'data.protocolo'),
      link_pdf: '', link_xml: '',
      erro: '',
    };
  }

  async consultar(referencia: string, config: ConfigFiscal): Promise<ResultadoTransmissao> {
    const { ok, corpo } = await requisicao(
      `${this.base(config)}/nfse/consulta/status/${encodeURIComponent(referencia)}`,
      { method: 'GET' },
      this.token(config),
    );
    if (!ok) {
      return {
        status: 'PROCESSANDO',
        referencia, numero: '', codigo_verificacao: '', protocolo: '',
        link_pdf: '', link_xml: '',
        erro: textoDoErro(corpo),
      };
    }
    const status = statusDoGateway(campo(corpo, 'situacao', 'status', 'data.situacao', 'documents.0.situacao'));
    return {
      status,
      referencia,
      numero: campo(corpo, 'numero', 'data.numero', 'nfse.numero', 'documents.0.numero'),
      codigo_verificacao: campo(corpo, 'codigoVerificacao', 'data.codigoVerificacao', 'nfse.codigoVerificacao'),
      protocolo: campo(corpo, 'protocolo', 'data.protocolo'),
      link_pdf: campo(corpo, 'pdf', 'data.pdf', 'links.pdf'),
      link_xml: campo(corpo, 'xml', 'data.xml', 'links.xml'),
      erro: status === 'REJEITADA' ? (textoDoErro(corpo) || 'A prefeitura recusou a nota.') : '',
    };
  }

  async cancelar(referencia: string, motivo: string, config: ConfigFiscal): Promise<ResultadoTransmissao> {
    const { ok, corpo } = await requisicao(
      `${this.base(config)}/nfse/${encodeURIComponent(referencia)}/cancelamento`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo }),
      },
      this.token(config),
    );
    if (!ok) {
      throw new ErroFiscal(
        textoDoErro(corpo) || 'A prefeitura não aceitou o cancelamento.',
      );
    }
    return {
      status: 'CANCELADA',
      referencia,
      numero: '', codigo_verificacao: '',
      protocolo: campo(corpo, 'protocolo', 'data.protocolo'),
      link_pdf: '', link_xml: '',
      erro: '',
    };
  }
}

// ============================================================
// Simulado
// ============================================================

/**
 * Emissor que não transmite nada. Existe para a agência percorrer o fluxo
 * inteiro (configurar, emitir, consultar, cancelar) antes de contratar um
 * gateway e ver os valores que sairiam na nota.
 *
 * A nota simulada nunca é documento fiscal, e o sistema impede que ela rode
 * em ambiente de produção justamente para não ser confundida com uma real.
 */
export class EmissorSimulado implements EmissorNFSe {
  readonly nome = 'Simulado';

  async enviarCertificado(entrada: {
    arquivo: Uint8Array;
    nome_arquivo: string;
    senha: string;
    email: string;
  }): Promise<Omit<CertificadoDigital, 'id' | 'enviado_em' | 'enviado_por'>> {
    if (!entrada.senha) {
      throw new ErroFiscal('Informe a senha do certificado.');
    }
    return {
      referencia_gateway: 'simulado',
      nome_arquivo: entrada.nome_arquivo,
      cnpj: '',
      titular: 'Certificado simulado (nenhum arquivo foi transmitido)',
      validade_inicio: '',
      validade_fim: '',
    };
  }

  async emitir(entrada: { nota: NotaFiscal }): Promise<ResultadoTransmissao> {
    return {
      status: 'AUTORIZADA',
      referencia: entrada.nota.id,
      numero: `SIM-${entrada.nota.id.slice(-6).toUpperCase()}`,
      codigo_verificacao: 'SIMULADA',
      protocolo: 'SIMULADA',
      link_pdf: '', link_xml: '',
      erro: '',
    };
  }

  async consultar(referencia: string): Promise<ResultadoTransmissao> {
    return {
      status: 'AUTORIZADA',
      referencia,
      numero: `SIM-${referencia.slice(-6).toUpperCase()}`,
      codigo_verificacao: 'SIMULADA',
      protocolo: 'SIMULADA',
      link_pdf: '', link_xml: '', erro: '',
    };
  }

  async cancelar(referencia: string): Promise<ResultadoTransmissao> {
    return {
      status: 'CANCELADA',
      referencia,
      numero: '', codigo_verificacao: '', protocolo: 'SIMULADA',
      link_pdf: '', link_xml: '', erro: '',
    };
  }
}

/**
 * Escolhe o emissor da configuração.
 *
 * A guarda do simulado em produção é deliberada: uma nota que parece
 * autorizada mas não existe na prefeitura é pior do que nota nenhuma.
 */
export function emissorDaConfig(config: ConfigFiscal): EmissorNFSe {
  if (config.provedor === 'simulado') {
    if (config.ambiente === 'PRODUCAO') {
      throw new ErroFiscal(
        'O emissor simulado não emite nota de verdade e não pode rodar em produção. '
        + 'Escolha um emissor real ou volte o ambiente para homologação.',
      );
    }
    return new EmissorSimulado();
  }
  if (config.provedor === 'plugnotas') return new EmissorPlugNotas();
  throw new ErroFiscal('Nenhum emissor de nota configurado em Configurações › Fiscal.');
}

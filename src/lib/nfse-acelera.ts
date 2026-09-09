/**
 * Emissor de NFS-e pela AceleraAPI (https://aceleraapi.com.br/docs).
 *
 * A AceleraAPI é uma casca sobre o PADRÃO NACIONAL (DPS → SEFIN Nacional).
 * Isso tem três consequências que mudam o comportamento do sistema, e todas
 * estão tratadas aqui em vez de escondidas:
 *
 *  1. NÃO EXISTE DEDUÇÃO POR NOTA. O corpo da emissão só aceita
 *     `valor_servico`. Então a intermediação só pode sair no formato "nota do
 *     valor da comissão"; o formato "valor cheio com o repasse como dedução"
 *     é recusado com mensagem, nunca convertido em silêncio — mandar um valor
 *     diferente do que a pessoa configurou é exatamente o erro de dinheiro
 *     que este sistema existe para não cometer.
 *
 *  2. A ALÍQUOTA DE ISS NÃO VAI NA NOTA. Quem calcula o imposto é a
 *     prefeitura, a partir do código de tributação nacional configurado no
 *     prestador. A alíquota que a agência informa aqui serve para estimar o
 *     resultado na tela, e a tela diz isso.
 *
 *  3. O PRESTADOR É CONFIGURADO NO EMISSOR, não enviado a cada nota. Por isso
 *     existe `configurarPrestador`, e `pendencias` devolve o que a própria
 *     AceleraAPI ainda considera faltando.
 *
 * O certificado continua não ficando neste banco: ele vai em base64 para a
 * AceleraAPI, que valida a senha na hora e guarda do lado dela.
 */

import {
  ErroFiscal,
  statusDoGateway,
  textoDoErro,
  type CapacidadesEmissor,
  type DadosEmitente,
  type EmissorNFSe,
  type PendenciasDoEmissor,
  type ResultadoTransmissao,
} from './nfse-emissor';
import type { CertificadoDigital, ConfigFiscal, NotaFiscal } from './nfse-tipos';

const BASE = 'https://aceleraapi.com.br/api/v1';
const TIMEOUT_MS = 45_000;

/** Ambiente no vocabulário da AceleraAPI: 1 produção, 2 homologação. */
function codigoAmbiente(config: ConfigFiscal): number {
  return config.ambiente === 'PRODUCAO' ? 1 : 2;
}

function digitos(v: unknown): string {
  return String(v ?? '').replace(/\D+/g, '');
}

/**
 * Mensagens para os códigos de erro documentados. Sem isto o usuário recebe
 * "emissao_rejeitada" e não tem o que fazer com a informação.
 */
const MENSAGEM_POR_CODIGO: Record<string, string> = {
  emissao_rejeitada:
    'A prefeitura recusou a nota, ou a configuração do prestador ainda tem pendências.',
  certificado_invalido: 'O certificado está corrompido ou a senha não confere.',
  certificado_de_outro_titular:
    'O CNPJ do certificado é diferente do CNPJ cadastrado como prestador.',
  certificado_vencido: 'O certificado digital está vencido. Envie um novo.',
  motivo_curto: 'O motivo do cancelamento precisa ter pelo menos 15 caracteres.',
  nfse_nao_encontrada: 'Esta nota não existe no emissor.',
  produto_nao_vinculado:
    'Sua conta na AceleraAPI não tem o serviço de NFS-e liberado.',
};

interface Resposta {
  ok: boolean;
  httpStatus: number;
  dados: Record<string, unknown> | null;
  codigoErro: string;
  mensagemErro: string;
}

/** Desembrulha o envelope {ok, status, error, data} da AceleraAPI. */
function interpretar(httpStatus: number, corpo: unknown): Resposta {
  const env = (corpo ?? {}) as Record<string, unknown>;
  const erro = (env.error ?? null) as Record<string, unknown> | null;
  const codigo = String(erro?.code ?? '');
  const mensagemBruta = String(erro?.message ?? '');
  const dados = (env.data ?? null) as Record<string, unknown> | null;
  const ok = env.ok === true;
  return {
    ok,
    httpStatus,
    dados,
    codigoErro: codigo,
    mensagemErro: ok
      ? ''
      : MENSAGEM_POR_CODIGO[codigo] || mensagemBruta || textoDoErro(corpo)
        || 'O emissor recusou a requisição.',
  };
}

async function chamar(
  caminho: string,
  init: RequestInit,
  token: string | null,
): Promise<Resposta> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_MS);
  try {
    const cabecalhos: Record<string, string> = {
      Accept: 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    };
    // A consulta de município é pública: mandar Bearer vazio daria 401.
    if (token) cabecalhos.Authorization = `Bearer ${token}`;

    const res = await fetch(`${BASE}${caminho}`, {
      ...init,
      signal: controle.signal,
      headers: cabecalhos,
    });
    const texto = await res.text();
    let corpo: unknown = null;
    try {
      corpo = texto ? JSON.parse(texto) : null;
    } catch {
      corpo = texto;
    }
    return interpretar(res.status, corpo);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ErroFiscal(
        'A AceleraAPI não respondeu a tempo. A nota pode ter sido enviada: '
        + 'consulte em Notas fiscais antes de emitir de novo.',
      );
    }
    throw new ErroFiscal(
      'Não foi possível falar com a AceleraAPI.',
      e instanceof Error ? e.message : '',
    );
  } finally {
    clearTimeout(timer);
  }
}

function texto(d: Record<string, unknown> | null, ...chaves: string[]): string {
  if (!d) return '';
  for (const c of chaves) {
    const v = d[c];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
}

/**
 * `cod_interno` aceita no máximo 20 caracteres alfanuméricos. É a trava
 * anti-duplicata do lado do emissor, então precisa ser estável para a mesma
 * nota: derivamos do id, sem inventar nada aleatório.
 */
export function codigoInterno(notaId: string): string {
  const limpo = String(notaId ?? '').replace(/[^A-Za-z0-9]/g, '');
  return limpo.slice(-20) || 'NOTA';
}

/** Corpo da emissão. Exportado para poder ser conferido em teste. */
export function montarCorpoEmissao(entrada: {
  nota: NotaFiscal;
  config: ConfigFiscal;
}): Record<string, unknown> {
  const { nota, config } = entrada;
  const end = nota.tomador.endereco;
  const corpo: Record<string, unknown> = {
    tomador_nome: nota.tomador.razao_social,
    tomador_documento: digitos(nota.tomador.cpf_cnpj),
    descricao_servico: nota.discriminacao,
    // O valor tributável da nota. Em intermediação isto é a comissão: o
    // repasse ao fornecedor não é receita da agência e não entra aqui.
    valor_servico: nota.valor_servicos,
    data_competencia: (nota.emitida_em || '').slice(0, 10) || undefined,
    cod_interno: codigoInterno(nota.id),
  };
  if (nota.tomador.email) corpo.tomador_email = nota.tomador.email;
  if (end.logradouro) corpo.tomador_logradouro = end.logradouro;
  if (end.numero) corpo.tomador_numero = end.numero;
  if (end.complemento) corpo.tomador_complemento = end.complemento;
  if (end.bairro) corpo.tomador_bairro = end.bairro;
  if (digitos(end.cep)) corpo.tomador_cep = digitos(end.cep);
  if (end.estado) corpo.tomador_uf = end.estado;
  if (config.cod_tributacao_nacional) {
    corpo.cod_tributacao_nacional = config.cod_tributacao_nacional;
  }
  if (config.cod_municipio_ibge) {
    corpo.cod_municipio_prestacao = digitos(config.cod_municipio_ibge);
  }
  // A alíquota não viaja: quem calcula o ISS é a prefeitura. Registrar a
  // estimativa em info_complementar deixa a conta visível no documento.
  const complemento = [
    nota.regime === 'INTERMEDIACAO'
      ? `Agenciamento. Valor intermediado: R$ ${nota.valor_recebido.toFixed(2)}.`
      : '',
    config.info_complementar_padrao || '',
  ].filter(Boolean).join(' ');
  if (complemento) corpo.info_complementar = complemento.slice(0, 500);
  return corpo;
}

export class EmissorAceleraAPI implements EmissorNFSe {
  readonly nome = 'AceleraAPI';

  /**
   * O padrão nacional não recebe dedução nem alíquota por nota, e não tem
   * bloco de intermediário. O sistema usa isto para recusar antes de emitir,
   * em vez de mandar um valor diferente do configurado.
   */
  readonly capacidades: CapacidadesEmissor = {
    deducoes: false,
    aliquota_por_nota: false,
    intermediario: false,
  };

  private token(config: ConfigFiscal): string {
    const t = String(config.token ?? '').trim();
    if (!t) throw new ErroFiscal('O token da AceleraAPI não está configurado.');
    return t;
  }

  /** Consulta pública: a cidade emite pelo padrão nacional? */
  async municipioEmite(ibge: string): Promise<{ emite: boolean; detalhe: string }> {
    const r = await chamar(`/nfse/municipios/${encodeURIComponent(digitos(ibge))}`, { method: 'GET' }, null);
    if (!r.ok) return { emite: false, detalhe: r.mensagemErro };
    const d = r.dados ?? {};
    const emite = d.emite === true || d.aderente === true || d.ativo === true
      || String(d.status ?? '').toLowerCase().includes('aderente');
    return {
      emite,
      detalhe: texto(d, 'nome', 'municipio', 'descricao'),
    };
  }

  /** Empurra os dados do prestador para o emissor (PUT /nfse/configuracao). */
  async configurarPrestador(entrada: {
    config: ConfigFiscal;
    emitente: DadosEmitente;
  }): Promise<void> {
    const { config, emitente } = entrada;
    const documento = digitos(emitente.cnpj);
    const corpo: Record<string, unknown> = {
      cod_municipio: digitos(config.cod_municipio_ibge),
      cod_tributacao_nacional: config.cod_tributacao_nacional,
      ambiente: codigoAmbiente(config),
    };
    if (documento.length === 14) corpo.cnpj = documento;
    else if (documento.length === 11) corpo.cpf = documento;
    if (digitos(emitente.inscricao_municipal)) {
      corpo.inscricao_municipal = digitos(emitente.inscricao_municipal);
    }
    if (config.simples_nacional) corpo.simples_nacional = config.simples_nacional;
    // regime_apuracao só é exigido para MEI e ME/EPP; mandar em não optante
    // é ruído que a API rejeita.
    if (config.simples_nacional >= 2 && config.regime_apuracao) {
      corpo.regime_apuracao = config.regime_apuracao;
    }
    if (config.regime_especial) corpo.regime_especial = config.regime_especial;
    if (config.trib_issqn) corpo.trib_issqn = config.trib_issqn;
    if (config.tipo_retencao_issqn) corpo.tipo_retencao_issqn = config.tipo_retencao_issqn;
    if (config.serie_rps) corpo.serie_dps = config.serie_rps;
    if (config.ultimo_numero_dps) corpo.ultimo_numero_dps = config.ultimo_numero_dps;

    const r = await chamar(
      '/nfse/configuracao',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      },
      this.token(config),
    );
    if (!r.ok) throw new ErroFiscal(r.mensagemErro);
  }

  /** O que a própria AceleraAPI ainda considera faltando. */
  async pendencias(config: ConfigFiscal): Promise<PendenciasDoEmissor> {
    const r = await chamar('/nfse/configuracao', { method: 'GET' }, this.token(config));
    if (!r.ok) return { pronto: false, itens: [r.mensagemErro] };
    const d = r.dados ?? {};
    const lista = Array.isArray(d.pendencias) ? d.pendencias : [];
    return {
      pronto: d.pronto_para_emitir === true,
      itens: lista.map(p => (typeof p === 'string' ? p : textoDoErro(p))).filter(Boolean),
    };
  }

  async enviarCertificado(entrada: {
    arquivo: Uint8Array;
    nome_arquivo: string;
    senha: string;
    email: string;
    config?: ConfigFiscal;
  }): Promise<Omit<CertificadoDigital, 'id' | 'enviado_em' | 'enviado_por'>> {
    const config = entrada.config as ConfigFiscal;
    const base64 = Buffer.from(entrada.arquivo).toString('base64');
    const r = await chamar(
      '/nfse/certificado',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certificado_base64: base64, senha: entrada.senha }),
      },
      this.token(config),
    );
    if (!r.ok) throw new ErroFiscal(r.mensagemErro);
    const d = r.dados ?? {};
    return {
      referencia_gateway: texto(d, 'id', 'certificado_id') || 'aceleraapi',
      nome_arquivo: entrada.nome_arquivo,
      cnpj: digitos(texto(d, 'cnpj', 'documento', 'titular_documento')),
      titular: texto(d, 'titular', 'nome', 'razao_social'),
      validade_inicio: texto(d, 'validade_inicio', 'inicio').slice(0, 10),
      validade_fim: texto(d, 'validade_fim', 'vencimento', 'validade', 'expira_em').slice(0, 10),
    };
  }

  async emitir(entrada: {
    nota: NotaFiscal;
    config: ConfigFiscal;
    emitente: DadosEmitente;
  }): Promise<ResultadoTransmissao> {
    if (entrada.nota.forma_base === 'TOTAL_COM_DEDUCAO'
      && entrada.nota.regime === 'INTERMEDIACAO') {
      throw new ErroFiscal(
        'O padrão nacional não aceita dedução por nota, então a AceleraAPI não emite no formato '
        + '"valor cheio com o repasse como dedução". Use "nota do valor da comissão".',
      );
    }
    const corpo = montarCorpoEmissao({ nota: entrada.nota, config: entrada.config });
    const r = await chamar(
      '/nfse/emitir',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      },
      this.token(entrada.config),
    );
    if (!r.ok) {
      return {
        status: 'REJEITADA',
        referencia: '', numero: '', codigo_verificacao: '', protocolo: '',
        link_pdf: '', link_xml: '',
        erro: r.mensagemErro,
      };
    }
    return this.daResposta(r.dados);
  }

  async consultar(referencia: string, config: ConfigFiscal): Promise<ResultadoTransmissao> {
    const r = await chamar(
      `/nfse/${encodeURIComponent(referencia)}`,
      { method: 'GET' },
      this.token(config),
    );
    if (!r.ok) {
      // Consulta que falha não pode rebaixar uma nota já autorizada: devolve
      // PROCESSANDO e deixa o chamador preservar o que já sabia.
      return {
        status: r.codigoErro === 'nfse_nao_encontrada' ? 'REJEITADA' : 'PROCESSANDO',
        referencia, numero: '', codigo_verificacao: '', protocolo: '',
        link_pdf: '', link_xml: '',
        erro: r.mensagemErro,
      };
    }
    return this.daResposta(r.dados);
  }

  async cancelar(
    referencia: string,
    motivo: string,
    config: ConfigFiscal,
  ): Promise<ResultadoTransmissao> {
    // A AceleraAPI exige 15 caracteres. Barrar aqui evita gastar a chamada e
    // devolve um texto que diz o que fazer.
    if (motivo.trim().length < 15) {
      throw new ErroFiscal(
        'O motivo do cancelamento precisa ter pelo menos 15 caracteres.',
      );
    }
    const r = await chamar(
      `/nfse/${encodeURIComponent(referencia)}/cancelar`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: motivo.trim(), codigo_motivo: 4 }),
      },
      this.token(config),
    );
    if (!r.ok) throw new ErroFiscal(r.mensagemErro);
    return {
      status: 'CANCELADA',
      referencia, numero: '', codigo_verificacao: '', protocolo: '',
      link_pdf: '', link_xml: '', erro: '',
    };
  }

  /** Traduz o corpo da AceleraAPI para o formato do sistema. */
  private daResposta(d: Record<string, unknown> | null): ResultadoTransmissao {
    const id = texto(d, 'id');
    return {
      status: statusDoGateway(texto(d, 'status', 'situacao')),
      referencia: id,
      numero: texto(d, 'numero_dps', 'numero'),
      // No padrão nacional o comprovante é a chave de acesso de 50 posições.
      codigo_verificacao: texto(d, 'chave_acesso'),
      protocolo: id,
      link_pdf: texto(d, 'danfse_url', 'pdf_url'),
      link_xml: texto(d, 'xml_url'),
      erro: '',
    };
  }
}

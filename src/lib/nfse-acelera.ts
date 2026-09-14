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
import { situacaoSimples } from './nfse-simples';

const BASE = 'https://aceleraapi.com.br/api/v1';
const TIMEOUT_MS = 45_000;

/** Ambiente no vocabulário da AceleraAPI: 1 produção, 2 homologação. */
function codigoAmbiente(config: ConfigFiscal): number {
  return config.ambiente === 'PRODUCAO' ? 1 : 2;
}

/**
 * Converte para número, ou devolve null quando o valor não é um número.
 *
 * Existe porque a configuração guarda estes campos como texto (é o que um
 * <input> produz) e a API os valida como número. `permitidos` restringe ao
 * conjunto que o campo aceita: fora dele, é melhor omitir do que enviar um
 * código que não existe.
 */
function numeroValido(v: unknown, permitidos?: number[]): number | null {
  const texto = String(v ?? '').trim();
  if (!texto) return null;
  if (!/^\d+$/.test(texto)) return null;
  const n = Number(texto);
  if (!Number.isFinite(n)) return null;
  if (permitidos && !permitidos.includes(n)) return null;
  return n;
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

/** Junta o que a API disse com a explicação do código, sem repetir texto. */
function montarMensagem(codigo: string, bruta: string, corpo: unknown): string {
  const enlatada = MENSAGEM_POR_CODIGO[codigo] ?? '';
  const partes: string[] = [];
  if (bruta) partes.push(bruta);
  if (enlatada && enlatada !== bruta) partes.push(enlatada);
  const texto = partes.join(' ');
  return texto || textoDoErro(corpo) || 'O emissor recusou a requisição.';
}

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
    // A MENSAGEM DA API VEM PRIMEIRO. Antes o texto enlatado daqui
    // SUBSTITUÍA o que a AceleraAPI explicava, e o usuário recebia "a
    // prefeitura recusou a nota" no lugar do motivo real. O enlatado agora
    // complementa: serve quando a API só devolve o código.
    mensagemErro: ok ? '' : montarMensagem(codigo, mensagemBruta, corpo),
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

  /**
   * Consulta pública: a cidade emite pelo Emissor Nacional?
   *
   * `atendido` e `emissor_nacional` andam juntos e são a resposta. Não
   * confundir com `convenio`/`ambiente_nacional`: São Paulo aparece como
   * "Conveniado Ativo" no ambiente nacional e mesmo assim NÃO emite por ele,
   * porque mantém sistema próprio. Ler o convênio como permissão faria a
   * agência tentar emitir e tomar recusa sem entender o motivo.
   */
  async municipioEmite(ibge: string): Promise<{
    emite: boolean;
    nome: string;
    uf: string;
    convenio: string;
    detalhe: string;
  }> {
    const r = await chamar(`/nfse/municipios/${encodeURIComponent(digitos(ibge))}`, { method: 'GET' }, null);
    if (!r.ok) {
      return { emite: false, nome: '', uf: '', convenio: '', detalhe: r.mensagemErro };
    }
    const d = r.dados ?? {};
    const emite = d.emissor_nacional === true || d.atendido === true;
    const nome = texto(d, 'nome');
    const uf = texto(d, 'uf');
    return {
      emite,
      nome,
      uf,
      convenio: texto(d, 'convenio'),
      detalhe: [nome, uf].filter(Boolean).join(' / '),
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
    // ESTES CAMPOS SÃO NUMÉRICOS NA API. Mandar '0' e '1' como TEXTO, que era
    // o que a configuração guardava, faz a validação recusar o cadastro
    // inteiro — e aí o prestador nunca é gravado, o emissor continua
    // reclamando de município e código de tributação, e nada na tela explica
    // por quê. Qualquer valor que não vire número é omitido em vez de ir
    // quebrado.
    if (config.simples_nacional) corpo.simples_nacional = Number(config.simples_nacional);
    // regime_apuracao só é exigido para MEI e ME/EPP; mandar em não optante
    // é ruído que a API rejeita. E ele é 1, 2 ou 3 — nunca o nome do regime.
    if (config.simples_nacional >= 2) {
      const regime = numeroValido(config.regime_apuracao, [1, 2, 3]);
      if (regime !== null) corpo.regime_apuracao = regime;
    }
    const especial = numeroValido(config.regime_especial);
    if (especial !== null) corpo.regime_especial = especial;
    const trib = numeroValido(config.trib_issqn);
    if (trib !== null) corpo.trib_issqn = trib;
    const retencao = numeroValido(config.tipo_retencao_issqn);
    if (retencao !== null) corpo.tipo_retencao_issqn = retencao;
    if (config.serie_rps) corpo.serie_dps = Number(config.serie_rps) || config.serie_rps;
    const ultimo = numeroValido(config.ultimo_numero_dps);
    if (ultimo !== null) corpo.ultimo_numero_dps = ultimo;

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
      // `emissao_rejeitada` quer dizer "a SEFIN recusou OU falta configuração".
      // Sem dizer qual das duas, a mensagem não ajuda ninguém: então pergunta
      // ao emissor o que ele ainda considera pendente e mostra junto.
      let erro = r.mensagemErro;
      if (r.codigoErro === 'emissao_rejeitada') {
        try {
          const p = await this.pendencias(entrada.config);
          if (!p.pronto && p.itens.length > 0) {
            erro = `${erro} Pendências do emissor: ${p.itens.join('; ')}.`;
          }
        } catch {
          // Mantém a mensagem que já temos: falhar a consulta não pode
          // apagar o motivo da recusa.
        }
      }
      return {
        status: 'REJEITADA',
        referencia: '', numero: '', codigo_verificacao: '', protocolo: '',
        link_pdf: '', link_xml: '',
        erro,
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

// ============================================================
// Conta de desenvolvedor: uma empresa por agência
// ============================================================

/**
 * A AceleraAPI tem DOIS tipos de chave, e a diferença é a arquitetura inteira
 * deste módulo:
 *
 *   aca_  chave de desenvolvedor. É a da operação do Entur OS, uma só para o
 *         sistema todo. Serve para cadastrar empresas e nada mais: qualquer
 *         chamada de produto com ela devolve `requer_chave_empresa`.
 *
 *   ace_  chave da empresa. Nasce quando a agência é cadastrada, é devolvida
 *         UMA única vez e é com ela que a nota é emitida.
 *
 * Por isso a agência não cola token nenhum: ela clica em conectar, o sistema
 * cadastra a empresa dela com a chave da operação e guarda o `ace_` que
 * voltou. É o que faz "configuração única, cada um emite a sua".
 *
 * A chave de desenvolvedor mora em variável de ambiente, não no banco: ela
 * vale para todos os tenants e um vazamento dela exporia todas as agências.
 */
export function chaveDesenvolvedor(): string {
  const k = String(process.env.ACELERA_API_KEY ?? '').trim();
  if (!k) {
    throw new ErroFiscal(
      'A chave de desenvolvedor da AceleraAPI não está configurada no servidor '
      + '(ACELERA_API_KEY). Sem ela nenhuma agência consegue ser conectada.',
    );
  }
  return k;
}

export interface EmpresaAcelera {
  id: number;
  /** Só existe na resposta da criação e na regeneração. Guardar na hora. */
  token: string;
  status: string;
}

/** Código do produto de nota fiscal de serviço na AceleraAPI. */
export const PRODUTO_FISCAL = 'fiscal';
/** Produto de emissão de NFS-e. É ele que a nota consome, não o 'fiscal'. */
export const PRODUTO_NFSE = 'nfse';
/** Consulta de dados cadastrais na Receita. */
export const PRODUTO_CNPJ = 'cnpj';

/**
 * Cadastra a agência como empresa e devolve o token dela.
 *
 * O token vem uma vez só. Se a gravação falhar depois disto, o caminho não é
 * cadastrar de novo (viraria empresa duplicada): é
 * `regenerarTokenEmpresa(id)`, que revoga o anterior.
 */
export async function criarEmpresaAcelera(dados: {
  cnpj: string;
  razao_social: string;
  nome_fantasia?: string;
  email?: string;
  telefone?: string;
  uf?: string;
}): Promise<EmpresaAcelera> {
  const cnpj = digitos(dados.cnpj);
  if (cnpj.length !== 14) {
    throw new ErroFiscal(
      'A agência precisa de um CNPJ válido em Configurações › Agência antes de conectar.',
    );
  }
  if (!String(dados.razao_social ?? '').trim()) {
    throw new ErroFiscal('A agência precisa de razão social em Configurações › Agência.');
  }

  const corpo: Record<string, unknown> = {
    cnpj,
    razao_social: dados.razao_social.trim(),
    produtos: [PRODUTO_NFSE, PRODUTO_FISCAL],
  };
  if (dados.nome_fantasia?.trim()) corpo.nome_fantasia = dados.nome_fantasia.trim();
  if (dados.email?.trim()) corpo.email = dados.email.trim();
  if (dados.telefone?.trim()) corpo.telefone = digitos(dados.telefone);
  if (dados.uf?.trim()) corpo.uf = dados.uf.trim().toUpperCase().slice(0, 2);

  const r = await chamar(
    '/empresas',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    },
    chaveDesenvolvedor(),
  );
  if (!r.ok) throw new ErroFiscal(r.mensagemErro);

  const d = r.dados ?? {};
  const token = texto(d, 'token');
  const id = Number(texto(d, 'id'));
  if (!token || !Number.isFinite(id)) {
    throw new ErroFiscal(
      'A AceleraAPI cadastrou a empresa mas não devolveu o token. '
      + 'Gere um novo token pelo painel da AceleraAPI antes de tentar de novo.',
    );
  }
  return { id, token, status: texto(d, 'status') || 'ativa' };
}

/** Empresas já cadastradas na conta de desenvolvedor. */
export async function listarEmpresasAcelera(): Promise<Array<{
  id: number;
  cnpj: string;
  razao_social: string;
  status: string;
}>> {
  const r = await chamar('/empresas?pagina=1', { method: 'GET' }, chaveDesenvolvedor());
  if (!r.ok) throw new ErroFiscal(r.mensagemErro);
  const lista = (r.dados?.empresas ?? []) as Array<Record<string, unknown>>;
  return lista.map(e => ({
    id: Number(texto(e, 'id')),
    // O nome do campo do documento varia conforme a empresa seja PJ ou PF.
    cnpj: digitos(texto(e, 'cnpj', 'documento', 'cpf_cnpj', 'cpf')),
    razao_social: texto(e, 'razao_social', 'nome', 'nome_fantasia'),
    status: texto(e, 'status'),
  }));
}

/**
 * Procura a agência entre as empresas já cadastradas na conta.
 *
 * Existe para o reconectar não virar cadastro duplicado: depois de
 * desconectar, clicar em conectar de novo com o mesmo CNPJ tem que reaproveitar
 * a empresa que já existe, não criar uma segunda. Duas empresas para o mesmo
 * CNPJ significam duas numerações de nota no mesmo emitente.
 */
export async function acharEmpresaPorCnpj(cnpj: string): Promise<{
  id: number;
  cnpj: string;
  razao_social: string;
  status: string;
} | null> {
  const alvo = digitos(cnpj);
  if (alvo.length < 11) return null;
  const empresas = await listarEmpresasAcelera();
  return empresas.find(e => e.cnpj === alvo) ?? null;
}

/** Últimos dígitos da chave de operação, para conferir a conta em uso. */
export function chaveOperacaoMascarada(): string {
  const k = String(process.env.ACELERA_API_KEY ?? '').trim();
  if (!k) return '';
  return `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

/**
 * Gera um token novo para a empresa, revogando o anterior.
 *
 * É a saída para o token que se perdeu: cadastrar a mesma agência de novo
 * criaria empresa duplicada, e a nota sairia por um CNPJ com dois cadastros.
 */
export async function regenerarTokenEmpresa(empresaId: number): Promise<string> {
  const r = await chamar(
    `/empresas/${encodeURIComponent(String(empresaId))}/token`,
    { method: 'POST' },
    chaveDesenvolvedor(),
  );
  if (!r.ok) throw new ErroFiscal(r.mensagemErro);
  const token = texto(r.dados ?? {}, 'token');
  if (!token) throw new ErroFiscal('A AceleraAPI não devolveu o token novo.');
  return token;
}

/** Liga o produto de nota fiscal na empresa. Já cadastrada, já vinculada. */
export async function vincularProdutoFiscal(empresaId: number): Promise<void> {
  const r = await chamar(
    `/empresas/${encodeURIComponent(String(empresaId))}/produtos/${PRODUTO_FISCAL}`,
    { method: 'POST' },
    chaveDesenvolvedor(),
  );
  if (!r.ok) throw new ErroFiscal(r.mensagemErro);
}

// ============================================================
// Dados cadastrais da Receita
// ============================================================

/** O que a consulta de CNPJ consegue preencher sozinha. */
export interface CadastroReceita {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  situacao: string;
  cnae: string;
  /** CNAEs declarados: principal primeiro, depois os secundários. */
  cnaes: string[];
  /**
   * Enquadramento no Simples, no vocabulário da AceleraAPI:
   * 1 não optante, 2 MEI, 3 ME/EPP. Zero quando a base não disse.
   */
  simples_nacional: 0 | 1 | 2 | 3;
  /** Código IBGE do município, 7 dígitos. Vazio quando a base não trouxe. */
  cod_municipio_ibge: string;
  endereco: {
    cep: string;
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    estado: string;
  };
  email: string;
  telefone: string;
}

/**
 * Lê um campo aceitando vários nomes e caminhos aninhados.
 *
 * A resposta da Receita chega com formatos diferentes conforme a origem
 * (`endereco.cep`, `cep`, `logradouro` vs `descricao_logradouro`), e travar
 * num único nome faria o preenchimento automático voltar vazio sem dizer
 * por quê.
 */
function primeiro(o: unknown, ...caminhos: string[]): string {
  for (const c of caminhos) {
    const v = c.split('.').reduce<unknown>(
      (acc, parte) => (acc && typeof acc === 'object'
        ? (acc as Record<string, unknown>)[parte]
        : undefined),
      o,
    );
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

/**
 * Consulta os dados cadastrais do CNPJ na base da Receita.
 *
 * Usa a credencial da AGÊNCIA (ace_), porque é produto. Se o produto de
 * consulta ainda não estiver vinculado, vincula com a chave de operação e
 * tenta de novo: o objetivo é a agência não precisar saber que existe um
 * produto a contratar.
 */
export async function consultarCnpj(
  cnpj: string,
  config: ConfigFiscal,
): Promise<CadastroReceita> {
  const doc = digitos(cnpj);
  if (doc.length !== 14) {
    throw new ErroFiscal('Informe um CNPJ com 14 dígitos em Configurações › Agência.');
  }
  const token = String(config.token ?? '').trim();
  if (!token) {
    throw new ErroFiscal('Conecte a agência à AceleraAPI antes de buscar os dados do CNPJ.');
  }

  let r = await chamar(`/cnpj/${doc}`, { method: 'GET' }, token);
  if (!r.ok && r.codigoErro === 'produto_nao_vinculado' && config.empresa_id) {
    await chamar(
      `/empresas/${config.empresa_id}/produtos/${PRODUTO_CNPJ}`,
      { method: 'POST' },
      chaveDesenvolvedor(),
    );
    r = await chamar(`/cnpj/${doc}`, { method: 'GET' }, token);
  }
  if (!r.ok) throw new ErroFiscal(r.mensagemErro);

  const d = (r.dados ?? {}) as Record<string, unknown>;
  const end = (d.endereco ?? d.estabelecimento ?? {}) as Record<string, unknown>;
  const cnae = primeiro(d, 'cnae_principal.codigo', 'cnae_principal', 'cnae_fiscal', 'cnae');

  // Atividades secundárias entram para a tela conseguir mostrar TODAS as
  // coisas que a empresa declarou fazer, não só a principal.
  const secundarios = Array.isArray(d.cnaes_secundarios)
    ? (d.cnaes_secundarios as unknown[])
    : Array.isArray(d.cnaes)
      ? (d.cnaes as unknown[])
      : [];
  const listaCnaes = [
    digitos(cnae),
    ...secundarios.map(c => digitos(
      typeof c === 'object' && c
        ? primeiro(c, 'codigo', 'cnae', 'id')
        : String(c ?? ''),
    )),
  ].filter(Boolean);

  // Simples/MEI vêm da Receita. Perguntar isso à agência era pedir um dado
  // que o sistema já tem como olhar, e que ela costuma errar.
  //
  // A leitura mora em nfse-simples.ts porque a versão anterior aqui só
  // aceitava a string literal "true": booleano, objeto aninhado e "S", que
  // são os formatos que as bases realmente devolvem, caíam todos em NÃO
  // OPTANTE. Era essa divergência que a prefeitura recusava com o erro
  // E0160. Zero continua querendo dizer "a base não informou", e é
  // diferente de "não optante": com zero a tela mantém o que já está
  // configurado em vez de rebaixar sem ter lido.
  const situacao = situacaoSimples(d);
  const simples: 0 | 1 | 2 | 3 = situacao.enquadramento;

  return {
    cnpj: doc,
    razao_social: primeiro(d, 'razao_social', 'nome', 'nome_empresarial'),
    nome_fantasia: primeiro(d, 'nome_fantasia', 'fantasia', 'estabelecimento.nome_fantasia'),
    situacao: primeiro(d, 'situacao', 'situacao_cadastral', 'descricao_situacao_cadastral'),
    cnae: digitos(cnae),
    cnaes: listaCnaes,
    simples_nacional: simples,
    cod_municipio_ibge: digitos(primeiro(
      d,
      'codigo_ibge', 'municipio_ibge', 'cod_municipio_ibge', 'codigo_municipio_ibge',
      'endereco.codigo_ibge', 'endereco.municipio_ibge', 'endereco.cod_municipio_ibge',
      'endereco.codigo_municipio_ibge', 'estabelecimento.cidade.ibge_id',
    )),
    endereco: {
      cep: digitos(primeiro(d, 'endereco.cep', 'cep', 'estabelecimento.cep')),
      logradouro: primeiro(
        end, 'logradouro', 'descricao_logradouro', 'rua',
      ) || primeiro(d, 'logradouro', 'descricao_logradouro'),
      numero: primeiro(end, 'numero') || primeiro(d, 'numero'),
      complemento: primeiro(end, 'complemento') || primeiro(d, 'complemento'),
      bairro: primeiro(end, 'bairro') || primeiro(d, 'bairro'),
      cidade: primeiro(end, 'municipio', 'cidade', 'cidade.nome')
        || primeiro(d, 'municipio', 'cidade'),
      estado: (primeiro(end, 'uf', 'estado', 'estado.sigla')
        || primeiro(d, 'uf', 'estado')).toUpperCase().slice(0, 2),
    },
    email: primeiro(d, 'email', 'endereco.email', 'estabelecimento.email'),
    telefone: digitos(primeiro(d, 'telefone', 'ddd_telefone_1', 'estabelecimento.telefone1')),
  };
}

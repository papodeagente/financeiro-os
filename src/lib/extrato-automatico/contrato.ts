/**
 * Contrato do extrato bancário (06/11/2026, E6 parte B).
 *
 * Plano aprovado: docs/plano-extrato-automatico.md. O Financeiro lê o
 * extrato direto da API do banco da própria agência, com o certificado e as
 * credenciais dela. Custo variável zero: nada de agregador pago.
 *
 * Regra de ouro (seção 3.3 do plano): o nome do banco não sai do
 * adaptador. O domínio conhece só `provedor: string` e as CAPACIDADES que o
 * adaptador declara; nenhuma regra, rota ou tela faz `if (provedor === ...)`.
 *
 * Dinheiro em centavos inteiros (regra do programa). A linha que entra em
 * `extrato_bancario` converte para reais no último passo, como o resto da
 * tabela espera.
 *
 * Puro: sem banco, sem rede, sem Node. A tela importa os tipos daqui.
 */

export type ProvedorId = string;

export interface TransacaoNormalizada {
  /** Identificador estável do banco. null = o banco não informa (aí vale a impressão digital). */
  idExterno: string | null;
  /** Data civil 'YYYY-MM-DD' do lançamento. */
  data: string;
  /** Centavos inteiros, com sinal: positivo entra, negativo sai. */
  valorCentavos: number;
  tipo: 'CREDITO' | 'DEBITO';
  descricao: string;
  /** Saldo depois do lançamento, em centavos, quando o banco informa. */
  saldoAposCentavos: number | null;
  /** Lançamento ainda não efetivado (reprocessável). */
  pendente: boolean;
  /** Categoria crua do banco, só para diagnóstico. */
  categoriaOrigem: string | null;
}

export interface SaldoNormalizado {
  disponivelCentavos: number;
  bloqueadoCentavos: number | null;
  limiteCentavos: number | null;
  /** 'YYYY-MM-DD'. */
  apuradoEm: string;
}

export interface JanelaColeta {
  /** 'YYYY-MM-DD' */
  de: string;
  /** 'YYYY-MM-DD' */
  ate: string;
}

export interface ResultadoColeta {
  transacoes: TransacaoNormalizada[];
  saldo: SaldoNormalizado | null;
  /** O adaptador já junta as páginas e conta quantas leu. */
  paginasLidas: number;
  /** Janela de fato coberta (pode ser menor que a pedida por limite do banco). */
  janelaCoberta: JanelaColeta;
}

/**
 * Credencial já decifrada. Vive só no escopo da chamada: nunca é gravada em
 * claro, registrada em log, anexada a erro nem devolvida por API.
 */
export interface CredencialDecifrada {
  clientId: string;
  clientSecret: string;
  certificadoPem: string | null;
  chavePrivadaPem: string | null;
  /** Campos opcionais do provedor (ex.: número da conta quando a integração cobre mais de uma). */
  extras: Record<string, string>;
}

export type MotivoFalha =
  | 'CREDENCIAL_INVALIDA'
  | 'CERTIFICADO_EXPIRADO'
  | 'CERTIFICADO_INVALIDO'
  | 'ESCOPO_INSUFICIENTE'
  | 'RATE_LIMIT'
  | 'JANELA_INVALIDA'
  | 'INDISPONIVEL'
  | 'DESCONHECIDO';

/** Falha da coleta com a frase pronta para a agência, já sem dado sensível. */
export class FalhaColeta extends Error {
  readonly motivo: MotivoFalha;
  readonly mensagemUsuario: string;
  /** Quanto esperar antes de tentar de novo, em segundos (quando o banco diz). */
  readonly aguardarSegundos: number | null;
  constructor(motivo: MotivoFalha, mensagemUsuario: string, aguardarSegundos: number | null = null) {
    super(mensagemUsuario);
    this.name = 'FalhaColeta';
    this.motivo = motivo;
    this.mensagemUsuario = mensagemUsuario;
    this.aguardarSegundos = aguardarSegundos;
  }
}

export function ehFalhaColeta(e: unknown): e is FalhaColeta {
  return e instanceof FalhaColeta || (typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'FalhaColeta'
    && typeof (e as { motivo?: unknown }).motivo === 'string');
}

export interface Capacidades {
  coletaAutomatica: boolean;
  importaArquivo: boolean;
  informaSaldo: boolean;
  informaIdExterno: boolean;
  /** Dias máximos entre as datas numa consulta (o orquestrador divide). */
  janelaMaximaDias: number | null;
  chamadasPorMinuto: number | null;
}

export interface CampoCredencial {
  chave: 'clientId' | 'clientSecret' | 'certificadoPem' | 'chavePrivadaPem' | `extra:${string}`;
  rotulo: string;
  tipo: 'texto' | 'segredo' | 'arquivo_pem';
  obrigatorio: boolean;
  /** Onde a agência pega isto, em uma frase simples. */
  ajuda: string;
  /** Extensões aceitas para arquivo (ex.: ['.crt']). */
  aceita?: string[];
}

/** Um passo do caminho no site do banco, para a tela de conexão. */
export interface PassoDoBanco {
  titulo: string;
  texto: string;
}

export interface ApresentacaoDoProvedor {
  nome: string;
  /** Passo a passo de onde a agência gera a integração no site do banco. */
  passos: PassoDoBanco[];
  /** Passo a passo da renovação do certificado (vazio = renovar é conectar de novo). */
  passosRenovacao: PassoDoBanco[];
  /** O aviso que mais evita chamado de suporte. */
  alerta: string | null;
  /** Por quanto tempo o certificado vale, em meses (para o texto da tela). */
  validadeCertificadoMeses: number | null;
}

/** Resposta crua de uma chamada ao banco (o cliente HTTP é injetável nos testes). */
export interface RespostaBanco {
  status: number;
  /** Corpo como texto (o adaptador decide se é JSON). */
  texto: string;
}

export interface PedidoBanco {
  metodo: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  corpo?: string;
  /** Material do mTLS: vai para o agente TLS desta chamada e só dele. */
  certificadoPem: string | null;
  chavePrivadaPem: string | null;
  tempoLimiteMs?: number;
}

export type ClienteHttpBanco = (pedido: PedidoBanco) => Promise<RespostaBanco>;

export interface AmbienteDoAdaptador {
  http: ClienteHttpBanco;
  /** Espera entre chamadas (respeitar o limite do banco). Nos testes, não espera. */
  esperar?: (ms: number) => Promise<void>;
  /** Relógio em ms. */
  agora?: () => number;
}

export interface AdaptadorBancario {
  readonly id: ProvedorId;
  readonly capacidades: Capacidades;
  readonly apresentacao: ApresentacaoDoProvedor;

  /** Campos que a tela de conexão desenha. Nenhuma tela por banco. */
  camposCredencial(): CampoCredencial[];

  /**
   * Confere o material localmente (arquivos trocados, compactado, vencido)
   * sem chamar o banco. Devolve a validade do certificado ('YYYY-MM-DD').
   */
  conferirMaterial?(cred: CredencialDecifrada, hoje: string): { expiraEm: string | null };

  /** Chamada de teste no cadastro. Erro = FalhaColeta com frase acionável. */
  validarCredencial?(cred: CredencialDecifrada, amb: AmbienteDoAdaptador): Promise<{ ok: true; contaDetectada: string | null; saldo: SaldoNormalizado | null }>;

  /** Só quando capacidades.coletaAutomatica. */
  coletar?(cred: CredencialDecifrada, janela: JanelaColeta, amb: AmbienteDoAdaptador): Promise<ResultadoColeta>;

  /** Só quando capacidades.importaArquivo. O arquivo baixado entra por aqui. */
  importar?(conteudo: string, nomeArquivo: string): Promise<ResultadoColeta>;

  /** Validade do material criptográfico ('YYYY-MM-DD'), quando há. */
  expiraEm?(cred: CredencialDecifrada): string | null;
}

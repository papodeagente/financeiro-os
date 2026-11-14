/**
 * Adaptador do Banco Inter Empresas (API Banking v2), conforme a
 * documentação oficial em developers.inter.co (lida em 06/11/2026):
 *
 * - Token: POST https://cdpj.partners.bancointer.com.br/oauth/v2/token,
 *   corpo x-www-form-urlencoded com client_id, client_secret,
 *   grant_type=client_credentials e scope. O token vale 60 minutos e deve ser
 *   reutilizado; limite de 5 chamadas por minuto.
 *   https://developers.inter.co/references/token
 * - Toda chamada usa mTLS: o certificado (.crt) e a chave (.key) que a
 *   agência baixa em "Minhas integrações".
 *   https://developers.inter.co/docs/introducao/autenticacao-mtls
 * - Extrato enriquecido: GET /banking/v2/extrato/completo?dataInicio&dataFim
 *   (YYYY-MM-DD, até 90 dias), paginação `pagina` / `tamanhoPagina` (até
 *   10.000), cada transação com `idTransacao` (o identificador estável que
 *   deduplica). Escopo extrato.read, 10 chamadas por minuto.
 *   https://developers.inter.co/references/banking
 * - Saldo: GET /banking/v2/saldo (mesmo escopo, 10 por minuto).
 * - Cabeçalho x-conta-corrente só quando a integração cobre mais de uma conta
 *   (apenas números, com o dígito, sem zeros à esquerda).
 * - Certificado vale 1 ano; a renovação abre 90 dias antes e mantém ClientId
 *   e ClientSecret. https://developers.inter.co/docs/introducao/como-renovar-uma-integracao
 *
 * Tudo o que é específico do Inter mora aqui. O resto do sistema só vê o
 * contrato (./contrato.ts).
 */
import { horaDeBrasilia } from '../agendador/nucleo';
import { addDias, paraCentavos, parseMoneyBR } from '../money';
import { conferirCertificadoEChave } from './material-certificado';
import {
  FalhaColeta, ehFalhaColeta,
  type AdaptadorBancario, type AmbienteDoAdaptador, type CredencialDecifrada, type JanelaColeta,
  type PedidoBanco, type RespostaBanco, type ResultadoColeta, type SaldoNormalizado, type TransacaoNormalizada,
} from './contrato';

const NOME = 'Inter';

export const INTER_HOSTS = {
  producao: 'https://cdpj.partners.bancointer.com.br',
  sandbox: 'https://cdpj-sandbox.partners.uatinter.co',
} as const;

/** Escopo de leitura do extrato e do saldo (o único que pedimos). */
export const INTER_ESCOPO = 'extrato.read';
export const INTER_JANELA_MAXIMA_DIAS = 90;
export const INTER_TAMANHO_PAGINA = 10_000;
/** Teto de páginas por janela: 10 chamadas/minuto não comportam mais que isso numa execução. */
const MAX_PAGINAS = 20;
/** Espaçamento mínimo entre chamadas da mesma credencial (10/min no extrato, 5/min no token). */
export const INTER_INTERVALO_BANKING_MS = 6_000;
export const INTER_INTERVALO_TOKEN_MS = 12_000;

function hostDoInter(): string {
  // Homologação: EXTRATO_INTER_SANDBOX=1 aponta para o sandbox oficial.
  return process.env.EXTRATO_INTER_SANDBOX === '1' ? INTER_HOSTS.sandbox : INTER_HOSTS.producao;
}

// ---------------------------------------------------------------------------
// Espaçamento por credencial (nunca global: duas agências não se atrasam).

const ultimaChamada = new Map<string, number>();

/** Só para testes: esquece o espaçamento acumulado. */
export function limparEspacamentoInter(): void {
  ultimaChamada.clear();
}

async function aguardarVez(chave: string, intervaloMs: number, amb: AmbienteDoAdaptador): Promise<void> {
  const agora = amb.agora ? amb.agora() : Date.now();
  const ultima = ultimaChamada.get(chave);
  const espera = ultima === undefined ? 0 : Math.max(0, ultima + intervaloMs - agora);
  ultimaChamada.set(chave, agora + espera);
  if (espera > 0) await (amb.esperar ?? (ms => new Promise<void>(r => setTimeout(r, ms))))(espera);
  if (ultimaChamada.size > 2_000) {
    for (const [k, v] of ultimaChamada) if (v + 60_000 < agora) ultimaChamada.delete(k);
  }
}

// ---------------------------------------------------------------------------
// Chamada e tradução de erro

function lerJson(texto: string): unknown {
  try { return JSON.parse(texto); } catch { return null; }
}

function corpoMenciona(texto: string, ...palavras: string[]): boolean {
  const t = texto.toLowerCase();
  return palavras.some(p => t.includes(p));
}

/** Erro de rede ou de TLS do cliente HTTP vira frase, sem o detalhe técnico. */
function falhaDeRede(e: unknown): FalhaColeta {
  if (ehFalhaColeta(e)) return e;
  const cod = String((e as { code?: unknown })?.code ?? '');
  const msg = String((e as { message?: unknown })?.message ?? '').toLowerCase();
  if (/ssl|tls|cert|eproto|handshake|alert/.test(`${cod} ${msg}`.toLowerCase())) {
    return new FalhaColeta('CERTIFICADO_INVALIDO', `O ${NOME} recusou o certificado. Confira se a integração está ativa no ${NOME} e se o certificado e a chave são da mesma integração.`);
  }
  return new FalhaColeta('INDISPONIVEL', `Não conseguimos falar com o ${NOME} agora. Tentamos de novo mais tarde, sozinhos.`, 900);
}

async function chamar(amb: AmbienteDoAdaptador, pedido: PedidoBanco): Promise<RespostaBanco> {
  try {
    return await amb.http({ tempoLimiteMs: 30_000, ...pedido });
  } catch (e) {
    throw falhaDeRede(e);
  }
}

function falhaDoStatus(r: RespostaBanco, etapa: 'token' | 'extrato' | 'saldo', comConta: boolean): FalhaColeta {
  const s = r.status;
  if (s === 429) return new FalhaColeta('RATE_LIMIT', `O ${NOME} pediu uma pausa nas consultas. A próxima leitura sai em alguns minutos.`, 60);
  if (s >= 500) return new FalhaColeta('INDISPONIVEL', `O ${NOME} está fora do ar ou em manutenção. Tentamos de novo mais tarde, sozinhos.`, 900);
  if (etapa === 'token') {
    if (corpoMenciona(r.texto, 'scope', 'escopo')) {
      return new FalhaColeta('ESCOPO_INSUFICIENTE', `A integração foi criada sem a permissão de consultar extrato e saldo. No ${NOME}, crie a integração marcando essa permissão.`);
    }
    return new FalhaColeta('CREDENCIAL_INVALIDA', `O ${NOME} recusou o ClientId ou o ClientSecret. Copie os dois de novo nos detalhes da integração, em Integrar › Minhas integrações.`);
  }
  if (s === 401) return new FalhaColeta('CREDENCIAL_INVALIDA', `O ${NOME} não aceitou mais esta integração. Ela pode ter sido cancelada ou expirada; confira em Integrar › Minhas integrações.`);
  if (s === 403) return new FalhaColeta('ESCOPO_INSUFICIENTE', `A integração não tem a permissão de consultar extrato e saldo. No ${NOME}, crie uma integração marcando essa permissão.`);
  if (s === 404 && comConta) return new FalhaColeta('CREDENCIAL_INVALIDA', `A conta corrente informada não pertence a esta integração. Confira o número da conta (só números, com o dígito).`);
  if (s === 400) {
    const j = lerJson(r.texto) as { violacoes?: { razao?: string; propriedade?: string }[] } | null;
    const conta = (j?.violacoes ?? []).some(v => /conta/i.test(String(v.propriedade ?? '')));
    if (conta) return new FalhaColeta('CREDENCIAL_INVALIDA', 'O número da conta corrente não foi aceito. Use só números, com o dígito, sem zeros à esquerda.');
    return new FalhaColeta('JANELA_INVALIDA', `O ${NOME} recusou o período pedido. Tentamos de novo com um período menor.`);
  }
  return new FalhaColeta('DESCONHECIDO', `O ${NOME} respondeu de um jeito inesperado (código ${s}). Tentamos de novo mais tarde.`, 900);
}

// ---------------------------------------------------------------------------
// Token, saldo e extrato

interface Sessao {
  token: string;
  cred: CredencialDecifrada;
  conta: string | null;
}

function contaDoExtra(cred: CredencialDecifrada): string | null {
  const bruta = String(cred.extras?.contaCorrente ?? '').replace(/\D+/g, '').replace(/^0+/, '');
  return bruta || null;
}

async function obterToken(cred: CredencialDecifrada, amb: AmbienteDoAdaptador): Promise<Sessao> {
  if (!cred.clientId.trim() || !cred.clientSecret.trim()) {
    throw new FalhaColeta('CREDENCIAL_INVALIDA', 'Preencha o ClientId e o ClientSecret da integração.');
  }
  await aguardarVez(`inter:token:${cred.clientId}`, INTER_INTERVALO_TOKEN_MS, amb);
  const corpo = new URLSearchParams({
    client_id: cred.clientId.trim(),
    client_secret: cred.clientSecret.trim(),
    grant_type: 'client_credentials',
    scope: INTER_ESCOPO,
  }).toString();
  const r = await chamar(amb, {
    metodo: 'POST',
    url: `${hostDoInter()}/oauth/v2/token`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    corpo,
    certificadoPem: cred.certificadoPem,
    chavePrivadaPem: cred.chavePrivadaPem,
  });
  if (r.status < 200 || r.status >= 300) throw falhaDoStatus(r, 'token', false);
  const j = lerJson(r.texto) as { access_token?: unknown; scope?: unknown } | null;
  const token = typeof j?.access_token === 'string' ? j.access_token : '';
  if (!token) throw new FalhaColeta('DESCONHECIDO', `O ${NOME} não devolveu o acesso. Tentamos de novo mais tarde.`, 900);
  if (typeof j?.scope === 'string' && j.scope.trim() && !j.scope.split(/\s+/).includes(INTER_ESCOPO)) {
    throw new FalhaColeta('ESCOPO_INSUFICIENTE', `A integração foi criada sem a permissão de consultar extrato e saldo. No ${NOME}, crie a integração marcando essa permissão.`);
  }
  return { token, cred, conta: contaDoExtra(cred) };
}

async function getBanking(s: Sessao, amb: AmbienteDoAdaptador, caminho: string, params: Record<string, string>, etapa: 'extrato' | 'saldo'): Promise<unknown> {
  await aguardarVez(`inter:banking:${s.cred.clientId}`, INTER_INTERVALO_BANKING_MS, amb);
  const qs = new URLSearchParams(params).toString();
  const headers: Record<string, string> = { Authorization: `Bearer ${s.token}`, Accept: 'application/json' };
  if (s.conta) headers['x-conta-corrente'] = s.conta;
  const r = await chamar(amb, {
    metodo: 'GET',
    url: `${hostDoInter()}/banking/v2${caminho}${qs ? `?${qs}` : ''}`,
    headers,
    certificadoPem: s.cred.certificadoPem,
    chavePrivadaPem: s.cred.chavePrivadaPem,
  });
  if (r.status < 200 || r.status >= 300) throw falhaDoStatus(r, etapa, !!s.conta);
  const j = lerJson(r.texto);
  if (j === null) throw new FalhaColeta('DESCONHECIDO', `O ${NOME} respondeu algo que não é um extrato. Tentamos de novo mais tarde.`, 900);
  return j;
}

/** 'DD/MM/AAAA' ou 'YYYY-MM-DD...' → 'YYYY-MM-DD' (ou '' se não reconhecer). */
export function dataDoInter(v: unknown): string {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return '';
}

function centavosDe(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseMoneyBR(String(v));
  return n === null || !Number.isFinite(n) ? null : paraCentavos(n);
}

export function lerSaldoInter(j: unknown, hoje: string): SaldoNormalizado | null {
  const o = (j ?? {}) as Record<string, unknown>;
  const disp = centavosDe(o.disponivel);
  if (disp === null) return null;
  const bloqueios = [o.bloqueadoCheque, o.bloqueadoJudicialmente, o.bloqueadoAdministrativo].map(centavosDe).filter((x): x is number => x !== null);
  return {
    disponivelCentavos: disp,
    bloqueadoCentavos: bloqueios.length ? bloqueios.reduce((a, b) => a + b, 0) : null,
    limiteCentavos: centavosDe(o.limite),
    apuradoEm: dataDoInter(o.dataReferencia) || hoje,
  };
}

function texto(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/** Uma transação do extrato enriquecido no formato do contrato. null = linha sem data ou valor. */
export function normalizarTransacaoInter(t: unknown): TransacaoNormalizada | null {
  const o = (t ?? {}) as Record<string, unknown>;
  const data = dataDoInter(o.dataTransacao) || dataDoInter(o.dataInclusao) || dataDoInter(o.dataEntrada);
  const bruto = centavosDe(o.valor);
  if (!data || bruto === null) return null;
  const debito = String(o.tipoOperacao ?? '').toUpperCase() === 'D';
  const valorCentavos = debito ? -Math.abs(bruto) : Math.abs(bruto);
  const detalhes = (o.detalhes ?? {}) as Record<string, unknown>;
  const id = texto(o.idTransacao) || texto(detalhes.endToEndId) || null;
  const titulo = texto(o.titulo);
  const desc = texto(o.descricao);
  const descricao = !titulo ? desc : !desc ? titulo
    : desc.toLowerCase().includes(titulo.toLowerCase()) ? desc
    : `${titulo} - ${desc}`;
  return {
    idExterno: id,
    data,
    valorCentavos,
    tipo: valorCentavos >= 0 ? 'CREDITO' : 'DEBITO',
    descricao: descricao || (debito ? 'Saída' : 'Entrada'),
    saldoAposCentavos: null,
    // O extrato do Inter traz o que já foi lançado na conta.
    pendente: false,
    categoriaOrigem: texto(o.tipoTransacao) || null,
  };
}

function diasEntre(de: string, ate: string): number {
  const a = Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10));
  const b = Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

async function coletarInter(cred: CredencialDecifrada, janela: JanelaColeta, amb: AmbienteDoAdaptador): Promise<ResultadoColeta> {
  const hoje = horaDeBrasilia(new Date(amb.agora ? amb.agora() : Date.now())).data;
  conferirCertificadoEChave(cred.certificadoPem, cred.chavePrivadaPem, hoje, NOME);
  // O Inter aceita até 90 dias entre as datas (dataInicio e dataFim inclusas).
  let de = janela.de;
  const ate = janela.ate > hoje ? hoje : janela.ate;
  if (diasEntre(de, ate) > INTER_JANELA_MAXIMA_DIAS - 1) de = addDias(ate, -(INTER_JANELA_MAXIMA_DIAS - 1));
  if (de > ate) return { transacoes: [], saldo: null, paginasLidas: 0, janelaCoberta: { de: ate, ate } };

  const sessao = await obterToken(cred, amb);
  const transacoes: TransacaoNormalizada[] = [];
  let pagina = 0;
  let paginasLidas = 0;
  for (;;) {
    const j = await getBanking(sessao, amb, '/extrato/completo', {
      dataInicio: de, dataFim: ate, pagina: String(pagina), tamanhoPagina: String(INTER_TAMANHO_PAGINA),
    }, 'extrato') as { transacoes?: unknown[]; totalPaginas?: unknown; ultimaPagina?: unknown };
    paginasLidas++;
    for (const t of Array.isArray(j.transacoes) ? j.transacoes : []) {
      const n = normalizarTransacaoInter(t);
      if (n) transacoes.push(n);
    }
    const total = Number(j.totalPaginas ?? 1);
    const ultima = j.ultimaPagina === true || !Number.isFinite(total) || pagina + 1 >= total;
    if (ultima) break;
    pagina++;
    if (pagina >= MAX_PAGINAS) {
      throw new FalhaColeta('JANELA_INVALIDA', `O período tem lançamentos demais para uma leitura. Tentamos de novo em partes menores.`);
    }
  }
  let saldo: SaldoNormalizado | null = null;
  try {
    saldo = lerSaldoInter(await getBanking(sessao, amb, '/saldo', {}, 'saldo'), hoje);
  } catch (e) {
    // Sem o saldo, o extrato continua valendo: a leitura não falha por isso.
    if (!ehFalhaColeta(e) || e.motivo === 'CREDENCIAL_INVALIDA') throw e;
  }
  return { transacoes, saldo, paginasLidas, janelaCoberta: { de, ate } };
}

export const adaptadorInter: AdaptadorBancario = {
  id: 'inter',
  capacidades: {
    coletaAutomatica: true,
    importaArquivo: false,
    informaSaldo: true,
    informaIdExterno: true,
    janelaMaximaDias: INTER_JANELA_MAXIMA_DIAS,
    chamadasPorMinuto: 10,
  },
  apresentacao: {
    nome: 'Banco Inter Empresas',
    passos: [
      { titulo: 'Entre no Internet Banking do Inter', texto: 'Use o acesso da empresa (conta PJ) em contadigital.bancointer.com.br, com o login pelo QR Code.' },
      { titulo: 'Crie a integração', texto: 'No menu Integrar (em algumas contas aparece como Soluções para sua empresa), clique em Nova integração. Dê um nome (por exemplo, EnturOS Financeiro) e, em Permissões, marque só Consultar extrato e saldo, dentro de API Banking. Não marque mais nada.' },
      { titulo: 'Preencha o formulário do Inter', texto: 'Clique em Continuar, preencha o formulário sobre a empresa e envie. A integração fica Em validação até o Inter aprovar; chega um e-mail quando terminar.' },
      { titulo: 'Baixe a chave e o certificado', texto: 'Em Integrar › Minhas integrações, nos três pontos da coluna Ações, escolha Download chave e certificado. Anote o ClientId e o ClientSecret que aparecem na tela: o Inter não mostra de novo.' },
      { titulo: 'Descompacte e envie aqui', texto: 'O Inter entrega um arquivo compactado. Descompacte e envie os dois arquivos separados: o que termina em .crt no campo do certificado e o que termina em .key no campo da chave.' },
    ],
    passosRenovacao: [
      { titulo: 'Abra Minhas integrações', texto: 'No Internet Banking do Inter, menu Integrar › Minhas integrações. A renovação abre 90 dias antes do vencimento (e também depois que vence).' },
      { titulo: 'Renove a integração', texto: 'Nos três pontos da coluna Ações, escolha Renovar. O ClientId, o ClientSecret e a permissão continuam os mesmos.' },
      { titulo: 'Baixe e envie os arquivos novos', texto: 'O Inter entrega um certificado (.crt) e uma chave (.key) novos. Descompacte e envie os dois aqui; o resto fica como está.' },
    ],
    alerta: 'Marque só a permissão Consultar extrato e saldo. Com ela o Financeiro lê o extrato e não consegue pagar, transferir nem mexer na conta.',
    validadeCertificadoMeses: 12,
  },
  camposCredencial: () => [
    { chave: 'clientId', rotulo: 'ClientId', tipo: 'texto', obrigatorio: true, ajuda: 'Aparece quando você baixa a chave e o certificado, e depois em Detalhes da integração.' },
    { chave: 'clientSecret', rotulo: 'ClientSecret', tipo: 'segredo', obrigatorio: true, ajuda: 'Aparece uma vez só, junto com o ClientId, quando você baixa a chave e o certificado.' },
    { chave: 'certificadoPem', rotulo: 'Certificado (arquivo .crt)', tipo: 'arquivo_pem', obrigatorio: true, aceita: ['.crt', '.pem'], ajuda: 'O arquivo que termina em .crt, de dentro do ZIP baixado em Download chave e certificado.' },
    { chave: 'chavePrivadaPem', rotulo: 'Chave (arquivo .key)', tipo: 'arquivo_pem', obrigatorio: true, aceita: ['.key', '.pem'], ajuda: 'O arquivo que termina em .key, do mesmo ZIP do certificado.' },
    { chave: 'extra:contaCorrente', rotulo: 'Número da conta corrente', tipo: 'texto', obrigatorio: false, ajuda: 'Só se a integração cobrir mais de uma conta. Só números, com o dígito.' },
  ],
  conferirMaterial(cred, hoje) {
    return { expiraEm: conferirCertificadoEChave(cred.certificadoPem, cred.chavePrivadaPem, hoje, NOME).expiraEm };
  },
  async validarCredencial(cred, amb) {
    const hoje = horaDeBrasilia(new Date(amb.agora ? amb.agora() : Date.now())).data;
    conferirCertificadoEChave(cred.certificadoPem, cred.chavePrivadaPem, hoje, NOME);
    const sessao = await obterToken(cred, amb);
    const saldo = lerSaldoInter(await getBanking(sessao, amb, '/saldo', {}, 'saldo'), hoje);
    return { ok: true, contaDetectada: sessao.conta, saldo };
  },
  coletar: coletarInter,
  expiraEm(cred) {
    try {
      return conferirCertificadoEChave(cred.certificadoPem, cred.chavePrivadaPem, '0000-00-00', NOME).expiraEm;
    } catch {
      return null;
    }
  },
};

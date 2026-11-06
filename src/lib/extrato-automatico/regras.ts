/**
 * Regras puras do extrato automático (06/11/2026): que período ler, quando
 * tentar de novo depois de uma falha, e como contar à agência o estado da
 * conexão. Sem banco, sem rede: a tela e o servidor usam as mesmas frases.
 */
import { addDias } from '../money';
import { horaDeBrasilia } from '../agendador/nucleo';
import type { JanelaColeta, MotivoFalha } from './contrato';

export type StatusConexao = 'ATIVA' | 'ATENCAO' | 'EXPIRADA' | 'DESCONECTADA';

/** Dias relidos em cada leitura: o banco às vezes ajusta lançamentos recentes. */
export const SOBREPOSICAO_DIAS = 3;
/** Primeira leitura: os últimos 90 dias (o teto de uma consulta no Inter). */
export const PRIMEIRA_CARGA_DIAS = 90;
/** Depois de muito tempo parado, até onde voltar para recuperar o buraco. */
export const TETO_RECUPERACAO_DIAS = 365;
/** Falhas seguidas que viram "Atenção" e aviso no sino. */
export const FALHAS_PARA_ATENCAO = 3;
/** Uma leitura parada há mais que isto é considerada abandonada (o processo caiu). */
export const MINUTOS_PARA_ABANDONAR = 15;
export const AVISO_CERTIFICADO_DIAS = 30;
export const URGENCIA_CERTIFICADO_DIAS = 7;

export function diasEntre(de: string, ate: string): number {
  const a = Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10));
  const b = Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/**
 * Período desta leitura: do fim da última leitura que deu certo, menos a
 * sobreposição, até hoje. A sobreposição não duplica nada: a chave de cada
 * linha (identificador do banco) absorve o que já entrou.
 */
export function janelaDaSincronizacao(p: {
  ultimaJanelaAte: string | null;
  hoje: string;
  sobreposicaoDias?: number;
  primeiraCargaDias?: number;
  tetoDias?: number;
}): JanelaColeta {
  const sobre = p.sobreposicaoDias ?? SOBREPOSICAO_DIAS;
  const primeira = p.primeiraCargaDias ?? PRIMEIRA_CARGA_DIAS;
  const teto = p.tetoDias ?? TETO_RECUPERACAO_DIAS;
  const piso = addDias(p.hoje, -(teto - 1));
  let de = p.ultimaJanelaAte ? addDias(p.ultimaJanelaAte > p.hoje ? p.hoje : p.ultimaJanelaAte, -sobre) : addDias(p.hoje, -(primeira - 1));
  if (de < piso) de = piso;
  return { de, ate: p.hoje };
}

/**
 * Divide o período no máximo de dias que o banco aceita por consulta, do mais
 * antigo para o mais novo: se a leitura parar no meio, o que entrou é
 * contínuo e a próxima continua de onde parou.
 */
export function dividirJanela(j: JanelaColeta, maxDias: number | null): JanelaColeta[] {
  if (!maxDias || maxDias <= 0 || j.de > j.ate) return j.de > j.ate ? [] : [j];
  const blocos: JanelaColeta[] = [];
  let de = j.de;
  while (de <= j.ate) {
    const fim = addDias(de, maxDias - 1);
    const ate = fim < j.ate ? fim : j.ate;
    blocos.push({ de, ate });
    de = addDias(ate, 1);
  }
  return blocos;
}

/** Quando ler de novo depois de uma leitura que deu certo. */
export function proximaLeituraAposSucesso(agora: Date, vezesPorDia: number): Date {
  const v = Math.min(4, Math.max(1, Math.round(vezesPorDia || 1)));
  return new Date(agora.getTime() + (24 / v) * 3_600_000);
}

export interface DecisaoDeFalha {
  status: StatusConexao;
  falhasConsecutivas: number;
  /** null = não agenda mais (precisa de ação da agência). */
  proximaEm: Date | null;
  /** Avisar no sino agora? */
  avisar: boolean;
}

/**
 * Depois de uma falha: 1ª tenta em 1 hora, 2ª em 4 horas, da 3ª em diante em
 * 24 horas e a conexão fica em Atenção. Credencial recusada ou certificado
 * vencido param a leitura (só a agência resolve). Pausa pedida pelo banco
 * não conta como falha.
 */
export function decidirAposFalha(p: {
  motivo: MotivoFalha;
  falhasAntes: number;
  aguardarSegundos: number | null;
  agora: Date;
}): DecisaoDeFalha {
  if (p.motivo === 'CERTIFICADO_EXPIRADO' || p.motivo === 'CREDENCIAL_INVALIDA' || p.motivo === 'CERTIFICADO_INVALIDO' || p.motivo === 'ESCOPO_INSUFICIENTE') {
    return { status: 'EXPIRADA', falhasConsecutivas: p.falhasAntes + 1, proximaEm: null, avisar: true };
  }
  if (p.motivo === 'RATE_LIMIT') {
    const s = Math.max(60, p.aguardarSegundos ?? 60);
    return {
      status: p.falhasAntes >= FALHAS_PARA_ATENCAO ? 'ATENCAO' : 'ATIVA',
      falhasConsecutivas: p.falhasAntes,
      proximaEm: new Date(p.agora.getTime() + s * 1000),
      avisar: false,
    };
  }
  const n = p.falhasAntes + 1;
  const horas = n === 1 ? 1 : n === 2 ? 4 : 24;
  return {
    status: n >= FALHAS_PARA_ATENCAO ? 'ATENCAO' : 'ATIVA',
    falhasConsecutivas: n,
    proximaEm: new Date(p.agora.getTime() + horas * 3_600_000),
    avisar: n === FALHAS_PARA_ATENCAO,
  };
}

// ---------------------------------------------------------------------------
// Saúde da conexão, em palavras

export interface EstadoParaSaude {
  status: StatusConexao;
  ultimaSincronizacaoEm: string | null;
  falhasConsecutivas: number;
  ultimoErro: { motivo?: string; mensagem?: string } | null;
  expiraEm: string | null;
  proximaSincronizacaoEm: string | null;
}

export type NivelSaude = 'ok' | 'atencao' | 'critico' | 'desligado';

export interface AvisoCertificado {
  dias: number;
  nivel: 'aviso' | 'urgente' | 'vencido';
  frase: string;
}

export interface Saude {
  nivel: NivelSaude;
  titulo: string;
  frase: string;
  certificado: AvisoCertificado | null;
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

/** "hoje às 06:12", "ontem às 23:40", "em 03/11 às 08:00" (horário de Brasília). */
export function quandoFoi(iso: string, agora: Date): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const b = horaDeBrasilia(t);
  const hoje = horaDeBrasilia(agora).data;
  const hora = `${String(b.hora).padStart(2, '0')}:${String(b.minuto).padStart(2, '0')}`;
  if (b.data === hoje) return `hoje às ${hora}`;
  if (b.data === addDias(hoje, -1)) return `ontem às ${hora}`;
  return `em ${dataBR(b.data).slice(0, 5)} às ${hora}`;
}

/** "hoje às 18:00", "amanhã às 09:00", "em 09/11 às 09:00" (horário de Brasília). */
export function quandoSera(iso: string, agora: Date): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  if (t.getTime() <= agora.getTime()) return 'em instantes';
  const b = horaDeBrasilia(t);
  const hoje = horaDeBrasilia(agora).data;
  const hora = `${String(b.hora).padStart(2, '0')}:${String(b.minuto).padStart(2, '0')}`;
  if (b.data === hoje) return `hoje às ${hora}`;
  if (b.data === addDias(hoje, 1)) return `amanhã às ${hora}`;
  return `em ${dataBR(b.data).slice(0, 5)} às ${hora}`;
}

export function avisoDoCertificado(expiraEm: string | null, hoje: string): AvisoCertificado | null {
  if (!expiraEm) return null;
  const dias = diasEntre(hoje, expiraEm.slice(0, 10));
  if (dias < 0) return { dias, nivel: 'vencido', frase: `O certificado venceu em ${dataBR(expiraEm)}. Renove a integração no banco e envie os arquivos novos.` };
  if (dias <= URGENCIA_CERTIFICADO_DIAS) {
    const quando = dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`;
    return { dias, nivel: 'urgente', frase: `O certificado vence ${quando} (${dataBR(expiraEm)}). Renove agora no banco e envie os arquivos novos, ou o extrato para de chegar.` };
  }
  if (dias <= AVISO_CERTIFICADO_DIAS) {
    return { dias, nivel: 'aviso', frase: `O certificado vence em ${dias} dias (${dataBR(expiraEm)}). A renovação já está liberada no banco.` };
  }
  return null;
}

/** O que a tela mostra para uma conexão. */
export function saudeDaConexao(c: EstadoParaSaude | null, agora: Date): Saude {
  const hoje = horaDeBrasilia(agora).data;
  if (!c || c.status === 'DESCONECTADA') {
    return { nivel: 'desligado', titulo: 'Sem conexão automática', frase: 'O extrato desta conta entra por arquivo, na conciliação.', certificado: null };
  }
  const certificado = avisoDoCertificado(c.expiraEm, hoje);
  const ultima = c.ultimaSincronizacaoEm ? quandoFoi(c.ultimaSincronizacaoEm, agora) : '';
  if (c.status === 'EXPIRADA' || certificado?.nivel === 'vencido') {
    return {
      nivel: 'critico',
      titulo: 'Expirada, reconecte',
      frase: `${c.ultimoErro?.mensagem || certificado?.frase || 'A conexão parou.'} Enquanto isso, a importação por arquivo continua funcionando.`,
      certificado,
    };
  }
  if (c.status === 'ATENCAO') {
    const n = c.falhasConsecutivas;
    return {
      nivel: 'atencao',
      titulo: `Atenção, ${n} ${n === 1 ? 'falha seguida' : 'falhas seguidas'}`,
      frase: `${c.ultimoErro?.mensagem || 'As últimas leituras não deram certo.'}${ultima ? ` A última leitura boa foi ${ultima}.` : ''}`,
      certificado,
    };
  }
  if (!c.ultimaSincronizacaoEm) {
    return {
      nivel: c.falhasConsecutivas > 0 ? 'atencao' : 'ok',
      titulo: 'Conectada',
      frase: c.falhasConsecutivas > 0 && c.ultimoErro?.mensagem
        ? `A primeira leitura ainda não deu certo: ${c.ultimoErro.mensagem}`
        : 'A primeira leitura do extrato sai em instantes.',
      certificado,
    };
  }
  return {
    nivel: certificado ? 'atencao' : c.falhasConsecutivas > 0 ? 'atencao' : 'ok',
    titulo: `Conectada, lida ${ultima}`,
    frase: c.falhasConsecutivas > 0 && c.ultimoErro?.mensagem
      ? `A última tentativa falhou: ${c.ultimoErro.mensagem} Tentamos de novo sozinhos.`
      : 'O extrato chega sozinho e entra na conciliação.',
    certificado,
  };
}

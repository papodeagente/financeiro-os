/**
 * ENVIO AGENDADO DE RELATÓRIO (E7, G3), regras puras.
 *
 * A agência escolhe um relatório com os filtros da tela, a frequência
 * (diário, semanal, mensal), a hora, o período que cada envio cobre
 * ("ontem", "semana passada", "mês passado"...) e os e-mails. Em cada envio
 * o Financeiro monta o relatório, guarda uma CÓPIA dele atrás de um link de
 * leitura (token revogável, com validade, sem login, só aquele relatório) e
 * pede ao CRM que mande o e-mail. Sem CRM ligado, o link fica na tela (e no
 * sino) para a agência repassar.
 *
 * Horários sempre de Brasília.
 */
export const FREQUENCIAS = ['diario', 'semanal', 'mensal'] as const;
export type Frequencia = (typeof FREQUENCIAS)[number];
export const ROTULO_FREQUENCIA: Record<Frequencia, string> = { diario: 'Todo dia', semanal: 'Toda semana', mensal: 'Todo mês' };

/** Que período cada envio cobre, contado a partir do dia do envio. */
export const PERIODOS_DO_ENVIO = ['ontem', 'ultimos_7', 'semana_anterior', 'mes_atual', 'mes_anterior', 'ultimos_30', 'ano_atual'] as const;
export type PeriodoDoEnvio = (typeof PERIODOS_DO_ENVIO)[number];
export const ROTULO_PERIODO_DO_ENVIO: Record<PeriodoDoEnvio, string> = {
  ontem: 'Ontem',
  ultimos_7: 'Últimos 7 dias',
  semana_anterior: 'Semana passada (segunda a domingo)',
  mes_atual: 'Mês atual até ontem',
  mes_anterior: 'Mês passado',
  ultimos_30: 'Últimos 30 dias',
  ano_atual: 'Ano atual até ontem',
};

export const DIAS_DA_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'] as const;

export const FORMATOS_DO_ANEXO = ['xlsx', 'pdf'] as const;
export type FormatoDoAnexo = (typeof FORMATOS_DO_ANEXO)[number];

/** Relatórios que podem ser agendados (o registro fica em servidor.ts). */
export const RELATORIOS_AGENDAVEIS = ['vendas'] as const;
export type RelatorioAgendavel = (typeof RELATORIOS_AGENDAVEIS)[number];

export const LIMITES_DO_AGENDAMENTO = { destinatarios: 20, nome: 120, validadeMinima: 1, validadeMaxima: 90, validadePadrao: 30, linhasNoLink: 5000 } as const;

export interface DadosDoAgendamento {
  nome: string;
  relatorio: RelatorioAgendavel;
  /** Filtros salvos, na forma da URL do relatório (sem as datas). */
  consulta: string;
  frequencia: Frequencia;
  /** 0 (domingo) a 6 (sábado), no semanal. */
  dia_semana: number;
  /** 1 a 28, ou 0 = último dia do mês, no mensal. */
  dia_mes: number;
  /** Hora de Brasília (6 a 22). */
  hora: number;
  periodo: PeriodoDoEnvio;
  formato: FormatoDoAnexo;
  destinatarios: string[];
  /** Dias que o link de leitura vale. */
  validade_dias: number;
  ativo: boolean;
}

const EMAIL = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[a-z]{2,}$/i;

/** Lista de e-mails escrita de qualquer jeito (vírgula, ponto e vírgula, linha) → limpa, sem repetir. */
export function lerDestinatarios(v: unknown): { emails: string[]; invalidos: string[] } {
  const brutos = Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[\s,;]+/);
  const emails: string[] = [];
  const invalidos: string[] = [];
  for (const b of brutos) {
    const e = b.trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL.test(e) || e.length > 200) { invalidos.push(b.trim()); continue; }
    if (!emails.includes(e)) emails.push(e);
  }
  return { emails, invalidos };
}

/** Tira as datas da consulta salva (o período vem de cada envio). */
export function consultaSemDatas(consulta: string): string {
  const q = new URLSearchParams(consulta.replace(/^\?/, ''));
  q.delete('de'); q.delete('ate'); q.delete('formato');
  return q.toString();
}

const inteiro = (v: unknown, padrao: number) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : padrao);

/** Confere o que a tela mandou. Devolve os erros por campo, ou os dados limpos. */
export function validarAgendamento(e: Record<string, unknown>): { ok: true; dados: DadosDoAgendamento } | { ok: false; erros: Record<string, string> } {
  const erros: Record<string, string> = {};
  const nome = String(e.nome ?? '').trim().slice(0, LIMITES_DO_AGENDAMENTO.nome);
  if (nome.length < 3) erros.nome = 'Dê um nome ao envio (por exemplo, "Vendas da semana para a diretoria").';
  const relatorio = (RELATORIOS_AGENDAVEIS as readonly string[]).includes(String(e.relatorio)) ? (e.relatorio as RelatorioAgendavel) : null;
  if (!relatorio) erros.relatorio = 'Relatório desconhecido.';
  const frequencia = (FREQUENCIAS as readonly string[]).includes(String(e.frequencia)) ? (e.frequencia as Frequencia) : null;
  if (!frequencia) erros.frequencia = 'Escolha de quanto em quanto tempo enviar.';
  const dia_semana = inteiro(e.dia_semana, 1);
  if (frequencia === 'semanal' && (dia_semana < 0 || dia_semana > 6)) erros.dia_semana = 'Escolha o dia da semana.';
  const dia_mes = inteiro(e.dia_mes, 1);
  if (frequencia === 'mensal' && (dia_mes < 0 || dia_mes > 28)) erros.dia_mes = 'Escolha um dia de 1 a 28, ou o último dia do mês.';
  const hora = inteiro(e.hora, 7);
  if (hora < 6 || hora > 22) erros.hora = 'Escolha uma hora entre 6h e 22h.';
  const periodo = (PERIODOS_DO_ENVIO as readonly string[]).includes(String(e.periodo)) ? (e.periodo as PeriodoDoEnvio) : null;
  if (!periodo) erros.periodo = 'Escolha o período que cada envio cobre.';
  const formato = (FORMATOS_DO_ANEXO as readonly string[]).includes(String(e.formato)) ? (e.formato as FormatoDoAnexo) : 'xlsx';
  const { emails, invalidos } = lerDestinatarios(e.destinatarios);
  if (invalidos.length) erros.destinatarios = `E-mail inválido: ${invalidos.slice(0, 3).join(', ')}.`;
  else if (!emails.length) erros.destinatarios = 'Diga para quem enviar (um ou mais e-mails).';
  else if (emails.length > LIMITES_DO_AGENDAMENTO.destinatarios) erros.destinatarios = `Até ${LIMITES_DO_AGENDAMENTO.destinatarios} e-mails por envio.`;
  const validade = inteiro(e.validade_dias, LIMITES_DO_AGENDAMENTO.validadePadrao);
  if (validade < LIMITES_DO_AGENDAMENTO.validadeMinima || validade > LIMITES_DO_AGENDAMENTO.validadeMaxima) erros.validade_dias = 'O link vale de 1 a 90 dias.';
  if (Object.keys(erros).length) return { ok: false, erros };
  return {
    ok: true,
    dados: {
      nome, relatorio: relatorio!, consulta: consultaSemDatas(String(e.consulta ?? '')).slice(0, 2000), frequencia: frequencia!,
      dia_semana: frequencia === 'semanal' ? dia_semana : 1, dia_mes: frequencia === 'mensal' ? dia_mes : 1, hora,
      periodo: periodo!, formato, destinatarios: emails, validade_dias: validade, ativo: e.ativo !== false,
    },
  };
}

// ============================================================
// Datas (Brasília)
// ============================================================

/** Data e hora de Brasília (UTC−3, sem horário de verão desde 2019). */
export function brasilia(agora: Date): { data: string; hora: number; minuto: number; diaSemana: number } {
  const b = new Date(agora.getTime() - 3 * 3600_000);
  return { data: b.toISOString().slice(0, 10), hora: b.getUTCHours(), minuto: b.getUTCMinutes(), diaSemana: b.getUTCDay() };
}

/** Instante (UTC) de uma data e hora de Brasília. */
export function instanteDeBrasilia(data: string, hora: number): Date {
  return new Date(Date.parse(`${data}T${String(hora).padStart(2, '0')}:00:00Z`) + 3 * 3600_000);
}

export function somarDias(iso: string, dias: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

function ultimoDiaDoMes(ano: number, mes1a12: number): number {
  return new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();
}

/** O dia de envio daquele mês (0 = último dia). */
function diaDoEnvioNoMes(ano: number, mes1a12: number, diaMes: number): string {
  const d = diaMes === 0 ? ultimoDiaDoMes(ano, mes1a12) : Math.min(diaMes, ultimoDiaDoMes(ano, mes1a12));
  return `${ano}-${String(mes1a12).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** O próximo envio estritamente depois de `agora`. */
export function proximoEnvio(a: Pick<DadosDoAgendamento, 'frequencia' | 'dia_semana' | 'dia_mes' | 'hora'>, agora: Date): Date {
  const b = brasilia(agora);
  if (a.frequencia === 'diario') {
    const hoje = instanteDeBrasilia(b.data, a.hora);
    return hoje > agora ? hoje : instanteDeBrasilia(somarDias(b.data, 1), a.hora);
  }
  if (a.frequencia === 'semanal') {
    for (let i = 0; i <= 7; i++) {
      const dia = somarDias(b.data, i);
      const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
      if (semana !== a.dia_semana) continue;
      const t = instanteDeBrasilia(dia, a.hora);
      if (t > agora) return t;
    }
    return instanteDeBrasilia(somarDias(b.data, 7), a.hora);
  }
  const [ano, mes] = b.data.split('-').map(Number);
  for (let k = 0; k < 3; k++) {
    const m = ((mes - 1 + k) % 12) + 1;
    const y = ano + Math.floor((mes - 1 + k) / 12);
    const t = instanteDeBrasilia(diaDoEnvioNoMes(y, m, a.dia_mes), a.hora);
    if (t > agora) return t;
  }
  return instanteDeBrasilia(somarDias(b.data, 31), a.hora);
}

/** O período que o envio do dia `dataDoEnvio` cobre (datas de Brasília, inclusive). */
export function periodoDoEnvio(p: PeriodoDoEnvio, dataDoEnvio: string): { de: string; ate: string } {
  const ontem = somarDias(dataDoEnvio, -1);
  const [ano, mes] = dataDoEnvio.split('-').map(Number);
  switch (p) {
    case 'ontem': return { de: ontem, ate: ontem };
    case 'ultimos_7': return { de: somarDias(dataDoEnvio, -7), ate: ontem };
    case 'ultimos_30': return { de: somarDias(dataDoEnvio, -30), ate: ontem };
    case 'semana_anterior': {
      const semana = new Date(`${dataDoEnvio}T12:00:00Z`).getUTCDay();
      const segundaDestaSemana = somarDias(dataDoEnvio, -((semana + 6) % 7));
      return { de: somarDias(segundaDestaSemana, -7), ate: somarDias(segundaDestaSemana, -1) };
    }
    case 'mes_atual': {
      const primeiro = `${dataDoEnvio.slice(0, 7)}-01`;
      // No dia 1 o "mês atual até ontem" seria vazio: cobre o mês que acabou.
      return primeiro === dataDoEnvio ? periodoDoEnvio('mes_anterior', dataDoEnvio) : { de: primeiro, ate: ontem };
    }
    case 'mes_anterior': {
      const m = mes === 1 ? 12 : mes - 1;
      const y = mes === 1 ? ano - 1 : ano;
      const mm = String(m).padStart(2, '0');
      return { de: `${y}-${mm}-01`, ate: `${y}-${mm}-${String(ultimoDiaDoMes(y, m)).padStart(2, '0')}` };
    }
    case 'ano_atual': {
      const primeiro = `${ano}-01-01`;
      return primeiro === dataDoEnvio ? { de: `${ano - 1}-01-01`, ate: `${ano - 1}-12-31` } : { de: primeiro, ate: ontem };
    }
  }
}

/** "Toda segunda-feira às 7h, com a semana passada". */
export function descricaoDoAgendamento(a: Pick<DadosDoAgendamento, 'frequencia' | 'dia_semana' | 'dia_mes' | 'hora' | 'periodo'>): string {
  const quando = a.frequencia === 'diario' ? 'Todo dia'
    : a.frequencia === 'semanal' ? `Toda ${DIAS_DA_SEMANA[a.dia_semana]}`.replace('Toda domingo', 'Todo domingo').replace('Toda sábado', 'Todo sábado')
      : a.dia_mes === 0 ? 'Todo último dia do mês' : `Todo dia ${a.dia_mes}`;
  return `${quando} às ${a.hora}h, com ${ROTULO_PERIODO_DO_ENVIO[a.periodo].toLowerCase().replace(' (segunda a domingo)', '')}`;
}

// ============================================================
// Link de leitura
// ============================================================

/** Formato do token antes de ir ao banco (43 letras base64url). */
export function tokenTemFormato(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,64}$/.test(token);
}

export type SituacaoDoLink = 'valendo' | 'vencido' | 'revogado';
export function situacaoDoLink(l: { expira_em: string | Date; revogado_em: string | Date | null }, agora: Date): SituacaoDoLink {
  if (l.revogado_em) return 'revogado';
  return new Date(l.expira_em).getTime() <= agora.getTime() ? 'vencido' : 'valendo';
}

export function urlDaLeitura(base: string, token: string): string {
  return `${base.replace(/\/+$/, '')}/r/${token}`;
}

'use client';

import * as React from 'react';

import { RecordSheet } from '@/components/fin/RecordSheet';
import { Field } from '@/components/fin/Field';
import { Callout } from '@/components/fin/Callout';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/lib/toast';
import {
  DIAS_DA_SEMANA, LIMITES_DO_AGENDAMENTO, PERIODOS_DO_ENVIO, ROTULO_PERIODO_DO_ENVIO, descricaoDoAgendamento, lerDestinatarios,
  type DadosDoAgendamento, type Frequencia, type PeriodoDoEnvio,
} from '@/lib/relatorios-agendados/regras';

/**
 * Agendar (ou mudar) o envio de um relatório por e-mail (E7, G3). Os filtros
 * vêm da tela do relatório; aqui a pessoa diz quando, que período cada envio
 * cobre, para quem e por quanto tempo o link de leitura vale.
 */

export const CAMPO_SELECT = 'h-11 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)] lg:h-10';

export interface EnvioParaEditar extends DadosDoAgendamento { id: string }

const FREQ: Array<{ valor: Frequencia; rotulo: string }> = [
  { valor: 'diario', rotulo: 'Todo dia' }, { valor: 'semanal', rotulo: 'Toda semana' }, { valor: 'mensal', rotulo: 'Todo mês' },
];
const PERIODO_SUGERIDO: Record<Frequencia, PeriodoDoEnvio> = { diario: 'ontem', semanal: 'semana_anterior', mensal: 'mes_anterior' };

export function FormularioDeEnvio({
  aberto, onFechar, onSalvo, consulta, nomeSugerido, resumoDosFiltros, crmLigado, existente,
}: {
  aberto: boolean;
  onFechar: () => void;
  onSalvo: () => void;
  /** Os filtros salvos, na forma da URL do relatório. */
  consulta: string;
  nomeSugerido: string;
  /** Os filtros por extenso, para a pessoa conferir o que vai. */
  resumoDosFiltros: string;
  crmLigado: boolean | null;
  existente?: EnvioParaEditar | null;
}) {
  const [nome, setNome] = React.useState(existente?.nome ?? nomeSugerido);
  const [frequencia, setFrequencia] = React.useState<Frequencia>(existente?.frequencia ?? 'semanal');
  const [diaSemana, setDiaSemana] = React.useState(existente?.dia_semana ?? 1);
  const [diaMes, setDiaMes] = React.useState(existente?.dia_mes ?? 1);
  const [hora, setHora] = React.useState(existente?.hora ?? 7);
  const [periodo, setPeriodo] = React.useState<PeriodoDoEnvio>(existente?.periodo ?? 'semana_anterior');
  const [periodoTocado, setPeriodoTocado] = React.useState(Boolean(existente));
  const [formato, setFormato] = React.useState<'xlsx' | 'pdf'>(existente?.formato ?? 'xlsx');
  const [emails, setEmails] = React.useState((existente?.destinatarios ?? []).join(', '));
  const [validade, setValidade] = React.useState(existente?.validade_dias ?? LIMITES_DO_AGENDAMENTO.validadePadrao);
  const [erros, setErros] = React.useState<Record<string, string>>({});
  const [salvando, setSalvando] = React.useState(false);

  const trocarFrequencia = (f: Frequencia) => {
    setFrequencia(f);
    if (!periodoTocado) setPeriodo(PERIODO_SUGERIDO[f]);
  };
  const lidos = lerDestinatarios(emails);
  const quando = descricaoDoAgendamento({ frequencia, dia_semana: diaSemana, dia_mes: diaMes, hora, periodo });

  async function salvar() {
    setSalvando(true);
    setErros({});
    try {
      const corpo = {
        nome, relatorio: 'vendas', consulta, frequencia, dia_semana: diaSemana, dia_mes: diaMes, hora, periodo, formato,
        destinatarios: emails, validade_dias: validade, ativo: true,
      };
      const r = await fetch(existente ? `/api/relatorios/agendados/${encodeURIComponent(existente.id)}` : '/api/relatorios/agendados', {
        method: existente ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        if (j?.erros) setErros(j.erros);
        toast.error('Não foi possível salvar o envio.', j?.error ?? '');
        return;
      }
      toast.success(existente ? 'Envio alterado' : 'Envio agendado', quando + '.');
      onSalvo();
    } catch {
      toast.error('Sem conexão com o servidor.', 'Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={o => { if (!o) onFechar(); }}
      largura={640}
      titulo={existente ? 'Mudar envio agendado' : 'Agendar envio por e-mail'}
      descricao="O relatório sai com os filtros de agora e o período de cada envio."
      resumo={<span className="fin-t-caption text-[var(--fin-text-2)]">{quando}, para {lidos.emails.length || 'ninguém ainda'}{lidos.emails.length === 1 ? ' e-mail' : lidos.emails.length > 1 ? ' e-mails' : ''}.</span>}
      acaoPrimaria={{ rotulo: salvando ? 'Salvando…' : existente ? 'Salvar mudanças' : 'Agendar envio', onClick: salvar, carregando: salvando }}
      acaoSecundaria={{ rotulo: 'Cancelar', onClick: onFechar }}
      sujo
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        {crmLigado === false ? (
          <Callout tom="info">
            O CRM não está ligado: o e-mail não sai sozinho. A cada envio, um link de leitura fica pronto em Relatórios › Envios agendados para você copiar e mandar.
          </Callout>
        ) : null}
        <div className="rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] px-[var(--fin-s-3)] py-[var(--fin-s-2)]">
          <p className="fin-t-caption font-medium text-[var(--fin-text-2)]">Filtros que vão no relatório</p>
          <p className="fin-t-body text-[var(--fin-text)]">{resumoDosFiltros}</p>
        </div>

        <Field rotulo="Nome do envio" obrigatorio erro={erros.nome}>
          {a => <Input {...a} value={nome} maxLength={LIMITES_DO_AGENDAMENTO.nome} onChange={e => setNome(e.target.value)} />}
        </Field>

        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
          <Field rotulo="Enviar" erro={erros.frequencia}>
            {a => (
              <select {...a} className={CAMPO_SELECT} value={frequencia} onChange={e => trocarFrequencia(e.target.value as Frequencia)}>
                {FREQ.map(f => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
              </select>
            )}
          </Field>
          {frequencia === 'semanal' ? (
            <Field rotulo="Dia da semana" erro={erros.dia_semana}>
              {a => (
                <select {...a} className={CAMPO_SELECT} value={diaSemana} onChange={e => setDiaSemana(Number(e.target.value))}>
                  {DIAS_DA_SEMANA.map((d, i) => <option key={d} value={i}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                </select>
              )}
            </Field>
          ) : frequencia === 'mensal' ? (
            <Field rotulo="Dia do mês" erro={erros.dia_mes}>
              {a => (
                <select {...a} className={CAMPO_SELECT} value={diaMes} onChange={e => setDiaMes(Number(e.target.value))}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>Dia {d}</option>)}
                  <option value={0}>Último dia do mês</option>
                </select>
              )}
            </Field>
          ) : <div className="hidden sm:block" />}
          <Field rotulo="Hora (Brasília)" erro={erros.hora}>
            {a => (
              <select {...a} className={CAMPO_SELECT} value={hora} onChange={e => setHora(Number(e.target.value))}>
                {Array.from({ length: 17 }, (_, i) => i + 6).map(h => <option key={h} value={h}>{h}h</option>)}
              </select>
            )}
          </Field>
        </div>

        <Field rotulo="Cada envio mostra" ajuda="O período é contado a partir do dia do envio. O dia do envio fica de fora: os números dele ainda estão mudando." erro={erros.periodo}>
          {a => (
            <select {...a} className={CAMPO_SELECT} value={periodo} onChange={e => { setPeriodo(e.target.value as PeriodoDoEnvio); setPeriodoTocado(true); }}>
              {PERIODOS_DO_ENVIO.map(p => <option key={p} value={p}>{ROTULO_PERIODO_DO_ENVIO[p]}</option>)}
            </select>
          )}
        </Field>

        <Field rotulo="Para quem" obrigatorio ajuda={`Um ou mais e-mails, separados por vírgula ou linha. Até ${LIMITES_DO_AGENDAMENTO.destinatarios}.`} erro={erros.destinatarios ?? (lidos.invalidos.length ? `Confira: ${lidos.invalidos.slice(0, 3).join(', ')}` : null)}>
          {a => <Textarea {...a} rows={2} value={emails} onChange={e => setEmails(e.target.value)} placeholder="diretoria@suaagencia.com.br, financeiro@suaagencia.com.br" />}
        </Field>

        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          <Field rotulo="Arquivo para baixar" ajuda="O e-mail leva o link de leitura; o arquivo baixa por ele.">
            {a => (
              <select {...a} className={CAMPO_SELECT} value={formato} onChange={e => setFormato(e.target.value as 'xlsx' | 'pdf')}>
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="pdf">PDF</option>
              </select>
            )}
          </Field>
          <Field rotulo="O link vale por" ajuda="Depois disso ele não abre mais. Você pode desligar antes." erro={erros.validade_dias}>
            {a => (
              <select {...a} className={CAMPO_SELECT} value={validade} onChange={e => setValidade(Number(e.target.value))}>
                {[1, 7, 15, 30, 60, 90].map(d => <option key={d} value={d}>{d === 1 ? '1 dia' : `${d} dias`}</option>)}
              </select>
            )}
          </Field>
        </div>
        <p className="fin-t-caption text-[var(--fin-text-3)]">
          Quem abrir o link vê só este relatório, como estava no envio, sem entrar no sistema. O ganho da agência só aparece se você pode vê-lo.
        </p>
      </div>
    </RecordSheet>
  );
}

'use client';

import * as React from 'react';
import { CalendarClock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { usePodeExportar } from '@/components/fin/BotaoExportar';
import { FormularioDeEnvio } from '@/components/relatorios/FormularioDeEnvio';
import type { RelatorioAgendavel } from '@/lib/relatorios-agendados/regras';

/**
 * "Agendar envio" para as telas do financeiro (DRE, fluxo de caixa, visão
 * geral): o mesmo formulário dos relatórios de vendas, com os filtros da tela
 * na hora de abrir. Só aparece para quem pode baixar em Excel e PDF (o envio
 * leva o relatório para fora do sistema).
 */
interface PropsDoAgendamento {
  relatorio: Exclude<RelatorioAgendavel, 'vendas'>;
  /** Os filtros de agora, na forma de URL (lida ao abrir). */
  consulta: () => string;
  nomeSugerido: string;
  /** Os filtros por extenso, lidos ao abrir. */
  resumoDosFiltros: () => string;
}

/**
 * O agendamento sem o botão, para quem põe a ação em outro lugar (o menu do
 * cabeçalho): `abrir` abre o formulário; `formulario` vai no JSX da tela.
 */
export function useAgendarEnvio({ relatorio, consulta, nomeSugerido, resumoDosFiltros }: PropsDoAgendamento) {
  const podeExportar = usePodeExportar();
  const [aberto, setAberto] = React.useState<{ consulta: string; resumo: string } | null>(null);
  const [crmLigado, setCrmLigado] = React.useState<boolean | null>(null);

  const abrir = () => {
    setAberto({ consulta: consulta(), resumo: resumoDosFiltros() });
    if (crmLigado === null) {
      fetch('/api/relatorios/agendados').then(r => (r.ok ? r.json() : null)).then(j => setCrmLigado(j ? Boolean(j.crm_ligado) : null)).catch(() => undefined);
    }
  };

  const formulario = aberto ? (
    <FormularioDeEnvio
      aberto
      relatorio={relatorio}
      onFechar={() => setAberto(null)}
      onSalvo={() => setAberto(null)}
      consulta={aberto.consulta}
      nomeSugerido={nomeSugerido}
      resumoDosFiltros={aberto.resumo}
      crmLigado={crmLigado}
    />
  ) : null;

  return { podeExportar, abrir, formulario };
}

export function BotaoAgendarEnvio({ desabilitado, className, ...props }: PropsDoAgendamento & { desabilitado?: boolean; className?: string }) {
  const { podeExportar, abrir, formulario } = useAgendarEnvio(props);
  if (!podeExportar) return null;
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={abrir} disabled={desabilitado} className={className ?? 'h-11 gap-[var(--fin-s-2)] lg:h-9'}>
        <CalendarClock aria-hidden="true" className="size-4" /> Agendar envio
      </Button>
      {formulario}
    </>
  );
}

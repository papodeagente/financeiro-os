'use client';

/**
 * Notas fiscais emitidas.
 *
 * Nota não se apaga: cancela. A linha continua aqui com o motivo e a data,
 * porque a prefeitura tem o documento do outro lado e o histórico precisa
 * bater com o dela.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';

import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { MetricCard } from '@/components/fin/MetricCard';
import { Money } from '@/components/fin/Money';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import { somaPor } from '@/lib/money';
import type { NotaFiscal, StatusNota } from '@/lib/nfse-tipos';

const ROTULO: Record<StatusNota, string> = {
  RASCUNHO: 'Rascunho',
  PROCESSANDO: 'Na prefeitura',
  AUTORIZADA: 'Autorizada',
  REJEITADA: 'Recusada',
  CANCELADA: 'Cancelada',
};

const COR: Record<StatusNota, string> = {
  RASCUNHO: 'text-[var(--fin-text-3)]',
  PROCESSANDO: 'text-[var(--fin-warning-text)]',
  AUTORIZADA: 'text-[var(--fin-positive)]',
  REJEITADA: 'text-[var(--fin-negative)]',
  CANCELADA: 'text-[var(--fin-text-3)]',
};

export default function NotasFiscaisPage() {
  const [notas, setNotas] = useState<NotaFiscal[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [cancelando, setCancelando] = useState<NotaFiscal | null>(null);
  const [motivo, setMotivo] = useState('');
  const [processando, setProcessando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await fetch('/api/fiscal/notas');
      const corpo = await res.json();
      if (!res.ok) { setErro(corpo?.error || 'Não foi possível carregar.'); return; }
      setNotas(corpo as NotaFiscal[]);
      setErro('');
    } catch {
      setErro('Não foi possível carregar.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  /** Pergunta ao emissor em que pé está uma nota que ficou processando. */
  async function atualizar(nota: NotaFiscal) {
    const res = await fetch(`/api/fiscal/notas/${nota.id}`);
    const corpo = await res.json();
    if (!res.ok) { toast.error('Não foi possível consultar', corpo?.error || ''); return; }
    const atualizada = corpo as NotaFiscal;
    setNotas(lista => lista.map(n => (n.id === atualizada.id ? atualizada : n)));
    toast.success(`Situação: ${ROTULO[atualizada.status]}`, atualizada.erro || '');
  }

  async function confirmarCancelamento() {
    if (!cancelando || processando) return;
    setProcessando(true);
    try {
      const res = await fetch(`/api/fiscal/notas/${cancelando.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo }),
      });
      const corpo = await res.json();
      if (!res.ok) { toast.error('A nota não foi cancelada', corpo?.error || ''); return; }
      setNotas(lista => lista.map(n => (n.id === corpo.id ? (corpo as NotaFiscal) : n)));
      setCancelando(null);
      setMotivo('');
      toast.success('Nota cancelada');
    } finally {
      setProcessando(false);
    }
  }

  const autorizadas = useMemo(() => notas.filter(n => n.status === 'AUTORIZADA'), [notas]);
  const pendentes = useMemo(() => notas.filter(n => n.status === 'PROCESSANDO'), [notas]);
  const recusadas = useMemo(() => notas.filter(n => n.status === 'REJEITADA'), [notas]);

  const colunas: FinColuna<NotaFiscal>[] = [
    {
      id: 'nota',
      cabecalho: 'Nota',
      tipo: 'texto',
      minWidth: 220,
      acessor: n => n.numero || n.id,
      render: n => (
        <span className="flex min-w-0 flex-col gap-1">
          <span className="fin-t-body-strong truncate text-[var(--fin-text)]">
            {n.tomador?.razao_social || 'Cliente não informado'}
          </span>
          <span className="fin-t-caption truncate text-[var(--fin-text-3)]">
            {n.numero ? `Nota ${n.numero}` : 'Sem número ainda'}
            {n.ambiente === 'HOMOLOGACAO' ? ' · homologação' : ''}
          </span>
          {n.erro ? (
            <span className="fin-t-caption text-[var(--fin-negative)]">{n.erro}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'regime',
      cabecalho: 'Regime',
      tipo: 'texto',
      minWidth: 150,
      acessor: n => n.regime,
      render: n => (
        <span className="fin-t-body text-[var(--fin-text-2)]">
          {n.regime === 'INTERMEDIACAO' ? 'Intermediação' : 'Serviço próprio'}
        </span>
      ),
    },
    {
      id: 'emissao',
      cabecalho: 'Emitida em',
      tipo: 'data',
      minWidth: 120,
      valor: n => (n.emitida_em ? n.emitida_em.slice(0, 10) : null),
    },
    {
      id: 'valor',
      cabecalho: 'Serviço',
      tipo: 'dinheiro',
      minWidth: 130,
      valor: n => n.valor_servicos,
    },
    {
      id: 'iss',
      cabecalho: 'ISS',
      tipo: 'dinheiro',
      minWidth: 110,
      valor: n => n.valor_iss,
    },
    {
      id: 'situacao',
      cabecalho: 'Situação',
      tipo: 'texto',
      minWidth: 130,
      acessor: n => n.status,
      render: n => (
        <span className={`fin-t-body-strong ${COR[n.status]}`}>{ROTULO[n.status]}</span>
      ),
    },
    {
      id: 'acoes',
      cabecalho: 'Ações',
      tipo: 'acoes',
      minWidth: 240,
      render: n => (
        <>
          {n.status === 'PROCESSANDO' ? (
            <Button type="button" variant="ghost" onClick={() => { void atualizar(n); }}>
              <RefreshCw aria-hidden="true" className="mr-2 size-4" />
              Consultar
            </Button>
          ) : null}
          {n.link_pdf ? (
            <a
              href={n.link_pdf}
              target="_blank"
              rel="noreferrer"
              className="fin-t-body inline-flex items-center gap-2 px-3 text-[var(--fin-accent)]"
            >
              <ExternalLink aria-hidden="true" className="size-4" />
              PDF
            </a>
          ) : null}
          {n.status !== 'CANCELADA' ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setCancelando(n); setMotivo(''); }}
            >
              Cancelar
            </Button>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <PageShell width="full" padding="md" gap="md" className="max-w-[1280px]">
      <PageHeader
        titulo="Notas fiscais"
        subtitulo="As notas de serviço emitidas a partir dos recebimentos confirmados."
      />

      <DataState
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={{ mensagem: erro, onTentarDeNovo: () => { void carregar(); } }}
        esqueleto={<div className="fin-t-body text-[var(--fin-text-3)]">Carregando…</div>}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            rotulo="Serviço autorizado"
            valor={somaPor(autorizadas, n => n.valor_servicos)}
            estado="ok"
            contexto={`${autorizadas.length} nota(s) autorizada(s).`}
            explicacao="Soma do valor de serviço das notas que a prefeitura autorizou. Não é o valor das vendas: é o que a agência declarou como receita própria."
          />
          <MetricCard
            rotulo="ISS das notas"
            valor={somaPor(autorizadas, n => n.valor_iss)}
            estado="ok"
            contexto="Imposto sobre serviço destacado nas notas autorizadas."
            explicacao="Total de ISS das notas autorizadas no período carregado."
          />
          <MetricCard
            rotulo="Aguardando prefeitura"
            valor={somaPor(pendentes, n => n.valor_servicos)}
            estado="ok"
            tone={recusadas.length > 0 ? 'negativo' : 'neutro'}
            contexto={
              recusadas.length > 0
                ? `${pendentes.length} em processamento e ${recusadas.length} recusada(s).`
                : `${pendentes.length} nota(s) em processamento.`
            }
            explicacao="Notas enviadas que a prefeitura ainda não respondeu. Use Consultar para atualizar a situação."
          />
        </div>
      </DataState>

      <FinTable<NotaFiscal>
        linhas={notas}
        colunas={colunas}
        chave={n => n.id}
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={{ mensagem: erro, onTentarDeNovo: () => { void carregar(); } }}
        vazio={{
          motivo: 'sem-dado',
          titulo: 'Nenhuma nota emitida',
          oQueE:
            'As notas nascem em Contas a receber: quando um recebimento é confirmado, aparece o botão Emitir nota naquela parcela.',
          comoComeca: [
            'Configure o emissor e envie o certificado em Configurações › Nota fiscal.',
            'Confirme o recebimento de uma parcela em Contas a receber.',
            'Clique em Emitir nota e confira os valores antes de transmitir.',
          ],
        }}
      />

      <ConfirmDialog
        aberto={Boolean(cancelando)}
        onOpenChange={a => { if (!a) setCancelando(null); }}
        titulo="Cancelar esta nota fiscal"
        oQueVaiAcontecer="A nota é cancelada na prefeitura e continua no histórico, com o motivo e a data. Não dá para desfazer."
        detalhes={
          cancelando
            ? [
                { rotulo: 'Tomador', valor: cancelando.tomador?.razao_social || 'Não informado' },
                { rotulo: 'Nota', valor: cancelando.numero || 'Sem número' },
                { rotulo: 'Valor', valor: <Money valor={cancelando.valor_servicos} size="strong" estado="ok" /> },
                {
                  rotulo: 'Motivo',
                  valor: (
                    <Input
                      value={motivo}
                      onChange={e => setMotivo(e.target.value)}
                      placeholder="A prefeitura exige o motivo"
                      aria-label="Motivo do cancelamento"
                    />
                  ),
                },
              ]
            : undefined
        }
        confirmarRotulo="Cancelar nota"
        tone="destrutivo"
        processando={processando}
        onConfirmar={() => { void confirmarCancelamento(); }}
      />
    </PageShell>
  );
}

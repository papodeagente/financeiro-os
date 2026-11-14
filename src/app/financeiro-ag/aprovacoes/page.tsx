'use client';

// Financeiro › Aprovações (05/11/2026). Caixa de pedidos: pagamento acima da
// alçada, desconto ou data fora do bloqueio. Aprovar ou recusar com motivo;
// quem pediu nunca decide o próprio.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Stamp, X } from 'lucide-react';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { Segmentado } from '@/components/fin/Segmentado';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ROTULO_STATUS_PEDIDO, type PedidoAprovacao, type StatusPedido } from '@/lib/aprovacoes';
import { toast } from '@/lib/toast';
import { levarParaSegundoFator, lembrarSegundoFator } from '@/components/fin/segundoFatorNaTela';
import { cn } from '@/lib/utils';

type Pedido = PedidoAprovacao & { posso_decidir: boolean; motivo_nao_posso: string };
type Filtro = 'PENDENTE' | 'TODOS';

const PAINEL = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';
const TOM: Record<StatusPedido, string> = {
  PENDENTE: 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]',
  APROVADO: 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]',
  EXECUTADO: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]',
  RECUSADO: 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]',
  EXPIRADO: 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]',
};
const TIPO: Record<string, string> = { pagamento: 'Pagamento acima da alçada' };

const brl = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

export default function AprovacoesPage() {
  const [filtro, setFiltro] = useState<Filtro>('PENDENTE');
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [paraMim, setParaMim] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [aprovar, setAprovar] = useState<Pedido | null>(null);
  const [recusando, setRecusando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [processando, setProcessando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setErro(null);
      const r = await fetch(`/api/aprovacoes?status=${filtro}`);
      const corpo = await r.json();
      if (!r.ok) throw new Error(corpo?.error || 'Erro ao carregar.');
      setPedidos(corpo.pedidos);
      setParaMim(corpo.para_mim);
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, [filtro]);
  useEffect(() => { setPedidos(null); void carregar(); }, [carregar]);

  async function decidir(p: Pedido, decisao: 'aprovar' | 'recusar', texto = '') {
    setProcessando(true);
    try {
      const r = await fetch('/api/aprovacoes', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acao: 'decidir', id: p.id, decisao, motivo: texto }),
      });
      const corpo = await r.json().catch(() => ({}));
      // Aprovar pede a verificação em duas etapas a quem não é administrador (E7).
      if (levarParaSegundoFator(r.status, corpo)) { setAprovar(null); return; }
      if (!r.ok) throw new Error(corpo?.error || 'Não foi possível decidir.');
      lembrarSegundoFator(corpo);
      const final = corpo.pedido as PedidoAprovacao;
      if (decisao === 'recusar') toast.success('Pedido recusado.');
      else if (final.status === 'PENDENTE') toast.success('Sua aprovação foi registrada.', 'Falta outra pessoa aprovar.');
      else if (final.status === 'EXECUTADO') toast.success('Aprovado e feito.');
      else if (final.status === 'EXPIRADO') toast.warning('Aprovado, mas não foi feito', final.erro_execucao);
      else if (final.erro_execucao) toast.warning('Aprovado, mas não foi feito', final.erro_execucao);
      else toast.success('Aprovado.');
      setAprovar(null);
      setRecusando(null);
      setMotivo('');
      await carregar();
    } catch (e) {
      toast.error('Não decidiu', e instanceof Error ? e.message : undefined);
    } finally {
      setProcessando(false);
    }
  }

  const resumo = useMemo(() => {
    if (!pedidos) return '';
    if (filtro !== 'PENDENTE') return `${pedidos.length} pedido${pedidos.length === 1 ? '' : 's'} recentes`;
    return paraMim > 0 ? `${paraMim} esperando a sua decisão` : 'Nada esperando por você';
  }, [pedidos, filtro, paraMim]);

  return (
    <MolduraDaPagina>
      <PageHeader
        titulo="Aprovações"
        icone={Stamp}
        subtitulo="Pagamentos acima da alçada e o que passou dos limites. Quem pediu nunca aprova o próprio pedido."
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Segmentado<Filtro>
          rotulo="Mostrar"
          valor={filtro}
          onChange={setFiltro}
          opcoes={[{ valor: 'PENDENTE', rotulo: 'Aguardando', contagem: filtro === 'PENDENTE' ? pedidos?.length : undefined }, { valor: 'TODOS', rotulo: 'Todos' }]}
        />
        <span className="fin-t-caption text-[var(--fin-text-3)]" aria-live="polite">{resumo}</span>
      </div>

      <DataState
        estado={erro ? 'erro' : pedidos ? 'ok' : 'carregando'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => void carregar() } : null}
        esqueleto={<div className={cn(PAINEL, 'h-64 animate-pulse')} />}
      >
        {pedidos && pedidos.length === 0 && (
          <EmptyLesson
            motivo={filtro === 'PENDENTE' ? 'sem-resultado' : 'sem-dado'}
            titulo={filtro === 'PENDENTE' ? 'Nenhum pedido aguardando' : 'Nenhum pedido ainda'}
            oQueE="Os pedidos aparecem aqui quando um pagamento passa da alçada ou alguém passa de um limite (desconto, data, vencimento). Quem aprova recebe o aviso no sino."
            acao={{ rotulo: 'Configurar limites e alçadas', href: '/config/limites-e-aprovacao' }}
          />
        )}
        {pedidos && pedidos.length > 0 && (
          <ol className={cn(PAINEL, 'divide-y divide-[var(--fin-border)]')}>
            {pedidos.map(p => {
              const aprovacoes = p.decisoes.filter(d => d.decisao === 'aprovar');
              const aberto = recusando === p.id;
              return (
                <li key={p.id} className="flex flex-col gap-3 px-[var(--fin-s-4)] py-4 sm:px-[var(--fin-s-5)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('fin-t-caption rounded-[var(--fin-r-sm)] px-1.5 py-0.5 font-medium', TOM[p.status])}>{ROTULO_STATUS_PEDIDO[p.status]}</span>
                        <span className="fin-t-caption text-[var(--fin-text-3)]">{TIPO[p.tipo] ?? 'Pedido de aprovação'}</span>
                      </div>
                      <p className="fin-t-body-strong text-[var(--fin-text)]">{p.descricao}</p>
                      <p className="fin-t-caption text-[var(--fin-text-3)]">
                        Pedido por {p.solicitante_nome || 'alguém'} em {quando(p.created_at)}
                        {p.niveis > 1 ? ` · ${aprovacoes.length} de ${p.niveis} aprovações` : ''}
                        {p.status === 'PENDENTE' ? ` · vence em ${quando(p.expira_em)}` : ''}
                      </p>
                      {p.motivo && <p className="fin-t-body max-w-[70ch] text-[var(--fin-text-2)]">“{p.motivo}”</p>}
                      {p.decisoes.length > 0 && (
                        <ul className="fin-t-caption flex flex-col gap-0.5 text-[var(--fin-text-3)]">
                          {p.decisoes.map(d => (
                            <li key={`${d.usuario_id}-${d.em}`}>
                              {d.decisao === 'aprovar' ? 'Aprovado' : 'Recusado'} por {d.usuario_nome || 'alguém'} em {quando(d.em)}{d.motivo ? `: ${d.motivo}` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                      {p.erro_execucao && <p className="fin-t-caption text-[var(--fin-warning-text)]">{p.erro_execucao}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                      {p.valor_centavos > 0 && <span className="fin-t-metric-sm tabular-nums text-[var(--fin-text)]">{brl(p.valor_centavos)}</span>}
                      {p.status === 'PENDENTE' && p.posso_decidir && !aberto && (
                        <div className="flex gap-2">
                          <Button variant="outline" className="gap-2" onClick={() => { setRecusando(p.id); setMotivo(''); }}>
                            <X aria-hidden="true" /> Recusar
                          </Button>
                          <Button className="gap-2" onClick={() => setAprovar(p)}>
                            <Check aria-hidden="true" /> Aprovar
                          </Button>
                        </div>
                      )}
                      {p.status === 'PENDENTE' && !p.posso_decidir && (
                        <span className="fin-t-caption max-w-[32ch] text-[var(--fin-text-3)] sm:text-right">{p.motivo_nao_posso}</span>
                      )}
                    </div>
                  </div>
                  {aberto && (
                    <form
                      className="flex flex-col gap-2 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] p-3"
                      onSubmit={e => { e.preventDefault(); if (motivo.trim().length >= 3) void decidir(p, 'recusar', motivo.trim()); }}
                    >
                      <label htmlFor={`motivo-${p.id}`} className="fin-t-body-strong">Por que recusar?</label>
                      <Textarea id={`motivo-${p.id}`} autoFocus value={motivo} maxLength={1000} rows={2}
                        placeholder="Ex.: negociar desconto com o fornecedor antes" onChange={e => setMotivo(e.target.value)} />
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" onClick={() => setRecusando(null)} disabled={processando}>Cancelar</Button>
                        <Button type="submit" variant="destructive" disabled={processando || motivo.trim().length < 3}>
                          {processando ? 'Recusando…' : 'Recusar pedido'}
                        </Button>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </DataState>

      <ConfirmDialog
        aberto={!!aprovar}
        onOpenChange={v => { if (!v) setAprovar(null); }}
        titulo="Aprovar este pedido?"
        oQueVaiAcontecer={aprovar?.tipo === 'pagamento'
          ? (aprovar.niveis > 1 && aprovar.decisoes.filter(d => d.decisao === 'aprovar').length + 1 < aprovar.niveis
            ? 'Sua aprovação fica registrada. A conta só é liberada quando todas as aprovações chegarem.'
            : 'A conta a pagar fica liberada para pagamento. Nada é pago agora; se o valor mudar, precisa de nova aprovação.')
          : 'O que foi pedido é feito agora, se ainda valer. Se algo mudou desde o pedido, nada é feito e o pedido expira.'}
        detalhes={aprovar ? [
          { rotulo: 'Pedido', valor: aprovar.descricao },
          ...(aprovar.valor_centavos > 0 ? [{ rotulo: 'Valor', valor: brl(aprovar.valor_centavos) }] : []),
          { rotulo: 'Pedido por', valor: aprovar.solicitante_nome || 'alguém' },
        ] : undefined}
        confirmarRotulo="Aprovar"
        processando={processando}
        onConfirmar={() => aprovar ? decidir(aprovar, 'aprovar') : undefined}
      />
    </MolduraDaPagina>
  );
}

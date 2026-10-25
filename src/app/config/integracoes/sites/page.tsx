'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Link2, RefreshCw } from 'lucide-react';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/fin/PageHeader';

interface Config { ativo: boolean; companyId: number | null; temSegredo: boolean; webhookUrl: string }
interface Evento { id: string; tipo: string; pedidoCodigo: string | null; criadoEm: string; dados: Record<string, unknown> }
const moedaDo = (valor: unknown) => typeof valor === 'string' && /^[A-Z]{3}$/.test(valor) ? valor : 'BRL';

export default function IntegracaoSitesPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [segredo, setSegredo] = useState('');
  const [ativo, setAtivo] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([fetch('/api/v1/sites/config'), fetch('/api/v1/sites/eventos')]);
      const config = await a.json();
      const lista = await b.json();
      if (!a.ok) throw new Error(config.erro || 'Falha ao carregar integração');
      setCfg(config);
      setCompanyId(config.companyId ? String(config.companyId) : '');
      setAtivo(config.ativo);
      setEventos(b.ok ? lista.eventos || [] : []);
      setErro('');
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao carregar integração'); }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true); setErro(''); setAviso('');
    try {
      const r = await fetch('/api/v1/sites/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(companyId), segredo, ativo }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || 'Falha ao salvar');
      setSegredo(''); setAviso('Integração salva. Envie um teste pelo Sites para confirmar a conexão.');
      await carregar();
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao salvar'); }
    finally { setSalvando(false); }
  };

  return (
    <PageShell width="full" padding="md" gap="md" className="max-w-[820px]">
      <PageHeader icone={Link2} titulo="EnturOS Sites" subtitulo="Acompanhe reservas, pagamentos, reembolsos e custos enviados pelo site." />
      <p className="fin-t-caption text-[var(--fin-text-2)]"><Link href="/config/integracoes">← Integrações</Link></p>
      {erro && <p role="alert" className="rounded-lg border border-[var(--fin-negative)] p-3 text-[var(--fin-negative)]">{erro}</p>}
      {aviso && <p role="status" className="rounded-lg border border-[var(--fin-positive)] p-3 text-[var(--fin-positive)]">{aviso}</p>}

      <section className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-5">
        <h2 className="fin-t-body-strong">Conectar o Sites</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 fin-t-body text-[var(--fin-text-2)]">
          <li>No Sites, abra Integrações → Webhooks e crie um webhook para os eventos de reserva, dinheiro e acerto.</li>
          <li>Use o endereço abaixo como destino e copie o segredo mostrado pelo Sites uma única vez.</li>
          <li>Informe o ID da empresa do Sites e cole o segredo aqui. Depois, envie o teste no Sites.</li>
        </ol>
        <label className="mt-5 block fin-t-caption text-[var(--fin-text-2)]" htmlFor="sites-url">Endereço de recebimento</label>
        <input id="sites-url" readOnly value={cfg?.webhookUrl || ''} onFocus={e => e.currentTarget.select()}
          className="mt-1 w-full rounded-lg border border-[var(--fin-border)] bg-[var(--fin-surface-2)] p-3 font-mono text-sm" />
        <form onSubmit={salvar} className="mt-5 grid gap-4">
          <label className="grid gap-1 fin-t-caption">ID da empresa no Sites
            <input type="number" min="1" required value={companyId} onChange={e => setCompanyId(e.target.value)}
              className="rounded-lg border border-[var(--fin-border)] bg-[var(--fin-surface)] p-3" />
          </label>
          <label className="grid gap-1 fin-t-caption">Segredo do webhook {cfg?.temSegredo && '(deixe vazio para manter o atual)'}
            <input type="password" autoComplete="new-password" required={!cfg?.temSegredo} value={segredo} onChange={e => setSegredo(e.target.value)}
              className="rounded-lg border border-[var(--fin-border)] bg-[var(--fin-surface)] p-3" />
          </label>
          <label className="flex items-center gap-2 fin-t-caption"><input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} /> Receber eventos</label>
          <button type="submit" disabled={salvando} className="w-fit rounded-lg bg-[var(--fin-accent)] px-5 py-3 font-semibold text-[var(--fin-text-on-fill)] disabled:opacity-50">
            {salvando ? 'Salvando…' : 'Salvar conexão'}
          </button>
        </form>
        <p className="mt-4 fin-t-caption text-[var(--fin-text-3)]">Os eventos são registrados para conferência. Uma venda já recebida pelo CRM não gera outra conta aqui.</p>
      </section>

      <section className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="fin-t-body-strong">Eventos recentes</h2>
          <button type="button" onClick={() => void carregar()} className="flex items-center gap-2 fin-t-caption text-[var(--fin-accent)]"><RefreshCw size={16} /> Atualizar</button></div>
        {eventos.length === 0 ? <p className="mt-3 fin-t-body text-[var(--fin-text-3)]">Nenhum evento recebido. Faça o teste no Sites e atualize esta lista.</p> :
          <ul className="mt-3 divide-y divide-[var(--fin-border)]">{eventos.map(ev => <li key={ev.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 fin-t-caption">
            <strong className="text-[var(--fin-text)]">{ev.tipo}</strong>{ev.pedidoCodigo ? <Link href={`/config/integracoes/sites/pedido/${encodeURIComponent(ev.pedidoCodigo)}`} className="text-[var(--fin-accent)] underline">{ev.pedidoCodigo}</Link> : <span>Sem pedido</span>}
            <time dateTime={ev.criadoEm}>{new Date(ev.criadoEm).toLocaleString('pt-BR')}</time>
            <span className="text-[var(--fin-text-3)]">{typeof ev.dados.valorCentavos === 'number' ? (ev.dados.valorCentavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: moedaDo(ev.dados.moeda) }) : ''}</span>
          </li>)}</ul>}
      </section>
    </PageShell>
  );
}

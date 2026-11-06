'use client';

import { useEffect, useState } from 'react';
import { MessageCircle, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/fin/Field';
import {
  AVISO_WHATSAPP_PADRAO, MAX_TELEFONES_DO_AVISO, type AvisoWhatsApp,
} from '@/lib/avisos-vencimento-whatsapp';
import { toast } from '@/lib/toast';

/**
 * Configurações › Financeiro › Aviso de vencimento pelo WhatsApp (E7).
 *
 * Opt-in da agência: quem estiver na lista recebe, uma vez por dia de manhã,
 * o resumo do que vence hoje e do que está em atraso, pelo WhatsApp conectado
 * no CRM. Vale para a agência inteira (como o sino).
 */
const SECAO = 'flex max-w-3xl flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)]';
const CONTROLE = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body tabular-nums lg:h-10';

type Linha = { nome: string; telefone: string };

/** 5511988887777 → (11) 98888-7777 para editar; o servidor guarda só os dígitos. */
function telefoneLegivel(d: string): string {
  const local = d.startsWith('55') ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return d;
}

export function SecaoAvisoWhatsApp() {
  const [ligado, setLigado] = useState(AVISO_WHATSAPP_PADRAO.ligado);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/config/financeiro', { signal: ac.signal })
      .then(r => (r.ok ? r.json() : null))
      .then((c: { avisos_vencimento_whatsapp?: AvisoWhatsApp } | null) => {
        const w = c?.avisos_vencimento_whatsapp ?? AVISO_WHATSAPP_PADRAO;
        setLigado(w.ligado);
        setLinhas(w.telefones.map(t => ({ nome: t.nome, telefone: telefoneLegivel(t.telefone) })));
        setCarregado(true);
      })
      .catch(() => { if (!ac.signal.aborted) setCarregado(true); });
    return () => ac.abort();
  }, []);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const telefones = linhas.filter(l => l.telefone.trim());
      const r = await fetch('/api/config/financeiro', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avisos_vencimento_whatsapp: { ligado, telefones } }),
      });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string; avisos_vencimento_whatsapp?: AvisoWhatsApp };
      if (!r.ok) { setErro(corpo.error || `Erro ${r.status}`); return; }
      const w = corpo.avisos_vencimento_whatsapp ?? { ligado, telefones: [] };
      setLigado(w.ligado);
      setLinhas(w.telefones.map(t => ({ nome: t.nome, telefone: telefoneLegivel(t.telefone) })));
      toast.success(w.ligado ? 'Aviso pelo WhatsApp ligado.' : 'Aviso pelo WhatsApp salvo.', w.ligado ? 'O primeiro resumo chega na próxima manhã.' : undefined);
    } catch {
      setErro('Sem conexão. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  const mudar = (i: number, campo: keyof Linha, v: string) => setLinhas(ls => ls.map((l, j) => (j === i ? { ...l, [campo]: v } : l)));

  return (
    <section aria-labelledby="t-aviso-whatsapp" className={SECAO} aria-busy={!carregado}>
      <div className="flex flex-col gap-[var(--fin-s-1)]">
        <h2 id="t-aviso-whatsapp" className="fin-t-subhead text-[var(--fin-text)]">Resumo de vencimentos pelo WhatsApp</h2>
        <p className="fin-t-caption text-[var(--fin-text-2)]">
          Uma vez por dia, de manhã: quantas contas vencem hoje e quantas estão em atraso, a pagar e a receber, com os totais.
          Sai pelo WhatsApp conectado no CRM. Sem nome de cliente nem documento na mensagem.
        </p>
      </div>
      <label className="flex items-start gap-2 fin-t-body text-[var(--fin-text)]">
        <input type="checkbox" checked={ligado} onChange={e => setLigado(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]" />
        <span>
          Mandar o resumo pelo WhatsApp
          <span className="block fin-t-caption text-[var(--fin-text-3)]">Desligado, ninguém recebe (o sino continua igual).</span>
        </span>
      </label>
      {ligado ? (
        <div className="flex flex-col gap-[var(--fin-s-3)]">
          {linhas.map((l, i) => (
            <div key={i} className="grid grid-cols-1 items-end gap-[var(--fin-s-2)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Field rotulo={i === 0 ? 'Quem recebe' : `Quem recebe (${i + 1})`}>
                {a => <Input {...a} value={l.nome} maxLength={60} onChange={e => mudar(i, 'nome', e.target.value)} placeholder="Ex.: Marina, financeiro" className={CONTROLE} />}
              </Field>
              <Field rotulo="Celular com DDD">
                {a => <Input {...a} type="tel" inputMode="tel" value={l.telefone} onChange={e => mudar(i, 'telefone', e.target.value)} placeholder="(11) 98888-7777" className={CONTROLE} />}
              </Field>
              <Button type="button" variant="ghost" onClick={() => setLinhas(ls => ls.filter((_, j) => j !== i))} aria-label={`Tirar ${l.nome || 'este número'} da lista`} className="h-11 lg:h-10">
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </div>
          ))}
          {linhas.length < MAX_TELEFONES_DO_AVISO ? (
            <div>
              <Button type="button" variant="outline" onClick={() => setLinhas(ls => [...ls, { nome: '', telefone: '' }])} className="gap-[var(--fin-s-2)]">
                <Plus aria-hidden="true" className="size-4" /> {linhas.length ? 'Mais um número' : 'Adicionar um número'}
              </Button>
            </div>
          ) : <p className="fin-t-caption text-[var(--fin-text-3)]">Até {MAX_TELEFONES_DO_AVISO} números.</p>}
          <p className="flex items-start gap-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-3)]">
            <MessageCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>Se o número da agência no CRM for da API Oficial, a mensagem só chega para quem conversou com ele nas últimas 24 horas. Com o número comum, chega sempre.</span>
          </p>
        </div>
      ) : null}
      {erro ? <p role="alert" className="rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] p-[var(--fin-s-3)] fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : null}
      <div>
        <Button type="button" onClick={() => { void salvar(); }} disabled={salvando || !carregado}>
          {salvando ? 'Salvando…' : 'Salvar resumo pelo WhatsApp'}
        </Button>
      </div>
    </section>
  );
}

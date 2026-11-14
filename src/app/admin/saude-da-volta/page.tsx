'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, HeartPulse, Loader2, RefreshCw } from 'lucide-react'

import { Callout } from '@/components/fin/Callout'
import type { ItemDaSaude, SaudeDaVolta } from '@/lib/volta-saude'

/**
 * Saúde da volta (14/11/2026): o que o intervalo da versão simples (12/11 até
 * a publicação) pode ter deixado torto, agência por agência. Só leitura.
 */
const fmt = (iso: string) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso))

function Item({ item }: { item: ItemDaSaude }) {
  const achados = item.linhas.length
  const agencias = new Set(item.linhas.map(l => l.tenant_id)).size
  const limpo = achados === 0 && !item.erro
  return (
    <section
      aria-labelledby={`item-${item.id}`}
      className="flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`item-${item.id}`} className="fin-t-subhead text-[var(--fin-text)]">{item.titulo}</h2>
        {limpo ? (
          <span className="fin-t-caption inline-flex items-center gap-1 font-medium text-[var(--fin-positive)]">
            <CheckCircle2 aria-hidden="true" className="size-4" /> Nada encontrado
          </span>
        ) : item.erro ? null : (
          <span className="fin-t-caption font-medium tabular-nums text-[var(--fin-warning-text)]">
            {achados} {achados === 1 ? 'ponto' : 'pontos'} em {agencias} {agencias === 1 ? 'agência' : 'agências'}
          </span>
        )}
      </div>
      <p className="fin-t-body max-w-[70ch] text-[var(--fin-text-2)]">{item.explicacao}</p>

      {item.erro ? (
        <Callout tom="aviso" titulo="Esta verificação não rodou">
          {item.erro}. As outras seguem valendo.
        </Callout>
      ) : null}

      {achados > 0 ? (
        <>
          <div className="flex flex-col gap-1 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] p-[var(--fin-s-3)]">
            <span className="fin-t-caption font-medium text-[var(--fin-text)]">O que fazer</span>
            <p className="fin-t-caption max-w-[70ch] text-[var(--fin-text-2)]">{item.o_que_fazer}</p>
          </div>
          <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
            {item.linhas.map((l, i) => (
              <li key={`${l.tenant_id}-${i}`} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4">
                <span className="fin-t-body-strong shrink-0 text-[var(--fin-text)] sm:w-56 sm:truncate" title={l.tenant_id}>{l.agencia}</span>
                <span className="fin-t-body tabular-nums text-[var(--fin-text-2)]">{l.detalhe}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

export default function SaudeDaVoltaPage() {
  const [dados, setDados] = useState<SaudeDaVolta | null>(null)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)

  async function carregar() {
    setCarregando(true)
    try {
      const r = await fetch('/api/admin/saude-da-volta', { cache: 'no-store' })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.error || 'O diagnóstico não pôde ser lido agora.')
      setDados(d)
      setErro('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'O diagnóstico não pôde ser lido agora.')
    } finally {
      setCarregando(false)
    }
  }
  useEffect(() => { carregar() }, [])

  if (!dados && !erro) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="size-6 animate-spin text-[var(--fin-text-3)]" /></div>
  }

  const comAchado = dados?.itens.filter(i => i.linhas.length > 0).length ?? 0
  return (
    <div className="flex max-w-4xl flex-col gap-[var(--fin-s-5)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="grid size-10 place-items-center rounded-[var(--fin-r-md)] bg-[var(--fin-violet-soft)] text-[var(--fin-violet)]">
            <HeartPulse className="size-5" />
          </span>
          <div className="flex flex-col">
            <h1 className="fin-t-title text-[var(--fin-text)]">Saúde da volta</h1>
            <p className="fin-t-caption max-w-[70ch] text-[var(--fin-text-3)]">
              De 12/11 até a volta da versão completa rodou a versão simples. Aqui está o que esse intervalo pode ter deixado para alguém olhar. Nada nesta tela muda dados.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={carregar}
          disabled={carregando}
          className="fin-t-body inline-flex h-10 items-center gap-2 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] disabled:opacity-60"
        >
          <RefreshCw aria-hidden="true" className={`size-4 ${carregando ? 'animate-spin' : ''}`} />
          Verificar de novo
        </button>
      </div>

      {erro ? <Callout tom="negativo" titulo="Diagnóstico indisponível">{erro}</Callout> : null}

      {dados ? (
        <>
          <p className="fin-t-body text-[var(--fin-text-2)]">
            {comAchado === 0
              ? 'Nenhum dos cinco pontos tem algo a olhar.'
              : `${comAchado} de ${dados.itens.length} pontos têm algo a olhar.`}
            <span className="text-[var(--fin-text-3)]"> Verificado em {fmt(dados.gerado_em)}.</span>
          </p>
          {[...dados.itens]
            .sort((a, b) => Number(b.linhas.length > 0) - Number(a.linhas.length > 0))
            .map(i => <Item key={i.id} item={i} />)}
        </>
      ) : null}
    </div>
  )
}

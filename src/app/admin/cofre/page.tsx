'use client'

import { useEffect, useState } from 'react'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/fin/Field'
import { Callout } from '@/components/fin/Callout'
import { NOMES_DAS_FONTES, textoDaIdade, idadeEmMinutos, type EstadoDaFonte } from '@/lib/cambio'

/**
 * Cofre do Super Admin (05/11/2026, E6): segredos da PLATAFORMA. Hoje, a
 * chave própria do Financeiro na AwesomeAPI (câmbio turismo para todas as
 * agências, uma consulta a cada 15 minutos). A tela só vê a máscara.
 */
interface Segredo {
  nome: string
  rotulo: string
  ajuda: string
  definida: boolean
  mascara: string
  legivel: boolean
  atualizado_em: string | null
  atualizado_por: string | null
  cofre_disponivel: boolean
}

const fmt = (iso: string) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso))

export default function CofreDaPlataformaPage() {
  const [segredos, setSegredos] = useState<Segredo[] | null>(null)
  const [fontes, setFontes] = useState<EstadoDaFonte[]>([])
  const [erro, setErro] = useState('')
  const [valores, setValores] = useState<Record<string, string>>({})
  const [gravando, setGravando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ nome: string; texto: string; tom: 'positivo' | 'negativo' } | null>(null)

  async function carregar() {
    try {
      const r = await fetch('/api/admin/cofre-plataforma', { cache: 'no-store' })
      if (!r.ok) throw new Error()
      const d = await r.json()
      setSegredos(d.segredos)
      setFontes(d.fontes ?? [])
      setErro('')
    } catch {
      setErro('O cofre não pôde ser lido agora. Nada foi alterado.')
    }
  }
  useEffect(() => { carregar() }, [])

  async function gravar(nome: string, valor: string) {
    setGravando(nome)
    setAviso(null)
    try {
      const r = await fetch('/api/admin/cofre-plataforma', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, valor }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.error || 'Não foi possível gravar.')
      setSegredos(d.segredos)
      setValores(v => ({ ...v, [nome]: '' }))
      setAviso({ nome, tom: 'positivo', texto: valor ? 'Chave gravada no cofre. A próxima consulta (em até 15 minutos) já usa a chave nova.' : 'Chave apagada. O câmbio turismo deixa de ser consultado.' })
      carregar()
    } catch (e) {
      setAviso({ nome, tom: 'negativo', texto: e instanceof Error ? e.message : 'Não foi possível gravar.' })
    } finally {
      setGravando(null)
    }
  }

  if (!segredos && !erro) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="size-6 animate-spin text-[var(--fin-text-3)]" /></div>
  }

  const agora = new Date()
  return (
    <div className="flex max-w-3xl flex-col gap-[var(--fin-s-5)]">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-10 place-items-center rounded-[var(--fin-r-md)] bg-[var(--fin-violet-soft)] text-[var(--fin-violet)]">
          <KeyRound className="size-5" />
        </span>
        <div className="flex flex-col">
          <h1 className="fin-t-title text-[var(--fin-text)]">Cofre da plataforma</h1>
          <p className="fin-t-caption text-[var(--fin-text-3)]">Chaves que valem para todas as agências. Ficam cifradas; ninguém vê a chave depois de gravada.</p>
        </div>
      </div>

      {erro ? <Callout tom="negativo" titulo="Cofre indisponível">{erro}</Callout> : null}

      {segredos?.map(s => {
        const fonte = s.nome === 'awesomeapi' ? fontes.find(f => f.fonte === 'awesomeapi') : undefined
        return (
          <section key={s.nome} className="flex flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)]">
            <div className="flex flex-col gap-1">
              <h2 className="fin-t-subhead text-[var(--fin-text)]">{s.rotulo}</h2>
              <p className="fin-t-caption text-[var(--fin-text-2)]">{s.ajuda}</p>
            </div>

            <dl className="grid grid-cols-1 gap-[var(--fin-s-2)] sm:grid-cols-2">
              <div className="flex flex-col">
                <dt className="fin-t-caption text-[var(--fin-text-3)]">Situação</dt>
                <dd className="fin-t-body-strong flex items-center gap-1 text-[var(--fin-text)]">
                  {s.definida && s.legivel ? <><ShieldCheck aria-hidden="true" className="size-4 text-[var(--fin-positive)]" /> Cadastrada ({s.mascara})</>
                    : s.definida ? 'Gravada, mas ilegível: a chave mestra mudou. Cadastre de novo.'
                      : 'Não cadastrada'}
                </dd>
              </div>
              {s.atualizado_em ? (
                <div className="flex flex-col">
                  <dt className="fin-t-caption text-[var(--fin-text-3)]">Última troca</dt>
                  <dd className="fin-t-body text-[var(--fin-text)]">{fmt(s.atualizado_em)}{s.atualizado_por ? `, por ${s.atualizado_por}` : ''}</dd>
                </div>
              ) : null}
              {fonte ? (
                <div className="flex flex-col sm:col-span-2">
                  <dt className="fin-t-caption text-[var(--fin-text-3)]">{NOMES_DAS_FONTES.awesomeapi}</dt>
                  <dd className="fin-t-body text-[var(--fin-text)]">
                    {fonte.ultimo_sucesso ? `Última consulta certa ${textoDaIdade(idadeEmMinutos(fonte.ultimo_sucesso, agora))}.` : 'Nenhuma consulta certa ainda.'}
                    {fonte.falhas_seguidas > 0 && fonte.ultimo_erro ? ` Últimas ${fonte.falhas_seguidas} tentativas falharam: ${fonte.ultimo_erro}` : ''}
                  </dd>
                </div>
              ) : null}
            </dl>

            {!s.cofre_disponivel ? (
              <Callout tom="aviso" titulo="Cofre sem a chave mestra">
                O servidor está sem INTEGRACOES_MASTER_KEY. Sem ela nenhuma chave é gravada (nunca em texto puro).
              </Callout>
            ) : null}

            <form
              className="flex flex-col gap-[var(--fin-s-3)] sm:flex-row sm:items-end"
              onSubmit={e => { e.preventDefault(); if (valores[s.nome]) gravar(s.nome, valores[s.nome]) }}
            >
              <div className="flex-1">
                <Field rotulo={s.definida ? 'Trocar a chave' : 'Chave'} ajuda="Cole a chave inteira. Ela é cifrada antes de ir para o banco.">
                  {a => (
                    <Input
                      id={a.id}
                      aria-describedby={a['aria-describedby']}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={valores[s.nome] ?? ''}
                      onChange={e => setValores(v => ({ ...v, [s.nome]: e.target.value }))}
                      className="fin-t-body h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] lg:h-10"
                    />
                  )}
                </Field>
              </div>
              <Button type="submit" disabled={!valores[s.nome] || gravando === s.nome || !s.cofre_disponivel} className="h-11 lg:h-10">
                {gravando === s.nome ? 'Gravando…' : 'Gravar chave'}
              </Button>
              {s.definida ? (
                <Button type="button" variant="outline" disabled={gravando === s.nome} onClick={() => gravar(s.nome, '')} className="h-11 text-[var(--fin-negative-text)] lg:h-10">
                  Apagar
                </Button>
              ) : null}
            </form>
            {aviso && aviso.nome === s.nome ? <Callout tom={aviso.tom}>{aviso.texto}</Callout> : null}
          </section>
        )
      })}
    </div>
  )
}

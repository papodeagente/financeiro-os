'use client'

/**
 * Versão e módulos da agência, na ficha do Super Admin (14/11/2026; regras em
 * src/lib/modulos.ts). Versão completa liga tudo. Na simples, cada módulo:
 * Padrão (segue a liberação geral de /admin/modulos), Ligado ou Desligado.
 * O que vale de verdade aparece ao lado, já com as dependências conferidas.
 * O CS vê a seção sem poder mudar.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Save } from 'lucide-react'
import { toast } from '@/lib/toast'
import {
  MODULOS, escolhaDoModulo, moduloLigado, modulosDosDados, nomesDasDependencias,
  type EscolhaDoModulo, type ModuloId, type VersaoDaConta,
} from '@/lib/modulos'

interface Props {
  tenantId: string
  dados: { fin_versao?: string; modulos?: Partial<Record<ModuloId, boolean>> }
  liberados: ModuloId[]
  podeEditar: boolean
  aoSalvar: () => Promise<void> | void
}

const ESCOLHAS: { valor: EscolhaDoModulo; rotulo: string }[] = [
  { valor: 'padrao', rotulo: 'Padrão' },
  { valor: 'ligado', rotulo: 'Ligado' },
  { valor: 'desligado', rotulo: 'Desligado' },
]

function escolhasDos(dados: Props['dados']): Record<ModuloId, EscolhaDoModulo> {
  return Object.fromEntries(MODULOS.map(m => [m.id, escolhaDoModulo(dados, m.id)])) as Record<ModuloId, EscolhaDoModulo>
}

function paraGravar(escolhas: Record<ModuloId, EscolhaDoModulo>): Partial<Record<ModuloId, boolean>> {
  const saida: Partial<Record<ModuloId, boolean>> = {}
  for (const m of MODULOS) {
    if (escolhas[m.id] === 'ligado') saida[m.id] = true
    if (escolhas[m.id] === 'desligado') saida[m.id] = false
  }
  return saida
}

export function VersaoEModulos({ tenantId, dados, liberados, podeEditar, aoSalvar }: Props) {
  const versaoSalva: VersaoDaConta = dados.fin_versao === 'completa' ? 'completa' : 'simples'
  const [versao, setVersao] = useState<VersaoDaConta>(versaoSalva)
  const [escolhas, setEscolhas] = useState(() => escolhasDos(dados))
  const [salvando, setSalvando] = useState(false)

  // Depois de salvar (ou recarregar a ficha), o rascunho volta ao que está gravado.
  const assinaturaSalva = JSON.stringify([versaoSalva, escolhasDos(dados)])
  useEffect(() => {
    setVersao(versaoSalva)
    setEscolhas(escolhasDos(dados))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinaturaSalva])

  const rascunho = useMemo(() => ({ fin_versao: versao, modulos: paraGravar(escolhas) }), [versao, escolhas])
  const efetivo = useMemo(() => modulosDosDados(rascunho, liberados), [rascunho, liberados])
  const mudou = JSON.stringify([versao, escolhas]) !== assinaturaSalva
  const travado = !podeEditar || salvando

  async function salvar() {
    setSalvando(true)
    try {
      const r = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rascunho),
      })
      const corpo = await r.json().catch(() => null)
      if (!r.ok) throw new Error(corpo?.error || 'Não foi possível salvar a versão e os módulos.')
      toast.success('Versão e módulos salvos. A agência vê a mudança na próxima tela que abrir.')
      await aoSalvar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar a versão e os módulos.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section aria-labelledby="versao-e-modulos" className="mb-6 rounded-xl border border-[var(--fin-border)] bg-[var(--fin-surface)] p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-[62ch]">
          <h2 id="versao-e-modulos" className="text-lg font-semibold text-[var(--fin-text)]">Versão e módulos</h2>
          <p className="mt-1 text-sm text-[var(--fin-text-2)]">
            Padrão segue o que está liberado para todas em{' '}
            <Link href="/admin/modulos" className="text-[var(--fin-accent)] underline underline-offset-2 hover:text-[var(--fin-accent-hover)]">Módulos</Link>.
            Ligado ou Desligado vale só para esta agência e vence o padrão.
          </p>
        </div>
        {podeEditar ? (
          <button
            type="button"
            onClick={salvar}
            disabled={!mudou || salvando}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--fin-accent)] px-4 py-2 text-sm font-medium text-[var(--fin-text-on-fill)] transition-colors hover:bg-[var(--fin-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {salvando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Salvar versão e módulos
          </button>
        ) : null}
      </div>

      <fieldset className="mb-5" disabled={travado}>
        <legend className="mb-2 text-sm font-medium text-[var(--fin-text-3)]">Versão</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([
            { valor: 'simples', titulo: 'Simples', texto: 'A versão de hoje. Só os módulos ligados abaixo (ou liberados para todas) aparecem.' },
            { valor: 'completa', titulo: 'Completa', texto: 'Todos os módulos ligados, sem exceção.' },
          ] as const).map(op => (
            <label
              key={op.valor}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors has-[:disabled]:cursor-default ${
                versao === op.valor ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border)] hover:bg-[var(--fin-surface-2)]'
              }`}
            >
              <input
                type="radio"
                name="fin-versao"
                value={op.valor}
                checked={versao === op.valor}
                onChange={() => setVersao(op.valor)}
                className="mt-0.5 accent-[var(--fin-accent)]"
              />
              <span>
                <span className="block text-sm font-medium text-[var(--fin-text)]">{op.titulo}</span>
                <span className="block text-xs text-[var(--fin-text-2)]">{op.texto}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <ul className="divide-y divide-[var(--fin-border)] rounded-lg border border-[var(--fin-border)]">
        {MODULOS.map(m => {
          const ligado = moduloLigado(efetivo, m.id)
          const deps = nomesDasDependencias(m.id)
          const pediuMasFalta = !ligado && versao === 'simples'
            && (escolhas[m.id] === 'ligado' || (escolhas[m.id] === 'padrao' && liberados.includes(m.id)))
          return (
            <li key={m.id} className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[var(--fin-text)]">{m.nome}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                      ligado ? 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]' : 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]'
                    }`}
                  >
                    {ligado ? 'Ligado agora' : 'Desligado agora'}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--fin-text-3)]">
                  {deps.length ? `Precisa de: ${deps.join(', ')}. ` : ''}
                  Padrão hoje: {liberados.includes(m.id) ? 'liberado para todas' : 'não liberado'}.
                </p>
                {pediuMasFalta ? (
                  <p className="mt-0.5 text-xs text-[var(--fin-warning-text)]">Fica desligado até {deps.join(' e ')} ligar.</p>
                ) : null}
              </div>
              <fieldset disabled={travado || versao === 'completa'} className="shrink-0">
                <legend className="sr-only">{m.nome}</legend>
                <div className="inline-flex rounded-lg border border-[var(--fin-border)] p-0.5">
                  {ESCOLHAS.map(op => (
                    <label
                      key={op.valor}
                      className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--fin-accent)] has-[:disabled]:cursor-default ${
                        escolhas[m.id] === op.valor
                          ? 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]'
                          : 'text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`modulo-${m.id}`}
                        value={op.valor}
                        checked={escolhas[m.id] === op.valor}
                        onChange={() => setEscolhas(atual => ({ ...atual, [m.id]: op.valor }))}
                        className="sr-only"
                      />
                      {op.rotulo}
                    </label>
                  ))}
                </div>
              </fieldset>
            </li>
          )
        })}
      </ul>
      {versao === 'completa' ? (
        <p className="mt-3 text-xs text-[var(--fin-text-3)]">Na versão completa as escolhas por módulo ficam guardadas, mas não valem: tudo está ligado.</p>
      ) : null}
    </section>
  )
}

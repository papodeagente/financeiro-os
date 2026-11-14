'use client'

/**
 * Módulos da versão completa (14/11/2026). Cada módulo com o que faz, de
 * quais depende, quantas agências têm hoje e o botão de liberar ou retirar
 * de todas (saas_config 'modulos_liberados'). A exceção de cada agência fica
 * na ficha dela e vence a liberação geral. O CS consulta; só o super admin grava.
 */

import { useCallback, useEffect, useState } from 'react'
import { Blocks, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/fin/ConfirmDialog'
import type { ModuloId } from '@/lib/modulos'

interface ModuloDaPlataforma {
  id: ModuloId
  nome: string
  resumo: string
  depende: string[]
  liberado: boolean
  agencias_com: number
  mudam_se_liberar: number
  mudam_se_retirar: number
}

interface Estado {
  total_agencias: number
  modulos: ModuloDaPlataforma[]
  pode_editar: boolean
}

const agencias = (n: number) => `${n.toLocaleString('pt-BR')} ${n === 1 ? 'agência' : 'agências'}`

export default function ModulosDaPlataformaPage() {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [erro, setErro] = useState('')
  const [pedido, setPedido] = useState<{ modulo: ModuloDaPlataforma; liberar: boolean } | null>(null)
  const [processando, setProcessando] = useState(false)
  const [aviso, setAviso] = useState('')

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/modulos', { cache: 'no-store' })
      const corpo = await r.json().catch(() => null)
      if (!r.ok) throw new Error(corpo?.error || 'Não foi possível ler os módulos.')
      setEstado(corpo as Estado)
      setErro('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler os módulos.')
    }
  }, [])

  useEffect(() => { void carregar() }, [carregar])

  async function executar() {
    if (!pedido) return
    setProcessando(true)
    try {
      const r = await fetch('/api/admin/modulos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modulo: pedido.modulo.id, liberar: pedido.liberar }),
      })
      const corpo = await r.json().catch(() => null)
      if (!r.ok) throw new Error(corpo?.error || 'Não foi possível gravar.')
      setEstado(corpo as Estado)
      setAviso(`${pedido.modulo.nome}: ${pedido.liberar ? 'liberado para todas' : 'retirado de todas'}. ${agencias(Number(corpo.mudaram ?? 0))} ${Number(corpo.mudaram ?? 0) === 1 ? 'mudou' : 'mudaram'}.`)
      setPedido(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gravar.')
      setPedido(null)
    } finally {
      setProcessando(false)
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--fin-text)]">Módulos da versão completa</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--fin-text-2)]">
          Toda agência nasce na versão simples. Aqui você libera um módulo para todas de uma vez.
          Para uma agência só, use a ficha dela em Agências: a escolha da ficha vale mais que a daqui.
        </p>
      </div>

      {erro ? (
        <div role="alert" className="mb-4 rounded-[var(--fin-r-md)] border border-[var(--fin-negative)]/30 bg-[var(--fin-negative-soft)] px-4 py-3 text-sm text-[var(--fin-negative-text)]">
          {erro}
        </div>
      ) : null}
      {aviso ? (
        <div role="status" className="mb-4 rounded-[var(--fin-r-md)] border border-[var(--fin-positive)]/30 bg-[var(--fin-positive-soft)] px-4 py-3 text-sm text-[var(--fin-text)]">
          {aviso}
        </div>
      ) : null}

      {!estado && !erro ? (
        <div className="flex items-center gap-2 text-sm text-[var(--fin-text-3)]">
          <Loader2 className="size-4 animate-spin" /> Carregando os módulos
        </div>
      ) : null}

      {estado ? (
        <>
          <p className="mb-3 text-sm text-[var(--fin-text-3)]">
            {agencias(estado.total_agencias)} no sistema. {estado.pode_editar ? null : 'Você consulta; liberar e retirar é do super admin.'}
          </p>
          <ul className="divide-y divide-[var(--fin-border)] overflow-hidden rounded-xl border border-[var(--fin-border)] bg-[var(--fin-surface)]">
            {estado.modulos.map(m => (
              <li key={m.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 max-w-[62ch]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[var(--fin-text)]">{m.nome}</span>
                    {m.liberado ? (
                      <span className="rounded bg-[var(--fin-positive-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--fin-positive)]">Liberado para todas</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-[var(--fin-text-2)]">{m.resumo}</p>
                  <p className="mt-1.5 text-xs text-[var(--fin-text-3)]">
                    {m.depende.length ? `Precisa de: ${m.depende.join(', ')}. ` : ''}
                    Ligado hoje em <span className="tabular-nums">{agencias(m.agencias_com)}</span>.
                  </p>
                </div>
                {estado.pode_editar ? (
                  <div className="shrink-0">
                    {m.liberado ? (
                      <Button variant="outline" size="sm" onClick={() => { setAviso(''); setPedido({ modulo: m, liberar: false }) }}>
                        Retirar de todas
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => { setAviso(''); setPedido({ modulo: m, liberar: true }) }}>
                        Liberar para todas
                      </Button>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {estado.modulos.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-[var(--fin-border)] bg-[var(--fin-surface)] p-10 text-center">
              <Blocks className="mx-auto mb-3 size-8 text-[var(--fin-text-3)]" />
              <p className="text-sm text-[var(--fin-text-2)]">Nenhum módulo no catálogo.</p>
            </div>
          ) : null}
        </>
      ) : null}

      {pedido ? (
        <ConfirmDialog
          aberto
          onOpenChange={a => { if (!a && !processando) setPedido(null) }}
          titulo={pedido.liberar ? `Liberar ${pedido.modulo.nome} para todas` : `Retirar ${pedido.modulo.nome} de todas`}
          oQueVaiAcontecer={pedido.liberar
            ? `${agencias(pedido.modulo.mudam_se_liberar)} ${pedido.modulo.mudam_se_liberar === 1 ? 'passa' : 'passam'} a ver as telas, o menu e as tarefas deste módulo. Agências com o módulo desligado na ficha continuam sem ele${pedido.modulo.depende.length ? `, e quem não tem ${pedido.modulo.depende.join(' e ')} também` : ''}.`
            : `${agencias(pedido.modulo.mudam_se_retirar)} ${pedido.modulo.mudam_se_retirar === 1 ? 'deixa' : 'deixam'} de ver as telas, o menu e as tarefas deste módulo. Agências com o módulo ligado na ficha continuam com ele. Nada é apagado: ao liberar de novo, tudo volta como estava.`}
          detalhes={[
            { rotulo: 'Módulo', valor: pedido.modulo.nome },
            { rotulo: 'Agências que mudam', valor: <span className="tabular-nums">{pedido.liberar ? pedido.modulo.mudam_se_liberar : pedido.modulo.mudam_se_retirar}</span> },
          ]}
          confirmarRotulo={pedido.liberar ? 'Liberar para todas' : 'Retirar de todas'}
          tone={pedido.liberar ? 'padrao' : 'destrutivo'}
          processando={processando}
          onConfirmar={executar}
        />
      ) : null}
    </div>
  )
}

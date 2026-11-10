'use client'

/**
 * Equipe da plataforma: quem entra no painel /admin, como super admin ou CS
 * (regras em src/lib/plataforma.ts). Só o super admin abre esta tela.
 */

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Loader2, Plus, ShieldCheck, Smartphone, UserMinus, UserPlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/fin/ConfirmDialog'
import { PAPEIS_DA_PLATAFORMA, rotuloDoPapel, type PapelDaPlataforma } from '@/lib/plataforma'
import type { PessoaDaPlataforma } from '@/lib/equipe-da-plataforma'

type Acao =
  | { tipo: 'papel'; pessoa: PessoaDaPlataforma; papel: PapelDaPlataforma }
  | { tipo: 'ativo'; pessoa: PessoaDaPlataforma; ativo: boolean }
  | { tipo: 'senha'; pessoa: PessoaDaPlataforma }
  | { tipo: 'autenticador'; pessoa: PessoaDaPlataforma }

/** A senha provisória aparece uma vez, logo depois de criar ou gerar. */
type SenhaParaEntregar = { nome: string; email: string; senha: string }

export default function EquipeDaPlataformaPage() {
  const [equipe, setEquipe] = useState<PessoaDaPlataforma[] | null>(null)
  const [eu, setEu] = useState('')
  const [erro, setErro] = useState('')
  const [adicionando, setAdicionando] = useState(false)
  const [acao, setAcao] = useState<Acao | null>(null)
  const [processando, setProcessando] = useState(false)
  const [entregar, setEntregar] = useState<SenhaParaEntregar | null>(null)

  // Subir a versão recarrega a lista (depois de criar ou alterar alguém).
  const [versao, setVersao] = useState(0)
  const carregar = useCallback(() => setVersao(v => v + 1), [])

  useEffect(() => {
    let vivo = true
    fetch('/api/admin/equipe')
      .then(async r => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => {
        if (!vivo) return
        if (!ok) { setErro(d.error || 'Não foi possível carregar a equipe.'); setEquipe([]); return }
        setEquipe(d.equipe)
        setEu(d.eu)
      })
      .catch(() => { if (vivo) { setErro('Não foi possível carregar a equipe.'); setEquipe([]) } })
    return () => { vivo = false }
  }, [versao])

  async function executar() {
    if (!acao) return
    setProcessando(true)
    const corpo =
      acao.tipo === 'papel' ? { papel: acao.papel }
      : acao.tipo === 'ativo' ? { ativo: acao.ativo }
      : acao.tipo === 'senha' ? { nova_senha: true }
      : { zerar_autenticador: true }
    try {
      const r = await fetch(`/api/admin/equipe/${acao.pessoa.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Não foi possível salvar.')
      if (d.senha) setEntregar({ nome: d.pessoa.nome, email: d.pessoa.email, senha: d.senha })
      setAcao(null)
      setErro('')
      carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.')
      setAcao(null)
    } finally {
      setProcessando(false)
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fin-text)]">Equipe da plataforma</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--fin-text-2)]">
            Quem entra neste painel. Super admin faz tudo; CS vê o dashboard, consulta as agências e atende o suporte.
          </p>
        </div>
        <Button onClick={() => setAdicionando(true)}>
          <Plus className="size-4" /> Adicionar pessoa
        </Button>
      </div>

      {erro ? (
        <div role="alert" className="mb-4 rounded-[var(--fin-r-md)] border border-[var(--fin-negative)]/30 bg-[var(--fin-negative-soft)] px-4 py-3 text-sm text-[var(--fin-negative-text)]">
          {erro}
        </div>
      ) : null}

      {entregar ? <SenhaProvisoria {...entregar} onFechar={() => setEntregar(null)} /> : null}

      {equipe === null ? (
        <div className="flex items-center gap-2 text-sm text-[var(--fin-text-3)]">
          <Loader2 className="size-4 animate-spin" /> Carregando a equipe
        </div>
      ) : equipe.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-[var(--fin-border)] bg-[var(--fin-surface)] p-10 text-center">
          <Users className="mx-auto mb-3 size-8 text-[var(--fin-text-3)]" />
          <p className="text-sm text-[var(--fin-text-2)]">Ninguém na equipe ainda.</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--fin-border)] overflow-hidden rounded-xl border border-[var(--fin-border)] bg-[var(--fin-surface)]">
          {equipe.map(p => {
            const souEu = p.id === eu
            return (
              <li key={p.id} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${p.ativo ? '' : 'opacity-60'}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-[var(--fin-text)]">{p.nome || p.email}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${p.papel === 'SUPER_ADMIN' ? 'bg-[var(--fin-violet-soft)] text-[var(--fin-violet)]' : 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]'}`}>
                      {rotuloDoPapel(p.papel)}
                    </span>
                    {souEu ? <span className="rounded bg-[var(--fin-surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--fin-text-2)]">Você</span> : null}
                    {!p.ativo ? <span className="rounded bg-[var(--fin-surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--fin-text-2)]">Desativado</span> : null}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-[var(--fin-text-2)]">{p.email}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--fin-text-3)]">
                    {p.autenticador
                      ? (<><ShieldCheck className="size-3.5 text-[var(--fin-positive)]" /> Autenticador cadastrado</>)
                      : (<><Smartphone className="size-3.5" /> Cadastra o autenticador no primeiro acesso</>)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!souEu && p.ativo ? (
                    <Button variant="outline" size="sm" onClick={() => setAcao({ tipo: 'papel', pessoa: p, papel: p.papel === 'CS' ? 'SUPER_ADMIN' : 'CS' })}>
                      {p.papel === 'CS' ? 'Tornar super admin' : 'Tornar CS'}
                    </Button>
                  ) : null}
                  {p.ativo ? (
                    <Button variant="outline" size="sm" onClick={() => setAcao({ tipo: 'senha', pessoa: p })}>
                      <KeyRound className="size-3.5" /> Nova senha
                    </Button>
                  ) : null}
                  {p.ativo && p.autenticador ? (
                    <Button variant="outline" size="sm" onClick={() => setAcao({ tipo: 'autenticador', pessoa: p })}>
                      <Smartphone className="size-3.5" /> Zerar autenticador
                    </Button>
                  ) : null}
                  {!souEu ? (
                    p.ativo ? (
                      <Button variant="destructive" size="sm" onClick={() => setAcao({ tipo: 'ativo', pessoa: p, ativo: false })}>
                        <UserMinus className="size-3.5" /> Desativar
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setAcao({ tipo: 'ativo', pessoa: p, ativo: true })}>
                        <UserPlus className="size-3.5" /> Reativar
                      </Button>
                    )
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <NovaPessoa
        aberto={adicionando}
        onFechar={() => setAdicionando(false)}
        onCriada={(r) => { setAdicionando(false); setEntregar(r); carregar() }}
      />

      {acao ? (
        <ConfirmDialog
          aberto
          onOpenChange={a => { if (!a && !processando) setAcao(null) }}
          titulo={tituloDaAcao(acao)}
          oQueVaiAcontecer={textoDaAcao(acao)}
          detalhes={[{ rotulo: 'Pessoa', valor: `${acao.pessoa.nome} (${acao.pessoa.email})` }]}
          confirmarRotulo={tituloDaAcao(acao)}
          tone={acao.tipo === 'ativo' && !acao.ativo ? 'destrutivo' : 'padrao'}
          processando={processando}
          onConfirmar={executar}
        />
      ) : null}
    </div>
  )
}

function tituloDaAcao(a: Acao): string {
  if (a.tipo === 'papel') return a.papel === 'CS' ? 'Tornar CS' : 'Tornar super admin'
  if (a.tipo === 'ativo') return a.ativo ? 'Reativar' : 'Desativar'
  if (a.tipo === 'senha') return 'Gerar nova senha'
  return 'Zerar autenticador'
}

function textoDaAcao(a: Acao): string {
  const sai = 'A pessoa sai de todas as sessões abertas.'
  if (a.tipo === 'papel') {
    return a.papel === 'CS'
      ? `Passa a ver só o dashboard, as agências (sem alterar) e o suporte. ${sai}`
      : `Passa a fazer tudo no painel, inclusive entrar como agência, mexer em planos, cofre e nesta equipe. ${sai}`
  }
  if (a.tipo === 'ativo') return a.ativo ? 'Volta a entrar no painel com a senha e o autenticador que já tinha.' : `Deixa de entrar no painel. ${sai}`
  if (a.tipo === 'senha') return `A senha atual deixa de valer e uma provisória aparece aqui uma vez, para você entregar. ${sai}`
  return `No próximo acesso a pessoa cadastra o aplicativo autenticador de novo, como no primeiro. Use quando ela trocou ou perdeu o celular. ${sai}`
}

function NovaPessoa({ aberto, onFechar, onCriada }: {
  aberto: boolean
  onFechar: () => void
  onCriada: (r: SenhaParaEntregar) => void
}) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<PapelDaPlataforma>('CS')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  function fechar() {
    if (salvando) return
    setNome(''); setEmail(''); setPapel('CS'); setErro('')
    onFechar()
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setSalvando(true)
    setErro('')
    try {
      const r = await fetch('/api/admin/equipe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, email, papel }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Não foi possível adicionar.')
      setNome(''); setEmail(''); setPapel('CS')
      onCriada({ nome: d.pessoa.nome, email: d.pessoa.email, senha: d.senha })
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível adicionar.')
    } finally {
      setSalvando(false)
    }
  }

  const campo = 'w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-3 py-2 text-sm text-[var(--fin-text)] focus:border-[var(--fin-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--fin-accent)]/40'

  return (
    <Dialog open={aberto} onOpenChange={a => { if (!a) fechar() }}>
      <DialogContent>
        <form onSubmit={salvar}>
          <DialogHeader>
            <DialogTitle>Adicionar pessoa à equipe</DialogTitle>
            <DialogDescription>
              Ela recebe uma senha provisória e, no primeiro acesso, cadastra o aplicativo autenticador.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-4">
            <div>
              <label htmlFor="equipe-nome" className="mb-1 block text-sm font-medium text-[var(--fin-text-2)]">Nome</label>
              <input id="equipe-nome" className={campo} value={nome} onChange={e => setNome(e.target.value)} required autoComplete="off" />
            </div>
            <div>
              <label htmlFor="equipe-email" className="mb-1 block text-sm font-medium text-[var(--fin-text-2)]">E-mail</label>
              <input id="equipe-email" type="email" className={campo} value={email} onChange={e => setEmail(e.target.value)} required autoComplete="off" />
            </div>
            <fieldset>
              <legend className="mb-1 block text-sm font-medium text-[var(--fin-text-2)]">Papel</legend>
              <div className="space-y-2">
                {PAPEIS_DA_PLATAFORMA.map(p => (
                  <label key={p.valor} className={`flex cursor-pointer gap-3 rounded-[var(--fin-r-md)] border p-3 ${papel === p.valor ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border)]'}`}>
                    <input type="radio" name="papel" value={p.valor} checked={papel === p.valor} onChange={() => setPapel(p.valor)} className="mt-1" />
                    <span>
                      <span className="block text-sm font-medium text-[var(--fin-text)]">{p.rotulo}</span>
                      <span className="block text-xs text-[var(--fin-text-2)]">{p.descricao}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {erro ? <p role="alert" className="text-sm text-[var(--fin-negative-text)]">{erro}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={fechar} disabled={salvando}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SenhaProvisoria({ nome, email, senha, onFechar }: SenhaParaEntregar & { onFechar: () => void }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try {
      await navigator.clipboard.writeText(senha)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch { /* o texto continua na tela para copiar à mão */ }
  }
  return (
    <div role="status" className="mb-6 rounded-xl border border-[var(--fin-positive)]/30 bg-[var(--fin-positive-soft)] p-4">
      <p className="text-sm font-semibold text-[var(--fin-text)]">Senha provisória de {nome}</p>
      <p className="mt-1 text-sm text-[var(--fin-text-2)]">
        Entregue por um canal seguro, junto com o endereço <span className="font-medium">/admin/login</span> e o e-mail {email}.
        No primeiro acesso a pessoa cadastra o autenticador e pode trocar a senha em Minha conta. Esta senha não aparece de novo.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-3 py-2 font-mono text-[15px] tracking-wide text-[var(--fin-text)]">{senha}</code>
        <Button variant="outline" size="sm" onClick={copiar}>
          {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copiado ? 'Copiada' : 'Copiar'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onFechar}>Já entreguei</Button>
      </div>
    </div>
  )
}

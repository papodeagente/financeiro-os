'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Copy, FlaskConical, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Callout } from '@/components/fin/Callout'
import { ConfirmDialog } from '@/components/fin/ConfirmDialog'

/**
 * Agência de demonstração (14/11/2026): a conta de teste do Fernando, com a
 * versão completa e dados fictícios. Nada sai dela (CRM, nota, cobrança de
 * verdade); cobrança só pelo Asaas em sandbox.
 */
interface Situacao {
  existe: boolean
  tenant: { id: string; nome: string; slug: string; cnpj: string; plano: string; fin_versao: string } | null
  admin: { id: string; email: string; ativo: boolean; tem_2fa: boolean } | null
  dados: { semeado_em: string | null }
  contagens: Record<string, number> | null
}
interface Passo { passo: string; ok: boolean; detalhe: string }
interface Semeadura { ja_estava: boolean; passos: Passo[]; cobrancas: { emitidas: number; aviso: string | null } }

const ROTULOS: Record<string, string> = {
  vendas: 'Vendas', contas_receber: 'Contas a receber', contas_pagar: 'Contas a pagar', baixas: 'Liquidações',
  clientes: 'Clientes', fornecedores: 'Fornecedores', contas_bancarias: 'Contas bancárias', cartoes: 'Cartões',
  empresas: 'Empresas', centros_custo: 'Centros de custo', transferencias: 'Transferências', faturas: 'Faturas ao cliente',
  faturas_fornecedor: 'Faturas do fornecedor', notas: 'Notas', cheques: 'Cheques', cobrancas: 'Cobranças', usuarios: 'Usuários',
}

const fmt = (iso: string) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso))
const cnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')

const cartao = 'flex flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)]'

export default function DemonstracaoPage() {
  const [s, setS] = useState<Situacao | null>(null)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState<'' | 'criar' | 'semear' | 'recriar' | 'apagar'>('')
  const [senha, setSenha] = useState('')
  const [copiada, setCopiada] = useState(false)
  const [resultado, setResultado] = useState<Semeadura | null>(null)
  const [confirmar, setConfirmar] = useState<'' | 'recriar' | 'apagar'>('')

  async function carregar() {
    try {
      const r = await fetch('/api/admin/demo', { cache: 'no-store' })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.error || 'A situação da demonstração não pôde ser lida.')
      setS(d)
      setErro('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A situação da demonstração não pôde ser lida.')
    }
  }
  useEffect(() => { carregar() }, [])

  async function criarAgencia() {
    setOcupado('criar')
    setErro('')
    try {
      const r = await fetch('/api/admin/demo', { method: 'POST' })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.error || 'A agência não pôde ser criada.')
      if (d.senha) setSenha(d.senha)
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A agência não pôde ser criada.')
    } finally {
      setOcupado('')
    }
  }

  async function dados(acao: 'semear' | 'recriar' | 'apagar') {
    setOcupado(acao)
    setErro('')
    setResultado(null)
    try {
      const r = acao === 'apagar'
        ? await fetch('/api/admin/demo/dados', { method: 'DELETE' })
        : await fetch('/api/admin/demo/dados', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acao: acao === 'recriar' ? 'recriar' : 'criar' }),
          })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.error || 'Não foi possível agora.')
      if (acao !== 'apagar') setResultado(d)
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível agora.')
    } finally {
      setOcupado('')
      setConfirmar('')
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(senha)
      setCopiada(true)
      setTimeout(() => setCopiada(false), 2000)
    } catch { /* o navegador recusou: a senha continua na tela */ }
  }

  if (!s && !erro) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="size-6 animate-spin text-[var(--fin-text-3)]" /></div>
  }

  const semeado = Boolean(s?.dados.semeado_em)
  const contagens = Object.entries(s?.contagens ?? {}).filter(([, n]) => n > 0)

  return (
    <div className="flex max-w-3xl flex-col gap-[var(--fin-s-5)]">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-10 place-items-center rounded-[var(--fin-r-md)] bg-[var(--fin-violet-soft)] text-[var(--fin-violet)]">
          <FlaskConical className="size-5" />
        </span>
        <div className="flex flex-col">
          <h1 className="fin-t-title text-[var(--fin-text)]">Agência de demonstração</h1>
          <p className="fin-t-caption max-w-[70ch] text-[var(--fin-text-3)]">
            Uma agência fictícia com a versão completa e todos os módulos, para testar antes de liberar às agências. Fica fora das métricas da plataforma e nada sai dela: sem CRM, sem nota fiscal, cobrança só pelo Asaas em sandbox.
          </p>
        </div>
      </div>

      {erro ? <Callout tom="negativo" titulo="Não deu certo">{erro}</Callout> : null}

      {senha ? (
        <section aria-labelledby="senha-titulo" className="flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-warning)] bg-[var(--fin-warning-soft)] p-[var(--fin-s-4)]">
          <h2 id="senha-titulo" className="fin-t-subhead text-[var(--fin-warning-text)]">Senha do administrador: guarde agora</h2>
          <p className="fin-t-caption text-[var(--fin-text-2)]">Ela aparece só esta vez e não fica gravada em lugar nenhum.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="fin-t-body-strong select-all break-all rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-3 py-2 font-mono tabular-nums text-[var(--fin-text)]">{senha}</code>
            <Button variant="outline" onClick={copiar}>
              {copiada ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
              {copiada ? 'Copiada' : 'Copiar'}
            </Button>
          </div>
          <Button variant="ghost" className="self-start" onClick={() => setSenha('')}>Já guardei</Button>
        </section>
      ) : null}

      {s && !s.existe ? (
        <section className={cartao}>
          <h2 className="fin-t-subhead text-[var(--fin-text)]">Horizonte Viagens e Turismo (teste)</h2>
          <p className="fin-t-body max-w-[70ch] text-[var(--fin-text-2)]">
            Cria a agência com CNPJ fictício, plano Founder Pro, a versão completa e o administrador fernando+teste@entur.com.br. A senha aparece uma vez; a verificação em duas etapas é pedida no primeiro acesso.
          </p>
          <Button className="self-start" onClick={criarAgencia} disabled={ocupado !== ''}>
            {ocupado === 'criar' ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            Criar agência de demonstração
          </Button>
        </section>
      ) : null}

      {s?.existe && s.tenant ? (
        <>
          <section className={cartao} aria-labelledby="agencia-titulo">
            <h2 id="agencia-titulo" className="fin-t-subhead text-[var(--fin-text)]">{s.tenant.nome}</h2>
            <dl className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
              <div className="flex flex-col"><dt className="fin-t-caption text-[var(--fin-text-3)]">CNPJ fictício</dt><dd className="fin-t-body tabular-nums text-[var(--fin-text)]">{cnpj(s.tenant.cnpj)}</dd></div>
              <div className="flex flex-col"><dt className="fin-t-caption text-[var(--fin-text-3)]">Versão e plano</dt><dd className="fin-t-body text-[var(--fin-text)]">{s.tenant.fin_versao === 'completa' ? 'Completa, todos os módulos' : s.tenant.fin_versao} · {s.tenant.plano}</dd></div>
              <div className="flex flex-col"><dt className="fin-t-caption text-[var(--fin-text-3)]">Administrador</dt><dd className="fin-t-body break-all text-[var(--fin-text)]">{s.admin?.email ?? 'não encontrado'}</dd></div>
              <div className="flex flex-col"><dt className="fin-t-caption text-[var(--fin-text-3)]">Verificação em duas etapas</dt><dd className="fin-t-body text-[var(--fin-text)]">{s.admin?.tem_2fa ? 'Cadastrada' : 'Pedida no primeiro acesso'}</dd></div>
            </dl>
            <div className="flex flex-col gap-1 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] p-[var(--fin-s-3)]">
              <span className="fin-t-caption font-medium text-[var(--fin-text)]">Como entrar</span>
              <p className="fin-t-caption max-w-[70ch] text-[var(--fin-text-2)]">
                Na tela de entrada do Financeiro, use {s.admin?.email} e a senha mostrada na criação; depois cadastre o autenticador. Ou entre pelo Super Admin com &quot;Entrar como agência&quot;, na <Link className="text-[var(--fin-accent)] underline underline-offset-2" href={`/admin/tenants/${s.tenant.id}`}>ficha da agência</Link>.
              </p>
            </div>
          </section>

          <section className={cartao} aria-labelledby="dados-titulo">
            <div className="flex flex-col gap-1">
              <h2 id="dados-titulo" className="fin-t-subhead text-[var(--fin-text)]">Dados de demonstração</h2>
              <p className="fin-t-caption max-w-[70ch] text-[var(--fin-text-2)]">
                {semeado
                  ? `Criados em ${fmt(s.dados.semeado_em as string)}. Três meses de histórico e três à frente, contados a partir do dia em que foram criados.`
                  : 'Três meses de histórico e três à frente: empresas, contas, clientes, fornecedores, vendas de vários tipos, cancelamento, faturas, notas, comissões, cheques, relatório agendado, aprovação e uma mudança de sistema parada no ensaio. Feitos pelas funções do próprio sistema.'}
              </p>
            </div>

            {contagens.length ? (
              <dl className="grid grid-cols-2 gap-x-[var(--fin-s-4)] gap-y-1 sm:grid-cols-3">
                {contagens.map(([k, n]) => (
                  <div key={k} className="flex items-baseline justify-between gap-2 border-b border-[var(--fin-border)] py-1">
                    <dt className="fin-t-caption text-[var(--fin-text-2)]">{ROTULOS[k] ?? k}</dt>
                    <dd className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{n}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row">
              {!semeado ? (
                <Button onClick={() => dados('semear')} disabled={ocupado !== ''}>
                  {ocupado === 'semear' ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                  Criar dados de demonstração
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setConfirmar('recriar')} disabled={ocupado !== ''}>
                  {ocupado === 'recriar' ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                  Recriar dados
                </Button>
              )}
              <Button variant="destructive" onClick={() => setConfirmar('apagar')} disabled={ocupado !== '' || contagens.every(([k]) => k === 'usuarios')}>
                {ocupado === 'apagar' ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                Apagar dados de demonstração
              </Button>
            </div>
            {ocupado === 'semear' || ocupado === 'recriar' ? (
              <p className="fin-t-caption text-[var(--fin-text-3)]" role="status">Criando os dados. Pode levar um minuto.</p>
            ) : null}
          </section>

          {resultado && !resultado.ja_estava ? (
            <section className={cartao} aria-labelledby="resultado-titulo">
              <h2 id="resultado-titulo" className="fin-t-subhead text-[var(--fin-text)]">O que foi criado</h2>
              <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
                {resultado.passos.map(p => (
                  <li key={p.passo} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
                    <span className={`fin-t-body-strong shrink-0 sm:w-64 ${p.ok ? 'text-[var(--fin-text)]' : 'text-[var(--fin-negative-text)]'}`}>{p.passo}</span>
                    <span className="fin-t-body text-[var(--fin-text-2)]">{p.ok ? p.detalhe : `Parou aqui: ${p.detalhe}`}</span>
                  </li>
                ))}
              </ul>
              {resultado.passos.some(p => !p.ok) ? (
                <Callout tom="aviso" titulo="A criação parou no meio">Corrija o que o passo diz e use &quot;Criar dados&quot; de novo: começa de uma agência limpa.</Callout>
              ) : resultado.cobrancas.aviso ? (
                <Callout tom="info" titulo="Cobranças">{resultado.cobrancas.aviso}</Callout>
              ) : (
                <Callout tom="positivo" titulo="Cobranças de teste">{resultado.cobrancas.emitidas} emitidas no Asaas sandbox.</Callout>
              )}
            </section>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        aberto={confirmar !== ''}
        onOpenChange={a => { if (!a) setConfirmar('') }}
        titulo={confirmar === 'apagar' ? 'Apagar os dados de demonstração?' : 'Recriar os dados de demonstração?'}
        oQueVaiAcontecer={confirmar === 'apagar'
          ? 'Tudo o que foi criado na agência de demonstração sai. Ficam a agência, o administrador e a chave do Asaas sandbox. Nenhuma outra agência é tocada.'
          : 'Os dados atuais da demonstração saem e são criados de novo, com as datas de hoje. Nenhuma outra agência é tocada.'}
        confirmarRotulo={confirmar === 'apagar' ? 'Apagar dados' : 'Recriar dados'}
        tone={confirmar === 'apagar' ? 'destrutivo' : 'padrao'}
        processando={ocupado !== ''}
        onConfirmar={() => dados(confirmar === 'apagar' ? 'apagar' : 'recriar')}
      />
    </div>
  )
}

'use client';

/**
 * COMISSÃO POR MRR (Bruno, 04/11/2026), só na conta do ecossistema.
 *
 * Metas de MRR novo por vendedor, com os produtos do Entur OS que contam para
 * cada meta, o que o CRM diz que cada um vendeu no mês e a comissão pelas
 * faixas do plano (regras em src/lib/comissao-mrr.ts). Para uma agência a
 * página não existe: a rota responde 404 e o menu não a mostra.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Calculator, CircleAlert, Copy, Layers, Pencil, Plus, Repeat, Target, Trash2, TrendingUp, UserX, Wallet,
} from 'lucide-react';

import { cn, formatBRL } from '@/lib/utils';
import { hojeISO } from '@/lib/money';
import { useAuth } from '@/contexts/AuthContext';
import { podeEditarFinanceiro } from '@/lib/permissoes';
import type { ApuracaoMrr, MetaMrr, ResultadoDaMeta } from '@/lib/comissao-mrr';
import type { MrrDoCrm, ProdutoDoEcossistema } from '@/lib/mrr-vendido';
import { Button } from '@/components/ui/button';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { SeletorDeMes } from '@/components/fin/SeletorDeMes';
import { Callout } from '@/components/fin/Callout';
import { DataState } from '@/components/fin/DataState';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Field } from '@/components/fin/Field';
import {
  BarraDoTom, CabecaDoBloco, CARTAO_DO_PAINEL, CartaoDeNumero, SeloDoTom, TituloDeSecao, type TomDoPainel,
} from '@/components/fin/PecasDoPainel';

interface ComissaoGravada { id: string; status: string; valor_comissao: number; vendedor_id: string }
interface Painel { mes: string; metas: MetaMrr[]; crm: MrrDoCrm; apuracao: ApuracaoMrr | null; comissoes: ComissaoGravada[] }
interface Pessoa { id: string; nome: string; perfil: string; status: string }

const CAMPO = 'fin-t-body h-11 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] lg:h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';
const CLASSES: Array<{ classe: ProdutoDoEcossistema['classe']; rotulo: string }> = [
  { classe: 'plano', rotulo: 'Planos' },
  { classe: 'adicional', rotulo: 'Adicionais' },
  { classe: 'programa', rotulo: 'Programas' },
  { classe: 'outros', rotulo: 'Outros' },
];
const STATUS: Record<string, { rotulo: string; tom: TomDoPainel }> = {
  CALCULADA: { rotulo: 'Calculada', tom: 'acento' },
  APROVADA: { rotulo: 'Aprovada', tom: 'info' },
  PAGA: { rotulo: 'Paga', tom: 'positivo' },
  CANCELADA: { rotulo: 'Cancelada', tom: 'neutro' },
};

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0, minimumFractionDigits: 0 });
const pctBR = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const mesAnterior = (mes: string) => {
  const [a, m] = mes.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
};
const mesPorExtenso = (mes: string) => {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const tomDoPct = (pct: number | null): TomDoPainel => (pct === null ? 'neutro' : pct >= 100 ? 'positivo' : pct >= 70 ? 'acento' : 'aviso');

function mesDaUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const m = new URLSearchParams(window.location.search).get('mes');
  return m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : null;
}

// ============================================================
// A meta, para editar
// ============================================================

interface Rascunho { id?: string; nome: string; produtos: string[]; produtos_nomes: Record<string, string>; valores: Record<string, string> }

function FormularioDaMeta({ rascunho, setRascunho, produtos, outras, pessoas }: {
  rascunho: Rascunho;
  setRascunho: (r: Rascunho) => void;
  produtos: ProdutoDoEcossistema[];
  outras: MetaMrr[];
  pessoas: Pessoa[];
}) {
  const ocupado = (chave: string) => outras.find(o => o.produtos.includes(chave)) ?? null;
  const alternar = (p: ProdutoDoEcossistema) => {
    const tem = rascunho.produtos.includes(p.chave);
    setRascunho({
      ...rascunho,
      produtos: tem ? rascunho.produtos.filter(x => x !== p.chave) : [...rascunho.produtos, p.chave],
      produtos_nomes: { ...rascunho.produtos_nomes, [p.chave]: p.nome },
    });
  };
  return (
    <div className="flex flex-col gap-[var(--fin-s-4)]">
      <Field rotulo="Nome da meta" obrigatorio ajuda="Ex.: Planos, Adicionais, Upsell.">
        {a => <input {...a} type="text" maxLength={80} value={rascunho.nome} onChange={e => setRascunho({ ...rascunho, nome: e.target.value })} className={CAMPO} />}
      </Field>

      <fieldset className="flex flex-col gap-[var(--fin-s-2)]">
        <legend className="fin-t-body-strong text-[var(--fin-text)]">Produtos do CRM que contam para esta meta</legend>
        <p className="fin-t-caption text-[var(--fin-text-3)]">Um produto conta para uma meta só no mês: na segunda, a mesma venda pagaria duas vezes.</p>
        {produtos.length === 0 ? (
          <p className="fin-t-caption rounded-[12px] bg-[var(--fin-warning-soft)] px-3 py-2 text-[var(--fin-text-2)]">
            Os produtos vêm do CRM, que não respondeu agora. Tente de novo em instantes.
          </p>
        ) : CLASSES.map(({ classe, rotulo }) => {
          const daClasse = produtos.filter(p => p.classe === classe);
          if (!daClasse.length) return null;
          return (
            <div key={classe} className="flex flex-col gap-1.5">
              <span className="fin-t-overline text-[var(--fin-text-3)]">{rotulo}</span>
              <div className="flex flex-wrap gap-2">
                {daClasse.map(p => {
                  const outra = ocupado(p.chave);
                  const marcado = rascunho.produtos.includes(p.chave);
                  return (
                    <label
                      key={p.chave}
                      title={outra ? `Já conta para a meta "${outra.nome}"` : undefined}
                      className={cn(
                        'fin-t-caption inline-flex h-9 cursor-pointer items-center gap-2 rounded-[var(--fin-r-dot)] border px-3',
                        marcado ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]' : 'border-[var(--fin-border-strong)] text-[var(--fin-text-2)]',
                        outra && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <input type="checkbox" className="size-3.5 accent-[var(--fin-accent)]" checked={marcado} disabled={!!outra} onChange={() => alternar(p)} />
                      {p.nome}{outra ? ` · em ${outra.nome}` : ''}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </fieldset>

      <fieldset className="flex flex-col gap-[var(--fin-s-2)]">
        <legend className="fin-t-body-strong text-[var(--fin-text)]">Meta de MRR novo de cada vendedor</legend>
        <p className="fin-t-caption text-[var(--fin-text-3)]">Em reais de MRR (o anual entra dividido por 12). Em branco: o vendedor não tem esta meta, e o que ele vender destes produtos fica pendente.</p>
        {pessoas.length === 0 ? (
          <p className="fin-t-caption text-[var(--fin-text-3)]">Nenhum vendedor cadastrado. Cadastre em <Link className="text-[var(--fin-accent)] hover:underline" href="/equipe/vendedores">Vendedores e planos</Link>.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--fin-border)] rounded-[12px] border border-[var(--fin-border)]">
            {pessoas.map(p => (
              <li key={p.id} className="flex items-center gap-[var(--fin-s-3)] px-3 py-2">
                <span className="fin-t-body min-w-0 flex-1 truncate text-[var(--fin-text)]">{p.nome}</span>
                <label className="sr-only" htmlFor={`meta-${p.id}`}>Meta de {p.nome}</label>
                <input
                  id={`meta-${p.id}`}
                  type="number" inputMode="decimal" min={0} step={1} placeholder="Sem meta"
                  value={rascunho.valores[p.id] ?? ''}
                  onChange={e => setRascunho({ ...rascunho, valores: { ...rascunho.valores, [p.id]: e.target.value } })}
                  className={cn(CAMPO, 'w-36 text-right tabular-nums')}
                />
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </div>
  );
}

// ============================================================
// A página
// ============================================================

export default function ComissaoPorMrrPage() {
  const { user } = useAuth();
  const podeEditar = podeEditarFinanceiro(user);
  // Só a conta do ecossistema tem esta página; a rota também recusa (404).
  const foraDoEcossistema = !!user && user.tenantPerfil !== 'ecossistema';
  const [mes, setMes] = useState(() => hojeISO().slice(0, 7));
  const [painel, setPainel] = useState<Painel | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erroDaMeta, setErroDaMeta] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState<{ tom: 'positivo' | 'aviso' | 'negativo'; texto: string; avisos: string[] } | null>(null);

  useEffect(() => { const m = mesDaUrl(); if (m) setMes(m); }, []);

  const carregar = useCallback(async (m: string) => {
    setErro(null);
    try {
      const [r, eq] = await Promise.all([
        fetch(`/api/comissao-mrr?mes=${m}`, { cache: 'no-store' }),
        fetch('/api/equipe', { cache: 'no-store' }),
      ]);
      const corpo = await r.json().catch(() => null);
      if (!r.ok) throw new Error(corpo?.error || 'Não foi possível carregar a comissão por MRR.');
      setPainel(corpo as Painel);
      const e = await eq.json().catch(() => null);
      setPessoas(Array.isArray(e?.equipe) ? (e.equipe as Pessoa[]) : []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar a comissão por MRR.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (foraDoEcossistema) return;
    setCarregando(true);
    void carregar(mes);
  }, [mes, carregar, foraDoEcossistema]);

  const trocarMes = (m: string) => {
    setMes(m);
    setResultado(null);
    const url = new URL(window.location.href);
    url.searchParams.set('mes', m);
    window.history.replaceState(null, '', url.toString());
  };

  const crmOk = painel?.crm.situacao === 'ok' ? painel.crm : null;
  const ap = painel?.apuracao ?? null;
  const metas = useMemo(() => painel?.metas ?? [], [painel]);

  // Os produtos para vincular: os do CRM, mais os já vinculados (a tela de
  // metas funciona mesmo com o CRM fora do ar).
  const produtos = useMemo(() => {
    const m = new Map<string, ProdutoDoEcossistema>();
    for (const p of crmOk?.mrr.produtos ?? []) m.set(p.chave, p);
    for (const meta of metas) for (const c of meta.produtos) {
      if (!m.has(c)) m.set(c, { chave: c, nome: meta.produtos_nomes[c] ?? c, classe: (c.split(':')[0] as ProdutoDoEcossistema['classe']) || 'outros' });
    }
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [crmOk, metas]);

  // Vendedores para as metas: quem é vendedor e está ativo, mais quem já tem valor numa meta.
  const vendedores = useMemo(() => {
    const comMeta = new Set(metas.flatMap(m => Object.keys(m.valores)));
    return pessoas.filter(p => (p.perfil === 'VENDEDOR' && p.status !== 'INATIVO') || comMeta.has(p.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [pessoas, metas]);
  const nomeDe = (id: string) => pessoas.find(p => p.id === id)?.nome ?? 'Vendedor removido';

  const abrirMeta = (m?: MetaMrr) => {
    setErroDaMeta(null);
    setRascunho(m
      ? { id: m.id, nome: m.nome, produtos: [...m.produtos], produtos_nomes: { ...m.produtos_nomes }, valores: Object.fromEntries(Object.entries(m.valores).map(([k, v]) => [k, String(v)])) }
      : { nome: metas.length ? '' : 'Planos', produtos: [], produtos_nomes: {}, valores: {} });
  };

  const gravarMeta = async () => {
    if (!rascunho) return;
    setGravando(true);
    setErroDaMeta(null);
    try {
      const res = await fetch('/api/metas-mrr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'gravar', meta: { ...rascunho, mes } }),
      });
      const corpo = await res.json().catch(() => null);
      if (!res.ok) throw new Error(corpo?.error || 'Não foi possível gravar a meta.');
      setRascunho(null);
      await carregar(mes);
    } catch (e) {
      setErroDaMeta(e instanceof Error ? e.message : 'Não foi possível gravar a meta.');
    } finally {
      setGravando(false);
    }
  };

  const apagarMeta = async (m: MetaMrr) => {
    if (!window.confirm(`Apagar a meta "${m.nome}" de ${mesPorExtenso(mes)}? A comissão já gerada não muda até gerar de novo.`)) return;
    const res = await fetch(`/api/metas-mrr?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
    if (res.ok) await carregar(mes);
    else setErro('Não foi possível apagar a meta.');
  };

  const copiarMetas = async () => {
    const res = await fetch('/api/metas-mrr', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'copiar', de: mesAnterior(mes), para: mes }),
    });
    const corpo = await res.json().catch(() => null);
    if (!res.ok) setResultado({ tom: 'aviso', texto: corpo?.error || 'Não foi possível copiar as metas.', avisos: [] });
    await carregar(mes);
  };

  const gerar = async () => {
    setGerando(true);
    setResultado(null);
    try {
      const res = await fetch('/api/comissao-mrr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'gerar', mes }),
      });
      const corpo = await res.json().catch(() => null);
      if (!res.ok) throw new Error(corpo?.error || 'Não foi possível gerar a comissão por MRR.');
      const partes = [
        corpo.gravadas ? `${corpo.gravadas} ${corpo.gravadas === 1 ? 'comissão gravada' : 'comissões gravadas'}, com a conta a pagar` : '',
        corpo.canceladas ? `${corpo.canceladas} ${corpo.canceladas === 1 ? 'cancelada' : 'canceladas'} por ter zerado` : '',
        corpo.sem_mudanca ? `${corpo.sem_mudanca} sem mudança` : '',
      ].filter(Boolean);
      setResultado({
        tom: corpo.avisos?.length ? 'aviso' : 'positivo',
        texto: partes.length ? `${partes.join('; ')}.` : 'Nenhuma comissão a gerar neste mês.',
        avisos: Array.isArray(corpo.avisos) ? corpo.avisos : [],
      });
      await carregar(mes);
    } catch (e) {
      setResultado({ tom: 'negativo', texto: e instanceof Error ? e.message : 'Não foi possível gerar a comissão por MRR.', avisos: [] });
    } finally {
      setGerando(false);
    }
  };

  const gravadaDe = (vendedorId: string) => painel?.comissoes.find(c => c.vendedor_id === vendedorId) ?? null;
  const somaDasMetas = metas.reduce((s, m) => s + Object.values(m.valores).reduce((a, b) => a + b, 0), 0);
  const foraDaComissao = ap ? ap.foraDasMetas.mrr + ap.semVendedor.mrr + ap.semCadastro.reduce((s, x) => s + x.mrr, 0) : 0;
  const comissaoGravada = (painel?.comissoes ?? []).filter(c => c.status !== 'CANCELADA').reduce((s, c) => s + (Number(c.valor_comissao) || 0), 0);
  const mesFuturo = mes > hojeISO().slice(0, 7);

  if (foraDoEcossistema) {
    return (
      <MolduraDaPagina>
        <PageHeader icone={Repeat} titulo="Comissão por MRR" />
        <Callout tom="info" titulo="Esta página não faz parte desta conta">
          A comissão por MRR é da conta do ecossistema Entur OS. As comissões das vendas desta agência ficam em <Link className="text-[var(--fin-accent)] hover:underline" href="/equipe/comissoes">Comissões</Link>.
        </Callout>
      </MolduraDaPagina>
    );
  }

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={Repeat}
        titulo="Comissão por MRR"
        subtitulo="Metas de MRR novo por vendedor, os produtos do Entur OS que contam e a comissão pelas faixas do plano"
      />

      <div className={cn(CARTAO_DO_PAINEL, 'flex flex-col gap-[var(--fin-s-3)] p-3 sm:px-4 md:flex-row md:items-center md:justify-between')}>
        <div className="flex flex-wrap items-center gap-[var(--fin-s-3)]">
          <span className="fin-t-overline text-[var(--fin-text-3)]">Período</span>
          <SeletorDeMes valor={mes} onChange={trocarMes} />
          {painel ? (
            crmOk
              ? <SeloDoTom tom="positivo" title={`Vendas da Área Comercial do CRM, apuradas em ${new Date(crmOk.mrr.apurado_em || crmOk.consultado_em).toLocaleString('pt-BR')}`}>MRR vendido do CRM</SeloDoTom>
              : <SeloDoTom tom="aviso" title={painel.crm.situacao !== 'ok' ? painel.crm.detalhe : undefined}>Sem o MRR do CRM</SeloDoTom>
          ) : null}
        </div>
        {podeEditar ? (
          <Button onClick={gerar} disabled={!crmOk || gerando || mesFuturo} className="h-10 rounded-[10px] px-4">
            <Calculator aria-hidden="true" /> {gerando ? 'Gerando…' : 'Gerar comissões do mês'}
          </Button>
        ) : null}
      </div>

      {painel && painel.crm.situacao !== 'ok' ? (
        <Callout tom="aviso" titulo="Sem o MRR vendido do CRM não há comissão">
          {painel.crm.detalhe} As metas podem ser montadas assim mesmo; a apuração aparece quando o CRM responder.
        </Callout>
      ) : null}
      {resultado ? (
        <Callout tom={resultado.tom} titulo={resultado.texto} acaoSecundaria={{ rotulo: 'Fechar', onClick: () => setResultado(null) }}>
          {resultado.avisos.length ? (
            <ul className="mt-1 list-disc pl-5">{resultado.avisos.map(a => <li key={a}>{a}</li>)}</ul>
          ) : 'As contas a pagar estão em Contas a pagar, na data de pagamento de comissão.'}
        </Callout>
      ) : null}

      <DataState
        estado={carregando ? 'carregando' : erro && !painel ? 'erro' : 'ok'}
        erro={erro && !painel ? { mensagem: erro, onTentarDeNovo: () => { setCarregando(true); void carregar(mes); } } : null}
        esqueleto={
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map(i => <div key={i} className={cn(CARTAO_DO_PAINEL, 'h-[150px] animate-pulse')} />)}
          </div>
        }
      >
        {painel ? (
          <div className="flex flex-col">
            {/* ── O mês ─────────────────────────────────────────────── */}
            <TituloDeSecao extra={`${mesPorExtenso(mes)} · contas novas e reativadas · anual ÷ 12`}>O mês</TituloDeSecao>
            <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              <CartaoDeNumero n={{
                rotulo: 'MRR novo vendido', icone: TrendingUp, tom: 'acento',
                valor: ap ? reais(ap.total.mrr) : '—', valorCompleto: ap ? formatBRL(ap.total.mrr) : undefined,
                sub: ap ? `${crmOk?.mrr.vendas.length ?? 0} ${crmOk?.mrr.vendas.length === 1 ? 'conta' : 'contas'} no mês` : 'sem resposta do CRM',
              }} />
              <CartaoDeNumero n={{
                rotulo: 'MRR nas metas', icone: Target, tom: 'info',
                valor: ap ? reais(ap.total.mrr_nas_metas) : '—', valorCompleto: ap ? formatBRL(ap.total.mrr_nas_metas) : undefined,
                sub: somaDasMetas > 0 ? `de ${reais(somaDasMetas)} nas metas da equipe` : 'nenhuma meta no mês',
                anel: ap && somaDasMetas > 0 ? { pct: (ap.total.mrr_nas_metas / somaDasMetas) * 100, rotulo: `${pctBR((ap.total.mrr_nas_metas / somaDasMetas) * 100)} da soma das metas` } : null,
              }} />
              <CartaoDeNumero n={{
                rotulo: 'Comissão do mês', icone: Wallet, tom: 'positivo',
                valor: ap ? reais(ap.total.comissao) : '—', valorCompleto: ap ? formatBRL(ap.total.comissao) : undefined,
                sub: painel.comissoes.length ? `gerada: ${formatBRL(comissaoGravada)}` : 'ainda não gerada',
                selo: ap && painel.comissoes.length && Math.abs(comissaoGravada - ap.total.comissao) > 0.005
                  ? ap.vendedores.some(v => v.comissao > 0 && !gravadaDe(v.vendedor_id))
                    ? { tom: 'aviso', texto: 'falta gerar', dica: 'Há vendedor com comissão calculada e ainda não gerada: gere as comissões do mês.' }
                    : { tom: 'aviso', texto: 'difere do gerado', dica: 'O cálculo de agora não é o que foi gerado: gere de novo para atualizar as calculadas.' }
                  : null,
              }} />
              <CartaoDeNumero n={{
                rotulo: 'Fora da comissão', icone: CircleAlert, tom: foraDaComissao > 0 ? 'aviso' : 'neutro',
                valor: ap ? reais(foraDaComissao) : '—', valorCompleto: ap ? formatBRL(foraDaComissao) : undefined,
                sub: foraDaComissao > 0 ? 'produto fora das metas, sem vendedor ou sem cadastro' : 'todo o MRR do mês está nas metas',
              }} />
            </div>

            {/* ── Metas de MRR ─────────────────────────────────────── */}
            <div className="mt-[34px] flex flex-wrap items-center justify-between gap-[var(--fin-s-2)]">
              <TituloDeSecao extra="cada produto conta para uma meta só">Metas de MRR</TituloDeSecao>
              {podeEditar ? (
                <div className="flex flex-wrap gap-[var(--fin-s-2)]">
                  {metas.length === 0 ? (
                    <Button variant="outline" onClick={copiarMetas} className="h-9 rounded-[10px] px-3">
                      <Copy aria-hidden="true" /> Copiar de {mesPorExtenso(mesAnterior(mes))}
                    </Button>
                  ) : null}
                  <Button onClick={() => abrirMeta()} className="h-9 rounded-[10px] px-3">
                    <Plus aria-hidden="true" /> Nova meta
                  </Button>
                </div>
              ) : null}
            </div>
            {metas.length === 0 ? (
              <div className={cn(CARTAO_DO_PAINEL, 'mt-3.5 flex flex-col items-start gap-2 p-[22px]')}>
                <p className="fin-t-body-strong text-[var(--fin-text)]">Nenhuma meta de MRR em {mesPorExtenso(mes)}.</p>
                <p className="fin-t-body text-[var(--fin-text-2)]">Crie uma meta, vincule os produtos do Entur OS que contam para ela e dê o valor de cada vendedor. Sem meta não há faixa, e sem faixa não há comissão.</p>
              </div>
            ) : (
              <div className="mt-3.5 grid grid-cols-1 gap-3.5 xl:grid-cols-2">
                {metas.map(m => {
                  const total = Object.values(m.valores).reduce((a, b) => a + b, 0);
                  const realizado = ap ? ap.vendedores.reduce((s, v) => s + (v.metas.find(x => x.meta_id === m.id)?.realizado ?? 0), 0) : null;
                  return (
                    <section key={m.id} aria-labelledby={`meta-${m.id}`} className={cn(CARTAO_DO_PAINEL, 'flex min-w-0 flex-col gap-[var(--fin-s-4)] p-[22px]')}>
                      <CabecaDoBloco
                        id={`meta-${m.id}`} tom="acento" icone={Target} titulo={m.nome}
                        sub={`${m.produtos.length} ${m.produtos.length === 1 ? 'produto' : 'produtos'} · meta da equipe ${reais(total)}${realizado !== null ? ` · vendido ${reais(realizado)}` : ''}`}
                      >
                        {podeEditar ? (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon-sm" onClick={() => abrirMeta(m)} aria-label={`Editar a meta ${m.nome}`}><Pencil aria-hidden="true" /></Button>
                            <Button variant="ghost" size="icon-sm" onClick={() => void apagarMeta(m)} aria-label={`Apagar a meta ${m.nome}`}><Trash2 aria-hidden="true" /></Button>
                          </div>
                        ) : null}
                      </CabecaDoBloco>
                      <div className="flex flex-wrap gap-1.5">
                        {m.produtos.map(p => <SeloDoTom key={p} tom="neutro">{m.produtos_nomes[p] ?? p}</SeloDoTom>)}
                      </div>
                      <ul className="flex flex-col gap-[14px]">
                        {Object.entries(m.valores).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([vid, alvo]) => {
                          const r = ap?.vendedores.find(v => v.vendedor_id === vid)?.metas.find(x => x.meta_id === m.id) ?? null;
                          const pct = r?.pct ?? (ap ? 0 : null);
                          return (
                            <li key={vid}>
                              <BarraDoTom
                                tom={tomDoPct(pct)} nome={nomeDe(vid)}
                                numeros={`${r ? reais(r.realizado) : '—'} de ${reais(alvo)}`}
                                selo={pct !== null ? <SeloDoTom tom={tomDoPct(pct)}>{pctBR(pct)}</SeloDoTom> : null}
                                pct={pct}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}

            {/* ── Resultado por vendedor ───────────────────────────── */}
            <div className="mt-[34px]">
              <TituloDeSecao extra="faixa pelo quanto a meta foi batida; vale para o MRR inteiro da meta">Resultado por vendedor</TituloDeSecao>
            </div>
            {!ap ? (
              <p className="fin-t-body mt-3.5 text-[var(--fin-text-2)]">A apuração aparece quando o CRM responder.</p>
            ) : ap.vendedores.length === 0 ? (
              <p className="fin-t-body mt-3.5 text-[var(--fin-text-2)]">Nenhum vendedor com meta ou com venda de produto das metas em {mesPorExtenso(mes)}.</p>
            ) : (
              <ul className="mt-3.5 grid grid-cols-1 gap-3.5 xl:grid-cols-2">
                {ap.vendedores.map(v => {
                  const gravada = gravadaDe(v.vendedor_id);
                  const st = gravada ? STATUS[gravada.status] ?? STATUS.CALCULADA : null;
                  return (
                    <li key={v.vendedor_id} className={cn(CARTAO_DO_PAINEL, 'flex min-w-0 flex-col gap-[var(--fin-s-4)] p-[22px]')}>
                      <div className="flex flex-wrap items-start gap-[var(--fin-s-3)]">
                        <div className="min-w-0 flex-1">
                          <p className="fin-t-subhead text-[var(--fin-text)]">{v.nome}</p>
                          <p className="fin-t-caption text-[var(--fin-text-3)]">{v.plano_nome ? `Plano ${v.plano_nome}` : 'Sem plano de comissão'}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-[24px] font-medium leading-none tracking-[-0.02em] tabular-nums text-[var(--fin-text)]">{formatBRL(v.comissao)}</span>
                          {st ? <SeloDoTom tom={st.tom}>{st.rotulo}{gravada && Math.abs(gravada.valor_comissao - v.comissao) > 0.005 ? ` · ${formatBRL(gravada.valor_comissao)}` : ''}</SeloDoTom> : <SeloDoTom tom="neutro">Não gerada</SeloDoTom>}
                        </div>
                      </div>
                      <ul className="flex flex-col gap-[18px]">
                        {v.metas.map((r: ResultadoDaMeta) => (
                          <li key={r.meta_id}>
                            <BarraDoTom
                              tom={tomDoPct(r.pct)} nome={r.nome}
                              numeros={`${reais(r.realizado)}${r.alvo !== null ? ` de ${reais(r.alvo)}` : ''}`}
                              selo={r.pct !== null ? <SeloDoTom tom={tomDoPct(r.pct)}>{pctBR(r.pct)}</SeloDoTom> : <SeloDoTom tom="aviso">Sem meta</SeloDoTom>}
                              pct={r.pct}
                              sub={r.pendencia
                                ? <span className="text-[var(--fin-warning-text)]">{r.pendencia}</span>
                                : r.faixa
                                  ? <span>Faixa de {pctBR(r.percentual)} do MRR <b className="font-medium text-[var(--fin-text-2)]">= {formatBRL(r.comissao)}</b> · {r.contas.length} {r.contas.length === 1 ? 'conta' : 'contas'}</span>
                                  : <span>{r.contas.length} {r.contas.length === 1 ? 'conta' : 'contas'}</span>}
                            />
                          </li>
                        ))}
                      </ul>
                      {v.pendencias.filter(p => !v.metas.some(r => r.pendencia === p)).map(p => (
                        <p key={p} className="fin-t-caption flex items-start gap-1.5 rounded-[12px] bg-[var(--fin-warning-soft)] px-2.5 py-2 text-[var(--fin-text-2)]">
                          <CircleAlert aria-hidden="true" className="mt-px size-[13px] shrink-0 text-[var(--fin-warning-text)]" />{p}
                        </p>
                      ))}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* ── Fora da comissão ─────────────────────────────────── */}
            {ap && foraDaComissao > 0 ? (
              <>
                <div className="mt-[34px]">
                  <TituloDeSecao extra="MRR do mês que não vira comissão, e por quê">Fora da comissão</TituloDeSecao>
                </div>
                <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-3">
                  {ap.foraDasMetas.itens.length ? (
                    <section aria-labelledby="fora-metas" className={cn(CARTAO_DO_PAINEL, 'flex flex-col gap-[var(--fin-s-3)] p-[22px]')}>
                      <CabecaDoBloco id="fora-metas" tom="aviso" icone={Layers} titulo="Produto fora das metas" sub="Vincule a uma meta para contar" />
                      <ul className="flex flex-col gap-2">
                        {ap.foraDasMetas.itens.map(i => (
                          <li key={i.chave} className="fin-t-body flex justify-between gap-2"><span className="truncate text-[var(--fin-text)]">{i.nome}</span><span className="tabular-nums text-[var(--fin-text-2)]">{formatBRL(i.mrr)}</span></li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  {ap.semVendedor.contas.length ? (
                    <section aria-labelledby="sem-vendedor" className={cn(CARTAO_DO_PAINEL, 'flex flex-col gap-[var(--fin-s-3)] p-[22px]')}>
                      <CabecaDoBloco id="sem-vendedor" tom="aviso" icone={UserX} titulo="Venda sem vendedor" sub="Ligue a negociação na Área Comercial do CRM" />
                      <ul className="flex flex-col gap-2">
                        {ap.semVendedor.contas.map(c => (
                          <li key={`${c.conta_nome}-${c.dia}`} className="fin-t-body flex justify-between gap-2"><span className="truncate text-[var(--fin-text)]">{c.conta_nome}</span><span className="tabular-nums text-[var(--fin-text-2)]">{formatBRL(c.mrr)}</span></li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  {ap.semCadastro.length ? (
                    <section aria-labelledby="sem-cadastro" className={cn(CARTAO_DO_PAINEL, 'flex flex-col gap-[var(--fin-s-3)] p-[22px]')}>
                      <CabecaDoBloco id="sem-cadastro" tom="aviso" icone={UserX} titulo="Vendedor sem cadastro" sub="Gerar as comissões cria o cadastro; depois escolha o plano" />
                      <ul className="flex flex-col gap-2">
                        {ap.semCadastro.map(s => (
                          <li key={s.id} className="fin-t-body flex justify-between gap-2"><span className="truncate text-[var(--fin-text)]">{s.nome || s.email}</span><span className="tabular-nums text-[var(--fin-text-2)]">{formatBRL(s.mrr)}</span></li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </div>
              </>
            ) : null}

            <p className="fin-t-caption mt-[var(--fin-s-5)] text-[var(--fin-text-3)]">
              O MRR vendido é o das contas novas e reativadas do mês na Área Comercial do CRM, com o anual dividido por 12. A faixa sai do plano de comissão de cada vendedor
              (<Link className="text-[var(--fin-accent)] hover:underline" href="/equipe/planos-comissao">Planos de comissão</Link>) e vale para o MRR inteiro da meta. Comissão aprovada ou paga nunca é reescrita: se o número mudar, a tela avisa.
            </p>
          </div>
        ) : null}
      </DataState>

      <RecordSheet
        aberto={!!rascunho}
        onOpenChange={aberto => { if (!aberto) setRascunho(null); }}
        titulo={rascunho?.id ? 'Editar meta de MRR' : 'Nova meta de MRR'}
        descricao={`${mesPorExtenso(mes)}. A meta mede o MRR novo dos produtos vinculados.`}
        largura={640}
        acaoPrimaria={{ rotulo: 'Gravar meta', onClick: gravarMeta, carregando: gravando, desabilitado: !rascunho?.nome.trim() || !rascunho?.produtos.length }}
        acaoSecundaria={{ rotulo: 'Cancelar', onClick: () => setRascunho(null) }}
      >
        {rascunho ? (
          <div className="flex flex-col gap-[var(--fin-s-3)]">
            {erroDaMeta ? <Callout tom="negativo">{erroDaMeta}</Callout> : null}
            <FormularioDaMeta
              rascunho={rascunho} setRascunho={setRascunho} produtos={produtos}
              outras={metas.filter(m => m.id !== rascunho.id)} pessoas={vendedores}
            />
          </div>
        ) : null}
      </RecordSheet>
    </MolduraDaPagina>
  );
}

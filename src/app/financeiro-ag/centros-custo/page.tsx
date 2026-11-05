'use client';

/**
 * Centros de Custo (05/11/2026): cadastro em árvore (código, centro de cima,
 * responsável, orçamento do mês, ativo) e as regras de rateio salvas, que
 * os formulários de contas aplicam com um clique.
 */
import * as React from 'react';
import { Network, Pencil, Plus, Trash2 } from 'lucide-react';

import type { CentroCusto, PlanoContas, RegraRateio } from '@/lib/crm-types';
import { dividirIgual, ordenarEmArvore, validarRateio } from '@/lib/dimensoes';
import { round2, soma } from '@/lib/money';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Field } from '@/components/fin/Field';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { MoneyField } from '@/components/fin/MoneyField';
import { PageHeader } from '@/components/fin/PageHeader';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { statusChipVariants } from '@/components/fin/StatusChip';

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0';
const CONTROLE = cn(
  'fin-t-body h-11 min-h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] lg:h-10 lg:min-h-10',
  FOCO,
);
const ACAO_LINHA = cn(
  'size-11 rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] shadow-none hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] lg:size-10',
  FOCO,
);
const RECUO: Record<number, string> = { 0: '', 1: 'pl-4', 2: 'pl-8', 3: 'pl-12' };
const NENHUM = '__NENHUM__';

type FormCentro = {
  codigo: string;
  nome: string;
  centro_pai_id: string;
  responsavel: string;
  orcamento_mensal: number;
  ativo: boolean;
};
const CENTRO_VAZIO: FormCentro = { codigo: '', nome: '', centro_pai_id: '', responsavel: '', orcamento_mensal: 0, ativo: true };

type LinhaRegra = { centro_custo_id: string; categoria_id?: string; percentual: number };
type FormRegra = { nome: string; linhas: LinhaRegra[] };

function novoId(prefixo: string): string {
  return `${prefixo}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function enviar(url: string, metodo: 'POST' | 'PUT' | 'DELETE', corpo?: unknown) {
  const res = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'O servidor não respondeu. Nada foi alterado.');
  return json;
}

function Opcoes({
  rotulo, valor, opcoes, onChange, id, describedBy,
}: {
  rotulo: string;
  valor: string;
  opcoes: Array<{ valor: string; rotulo: string; recuo?: number; desabilitada?: boolean }>;
  onChange: (v: string) => void;
  id?: string;
  describedBy?: string;
}) {
  return (
    <Select value={valor || NENHUM} onValueChange={v => onChange(String(v) === NENHUM ? '' : String(v))}>
      <SelectTrigger id={id} aria-label={rotulo} aria-describedby={describedBy} className={cn(CONTROLE, 'justify-between gap-2')}>
        <SelectValue>{() => opcoes.find(o => o.valor === (valor || NENHUM))?.rotulo ?? ''}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {opcoes.map(o => (
          <SelectItem key={o.valor} value={o.valor} disabled={o.desabilitada} className={cn('fin-t-body', RECUO[Math.min(o.recuo ?? 0, 3)])}>
            {o.rotulo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function CentrosDeCustoPage() {
  const [centros, setCentros] = React.useState<CentroCusto[]>([]);
  const [regras, setRegras] = React.useState<RegraRateio[]>([]);
  const [categorias, setCategorias] = React.useState<PlanoContas[]>([]);
  const [estado, setEstado] = React.useState<'carregando' | 'erro' | 'ok'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);

  const [centroAberto, setCentroAberto] = React.useState<{ id: string | null } | null>(null);
  const [formCentro, setFormCentro] = React.useState<FormCentro>(CENTRO_VAZIO);
  const [inicialCentro, setInicialCentro] = React.useState<FormCentro>(CENTRO_VAZIO);
  const [regraAberta, setRegraAberta] = React.useState<{ id: string | null } | null>(null);
  const [formRegra, setFormRegra] = React.useState<FormRegra>({ nome: '', linhas: [] });
  const [salvando, setSalvando] = React.useState(false);
  const [excluir, setExcluir] = React.useState<{ tipo: 'centro' | 'regra'; id: string; nome: string } | null>(null);
  const [excluindo, setExcluindo] = React.useState(false);

  async function carregar() {
    setEstado('carregando');
    try {
      const [c, r, p] = await Promise.all(['/api/centros-custo', '/api/regras-rateio', '/api/plano-contas'].map(async url => {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('A consulta não respondeu.');
        return res.json();
      }));
      setCentros(Array.isArray(c) ? c : []);
      setRegras(Array.isArray(r) ? r : []);
      setCategorias(Array.isArray(p) ? p : []);
      setErro(null);
      setAtualizadoEm(new Date());
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A consulta não respondeu.');
      setEstado('erro');
    }
  }

  React.useEffect(() => { void carregar(); }, []);

  const arvore = React.useMemo(() => ordenarEmArvore(centros), [centros]);
  const nomeDoCentro = React.useCallback((id: string) => centros.find(c => c.id === id)?.nome ?? 'Centro excluído', [centros]);
  const categoriaPorId = React.useMemo(() => new Map(categorias.map(c => [c.id, c])), [categorias]);
  const totalOrcado = round2(soma(centros.filter(c => c.ativo).map(c => c.orcamento_mensal ?? 0)));

  function abrirCentro(c: CentroCusto | null, paiId = '') {
    const inicial: FormCentro = c
      ? { codigo: c.codigo ?? '', nome: c.nome, centro_pai_id: c.centro_pai_id ?? '', responsavel: c.responsavel ?? '', orcamento_mensal: c.orcamento_mensal ?? 0, ativo: c.ativo }
      : { ...CENTRO_VAZIO, centro_pai_id: paiId };
    setFormCentro(inicial);
    setInicialCentro(inicial);
    setCentroAberto({ id: c?.id ?? null });
  }

  async function salvarCentro() {
    if (!centroAberto || !formCentro.nome.trim()) return;
    setSalvando(true);
    try {
      const corpo = { ...formCentro, orcamento_mensal: formCentro.orcamento_mensal > 0 ? formCentro.orcamento_mensal : null };
      if (centroAberto.id) await enviar(`/api/centros-custo/${encodeURIComponent(centroAberto.id)}`, 'PUT', corpo);
      else await enviar('/api/centros-custo', 'POST', { id: novoId('cc'), ...corpo });
      toast.success(centroAberto.id ? 'Centro de custo atualizado' : 'Centro de custo criado', formCentro.nome.trim());
      setCentroAberto(null);
      void carregar();
    } catch (e) {
      toast.error('Não foi possível salvar o centro de custo', e instanceof Error ? e.message : '');
    } finally {
      setSalvando(false);
    }
  }

  function abrirRegra(r: RegraRateio | null) {
    const pcts = dividirIgual(2);
    setFormRegra(r ? { nome: r.nome, linhas: r.linhas.map(l => ({ ...l })) } : { nome: '', linhas: [{ centro_custo_id: '', percentual: pcts[0] }, { centro_custo_id: '', percentual: pcts[1] }] });
    setRegraAberta({ id: r?.id ?? null });
  }

  const conferenciaRegra = validarRateio(100, formRegra.linhas);
  async function salvarRegra() {
    if (!regraAberta) return;
    setSalvando(true);
    try {
      if (regraAberta.id) await enviar(`/api/regras-rateio/${encodeURIComponent(regraAberta.id)}`, 'PUT', formRegra);
      else await enviar('/api/regras-rateio', 'POST', { id: novoId('rr'), ...formRegra });
      toast.success('Regra de rateio salva', formRegra.nome.trim());
      setRegraAberta(null);
      void carregar();
    } catch (e) {
      toast.error('Não foi possível salvar a regra', e instanceof Error ? e.message : '');
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarExclusao() {
    if (!excluir) return;
    setExcluindo(true);
    try {
      const base = excluir.tipo === 'centro' ? '/api/centros-custo/' : '/api/regras-rateio/';
      await enviar(`${base}${encodeURIComponent(excluir.id)}`, 'DELETE');
      toast.success(excluir.tipo === 'centro' ? 'Centro de custo excluído' : 'Regra excluída', excluir.nome);
      setExcluir(null);
      void carregar();
    } catch (e) {
      toast.error('Não foi possível excluir', e instanceof Error ? e.message : '');
    } finally {
      setExcluindo(false);
    }
  }

  const opcoesCentro = arvore.map(c => ({ valor: c.id, rotulo: `${c.codigo ? `${c.codigo} · ` : ''}${c.nome}${c.ativo ? '' : ' (inativo)'}`, recuo: c.nivel }));
  const descendentesDoAberto = React.useMemo(() => {
    const id = centroAberto?.id;
    if (!id) return new Set<string>();
    const saida = new Set<string>([id]);
    let cresceu = true;
    while (cresceu) {
      cresceu = false;
      for (const c of centros) if (c.centro_pai_id && saida.has(c.centro_pai_id) && !saida.has(c.id)) { saida.add(c.id); cresceu = true; }
    }
    return saida;
  }, [centroAberto, centros]);

  const colunasCentro: FinColuna<CentroCusto & { nivel: number }>[] = [
    { id: 'codigo', cabecalho: 'Código', tipo: 'texto', minWidth: 72, render: r => <span className="fin-t-code text-[var(--fin-text-3)]">{r.codigo || '—'}</span> },
    {
      id: 'nome', cabecalho: 'Centro de custo', tipo: 'texto', minWidth: 220,
      render: r => (
        <span className={cn('block', RECUO[Math.min(r.nivel, 3)], r.nivel === 0 ? 'fin-t-body-strong text-[var(--fin-text)]' : 'fin-t-body text-[var(--fin-text-2)]')}>
          {r.nome}
        </span>
      ),
    },
    { id: 'responsavel', cabecalho: 'Responsável', tipo: 'texto', minWidth: 140, prioridade: 1, render: r => <span className="fin-t-body text-[var(--fin-text-2)]">{r.responsavel || '—'}</span> },
    { id: 'orcamento', cabecalho: 'Orçamento do mês', tipo: 'dinheiro', prioridade: 2, valor: r => r.orcamento_mensal ?? 0 },
    {
      id: 'situacao', cabecalho: 'Situação', tipo: 'texto', minWidth: 96,
      render: r => <span className={statusChipVariants({ tone: r.ativo ? 'positivo' : 'neutro' })}>{r.ativo ? 'Ativo' : 'Inativo'}</span>,
    },
    {
      id: 'acoes', cabecalho: 'Ações', tipo: 'acoes', minWidth: 144,
      render: r => (
        <>
          <Button type="button" variant="ghost" size="icon" aria-label={`Criar um centro abaixo de ${r.nome}`} title="Novo centro abaixo" className={ACAO_LINHA} onClick={() => abrirCentro(null, r.id)}>
            <Plus aria-hidden="true" className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={`Editar o centro ${r.nome}`} className={ACAO_LINHA} onClick={() => abrirCentro(r)}>
            <Pencil aria-hidden="true" className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={`Excluir o centro ${r.nome}`} className={cn(ACAO_LINHA, 'hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)]')} onClick={() => setExcluir({ tipo: 'centro', id: r.id, nome: r.nome })}>
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </>
      ),
    },
  ];

  const colunasRegra: FinColuna<RegraRateio>[] = [
    { id: 'nome', cabecalho: 'Regra', tipo: 'texto', minWidth: 160, render: r => <span className="fin-t-body-strong text-[var(--fin-text)]">{r.nome}</span> },
    {
      id: 'divisao', cabecalho: 'Divisão', tipo: 'texto', minWidth: 280,
      render: r => (
        <span className="fin-t-body text-[var(--fin-text-2)]">
          {r.linhas.map(l => {
            const cat = l.categoria_id ? categoriaPorId.get(l.categoria_id) : null;
            return `${l.percentual.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% ${nomeDoCentro(l.centro_custo_id)}${cat ? ` (${cat.nome})` : ''}`;
          }).join(' · ')}
        </span>
      ),
    },
    {
      id: 'acoes', cabecalho: 'Ações', tipo: 'acoes',
      render: r => (
        <>
          <Button type="button" variant="ghost" size="icon" aria-label={`Editar a regra ${r.nome}`} className={ACAO_LINHA} onClick={() => abrirRegra(r)}>
            <Pencil aria-hidden="true" className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={`Excluir a regra ${r.nome}`} className={cn(ACAO_LINHA, 'hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)]')} onClick={() => setExcluir({ tipo: 'regra', id: r.id, nome: r.nome })}>
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </>
      ),
    },
  ];

  const ativos = centros.filter(c => c.ativo).length;

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={Network}
        titulo="Centros de Custo"
        subtitulo="Onde cada despesa e cada receita acontece: loja, filial, projeto ou área. Um centro pode ficar dentro de outro."
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
        acoesSecundarias={[
          { rotulo: 'Nova regra de rateio', onClick: () => abrirRegra(null) },
          { rotulo: 'Relatório por centro de custo', href: '/financeiro-ag/relatorios/lancamentos-centro-custo' },
        ]}
        acaoPrimaria={{ rotulo: 'Novo centro', icone: Plus, onClick: () => abrirCentro(null) }}
      />

      {estado === 'ok' && centros.length > 0 ? (
        <p className="fin-t-body text-[var(--fin-text-2)]">
          <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{ativos.toLocaleString('pt-BR')}</span>{' '}
          {ativos === 1 ? 'centro ativo' : 'centros ativos'}
          {totalOrcado > 0 ? (
            <> · orçamento somado de <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{totalOrcado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span> por mês</>
          ) : null}
        </p>
      ) : null}

      <FinTable
        linhas={arvore}
        colunas={colunasCentro}
        chave={r => r.id}
        densidade="compacta"
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: carregar } : null}
        onLinhaClick={r => abrirCentro(r)}
        vazio={{
          motivo: 'sem-dado',
          titulo: 'Nenhum centro de custo ainda',
          oQueE: 'O centro de custo diz onde o dinheiro foi gasto ou ganho. Com ele, a mesma despesa de aluguel pode ser dividida entre duas lojas.',
          comoComeca: [
            'Crie um centro para cada loja, filial ou área da agência.',
            'Ponha centros dentro de outros quando quiser somar por grupo.',
            'Salve regras de rateio para as despesas que você sempre divide.',
          ],
          acao: { rotulo: 'Novo centro', onClick: () => abrirCentro(null) },
        }}
      />

      <section aria-labelledby="titulo-regras" className="flex flex-col gap-[var(--fin-s-3)]">
        <div className="flex flex-wrap items-end justify-between gap-[var(--fin-s-2)]">
          <div className="flex flex-col gap-[var(--fin-s-1)]">
            <h2 id="titulo-regras" className="fin-t-subhead text-[var(--fin-text)]">Regras de rateio</h2>
            <p className="fin-t-caption text-[var(--fin-text-2)]">Divisões que você usa sempre. No lançamento, um clique preenche o rateio.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => abrirRegra(null)} disabled={centros.length === 0} className={cn('h-11 gap-[var(--fin-s-2)] lg:h-10', FOCO)}>
            <Plus aria-hidden="true" className="size-4" />
            Nova regra
          </Button>
        </div>
        <FinTable
          linhas={regras}
          colunas={colunasRegra}
          chave={r => r.id}
          densidade="compacta"
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: carregar } : null}
          onLinhaClick={abrirRegra}
          vazio={{
            motivo: 'sem-dado',
            titulo: 'Nenhuma regra salva',
            oQueE: 'Uma regra guarda uma divisão, como "Aluguel: 50% Loja SP e 50% Loja RJ", para aplicar sem digitar de novo.',
            ...(centros.length > 0 ? { acao: { rotulo: 'Nova regra', onClick: () => abrirRegra(null) } } : {}),
          }}
        />
      </section>

      <RecordSheet
        aberto={centroAberto !== null}
        onOpenChange={aberto => { if (!aberto) setCentroAberto(null); }}
        titulo={centroAberto?.id ? 'Editar centro de custo' : 'Novo centro de custo'}
        descricao="O nome aparece nos lançamentos e nos relatórios."
        sujo={JSON.stringify(formCentro) !== JSON.stringify(inicialCentro)}
        resumo={
          formCentro.centro_pai_id
            ? `Fica dentro de ${nomeDoCentro(formCentro.centro_pai_id)}: o relatório desse centro passa a somar este também.`
            : 'Fica no primeiro nível da árvore.'
        }
        acaoPrimaria={{ rotulo: centroAberto?.id ? 'Salvar centro' : 'Criar centro', onClick: salvarCentro, carregando: salvando, desabilitado: !formCentro.nome.trim() }}
      >
        <div className="grid grid-cols-1 gap-[var(--fin-s-4)] sm:grid-cols-[120px_1fr]">
          <Field rotulo="Código" ajuda="Opcional. Ex.: 1.2">
            {a => <Input id={a.id} aria-describedby={a['aria-describedby']} value={formCentro.codigo} maxLength={20} onChange={e => setFormCentro(f => ({ ...f, codigo: e.target.value }))} className={cn(CONTROLE, 'fin-t-code')} />}
          </Field>
          <Field rotulo="Nome" obrigatorio>
            {a => <Input id={a.id} aria-describedby={a['aria-describedby']} value={formCentro.nome} maxLength={60} placeholder="Loja SP" onChange={e => setFormCentro(f => ({ ...f, nome: e.target.value }))} className={CONTROLE} />}
          </Field>
          <div className="sm:col-span-2">
            <Field rotulo="Fica dentro de" ajuda="O centro de cima soma tudo o que está abaixo dele.">
              {a => (
                <Opcoes
                  id={a.id}
                  describedBy={a['aria-describedby']}
                  rotulo="Fica dentro de"
                  valor={formCentro.centro_pai_id}
                  onChange={v => setFormCentro(f => ({ ...f, centro_pai_id: v }))}
                  opcoes={[{ valor: NENHUM, rotulo: 'Nenhum (primeiro nível)' }, ...opcoesCentro.map(o => ({ ...o, desabilitada: descendentesDoAberto.has(o.valor) }))]}
                />
              )}
            </Field>
          </div>
          <div className="sm:col-span-2 grid grid-cols-1 gap-[var(--fin-s-4)] sm:grid-cols-2">
            <Field rotulo="Responsável" ajuda="Quem responde pelos gastos deste centro.">
              {a => <Input id={a.id} aria-describedby={a['aria-describedby']} value={formCentro.responsavel} maxLength={80} onChange={e => setFormCentro(f => ({ ...f, responsavel: e.target.value }))} className={CONTROLE} />}
            </Field>
            <MoneyField rotulo="Orçamento do mês" ajuda="Opcional. Para comparar com o realizado." valor={formCentro.orcamento_mensal} onChange={v => setFormCentro(f => ({ ...f, orcamento_mensal: v }))} />
          </div>
          <div className="sm:col-span-2">
            <Field rotulo="Situação" ajuda="Inativo some da escolha nos lançamentos novos, mas continua nos relatórios.">
              {a => (
                <Opcoes
                  id={a.id}
                  describedBy={a['aria-describedby']}
                  rotulo="Situação"
                  valor={formCentro.ativo ? 'ATIVO' : 'INATIVO'}
                  onChange={v => setFormCentro(f => ({ ...f, ativo: v !== 'INATIVO' }))}
                  opcoes={[{ valor: 'ATIVO', rotulo: 'Ativo' }, { valor: 'INATIVO', rotulo: 'Inativo' }]}
                />
              )}
            </Field>
          </div>
        </div>
      </RecordSheet>

      <RecordSheet
        aberto={regraAberta !== null}
        onOpenChange={aberto => { if (!aberto) setRegraAberta(null); }}
        titulo={regraAberta?.id ? 'Editar regra de rateio' : 'Nova regra de rateio'}
        descricao="A regra precisa fechar 100%. Aplicar a regra num lançamento não muda os lançamentos antigos."
        largura={640}
        sujo={regraAberta !== null}
        resumo={conferenciaRegra.ok ? 'A divisão fecha 100%.' : conferenciaRegra.erro}
        acaoPrimaria={{ rotulo: 'Salvar regra', onClick: salvarRegra, carregando: salvando, desabilitado: !formRegra.nome.trim() || !conferenciaRegra.ok || formRegra.linhas.length === 0 }}
      >
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          <Field rotulo="Nome da regra" obrigatorio ajuda='Ex.: "Aluguel", "Internet das lojas".'>
            {a => <Input id={a.id} aria-describedby={a['aria-describedby']} value={formRegra.nome} maxLength={80} onChange={e => setFormRegra(f => ({ ...f, nome: e.target.value }))} className={CONTROLE} />}
          </Field>
          <ul className="flex flex-col gap-[var(--fin-s-2)]">
            {formRegra.linhas.map((l, i) => (
              <li key={i} className="grid grid-cols-[1fr_96px_44px] items-center gap-[var(--fin-s-2)] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_96px_44px]">
                <div className="col-span-3 sm:col-span-1">
                  <Opcoes
                    rotulo={`Centro da linha ${i + 1}`}
                    valor={l.centro_custo_id}
                    onChange={v => setFormRegra(f => ({ ...f, linhas: f.linhas.map((x, j) => (j === i ? { ...x, centro_custo_id: v } : x)) }))}
                    opcoes={[{ valor: NENHUM, rotulo: 'Escolha o centro', desabilitada: true }, ...opcoesCentro]}
                  />
                </div>
                <div className="col-span-3 sm:col-span-1">
                  <Opcoes
                    rotulo={`Categoria da linha ${i + 1}`}
                    valor={l.categoria_id ?? ''}
                    onChange={v => setFormRegra(f => ({ ...f, linhas: f.linhas.map((x, j) => (j === i ? { ...x, categoria_id: v || undefined } : x)) }))}
                    opcoes={[
                      { valor: NENHUM, rotulo: 'Mesma do lançamento' },
                      ...[...categorias].sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true })).map(c => ({ valor: c.id, rotulo: `${c.codigo} · ${c.nome}` })),
                    ]}
                  />
                </div>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.01"
                  aria-label={`Percentual da linha ${i + 1}`}
                  value={l.percentual}
                  onChange={e => setFormRegra(f => ({ ...f, linhas: f.linhas.map((x, j) => (j === i ? { ...x, percentual: Number(e.target.value) || 0 } : x)) }))}
                  className={cn(CONTROLE, 'text-right tabular-nums')}
                />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remover a linha ${i + 1}`} className={cn(ACAO_LINHA, 'hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)]')} onClick={() => setFormRegra(f => ({ ...f, linhas: f.linhas.filter((_, j) => j !== i) }))}>
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-[var(--fin-s-2)]">
            <Button
              type="button"
              variant="outline"
              className={cn('h-11 gap-[var(--fin-s-2)] lg:h-10', FOCO)}
              onClick={() => setFormRegra(f => ({ ...f, linhas: [...f.linhas, { centro_custo_id: '', percentual: round2(Math.max(0, 100 - soma(f.linhas.map(x => x.percentual)))) }] }))}
            >
              <Plus aria-hidden="true" className="size-4" />
              Adicionar linha
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={cn('h-11 lg:h-10', FOCO)}
              disabled={formRegra.linhas.length === 0}
              onClick={() => setFormRegra(f => { const p = dividirIgual(f.linhas.length); return { ...f, linhas: f.linhas.map((x, i) => ({ ...x, percentual: p[i] })) }; })}
            >
              Dividir igual
            </Button>
          </div>
        </div>
      </RecordSheet>

      <ConfirmDialog
        aberto={excluir !== null}
        onOpenChange={aberto => { if (!aberto) setExcluir(null); }}
        titulo={excluir?.tipo === 'regra' ? 'Excluir esta regra?' : 'Excluir este centro de custo?'}
        oQueVaiAcontecer={
          excluir?.tipo === 'regra'
            ? 'A regra deixa de aparecer nos lançamentos. Os lançamentos que já usaram a divisão continuam como estão.'
            : 'O centro sai do cadastro. Se ele já tiver lançamentos ou centros abaixo, a exclusão é recusada e o caminho é deixá-lo inativo.'
        }
        detalhes={excluir ? [{ rotulo: excluir.tipo === 'regra' ? 'Regra' : 'Centro', valor: excluir.nome }] : undefined}
        confirmarRotulo={excluir?.tipo === 'regra' ? 'Excluir regra' : 'Excluir centro'}
        tone="destrutivo"
        processando={excluindo}
        onConfirmar={confirmarExclusao}
      />
    </MolduraDaPagina>
  );
}

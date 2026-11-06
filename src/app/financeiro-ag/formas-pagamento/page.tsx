'use client';

/**
 * Formas de pagamento (05/11/2026). As formas de sempre já vêm prontas;
 * aqui a agência diz em que conta cada uma cai, em quantos dias e quanto
 * custa, desliga a que não usa e cria as próprias. Essas formas viram as
 * escolhas dos formulários de pagar e receber e da liquidação.
 */
import * as React from 'react';
import { Pencil, Plus, Trash2, Wallet } from 'lucide-react';

import { loadEntities } from '@/lib/crm-storage';
import { detalheDaForma, type FormaPagamento, type UsoDaForma } from '@/lib/formas-pagamento';
import { num } from '@/lib/money';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Field } from '@/components/fin/Field';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { MoneyField } from '@/components/fin/MoneyField';
import { PageHeader } from '@/components/fin/PageHeader';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { HistoricoRecolhivel } from '@/components/fin/HistoricoDoRegistro';
import { statusChipVariants } from '@/components/fin/StatusChip';
import { invalidarFormasDePagamento } from '@/components/fin/useFormasDePagamento';

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
const NENHUMA = '__NENHUMA__';

const ROTULO_DO_USO: Record<UsoDaForma, string> = {
  ambos: 'Pagar e receber',
  pagar: 'Só contas a pagar',
  receber: 'Só contas a receber',
};

type FormForma = {
  nome: string;
  uso: UsoDaForma;
  ativo: boolean;
  conta_bancaria_id: string;
  dias_para_cair: number;
  taxa_pct: number;
  taxa_fixa: number;
  informacoes: string;
};
const VAZIO: FormForma = { nome: '', uso: 'ambos', ativo: true, conta_bancaria_id: '', dias_para_cair: 0, taxa_pct: 0, taxa_fixa: 0, informacoes: '' };

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

function Opcoes({ id, describedBy, rotulo, valor, opcoes, onChange }: {
  id?: string;
  describedBy?: string;
  rotulo: string;
  valor: string;
  opcoes: Array<{ valor: string; rotulo: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={valor} onValueChange={v => onChange(String(v))}>
      <SelectTrigger id={id} aria-label={rotulo} aria-describedby={describedBy} className={cn(CONTROLE, 'justify-between gap-2')}>
        <SelectValue>{() => opcoes.find(o => o.valor === valor)?.rotulo ?? ''}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {opcoes.map(o => (
          <SelectItem key={o.valor} value={o.valor} className="fin-t-body">{o.rotulo}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NumeroComUnidade({ id, describedBy, valor, onChange, unidade, max, passo }: {
  id?: string;
  describedBy?: string;
  valor: number;
  onChange: (v: number) => void;
  unidade: string;
  max: number;
  passo: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        aria-describedby={describedBy}
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        step={passo}
        value={Number.isFinite(valor) ? String(valor) : ''}
        onChange={e => onChange(num(e.target.value.replace(',', '.')))}
        className={cn(CONTROLE, 'pr-14 text-right tabular-nums')}
      />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-[var(--fin-s-3)] flex items-center fin-t-body text-[var(--fin-text-2)]">
        {unidade}
      </span>
    </div>
  );
}

export default function FormasDePagamentoPage() {
  const [formas, setFormas] = React.useState<FormaPagamento[]>([]);
  const [contas, setContas] = React.useState<Array<{ id: string; nome: string }>>([]);
  const [estado, setEstado] = React.useState<'carregando' | 'erro' | 'ok'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);

  const [aberta, setAberta] = React.useState<{ forma: FormaPagamento | null } | null>(null);
  const [form, setForm] = React.useState<FormForma>(VAZIO);
  const [inicial, setInicial] = React.useState<FormForma>(VAZIO);
  const [salvando, setSalvando] = React.useState(false);
  const [excluir, setExcluir] = React.useState<FormaPagamento | null>(null);
  const [excluindo, setExcluindo] = React.useState(false);

  async function carregar() {
    setEstado('carregando');
    try {
      const [res, cb] = await Promise.all([
        fetch('/api/formas-pagamento', { cache: 'no-store' }),
        loadEntities<{ id: string; nome?: string }>('contas-bancarias').catch(() => []),
      ]);
      if (!res.ok) throw new Error('A consulta não respondeu.');
      const lista = (await res.json()) as unknown;
      setFormas(Array.isArray(lista) ? (lista as FormaPagamento[]) : []);
      setContas(cb.map(c => ({ id: c.id, nome: c.nome || 'Conta' })));
      setErro(null);
      setAtualizadoEm(new Date());
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A consulta não respondeu.');
      setEstado('erro');
    }
  }

  React.useEffect(() => { void carregar(); }, []);

  const nomeDaConta = React.useCallback(
    (id: string | null) => (id ? contas.find(c => c.id === id)?.nome ?? 'Conta excluída' : ''),
    [contas],
  );

  function abrir(f: FormaPagamento | null) {
    const v: FormForma = f
      ? {
        nome: f.nome, uso: f.uso, ativo: f.ativo, conta_bancaria_id: f.conta_bancaria_id ?? '',
        dias_para_cair: f.dias_para_cair, taxa_pct: f.taxa_pct, taxa_fixa: f.taxa_fixa, informacoes: f.informacoes,
      }
      : VAZIO;
    setForm(v);
    setInicial(v);
    setAberta({ forma: f });
  }

  async function salvar() {
    if (!aberta) return;
    const f = aberta.forma;
    setSalvando(true);
    try {
      const corpo = { ...form, conta_bancaria_id: form.conta_bancaria_id || null };
      if (f) await enviar(`/api/formas-pagamento/${encodeURIComponent(f.codigo)}`, 'PUT', corpo);
      else await enviar('/api/formas-pagamento', 'POST', corpo);
      invalidarFormasDePagamento();
      toast.success(f ? 'Forma de pagamento salva' : 'Forma de pagamento criada', f ? f.nome : form.nome.trim());
      setAberta(null);
      await carregar();
    } catch (e) {
      toast.error('Não foi possível salvar a forma de pagamento', e instanceof Error ? e.message : '');
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarExclusao() {
    if (!excluir) return;
    setExcluindo(true);
    try {
      await enviar(`/api/formas-pagamento/${encodeURIComponent(excluir.codigo)}`, 'DELETE');
      invalidarFormasDePagamento();
      toast.success('Forma de pagamento apagada', excluir.nome);
      setExcluir(null);
      await carregar();
    } catch (e) {
      toast.error('Não foi possível apagar', e instanceof Error ? e.message : '');
    } finally {
      setExcluindo(false);
    }
  }

  const colunas: FinColuna<FormaPagamento>[] = [
    {
      id: 'nome', cabecalho: 'Forma', tipo: 'texto', minWidth: 200, acessor: r => r.nome,
      render: r => (
        <span className="flex flex-col">
          <span className={cn('fin-t-body-strong', r.ativo ? 'text-[var(--fin-text)]' : 'text-[var(--fin-text-3)]')}>{r.nome}</span>
          {r.sistema ? null : <span className="fin-t-caption text-[var(--fin-text-3)]">Criada pela agência</span>}
        </span>
      ),
    },
    { id: 'uso', cabecalho: 'Usada em', tipo: 'texto', minWidth: 140, prioridade: 1, render: r => <span className="fin-t-body text-[var(--fin-text-2)]">{ROTULO_DO_USO[r.uso]}</span> },
    {
      id: 'conta', cabecalho: 'Conta padrão', tipo: 'texto', minWidth: 160, prioridade: 2,
      render: r => <span className="fin-t-body text-[var(--fin-text-2)]">{nomeDaConta(r.conta_bancaria_id) || '—'}</span>,
    },
    {
      id: 'prazo_taxa', cabecalho: 'Prazo e taxa', tipo: 'texto', minWidth: 200, prioridade: 2,
      render: r => <span className="fin-t-body tabular-nums text-[var(--fin-text-2)]">{detalheDaForma(r) || 'Na hora, sem taxa'}</span>,
    },
    {
      id: 'situacao', cabecalho: 'Situação', tipo: 'texto', minWidth: 104,
      render: r => <span className={statusChipVariants({ tone: r.ativo ? 'positivo' : 'neutro' })}>{r.ativo ? 'Ligada' : 'Desligada'}</span>,
    },
    {
      id: 'acoes', cabecalho: 'Ações', tipo: 'acoes', minWidth: 104,
      render: r => (
        <>
          <Button type="button" variant="ghost" size="icon" aria-label={`Ajustar ${r.nome}`} className={ACAO_LINHA} onClick={() => abrir(r)}>
            <Pencil aria-hidden="true" className="size-4" />
          </Button>
          {r.sistema ? null : (
            <Button
              type="button" variant="ghost" size="icon" aria-label={`Apagar ${r.nome}`}
              className={cn(ACAO_LINHA, 'hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)]')}
              onClick={() => setExcluir(r)}
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </Button>
          )}
        </>
      ),
    },
  ];

  const ligadas = formas.filter(f => f.ativo).length;
  const proprias = formas.filter(f => !f.sistema).length;
  const ehSistema = Boolean(aberta?.forma?.sistema);
  const exemploTaxa = detalheDaForma(form);
  const opcoesConta = [{ valor: NENHUMA, rotulo: 'Nenhuma' }, ...contas.map(c => ({ valor: c.id, rotulo: c.nome }))];

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={Wallet}
        titulo="Formas de pagamento"
        subtitulo="Como o dinheiro entra e sai. A conta, o prazo e a taxa de cada forma já vêm preenchidos ao lançar e ao liquidar."
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
        acaoPrimaria={{ rotulo: 'Nova forma', icone: Plus, onClick: () => abrir(null) }}
      />

      {estado === 'ok' && formas.length > 0 ? (
        <p className="fin-t-body text-[var(--fin-text-2)]">
          <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{ligadas.toLocaleString('pt-BR')}</span>{' '}
          {ligadas === 1 ? 'forma ligada' : 'formas ligadas'}
          {proprias > 0 ? <> · {proprias.toLocaleString('pt-BR')} {proprias === 1 ? 'criada pela agência' : 'criadas pela agência'}</> : null}
          . Desligar tira a forma das escolhas novas; o que já foi lançado com ela continua igual.
        </p>
      ) : null}

      <FinTable
        linhas={formas}
        colunas={colunas}
        chave={r => r.codigo}
        densidade="compacta"
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: carregar } : null}
        onLinhaClick={r => abrir(r)}
        vazio={{
          motivo: 'sem-dado',
          titulo: 'Nenhuma forma de pagamento',
          oQueE: 'As formas dizem como o dinheiro entra e sai: Pix, boleto, cartão, dinheiro.',
          acao: { rotulo: 'Nova forma', onClick: () => abrir(null) },
        }}
      />

      <RecordSheet
        aberto={aberta !== null}
        onOpenChange={a => { if (!a) setAberta(null); }}
        titulo={aberta?.forma ? aberta.forma.nome : 'Nova forma de pagamento'}
        descricao={ehSistema
          ? 'Forma de sempre: o nome não muda. Ajuste a conta, o prazo e a taxa, ou desligue se a agência não usa.'
          : 'O nome aparece nas contas a pagar e a receber, na liquidação e nos relatórios.'}
        sujo={JSON.stringify(form) !== JSON.stringify(inicial)}
        resumo={exemploTaxa
          ? `${exemploTaxa}. Ao liquidar, a conta e a taxa vêm sugeridas; dá para mudar na hora.`
          : 'Cai na hora e sem taxa. Ao liquidar, dá para mudar a conta na hora.'}
        acaoPrimaria={{
          rotulo: aberta?.forma ? 'Salvar forma' : 'Criar forma',
          onClick: salvar,
          carregando: salvando,
          desabilitado: !ehSistema && !form.nome.trim(),
        }}
      >
        <div className="grid grid-cols-1 gap-[var(--fin-s-4)] sm:grid-cols-2">
          {ehSistema ? null : (
            <>
              <Field rotulo="Nome" obrigatorio ajuda='Ex.: "Vale-viagem", "Link de pagamento".'>
                {a => (
                  <Input
                    id={a.id} aria-describedby={a['aria-describedby']} value={form.nome} maxLength={80}
                    onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} className={CONTROLE}
                  />
                )}
              </Field>
              <Field rotulo="Usada em">
                {a => (
                  <Opcoes
                    id={a.id} describedBy={a['aria-describedby']} rotulo="Usada em" valor={form.uso}
                    onChange={v => setForm(f => ({ ...f, uso: v as UsoDaForma }))}
                    opcoes={(Object.keys(ROTULO_DO_USO) as UsoDaForma[]).map(u => ({ valor: u, rotulo: ROTULO_DO_USO[u] }))}
                  />
                )}
              </Field>
            </>
          )}
          <div className="sm:col-span-2">
            <Field rotulo="Conta bancária padrão" ajuda="Opcional. A liquidação já abre com esta conta escolhida.">
              {a => (
                <Opcoes
                  id={a.id} describedBy={a['aria-describedby']} rotulo="Conta bancária padrão"
                  valor={form.conta_bancaria_id || NENHUMA}
                  onChange={v => setForm(f => ({ ...f, conta_bancaria_id: v === NENHUMA ? '' : v }))}
                  opcoes={opcoesConta}
                />
              )}
            </Field>
          </div>
          <Field rotulo="Dias para cair" ajuda="0 = cai na hora. Cartão costuma levar 30 dias.">
            {a => (
              <NumeroComUnidade
                id={a.id} describedBy={a['aria-describedby']} valor={form.dias_para_cair} unidade="dias" max={365} passo="1"
                onChange={v => setForm(f => ({ ...f, dias_para_cair: Math.max(0, Math.round(v)) }))}
              />
            )}
          </Field>
          <Field rotulo="Taxa em porcentagem" ajuda="Opcional. O que a operadora ou o banco desconta.">
            {a => (
              <NumeroComUnidade
                id={a.id} describedBy={a['aria-describedby']} valor={form.taxa_pct} unidade="%" max={99.99} passo="0.01"
                onChange={v => setForm(f => ({ ...f, taxa_pct: Math.max(0, v) }))}
              />
            )}
          </Field>
          <MoneyField
            rotulo="Taxa fixa por operação" ajuda="Opcional. Ex.: tarifa de cada boleto."
            valor={form.taxa_fixa} onChange={v => setForm(f => ({ ...f, taxa_fixa: Math.max(0, v) }))}
          />
          <Field rotulo="Situação" ajuda="Desligada sai das escolhas novas. O que já foi lançado continua igual.">
            {a => (
              <Opcoes
                id={a.id} describedBy={a['aria-describedby']} rotulo="Situação" valor={form.ativo ? 'LIGADA' : 'DESLIGADA'}
                onChange={v => setForm(f => ({ ...f, ativo: v !== 'DESLIGADA' }))}
                opcoes={[{ valor: 'LIGADA', rotulo: 'Ligada' }, { valor: 'DESLIGADA', rotulo: 'Desligada' }]}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field rotulo="Informações" ajuda="Opcional. Texto pronto, como os dados para depósito.">
              {a => (
                <Textarea
                  id={a.id} aria-describedby={a['aria-describedby']} value={form.informacoes} maxLength={500} rows={3}
                  onChange={e => setForm(f => ({ ...f, informacoes: e.target.value }))}
                  className={cn('fin-t-body min-h-[88px] rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)]', FOCO)}
                />
              )}
            </Field>
          </div>
          {aberta?.forma ? <div className="sm:col-span-2"><HistoricoRecolhivel entidade="formas_pagamento" id={aberta.forma.codigo} /></div> : null}
        </div>
      </RecordSheet>

      <ConfirmDialog
        aberto={excluir !== null}
        onOpenChange={a => { if (!a) setExcluir(null); }}
        titulo="Apagar esta forma de pagamento?"
        oQueVaiAcontecer="A forma sai do cadastro. Se ela já foi usada em alguma conta ou baixa, nada é apagado: o caminho é desligá-la."
        detalhes={excluir ? [{ rotulo: 'Forma', valor: excluir.nome }] : undefined}
        confirmarRotulo="Apagar forma"
        tone="destrutivo"
        processando={excluindo}
        onConfirmar={confirmarExclusao}
      />
    </MolduraDaPagina>
  );
}

'use client';

import * as React from 'react';
import { Building2, Pencil, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Field } from '@/components/fin/Field';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { esquecerEmpresas } from '@/components/fin/useEmpresas';
import { cnpjValido, formatarCnpj, soDigitos, type Empresa } from '@/lib/empresas';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * Configurações › Empresas (06/11/2026, E7 G2): os CNPJs e lojas da agência.
 *
 * A principal nasce sozinha dos dados da agência e guarda tudo o que existia
 * antes. Com uma empresa só, nenhuma outra tela muda. A partir da segunda,
 * aparecem o seletor nas listas e relatórios, a conta disponível por empresa,
 * o rateio entre empresas, o perfil de acesso por empresa e as configurações
 * e a nota fiscal de cada empresa.
 */

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0';
const CONTROLE = cn(
  'fin-t-body h-11 min-h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] lg:h-10 lg:min-h-10',
  FOCO,
);

type Form = { id?: string; nome: string; razao_social: string; cnpj: string; ativa: boolean; principal: boolean };
const VAZIO: Form = { nome: '', razao_social: '', cnpj: '', ativa: true, principal: false };

const O_QUE_APARECE = [
  'o seletor de empresas nas listas e relatórios (várias ao mesmo tempo, lembrado por pessoa);',
  'em cada conta bancária, a empresa dona e as outras em que ela pode ser usada;',
  'o rateio de uma despesa ou receita entre empresas, fechando 100%;',
  'nos perfis de acesso, as empresas que cada pessoa enxerga;',
  'as configurações de financeiro, cobrança, vendas e nota fiscal por empresa, com "Copiar de outra empresa".',
];

export default function EmpresasPage() {
  const [empresas, setEmpresas] = React.useState<Empresa[]>([]);
  const [podeEditar, setPodeEditar] = React.useState(false);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<Form | null>(null);
  const [sujo, setSujo] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [erros, setErros] = React.useState<{ nome?: string; cnpj?: string }>({});

  const ler = React.useCallback(async () => {
    try {
      const r = await fetch('/api/empresas?inativas=1', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível abrir as empresas.');
      setEmpresas(Array.isArray(j.empresas) ? j.empresas : []);
      setPodeEditar(j.pode_editar === true);
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir as empresas.');
      setEstado('erro');
    }
  }, []);
  React.useEffect(() => { void ler(); }, [ler]);
  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    await ler();
  }, [ler]);

  function abrir(e?: Empresa) {
    setForm(e ? { id: e.id, nome: e.nome, razao_social: e.razao_social, cnpj: formatarCnpj(e.cnpj), ativa: e.ativa, principal: e.principal } : { ...VAZIO });
    setErros({});
    setSujo(false);
  }

  function mudar(patch: Partial<Form>) {
    setForm(f => (f ? { ...f, ...patch } : f));
    setSujo(true);
  }

  async function salvar() {
    if (!form) return;
    const novosErros: typeof erros = {};
    if (!form.nome.trim()) novosErros.nome = 'Dê um nome à empresa.';
    if (soDigitos(form.cnpj) && !cnpjValido(form.cnpj)) novosErros.cnpj = 'O CNPJ não confere. Revise os números.';
    setErros(novosErros);
    if (Object.keys(novosErros).length) return;
    setSalvando(true);
    try {
      const r = await fetch('/api/empresas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: form.id, nome: form.nome, razao_social: form.razao_social, cnpj: soDigitos(form.cnpj), ativa: form.ativa }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = typeof j?.error === 'string' ? j.error : 'Não foi possível salvar.';
        if (/CNPJ/.test(msg)) setErros({ cnpj: msg });
        else if (/nome/i.test(msg)) setErros({ nome: msg });
        else toast.error(msg);
        return;
      }
      const eraUma = empresas.filter(e => e.ativa).length < 2;
      esquecerEmpresas();
      setForm(null);
      setSujo(false);
      toast.success(
        form.id ? 'Empresa atualizada.' : 'Empresa cadastrada.',
        !form.id && eraUma ? 'As listas e relatórios agora mostram o seletor de empresas.' : undefined,
      );
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  const ativas = empresas.filter(e => e.ativa).length;

  const colunas: FinColuna<Empresa>[] = [
    {
      id: 'nome', cabecalho: 'Empresa', tipo: 'texto', minWidth: 200, acessor: e => e.nome,
      render: e => (
        <span className="flex items-center gap-[var(--fin-s-2)]">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{e.nome}</span>
          {e.principal ? (
            <span className="fin-t-caption rounded-[var(--fin-r-sm)] bg-[var(--fin-accent-soft)] px-1.5 py-0.5 font-medium text-[var(--fin-accent)]">Principal</span>
          ) : null}
        </span>
      ),
    },
    { id: 'razao', cabecalho: 'Razão social', tipo: 'texto', minWidth: 200, prioridade: 2, render: e => e.razao_social || <span className="text-[var(--fin-text-3)]">—</span> },
    { id: 'cnpj', cabecalho: 'CNPJ', tipo: 'texto', minWidth: 160, render: e => (e.cnpj ? <span className="tabular-nums">{formatarCnpj(e.cnpj)}</span> : <span className="text-[var(--fin-text-3)]">Sem CNPJ</span>) },
    {
      id: 'situacao', cabecalho: 'Situação', tipo: 'texto', minWidth: 110,
      render: e => (
        <span className={cn('fin-t-body', e.ativa ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-text-3)]')}>{e.ativa ? 'Ativa' : 'Desativada'}</span>
      ),
    },
    ...(podeEditar ? [{
      id: 'acoes', cabecalho: '', tipo: 'acoes' as const,
      render: (e: Empresa) => (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Editar ${e.nome}`}
          onClick={ev => { ev.stopPropagation(); abrir(e); }}
          className={cn('size-11 rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] lg:size-10', FOCO)}
        >
          <Pencil aria-hidden="true" className="size-4" />
        </Button>
      ),
    }] : []),
  ];

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={Building2}
        titulo="Empresas"
        subtitulo="Os CNPJs e lojas da agência. Cada conta bancária, título, venda e nota pertence a uma delas."
        acaoPrimaria={podeEditar ? { rotulo: 'Nova empresa', icone: Plus, onClick: () => abrir() } : undefined}
        onRecarregar={carregar}
      />

      <FinTable
        linhas={empresas}
        colunas={colunas}
        chave={e => e.id}
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        vazio={{ motivo: 'sem-dado', titulo: 'Nenhuma empresa ainda', oQueE: 'A empresa principal aparece aqui assim que a agência tiver os dados preenchidos.' }}
        onLinhaClick={podeEditar ? e => abrir(e) : undefined}
      />

      {estado === 'ok' && ativas < 2 ? (
        <section
          aria-labelledby="t-segunda"
          className="flex max-w-3xl flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)]"
        >
          <h2 id="t-segunda" className="fin-t-subhead text-[var(--fin-text)]">Uma empresa só: nada muda nas telas</h2>
          <p className="fin-t-body text-[var(--fin-text-2)]">
            Tudo o que a agência já lançou está na empresa principal. Quando você cadastrar a segunda empresa, aparecem:
          </p>
          <ul className="fin-t-body flex list-disc flex-col gap-[var(--fin-s-1)] pl-5 text-[var(--fin-text-2)] marker:text-[var(--fin-text-3)]">
            {O_QUE_APARECE.map(t => <li key={t}>{t}</li>)}
          </ul>
        </section>
      ) : null}

      <RecordSheet
        aberto={form !== null}
        onOpenChange={aberto => { if (!aberto) setForm(null); }}
        titulo={form?.id ? 'Editar empresa' : 'Nova empresa'}
        descricao={form?.principal
          ? 'A empresa principal guarda os registros de antes. Muda o nome e o CNPJ; não se desativa.'
          : 'O nome aparece no seletor e nas listas. A nota fiscal desta empresa sai com a razão social e o CNPJ daqui.'}
        sujo={sujo}
        acaoPrimaria={{ rotulo: form?.id ? 'Salvar empresa' : 'Cadastrar empresa', onClick: salvar, carregando: salvando }}
      >
        {form ? (
          <div className="flex flex-col gap-[var(--fin-s-4)]">
            <Field rotulo="Nome" obrigatorio ajuda="Como a equipe chama esta empresa: Loja Centro, Matriz, Corporativo." erro={erros.nome}>
              {a => (
                <Input
                  id={a.id}
                  aria-invalid={a['aria-invalid'] || undefined}
                  aria-describedby={a['aria-describedby']}
                  value={form.nome}
                  maxLength={80}
                  onChange={e => mudar({ nome: e.target.value })}
                  placeholder="Loja Centro"
                  className={CONTROLE}
                />
              )}
            </Field>
            <Field rotulo="Razão social">
              {a => (
                <Input
                  id={a.id}
                  aria-describedby={a['aria-describedby']}
                  value={form.razao_social}
                  maxLength={160}
                  onChange={e => mudar({ razao_social: e.target.value })}
                  placeholder="Centro Viagens e Turismo LTDA"
                  className={CONTROLE}
                />
              )}
            </Field>
            <Field rotulo="CNPJ" ajuda="Dois cadastros não podem ter o mesmo CNPJ." erro={erros.cnpj}>
              {a => (
                <Input
                  id={a.id}
                  aria-invalid={a['aria-invalid'] || undefined}
                  aria-describedby={a['aria-describedby']}
                  value={form.cnpj}
                  inputMode="numeric"
                  onChange={e => mudar({ cnpj: e.target.value })}
                  onBlur={() => { if (soDigitos(form.cnpj).length === 14) setForm(f => (f ? { ...f, cnpj: formatarCnpj(f.cnpj) } : f)); }}
                  placeholder="00.000.000/0000-00"
                  className={cn(CONTROLE, 'tabular-nums')}
                />
              )}
            </Field>
            {form.id ? (
              <Field
                rotulo="Situação"
                ajuda={form.principal
                  ? 'A principal fica sempre ativa.'
                  : 'Desativada some do seletor e não recebe lançamentos novos. O que já foi lançado nela continua.'}
              >
                {a => (
                  <Select value={form.ativa ? 'ativa' : 'inativa'} onValueChange={v => mudar({ ativa: v === 'ativa' })} disabled={form.principal}>
                    <SelectTrigger id={a.id} aria-describedby={a['aria-describedby']} className={cn(CONTROLE, 'justify-between gap-2')}>
                      <SelectValue>{() => (form.ativa ? 'Ativa' : 'Desativada')}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativa" className="fin-t-body">Ativa</SelectItem>
                      <SelectItem value="inativa" className="fin-t-body">Desativada</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
            ) : null}
          </div>
        ) : null}
      </RecordSheet>
    </MolduraDaPagina>
  );
}

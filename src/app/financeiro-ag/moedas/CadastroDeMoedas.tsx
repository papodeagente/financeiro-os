'use client';

import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/fin/Field';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Segmentado } from '@/components/fin/Segmentado';
import { statusChipVariants } from '@/components/fin/StatusChip';
import { recarregarMoedas, useMoedas } from '@/components/fin/useMoedas';
import { formatarNaMoeda, type Moeda } from '@/lib/cambio';
import { CASAS_MAXIMAS, comoVemOCambio, normalizarCodigo, sugestaoDaMoeda } from '@/lib/moedas';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * Cadastro de moedas da agência (E7, frente D, 06/11/2026). As oito do
 * sistema ficam fixas; a agência acrescenta outras pelo código ISO 4217. O
 * nome, o símbolo e as casas vêm sugeridos do padrão internacional e podem
 * ser ajustados. Desativar tira a moeda das escolhas; o que já foi gravado
 * nela continua lido nela.
 */

const CARTAO = 'flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)]';
const TH = 'fin-t-overline px-[var(--fin-s-3)] py-[var(--fin-s-2)] text-left font-medium text-[var(--fin-text-3)]';
const TD = 'px-[var(--fin-s-3)] py-[var(--fin-s-2)] align-middle';
const CONTROLE = 'fin-t-body h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)] lg:h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0';

type Formulario = { codigo: string; nome: string; simbolo: string; casas: number; ativo: boolean };
const VAZIO: Formulario = { codigo: '', nome: '', simbolo: '', casas: 2, ativo: true };

export function CadastroDeMoedas() {
  const { moedas, carregado } = useMoedas();
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<Formulario>(VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [notaIso, setNotaIso] = useState<string | null>(null);

  const daAgencia = moedas.filter(m => m.da_agencia);

  function abrirNova() {
    setEditando(null);
    setForm(VAZIO);
    setErro(null);
    setNotaIso(null);
    setAberto(true);
  }

  function abrirEdicao(m: Moeda) {
    setEditando(m.codigo);
    setForm({ codigo: m.codigo, nome: m.nome, simbolo: m.simbolo, casas: m.casas, ativo: m.ativo !== false });
    setErro(null);
    setNotaIso(null);
    setAberto(true);
  }

  // Ao sair do código, preenche o que estiver vazio com o padrão internacional.
  function sugerir(codigo: string) {
    const c = normalizarCodigo(codigo);
    if (c.length !== 3) return;
    const s = sugestaoDaMoeda(c);
    if (!s) { setErro(`${c} não é um código de moeda do padrão ISO 4217.`); return; }
    setErro(null);
    setForm(f => ({ ...f, codigo: c, nome: f.nome || s.nome, simbolo: f.simbolo || s.simbolo, casas: s.casas }));
    setNotaIso(s.casas_iso > CASAS_MAXIMAS
      ? `O padrão desta moeda usa ${s.casas_iso} casas; o Financeiro guarda até ${CASAS_MAXIMAS}.`
      : null);
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(editando ? `/api/moedas/${editando}` : '/api/moedas', {
        method: editando ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) { setErro(corpo.error ?? 'Não foi possível salvar a moeda.'); return; }
      await recarregarMoedas().catch(() => undefined);
      toast.success(editando ? 'Moeda atualizada.' : `${form.codigo} cadastrada.`, editando ? undefined : 'Ela já aparece nas contas bancárias e nos lançamentos.');
      setAberto(false);
    } catch {
      setErro('Sem conexão com o servidor. Nada foi salvo.');
    } finally {
      setSalvando(false);
    }
  }

  const exemplo = form.codigo.length === 3 && !erro
    ? (() => { try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: form.codigo, minimumFractionDigits: form.casas, maximumFractionDigits: form.casas }).format(1234.5); } catch { return null; } })()
    : null;

  return (
    <section aria-labelledby="titulo-cadastro-moedas" className={CARTAO}>
      <div className="flex flex-col gap-[var(--fin-s-3)] sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="titulo-cadastro-moedas" className="fin-t-subhead text-[var(--fin-text)]">Moedas da agência</h2>
          <p className="fin-t-caption max-w-[72ch] text-[var(--fin-text-3)]">
            As oito primeiras vêm prontas. Acrescente as que a agência usa (peso argentino, peso chileno...): elas passam a valer
            nas contas bancárias, nas contas a pagar e a receber e na liquidação. Cotação ao vivo só existe para as que o Banco
            Central publica; nas outras, o câmbio é digitado em cada lançamento.
          </p>
        </div>
        <Button variant="outline" onClick={abrirNova} className="self-start">
          <Plus aria-hidden="true" data-icon="inline-start" />
          Acrescentar moeda
        </Button>
      </div>

      <div className="-mx-[var(--fin-s-4)] overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="border-b border-[var(--fin-border)]">
              <th scope="col" className={cn(TH, 'pl-[var(--fin-s-4)]')}>Moeda</th>
              <th scope="col" className={TH}>Exemplo</th>
              <th scope="col" className={TH}>Câmbio</th>
              <th scope="col" className={TH}>Origem</th>
              <th scope="col" className={cn(TH, 'pr-[var(--fin-s-4)] text-right')}><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {moedas.map(m => (
              <tr key={m.codigo} className="border-b border-[var(--fin-border)] last:border-b-0">
                <td className={cn(TD, 'pl-[var(--fin-s-4)]')}>
                  <span className="flex flex-col">
                    <span className="fin-t-body-strong text-[var(--fin-text)]">{m.codigo} <span className="font-normal text-[var(--fin-text-2)]">· {m.nome}</span></span>
                    <span className="fin-t-caption text-[var(--fin-text-3)]">{m.casas === 1 ? '1 casa decimal' : `${m.casas} casas decimais`}</span>
                  </span>
                </td>
                <td className={cn(TD, 'fin-t-body tabular-nums text-[var(--fin-text-2)]')}>{formatarNaMoeda(1234.5, m.codigo, moedas)}</td>
                <td className={cn(TD, 'fin-t-body text-[var(--fin-text-2)]')}>{comoVemOCambio(m)}</td>
                <td className={TD}>
                  {m.da_agencia
                    ? <span className={statusChipVariants({ tone: m.ativo === false ? 'neutro' : 'info' })}>{m.ativo === false ? 'Desativada' : 'Da agência'}</span>
                    : <span className={statusChipVariants({ tone: 'neutro' })}>Do sistema</span>}
                </td>
                <td className={cn(TD, 'pr-[var(--fin-s-4)] text-right')}>
                  {m.da_agencia ? (
                    <Button variant="ghost" size="sm" onClick={() => abrirEdicao(m)} aria-label={`Editar ${m.codigo}`}>
                      <Pencil aria-hidden="true" data-icon="inline-start" />
                      Editar
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {carregado && daAgencia.length === 0 ? (
        <p className="fin-t-caption text-[var(--fin-text-3)]">Nenhuma moeda acrescentada ainda.</p>
      ) : null}

      <RecordSheet
        aberto={aberto}
        onOpenChange={setAberto}
        titulo={editando ? `Editar ${editando}` : 'Acrescentar moeda'}
        descricao={editando ? 'O código não muda. Nome, símbolo e casas valem para a tela e para os arquivos.' : 'Digite o código de três letras: o nome, o símbolo e as casas vêm sugeridos.'}
        largura={480}
        sujo={!editando && form.codigo !== ''}
        acaoPrimaria={{ rotulo: editando ? 'Salvar' : 'Cadastrar moeda', onClick: salvar, carregando: salvando, desabilitado: form.codigo.length !== 3 }}
        resumo={exemplo ? <span className="fin-t-caption text-[var(--fin-text-3)]">Um valor nela aparece assim: <strong className="tabular-nums text-[var(--fin-text)]">{exemplo}</strong></span> : undefined}
      >
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          <Field rotulo="Código ISO 4217" obrigatorio erro={erro} ajuda={editando ? undefined : 'Três letras, como ARS, CLP ou MXN.'}>
            {a => (
              <Input
                {...a}
                value={form.codigo}
                disabled={!!editando}
                maxLength={3}
                autoComplete="off"
                spellCheck={false}
                className={cn(CONTROLE, 'uppercase tracking-wide')}
                onChange={e => { setErro(null); setForm(f => ({ ...f, codigo: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })); }}
                onBlur={e => { if (!editando) sugerir(e.target.value); }}
              />
            )}
          </Field>
          <div className="grid grid-cols-1 gap-[var(--fin-s-4)] sm:grid-cols-[2fr_1fr]">
            <Field rotulo="Nome">
              {a => <Input {...a} value={form.nome} maxLength={60} className={CONTROLE} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />}
            </Field>
            <Field rotulo="Símbolo">
              {a => <Input {...a} value={form.simbolo} maxLength={8} className={CONTROLE} onChange={e => setForm(f => ({ ...f, simbolo: e.target.value }))} />}
            </Field>
          </div>
          <div className="flex flex-col gap-[var(--fin-s-2)]">
            <span className="fin-t-body-strong text-[var(--fin-text)]">Casas decimais</span>
            <Segmentado
              rotulo="Casas decimais"
              opcoes={Array.from({ length: CASAS_MAXIMAS + 1 }, (_, i) => ({ valor: String(i), rotulo: String(i) }))}
              valor={String(form.casas)}
              onChange={v => setForm(f => ({ ...f, casas: Number(v) }))}
            />
            {notaIso ? <p className="fin-t-caption text-[var(--fin-warning-text)]">{notaIso}</p> : null}
          </div>
          {editando ? (
            <div className="flex flex-col gap-[var(--fin-s-2)]">
              <span className="fin-t-body-strong text-[var(--fin-text)]">Situação</span>
              <Segmentado
                rotulo="Situação da moeda"
                opcoes={[{ valor: 'ativa', rotulo: 'Ativa' }, { valor: 'desativada', rotulo: 'Desativada' }]}
                valor={form.ativo ? 'ativa' : 'desativada'}
                onChange={v => setForm(f => ({ ...f, ativo: v === 'ativa' }))}
              />
              <p className="fin-t-caption text-[var(--fin-text-3)]">Desativada some das escolhas. Contas e lançamentos que já estão nela continuam nela.</p>
            </div>
          ) : null}
        </div>
      </RecordSheet>
    </section>
  );
}

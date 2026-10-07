'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/fin/Field';
import { SeletorDePlataforma } from '@/app/financeiro-ag/receber/SeletorDePlataforma';
import { toast } from '@/lib/toast';
import {
  formatarPercentual,
  lerPercentual,
  mensagemDoPercentualInvalido,
  normalizarPlataforma,
  validarPercentualPadrao,
  type DescontoPadrao,
} from '@/lib/taxa-plataforma';

const CARTAO =
  'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';

async function chamar(metodo: 'GET' | 'PUT' | 'DELETE', corpo?: unknown, plataforma?: string) {
  const url = plataforma
    ? `/api/plataformas/descontos?plataforma=${encodeURIComponent(plataforma)}`
    : '/api/plataformas/descontos';
  const res = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = (await res.json().catch(() => ({}))) as { padroes?: DescontoPadrao[]; error?: string };
  if (!res.ok) throw new Error(dados.error || `Erro ${res.status}`);
  return Array.isArray(dados.padroes) ? dados.padroes : [];
}

/**
 * Desconto padrão de cada plataforma de pagamento.
 *
 * Com um padrão cadastrado, a baixa de uma conta dessa plataforma já chega
 * com o valor que cai no banco calculado. Também dá para guardar o padrão
 * direto da baixa, marcando a caixa embaixo do cálculo.
 */
export function DescontosPadrao() {
  const [padroes, setPadroes] = useState<DescontoPadrao[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [plataforma, setPlataforma] = useState('');
  const [texto, setTexto] = useState('');
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [removendo, setRemovendo] = useState('');

  const carregar = useCallback(async () => {
    try {
      setPadroes(await chamar('GET'));
    } catch {
      // A seção é auxiliar: falhar aqui não derruba a tela das integrações.
      setPadroes([]);
    } finally {
      setCarregado(true);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const pct = lerPercentual(texto);
  const motivo = validarPercentualPadrao(pct);
  const erroPlataforma = tentou && !plataforma.trim() ? 'Escolha a plataforma.' : null;
  const erroPercentual = tentou && motivo ? mensagemDoPercentualInvalido(motivo) : null;
  const existente = padroes.find(p => p.plataforma === normalizarPlataforma(plataforma));

  async function salvar() {
    setTentou(true);
    if (!plataforma.trim() || motivo || pct === null) return;
    setSalvando(true);
    try {
      setPadroes(await chamar('PUT', { plataforma, percentual: pct }));
      toast.success(existente ? 'Desconto padrão atualizado.' : 'Desconto padrão guardado.');
      setPlataforma('');
      setTexto('');
      setTentou(false);
    } catch (e) {
      toast.error('Não foi possível guardar o desconto padrão.', e instanceof Error ? e.message : '');
    } finally {
      setSalvando(false);
    }
  }

  async function remover(nome: string) {
    setRemovendo(nome);
    try {
      setPadroes(await chamar('DELETE', undefined, nome));
      toast.success(`Desconto padrão de ${nome} removido.`);
    } catch (e) {
      toast.error('Não foi possível remover o desconto padrão.', e instanceof Error ? e.message : '');
    } finally {
      setRemovendo('');
    }
  }

  function editar(p: DescontoPadrao) {
    setPlataforma(p.plataforma);
    setTexto(String(p.percentual).replace('.', ','));
    setTentou(false);
  }

  return (
    <section id="descontos" className={`${CARTAO} overflow-hidden`}>
      <header className="border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
        <h2 className="fin-t-subhead text-[var(--fin-text)]">Desconto padrão por plataforma</h2>
        <p className="fin-t-caption text-[var(--fin-text-3)]">
          Ao registrar um recebimento, o valor que cai no banco já vem calculado com este percentual.
          Dá para corrigir antes de confirmar.
        </p>
      </header>

      {carregado && padroes.length > 0 ? (
        <ul className="divide-y divide-[var(--fin-border)]">
          {padroes.map(p => (
            <li
              key={p.plataforma}
              className="flex items-center gap-[var(--fin-s-3)] px-[var(--fin-s-4)] py-[var(--fin-s-2)]"
            >
              <span className="min-w-0 flex-1 truncate fin-t-body text-[var(--fin-text)]">{p.plataforma}</span>
              <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">
                {formatarPercentual(p.percentual)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Editar o desconto de ${p.plataforma}`}
                onClick={() => editar(p)}
              >
                <Pencil aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover o desconto de ${p.plataforma}`}
                disabled={removendo === p.plataforma}
                onClick={() => remover(p.plataforma)}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {carregado && padroes.length === 0 ? (
        <p className="px-[var(--fin-s-4)] pt-[var(--fin-s-3)] fin-t-body text-[var(--fin-text-2)]">
          Nenhum padrão ainda. Exemplo: Hotmart, 9,9%.
        </p>
      ) : null}

      <form
        className="grid grid-cols-1 items-start gap-[var(--fin-s-3)] px-[var(--fin-s-4)] py-[var(--fin-s-3)] sm:grid-cols-[minmax(0,1fr)_9rem_auto]"
        onSubmit={e => { e.preventDefault(); salvar(); }}
      >
        <Field rotulo="Plataforma" erro={erroPlataforma}>
          {a => (
            <SeletorDePlataforma
              id={a.id}
              valor={plataforma}
              usadas={padroes.map(p => p.plataforma)}
              rotuloVazio="Escolha a plataforma"
              onChange={setPlataforma}
            />
          )}
        </Field>
        <Field rotulo="Desconto" erro={erroPercentual}>
          {a => (
            <div className="relative">
              <Input
                {...a}
                inputMode="decimal"
                autoComplete="off"
                placeholder="9,9"
                value={texto}
                onChange={e => setTexto(e.target.value)}
                className="h-11 pr-8 text-right tabular-nums lg:h-10"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-3 flex items-center fin-t-body text-[var(--fin-text-3)]"
              >
                %
              </span>
            </div>
          )}
        </Field>
        {/* O rótulo invisível alinha o botão com os campos no desktop. */}
        <div className="flex flex-col gap-1">
          <span aria-hidden className="hidden fin-t-body-strong sm:block">&nbsp;</span>
          <Button type="submit" disabled={salvando} className="h-11 lg:h-10">
            {existente ? 'Atualizar' : 'Guardar'}
          </Button>
        </div>
      </form>
    </section>
  );
}

export default DescontosPadrao;

'use client';

/**
 * Juntar categorias (05/11/2026): escolhe a categoria que recebe, vê a
 * prévia do que muda e só então confirma. O servidor recusa o que
 * estragaria dados (mesma categoria, tipos diferentes, grupo com filhas) e
 * só aceita administrador.
 */
import * as React from 'react';

import type { PlanoContas } from '@/lib/crm-types';
import { Field } from '@/components/fin/Field';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type Previa = {
  origem: { nome: string; codigo: string };
  destino: { nome: string; codigo: string };
  contagens: Array<{ tabela: string; rotulo: string; registros: number }>;
  regras: number;
  total: number;
};

const NENHUM = '__NENHUM__';
const CONTROLE =
  'fin-t-body h-11 min-h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] lg:h-10 lg:min-h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0';

const nomeDe = (c: { codigo?: string; nome: string }) => `${c.codigo ? `${c.codigo} ` : ''}${c.nome}`.trim();

async function pedir(corpo: Record<string, string>) {
  const res = await fetch('/api/plano-contas/juntar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'O servidor não respondeu.');
  return json as Previa;
}

export function JuntarCategorias({
  origem,
  categorias,
  onFechar,
  onJuntada,
}: {
  origem: PlanoContas | null;
  categorias: PlanoContas[];
  onFechar: () => void;
  onJuntada: (texto: string) => void;
}) {
  const [destinoId, setDestinoId] = React.useState('');
  const [previa, setPrevia] = React.useState<Previa | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(false);
  const [gravando, setGravando] = React.useState(false);

  React.useEffect(() => { setDestinoId(''); setPrevia(null); setErro(null); }, [origem?.id]);

  const opcoes = React.useMemo(
    () => (origem
      ? categorias
        .filter(c => c.id !== origem.id && c.tipo === origem.tipo)
        .sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }))
      : []),
    [categorias, origem],
  );

  async function escolher(id: string) {
    setDestinoId(id);
    setPrevia(null);
    setErro(null);
    if (!origem || !id) return;
    setCarregando(true);
    try {
      setPrevia(await pedir({ origem_id: origem.id, destino_id: id, modo: 'previa' }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A prévia falhou.');
    } finally {
      setCarregando(false);
    }
  }

  async function confirmar() {
    if (!origem || !destinoId || !previa) return;
    setGravando(true);
    setErro(null);
    try {
      const feito = await pedir({ origem_id: origem.id, destino_id: destinoId, modo: 'gravar' });
      onJuntada(`${feito.total} ${feito.total === 1 ? 'registro foi movido' : 'registros foram movidos'} para ${nomeDe(feito.destino)}.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A junção falhou. Nada foi alterado.');
    } finally {
      setGravando(false);
    }
  }

  const destino = opcoes.find(c => c.id === destinoId);

  return (
    <RecordSheet
      aberto={origem !== null}
      onOpenChange={aberto => { if (!aberto) onFechar(); }}
      titulo="Juntar categorias"
      descricao="Leva tudo de uma categoria para outra e apaga a primeira. Só administradores."
      largura={480}
      resumo={
        origem && destino
          ? `"${nomeDe(destino)}" fica com tudo o que era de "${nomeDe(origem)}", e "${nomeDe(origem)}" sai do plano de contas.`
          : 'Escolha a categoria que vai receber os registros para ver o que muda.'
      }
      acaoPrimaria={{
        rotulo: 'Juntar categorias',
        onClick: confirmar,
        carregando: gravando,
        desabilitado: !previa || carregando,
      }}
    >
      {origem ? (
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          <div className="flex flex-col gap-[var(--fin-s-1)]">
            <span className="fin-t-caption text-[var(--fin-text-3)]">Sai do plano de contas</span>
            <span className="fin-t-body-strong text-[var(--fin-text)]">{nomeDe(origem)}</span>
          </div>

          <Field rotulo="Recebe os registros" obrigatorio ajuda="Só aparecem categorias do mesmo tipo.">
            {a => (
              <Select value={destinoId || NENHUM} onValueChange={v => { void escolher(String(v) === NENHUM ? '' : String(v)); }}>
                <SelectTrigger id={a.id} aria-label="Recebe os registros" aria-describedby={a['aria-describedby']} className={cn(CONTROLE, 'justify-between gap-2')}>
                  <SelectValue>{() => (destino ? nomeDe(destino) : 'Escolha uma categoria')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NENHUM} disabled className="fin-t-body">Escolha uma categoria</SelectItem>
                  {opcoes.map(c => <SelectItem key={c.id} value={c.id} className="fin-t-body">{nomeDe(c)}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </Field>

          <div role="status" aria-live="polite">
            {carregando ? (
              <p className="fin-t-caption text-[var(--fin-text-3)]">Contando os registros…</p>
            ) : erro ? (
              <p className="fin-t-body rounded-[var(--fin-r-md)] border border-[var(--fin-negative)] bg-[var(--fin-negative-soft)] p-[var(--fin-s-3)] text-[var(--fin-negative-text)]">
                {erro}
              </p>
            ) : previa ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-[var(--fin-s-4)] gap-y-[var(--fin-s-1)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-3)]">
                {previa.contagens.map(c => (
                  <React.Fragment key={c.tabela}>
                    <dt className="fin-t-body text-[var(--fin-text-2)]">{c.rotulo}</dt>
                    <dd className="fin-t-body tabular-nums text-right text-[var(--fin-text)]">{c.registros.toLocaleString('pt-BR')}</dd>
                  </React.Fragment>
                ))}
                <dt className="fin-t-body text-[var(--fin-text-2)]">Regras de rateio</dt>
                <dd className="fin-t-body tabular-nums text-right text-[var(--fin-text)]">{previa.regras.toLocaleString('pt-BR')}</dd>
                <dt className="fin-t-body-strong border-t border-[var(--fin-border)] pt-[var(--fin-s-1)] text-[var(--fin-text)]">Registros que mudam</dt>
                <dd className="fin-t-body-strong border-t border-[var(--fin-border)] pt-[var(--fin-s-1)] tabular-nums text-right text-[var(--fin-text)]">{previa.total.toLocaleString('pt-BR')}</dd>
              </dl>
            ) : null}
          </div>
        </div>
      ) : null}
    </RecordSheet>
  );
}

export default JuntarCategorias;

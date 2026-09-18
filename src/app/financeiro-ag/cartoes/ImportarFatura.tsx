'use client';

import * as React from 'react';
import { FileUp, Loader2, Sparkles } from 'lucide-react';
import type { CartaoCorporativo } from '@/lib/crm-types';
import type { ItemConciliado, ResumoImportacao } from '@/lib/cartao-lancamentos';
import { Money } from '@/components/fin/Money';
import { toast } from '@/lib/toast';

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]';
const BOTAO =
  'inline-flex h-9 items-center gap-1.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] ' +
  'bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] ' +
  'disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';
const BOTAO_PRIMARIO =
  'inline-flex h-9 items-center gap-1.5 rounded-[var(--fin-r-md)] bg-[var(--fin-accent)] px-3 ' +
  'fin-t-body-strong text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] disabled:opacity-50 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

const ROTULO_SITUACAO: Record<ItemConciliado['situacao'], string> = {
  NOVO: 'Nova',
  PARCELA_CONHECIDA: 'Próxima parcela',
  JA_LANCADO: 'Já lançada',
};

const COR_SITUACAO: Record<ItemConciliado['situacao'], string> = {
  NOVO: 'text-[var(--fin-accent)]',
  PARCELA_CONHECIDA: 'text-[var(--fin-positive)]',
  JA_LANCADO: 'text-[var(--fin-text-3)]',
};

export type ImportarFaturaProps = {
  cartoes: CartaoCorporativo[];
  cartaoId: string;
  onCartaoId: (id: string) => void;
  onLancado: () => void;
};

/**
 * Importa a fatura em PDF.
 *
 * O fluxo é em dois tempos de propósito: a IA lê e MOSTRA, a pessoa
 * confere e confirma. Gravar dívida direto da saída de um modelo é o tipo
 * de automação que ninguém consegue auditar depois, e o erro só aparece
 * quando o dinheiro já saiu.
 */
export function ImportarFatura({ cartoes, cartaoId, onCartaoId, onLancado }: ImportarFaturaProps) {
  const [lendo, setLendo] = React.useState(false);
  const [lancando, setLancando] = React.useState(false);
  const [itens, setItens] = React.useState<ItemConciliado[] | null>(null);
  const [resumo, setResumo] = React.useState<ResumoImportacao | null>(null);
  const [ignorados, setIgnorados] = React.useState<Set<string>>(new Set());
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function ler(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    // Limpa já: escolher o MESMO arquivo depois de um erro não dispararia
    // evento nenhum e pareceria travado.
    e.target.value = '';
    if (!arquivo) return;
    if (!cartaoId) { toast.error('Escolha o cartão antes de enviar a fatura'); return; }

    setLendo(true);
    setItens(null);
    try {
      const form = new FormData();
      form.append('file', arquivo);
      form.append('cartao_id', cartaoId);
      const r = await fetch('/api/cartoes/fatura-pdf', { method: 'POST', body: form });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || 'Não foi possível ler a fatura');
      setItens(json.itens ?? []);
      setResumo(json.resumo ?? null);
      setIgnorados(new Set());
      if ((json.itens ?? []).length === 0) {
        toast.error('Nenhuma compra reconhecida', 'Confira se o PDF é a fatura e não o comprovante de pagamento.');
      }
    } catch (err) {
      toast.error('A leitura falhou', err instanceof Error ? err.message : '');
    } finally {
      setLendo(false);
    }
  }

  const aLancar = (itens ?? []).filter(
    i => i.situacao !== 'JA_LANCADO' && !ignorados.has(i.parcela_id),
  );

  async function lancar() {
    if (aLancar.length === 0) return;
    setLancando(true);
    try {
      // A fatura mostra a PARCELA; o lançamento pede a COMPRA. A conversão
      // acontece aqui para o servidor receber sempre a mesma forma, venha
      // da importação ou do lançamento manual.
      const compras = aLancar.map(i => ({
        cartao_id: cartaoId,
        descricao: i.descricao,
        valor_total: Math.round(i.valor * i.total_parcelas * 100) / 100,
        data_compra: i.data,
        parcelas: i.total_parcelas,
        observacoes: `Importado da fatura em PDF.`,
      }));
      const r = await fetch('/api/cartoes/lancamentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compras }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || 'Não foi possível lançar');
      toast.success(
        `${json.criadas} ${json.criadas === 1 ? 'parcela lançada' : 'parcelas lançadas'}`,
        json.jaExistiam > 0 ? `${json.jaExistiam} já existiam e foram mantidas.` : '',
      );
      setItens(null);
      onLancado();
    } catch (err) {
      toast.error('Não foi possível lançar', err instanceof Error ? err.message : '');
    } finally {
      setLancando(false);
    }
  }

  return (
    <section className={`${CARTAO} overflow-hidden`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
        <div>
          <h2 className="flex items-center gap-2 fin-t-subhead text-[var(--fin-text)]">
            <Sparkles className="h-4 w-4 text-[var(--fin-accent)]" aria-hidden />
            Importar fatura em PDF
          </h2>
          <p className="fin-t-caption text-[var(--fin-text-3)]">
            A IA lê a fatura e mostra o que encontrou. Nada é lançado antes de você confirmar
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)]"
            value={cartaoId}
            onChange={e => onCartaoId(e.target.value)}
            aria-label="Cartão da fatura"
          >
            <option value="">Escolha o cartão</option>
            {cartoes.map(c => (
              <option key={c.id} value={c.id}>
                {c.apelido}{c.ultimos_digitos ? ` (final ${c.ultimos_digitos})` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={BOTAO}
            disabled={lendo || !cartaoId}
            onClick={() => inputRef.current?.click()}
          >
            {lendo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileUp className="h-4 w-4" aria-hidden />}
            {lendo ? 'Lendo a fatura...' : 'Enviar PDF'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={ler}
            tabIndex={-1}
            aria-hidden
          />
        </div>
      </header>

      {itens && itens.length > 0 && (
        <>
          {resumo && (
            <div className="flex flex-wrap items-center gap-x-[var(--fin-s-5)] gap-y-1 border-b border-[var(--fin-border)] bg-[var(--fin-surface-2)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
              <span className="fin-t-body text-[var(--fin-text)]">
                <strong>{resumo.novos}</strong> nova{resumo.novos === 1 ? '' : 's'}
              </span>
              <span className="fin-t-body text-[var(--fin-positive)]">
                <strong>{resumo.parcelas_conhecidas}</strong> próxima{resumo.parcelas_conhecidas === 1 ? '' : 's'} parcela{resumo.parcelas_conhecidas === 1 ? '' : 's'}
              </span>
              <span className="fin-t-body text-[var(--fin-text-3)]">
                <strong>{resumo.ja_lancados}</strong> já lançada{resumo.ja_lancados === 1 ? '' : 's'}, que não entram de novo
              </span>
              <span className="ml-auto fin-t-body text-[var(--fin-text-2)]">
                A lançar: <Money valor={aLancar.reduce((t, i) => t + i.valor, 0)} size="strong" />
              </span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--fin-border)] text-left">
                  <th scope="col" className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] fin-t-overline text-[var(--fin-text-3)]">Lançar</th>
                  <th scope="col" className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] fin-t-overline text-[var(--fin-text-3)]">Compra</th>
                  <th scope="col" className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] fin-t-overline text-[var(--fin-text-3)]">Situação</th>
                  <th scope="col" className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-right fin-t-overline text-[var(--fin-text-3)]">Parcela</th>
                </tr>
              </thead>
              <tbody>
                {itens.map(i => {
                  const bloqueado = i.situacao === 'JA_LANCADO';
                  const marcado = !bloqueado && !ignorados.has(i.parcela_id);
                  return (
                    <tr key={i.parcela_id} className="border-b border-[var(--fin-border)] last:border-0">
                      <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--fin-accent)]"
                          checked={marcado}
                          disabled={bloqueado}
                          aria-label={`Lançar ${i.descricao}`}
                          onChange={e => setIgnorados(s => {
                            const novo = new Set(s);
                            if (e.target.checked) novo.delete(i.parcela_id); else novo.add(i.parcela_id);
                            return novo;
                          })}
                        />
                      </td>
                      <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                        <p className="fin-t-body text-[var(--fin-text)]">{i.descricao}</p>
                        <p className="fin-t-caption text-[var(--fin-text-3)]">
                          {i.data.split('-').reverse().join('/')}
                          {i.total_parcelas > 1 ? ` · parcela ${i.parcela_numero} de ${i.total_parcelas}` : ' · à vista'}
                        </p>
                      </td>
                      <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                        <p className={`fin-t-body-strong ${COR_SITUACAO[i.situacao]}`}>
                          {ROTULO_SITUACAO[i.situacao]}
                        </p>
                        <p className="fin-t-caption text-[var(--fin-text-3)]">{i.motivo}</p>
                      </td>
                      <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)] text-right">
                        <Money valor={i.valor} size="body" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              Confira os valores antes de lançar. A IA pode errar leitura de tabela, e o que entra
              aqui vira dívida.
            </p>
            <div className="flex gap-2">
              <button type="button" className={BOTAO} onClick={() => setItens(null)} disabled={lancando}>
                Descartar
              </button>
              <button
                type="button"
                className={BOTAO_PRIMARIO}
                onClick={lancar}
                disabled={lancando || aLancar.length === 0}
              >
                {lancando ? 'Lançando...' : `Lançar ${aLancar.length} ${aLancar.length === 1 ? 'compra' : 'compras'}`}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default ImportarFatura;

'use client';

import * as React from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/fin/Field';
import { lerPlanilha, ErroDeLeitura } from '@/lib/migracao/leitor';
import { lerCentavos, texto, type Celula } from '@/lib/migracao/valores';
import type { RelatorioDaConferencia } from '@/lib/fatura-regras';
import type { ItemDaFatura } from '@/lib/fatura-servidor';
import { reais } from './comum';
import { Aviso, CONTROLE, SECAO, TituloDaSecao } from './pecas';
import { cn } from '@/lib/utils';

/**
 * Conferir a fatura com a planilha do cliente (E5, parte B). O arquivo é lido
 * aqui no navegador (CSV, XLSX, XLS, ODS); a pessoa diz qual coluna traz a
 * referência (localizador, nº da venda ou passageiro) e qual traz o valor, e
 * só as linhas vão ao servidor. O relatório mostra o que bateu, o que tem
 * valor diferente, o que falta no arquivo e o que sobra nele.
 */

interface Planilha { nome: string; cabecalho: string[]; linhas: Celula[][] }

const NENHUMA = '__nenhuma__';

export function ConferenciaPorArquivo({ itens, desabilitado, motivoDesabilitado, onConferir }: {
  itens: ItemDaFatura[];
  desabilitado: boolean;
  motivoDesabilitado?: string;
  onConferir: (linhas: Array<{ referencia: string; valor_centavos: number | null }>, arquivo: string) => Promise<RelatorioDaConferencia | null>;
}) {
  const entrada = React.useRef<HTMLInputElement>(null);
  const [planilha, setPlanilha] = React.useState<Planilha | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [colRef, setColRef] = React.useState('0');
  const [colValor, setColValor] = React.useState(NENHUMA);
  const [enviando, setEnviando] = React.useState(false);
  const [relatorio, setRelatorio] = React.useState<RelatorioDaConferencia | null>(null);

  async function escolher(arquivo: File | undefined) {
    setErro(null);
    setRelatorio(null);
    if (!arquivo) return;
    try {
      const lida = lerPlanilha(arquivo.name, new Uint8Array(await arquivo.arrayBuffer()));
      const aba = lida.abas.find(a => a.linhas.some(l => l.some(c => c !== null && c !== ''))) ?? lida.abas[0];
      const cheias = (aba?.linhas ?? []).filter(l => l.some(c => c !== null && c !== ''));
      if (cheias.length < 2) throw new ErroDeLeitura('A planilha precisa de uma linha de títulos e ao menos uma linha de dados.');
      const cabecalho = cheias[0].map((c, i) => texto(c) || `Coluna ${i + 1}`);
      setPlanilha({ nome: arquivo.name, cabecalho, linhas: cheias.slice(1) });
      // Palpite: a coluna de referência é a que fala de localizador, venda ou passageiro; a de valor, a que fala de valor.
      const norm = cabecalho.map(c => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
      const ref = norm.findIndex(c => /localiz|reserva|venda|bilhete|passageir|documento/.test(c));
      const val = norm.findIndex(c => /valor|total|montante/.test(c));
      setColRef(String(ref >= 0 ? ref : 0));
      setColValor(val >= 0 ? String(val) : NENHUMA);
    } catch (e) {
      setPlanilha(null);
      setErro(e instanceof ErroDeLeitura ? e.message : 'Não consegui ler este arquivo. Salve de novo em Excel (.xlsx) ou Texto (.csv).');
    } finally {
      if (entrada.current) entrada.current.value = '';
    }
  }

  async function conferir() {
    if (!planilha) return;
    const r = Number(colRef);
    const v = colValor === NENHUMA ? -1 : Number(colValor);
    const linhas = planilha.linhas
      .map(l => ({ referencia: texto(l[r]), valor_centavos: v >= 0 ? lerCentavos(l[v]) : null }))
      .filter(l => l.referencia);
    if (!linhas.length) { setErro('A coluna escolhida como referência está vazia.'); return; }
    setEnviando(true);
    try {
      setRelatorio(await onConferir(linhas, planilha.nome));
    } finally {
      setEnviando(false);
    }
  }

  const porConta = new Map(itens.map(i => [i.conta_id, i]));
  const opcoes = planilha?.cabecalho.map((c, i) => ({ valor: String(i), rotulo: c })) ?? [];

  return (
    <section className={SECAO} aria-labelledby="conferir-arquivo">
      <TituloDaSecao
        id="conferir-arquivo"
        titulo="Conferir com o arquivo do cliente"
        descricao="Quando o cliente manda a planilha dele (relatório de viagens, extrato do sistema da empresa), confira aqui: cada linha procura o item pelo localizador, pelo número da venda ou pelo passageiro."
        acao={(
          <>
            <input ref={entrada} type="file" accept=".csv,.txt,.xlsx,.xls,.ods" className="sr-only" id="conferir-arquivo-entrada"
              onChange={e => { void escolher(e.target.files?.[0]); }} disabled={desabilitado} />
            <Button type="button" variant="outline" disabled={desabilitado} title={desabilitado ? motivoDesabilitado : undefined}
              onClick={() => entrada.current?.click()} className="gap-[var(--fin-s-2)]">
              <Upload aria-hidden="true" className="size-4" /> Escolher arquivo
            </Button>
          </>
        )}
      />
      {desabilitado && motivoDesabilitado ? <p className="fin-t-caption text-[var(--fin-text-3)]">{motivoDesabilitado}</p> : null}
      {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}

      {planilha ? (
        <div className="flex flex-col gap-[var(--fin-s-3)]">
          <p className="flex items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)]">
            <FileSpreadsheet aria-hidden="true" className="size-4 text-[var(--fin-text-3)]" />
            {planilha.nome} · {planilha.linhas.length} {planilha.linhas.length === 1 ? 'linha' : 'linhas'}
          </p>
          <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
            <Field rotulo="Coluna que identifica o item" ajuda="Localizador, número da venda ou nome do passageiro.">
              {a => (
                <select {...a} className={CONTROLE} value={colRef} onChange={e => setColRef(e.target.value)}>
                  {opcoes.map(o => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                </select>
              )}
            </Field>
            <Field rotulo="Coluna do valor" ajuda="Sem coluna de valor, confere só se o item está no arquivo.">
              {a => (
                <select {...a} className={CONTROLE} value={colValor} onChange={e => setColValor(e.target.value)}>
                  <option value={NENHUMA}>Sem coluna de valor</option>
                  {opcoes.map(o => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                </select>
              )}
            </Field>
          </div>
          <div>
            <Button type="button" onClick={() => { void conferir(); }} disabled={enviando}>{enviando ? 'Conferindo…' : 'Conferir os itens'}</Button>
          </div>
        </div>
      ) : null}

      {relatorio ? (
        <div className="flex flex-col gap-[var(--fin-s-3)]" aria-live="polite">
          <dl className="grid grid-cols-2 gap-[var(--fin-s-3)] sm:grid-cols-4">
            <Numero rotulo="Bateram" valor={relatorio.conferidos} tom="positivo" />
            <Numero rotulo="Valor diferente" valor={relatorio.itens.filter(i => i.resultado === 'VALOR_DIFERENTE').length} tom="negativo" />
            <Numero rotulo="Faltam no arquivo" valor={relatorio.itens.filter(i => i.resultado === 'FALTA_NO_ARQUIVO').length} tom="aviso" />
            <Numero rotulo="Linhas sem item" valor={relatorio.linhas_sem_item.length} tom="aviso" />
          </dl>
          {relatorio.divergentes === 0 ? (
            <Aviso tom="positivo">Tudo bateu: cada item da fatura está no arquivo do cliente, com o mesmo valor.</Aviso>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--fin-border)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)]">
              {relatorio.itens.filter(i => i.resultado !== 'CONFERIDO').map(i => {
                const item = porConta.get(i.conta_id);
                return (
                  <li key={i.conta_id} className="flex flex-col gap-0.5 px-[var(--fin-s-3)] py-[var(--fin-s-2)] sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0 truncate fin-t-body text-[var(--fin-text)]">{item?.descricao ?? i.conta_id}</span>
                    <span className={cn('fin-t-caption', i.resultado === 'VALOR_DIFERENTE' ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-warning-text)]')}>
                      {i.resultado === 'VALOR_DIFERENTE'
                        ? `Aqui ${reais(item?.valor_centavos)}; no arquivo (linha ${i.linha}) ${reais(i.valor_arquivo_centavos ?? 0)}`
                        : 'Não aparece no arquivo'}
                    </span>
                  </li>
                );
              })}
              {relatorio.linhas_sem_item.map(l => (
                <li key={`l${l.linha}`} className="flex flex-col gap-0.5 px-[var(--fin-s-3)] py-[var(--fin-s-2)] sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0 truncate fin-t-body text-[var(--fin-text)]">Linha {l.linha}: {l.referencia}</span>
                  <span className="fin-t-caption text-[var(--fin-warning-text)]">
                    Está no arquivo e não nesta fatura{l.valor_centavos != null ? ` (${reais(l.valor_centavos)})` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {relatorio.divergentes ? (
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              Para acertar um valor, use Corrigir valor no item: a diferença vira nota de crédito ou débito com o motivo escrito.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Numero({ rotulo, valor, tom }: { rotulo: string; valor: number; tom: 'positivo' | 'negativo' | 'aviso' }) {
  const cor = valor === 0 ? 'text-[var(--fin-text-3)]' : tom === 'positivo' ? 'text-[var(--fin-positive)]' : tom === 'negativo' ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-warning-text)]';
  return (
    <div className="flex flex-col gap-0.5 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)]">
      <dt className="fin-t-caption text-[var(--fin-text-2)]">{rotulo}</dt>
      <dd className={cn('fin-t-metric-sm tabular-nums', cor)}>{valor}</dd>
    </div>
  );
}

'use client';

/**
 * Mais parcelas (05/11/2026): N cópias de uma conta já lançada, com
 * Quantidade, Periodicidade e a opção de a emissão ser o próprio
 * vencimento. A prévia vem do servidor, que também recusa
 * conta gerada por venda ou fatura com o motivo por extenso.
 */
import * as React from 'react';

import { Field } from '@/components/fin/Field';
import { Money } from '@/components/fin/Money';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Input } from '@/components/ui/input';
import { CampoSelecao, CONTROLE, Interruptor, type OpcaoDeSelecao } from '@/app/financeiro-ag/pagar/campos';
import { PRESETS, formatarData, type ChavePreset, type TabelaAlvo } from '@/lib/recorrencia';
import { maisParcelas, type RespostaMaisParcelas } from '@/lib/recorrencia-cliente';
import { soma } from '@/lib/money';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

const OPCOES_PERIODICIDADE: OpcaoDeSelecao[] = PRESETS.map(p => ({ valor: p.chave, rotulo: p.rotulo }));

export type MaisParcelasProps = {
  /** A conta de origem; null fecha o painel. */
  titulo: { id: string; descricao: string; pessoa: string } | null;
  tabela: TabelaAlvo;
  onFechar: () => void;
  onGeradas: () => void;
};

export function MaisParcelas({ titulo, tabela, onFechar, onGeradas }: MaisParcelasProps) {
  const [quantidade, setQuantidade] = React.useState(1);
  const [periodicidade, setPeriodicidade] = React.useState<ChavePreset>('MENSAL');
  const [usarVencimento, setUsarVencimento] = React.useState(false);
  const [previa, setPrevia] = React.useState<RespostaMaisParcelas | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(false);
  const [gravando, setGravando] = React.useState(false);
  // Um pedido por abertura: o duplo clique em "Gerar" não gera duas vezes.
  const chave = React.useRef('');

  React.useEffect(() => {
    if (!titulo) return;
    chave.current = `pa-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    setQuantidade(1);
    setPeriodicidade('MENSAL');
    setUsarVencimento(false);
  }, [titulo]);

  React.useEffect(() => {
    if (!titulo) return;
    let vivo = true;
    setCarregando(true);
    const t = setTimeout(() => {
      maisParcelas({
        tabela, titulo_id: titulo.id, quantidade, periodicidade, emissao_no_vencimento: usarVencimento, previa: true,
      })
        .then(r => { if (vivo) { setPrevia(r); setErro(null); } })
        .catch(e => { if (vivo) { setPrevia(null); setErro(e instanceof Error ? e.message : 'Não foi possível calcular.'); } })
        .finally(() => { if (vivo) setCarregando(false); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [titulo, tabela, quantidade, periodicidade, usarVencimento]);

  async function gerar() {
    if (!titulo || gravando) return;
    setGravando(true);
    try {
      const r = await maisParcelas({
        tabela, titulo_id: titulo.id, quantidade, periodicidade, emissao_no_vencimento: usarVencimento,
        previa: false, chave: chave.current,
      });
      toast.success(
        r.ja_feito ? 'Essas parcelas já tinham sido geradas' : r.criadas === 1 ? '1 parcela a mais gerada' : `${r.criadas} mais parcelas geradas`,
        titulo.descricao,
      );
      onGeradas();
      onFechar();
    } catch (e) {
      toast.error('Não foi possível gerar as parcelas', e instanceof Error ? e.message : '');
    } finally {
      setGravando(false);
    }
  }

  const parcelas = previa?.parcelas ?? [];
  const resumo = erro ? (
    <span className="text-[var(--fin-negative-text)]">{erro}</span>
  ) : parcelas.length > 0 ? (
    <span className="flex items-baseline justify-between gap-3">
      <span>
        {parcelas.length === 1 ? '1 parcela nova' : `${parcelas.length} parcelas novas`}, de {formatarData(parcelas[0].vencimento)} a{' '}
        {formatarData(parcelas[parcelas.length - 1].vencimento)}. Nascem em aberto.
      </span>
      <Money valor={soma(parcelas.map(p => p.valor))} size="strong" estado="ok" />
    </span>
  ) : (
    <span>{carregando ? 'Calculando as datas…' : 'Escolha a quantidade e a periodicidade.'}</span>
  );

  return (
    <RecordSheet
      aberto={Boolean(titulo)}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo="Mais parcelas"
      descricao={titulo ? `Cópias de "${titulo.descricao}"${titulo.pessoa ? `, ${titulo.pessoa}` : ''}, a partir do vencimento dela.` : undefined}
      largura={480}
      resumo={resumo}
      acaoPrimaria={{
        rotulo: 'Gerar parcelas',
        onClick: gerar,
        carregando: gravando,
        desabilitado: Boolean(erro) || parcelas.length === 0 || carregando,
      }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          <Field rotulo="Quantidade" ajuda="Quantas parcelas a mais.">
            {a => (
              <Input
                {...a}
                aria-invalid={a['aria-invalid'] || undefined}
                type="number"
                inputMode="numeric"
                min={1}
                max={120}
                value={quantidade}
                onChange={e => setQuantidade(Math.min(120, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                className={cn(CONTROLE, 'tabular-nums')}
              />
            )}
          </Field>
          <CampoSelecao
            rotulo="Periodicidade"
            valor={periodicidade}
            opcoes={OPCOES_PERIODICIDADE}
            onChange={v => setPeriodicidade(v as ChavePreset)}
          />
        </div>

        <Interruptor
          rotulo="Emissão igual ao vencimento de cada parcela"
          descricao="Desligado, as parcelas novas têm a emissão de hoje."
          ligado={usarVencimento}
          onChange={setUsarVencimento}
        />

        {parcelas.length > 0 ? (
          <ol aria-label="Parcelas que serão geradas" className="flex flex-col rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-[var(--fin-s-3)]">
            {parcelas.slice(0, 8).map(p => (
              <li key={p.ordem} className="grid grid-cols-[3rem_1fr_auto] items-baseline gap-[var(--fin-s-2)] border-b border-[var(--fin-border)] py-[var(--fin-s-2)] last:border-b-0">
                <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">{p.ordem}ª</span>
                <span className="fin-t-body tabular-nums text-[var(--fin-text)]">
                  {formatarData(p.vencimento)}
                  <span className="fin-t-caption ml-[var(--fin-s-2)] text-[var(--fin-text-3)]">emissão {formatarData(p.emissao)}</span>
                </span>
                <Money valor={p.valor} size="body" estado="ok" />
              </li>
            ))}
            {parcelas.length > 8 ? (
              <li className="fin-t-caption py-[var(--fin-s-2)] text-[var(--fin-text-3)]">E mais {parcelas.length - 8}.</li>
            ) : null}
          </ol>
        ) : null}
      </div>
    </RecordSheet>
  );
}

export default MaisParcelas;

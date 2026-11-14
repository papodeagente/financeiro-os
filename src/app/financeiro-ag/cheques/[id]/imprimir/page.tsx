'use client';

/**
 * Impressão do cheque (E7, frente C). O cheque padrão brasileiro (175 × 80
 * mm) desenhado em milímetros: valor no quadro, extenso em duas linhas
 * travadas com asteriscos, favorecido, cidade e data por extenso. Cada banco
 * imprime o formulário um pouco deslocado: o ajuste (para a direita e para
 * baixo, em mm) fica salvo na conta bancária e vale para os próximos cheques
 * dela. Na impressão sai só o cheque, sem margens.
 */
import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Printer, Save, TriangleAlert } from 'lucide-react';

import type { ConfigDoCheque, DesenhoDoCheque } from '@/lib/cheques';
import { LIMITE_DO_AJUSTE_MM, ROTULO_SITUACAO_CHEQUE } from '@/lib/cheques';
import type { Cheque } from '@/lib/cheques-servidor';
import { toast } from '@/lib/toast';
import { cn, formatBRL } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataState } from '@/components/fin/DataState';
import { Field } from '@/components/fin/Field';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { StatusChip } from '@/components/fin/StatusChip';

const CONTROLE = 'fin-t-body h-11 w-28 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] tabular-nums lg:h-10';
const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)] md:p-[var(--fin-s-5)]';

type Resposta = { cheque: Cheque; desenho: DesenhoDoCheque | null; config: ConfigDoCheque | null };

const mm = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? Math.max(-LIMITE_DO_AJUSTE_MM, Math.min(LIMITE_DO_AJUSTE_MM, Math.round(n * 10) / 10)) : 0;
};

export default function ImprimirChequePage() {
  const { id } = useParams<{ id: string }>();
  const [dados, setDados] = React.useState<Resposta | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'erro' | 'ok'>('carregando');
  const [erro, setErro] = React.useState('');
  const [x, setX] = React.useState('0');
  const [y, setY] = React.useState('0');
  const [salvando, setSalvando] = React.useState(false);

  // Primeira leitura: o estado já nasce "carregando". Recarregar avisa antes.
  const carregar = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/cheques/${encodeURIComponent(id)}`);
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error ?? 'Não foi possível abrir o cheque.');
      setDados(corpo);
      setX(String(corpo.config?.deslocar_x_mm ?? 0).replace('.', ','));
      setY(String(corpo.config?.deslocar_y_mm ?? 0).replace('.', ','));
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir o cheque.');
      setEstado('erro');
    }
  }, [id]);

  React.useEffect(() => { void carregar(); }, [carregar]);

  // O desenho vem com o ajuste salvo; a prévia soma só a diferença do que a pessoa está mexendo.
  const dx = mm(x) - (dados?.config?.deslocar_x_mm ?? 0);
  const dy = mm(y) - (dados?.config?.deslocar_y_mm ?? 0);
  const mudouAjuste = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;

  async function salvarAjuste() {
    if (!dados) return;
    setSalvando(true);
    try {
      const r = await fetch('/api/cheques/configuracao', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conta_bancaria_id: dados.cheque.conta_bancaria_id, deslocar_x_mm: mm(x), deslocar_y_mm: mm(y) }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error('O ajuste não foi salvo', corpo.error ?? ''); return; }
      toast.success('Ajuste salvo na conta', `Vale para os próximos cheques de ${dados.cheque.conta_nome || 'esta conta'}.`);
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function imprimir() {
    window.print();
    // Marca a impressão (quantas vezes e quando) depois que a janela do navegador fecha.
    await fetch(`/api/cheques/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'marcar_impresso' }),
    }).catch(() => undefined);
  }

  const c = dados?.cheque;
  const cancelado = c?.situacao === 'CANCELADO';

  return (
    <MolduraDaPagina>
      <style>{`
        @media print {
          @page { size: 175mm 80mm; margin: 0; }
          body * { visibility: hidden !important; }
          .folha-do-cheque, .folha-do-cheque * { visibility: visible !important; }
          .folha-do-cheque { position: fixed !important; left: 0 !important; top: 0 !important; border: 0 !important; box-shadow: none !important; background: transparent !important; }
          .so-na-tela { display: none !important; }
        }
      `}</style>

      <div className="so-na-tela flex flex-col gap-[var(--fin-s-4)]">
        <PageHeader
          icone={Printer}
          titulo={c ? `Cheque nº ${c.numero}` : 'Imprimir cheque'}
          subtitulo={c ? `${c.conta_nome || 'Conta sem nome'} · ${formatBRL(c.valor_centavos / 100)} · ${c.favorecido || 'ao portador'}` : undefined}
          badge={c ? <StatusChip valor={c.situacao} dominio="cheque" dot /> : undefined}
          onRecarregar={async () => { setEstado('carregando'); await carregar(); }}
          acoesSecundarias={[{ rotulo: 'Cheques emitidos', href: '/financeiro-ag/cheques' }]}
        />
        <Link href="/financeiro-ag/cheques" className="inline-flex w-fit items-center gap-1.5 fin-t-body text-[var(--fin-accent)] underline-offset-2 hover:underline">
          <ArrowLeft aria-hidden="true" className="size-4" /> Voltar para os cheques
        </Link>
      </div>

      <DataState
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        esqueleto={<div className="h-[80mm] w-[175mm] max-w-full animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />}
      >
        {c && dados?.desenho ? (
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            {cancelado ? (
              <p role="status" className="so-na-tela flex items-start gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)]">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-warning)]" />
                Este cheque está {ROTULO_SITUACAO_CHEQUE[c.situacao].toLowerCase()}{c.motivo ? ` (${c.motivo})` : ''}. Ele aparece aqui só para consulta e não se imprime.
              </p>
            ) : null}
            {dados.desenho.extenso_nao_cabe ? (
              <p role="alert" className="so-na-tela flex items-start gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-warning-text)]">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                O valor por extenso não cabe nas duas linhas do cheque. Complete à mão o que ficar faltando.
              </p>
            ) : null}

            <div className="overflow-x-auto pb-[var(--fin-s-2)]">
              <div
                className={cn('folha-do-cheque relative shrink-0 overflow-hidden rounded-[var(--fin-r-sm)] border border-dashed border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)] shadow-[var(--fin-e1)]', cancelado && 'opacity-50')}
                style={{ width: `${dados.desenho.largura_mm}mm`, height: `${dados.desenho.altura_mm}mm` }}
                aria-label={`Cheque nº ${c.numero} como vai sair na impressão`}
              >
                {dados.desenho.campos.map(campo => (
                  <span
                    key={campo.campo}
                    className="absolute whitespace-pre leading-none"
                    style={{
                      left: `${campo.x + dx}mm`, top: `${campo.y + dy}mm`, maxWidth: `${campo.largura}mm`,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      fontSize: campo.campo === 'valor' ? '3.6mm' : '3.1mm',
                      fontWeight: campo.campo === 'valor' ? 600 : 400,
                    }}
                  >
                    {campo.texto}
                  </span>
                ))}
              </div>
            </div>

            <section className={cn(CARTAO, 'so-na-tela flex flex-col gap-[var(--fin-s-4)]')} aria-labelledby="ajuste-titulo">
              <div className="flex flex-col gap-1">
                <h2 id="ajuste-titulo" className="fin-t-subhead text-[var(--fin-text)]">Ajuste para a impressora</h2>
                <p className="fin-t-caption text-[var(--fin-text-3)]">
                  Imprima uma vez numa folha comum e ponha sobre um cheque contra a luz. Se o texto saiu deslocado, mova aqui
                  e salve: o ajuste fica em {c.conta_nome || 'esta conta'} e vale para os próximos cheques dela. Na janela de
                  impressão do navegador, escolha escala 100% e sem margens.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-[var(--fin-s-4)]">
                <Field rotulo="Para a direita (mm)" ajuda="Negativo: para a esquerda.">
                  {a => <Input {...a} inputMode="decimal" className={CONTROLE} value={x} onChange={e => setX(e.target.value)} />}
                </Field>
                <Field rotulo="Para baixo (mm)" ajuda="Negativo: para cima.">
                  {a => <Input {...a} inputMode="decimal" className={CONTROLE} value={y} onChange={e => setY(e.target.value)} />}
                </Field>
                <Button type="button" variant="outline" onClick={salvarAjuste} disabled={!mudouAjuste || salvando}>
                  <Save aria-hidden="true" className="size-4" /> {salvando ? 'Salvando…' : 'Salvar ajuste na conta'}
                </Button>
                <Button type="button" onClick={imprimir} disabled={cancelado}>
                  <Printer aria-hidden="true" className="size-4" /> Imprimir cheque
                </Button>
              </div>
              {c.impressoes > 0 ? (
                <p className="fin-t-caption text-[var(--fin-text-3)]">
                  Já impresso {c.impressoes === 1 ? 'uma vez' : `${c.impressoes} vezes`}
                  {c.impresso_em ? `, a última em ${new Date(c.impresso_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })}` : ''}.
                </p>
              ) : null}
            </section>
          </div>
        ) : null}
      </DataState>
    </MolduraDaPagina>
  );
}

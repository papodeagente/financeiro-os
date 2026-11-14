'use client';

import * as React from 'react';

import { RecordSheet } from '@/components/fin/RecordSheet';
import { ListaDaPrevia } from '@/app/financeiro-ag/contas/pecas';
import {
  api, chaveDeIdempotencia, ErroDaCobranca, type RespostaDaGravacaoDeCarne, type RespostaDaPreviaDeCarne,
} from '@/lib/cobranca/contrato-telas';
import { dataBR, mensagemDeErro, separarParaBoleto, type ContaParaCobrar } from '@/lib/cobranca/regras-telas';
import { formatBRL } from '@/lib/utils';
import { toast } from '@/lib/toast';

/**
 * Gerar carnê (05/11/2026): várias parcelas do mesmo cliente num carnê só,
 * cada lâmina com boleto e QR do Pix. Só aparece quando o provedor da
 * agência faz carnê (Asaas). Prévia primeiro; nada sai antes do "Gerar".
 */

function erroLegivel(e: unknown): string {
  if (e instanceof ErroDaCobranca) return mensagemDeErro(e.codigo, e.message, e.status);
  return mensagemDeErro(null, e instanceof Error ? e.message : '');
}

export function GerarCarne({ contas, onFechar, onConcluido }: {
  contas: (ContaParaCobrar & { descricao?: string })[] | null;
  onFechar: () => void;
  onConcluido: () => void;
}) {
  const aberto = contas !== null;
  const [previa, setPrevia] = React.useState<RespostaDaPreviaDeCarne | null>(null);
  const [feito, setFeito] = React.useState<RespostaDaGravacaoDeCarne | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [calculando, setCalculando] = React.useState(false);
  const [gravando, setGravando] = React.useState(false);
  const chave = React.useRef('');

  const ids = React.useMemo(() => separarParaBoleto(contas ?? []).prontas.map(c => c.id), [contas]);

  React.useEffect(() => {
    if (!aberto) return;
    setPrevia(null); setFeito(null); setErro(null);
    chave.current = chaveDeIdempotencia();
    if (ids.length < 2) return;
    let vivo = true;
    setCalculando(true);
    api.previaDeCarne(ids)
      .then(p => { if (vivo) setPrevia(p); })
      .catch(e => { if (vivo) setErro(erroLegivel(e)); })
      .finally(() => { if (vivo) setCalculando(false); });
    return () => { vivo = false; };
  }, [aberto, ids]);

  async function gerar() {
    if (!previa || gravando) return;
    setGravando(true);
    setErro(null);
    try {
      const prontas = previa.parcelas.filter(p => p.ok).map(p => p.conta_id);
      const r = await api.gerarCarne(prontas, previa.assinatura, chave.current);
      setFeito(r);
      toast.success('Carnê gerado', `${prontas.length} parcelas de ${previa.cliente_nome}.`);
      onConcluido();
    } catch (e) {
      setErro(erroLegivel(e));
    } finally {
      setGravando(false);
    }
  }

  if (!aberto) return null;
  const prontas = previa?.parcelas.filter(p => p.ok) ?? [];
  const fora = previa?.parcelas.filter(p => !p.ok) ?? [];

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo="Gerar carnê"
      descricao="Um carnê com todas as parcelas do cliente. Cada lâmina traz o boleto e o QR Code do Pix; cada parcela baixa sozinha quando é paga."
      largura={640}
      resumo={feito
        ? 'Pronto: o carnê está no provedor. Abra o PDF para imprimir ou mandar ao cliente.'
        : previa ? `${prontas.length} parcelas de ${previa.cliente_nome}, somando ${formatBRL(previa.total)}.` : null}
      acaoPrimaria={feito
        ? (feito.url_carne
          ? { rotulo: 'Abrir o carnê (PDF)', onClick: () => { window.open(feito.url_carne!, '_blank', 'noopener,noreferrer'); onFechar(); } }
          : { rotulo: 'Fechar', onClick: onFechar })
        : { rotulo: prontas.length ? `Gerar carnê com ${prontas.length} parcelas` : 'Gerar carnê', onClick: gerar, carregando: gravando, desabilitado: calculando || prontas.length < 2 }}
      acaoSecundaria={feito ? (feito.url_carne ? { rotulo: 'Fechar', onClick: onFechar } : null) : { rotulo: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        {erro ? <p role="alert" className="rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] p-[var(--fin-s-3)] fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : null}
        {ids.length < 2 ? (
          <p className="fin-t-body text-[var(--fin-text-2)]">Marque duas ou mais parcelas em aberto, sem boleto, do mesmo cliente.</p>
        ) : (
          <ListaDaPrevia
            carregando={calculando && !previa}
            concluido={Boolean(feito)}
            titulo={feito ? 'No carnê' : 'Parcelas do carnê'}
            itens={prontas.map(p => ({
              chave: p.conta_id, titulo: `Parcela ${p.numero}`, detalhe: `vence ${dataBR(p.vencimento)}`, ok: true, valor: p.valor,
            }))}
            fora={fora.map(p => ({ chave: p.conta_id, titulo: `Parcela ${p.numero}`, detalhe: dataBR(p.vencimento), motivo: p.motivo ?? 'Fica de fora.' }))}
          />
        )}
      </div>
    </RecordSheet>
  );
}

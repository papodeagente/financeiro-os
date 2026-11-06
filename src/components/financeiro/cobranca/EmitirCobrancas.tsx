'use client';

import * as React from 'react';

import { RecordSheet } from '@/components/fin/RecordSheet';
import { Segmentado } from '@/components/fin/Segmentado';
import { ListaDaPrevia } from '@/app/financeiro-ag/contas/pecas';
import {
  api, chaveDeIdempotencia, ErroDaCobranca, type RespostaDaGravacaoDeEmissao, type RespostaDaPreviaDeEmissao,
  type TipoDeCobranca,
} from '@/lib/cobranca/contrato-telas';
import {
  dataBR, mensagemDeErro, PROVEDORES, ROTULO_DO_TIPO, separarParaBoleto, type ContaParaCobrar,
} from '@/lib/cobranca/regras-telas';
import { formatBRL } from '@/lib/utils';
import { toast } from '@/lib/toast';

/**
 * Gerar boleto(s) — uma conta ou várias (05/11/2026).
 *
 * Abre com a prévia do servidor, conta por conta: quem ganha cobrança, em
 * qual provedor, de que tipo, e quem fica de fora com o motivo. Nada sai
 * para o provedor antes do "Emitir". Uma conta sai na hora; várias vão pela
 * fila (duas por segundo por agência) e a tela diz isso.
 */

export type ContaParaEmitir = ContaParaCobrar & { descricao?: string };

function erroLegivel(e: unknown): string {
  if (e instanceof ErroDaCobranca) return mensagemDeErro(e.codigo, e.message, e.status);
  return mensagemDeErro(null, e instanceof Error ? e.message : '');
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${n.toLocaleString('pt-BR')} ${varios}`);

export function EmitirCobrancas({ contas, onFechar, onConcluido }: {
  /** null fecha a janela. */
  contas: ContaParaEmitir[] | null;
  onFechar: () => void;
  onConcluido: () => void;
}) {
  const aberto = contas !== null;
  const [tipo, setTipo] = React.useState<TipoDeCobranca | null>(null);
  const [previa, setPrevia] = React.useState<RespostaDaPreviaDeEmissao | null>(null);
  const [feito, setFeito] = React.useState<RespostaDaGravacaoDeEmissao | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [calculando, setCalculando] = React.useState(false);
  const [gravando, setGravando] = React.useState(false);
  const chave = React.useRef('');
  // O que a prévia na tela respondeu: trocar para o mesmo tipo não pergunta de novo.
  const consultada = React.useRef('');

  const { prontas, fora: foraLocal } = React.useMemo(() => separarParaBoleto<ContaParaEmitir>(contas ?? []), [contas]);
  const ids = React.useMemo(() => prontas.map(c => c.id), [prontas]);

  React.useEffect(() => {
    if (!aberto) return;
    setTipo(null); setPrevia(null); setFeito(null); setErro(null);
    chave.current = chaveDeIdempotencia();
    consultada.current = '';
  }, [aberto, contas]);

  React.useEffect(() => {
    if (!aberto || feito || ids.length === 0) return;
    if (tipo && consultada.current === `${ids.join(',')}|${tipo}`) return;
    let vivo = true;
    setCalculando(true);
    setErro(null);
    api.previaDeEmissao({ contas: ids, ...(tipo ? { tipo } : {}) })
      .then(p => {
        if (!vivo) return;
        setPrevia(p);
        // A prévia sem tipo vem com o padrão da agência: a escolha começa nele.
        const tipoDaPrevia = tipo ?? p.itens[0]?.tipo ?? null;
        consultada.current = tipoDaPrevia ? `${ids.join(',')}|${tipoDaPrevia}` : '';
        if (!tipo && tipoDaPrevia) setTipo(tipoDaPrevia);
      })
      .catch(e => { if (vivo) { setPrevia(null); setErro(erroLegivel(e)); } })
      .finally(() => { if (vivo) setCalculando(false); });
    return () => { vivo = false; };
  }, [aberto, ids, tipo, feito]);

  async function emitir() {
    if (!previa || previa.prontos === 0 || gravando) return;
    setGravando(true);
    setErro(null);
    try {
      const prontos = previa.itens.filter(i => i.ok).map(i => i.conta_id);
      const r = await api.emitir({ contas: prontos, provedor: previa.provedor, ...(tipo ? { tipo } : {}), assinatura: previa.assinatura }, chave.current);
      setFeito(r);
      const falhas = r.itens.filter(i => !i.ok).length;
      if (r.na_fila) toast.success(`${plural(prontos.length, 'cobrança foi para a fila', 'cobranças foram para a fila')}`, 'Saem em instantes. A situação de cada uma aparece em Cobranças.');
      else if (falhas === 0) toast.success(prontos.length === 1 ? 'Cobrança emitida' : `${prontos.length} cobranças emitidas`);
      else toast.error(`${plural(falhas, 'cobrança não saiu', 'cobranças não saíram')}`, 'Veja o motivo de cada uma na janela.');
      onConcluido();
    } catch (e) {
      setErro(erroLegivel(e));
      if (e instanceof ErroDaCobranca && e.status === 409) setPrevia(null);
    } finally {
      setGravando(false);
    }
  }

  if (!aberto) return null;

  const provedor = previa ? PROVEDORES[previa.provedor] : null;
  const nome = (id: string) => contas?.find(c => c.id === id);
  const titulo = contas && contas.length === 1 ? 'Emitir boleto ou Pix' : 'Gerar boletos';

  const itensProntos = feito
    ? feito.itens.filter(i => i.ok).map(i => ({
      chave: i.conta_id, titulo: nome(i.conta_id)?.pessoa || 'Cliente', detalhe: nome(i.conta_id)?.descricao ?? '', ok: true,
      valor: previa?.itens.find(p => p.conta_id === i.conta_id)?.valor,
      nota: feito.na_fila ? 'Na fila: sai em instantes' : 'Emitida',
    }))
    : (previa?.itens.filter(i => i.ok) ?? []).map(i => ({
      chave: i.conta_id, titulo: i.cliente_nome || nome(i.conta_id)?.pessoa || 'Cliente', detalhe: i.descricao, ok: true,
      valor: i.valor, nota: `${ROTULO_DO_TIPO[i.tipo]} · vence ${dataBR(i.vencimento)}`, aviso: i.aviso ?? undefined,
    }));
  const itensFora = [
    ...foraLocal.map(f => ({ chave: `l:${f.conta.id}`, titulo: f.conta.pessoa || 'Conta', detalhe: f.conta.descricao ?? '', motivo: f.motivo })),
    ...(feito
      ? feito.itens.filter(i => !i.ok).map(i => ({ chave: i.conta_id, titulo: nome(i.conta_id)?.pessoa || 'Cliente', detalhe: '', motivo: mensagemDeErro(null, i.erro) }))
      : (previa?.itens.filter(i => !i.ok) ?? []).map(i => ({ chave: i.conta_id, titulo: i.cliente_nome || 'Cliente', detalhe: i.descricao, motivo: i.motivo ?? 'Não pode ganhar cobrança agora.' }))),
  ];

  const resumo = feito
    ? feito.na_fila
      ? `Pronto: ${plural(feito.itens.filter(i => i.ok).length, 'cobrança está', 'cobranças estão')} na fila e ${feito.itens.filter(i => i.ok).length === 1 ? 'sai' : 'saem'} em instantes.`
      : `Pronto: ${plural(feito.emitidas, 'cobrança emitida', 'cobranças emitidas')}.`
    : previa && provedor
      ? `${plural(previa.prontos, 'cobrança', 'cobranças')} no ${provedor.nome}, somando ${formatBRL(previa.total)}.${previa.prontos > 1 ? ' Vão pela fila, sem travar a tela.' : ''}`
      : null;

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={titulo}
      descricao="O provedor de cobrança da agência registra na hora. Quando o cliente pagar, a conta é baixada sozinha, com a taxa e a data certas."
      largura={640}
      resumo={resumo}
      acaoPrimaria={feito
        ? { rotulo: 'Fechar', onClick: onFechar }
        : {
          rotulo: previa && previa.prontos > 0 ? `Emitir ${plural(previa.prontos, 'cobrança', 'cobranças')}` : 'Emitir',
          onClick: emitir,
          carregando: gravando,
          desabilitado: calculando || !previa || previa.prontos === 0,
        }}
      acaoSecundaria={feito ? null : { rotulo: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        {provedor && !feito ? (
          <div className="flex flex-col gap-[var(--fin-s-2)]">
            <Segmentado
              rotulo="Como o cliente paga"
              valor={(tipo ?? provedor.tipos[0]) as TipoDeCobranca}
              onChange={v => setTipo(v)}
              opcoes={provedor.tipos.map(t => ({ valor: t, rotulo: ROTULO_DO_TIPO[t] }))}
            />
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              <span className="font-medium text-[var(--fin-text-2)]">{provedor.nome}:</span> {provedor.frase}
            </p>
          </div>
        ) : null}

        {erro ? <p role="alert" className="rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] p-[var(--fin-s-3)] fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : null}

        {ids.length === 0 && !feito ? (
          <p className="fin-t-body text-[var(--fin-text-2)]">Nenhuma das contas marcadas pode ganhar boleto agora. O motivo de cada uma está abaixo.</p>
        ) : null}

        <ListaDaPrevia
          carregando={calculando && !previa && ids.length > 0}
          concluido={Boolean(feito)}
          titulo={feito ? 'Feito' : 'Vão ganhar cobrança'}
          itens={itensProntos}
          fora={itensFora}
        />
      </div>
    </RecordSheet>
  );
}

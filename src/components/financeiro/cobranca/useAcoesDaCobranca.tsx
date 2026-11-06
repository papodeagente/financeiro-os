'use client';

import * as React from 'react';

import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Money } from '@/components/fin/Money';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/fin/Field';
import {
  api, chaveDeIdempotencia, ErroDaCobranca, type CanalDeEnvio, type Cobranca,
} from '@/lib/cobranca/contrato-telas';
import { dataBR, mensagemDeErro, ROTULO_DO_TIPO, type IdDaAcao } from '@/lib/cobranca/regras-telas';
import { addDias, hojeISO } from '@/lib/money';
import { toast } from '@/lib/toast';

/**
 * As ações de uma cobrança, num lugar só (05/11/2026): a tela Cobranças, o
 * bloco Cobrança da conta a receber e o menu da linha usam este gancho.
 *
 * Copiar e abrir são imediatos (não gravam nada). 2ª via, envio e
 * cancelamento sempre abrem uma confirmação dizendo o que vai acontecer;
 * só o "confirmar" chama o servidor, com chave de idempotência.
 */

const CAMPO = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body tabular-nums lg:h-10';

function erroLegivel(e: unknown): string {
  if (e instanceof ErroDaCobranca) return mensagemDeErro(e.codigo, e.message, e.status);
  return mensagemDeErro(null, e instanceof Error ? e.message : '', undefined);
}

export async function copiarTexto(texto: string, oQue: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${oQue} copiado`, 'Cole na mensagem para o cliente ou no aplicativo do banco.');
  } catch {
    toast.error('Não foi possível copiar.', 'O navegador não liberou a área de transferência.');
  }
}

type Dialogo =
  | { tipo: 'segunda_via'; c: Cobranca }
  | { tipo: 'enviar'; c: Cobranca; canal: CanalDeEnvio }
  | { tipo: 'cancelar'; c: Cobranca };

export function useAcoesDaCobranca(opcoes: { onMudou: () => void; onEmitirDeNovo?: (c: Cobranca) => void }) {
  const [dialogo, setDialogo] = React.useState<Dialogo | null>(null);
  const [processando, setProcessando] = React.useState(false);
  const [vencimento, setVencimento] = React.useState('');
  const [erro, setErro] = React.useState<string | null>(null);
  // Uma chave por janela aberta: confirmar duas vezes não manda duas vezes.
  const chave = React.useRef('');

  const abrir = React.useCallback((d: Dialogo) => {
    chave.current = chaveDeIdempotencia();
    setErro(null);
    if (d.tipo === 'segunda_via') {
      const hoje = hojeISO();
      setVencimento(d.c.vencimento && d.c.vencimento > hoje ? d.c.vencimento : addDias(hoje, 3));
    }
    setDialogo(d);
  }, []);

  const executar = React.useCallback((acao: IdDaAcao, c: Cobranca) => {
    switch (acao) {
      case 'copiar_linha': if (c.linha_digitavel) void copiarTexto(c.linha_digitavel, 'Linha digitável'); return;
      case 'copiar_pix': if (c.pix_copia_cola) void copiarTexto(c.pix_copia_cola, 'Código Pix'); return;
      case 'abrir_boleto': if (c.url_boleto) window.open(c.url_boleto, '_blank', 'noopener,noreferrer'); return;
      case 'abrir_fatura': if (c.url_fatura) window.open(c.url_fatura, '_blank', 'noopener,noreferrer'); return;
      case 'segunda_via': abrir({ tipo: 'segunda_via', c }); return;
      case 'enviar_email': abrir({ tipo: 'enviar', c, canal: 'email' }); return;
      case 'enviar_whatsapp': abrir({ tipo: 'enviar', c, canal: 'whatsapp' }); return;
      case 'cancelar': abrir({ tipo: 'cancelar', c }); return;
      case 'emitir_de_novo': opcoes.onEmitirDeNovo?.(c); return;
    }
  }, [abrir, opcoes]);

  async function confirmar() {
    if (!dialogo || processando) return;
    setProcessando(true);
    setErro(null);
    try {
      if (dialogo.tipo === 'segunda_via') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento) || vencimento < hojeISO()) {
          setErro('Escolha um vencimento de hoje em diante.');
          return;
        }
        await api.segundaVia(dialogo.c.id, { vencimento }, chave.current);
        toast.success('2ª via pronta', `Novo vencimento em ${dataBR(vencimento)}. O boleto e o Pix antigos deixam de valer.`);
      } else if (dialogo.tipo === 'enviar') {
        const r = await api.enviar(dialogo.c.id, dialogo.canal, chave.current);
        const meio = dialogo.canal === 'email' ? 'e-mail' : 'WhatsApp';
        if (r.enviado === false && !r.na_fila) {
          // O CRM recebeu, mas não mandou: o motivo vem dele, em palavras simples.
          setErro(`O ${meio} não saiu: ${r.motivo || 'o CRM não disse o motivo'}.`);
          return;
        }
        if (r.na_fila) toast.info(`Envio por ${meio} na fila`, r.motivo || 'Sai assim que o CRM responder.');
        else toast.success(dialogo.canal === 'email' ? 'E-mail enviado pelo CRM' : 'Enviado para a automação de WhatsApp do CRM', 'A mensagem sai com a marca da agência.');
      } else {
        await api.cancelar(dialogo.c.id, chave.current);
        toast.success('Cobrança cancelada', 'O cliente não consegue mais pagar este boleto nem este Pix. A conta continua em aberto.');
      }
      setDialogo(null);
      opcoes.onMudou();
    } catch (e) {
      setErro(erroLegivel(e));
    } finally {
      setProcessando(false);
    }
  }

  const c = dialogo?.c ?? null;
  const detalhes = c ? [
    { rotulo: 'Cliente', valor: c.cliente_nome || 'Cliente' },
    { rotulo: 'Cobrança', valor: `${ROTULO_DO_TIPO[c.tipo]} · vence ${dataBR(c.vencimento)}` },
    { rotulo: 'Valor', valor: <Money valor={c.valor} size="body" align="esquerda" estado="ok" /> },
  ] : undefined;

  const dialogos = (
    <>
      <RecordSheet
        aberto={dialogo?.tipo === 'segunda_via'}
        onOpenChange={a => { if (!a) setDialogo(null); }}
        titulo="2ª via com novo vencimento"
        descricao="O provedor atualiza a mesma cobrança: sai um boleto e um Pix novos, e os antigos deixam de valer."
        largura={480}
        resumo={c ? <>A cobrança de {c.cliente_nome || 'cliente'} passa a vencer em <b className="font-medium text-[var(--fin-text)]">{dataBR(vencimento) || '—'}</b>. Os juros e a multa contam a partir da nova data.</> : null}
        acaoPrimaria={{ rotulo: 'Gerar 2ª via', onClick: confirmar, carregando: processando, desabilitado: !vencimento }}
        acaoSecundaria={{ rotulo: 'Cancelar', onClick: () => setDialogo(null) }}
      >
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          {c ? (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-[var(--fin-s-4)] gap-y-[var(--fin-s-1)] fin-t-body">
              <dt className="text-[var(--fin-text-3)]">Vencimento atual</dt>
              <dd className="tabular-nums text-[var(--fin-text)]">{dataBR(c.vencimento)}</dd>
              <dt className="text-[var(--fin-text-3)]">Valor</dt>
              <dd><Money valor={c.valor} size="body" align="esquerda" estado="ok" /></dd>
            </dl>
          ) : null}
          <Field rotulo="Novo vencimento" ajuda="De hoje em diante.">
            {a => (
              <Input {...a} type="date" min={hojeISO()} value={vencimento} onChange={e => setVencimento(e.target.value)} className={`${CAMPO} sm:w-48`} />
            )}
          </Field>
          {erro ? <p role="alert" className="rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] p-[var(--fin-s-3)] fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : null}
        </div>
      </RecordSheet>

      <ConfirmDialog
        aberto={dialogo?.tipo === 'enviar'}
        onOpenChange={a => { if (!a) setDialogo(null); }}
        titulo={dialogo?.tipo === 'enviar' && dialogo.canal === 'whatsapp' ? 'Enviar a cobrança por WhatsApp?' : 'Enviar a cobrança por e-mail?'}
        oQueVaiAcontecer={dialogo?.tipo === 'enviar' && dialogo.canal === 'whatsapp'
          ? 'O CRM da agência manda ao cliente, pelo modelo de mensagem aprovado, o valor, o vencimento, o Pix e o link do boleto.'
          : 'O CRM da agência manda ao cliente um e-mail com o valor, o vencimento, o Pix e o link do boleto.'}
        detalhes={detalhes}
        previa={erro ? <p role="alert" className="fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : undefined}
        confirmarRotulo="Enviar"
        processando={processando}
        onConfirmar={confirmar}
      />

      <ConfirmDialog
        aberto={dialogo?.tipo === 'cancelar'}
        onOpenChange={a => { if (!a) setDialogo(null); }}
        titulo="Cancelar esta cobrança?"
        oQueVaiAcontecer="O boleto e o Pix são cancelados no provedor e o cliente não consegue mais pagar por eles. A conta a receber continua em aberto: dá para emitir outra cobrança depois."
        detalhes={detalhes}
        previa={erro ? <p role="alert" className="fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : undefined}
        confirmarRotulo="Cancelar a cobrança"
        voltarRotulo="Manter"
        tone="destrutivo"
        processando={processando}
        onConfirmar={confirmar}
      />
    </>
  );

  return { executar, dialogos };
}

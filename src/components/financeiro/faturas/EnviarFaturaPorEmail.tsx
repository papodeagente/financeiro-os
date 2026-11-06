'use client';

import * as React from 'react';

import { Field } from '@/components/fin/Field';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Segmentado } from '@/components/fin/Segmentado';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ajudaDosDocumentos, OPCOES_DE_DOCUMENTOS } from '@/components/financeiro/cobranca/useAcoesDaCobranca';
import { api, chaveDeIdempotencia, ErroDaCobranca } from '@/lib/cobranca/contrato-telas';
import { mensagemDeErro } from '@/lib/cobranca/regras-telas';
import { toast } from '@/lib/toast';
import { dataBR, reais } from './comum';

/**
 * "Enviar por e-mail" da ficha da fatura (E7): Boleto, Fatura ou Boleto e
 * fatura. A fatura vai como link para o cliente ler e salvar em PDF (o mesmo
 * documento que a agência imprime). Sem boleto em aberto, só a fatura pode ir.
 * Sai pelo e-mail do CRM, como o envio da cobrança.
 */
type Documentos = 'boleto' | 'fatura' | 'boleto_e_fatura';

const CAMPO = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body lg:h-10';

export function EnviarFaturaPorEmail({ aberto, onFechar, faturaId, numero, cliente, totalCentavos, vencimento, temBoleto }: {
  aberto: boolean;
  onFechar: () => void;
  faturaId: string;
  numero: number;
  cliente: string;
  totalCentavos: number;
  vencimento: string;
  /** A fatura tem boleto/Pix em aberto? Sem ele, só o documento da fatura pode ir. */
  temBoleto: boolean;
}) {
  const [documentos, setDocumentos] = React.useState<Documentos>(temBoleto ? 'boleto_e_fatura' : 'fatura');
  const [copia, setCopia] = React.useState('');
  const [assunto, setAssunto] = React.useState('');
  const [mensagem, setMensagem] = React.useState('');
  const [processando, setProcessando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  // Uma chave por janela aberta: confirmar duas vezes não manda duas vezes.
  const chave = React.useRef(chaveDeIdempotencia());

  async function enviar() {
    if (processando) return;
    setProcessando(true);
    setErro(null);
    try {
      const copiaPara = copia.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
      const r = await api.enviarFatura(faturaId, chave.current, {
        documentos,
        ...(copiaPara.length ? { copia_para: copiaPara } : {}),
        ...(assunto.trim() ? { assunto: assunto.trim() } : {}),
        ...(mensagem.trim() ? { mensagem: mensagem.trim() } : {}),
      });
      if (r.enviado === false && !r.na_fila) {
        setErro(`O e-mail não saiu: ${r.motivo || 'o CRM não disse o motivo'}.`);
        return;
      }
      if (r.na_fila) toast.info('Envio por e-mail na fila', r.motivo || 'Sai assim que o CRM responder.');
      else toast.success('E-mail enviado pelo CRM', documentos === 'fatura' ? 'O cliente recebe o link da fatura.' : 'O cliente recebe o boleto e o link da fatura.');
      onFechar();
    } catch (e) {
      setErro(e instanceof ErroDaCobranca ? mensagemDeErro(e.codigo, e.message, e.status) : mensagemDeErro(null, e instanceof Error ? e.message : '', undefined));
    } finally {
      setProcessando(false);
    }
  }

  const opcoes = temBoleto ? OPCOES_DE_DOCUMENTOS : OPCOES_DE_DOCUMENTOS.filter(o => o.valor === 'fatura');

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={`Enviar a fatura Nº ${numero} por e-mail`}
      descricao="O CRM da agência manda ao cliente, com a marca da agência. Cópia e texto são opcionais."
      largura={640}
      resumo={<>Vai para o e-mail de {cliente || 'cliente'} cadastrado no CRM{copia.trim() ? ', com cópia para os endereços acima' : ''}.</>}
      acaoPrimaria={{ rotulo: 'Enviar', onClick: enviar, carregando: processando }}
      acaoSecundaria={{ rotulo: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-[var(--fin-s-4)] gap-y-[var(--fin-s-1)] fin-t-body">
          <dt className="text-[var(--fin-text-3)]">Fatura</dt>
          <dd className="tabular-nums text-[var(--fin-text)]">Nº {numero} · vence {dataBR(vencimento)}</dd>
          <dt className="text-[var(--fin-text-3)]">Valor</dt>
          <dd className="tabular-nums text-[var(--fin-text)]">{reais(totalCentavos)}</dd>
        </dl>
        <div className="flex flex-col gap-[var(--fin-s-1)]">
          <span className="fin-t-body-strong text-[var(--fin-text)]">O que vai no e-mail</span>
          {opcoes.length > 1 ? (
            <Segmentado rotulo="O que vai no e-mail" opcoes={opcoes} valor={documentos} onChange={setDocumentos} cheio="celular" />
          ) : null}
          <p className="fin-t-caption text-[var(--fin-text-2)]">
            {ajudaDosDocumentos(documentos, numero)}
            {!temBoleto ? ' Para mandar o boleto junto, cobre a fatura com boleto e Pix antes.' : ''}
          </p>
        </div>
        <Field rotulo="Com cópia para" ajuda="Até 5 e-mails, separados por vírgula. Ex.: o financeiro da empresa do cliente.">
          {a => (
            <Input {...a} type="text" inputMode="email" autoComplete="off" value={copia} onChange={e => setCopia(e.target.value)}
              placeholder="financeiro@empresa.com.br" className={CAMPO} />
          )}
        </Field>
        <Field rotulo="Assunto" ajuda="Em branco, sai o assunto padrão do CRM.">
          {a => <Input {...a} type="text" maxLength={150} value={assunto} onChange={e => setAssunto(e.target.value)} className={CAMPO} />}
        </Field>
        <Field rotulo="Mensagem" ajuda="Abre o e-mail. Em branco, sai o texto padrão.">
          {a => (
            <Textarea {...a} rows={4} maxLength={2000} value={mensagem} onChange={e => setMensagem(e.target.value)}
              className="rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body" />
          )}
        </Field>
        {erro ? <p role="alert" className="rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] p-[var(--fin-s-3)] fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : null}
      </div>
    </RecordSheet>
  );
}

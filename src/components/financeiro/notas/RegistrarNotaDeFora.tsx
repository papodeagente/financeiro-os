'use client';

import * as React from 'react';

import { ClientePicker } from '@/components/ClientePicker';
import { Callout } from '@/components/fin/Callout';
import { MoneyField } from '@/components/fin/MoneyField';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { hojeISO } from '@/lib/money';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { apiNotas } from './api';
import { CAMPO_TEXTO, Interruptor } from './pecas';

type Rascunho = {
  numero: string; serie: string; data_emissao: string; valor: number; iss: string;
  cliente_id: string; nome: string; cpf_cnpj: string; email: string;
  estrangeiro: boolean; documento_estrangeiro: string; pais: string;
  venda_numero: string; codigo_verificacao: string; link_pdf: string; discriminacao: string;
};

const VAZIO: Rascunho = {
  numero: '', serie: '', data_emissao: '', valor: 0, iss: '',
  cliente_id: '', nome: '', cpf_cnpj: '', email: '',
  estrangeiro: false, documento_estrangeiro: '', pais: '',
  venda_numero: '', codigo_verificacao: '', link_pdf: '', discriminacao: '',
};

function centavosDe(v: string): number | null {
  const limpo = v.trim().replace(/\./g, '').replace(',', '.');
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/**
 * Registrar uma nota emitida fora do sistema (no portal da prefeitura): ela
 * passa a contar na venda e na lista de notas, sem ir ao emissor. A mesma
 * nota (prestador, série e número) não entra duas vezes.
 */
export function RegistrarNotaDeFora({ aberto, onFechar, onRegistrada }: {
  aberto: boolean;
  onFechar: () => void;
  onRegistrada: () => void;
}) {
  const [r, setR] = React.useState<Rascunho>(() => ({ ...VAZIO, data_emissao: hojeISO() }));
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const sujo = Boolean(r.numero || r.valor || r.nome);
  const mudar = (p: Partial<Rascunho>) => { setR(a => ({ ...a, ...p })); setErro(null); };

  React.useEffect(() => {
    if (aberto) { setR({ ...VAZIO, data_emissao: hojeISO() }); setErro(null); }
  }, [aberto]);

  async function salvar() {
    setSalvando(true);
    try {
      const res = await apiNotas.registrarNotaDeFora({
        numero: r.numero, serie: r.serie, data_emissao: r.data_emissao,
        valor_centavos: Math.round(r.valor * 100), iss_centavos: centavosDe(r.iss),
        tomador: {
          nome: r.nome, cpf_cnpj: r.estrangeiro ? '' : r.cpf_cnpj, email: r.email,
          estrangeiro: r.estrangeiro, documento_estrangeiro: r.documento_estrangeiro, pais: r.pais,
        },
        cliente_id: r.cliente_id, venda_numero: r.venda_numero,
        codigo_verificacao: r.codigo_verificacao, link_pdf: r.link_pdf, discriminacao: r.discriminacao,
      });
      if (res.repetida) toast.info('Esta nota já estava registrada', `A nota ${res.nota.numero} continua uma só.`);
      else toast.success('Nota registrada', `A nota ${res.nota.numero} já aparece na lista e conta na venda.`);
      onRegistrada();
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A nota não foi registrada.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo="Registrar nota emitida fora"
      descricao="Para a nota que saiu no portal da prefeitura ou em outro sistema. Ela entra como autorizada e conta na venda; nada é enviado à prefeitura."
      largura={640}
      sujo={sujo}
      acaoPrimaria={{ rotulo: 'Registrar nota', onClick: salvar, carregando: salvando }}
      acaoSecundaria={{ rotulo: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-[var(--fin-s-5)]">
        {erro ? <Callout tom="negativo" titulo="A nota não foi registrada">{erro}</Callout> : null}

        <fieldset className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
          <legend className="mb-[var(--fin-s-2)] fin-t-subhead text-[var(--fin-text)]">A nota</legend>
          <Campo id="fora-numero" rotulo="Número" obrigatorio valor={r.numero} onChange={v => mudar({ numero: v })} max={30} />
          <Campo id="fora-serie" rotulo="Série" valor={r.serie} onChange={v => mudar({ serie: v })} max={10} ajuda="Se o documento tiver." />
          <label htmlFor="fora-data" className="flex flex-col gap-[var(--fin-s-1)]">
            <span className="fin-t-body-strong text-[var(--fin-text)]">Emitida em <span className="text-[var(--fin-negative-text)]">*</span></span>
            <input id="fora-data" type="date" className={CAMPO_TEXTO} value={r.data_emissao} max={hojeISO()} onChange={e => mudar({ data_emissao: e.target.value })} />
          </label>
          <div className="sm:col-span-2">
            <MoneyField rotulo="Valor do serviço" obrigatorio valor={r.valor} onChange={v => mudar({ valor: v })} />
          </div>
          <Campo id="fora-iss" rotulo="ISS (R$)" valor={r.iss} onChange={v => mudar({ iss: v })} max={20} decimal ajuda="Se souber." />
          <Campo id="fora-codigo" rotulo="Código de verificação" valor={r.codigo_verificacao} onChange={v => mudar({ codigo_verificacao: v })} max={60} />
          <div className="sm:col-span-2">
            <Campo id="fora-link" rotulo="Link da nota na prefeitura" valor={r.link_pdf} onChange={v => mudar({ link_pdf: v })} max={1000} ajuda="Começa com https://. Opcional." />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-[var(--fin-s-3)]">
          <legend className="mb-[var(--fin-s-2)] fin-t-subhead text-[var(--fin-text)]">Para quem</legend>
          <div className="flex flex-col gap-[var(--fin-s-1)]">
            <span className="fin-t-body-strong text-[var(--fin-text)]">Cliente do cadastro</span>
            <ClientePicker
              value={r.cliente_id || undefined}
              nome={r.nome || undefined}
              avisarSobreNota={false}
              placeholder="Buscar o cliente (ou preencha abaixo)"
              onChange={c => mudar(c ? { cliente_id: c.id, nome: c.nome, cpf_cnpj: c.documento } : { cliente_id: '' })}
            />
          </div>
          <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
            <Campo id="fora-nome" rotulo="Nome ou razão social" obrigatorio valor={r.nome} onChange={v => mudar({ nome: v })} max={200} />
            {!r.estrangeiro ? (
              <Campo id="fora-doc" rotulo="CPF ou CNPJ" obrigatorio valor={r.cpf_cnpj} onChange={v => mudar({ cpf_cnpj: v })} max={20} />
            ) : (
              <Campo id="fora-doc-ext" rotulo="Documento no país dele" valor={r.documento_estrangeiro} onChange={v => mudar({ documento_estrangeiro: v })} max={60} ajuda="Passaporte ou o número fiscal do país." />
            )}
          </div>
          <Interruptor
            id="fora-exterior"
            ligado={r.estrangeiro}
            onChange={v => mudar({ estrangeiro: v })}
            rotulo="Tomador do exterior"
            descricao="Sem CPF nem CNPJ. O código do país e se o serviço conta como exportação: confirmar com o contador."
          />
          {r.estrangeiro ? (
            <Campo id="fora-pais" rotulo="País" valor={r.pais} onChange={v => mudar({ pais: v })} max={60} />
          ) : null}
          <Campo id="fora-email" rotulo="E-mail" valor={r.email} onChange={v => mudar({ email: v })} max={200} />
        </fieldset>

        <fieldset className="flex flex-col gap-[var(--fin-s-3)]">
          <legend className="mb-[var(--fin-s-2)] fin-t-subhead text-[var(--fin-text)]">Ligação com a venda</legend>
          <Campo
            id="fora-venda" rotulo="Número da venda" valor={r.venda_numero} onChange={v => mudar({ venda_numero: v })} max={60}
            ajuda="Com a venda, a nota abate o saldo em Gerar notas e a complementar sai pela diferença. Sem ela, a nota fica só na lista."
          />
          <label htmlFor="fora-texto" className="flex flex-col gap-[var(--fin-s-1)]">
            <span className="fin-t-body-strong text-[var(--fin-text)]">Texto da nota</span>
            <textarea
              id="fora-texto" rows={3} maxLength={1000} value={r.discriminacao}
              onChange={e => mudar({ discriminacao: e.target.value })}
              className="rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] p-[var(--fin-s-2)] fin-t-body text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
            />
          </label>
        </fieldset>
      </div>
    </RecordSheet>
  );
}

function Campo({ id, rotulo, valor, onChange, max, ajuda, obrigatorio, decimal }: {
  id: string; rotulo: string; valor: string; onChange: (v: string) => void; max: number; ajuda?: string; obrigatorio?: boolean; decimal?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
      <span className="fin-t-body-strong text-[var(--fin-text)]">
        {rotulo}{obrigatorio ? <span className="text-[var(--fin-negative-text)]"> *</span> : null}
      </span>
      <input
        id={id}
        className={cn(CAMPO_TEXTO, decimal && 'tabular-nums')}
        value={valor}
        maxLength={max}
        inputMode={decimal ? 'decimal' : undefined}
        onChange={e => onChange(e.target.value)}
        aria-describedby={ajuda ? `${id}-ajuda` : undefined}
      />
      {ajuda ? <span id={`${id}-ajuda`} className="fin-t-caption text-[var(--fin-text-3)]">{ajuda}</span> : null}
    </label>
  );
}

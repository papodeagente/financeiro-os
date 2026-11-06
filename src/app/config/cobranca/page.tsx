'use client';

import { ReferenciaDeJuros } from '@/components/fin/ReferenciaDeJuros';
import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, CircleDashed, ReceiptText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataState } from '@/components/fin/DataState';
import { Field } from '@/components/fin/Field';
import { PageHeader } from '@/components/fin/PageHeader';
import { Segmentado } from '@/components/fin/Segmentado';
import {
  api, ErroDaCobranca, type ConfigDeCobranca, type ProvedorDeCobranca, type TipoDeCobranca,
} from '@/lib/cobranca/contrato-telas';
import {
  DIAS_DA_REGUA_PADRAO, descricaoDeExemplo, errosDaConfig, mensagemDeErro, normalizarDiasDaRegua, PROVEDORES,
  ROTULO_DO_TIPO, rotuloDoDiaDaRegua,
} from '@/lib/cobranca/regras-telas';
import { loadEntities } from '@/lib/crm-storage';
import { contaBancariaAtiva } from '@/lib/contas-bancarias-regras';
import type { ContaBancaria } from '@/lib/crm-types';
import { num } from '@/lib/money';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

/**
 * Configurações › Cobrança (05/11/2026). Qual provedor da agência emite
 * (Asaas ou Pagar.me) e o que cada um faz, a conta que recebe, juros,
 * multa e desconto do boleto, a régua de lembretes e o texto da cobrança.
 * Nada é gravado até "Salvar".
 */

const SECAO = 'flex max-w-3xl flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)]';
const CONTROLE = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body tabular-nums lg:h-10';
const SELECT = cn(CONTROLE, 'w-full border px-3 text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]');
const DIAS_OFERECIDOS = [-10, -5, -3, -1, 0, 1, 3, 5, 7, 10, 15, 30];
const VARIAVEIS = [
  { chave: '{descricao}', rotulo: 'Descrição da conta' },
  { chave: '{parcela}', rotulo: 'Parcela (2/6)' },
  { chave: '{agencia}', rotulo: 'Nome da agência' },
];

function Numero({ rotulo, ajuda, valor, onChange, unidade, erro, inteiro = false }: {
  rotulo: string; ajuda?: string; valor: number; onChange: (v: number) => void; unidade: string; erro?: string; inteiro?: boolean;
}) {
  return (
    <Field rotulo={rotulo} ajuda={ajuda} erro={erro}>
      {a => (
        <div className="relative">
          <Input
            {...a} type="number" inputMode={inteiro ? 'numeric' : 'decimal'} min={0} step={inteiro ? 1 : 0.01}
            value={Number.isFinite(valor) ? String(valor) : ''}
            onChange={e => onChange(inteiro ? Math.round(num(e.target.value)) : num(e.target.value.replace(',', '.')))}
            className={`${CONTROLE} pr-14`}
          />
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-[var(--fin-s-3)] flex items-center fin-t-body text-[var(--fin-text-2)]">{unidade}</span>
        </div>
      )}
    </Field>
  );
}

function CartaoDoProvedor({ id, config, escolhido, onEscolher }: {
  id: ProvedorDeCobranca; config: ConfigDeCobranca; escolhido: boolean; onEscolher: () => void;
}) {
  const p = PROVEDORES[id];
  const conectado = config.provedores.find(x => x.id === id)?.conectado ?? false;
  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border p-[var(--fin-s-4)] transition-colors duration-[var(--fin-dur-rapida)]',
        escolhido ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border)] hover:bg-[var(--fin-surface-2)]',
        !conectado && 'cursor-not-allowed opacity-80 hover:bg-transparent',
      )}
    >
      <span className="flex items-center justify-between gap-[var(--fin-s-2)]">
        <span className="flex items-center gap-[var(--fin-s-2)]">
          <input
            type="radio" name="provedor" value={id} checked={escolhido} disabled={!conectado} onChange={onEscolher}
            className="size-4 accent-[var(--fin-accent)]"
          />
          <span className="fin-t-body-strong text-[var(--fin-text)]">{p.nome}</span>
        </span>
        {conectado ? (
          <span className="inline-flex items-center gap-1 fin-t-caption text-[var(--fin-positive)]"><CheckCircle2 aria-hidden="true" className="size-3.5" /> Conectado</span>
        ) : (
          <span className="inline-flex items-center gap-1 fin-t-caption text-[var(--fin-text-3)]"><CircleDashed aria-hidden="true" className="size-3.5" /> Não conectado</span>
        )}
      </span>
      <span className="fin-t-caption text-[var(--fin-text-2)]">{p.frase}</span>
      <span className="fin-t-caption text-[var(--fin-text-3)]">
        Emite: {p.tipos.map(t => ROTULO_DO_TIPO[t]).join(', ')}{p.capacidades.carne ? ', Carnê' : ''}{p.capacidades.link ? ', Link de pagamento' : ''}.
      </span>
      {!conectado ? (
        <Link href="/config/plataformas" className="fin-t-caption text-[var(--fin-accent)] underline-offset-2 hover:underline">
          Conectar o {p.nome} em Plataformas
        </Link>
      ) : null}
    </label>
  );
}

export default function ConfigCobrancaPage() {
  const [config, setConfig] = React.useState<ConfigDeCobranca | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erroCarga, setErroCarga] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);
  const [sujo, setSujo] = React.useState(false);
  const [contas, setContas] = React.useState<Array<{ id: string; nome: string }>>([]);
  const [agencia, setAgencia] = React.useState('');
  const textoRef = React.useRef<HTMLInputElement>(null);

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      const c = await api.config();
      setConfig(c);
      setSujo(false);
      setEstado('ok');
    } catch (e) {
      setErroCarga(e instanceof ErroDaCobranca ? mensagemDeErro(e.codigo, e.message, e.status) : 'Não foi possível carregar.');
      setEstado('erro');
    }
  }, []);

  React.useEffect(() => {
    void carregar();
    // Conta desativada some da escolha (06/11/2026).
    loadEntities<ContaBancaria & { ativo?: unknown }>('contas-bancarias').then(l => setContas(l.filter(contaBancariaAtiva).map(c => ({ id: c.id, nome: c.nome || 'Conta' })))).catch(() => setContas([]));
    fetch('/api/agencia').then(r => (r.ok ? r.json() : null)).then((a: { nome_fantasia?: string; razao_social?: string } | null) => setAgencia(a?.nome_fantasia || a?.razao_social || '')).catch(() => undefined);
  }, [carregar]);

  React.useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sujo]);

  const mudar = (patch: Partial<ConfigDeCobranca>) => { setConfig(c => (c ? { ...c, ...patch } : c)); setSujo(true); };
  const erros = config ? errosDaConfig(config) : {};
  const temErro = Object.keys(erros).length > 0;

  async function salvar() {
    if (!config || temErro) return;
    setSalvando(true);
    try {
      const { provedores: _p, encargos_da_politica: _e, ...gravavel } = config;
      void _p; void _e;
      const salvo = await api.salvarConfig({ ...gravavel, regua: { ...gravavel.regua, dias: normalizarDiasDaRegua(gravavel.regua.dias) } });
      setConfig(salvo);
      setSujo(false);
      toast.success('Configuração de cobrança salva.', 'Vale para as próximas cobranças; as já emitidas continuam como estão.');
    } catch (e) {
      toast.error('Não foi possível salvar.', e instanceof ErroDaCobranca ? mensagemDeErro(e.codigo, e.message, e.status) : '');
    } finally {
      setSalvando(false);
    }
  }

  function inserirVariavel(chave: string) {
    if (!config) return;
    const el = textoRef.current;
    const atual = config.descricao_modelo;
    const ini = el?.selectionStart ?? atual.length;
    const fim = el?.selectionEnd ?? atual.length;
    mudar({ descricao_modelo: `${atual.slice(0, ini)}${chave}${atual.slice(fim)}` });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(ini + chave.length, ini + chave.length); });
  }

  const provedor = config?.provedor_padrao ? PROVEDORES[config.provedor_padrao] : null;
  const nenhumConectado = config ? !config.provedores.some(p => p.conectado) : false;

  return (
    <div className="w-full px-[var(--fin-page-pad)] py-[var(--fin-s-5)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col gap-[var(--fin-s-5)]">
        <PageHeader
          icone={ReceiptText}
          titulo="Cobrança"
          subtitulo="Boleto e Pix pelo Asaas ou Pagar.me da própria agência: quem emite, juros e multa, lembretes ao cliente e o texto da cobrança."
        />
        <DataState
          estado={estado}
          erro={erroCarga ? { mensagem: erroCarga, onTentarDeNovo: () => { void carregar(); } } : null}
          esqueleto={<div className="h-64 max-w-3xl rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />}
        >
          {config ? (
            <div className="flex flex-col gap-[var(--fin-s-5)]">
              <section aria-labelledby="t-provedor" className={SECAO}>
                <div className="flex flex-col gap-[var(--fin-s-1)]">
                  <h2 id="t-provedor" className="fin-t-subhead text-[var(--fin-text)]">Quem emite</h2>
                  <p className="fin-t-caption text-[var(--fin-text-2)]">
                    O boleto e o Pix saem pela conta da agência no provedor e o dinheiro cai direto nela. Não há arquivo de remessa nem de retorno: o pagamento chega pelo aviso do provedor e baixa a conta sozinho.
                  </p>
                </div>
                {nenhumConectado ? (
                  <p className="rounded-[var(--fin-r-md)] bg-[var(--fin-warning-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-caption text-[var(--fin-warning-text)]">
                    Nenhum provedor conectado ainda. Cadastre a chave do Asaas ou do Pagar.me da agência em <Link href="/config/plataformas" className="underline underline-offset-2">Plataformas</Link> e volte aqui.
                  </p>
                ) : null}
                <div role="radiogroup" aria-label="Provedor padrão" className="grid grid-cols-1 gap-[var(--fin-s-3)] md:grid-cols-2">
                  {(['asaas', 'pagarme'] as ProvedorDeCobranca[]).map(id => (
                    <CartaoDoProvedor
                      key={id} id={id} config={config} escolhido={config.provedor_padrao === id}
                      onEscolher={() => mudar({ provedor_padrao: id, tipo_padrao: PROVEDORES[id].tipos.includes(config.tipo_padrao) ? config.tipo_padrao : PROVEDORES[id].tipos[0] })}
                    />
                  ))}
                </div>
                {provedor ? (
                  <div className="flex flex-col gap-[var(--fin-s-2)]">
                    <span className="fin-t-body-strong text-[var(--fin-text)]">Como o cliente paga, por padrão</span>
                    <Segmentado
                      rotulo="Como o cliente paga, por padrão"
                      valor={config.tipo_padrao}
                      onChange={v => mudar({ tipo_padrao: v as TipoDeCobranca })}
                      opcoes={provedor.tipos.map(t => ({ valor: t, rotulo: ROTULO_DO_TIPO[t] }))}
                    />
                    {erros.tipo_padrao ? <p role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">{erros.tipo_padrao}</p> : null}
                    <p className="fin-t-caption text-[var(--fin-text-3)]">Na hora de emitir dá para trocar, conta por conta.</p>
                  </div>
                ) : null}
                <Field rotulo="Conta bancária que recebe" ajuda="Onde o pagamento entra no financeiro. Sem escolha, vale a conta ligada à integração.">
                  {a => (
                    <select {...a} value={config.conta_bancaria_id} onChange={e => mudar({ conta_bancaria_id: e.target.value })} className={cn(SELECT, 'sm:max-w-sm')}>
                      <option value="">A conta da integração</option>
                      {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  )}
                </Field>
              </section>

              <section aria-labelledby="t-encargos" className={SECAO}>
                <div className="flex flex-col gap-[var(--fin-s-1)]">
                  <h2 id="t-encargos" className="fin-t-subhead text-[var(--fin-text)]">Juros, multa e desconto no boleto</h2>
                  <p className="fin-t-caption text-[var(--fin-text-2)]">
                    {config.encargos_da_politica
                      ? <>Por enquanto valem os números de <Link href="/config/financeiro" className="text-[var(--fin-accent)] underline-offset-2 hover:underline">Configurações › Financeiro</Link>. Mudar aqui vale só para o boleto.</>
                      : 'O provedor calcula sozinho depois do vencimento, e a 2ª via já sai com o valor atualizado.'}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
                  <Numero rotulo="Juros ao mês" ajuda="Proporcional por dia de atraso." unidade="%" valor={config.juros_am_pct} erro={erros.juros_am_pct} onChange={v => mudar({ juros_am_pct: v })} />
                  <Numero rotulo="Multa por atraso" ajuda="Cobrada uma vez." unidade="%" valor={config.multa_pct} erro={erros.multa_pct} onChange={v => mudar({ multa_pct: v })} />
                  <Numero rotulo="Desconto por pagar antes" unidade="%" valor={config.desconto_pct} erro={erros.desconto_pct} onChange={v => mudar({ desconto_pct: v })} />
                  <Numero rotulo="Pagando até" ajuda="Dias antes do vencimento." unidade="dias" inteiro valor={config.desconto_dias} erro={erros.desconto_dias} onChange={v => mudar({ desconto_dias: v })} />
                </div>
                <ReferenciaDeJuros valorAtual={config.juros_am_pct} onUsar={v => mudar({ juros_am_pct: v })} />
                {provedor ? (
                  <p className="rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-2)]">
                    <span className="font-medium">{provedor.nome}:</span> {provedor.encargos}
                  </p>
                ) : null}
              </section>

              <section aria-labelledby="t-regua" className={SECAO}>
                <div className="flex flex-col gap-[var(--fin-s-1)]">
                  <h2 id="t-regua" className="fin-t-subhead text-[var(--fin-text)]">Lembretes ao cliente (régua de cobrança)</h2>
                  <p className="fin-t-caption text-[var(--fin-text-2)]">
                    Os lembretes saem pelo CRM da agência: WhatsApp pelo modelo de mensagem aprovado e e-mail pelo envio do CRM. Um lembrete por cobrança em cada dia escolhido; cobrança paga para de receber.
                  </p>
                </div>
                <label className="flex items-start gap-2 fin-t-body text-[var(--fin-text)]">
                  <input
                    type="checkbox" checked={config.regua.ligada}
                    onChange={e => mudar({ regua: { ...config.regua, ligada: e.target.checked, dias: config.regua.dias.length ? config.regua.dias : [...DIAS_DA_REGUA_PADRAO] } })}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]"
                  />
                  <span>
                    Mandar lembretes
                    <span className="block fin-t-caption text-[var(--fin-text-3)]">Desligado, nada sai sozinho. Dá para enviar uma cobrança à mão em Cobranças.</span>
                  </span>
                </label>
                {config.regua.ligada ? (
                  <>
                    <fieldset className="flex flex-col gap-[var(--fin-s-2)]">
                      <legend className="pb-[var(--fin-s-2)] fin-t-body-strong text-[var(--fin-text)]">Quando</legend>
                      <div className="flex flex-wrap gap-[var(--fin-s-2)]">
                        {DIAS_OFERECIDOS.map(d => {
                          const marcado = config.regua.dias.includes(d);
                          return (
                            <label
                              key={d}
                              className={cn(
                                'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--fin-r-md)] border px-3 fin-t-body lg:min-h-9',
                                marcado ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)] text-[var(--fin-text)]' : 'border-[var(--fin-border)] text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]',
                              )}
                            >
                              <input
                                type="checkbox" checked={marcado} className="size-4 accent-[var(--fin-accent)]"
                                onChange={e => mudar({ regua: { ...config.regua, dias: normalizarDiasDaRegua(e.target.checked ? [...config.regua.dias, d] : config.regua.dias.filter(x => x !== d)) } })}
                              />
                              {rotuloDoDiaDaRegua(d)}
                            </label>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => mudar({ regua: { ...config.regua, dias: [...DIAS_DA_REGUA_PADRAO] } })}
                        className="self-start fin-t-caption text-[var(--fin-accent)] underline-offset-2 hover:underline"
                      >
                        Usar a sugestão: 5 dias antes, no dia, e 1, 3 e 7 dias depois
                      </button>
                    </fieldset>
                    <fieldset className="flex flex-col gap-[var(--fin-s-2)]">
                      <legend className="pb-[var(--fin-s-2)] fin-t-body-strong text-[var(--fin-text)]">Por onde</legend>
                      <label className="flex items-center gap-2 fin-t-body text-[var(--fin-text)]">
                        <input type="checkbox" checked={config.regua.canais.whatsapp} onChange={e => mudar({ regua: { ...config.regua, canais: { ...config.regua.canais, whatsapp: e.target.checked } } })} className="size-4 accent-[var(--fin-accent)]" />
                        WhatsApp
                      </label>
                      <label className="flex items-center gap-2 fin-t-body text-[var(--fin-text)]">
                        <input type="checkbox" checked={config.regua.canais.email} onChange={e => mudar({ regua: { ...config.regua, canais: { ...config.regua.canais, email: e.target.checked } } })} className="size-4 accent-[var(--fin-accent)]" />
                        E-mail
                      </label>
                      {!config.regua.canais.whatsapp && !config.regua.canais.email ? (
                        <p role="alert" className="fin-t-caption text-[var(--fin-warning-text)]">Sem canal escolhido, nenhum lembrete sai.</p>
                      ) : null}
                    </fieldset>
                  </>
                ) : null}
              </section>

              <section aria-labelledby="t-texto" className={SECAO}>
                <div className="flex flex-col gap-[var(--fin-s-1)]">
                  <h2 id="t-texto" className="fin-t-subhead text-[var(--fin-text)]">Texto da cobrança</h2>
                  <p className="fin-t-caption text-[var(--fin-text-2)]">O que o cliente lê no boleto, no Pix e no extrato do banco.</p>
                </div>
                <Field rotulo="Descrição" ajuda="Toque num campo abaixo para incluir. Até 200 letras." erro={erros.descricao_modelo}>
                  {a => (
                    <Input
                      {...a} ref={textoRef} value={config.descricao_modelo} maxLength={200}
                      onChange={e => mudar({ descricao_modelo: e.target.value })} placeholder="Ex.: Viagem {descricao}" className={CONTROLE}
                    />
                  )}
                </Field>
                <div className="flex flex-wrap gap-[var(--fin-s-2)]">
                  {VARIAVEIS.map(v => (
                    <Button key={v.chave} type="button" variant="outline" size="sm" className="h-11 lg:h-8" onClick={() => inserirVariavel(v.chave)}>
                      + {v.rotulo}
                    </Button>
                  ))}
                </div>
                <p className="rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-2)]">
                  O cliente vai ler: <span className="font-medium text-[var(--fin-text)]">{descricaoDeExemplo(config.descricao_modelo, agencia)}</span>
                </p>
              </section>

              <div className="sticky bottom-0 z-[var(--fin-z-conteudo)] flex max-w-3xl flex-col gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] bg-[var(--fin-bg)] py-[var(--fin-s-3)] sm:flex-row sm:items-center sm:justify-between">
                <p className="fin-t-caption text-[var(--fin-text-3)]" aria-live="polite">
                  {temErro ? 'Corrija os campos marcados para salvar.' : sujo ? 'Há alterações não salvas.' : 'Tudo salvo.'}
                </p>
                <div className="flex gap-[var(--fin-s-2)]">
                  {sujo ? <Button type="button" variant="ghost" onClick={() => { void carregar(); }} disabled={salvando}>Desfazer</Button> : null}
                  <Button type="button" onClick={() => { void salvar(); }} disabled={salvando || !sujo || temErro}>
                    {salvando ? 'Salvando…' : 'Salvar'}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DataState>
      </div>
    </div>
  );
}

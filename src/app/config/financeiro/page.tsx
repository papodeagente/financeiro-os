'use client';

import { useEffect, useState } from 'react';
import { Percent } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataState } from '@/components/fin/DataState';
import { Field } from '@/components/fin/Field';
import { Money } from '@/components/fin/Money';
import { PageHeader } from '@/components/fin/PageHeader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { calcularEncargos, type PoliticaCobranca } from '@/lib/baixa-calculo';
import { AVISOS_PADRAO, type PreferenciaAvisos } from '@/lib/avisos-vencimento';
import { loadEntities } from '@/lib/crm-storage';
import type { PlanoContas } from '@/lib/crm-types';
import {
  CATEGORIAS_PADRAO_ENCARGOS, CHAVES_ENCARGO, type CategoriasEncargos, type ChaveEncargo,
} from '@/lib/encargos-categorias';
import { addDias, hojeISO, num } from '@/lib/money';
import { toast } from '@/lib/toast';
import { SecaoContaPrevisao } from './SecaoContaPrevisao';
import { SecaoCamposPersonalizados } from './SecaoCamposPersonalizados';
import { SecaoCategoriasDosTitulos } from './SecaoCategoriasDosTitulos';
import { EmpresaDaConfiguracao, empresaEmEdicao, naEmpresa } from '@/components/fin/EmpresaDaConfiguracao';
import { AssistenteInicial } from '@/components/fin/AssistenteInicial';

const CONTROLE = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body tabular-nums lg:h-10';
const VAZIA: PoliticaCobranca = { juros_am_pct: 0, multa_pct: 0, tolerancia_dias: 0, desconto_antecipacao: null, aplicar_em_pagar: false };
const SECAO = 'flex max-w-3xl flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)]';
const SEM_CATEGORIA = '__sem_categoria__';

const ROTULO_ENCARGO: Record<ChaveEncargo, string> = {
  receita_financeira: 'Juros e multa recebidos, desconto obtido',
  despesa_financeira: 'Juros e multa pagos',
  descontos_concedidos: 'Desconto dado ao cliente',
  taxas: 'Taxa de cartão, boleto ou plataforma',
};

const AVISOS: { chave: keyof PreferenciaAvisos; rotulo: string; ajuda: string }[] = [
  { chave: 'pagar_hoje', rotulo: 'Contas a pagar que vencem hoje', ajuda: 'Um aviso de manhã com o total e as contas do dia.' },
  { chave: 'pagar_amanha', rotulo: 'Contas a pagar que vencem amanhã', ajuda: 'Para separar o dinheiro com um dia de folga.' },
  { chave: 'receber_atrasadas', rotulo: 'Contas a receber em atraso', ajuda: 'Quantas são, quanto somam e há quanto tempo a mais antiga venceu.' },
];

function Numero({ rotulo, ajuda, valor, onChange, unidade, max }: {
  rotulo: string; ajuda?: string; valor: number; onChange: (v: number) => void; unidade: string; max: number;
}) {
  return (
    <Field rotulo={rotulo} ajuda={ajuda}>
      {a => (
        <div className="relative">
          <Input
            {...a}
            type="number"
            inputMode="decimal"
            min={0}
            max={max}
            step="0.01"
            value={Number.isFinite(valor) ? String(valor) : ''}
            onChange={e => onChange(num(e.target.value.replace(',', '.')))}
            className={`${CONTROLE} pr-12`}
          />
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-[var(--fin-s-3)] flex items-center fin-t-body text-[var(--fin-text-2)]">
            {unidade}
          </span>
        </div>
      )}
    </Field>
  );
}

/**
 * Configurações › Financeiro (05/11/2026). Juros, multa, tolerância e
 * desconto por antecipação que a liquidação SUGERE. Na hora de liquidar a
 * pessoa sempre pode mudar o valor.
 */
export default function ConfigFinanceiroPage() {
  const [p, setP] = useState<PoliticaCobranca>(VAZIA);
  // Assistente inicial (E7, frente D): depois de ligar, as seções releem.
  const [versaoDasCategorias, setVersaoDasCategorias] = useState(0);
  const [naPrincipal, setNaPrincipal] = useState(true);
  useEffect(() => { const e = empresaEmEdicao(); setNaPrincipal(!e || e === 'principal'); }, []);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [categorias, setCategorias] = useState<CategoriasEncargos>({});
  const [plano, setPlano] = useState<PlanoContas[]>([]);
  const [salvandoCategorias, setSalvandoCategorias] = useState(false);
  const [criandoPadrao, setCriandoPadrao] = useState(false);
  const [avisos, setAvisos] = useState<PreferenciaAvisos>(AVISOS_PADRAO);
  const [salvandoAvisos, setSalvandoAvisos] = useState(false);

  async function load() {
    try {
      const r = await fetch(naEmpresa('/api/config/financeiro'));
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `Erro ${r.status}`);
      const c = (await r.json()) as {
        politica_cobranca: PoliticaCobranca | null;
        categorias_encargos?: CategoriasEncargos;
        avisos_vencimento?: PreferenciaAvisos;
      };
      setP({ ...VAZIA, ...(c.politica_cobranca ?? {}) });
      setCategorias(c.categorias_encargos ?? {});
      setAvisos({ ...AVISOS_PADRAO, ...(c.avisos_vencimento ?? {}) });
      setPlano(await loadEntities<PlanoContas>('plano-contas').catch(() => []));
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar.');
      setEstado('erro');
    }
  }
  useEffect(() => { void load(); }, []);

  async function salvar() {
    setSalvando(true);
    try {
      const r = await fetch(naEmpresa('/api/config/financeiro'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ politica_cobranca: p }),
      });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string; politica_cobranca?: PoliticaCobranca };
      if (!r.ok) throw new Error(corpo.error || `Erro ${r.status}`);
      if (corpo.politica_cobranca) setP({ ...VAZIA, ...corpo.politica_cobranca });
      toast.success('Política de juros, multa e desconto salva.');
    } catch (e) {
      toast.error('Não foi possível salvar.', e instanceof Error ? e.message : '');
    } finally {
      setSalvando(false);
    }
  }

  async function enviar(corpo: Record<string, unknown>): Promise<Record<string, unknown>> {
    const r = await fetch(naEmpresa('/api/config/financeiro'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const resposta = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    if (!r.ok) throw new Error(resposta.error || `Erro ${r.status}`);
    return resposta;
  }

  async function salvarCategorias() {
    setSalvandoCategorias(true);
    try {
      const r = await enviar({ categorias_encargos: categorias });
      setCategorias((r.categorias_encargos as CategoriasEncargos) ?? categorias);
      toast.success('Categorias dos encargos salvas.', 'O resultado de todos os meses já usa a escolha nova.');
    } catch (e) {
      toast.error('Não foi possível salvar.', e instanceof Error ? e.message : '');
    } finally {
      setSalvandoCategorias(false);
    }
  }

  async function criarPadrao() {
    setCriandoPadrao(true);
    try {
      const r = await fetch('/api/config/financeiro/categorias-padrao', { method: 'POST' });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string; categorias_encargos?: CategoriasEncargos };
      if (!r.ok) throw new Error(corpo.error || `Erro ${r.status}`);
      setCategorias(corpo.categorias_encargos ?? {});
      setPlano(await loadEntities<PlanoContas>('plano-contas').catch(() => plano));
      toast.success('Categorias criadas no plano de contas.');
    } catch (e) {
      toast.error('Não foi possível criar as categorias.', e instanceof Error ? e.message : '');
    } finally {
      setCriandoPadrao(false);
    }
  }

  async function salvarAvisos() {
    setSalvandoAvisos(true);
    try {
      const r = await enviar({ avisos_vencimento: avisos });
      setAvisos({ ...AVISOS_PADRAO, ...((r.avisos_vencimento as PreferenciaAvisos) ?? avisos) });
      toast.success('Avisos de vencimento salvos.', 'Chegam no sino a partir da próxima manhã.');
    } catch (e) {
      toast.error('Não foi possível salvar.', e instanceof Error ? e.message : '');
    } finally {
      setSalvandoAvisos(false);
    }
  }

  const faltaCategoria = CHAVES_ENCARGO.some(k => !categorias[k] || !plano.some(c => c.id === categorias[k]));
  const opcoesDoTipo = (tipo: 'RECEITA' | 'DESPESA') => plano
    .filter(c => c.tipo === tipo && c.ativo !== false)
    .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), undefined, { numeric: true }));
  const nomeDaCategoria = (k: ChaveEncargo) => {
    const c = plano.find(x => x.id === categorias[k]);
    return c ? `${c.codigo} · ${c.nome}` : `Padrão: ${CATEGORIAS_PADRAO_ENCARGOS[k].nome}`;
  };

  const d = p.desconto_antecipacao ?? { pct: 0, dias: 0 };
  const hoje = hojeISO();
  const exemploAtraso = calcularEncargos(
    { tabela: 'contas_receber', status: 'PENDENTE', valor_final: 1000, valor_baixado: 0, data_vencimento: addDias(hoje, -10) }, hoje, p,
  );
  const exemploAntes = calcularEncargos(
    { tabela: 'contas_receber', status: 'PENDENTE', valor_final: 1000, valor_baixado: 0, data_vencimento: addDias(hoje, Math.max(1, num(d.dias))) }, hoje, p,
  );

  return (
    <div className="w-full px-[var(--fin-page-pad)] py-[var(--fin-s-5)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col gap-[var(--fin-s-5)]">
        <PageHeader
          icone={Percent}
          titulo="Financeiro"
          subtitulo="Juros, multa e desconto que a liquidação sugere, onde eles entram no resultado e os avisos de vencimento."
        />
        {/* Várias empresas (E7): de qual empresa é esta configuração. */}
        <EmpresaDaConfiguracao secao="financeiro" />
        <DataState
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void load(); } } : null}
          esqueleto={<div className="h-64 rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />}
        >
          <section
            aria-labelledby="t-encargos"
            className="flex max-w-3xl flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)]"
          >
            <h2 id="t-encargos" className="fin-t-subhead text-[var(--fin-text)]">Juros, multa e desconto</h2>
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
              <Numero rotulo="Juros ao mês" ajuda="Proporcional por dia de atraso." unidade="%" max={20}
                valor={num(p.juros_am_pct)} onChange={v => setP(x => ({ ...x, juros_am_pct: v }))} />
              <Numero rotulo="Multa por atraso" ajuda="Cobrada uma vez." unidade="%" max={20}
                valor={num(p.multa_pct)} onChange={v => setP(x => ({ ...x, multa_pct: v }))} />
              <Numero rotulo="Tolerância" ajuda="Dias sem cobrar depois do vencimento." unidade="dias" max={60}
                valor={num(p.tolerancia_dias)} onChange={v => setP(x => ({ ...x, tolerancia_dias: Math.round(v) }))} />
            </div>
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
              <Numero rotulo="Desconto por pagar antes" unidade="%" max={50}
                valor={num(d.pct)} onChange={v => setP(x => ({ ...x, desconto_antecipacao: { pct: v, dias: num(x.desconto_antecipacao?.dias) || 5 } }))} />
              <Numero rotulo="Pagando até" ajuda="Dias antes do vencimento." unidade="dias" max={60}
                valor={num(d.dias)} onChange={v => setP(x => ({ ...x, desconto_antecipacao: { pct: num(x.desconto_antecipacao?.pct), dias: Math.round(v) } }))} />
            </div>
            <label className="flex items-start gap-2 fin-t-body text-[var(--fin-text)]">
              <input
                type="checkbox"
                checked={Boolean(p.aplicar_em_pagar)}
                onChange={e => setP(x => ({ ...x, aplicar_em_pagar: e.target.checked }))}
                className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]"
              />
              <span>
                Sugerir também nas contas a pagar
                <span className="block fin-t-caption text-[var(--fin-text-3)]">Útil quando o fornecedor cobra juros pelo atraso.</span>
              </span>
            </label>
            <div className="flex flex-col gap-1 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-2)]">
              <span>
                Exemplo: uma conta de R$ 1.000,00 paga 10 dias depois do vencimento sugere juros de{' '}
                <Money valor={exemploAtraso.juros} size="caption" align="esquerda" className="inline-block min-w-0" estado="ok" /> e multa de{' '}
                <Money valor={exemploAtraso.multa} size="caption" align="esquerda" className="inline-block min-w-0" estado="ok" />.
              </span>
              {num(d.pct) > 0 ? (
                <span>
                  Paga {num(d.dias)} dias antes, sugere desconto de{' '}
                  <Money valor={exemploAntes.desconto_antecipacao} size="caption" align="esquerda" className="inline-block min-w-0" estado="ok" />.
                </span>
              ) : null}
            </div>
            <div>
              <Button type="button" onClick={() => { void salvar(); }} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </section>

          <div className="flex flex-col gap-[var(--fin-s-5)] pt-[var(--fin-s-5)]">
            <section aria-labelledby="t-categorias-encargos" className={SECAO}>
              <div className="flex flex-col gap-[var(--fin-s-1)]">
                <h2 id="t-categorias-encargos" className="fin-t-subhead text-[var(--fin-text)]">Onde os encargos entram no resultado</h2>
                <p className="fin-t-caption text-[var(--fin-text-2)]">
                  Juros, multa, desconto e taxa registrados ao liquidar aparecem no resultado do mês em linhas próprias, com o nome da categoria escolhida aqui.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
                {CHAVES_ENCARGO.map(k => {
                  const opcoes = opcoesDoTipo(CATEGORIAS_PADRAO_ENCARGOS[k].tipo);
                  return (
                    <Field key={k} rotulo={ROTULO_ENCARGO[k]} ajuda={CATEGORIAS_PADRAO_ENCARGOS[k].explica}>
                      {a => (
                        <Select
                          value={categorias[k] && opcoes.some(c => c.id === categorias[k]) ? categorias[k] : SEM_CATEGORIA}
                          onValueChange={v => setCategorias(x => ({ ...x, [k]: !v || v === SEM_CATEGORIA ? undefined : String(v) }))}
                        >
                          <SelectTrigger id={a.id} aria-describedby={a['aria-describedby']} className={`${CONTROLE} w-full`}>
                            <SelectValue>{() => nomeDaCategoria(k)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SEM_CATEGORIA} className="fin-t-body">Padrão: {CATEGORIAS_PADRAO_ENCARGOS[k].nome}</SelectItem>
                            {opcoes.map(c => (
                              <SelectItem key={c.id} value={c.id} className="fin-t-body">{c.codigo} · {c.nome}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </Field>
                  );
                })}
              </div>
              {faltaCategoria ? (
                <p className="rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-2)]">
                  As categorias padrão entram no plano de contas sozinhas na primeira liquidação com juros, multa, desconto ou taxa. Se preferir, crie agora.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-[var(--fin-s-2)]">
                <Button type="button" onClick={() => { void salvarCategorias(); }} disabled={salvandoCategorias}>
                  {salvandoCategorias ? 'Salvando…' : 'Salvar categorias'}
                </Button>
                {faltaCategoria ? (
                  <Button type="button" variant="outline" onClick={() => { void criarPadrao(); }} disabled={criandoPadrao}>
                    {criandoPadrao ? 'Criando…' : 'Criar as categorias padrão'}
                  </Button>
                ) : null}
              </div>
            </section>

            <section aria-labelledby="t-avisos" className={SECAO}>
              <div className="flex flex-col gap-[var(--fin-s-1)]">
                <h2 id="t-avisos" className="fin-t-subhead text-[var(--fin-text)]">Avisos de vencimento no sino</h2>
                <p className="fin-t-caption text-[var(--fin-text-2)]">
                  Uma vez por dia, de manhã, para quem cuida do financeiro. Um aviso por assunto, nunca um por conta.
                </p>
              </div>
              <div className="flex flex-col gap-[var(--fin-s-3)]">
                {AVISOS.map(a => (
                  <label key={a.chave} className="flex items-start gap-2 fin-t-body text-[var(--fin-text)]">
                    <input
                      type="checkbox"
                      checked={avisos[a.chave]}
                      onChange={e => setAvisos(x => ({ ...x, [a.chave]: e.target.checked }))}
                      className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]"
                    />
                    <span>
                      {a.rotulo}
                      <span className="block fin-t-caption text-[var(--fin-text-3)]">{a.ajuda}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div>
                <Button type="button" onClick={() => { void salvarAvisos(); }} disabled={salvandoAvisos}>
                  {salvandoAvisos ? 'Salvando…' : 'Salvar avisos'}
                </Button>
              </div>
            </section>

            <SecaoContaPrevisao />
            {naPrincipal ? <AssistenteInicial onAplicado={() => setVersaoDasCategorias(v => v + 1)} /> : null}
            <SecaoCategoriasDosTitulos key={versaoDasCategorias} />
            <SecaoCamposPersonalizados />
          </div>
        </DataState>
      </div>
    </div>
  );
}

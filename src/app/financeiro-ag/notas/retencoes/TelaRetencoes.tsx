'use client';

import * as React from 'react';
import { Landmark, Pencil, Plus, Trash2 } from 'lucide-react';

import { ClientePicker } from '@/components/ClientePicker';
import { Callout } from '@/components/fin/Callout';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Segmentado } from '@/components/fin/Segmentado';
import { usePermissoes } from '@/app/financeiro-ag/contas/useContas';
import { apiNotas, formatarPercentual } from '@/components/financeiro/notas/api';
import { CAMPO_TEXTO, CampoSelecao, Interruptor } from '@/components/financeiro/notas/pecas';
import {
  AMBITOS, BASES_DE_RETENCAO, ROTULO_AMBITO, ROTULO_BASE_DE_RETENCAO, TRIBUTOS_RETIDOS, aliquotasPorBaseZeradas, totalDasAliquotas,
  type Ambito, type AliquotasPorBase, type BaseDeRetencao, type RetencaoDoCliente, type TributoRetido,
} from '@/lib/nota-retencoes';
import { ROTULO_TIPO_PRODUTO, TIPOS_PRODUTO } from '@/lib/venda-modelo';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * Retenções na fonte (Lei 9.430), por cliente × produto (E5, parte E).
 *
 * Órgão público e algumas empresas pagam a agência já retendo IR, CSLL, PIS
 * e COFINS. Aqui a agência diz quanto cada cliente retém, sobre quais bases,
 * no nacional e no internacional. Com isso a conta a receber sai líquida, e a
 * nota e a fatura mostram o que foi retido. Os percentuais vêm do contrato
 * com o cliente ou do contador: nada vem preenchido.
 */

const TODOS = '__todos__';

function nova(): RetencaoDoCliente {
  return {
    id: '', cliente: { id: '', nome: '' }, tipo_produto: null, reter_iss: false,
    nacional: aliquotasPorBaseZeradas(), internacional: aliquotasPorBaseZeradas(), observacao: '',
  };
}

/** "IR 1,5% · CSLL 1% sobre Taxa DU e RAV" para a lista. */
function resumoDoAmbito(a: AliquotasPorBase): string {
  const partes = BASES_DE_RETENCAO.flatMap(b => {
    const t = TRIBUTOS_RETIDOS.filter(x => a[b][x] > 0).map(x => `${x} ${formatarPercentual(a[b][x])}`);
    return t.length ? [`${t.join(' · ')} sobre ${ROTULO_BASE_DE_RETENCAO[b].toLowerCase()}`] : [];
  });
  return partes.length ? partes.join('; ') : 'Não retém';
}

export function TelaRetencoes() {
  const pode = usePermissoes();
  const podeConfigurar = pode('configurar_notas');
  const [lista, setLista] = React.useState<RetencaoDoCliente[] | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  const [editando, setEditando] = React.useState<RetencaoDoCliente | null>(null);
  const [ambito, setAmbito] = React.useState<Ambito>('NACIONAL');
  const [sujo, setSujo] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [apagar, setApagar] = React.useState<RetencaoDoCliente | null>(null);
  const [apagando, setApagando] = React.useState(false);

  const carregar = React.useCallback(async () => {
    try {
      const r = await apiNotas.retencoes();
      setLista(r.retencoes);
      setErro(null);
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir as retenções.');
    }
  }, []);
  React.useEffect(() => { void carregar(); }, [carregar]);

  function abrir(r: RetencaoDoCliente) {
    setEditando(JSON.parse(JSON.stringify(r)) as RetencaoDoCliente);
    setAmbito('NACIONAL');
    setSujo(false);
  }
  function mudar(p: Partial<RetencaoDoCliente>) { setEditando(a => (a ? { ...a, ...p } : a)); setSujo(true); }
  function mudarAliquota(b: BaseDeRetencao, t: TributoRetido, v: number) {
    setEditando(a => {
      if (!a) return a;
      const chave = ambito === 'NACIONAL' ? 'nacional' : 'internacional';
      return { ...a, [chave]: { ...a[chave], [b]: { ...a[chave][b], [t]: v } } };
    });
    setSujo(true);
  }

  async function salvar() {
    if (!editando) return;
    if (!editando.cliente.id) { toast.error('Escolha o cliente que retém.'); return; }
    setSalvando(true);
    try {
      await apiNotas.salvarRetencao(editando);
      toast.success('Retenção salva', 'As próximas vendas deste cliente já saem com a conta a receber líquida.');
      setEditando(null);
      setSujo(false);
      await carregar();
    } catch (e) {
      toast.error('A retenção não foi salva', e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarApagar() {
    if (!apagar) return;
    setApagando(true);
    try {
      await apiNotas.apagarRetencao(apagar.id);
      toast.success('Retenção apagada', 'As contas e notas já geradas não mudam.');
      setApagar(null);
      await carregar();
    } catch (e) {
      toast.error('A retenção não foi apagada', e instanceof Error ? e.message : undefined);
    } finally {
      setApagando(false);
    }
  }

  const colunas: FinColuna<RetencaoDoCliente>[] = [
    {
      id: 'cliente', cabecalho: 'Cliente', tipo: 'texto', sortable: true, minWidth: 200, acessor: r => r.cliente.nome.toLowerCase(),
      render: r => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate fin-t-body-strong text-[var(--fin-text)]">{r.cliente.nome || 'Cliente'}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{r.tipo_produto ? ROTULO_TIPO_PRODUTO[r.tipo_produto] : 'Todos os produtos'}{r.reter_iss ? ' · retém ISS' : ''}</span>
        </span>
      ),
    },
    { id: 'nacional', cabecalho: 'Nacional', tipo: 'texto', minWidth: 240, render: r => <span className="fin-t-body text-[var(--fin-text-2)]">{resumoDoAmbito(r.nacional)}</span> },
    { id: 'internacional', cabecalho: 'Internacional', tipo: 'texto', minWidth: 240, prioridade: 2, render: r => <span className="fin-t-body text-[var(--fin-text-2)]">{resumoDoAmbito(r.internacional)}</span> },
    {
      id: 'acoes', cabecalho: '', tipo: 'acoes',
      render: r => podeConfigurar ? (
        <span className="inline-flex items-center justify-end gap-1">
          <BotaoIcone rotulo={`Editar a retenção de ${r.cliente.nome}`} onClick={() => abrir(r)}><Pencil className="size-4" aria-hidden="true" /></BotaoIcone>
          <BotaoIcone rotulo={`Apagar a retenção de ${r.cliente.nome}`} onClick={() => setApagar(r)} perigo><Trash2 className="size-4" aria-hidden="true" /></BotaoIcone>
        </span>
      ) : null,
    },
  ];

  const tabela = editando ? (ambito === 'NACIONAL' ? editando.nacional : editando.internacional) : null;

  return (
    <MolduraDaPagina>
      <div className="flex flex-col gap-[var(--fin-s-5)]">
        <PageHeader
          icone={Landmark}
          titulo="Retenções na fonte (Lei 9.430)"
          subtitulo="Clientes que pagam já retendo IR, CSLL, PIS e COFINS. A conta a receber sai líquida, e a nota e a fatura mostram o que foi retido."
          atualizadoEm={atualizadoEm}
          onRecarregar={carregar}
          acaoPrimaria={podeConfigurar ? { rotulo: 'Nova retenção', icone: Plus, onClick: () => abrir(nova()) } : undefined}
          acoesSecundarias={[
            { rotulo: 'Gerar notas', href: '/financeiro-ag/notas/gerar' },
            { rotulo: 'Regras da nota', href: '/financeiro-ag/notas/regras' },
          ]}
        />

        <Callout tom="info" titulo="Antes de mexer numa nota com retenção">
          Retenção pequena que não se retém (o limite) fica em Regras da nota › Data e tributos da nota. Se uma nota com retenção for cancelada, o tributo que o cliente já recolheu não volta sozinho: combine com o cliente como acertar e confirme com o contador como recuperar ou compensar.
        </Callout>

        <FinTable<RetencaoDoCliente>
          linhas={lista ?? []}
          colunas={colunas}
          chave={r => r.id}
          estado={!lista && !erro ? 'carregando' : !lista && erro ? 'erro' : 'ok'}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
          vazio={{
            motivo: 'sem-dado', titulo: 'Nenhum cliente retém tributos',
            oQueE: 'Órgão público e algumas empresas pagam a agência já descontando IR, CSLL, PIS e COFINS. Cadastre aqui quanto cada um retém.',
            comoComeca: [
              'Escolha o cliente e o tipo de produto (ou todos).',
              'Informe os percentuais do contrato sobre cada base, no nacional e no internacional.',
              'As próximas vendas dele já saem com a conta a receber líquida e a retenção na nota.',
            ],
            acao: podeConfigurar ? { rotulo: 'Cadastrar a primeira', onClick: () => abrir(nova()) } : undefined,
          }}
          onLinhaDuploClique={podeConfigurar ? abrir : undefined}
        />
      </div>

      <RecordSheet
        aberto={Boolean(editando)}
        onOpenChange={a => { if (!a) { setEditando(null); setSujo(false); } }}
        titulo={editando?.id ? 'Editar retenção na fonte' : 'Nova retenção na fonte'}
        descricao="Vale para as vendas gravadas daqui em diante. Contas e notas já geradas não mudam."
        largura={960}
        sujo={sujo}
        acaoPrimaria={{ rotulo: 'Salvar retenção', onClick: salvar, carregando: salvando }}
        acaoSecundaria={{ rotulo: 'Cancelar', onClick: () => { setEditando(null); setSujo(false); } }}
      >
        {editando && tabela ? (
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] md:grid-cols-2">
              <div className="flex flex-col gap-[var(--fin-s-1)]">
                <span className="fin-t-body-strong text-[var(--fin-text)]">Cliente que retém</span>
                <ClientePicker
                  value={editando.cliente.id}
                  nome={editando.cliente.nome}
                  onChange={c => mudar({ cliente: c && c.id ? { id: c.id, nome: c.nome, ...(c.documento ? { documento: c.documento } : {}) } : { id: '', nome: '' } })}
                />
              </div>
              <CampoSelecao
                id="ret-tipo" rotulo="Produto"
                valor={editando.tipo_produto ?? TODOS}
                onChange={v => mudar({ tipo_produto: v === TODOS ? null : v as RetencaoDoCliente['tipo_produto'] })}
                opcoes={[{ valor: TODOS, rotulo: 'Todos os produtos' }, ...TIPOS_PRODUTO.map(t => ({ valor: t, rotulo: ROTULO_TIPO_PRODUTO[t] }))]}
                ajuda="A retenção de um produto vence a de todos os produtos do mesmo cliente."
              />
            </div>

            <Interruptor
              id="ret-iss" ligado={editando.reter_iss} onChange={v => mudar({ reter_iss: v })}
              rotulo="O cliente também retém o ISS"
              descricao="A nota sai com o ISS retido pelo tomador, e o líquido desconta o imposto."
            />

            <div className="flex flex-col gap-[var(--fin-s-3)]">
              <div className="flex flex-wrap items-center justify-between gap-[var(--fin-s-3)]">
                <h3 className="fin-t-subhead text-[var(--fin-text)]">Percentuais</h3>
                <Segmentado
                  rotulo="Âmbito do produto"
                  valor={ambito}
                  onChange={setAmbito}
                  opcoes={AMBITOS.map(a => ({ valor: a, rotulo: ROTULO_AMBITO[a] }))}
                />
              </div>
              <div className="overflow-x-auto rounded-[var(--fin-r-lg)] border border-[var(--fin-border)]">
                <table className="w-full min-w-[620px] border-collapse">
                  <caption className="sr-only">Percentuais retidos, {ROTULO_AMBITO[ambito].toLowerCase()}, por base e tributo</caption>
                  <thead>
                    <tr className="bg-[var(--fin-surface-2)]">
                      <th scope="col" className="px-3 py-2 text-left fin-t-overline text-[var(--fin-text-3)]">Sobre</th>
                      {TRIBUTOS_RETIDOS.map(t => <th key={t} scope="col" className="px-3 py-2 text-right fin-t-overline text-[var(--fin-text-3)]">{t} %</th>)}
                      <th scope="col" className="px-3 py-2 text-right fin-t-overline text-[var(--fin-text-3)]">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {BASES_DE_RETENCAO.map(b => (
                      <tr key={b} className="border-t border-[var(--fin-border)]">
                        <th scope="row" className="px-3 py-2 text-left fin-t-body font-medium text-[var(--fin-text)]">{ROTULO_BASE_DE_RETENCAO[b]}</th>
                        {TRIBUTOS_RETIDOS.map(t => (
                          <td key={t} className="px-2 py-1.5">
                            <CampoPercentual
                              rotulo={`${t} sobre ${ROTULO_BASE_DE_RETENCAO[b].toLowerCase()}, ${ROTULO_AMBITO[ambito].toLowerCase()}`}
                              valor={tabela[b][t]}
                              onChange={v => mudarAliquota(b, t, v)}
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right fin-t-body tabular-nums text-[var(--fin-text-2)]">{formatarPercentual(totalDasAliquotas(tabela[b]))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                Valor do produto = tarifa + markup − desconto. A nota ao cliente declara só a retenção das bases que ela cobra (Fee, Taxa DU e RAV); a conta a receber desconta todas.
                Produto em moeda estrangeira, ou marcado como internacional na venda, usa a coluna internacional.
              </p>
            </div>

            <label className="flex flex-col gap-[var(--fin-s-1)]">
              <span className="fin-t-body-strong text-[var(--fin-text)]">Observação</span>
              <input className={CAMPO_TEXTO} value={editando.observacao} maxLength={500} placeholder="Ex.: contrato 12/2026, empenho 345." onChange={e => mudar({ observacao: e.target.value })} />
            </label>

            <Callout tom="info">Os percentuais vêm do contrato com o cliente ou do contador. Nada vem preenchido de propósito.</Callout>
          </div>
        ) : null}
      </RecordSheet>

      <ConfirmDialog
        aberto={Boolean(apagar)}
        onOpenChange={a => { if (!a) setApagar(null); }}
        titulo="Apagar a retenção"
        oQueVaiAcontecer="As próximas vendas deste cliente saem sem retenção (ou com a de todos os produtos, se houver). Contas e notas já geradas não mudam."
        detalhes={apagar ? [{ rotulo: 'Cliente', valor: apagar.cliente.nome }, { rotulo: 'Produto', valor: apagar.tipo_produto ? ROTULO_TIPO_PRODUTO[apagar.tipo_produto] : 'Todos os produtos' }] : []}
        confirmarRotulo="Apagar a retenção"
        voltarRotulo="Manter"
        tone="destrutivo"
        processando={apagando}
        onConfirmar={confirmarApagar}
      />
    </MolduraDaPagina>
  );
}

function CampoPercentual({ rotulo, valor, onChange }: { rotulo: string; valor: number; onChange: (v: number) => void }) {
  const [texto, setTexto] = React.useState(valor ? String(valor).replace('.', ',') : '');
  React.useEffect(() => { setTexto(valor ? String(valor).replace('.', ',') : ''); }, [valor]);
  const n = Number(texto.replace(',', '.'));
  const invalido = texto.trim() !== '' && (!Number.isFinite(n) || n < 0 || n > 100);
  return (
    <input
      aria-label={rotulo}
      aria-invalid={invalido || undefined}
      inputMode="decimal"
      value={texto}
      placeholder="0"
      onChange={e => setTexto(e.target.value)}
      onBlur={() => { if (!invalido) onChange(texto.trim() === '' ? 0 : Math.round(n * 10000) / 10000); }}
      className={cn(CAMPO_TEXTO, 'h-9 text-right tabular-nums lg:h-9', invalido && 'border-[var(--fin-negative)]')}
    />
  );
}

function BotaoIcone({ rotulo, onClick, perigo, children }: { rotulo: string; onClick: () => void; perigo?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] max-lg:size-11',
        perigo ? 'hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)]' : 'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
      )}
    >
      {children}
    </button>
  );
}

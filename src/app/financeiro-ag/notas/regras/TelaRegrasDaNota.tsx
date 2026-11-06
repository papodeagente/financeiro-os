'use client';

import * as React from 'react';
import { FileCog, Pencil, Plus, Trash2 } from 'lucide-react';

import { ClientePicker } from '@/components/ClientePicker';
import { FornecedorPicker } from '@/components/FornecedorPicker';
import { Callout } from '@/components/fin/Callout';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { usePermissoes } from '@/app/financeiro-ag/contas/useContas';
import { apiNotas, type ConfigNotas } from '@/components/financeiro/notas/api';
import { CAMPO_TEXTO, CampoSelecao, Interruptor, Pilula, SECAO } from '@/components/financeiro/notas/pecas';
import {
  AJUDA_DESTINO, CAMPOS_DA_REGRA, DESTINOS_DA_NOTA, GATILHOS_DA_NOTA, ROTULO_DESTINO, ROTULO_GATILHO, ajudaDoCampo, descricaoAutomatica,
  rotuloDoCampo, type CampoDaRegra, type DestinoDaNota, type DestinoDaRegra, type RegraDaNota,
} from '@/lib/nota-regras';
import { ROTULO_TIPO_PRODUTO, TIPOS_PRODUTO } from '@/lib/venda-modelo';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * Regras da nota (E5, parte E): para cada combinação de tipo de produto,
 * fornecedor, representante e pagante, para quem sai nota (o pagante, o
 * fornecedor, o representante), sobre quais componentes da receita, tirando
 * quais descontos, e quando ela sai sozinha. A regra mais específica vence.
 */

const TODOS = '__todos__';

/** "Taxa DU + RAV − Desconto" em texto. */
export function formulaDoDestino(d: Pick<DestinoDaRegra, 'receitas' | 'descontos'>): string {
  if (!d.receitas.length) return 'Nada escolhido';
  const soma = d.receitas.map(rotuloDoCampo).join(' + ');
  const tira = d.descontos.length ? ` − ${d.descontos.map(rotuloDoCampo).join(' − ')}` : '';
  return `${soma}${tira}`;
}

function valeParaTexto(r: RegraDaNota): string {
  const partes = [
    r.tipo_produto ? ROTULO_TIPO_PRODUTO[r.tipo_produto] : 'Todos os produtos',
    r.fornecedor ? `fornecedor ${r.fornecedor.nome}` : '',
    r.representante ? `via ${r.representante.nome}` : '',
    r.pagante ? `pago por ${r.pagante.nome}` : '',
  ].filter(Boolean);
  return partes.join(' · ');
}

function copia(r: RegraDaNota): RegraDaNota {
  return JSON.parse(JSON.stringify(r)) as RegraDaNota;
}

export function TelaRegrasDaNota() {
  const pode = usePermissoes();
  const podeConfigurar = pode('configurar_notas');
  const [regras, setRegras] = React.useState<RegraDaNota[] | null>(null);
  const [config, setConfig] = React.useState<ConfigNotas | null>(null);
  const [sugerida, setSugerida] = React.useState<RegraDaNota | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  const [editando, setEditando] = React.useState<RegraDaNota | null>(null);
  const [sujo, setSujo] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [apagar, setApagar] = React.useState<RegraDaNota | null>(null);
  const [apagando, setApagando] = React.useState(false);

  const carregar = React.useCallback(async () => {
    try {
      const r = await apiNotas.regras();
      setRegras(r.regras);
      setConfig(r.config);
      setSugerida(r.sugerida);
      setErro(null);
      setAtualizadoEm(new Date());
      return r;
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir as regras.');
      return null;
    }
  }, []);

  React.useEffect(() => {
    void carregar().then(r => {
      // Vindo de "Gerar notas" sem regra: abre a sugerida pronta para salvar.
      if (r && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('nova') === 'sugerida' && r.regras.length === 0) {
        setEditando(copia(r.sugerida));
      }
    });
  }, [carregar]);

  function abrir(r: RegraDaNota) { setEditando(copia(r)); setSujo(false); }
  function mudar(patch: Partial<RegraDaNota>) { setEditando(a => (a ? { ...a, ...patch } : a)); setSujo(true); }
  function mudarDestino(d: DestinoDaNota, patch: Partial<DestinoDaRegra>) {
    setEditando(a => (a ? { ...a, destinos: { ...a.destinos, [d]: { ...a.destinos[d], ...patch } } } : a));
    setSujo(true);
  }

  async function salvar() {
    if (!editando) return;
    setSalvando(true);
    try {
      const salva = await apiNotas.salvarRegra({ ...editando, descricao: editando.descricao.trim() || descricaoAutomatica(editando) });
      toast.success(editando.id ? 'Regra salva' : 'Regra criada', `${salva.descricao}: vale para as próximas notas geradas.`);
      setEditando(null);
      setSujo(false);
      await carregar();
    } catch (e) {
      toast.error('A regra não foi salva', e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  async function salvarConfig(c: ConfigNotas) {
    const anterior = config;
    setConfig(c);
    try {
      setConfig(await apiNotas.salvarConfig(c));
      toast.success(c.automatico !== anterior?.automatico
        ? (c.automatico ? 'Emissão automática ligada' : 'Emissão automática desligada')
        : (c.enviar_ao_cliente ? 'O cliente vai receber a nota por e-mail' : 'O cliente não vai receber a nota por e-mail'));
    } catch (e) {
      setConfig(anterior);
      toast.error('A configuração não foi salva', e instanceof Error ? e.message : undefined);
    }
  }

  async function confirmarApagar() {
    if (!apagar) return;
    setApagando(true);
    try {
      await apiNotas.apagarRegra(apagar.id);
      toast.success('Regra apagada', 'As notas já emitidas por ela não mudam.');
      setApagar(null);
      await carregar();
    } catch (e) {
      toast.error('A regra não foi apagada', e instanceof Error ? e.message : undefined);
    } finally {
      setApagando(false);
    }
  }

  const resumoDestino = (r: RegraDaNota, d: DestinoDaNota) => {
    const x = r.destinos[d];
    if (!x.ligado) return <span className="fin-t-caption text-[var(--fin-text-3)]">Não emite</span>;
    return (
      <span className="flex min-w-0 flex-col">
        <span className="max-w-[30ch] truncate text-[var(--fin-text)]" title={formulaDoDestino(x)}>{formulaDoDestino(x)}</span>
        <span className="fin-t-caption text-[var(--fin-text-3)]">{ROTULO_GATILHO[x.gatilho]}{x.tomador_fixo ? ` · sempre para ${x.tomador_fixo.nome}` : ''}</span>
      </span>
    );
  };

  const colunas: FinColuna<RegraDaNota>[] = [
    {
      id: 'regra', cabecalho: 'Regra', tipo: 'texto', sortable: true, minWidth: 200, acessor: r => r.descricao.toLowerCase(),
      render: r => (
        <span className="flex min-w-0 flex-col">
          <span className={cn('truncate fin-t-body-strong', r.ativa ? 'text-[var(--fin-text)]' : 'text-[var(--fin-text-3)]')}>{r.descricao}{r.ativa ? '' : ' (desligada)'}</span>
          <span className="max-w-[36ch] truncate fin-t-caption text-[var(--fin-text-3)]">{valeParaTexto(r)}</span>
        </span>
      ),
    },
    { id: 'pagante', cabecalho: 'Ao pagante', tipo: 'texto', minWidth: 200, render: r => resumoDestino(r, 'PAGANTE') },
    { id: 'fornecedor', cabecalho: 'Ao fornecedor', tipo: 'texto', minWidth: 180, render: r => resumoDestino(r, 'FORNECEDOR'), prioridade: 2 },
    { id: 'representante', cabecalho: 'Ao representante', tipo: 'texto', minWidth: 180, render: r => resumoDestino(r, 'REPRESENTANTE'), prioridade: 1 },
    {
      id: 'acoes', cabecalho: '', tipo: 'acoes',
      render: r => podeConfigurar ? (
        <span className="inline-flex items-center justify-end gap-1">
          <BotaoIcone rotulo={`Editar a regra ${r.descricao}`} onClick={() => abrir(r)}><Pencil className="size-4" aria-hidden="true" /></BotaoIcone>
          <BotaoIcone rotulo={`Apagar a regra ${r.descricao}`} onClick={() => setApagar(r)} perigo><Trash2 className="size-4" aria-hidden="true" /></BotaoIcone>
        </span>
      ) : null,
    },
  ];

  return (
    <MolduraDaPagina>
      <div className="flex flex-col gap-[var(--fin-s-5)]">
        <PageHeader
          icone={FileCog}
          titulo="Regras da nota"
          subtitulo="Para quem sai nota em cada venda, sobre o quê e quando. A regra mais específica vale."
          atualizadoEm={atualizadoEm}
          onRecarregar={async () => { await carregar(); }}
          acaoPrimaria={podeConfigurar && sugerida ? { rotulo: 'Nova regra', icone: Plus, onClick: () => abrir({ ...copia(sugerida), descricao: '' }) } : undefined}
          acoesSecundarias={[
            { rotulo: 'Gerar notas', href: '/financeiro-ag/notas/gerar' },
            { rotulo: 'Retenções na fonte', href: '/financeiro-ag/notas/retencoes' },
          ]}
        />

        {config ? (
          <section aria-labelledby="titulo-auto" className={cn(SECAO, 'max-w-3xl')}>
            <h2 id="titulo-auto" className="fin-t-subhead text-[var(--fin-text)]">Emissão</h2>
            <Interruptor
              id="notas-automatico"
              ligado={config.automatico}
              desabilitado={!podeConfigurar}
              onChange={v => { void salvarConfig({ ...config, automatico: v }); }}
              rotulo="Emitir sozinho quando o momento da regra chegar"
              descricao="Com isto ligado, cada destino com “quando o cliente terminar de pagar”, “quando a fatura fechar” ou “quando a comissão for recebida” emite a nota sem ninguém clicar. Desligado, tudo passa por Gerar notas."
            />
            <Interruptor
              id="notas-email"
              ligado={config.enviar_ao_cliente}
              desabilitado={!podeConfigurar}
              onChange={v => { void salvarConfig({ ...config, enviar_ao_cliente: v }); }}
              rotulo="Mandar a nota ao cliente por e-mail"
              descricao="O emissor manda o PDF e o XML ao e-mail do cadastro assim que a prefeitura autorizar. Vale para a nota ao pagante."
            />
          </section>
        ) : null}

        <FinTable<RegraDaNota>
          linhas={regras ?? []}
          colunas={colunas}
          chave={r => r.id}
          estado={!regras && !erro ? 'carregando' : !regras && erro ? 'erro' : 'ok'}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
          vazio={{
            motivo: 'sem-dado', titulo: 'Nenhuma regra da nota ainda',
            oQueE: 'A regra diz, para cada tipo de venda, para quem sai nota e sobre quais valores. Sem regra, Gerar notas não sugere nota.',
            comoComeca: [
              'Comece pela regra sugerida: nota ao cliente sobre Taxa DU, RAV, Fee e Markup; nota ao fornecedor sobre Comissão e Over.',
              'Ajuste os valores e o momento em que cada nota sai.',
              'Crie regras mais específicas (um tipo de produto, uma operadora, um cliente) quando precisar.',
            ],
            acao: podeConfigurar && sugerida ? { rotulo: 'Começar pela regra sugerida', onClick: () => abrir(copia(sugerida)) } : undefined,
          }}
          onLinhaDuploClique={podeConfigurar ? abrir : undefined}
        />
      </div>

      <RecordSheet
        aberto={Boolean(editando)}
        onOpenChange={a => { if (!a) { setEditando(null); setSujo(false); } }}
        titulo={editando?.id ? 'Editar regra da nota' : 'Nova regra da nota'}
        descricao="Vale para as notas geradas daqui em diante. As já emitidas não mudam."
        largura={960}
        sujo={sujo}
        acaoPrimaria={{ rotulo: 'Salvar regra', onClick: salvar, carregando: salvando }}
        acaoSecundaria={{ rotulo: 'Cancelar', onClick: () => { setEditando(null); setSujo(false); } }}
      >
        {editando ? <EditorDaRegra regra={editando} mudar={mudar} mudarDestino={mudarDestino} /> : null}
      </RecordSheet>

      <ConfirmDialog
        aberto={Boolean(apagar)}
        onOpenChange={a => { if (!a) setApagar(null); }}
        titulo="Apagar a regra"
        oQueVaiAcontecer="As próximas vendas desta combinação passam a usar a regra mais geral que sobrar (ou nenhuma). As notas já emitidas por esta regra não mudam."
        detalhes={apagar ? [{ rotulo: 'Regra', valor: apagar.descricao }, { rotulo: 'Vale para', valor: valeParaTexto(apagar) }] : []}
        confirmarRotulo="Apagar a regra"
        voltarRotulo="Manter"
        tone="destrutivo"
        processando={apagando}
        onConfirmar={confirmarApagar}
      />
    </MolduraDaPagina>
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

function EditorDaRegra({ regra, mudar, mudarDestino }: {
  regra: RegraDaNota;
  mudar: (p: Partial<RegraDaNota>) => void;
  mudarDestino: (d: DestinoDaNota, p: Partial<DestinoDaRegra>) => void;
}) {
  const alternar = (d: DestinoDaNota, lista: 'receitas' | 'descontos', c: CampoDaRegra) => {
    const atual = regra.destinos[d][lista];
    mudarDestino(d, { [lista]: atual.includes(c) ? atual.filter(x => x !== c) : [...atual, c] } as Partial<DestinoDaRegra>);
  };
  const numero = (v: string): number | null => {
    const n = Number(v.replace(',', '.'));
    return v.trim() === '' || !Number.isFinite(n) ? null : n;
  };
  const r = regra.ibs_cbs;
  return (
    <div className="flex flex-col gap-[var(--fin-s-5)]">
      <label className="flex flex-col gap-[var(--fin-s-1)]">
        <span className="fin-t-body-strong text-[var(--fin-text)]">Nome da regra</span>
        <input
          className={CAMPO_TEXTO}
          value={regra.descricao}
          maxLength={120}
          placeholder={descricaoAutomatica(regra)}
          onChange={e => mudar({ descricao: e.target.value })}
        />
      </label>

      <fieldset className="flex flex-col gap-[var(--fin-s-3)]">
        <legend className="mb-[var(--fin-s-2)] fin-t-subhead text-[var(--fin-text)]">Vale para</legend>
        <p className="fin-t-caption text-[var(--fin-text-3)]">Deixe em branco para valer para todos. Quando mais de uma regra serve, vale a mais específica: pagante, depois representante, fornecedor e tipo de produto.</p>
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] md:grid-cols-2">
          <CampoSelecao
            id="regra-tipo" rotulo="Tipo de produto"
            valor={regra.tipo_produto ?? TODOS}
            onChange={v => mudar({ tipo_produto: v === TODOS ? null : v as RegraDaNota['tipo_produto'] })}
            opcoes={[{ valor: TODOS, rotulo: 'Todos os produtos' }, ...TIPOS_PRODUTO.map(t => ({ valor: t, rotulo: ROTULO_TIPO_PRODUTO[t] }))]}
          />
          <div className="flex flex-col gap-[var(--fin-s-1)]">
            <span className="fin-t-body-strong text-[var(--fin-text)]">Pagante</span>
            <ClientePicker
              value={regra.pagante?.id}
              nome={regra.pagante?.nome}
              avisarSobreNota={false}
              placeholder="Todos os pagantes"
              onChange={c => mudar({ pagante: c && c.id ? { id: c.id, nome: c.nome } : null })}
            />
          </div>
          <div className="flex flex-col gap-[var(--fin-s-1)]">
            <span className="fin-t-body-strong text-[var(--fin-text)]">Fornecedor</span>
            <FornecedorPicker
              value={regra.fornecedor?.id}
              nome={regra.fornecedor?.nome}
              placeholder="Todos os fornecedores"
              onChange={f => mudar({ fornecedor: f && f.id ? f : null })}
            />
          </div>
          <div className="flex flex-col gap-[var(--fin-s-1)]">
            <span className="fin-t-body-strong text-[var(--fin-text)]">Representante</span>
            <FornecedorPicker
              value={regra.representante?.id}
              nome={regra.representante?.nome}
              placeholder="Com ou sem representante"
              tipoSugerido="CONSOLIDADORA"
              onChange={f => mudar({ representante: f && f.id ? f : null })}
            />
          </div>
        </div>
      </fieldset>

      {DESTINOS_DA_NOTA.map(d => {
        const x = regra.destinos[d];
        return (
          <fieldset key={d} className="flex flex-col gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-[var(--fin-s-4)]">
            <legend className="sr-only">{ROTULO_DESTINO[d]}</legend>
            <Interruptor
              id={`destino-${d}`}
              ligado={x.ligado}
              onChange={v => mudarDestino(d, { ligado: v })}
              rotulo={`Nota ${ROTULO_DESTINO[d].toLowerCase()}`}
              descricao={AJUDA_DESTINO[d]}
            />
            {x.ligado ? (
              <div className="flex flex-col gap-[var(--fin-s-3)] pl-[52px] max-sm:pl-0">
                <div className="flex flex-col gap-[var(--fin-s-2)]">
                  <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Soma na nota</span>
                  <div className="flex flex-wrap gap-[var(--fin-s-2)]">
                    {CAMPOS_DA_REGRA.map(c => (
                      <Pilula key={c} marcada={x.receitas.includes(c)} desabilitada={x.descontos.includes(c)} title={ajudaDoCampo(c)} onClick={() => alternar(d, 'receitas', c)}>
                        {rotuloDoCampo(c)}
                      </Pilula>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-[var(--fin-s-2)]">
                  <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Tira da nota</span>
                  <div className="flex flex-wrap gap-[var(--fin-s-2)]">
                    {CAMPOS_DA_REGRA.map(c => (
                      <Pilula key={c} tom="tira" marcada={x.descontos.includes(c)} desabilitada={x.receitas.includes(c)} title={ajudaDoCampo(c)} onClick={() => alternar(d, 'descontos', c)}>
                        {rotuloDoCampo(c)}
                      </Pilula>
                    ))}
                  </div>
                </div>
                <p className="fin-t-body text-[var(--fin-text-2)]">
                  Valor da nota: <strong className="text-[var(--fin-text)]">{formulaDoDestino(x)}</strong>, de cada produto da venda.
                </p>
                <div className="grid grid-cols-1 gap-[var(--fin-s-3)] md:grid-cols-2">
                  <CampoSelecao
                    id={`gatilho-${d}`} rotulo="Quando sai sozinha"
                    valor={x.gatilho}
                    onChange={v => mudarDestino(d, { gatilho: v as DestinoDaRegra['gatilho'] })}
                    opcoes={GATILHOS_DA_NOTA.map(g => ({ valor: g, rotulo: ROTULO_GATILHO[g] }))}
                    ajuda="Só vale com a emissão automática ligada. Sempre dá para gerar em Gerar notas."
                  />
                  <div className="flex flex-col gap-[var(--fin-s-1)]">
                    <span className="fin-t-body-strong text-[var(--fin-text)]">Emitir sempre para</span>
                    {d === 'PAGANTE' ? (
                      <ClientePicker
                        value={x.tomador_fixo?.id}
                        nome={x.tomador_fixo?.nome}
                        placeholder="Quem paga a venda"
                        onChange={c => mudarDestino(d, { tomador_fixo: c && c.id ? { id: c.id, nome: c.nome } : null })}
                      />
                    ) : (
                      <FornecedorPicker
                        value={x.tomador_fixo?.id}
                        nome={x.tomador_fixo?.nome}
                        placeholder={d === 'FORNECEDOR' ? 'O fornecedor do produto' : 'O representante do produto'}
                        onChange={f => mudarDestino(d, { tomador_fixo: f && f.id ? f : null })}
                      />
                    )}
                    <span className="fin-t-caption text-[var(--fin-text-3)]">Vazio: a pessoa da própria venda.</span>
                  </div>
                </div>
              </div>
            ) : null}
          </fieldset>
        );
      })}

      <fieldset className="flex flex-col gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-[var(--fin-s-4)]">
        <legend className="mb-[var(--fin-s-2)] fin-t-subhead text-[var(--fin-text)]">Reforma tributária (IBS e CBS)</legend>
        <Callout tom="info">
          Campos prontos para a reforma. O sistema não calcula IBS nem CBS: as regras do regime das agências de turismo ainda precisam ser confirmadas com o contador. O que estiver preenchido vai para a nota quando o emissor aceitar.
        </Callout>
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
          <CampoCurto rotulo="CST" valor={r.cst} max={10} onChange={v => mudar({ ibs_cbs: { ...r, cst: v } })} />
          <CampoCurto rotulo="Classificação tributária" valor={r.classificacao_tributaria} max={20} onChange={v => mudar({ ibs_cbs: { ...r, classificacao_tributaria: v } })} />
          <CampoCurto rotulo="Indicador da operação" valor={r.indicador_operacao} max={20} onChange={v => mudar({ ibs_cbs: { ...r, indicador_operacao: v } })} />
          <CampoCurto rotulo="Alíquota de IBS (%)" valor={r.aliquota_ibs === null ? '' : String(r.aliquota_ibs).replace('.', ',')} max={8} decimal onChange={v => mudar({ ibs_cbs: { ...r, aliquota_ibs: numero(v) } })} />
          <CampoCurto rotulo="Alíquota de CBS (%)" valor={r.aliquota_cbs === null ? '' : String(r.aliquota_cbs).replace('.', ',')} max={8} decimal onChange={v => mudar({ ibs_cbs: { ...r, aliquota_cbs: numero(v) } })} />
        </div>
      </fieldset>
    </div>
  );
}

function CampoCurto({ rotulo, valor, onChange, max, decimal }: { rotulo: string; valor: string; onChange: (v: string) => void; max: number; decimal?: boolean }) {
  const [texto, setTexto] = React.useState(valor);
  React.useEffect(() => { setTexto(valor); }, [valor]);
  return (
    <label className="flex flex-col gap-[var(--fin-s-1)]">
      <span className="fin-t-body-strong text-[var(--fin-text)]">{rotulo}</span>
      <input
        className={cn(CAMPO_TEXTO, decimal && 'tabular-nums')}
        value={texto}
        maxLength={max}
        inputMode={decimal ? 'decimal' : undefined}
        onChange={e => { setTexto(e.target.value); if (!decimal) onChange(e.target.value); }}
        onBlur={() => { if (decimal) onChange(texto); }}
      />
    </label>
  );
}

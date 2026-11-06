'use client';

/**
 * ACORDOS COM FORNECEDORES (E5, parte C): Comissão, Over e Taxa CC (DU/RAV)
 * por fornecedor e tipo de produto, só por um representante quando for o
 * caso, com vigência. A venda usa o acordo da data dela; mudar o acordo
 * hoje não mexe nas vendas de antes.
 */
import { HistoricoRecolhivel } from '@/components/fin/HistoricoDoRegistro';
import * as React from 'react';
import { Handshake } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { FilterBar } from '@/components/fin/FilterBar';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Segmentado } from '@/components/fin/Segmentado';
import { Field } from '@/components/fin/Field';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { ROTULO_TIPO_PRODUTO, TIPOS_PRODUTO, type TipoProduto } from '@/lib/venda-modelo';
import { resumoDoAcordo } from '@/lib/fornecedor-acordos';
import type { AcordoGravado } from '@/lib/fornecedor-servidor';
import { CampoReais, ErroDaApi, Pilula, SELECT, api, dataBR, hojeNoBrasil, percentualBR, reais, useFornecedores } from './comum';

function vigencia(a: AcordoGravado, hoje: string): { rotulo: string; tom: 'positivo' | 'acento' | 'neutro' } {
  if (a.vigencia_inicio > hoje) return { rotulo: 'Começa depois', tom: 'acento' };
  if (a.vigencia_fim && a.vigencia_fim < hoje) return { rotulo: 'Encerrado', tom: 'neutro' };
  return { rotulo: 'Valendo', tom: 'positivo' };
}

export function TelaDeAcordos() {
  const { fornecedores } = useFornecedores();
  const [acordos, setAcordos] = React.useState<AcordoGravado[]>([]);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState('');
  const [busca, setBusca] = React.useState('');
  const [fornecedor, setFornecedor] = React.useState('TODOS');
  const [quais, setQuais] = React.useState('VALENDO');
  const [editando, setEditando] = React.useState<AcordoGravado | 'novo' | null>(null);
  const hoje = hojeNoBrasil();

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      setAcordos((await api<{ acordos: AcordoGravado[] }>('/api/fornecedores/acordos')).acordos);
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.');
      setEstado('erro');
    }
  }, []);
  React.useEffect(() => { void carregar(); }, [carregar]);

  const visiveis = acordos.filter(a => {
    if (fornecedor !== 'TODOS' && a.fornecedor.id !== fornecedor && a.representante?.id !== fornecedor) return false;
    if (quais === 'VALENDO' && vigencia(a, hoje).rotulo !== 'Valendo') return false;
    if (busca && !`${a.fornecedor.nome} ${a.representante?.nome ?? ''} ${a.observacoes}`.toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  });
  const colunas: FinColuna<AcordoGravado>[] = [
    { id: 'fornecedor', cabecalho: 'Fornecedor', tipo: 'texto', sortable: true, acessor: a => a.fornecedor.nome, minWidth: 180,
      render: a => <span className="flex flex-col"><span className="fin-t-body-strong">{a.fornecedor.nome}</span>{a.representante ? <span className="fin-t-caption text-[var(--fin-text-3)]">via {a.representante.nome}</span> : null}</span> },
    { id: 'produto', cabecalho: 'Produto', tipo: 'texto', sortable: true, acessor: a => a.tipo_produto ?? '',
      render: a => (a.produto_crm_id ? a.produto_nome || 'Produto do catálogo' : a.tipo_produto ? ROTULO_TIPO_PRODUTO[a.tipo_produto] : 'Todos os produtos') },
    { id: 'comissao', cabecalho: 'Comissão', tipo: 'texto', sortable: true, acessor: a => a.comissao_percentual ?? a.comissao_valor_centavos ?? 0,
      render: a => (a.comissao_percentual !== null ? percentualBR(a.comissao_percentual) : a.comissao_valor_centavos !== null ? reais(a.comissao_valor_centavos) : '—') },
    { id: 'over', cabecalho: 'Over', tipo: 'texto', sortable: true, acessor: a => a.over_percentual ?? a.over_valor_centavos ?? 0,
      render: a => (a.over_percentual !== null ? percentualBR(a.over_percentual) : a.over_valor_centavos !== null ? reais(a.over_valor_centavos) : '—') },
    { id: 'cc_du', cabecalho: 'Taxa CC DU', tipo: 'texto', sortable: true, acessor: a => a.taxa_cc_du_percentual ?? 0, render: a => percentualBR(a.taxa_cc_du_percentual), prioridade: 1 },
    { id: 'cc_rav', cabecalho: 'Taxa CC RAV', tipo: 'texto', sortable: true, acessor: a => a.taxa_cc_rav_percentual ?? 0, render: a => percentualBR(a.taxa_cc_rav_percentual), prioridade: 1 },
    { id: 'vigencia', cabecalho: 'Vigência', tipo: 'texto', sortable: true, acessor: a => a.vigencia_inicio,
      render: a => <span className="whitespace-nowrap">{dataBR(a.vigencia_inicio)} {a.vigencia_fim ? `a ${dataBR(a.vigencia_fim)}` : 'em diante'}</span> },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'texto', sortable: true, acessor: a => vigencia(a, hoje).rotulo,
      render: a => { const v = vigencia(a, hoje); return <Pilula tom={v.tom}>{v.rotulo}</Pilula>; } },
  ];
  const opcoesForn = [{ valor: 'TODOS', rotulo: 'Todos' }, ...fornecedores.filter(f => acordos.some(a => a.fornecedor.id === f.id || a.representante?.id === f.id)).map(f => ({ valor: f.id, rotulo: f.nome }))];

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={Handshake}
        titulo="Acordos com fornecedores"
        subtitulo="Comissão, over e Taxa CC por fornecedor e produto, com vigência. A venda lançada usa o acordo da data dela."
        acaoPrimaria={{ rotulo: 'Novo acordo', onClick: () => setEditando('novo') }}
        acoesSecundarias={[{ rotulo: 'Comissão de fornecedores', href: '/financeiro-ag/fornecedores/comissoes' }]}
        onRecarregar={carregar}
      />
      <FilterBar
        busca={{ valor: busca, onChange: setBusca, placeholder: 'Buscar fornecedor, representante ou observação' }}
        selects={[
          { id: 'fornecedor', rotulo: 'Fornecedor', valor: fornecedor, onChange: setFornecedor, opcoes: opcoesForn },
          { id: 'quais', rotulo: 'Vigência', valor: quais, onChange: setQuais, opcoes: [{ valor: 'VALENDO', rotulo: 'Valendo hoje' }, { valor: 'TODOS', rotulo: 'Todos, com os encerrados' }] },
        ]}
        resumo={{ exibidos: visiveis.length, total: acordos.length, substantivo: 'acordos' }}
        ativos={(busca ? 1 : 0) + (fornecedor !== 'TODOS' ? 1 : 0) + (quais !== 'VALENDO' ? 1 : 0)}
        onLimpar={() => { setBusca(''); setFornecedor('TODOS'); setQuais('VALENDO'); }}
      />
      <FinTable<AcordoGravado>
        linhas={visiveis}
        colunas={colunas}
        chave={a => a.id}
        estado={estado}
        erro={estado === 'erro' ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        onLinhaClick={setEditando}
        vazio={acordos.length
          ? { motivo: 'sem-resultado', titulo: 'Nenhum acordo neste filtro', oQueE: 'Nenhum acordo se encaixa nos filtros.', acaoSecundaria: { rotulo: 'Ver todos', onClick: () => { setBusca(''); setFornecedor('TODOS'); setQuais('TODOS'); } } }
          : { motivo: 'sem-dado', titulo: 'Nenhum acordo cadastrado', oQueE: 'O acordo diz quanto cada fornecedor paga à agência. Com ele, a venda lançada já vem com a comissão e a conferência do que foi recebido fica automática.', comoComeca: ['Escolha o fornecedor e o tipo de produto.', 'Informe a comissão e, se houver, o over e a Taxa CC.', 'Diga desde quando vale.'], acao: { rotulo: 'Novo acordo', onClick: () => setEditando('novo') } }}
      />
      {editando ? (
        <FormularioDoAcordo
          acordo={editando === 'novo' ? null : editando}
          fornecedores={fornecedores}
          onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); void carregar(); }}
        />
      ) : null}
    </MolduraDaPagina>
  );
}

type Modo = 'pct' | 'valor';

interface Rascunho {
  fornecedor_id: string;
  representante_id: string;
  tipo_produto: TipoProduto | '';
  comissao_modo: Modo;
  comissao_pct: string;
  comissao_valor: number;
  over_modo: Modo;
  over_pct: string;
  over_valor: number;
  cc_du: string;
  cc_rav: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  observacoes: string;
}

const pctTexto = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));
const pctNumero = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return s.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

function FormularioDoAcordo({ acordo, fornecedores, onFechar, onSalvo }: {
  acordo: AcordoGravado | null; fornecedores: Array<{ id: string; nome: string }>; onFechar: () => void; onSalvo: () => void;
}) {
  const inicial: Rascunho = {
    fornecedor_id: acordo?.fornecedor.id ?? '',
    representante_id: acordo?.representante?.id ?? '',
    tipo_produto: acordo?.tipo_produto ?? '',
    comissao_modo: acordo?.comissao_valor_centavos !== null && acordo?.comissao_valor_centavos !== undefined ? 'valor' : 'pct',
    comissao_pct: pctTexto(acordo?.comissao_percentual ?? null),
    comissao_valor: acordo?.comissao_valor_centavos ?? 0,
    over_modo: acordo?.over_valor_centavos !== null && acordo?.over_valor_centavos !== undefined ? 'valor' : 'pct',
    over_pct: pctTexto(acordo?.over_percentual ?? null),
    over_valor: acordo?.over_valor_centavos ?? 0,
    cc_du: pctTexto(acordo?.taxa_cc_du_percentual ?? null),
    cc_rav: pctTexto(acordo?.taxa_cc_rav_percentual ?? null),
    vigencia_inicio: acordo?.vigencia_inicio ?? hojeNoBrasil(),
    vigencia_fim: acordo?.vigencia_fim ?? '',
    observacoes: acordo?.observacoes ?? '',
  };
  const [r, setR] = React.useState<Rascunho>(inicial);
  const [salvando, setSalvando] = React.useState(false);
  const [erros, setErros] = React.useState<Record<string, string>>({});
  const [excluir, setExcluir] = React.useState(false);
  const sujo = JSON.stringify(r) !== JSON.stringify(inicial);
  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR(x => ({ ...x, [k]: v }));

  const corpo = () => ({
    fornecedor: { id: r.fornecedor_id },
    representante: r.representante_id ? { id: r.representante_id } : null,
    tipo_produto: r.tipo_produto || null,
    comissao_percentual: r.comissao_modo === 'pct' ? pctNumero(r.comissao_pct) : null,
    comissao_valor_centavos: r.comissao_modo === 'valor' && r.comissao_valor > 0 ? r.comissao_valor : null,
    over_percentual: r.over_modo === 'pct' ? pctNumero(r.over_pct) : null,
    over_valor_centavos: r.over_modo === 'valor' && r.over_valor > 0 ? r.over_valor : null,
    taxa_cc_du_percentual: pctNumero(r.cc_du),
    taxa_cc_rav_percentual: pctNumero(r.cc_rav),
    vigencia_inicio: r.vigencia_inicio,
    vigencia_fim: r.vigencia_fim || null,
    observacoes: r.observacoes,
  });

  async function salvar() {
    setSalvando(true);
    setErros({});
    try {
      await api(acordo ? `/api/fornecedores/acordos/${encodeURIComponent(acordo.id)}` : '/api/fornecedores/acordos', { metodo: acordo ? 'PUT' : 'POST', corpo: corpo() });
      toast.success(acordo ? 'Acordo atualizado' : 'Acordo cadastrado', 'As vendas lançadas a partir de agora usam o acordo da data delas.');
      onSalvo();
    } catch (e) {
      if (e instanceof ErroDaApi && e.codigo === 'DADOS') {
        const lista = ((e.detalhes as { erros?: Array<{ campo: string; mensagem: string }> })?.erros) ?? [];
        setErros(Object.fromEntries(lista.map(x => [x.campo, x.mensagem])));
      } else if (e instanceof ErroDaApi && e.codigo === 'VIGENCIA_SOBREPOSTA') {
        setErros({ vigencia_inicio: e.message });
      } else {
        toast.error('O acordo não foi salvo', e instanceof Error ? e.message : undefined);
      }
    } finally {
      setSalvando(false);
    }
  }
  async function confirmarExclusao() {
    if (!acordo) return;
    try {
      await api(`/api/fornecedores/acordos/${encodeURIComponent(acordo.id)}`, { metodo: 'DELETE' });
      toast.success('Acordo excluído');
      onSalvo();
    } catch (e) {
      toast.error('O acordo não foi excluído', e instanceof Error ? e.message : undefined);
    }
  }

  const c = corpo();
  const previa = resumoDoAcordo({
    id: '', fornecedor: { id: r.fornecedor_id, nome: '' }, representante: null, tipo_produto: null, produto_crm_id: '', produto_nome: '',
    comissao_percentual: c.comissao_percentual, comissao_valor_centavos: c.comissao_valor_centavos,
    over_percentual: c.over_percentual, over_valor_centavos: c.over_valor_centavos,
    taxa_cc_du_percentual: c.taxa_cc_du_percentual, taxa_cc_rav_percentual: c.taxa_cc_rav_percentual,
    vigencia_inicio: r.vigencia_inicio, vigencia_fim: r.vigencia_fim || null, observacoes: '',
  });
  const nomeForn = fornecedores.find(f => f.id === r.fornecedor_id)?.nome;

  return (
    <>
      <RecordSheet
        aberto
        onOpenChange={a => { if (!a) onFechar(); }}
        titulo={acordo ? `Acordo com ${acordo.fornecedor.nome}` : 'Novo acordo com fornecedor'}
        descricao="Para mudar o percentual a partir de uma data, encerre este acordo um dia antes e cadastre outro: as vendas de antes continuam com o acordo da data delas."
        largura={640}
        sujo={sujo}
        resumo={nomeForn && previa ? <>{nomeForn}: {previa}, {r.tipo_produto ? ROTULO_TIPO_PRODUTO[r.tipo_produto].toLowerCase() : 'todos os produtos'}, de {dataBR(r.vigencia_inicio)} {r.vigencia_fim ? `a ${dataBR(r.vigencia_fim)}` : 'em diante'}.</> : null}
        acaoPrimaria={{ rotulo: acordo ? 'Salvar acordo' : 'Cadastrar acordo', onClick: salvar, carregando: salvando }}
      >
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
            <Field rotulo="Fornecedor" obrigatorio erro={erros.fornecedor}>
              {a => (
                <select {...a} className={SELECT} value={r.fornecedor_id} onChange={e => set('fornecedor_id', e.target.value)}>
                  <option value="">Escolha…</option>
                  {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              )}
            </Field>
            <Field rotulo="Só comprando por" ajuda="Representante ou consolidadora. Vazio: qualquer caminho." erro={erros.representante}>
              {a => (
                <select {...a} className={SELECT} value={r.representante_id} onChange={e => set('representante_id', e.target.value)}>
                  <option value="">Qualquer caminho</option>
                  {fornecedores.filter(f => f.id !== r.fornecedor_id).map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              )}
            </Field>
            <Field rotulo="Tipo de produto">
              {a => (
                <select {...a} className={SELECT} value={r.tipo_produto} onChange={e => set('tipo_produto', e.target.value as TipoProduto | '')}>
                  <option value="">Todos os produtos</option>
                  {TIPOS_PRODUTO.map(t => <option key={t} value={t}>{ROTULO_TIPO_PRODUTO[t]}</option>)}
                </select>
              )}
            </Field>
          </div>

          <fieldset className="grid grid-cols-1 gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-[var(--fin-s-3)] sm:grid-cols-2">
            <legend className="sr-only">O que o fornecedor paga</legend>
            <CampoPctOuValor
              rotulo="Comissão" modo={r.comissao_modo} pct={r.comissao_pct} valor={r.comissao_valor} erro={erros.comissao_percentual || erros.comissao_valor_centavos}
              onModo={m => set('comissao_modo', m)} onPct={v => set('comissao_pct', v)} onValor={v => set('comissao_valor', v)} ajuda="Sobre a tarifa. Valor: por produto vendido."
            />
            <CampoPctOuValor
              rotulo="Over" modo={r.over_modo} pct={r.over_pct} valor={r.over_valor} erro={erros.over_percentual || erros.over_valor_centavos}
              onModo={m => set('over_modo', m)} onPct={v => set('over_pct', v)} onValor={v => set('over_valor', v)} ajuda="Incentivo além da comissão, sobre a tarifa."
            />
            <Field rotulo="Taxa CC DU (%)" ajuda="Quando o fornecedor passa o cartão do cliente: % sobre a Taxa DU." erro={erros.taxa_cc_du_percentual}>
              {a => <Input {...a} inputMode="decimal" value={r.cc_du} onChange={e => set('cc_du', e.target.value)} className="h-11 text-right tabular-nums lg:h-10" placeholder="0" />}
            </Field>
            <Field rotulo="Taxa CC RAV (%)" ajuda="Quando o fornecedor passa o cartão do cliente: % sobre o RAV." erro={erros.taxa_cc_rav_percentual}>
              {a => <Input {...a} inputMode="decimal" value={r.cc_rav} onChange={e => set('cc_rav', e.target.value)} className="h-11 text-right tabular-nums lg:h-10" placeholder="0" />}
            </Field>
          </fieldset>

          <div className="grid grid-cols-1 gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-[var(--fin-s-3)] sm:grid-cols-2">
            <Field rotulo="Vale a partir de" obrigatorio erro={erros.vigencia_inicio}>
              {a => <Input {...a} type="date" value={r.vigencia_inicio} onChange={e => set('vigencia_inicio', e.target.value)} className="h-11 lg:h-10" />}
            </Field>
            <Field rotulo="Vale até" ajuda="Vazio: sem data para acabar." erro={erros.vigencia_fim}>
              {a => <Input {...a} type="date" value={r.vigencia_fim} onChange={e => set('vigencia_fim', e.target.value)} className="h-11 lg:h-10" />}
            </Field>
          </div>
          <Field rotulo="Observações">
            {a => <Textarea {...a} rows={2} value={r.observacoes} maxLength={1000} onChange={e => set('observacoes', e.target.value)} placeholder="Ex.: tabela da campanha de verão" />}
          </Field>
          {acordo ? (
            <div className="flex justify-start border-t border-[var(--fin-border)] pt-[var(--fin-s-3)]">
              <Button type="button" variant="ghost" className="h-11 text-[var(--fin-negative-text)] lg:h-10" onClick={() => setExcluir(true)}>Excluir acordo</Button>
            </div>
          ) : null}
          {/* Histórico do acordo (E7, frente D): quem mudou o quê, e quando. */}
          {acordo ? <HistoricoRecolhivel entidade="fornecedor_acordos" id={acordo.id} /> : null}
        </div>
      </RecordSheet>
      {acordo ? (
        <ConfirmDialog
          aberto={excluir}
          onOpenChange={setExcluir}
          titulo="Excluir o acordo?"
          oQueVaiAcontecer="O acordo some da lista e deixa de servir para a comissão esperada, inclusive das vendas antigas. Para só parar de usar, ponha a data de fim."
          detalhes={[{ rotulo: 'Fornecedor', valor: acordo.fornecedor.nome }, { rotulo: 'Acordo', valor: resumoDoAcordo(acordo) }]}
          confirmarRotulo="Excluir acordo"
          tone="destrutivo"
          onConfirmar={confirmarExclusao}
        />
      ) : null}
    </>
  );
}

function CampoPctOuValor({ rotulo, modo, pct, valor, onModo, onPct, onValor, ajuda, erro }: {
  rotulo: string; modo: Modo; pct: string; valor: number; ajuda: string; erro?: string;
  onModo: (m: Modo) => void; onPct: (v: string) => void; onValor: (v: number) => void;
}) {
  return (
    <Field rotulo={rotulo} ajuda={ajuda} erro={erro}>
      {a => (
        <div className="flex gap-[var(--fin-s-2)]">
          <Segmentado<Modo> rotulo={`${rotulo} em`} opcoes={[{ valor: 'pct', rotulo: '%' }, { valor: 'valor', rotulo: 'R$' }]} valor={modo} onChange={onModo} />
          {modo === 'pct'
            ? <Input {...a} inputMode="decimal" value={pct} onChange={e => onPct(e.target.value)} className="h-11 min-w-0 flex-1 text-right tabular-nums lg:h-10" placeholder="0" />
            : <CampoReais id={a.id} rotulo={rotulo} centavos={valor} onChange={onValor} className="flex-1" />}
        </div>
      )}
    </Field>
  );
}

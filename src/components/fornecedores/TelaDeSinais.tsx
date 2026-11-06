'use client';

/**
 * SINAIS A FORNECEDORES (E5, parte C): adiantamentos pagos ao fornecedor.
 * Lançar o sinal cria a conta a pagar dele; o que for pago é descontado
 * sozinho das próximas faturas daquele fornecedor.
 */
import * as React from 'react';
import { HandCoins } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { FilterBar } from '@/components/fin/FilterBar';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Field } from '@/components/fin/Field';
import { toast } from '@/lib/toast';
import { addDias } from '@/lib/money';
import type { SinalComSaldo } from '@/lib/fornecedor-servidor';
import { CampoReais, LinhaDeResumo, Pilula, SELECT, api, dataBR, emReais, hojeNoBrasil, quandoBR, reais, useFornecedores } from './comum';

function situacaoDoSinal(s: SinalComSaldo): { rotulo: string; tom: 'neutro' | 'acento' | 'positivo' | 'aviso' } {
  if (s.situacao === 'CANCELADO') return { rotulo: 'Cancelado', tom: 'neutro' };
  if (s.pago_centavos === 0) return { rotulo: 'A pagar', tom: 'aviso' };
  if (s.disponivel > 0) return { rotulo: 'A descontar', tom: 'acento' };
  return { rotulo: 'Descontado', tom: 'positivo' };
}

export function TelaDeSinais() {
  const [sinais, setSinais] = React.useState<SinalComSaldo[]>([]);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState('');
  const [busca, setBusca] = React.useState('');
  const [situacao, setSituacao] = React.useState('TODOS');
  const [novo, setNovo] = React.useState(false);
  const [aberto, setAberto] = React.useState<SinalComSaldo | null>(null);

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      setSinais((await api<{ sinais: SinalComSaldo[] }>('/api/fornecedores/sinais')).sinais);
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.');
      setEstado('erro');
    }
  }, []);
  React.useEffect(() => { void carregar(); }, [carregar]);

  const visiveis = sinais.filter(s => {
    if (busca && !`${s.parte_nome} ${s.descricao}`.toLowerCase().includes(busca.toLowerCase())) return false;
    if (situacao === 'A_DESCONTAR') return s.situacao === 'ABERTO' && s.disponivel > 0;
    if (situacao === 'A_PAGAR') return s.situacao === 'ABERTO' && s.pago_centavos === 0;
    if (situacao === 'CANCELADO') return s.situacao === 'CANCELADO';
    return true;
  });
  const colunas: FinColuna<SinalComSaldo>[] = [
    { id: 'parte', cabecalho: 'Fornecedor', tipo: 'texto', sortable: true, acessor: s => s.parte_nome, minWidth: 180,
      render: s => <span className="flex flex-col"><span className="fin-t-body-strong">{s.parte_nome}</span>{s.descricao ? <span className="fin-t-caption text-[var(--fin-text-3)]">{s.descricao}</span> : null}</span> },
    { id: 'data', cabecalho: 'Lançado em', tipo: 'data', sortable: true, valor: s => s.data, prioridade: 2 },
    { id: 'vencimento', cabecalho: 'Vencimento', tipo: 'data', sortable: true, valor: s => s.vencimento },
    { id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', sortable: true, valor: s => emReais(s.valor_centavos) },
    { id: 'pago', cabecalho: 'Pago', tipo: 'dinheiro', sortable: true, valor: s => emReais(s.pago_centavos), prioridade: 1 },
    { id: 'compensado', cabecalho: 'Descontado em faturas', tipo: 'dinheiro', sortable: true, valor: s => emReais(s.compensado_centavos), prioridade: 1 },
    { id: 'disponivel', cabecalho: 'A descontar', tipo: 'dinheiro', sortable: true, valor: s => emReais(s.disponivel), tone: s => (s.disponivel > 0 ? 'positivo' : 'neutro') },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'texto', sortable: true, acessor: s => situacaoDoSinal(s).rotulo,
      render: s => { const x = situacaoDoSinal(s); return <Pilula tom={x.tom}>{x.rotulo}</Pilula>; } },
  ];
  const aDescontar = visiveis.reduce((a, s) => a + s.disponivel, 0);

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={HandCoins}
        titulo="Sinais a fornecedores"
        subtitulo="Adiantamentos ao fornecedor. O que já foi pago é descontado sozinho das próximas faturas dele."
        acaoPrimaria={{ rotulo: 'Lançar sinal', onClick: () => setNovo(true) }}
        acoesSecundarias={[{ rotulo: 'Fatura do fornecedor', href: '/financeiro-ag/fornecedores/faturas' }]}
        onRecarregar={carregar}
      />
      <FilterBar
        busca={{ valor: busca, onChange: setBusca, placeholder: 'Buscar fornecedor ou descrição' }}
        selects={[{ id: 'situacao', rotulo: 'Situação', valor: situacao, onChange: setSituacao, opcoes: [
          { valor: 'TODOS', rotulo: 'Todos' }, { valor: 'A_PAGAR', rotulo: 'A pagar' }, { valor: 'A_DESCONTAR', rotulo: 'A descontar' }, { valor: 'CANCELADO', rotulo: 'Cancelados' },
        ] }]}
        resumo={{ exibidos: visiveis.length, total: sinais.length, substantivo: 'sinais', soma: emReais(aDescontar), escopo: 'a descontar' }}
        ativos={(busca ? 1 : 0) + (situacao !== 'TODOS' ? 1 : 0)}
        onLimpar={() => { setBusca(''); setSituacao('TODOS'); }}
      />
      <FinTable<SinalComSaldo>
        linhas={visiveis}
        colunas={colunas}
        chave={s => s.id}
        estado={estado}
        erro={estado === 'erro' ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        onLinhaClick={setAberto}
        vazio={busca || situacao !== 'TODOS'
          ? { motivo: 'sem-resultado', titulo: 'Nenhum sinal neste filtro', oQueE: 'Nenhum sinal se encaixa nos filtros.', acaoSecundaria: { rotulo: 'Limpar filtros', onClick: () => { setBusca(''); setSituacao('TODOS'); } } }
          : { motivo: 'sem-dado', titulo: 'Nenhum sinal lançado', oQueE: 'Aqui ficam os adiantamentos pagos a fornecedores, como o bloqueio de um grupo ou a garantia de uma tarifa.', comoComeca: ['Lance o sinal: nasce a conta a pagar dele.', 'Pague a conta como qualquer outra.', 'Na próxima fatura do fornecedor, o valor é descontado sozinho.'], acao: { rotulo: 'Lançar sinal', onClick: () => setNovo(true) } }}
      />
      {novo ? <NovoSinal onFechar={() => setNovo(false)} onCriado={() => { setNovo(false); void carregar(); }} /> : null}
      {aberto ? <DetalheDoSinal sinal={aberto} onFechar={() => setAberto(null)} onMudou={() => { setAberto(null); void carregar(); }} /> : null}
    </MolduraDaPagina>
  );
}

function NovoSinal({ onFechar, onCriado }: { onFechar: () => void; onCriado: () => void }) {
  const { fornecedores } = useFornecedores();
  const [parte, setParte] = React.useState('');
  const [valor, setValor] = React.useState(0);
  const [vencimento, setVencimento] = React.useState(addDias(hojeNoBrasil(), 1));
  const [descricao, setDescricao] = React.useState('');
  const [salvando, setSalvando] = React.useState(false);
  const [erros, setErros] = React.useState<Record<string, string>>({});
  async function salvar() {
    const e: Record<string, string> = {};
    if (!parte) e.parte = 'Escolha o fornecedor.';
    if (!(valor > 0)) e.valor = 'Informe o valor do sinal.';
    if (!vencimento) e.vencimento = 'Informe quando o sinal será pago.';
    setErros(e);
    if (Object.keys(e).length) return;
    setSalvando(true);
    try {
      await api('/api/fornecedores/sinais', { metodo: 'POST', corpo: { parte_id: parte, valor_centavos: valor, vencimento, descricao } });
      toast.success('Sinal lançado', 'A conta a pagar do sinal já está em Contas a pagar.');
      onCriado();
    } catch (x) {
      toast.error('O sinal não foi lançado', x instanceof Error ? x.message : undefined);
    } finally {
      setSalvando(false);
    }
  }
  const nome = fornecedores.find(f => f.id === parte)?.nome;
  return (
    <RecordSheet
      aberto
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo="Lançar sinal ao fornecedor"
      largura={480}
      sujo={Boolean(parte || valor || descricao)}
      resumo={nome && valor > 0 ? <>Nasce uma conta a pagar de <strong>{reais(valor)}</strong> para {nome}, vencendo em {dataBR(vencimento)}. Depois de paga, ela é descontada da próxima fatura.</> : null}
      acaoPrimaria={{ rotulo: 'Lançar sinal', onClick: salvar, carregando: salvando }}
    >
      <div className="flex flex-col gap-[var(--fin-s-3)]">
        <Field rotulo="Fornecedor" obrigatorio erro={erros.parte}>
          {a => (
            <select {...a} className={SELECT} value={parte} onChange={e => setParte(e.target.value)}>
              <option value="">Escolha…</option>
              {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          <Field rotulo="Valor" obrigatorio erro={erros.valor}>
            {a => <CampoReais id={a.id} rotulo="Valor do sinal" centavos={valor} onChange={setValor} />}
          </Field>
          <Field rotulo="Vencimento" obrigatorio erro={erros.vencimento}>
            {a => <Input {...a} type="date" value={vencimento} onChange={e => setVencimento(e.target.value)} className="h-11 lg:h-10" />}
          </Field>
        </div>
        <Field rotulo="Descrição" ajuda="Opcional. Ex.: bloqueio do grupo de réveillon.">
          {a => <Input {...a} value={descricao} maxLength={300} onChange={e => setDescricao(e.target.value)} className="h-11 lg:h-10" />}
        </Field>
      </div>
    </RecordSheet>
  );
}

function DetalheDoSinal({ sinal, onFechar, onMudou }: { sinal: SinalComSaldo; onFechar: () => void; onMudou: () => void }) {
  const [cancelando, setCancelando] = React.useState(false);
  const [motivo, setMotivo] = React.useState('');
  const [enviando, setEnviando] = React.useState(false);
  const podeCancelar = sinal.situacao === 'ABERTO' && sinal.pago_centavos === 0 && sinal.compensado_centavos === 0;
  async function cancelar() {
    setEnviando(true);
    try {
      await api(`/api/fornecedores/sinais/${encodeURIComponent(sinal.id)}/cancelar`, { metodo: 'POST', corpo: { motivo } });
      toast.success('Sinal cancelado', 'A conta a pagar dele também foi cancelada.');
      onMudou();
    } catch (e) {
      toast.error('O sinal não foi cancelado', e instanceof Error ? e.message : undefined);
    } finally {
      setEnviando(false);
    }
  }
  if (cancelando) {
    return (
      <RecordSheet
        aberto
        onOpenChange={a => { if (!a) setCancelando(false); }}
        titulo="Cancelar o sinal"
        descricao={`${sinal.parte_nome} · ${reais(sinal.valor_centavos)}. A conta a pagar dele é cancelada junto.`}
        largura={480}
        sujo={motivo.length > 0}
        acaoPrimaria={{ rotulo: 'Cancelar sinal', onClick: cancelar, carregando: enviando, desabilitado: motivo.trim().length < 10 }}
      >
        <Field rotulo="Motivo" obrigatorio ajuda="Pelo menos 10 letras.">
          {a => <Textarea {...a} rows={3} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex.: o grupo não fechou e o fornecedor dispensou o sinal" />}
        </Field>
      </RecordSheet>
    );
  }
  const x = situacaoDoSinal(sinal);
  return (
    <RecordSheet
      aberto
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={`Sinal · ${sinal.parte_nome}`}
      descricao={`Lançado por ${sinal.criado_por || '—'} em ${quandoBR(sinal.criado_em)}`}
      largura={640}
      acaoPrimaria={{ rotulo: 'Fechar', onClick: onFechar }}
      acaoSecundaria={podeCancelar ? { rotulo: 'Cancelar sinal', onClick: () => { setMotivo(''); setCancelando(true); } } : null}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        <dl className="flex flex-col">
          <LinhaDeResumo rotulo="Valor">{reais(sinal.valor_centavos)}</LinhaDeResumo>
          <LinhaDeResumo rotulo="Pago">{reais(sinal.pago_centavos)}</LinhaDeResumo>
          <LinhaDeResumo rotulo="Descontado em faturas">{reais(sinal.compensado_centavos)}</LinhaDeResumo>
          <LinhaDeResumo rotulo="A descontar" forte>{reais(sinal.disponivel)}</LinhaDeResumo>
          <LinhaDeResumo rotulo="Situação"><Pilula tom={x.tom}>{x.rotulo}</Pilula></LinhaDeResumo>
        </dl>
        {sinal.motivo_cancelamento ? <p className="fin-t-body text-[var(--fin-text-2)]">Cancelado: {sinal.motivo_cancelamento}</p> : null}
        {sinal.compensacoes.length ? (
          <section aria-labelledby="t-comp" className="flex flex-col gap-[var(--fin-s-2)]">
            <h3 id="t-comp" className="fin-t-body-strong">Faturas em que foi descontado</h3>
            <ul className="flex flex-col">
              {sinal.compensacoes.map((c, i) => (
                <li key={`${c.fatura_id}-${i}`} className="flex justify-between gap-[var(--fin-s-3)] border-b border-[var(--fin-border)] py-[var(--fin-s-2)] last:border-b-0 fin-t-body">
                  <span>Fatura {c.fatura_numero}{c.desfeita ? ' (desfeita: o valor voltou para o sinal)' : ''}</span>
                  <span className="tabular-nums">{reais(c.valor_centavos)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {sinal.situacao === 'ABERTO' && sinal.pago_centavos > 0 && sinal.compensado_centavos === 0 ? (
          <p className="fin-t-caption text-[var(--fin-text-2)]">Sinal pago: para cancelar, estorne o pagamento antes. Senão, ele é descontado da próxima fatura deste fornecedor.</p>
        ) : null}
      </div>
    </RecordSheet>
  );
}

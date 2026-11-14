'use client';

import * as React from 'react';
import { TriangleAlert } from 'lucide-react';

import type { LinhaDeConta } from '@/lib/contas-pagar-receber';
import type { ItemBaixa, ResultadoItem } from '@/lib/baixas-servidor';
import { descreverMeio, formaEhCartao, formaEhCheque, formasDoLote } from '@/lib/baixa-meio';
import { formatarCambio, formatarNaMoeda, rotuloDaVariacao, type CarimboDoCambio } from '@/lib/cambio';
import { contasParaEscolher } from '@/lib/contas-bancarias-regras';
import { loadEntities } from '@/lib/crm-storage';
import { detalheDaForma, formaDoValor } from '@/lib/formas-pagamento';
import { hojeISO, round2 } from '@/lib/money';
import { toast } from '@/lib/toast';
import { cn, formatBRL, generateId } from '@/lib/utils';
import { CampoCambio } from '@/components/fin/CampoCambio';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { useFormasDePagamento } from '@/components/fin/useFormasDePagamento';
import { Input } from '@/components/ui/input';
import { oferecerAprovacao, type PedidoDeAprovacao } from './aprovacao';
import { levarParaSegundoFator, lembrarSegundoFator, type RespostaComSegundoFator } from '@/components/fin/segundoFatorNaTela';
import { CAMPO, SELECT, Rotulo, ListaDaPrevia } from './pecas';

/**
 * Liquidar várias contas de uma vez (05/11/2026). Sempre pelo POST
 * /api/baixas, o mesmo caminho da liquidação de uma conta:
 *   1. prévia sem encargos, para saber o que a política da agência sugere;
 *   2. prévia final, com juros, multa e desconto da política (se ligado);
 *      conta que não pode ser liquidada sai da lista com o motivo;
 *   3. gravar com Idempotency-Key e, em cada conta, o que a prévia mostrou
 *      (`esperado`): se algo mudou no meio, nada é gravado.
 * O servidor confere direito, conta liberada, alçada e limites; fora deles
 * responde 409 com `pedir_aprovacao`, e o aviso oferece "Pedir aprovação".
 *
 * 06/11/2026 (E7): as formas são as da agência (Formas de pagamento), a
 * conta bancária desativada some da escolha, cada conta em moeda estrangeira
 * tem o próprio câmbio (o valor pago passa a ser o saldo na moeda × câmbio) e
 * cheque/cartão guardam o número do cheque ou os 4 últimos dígitos e a
 * autorização — nunca o número completo do cartão.
 */

type Previa = {
  itens: ItemBaixa[];
  resultado: ResultadoItem[];
  porteiro: { ok: true } | { ok: false; error: string; pedir_aprovacao?: PedidoDeAprovacao };
  removidas: Array<{ linha: LinhaDeConta; motivo: string }>;
};

type ContaDoLote = { id: string; nome: string; moeda?: string; ativo?: unknown };
type CambioDoTitulo = { valor: number; carimbo: CarimboDoCambio | null };

/** Só algarismos, no máximo `max` (o campo dos dígitos do cartão nunca aceita mais que 4). */
const algarismos = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

async function pedirPrevia(itens: ItemBaixa[]): Promise<{ itens: ResultadoItem[]; porteiro: Previa['porteiro'] }> {
  const r = await fetch('/api/baixas', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modo: 'previa', itens }),
  });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof corpo?.error === 'string' ? corpo.error : `Erro ${r.status}`);
  return corpo as { itens: ResultadoItem[]; porteiro: Previa['porteiro'] };
}

export function LiquidarEmLote({
  linhas, contas, onFechar, onConcluido,
}: {
  /** null = fechado. */
  linhas: LinhaDeConta[] | null;
  contas: Array<{ id: string; nome: string }>;
  onFechar: () => void;
  onConcluido: () => void;
}) {
  const aberto = linhas !== null;
  const [data, setData] = React.useState(hojeISO());
  const [contaId, setContaId] = React.useState('');
  const [forma, setForma] = React.useState('');
  const [cheque, setCheque] = React.useState('');
  const [ultimos4, setUltimos4] = React.useState('');
  const [autorizacao, setAutorizacao] = React.useState('');
  const [cambios, setCambios] = React.useState<Record<string, CambioDoTitulo>>({});
  const [contasLidas, setContasLidas] = React.useState<ContaDoLote[] | null>(null);
  const todasAsFormas = useFormasDePagamento();
  const [politica, setPolitica] = React.useState(true);
  const [previa, setPrevia] = React.useState<Previa | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [calculando, setCalculando] = React.useState(false);
  const [gravando, setGravando] = React.useState(false);
  const [chave, setChave] = React.useState(generateId());

  const elegiveis = React.useMemo(
    () => (linhas ?? []).filter(l => (l.situacao === 'em_aberto' || l.situacao === 'em_atraso') && l.saldo > 0),
    [linhas],
  );
  const deFora = React.useMemo(
    () => (linhas ?? []).filter(l => !elegiveis.includes(l)).map(l => ({
      linha: l, motivo: l.situacao === 'cancelado' ? 'Cancelada.' : l.tipo === 'pagar' ? 'Já está paga.' : 'Já está recebida.',
    })),
    [linhas, elegiveis],
  );

  // Abriu de novo: volta ao começo.
  React.useEffect(() => {
    if (!aberto) return;
    setData(hojeISO()); setContaId(''); setForma(''); setPolitica(true); setPrevia(null); setErro(null);
    setCheque(''); setUltimos4(''); setAutorizacao(''); setCambios({});
  }, [aberto]);

  // Contas bancárias com moeda e situação (a desativada some da escolha).
  React.useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    loadEntities<ContaDoLote>('contas-bancarias')
      .then(l => { if (vivo) setContasLidas(l.map(c => ({ id: c.id, nome: c.nome || 'Conta', moeda: c.moeda, ativo: c.ativo }))); })
      .catch(() => { if (vivo) setContasLidas(null); });
    return () => { vivo = false; };
  }, [aberto]);
  const contasDaEscolha = React.useMemo(
    () => contasParaEscolher<ContaDoLote>(contasLidas ?? contas, contaId || null),
    [contasLidas, contas, contaId],
  );

  const sentidos = React.useMemo(
    () => new Set<'pagar' | 'receber'>(elegiveis.map(l => l.tipo)),
    [elegiveis],
  );
  const formasDaEscolha = React.useMemo(() => formasDoLote(todasAsFormas, sentidos), [todasAsFormas, sentidos]);
  const formaEscolhida = formaDoValor(forma, todasAsFormas);
  const ehCheque = formaEhCheque(forma);
  const ehCartao = formaEhCartao(forma);
  const emMoeda = React.useMemo(() => elegiveis.filter(l => l.moeda && l.moeda !== 'BRL'), [elegiveis]);
  const moedaDaConta = (contasLidas ?? []).find(c => c.id === contaId)?.moeda;
  const contaEmMoeda = Boolean(moedaDaConta && moedaDaConta !== 'BRL');
  // O que a prévia e a gravação levam de cheque/cartão (só o que vale para a forma).
  const meio = React.useMemo(() => ({
    ...(ehCheque && cheque ? { cheque_numero: cheque } : {}),
    ...(ehCartao && ultimos4 ? { cartao_ultimos4: ultimos4 } : {}),
    ...(ehCartao && autorizacao.trim() ? { cartao_autorizacao: autorizacao.trim() } : {}),
  }), [ehCheque, ehCartao, cheque, ultimos4, autorizacao]);

  function escolherForma(v: string) {
    setForma(v);
    // A conta padrão da forma entra quando a pessoa ainda não escolheu uma.
    const f = formaDoValor(v, todasAsFormas);
    if (!contaId && f?.conta_bancaria_id && contasDaEscolha.some(c => c.id === f.conta_bancaria_id)) setContaId(f.conta_bancaria_id);
  }

  React.useEffect(() => {
    if (!aberto || elegiveis.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(data)) { setPrevia(null); return; }
    let vivo = true;
    const montar = (
      ls: LinhaDeConta[], sugeridos?: Map<string, ResultadoItem['encargos_sugeridos']>, saldosNaMoeda?: Map<string, number>,
    ): ItemBaixa[] => ls.map(l => {
      const s = sugeridos?.get(l.chave);
      const juros = s ? s.juros : 0;
      const multa = s ? s.multa : 0;
      const desconto = s ? s.desconto_antecipacao : 0;
      const c = cambios[l.chave];
      const comCambio = Boolean(c && c.valor > 0 && l.moeda && l.moeda !== 'BRL');
      // Com câmbio, quita o que falta NA MOEDA pelo câmbio do dia; a
      // diferença para o câmbio lançado vira variação cambial no servidor.
      const naMoeda = comCambio ? saldosNaMoeda?.get(l.chave) : undefined;
      const principal = naMoeda !== undefined ? round2(naMoeda * c!.valor) : l.saldo;
      return {
        titulo_tabela: l.tabela, titulo_id: l.id, data,
        // Conta já paga em parte continua na mesma conta bancária das parcelas anteriores.
        conta_bancaria_id: l.parcial ? null : contaId || null,
        forma, valor: round2(principal + juros + multa - desconto), juros, multa, desconto,
        ...(comCambio ? { cambio: c!.valor, cambio_carimbo: c!.carimbo } : {}),
        ...meio,
      };
    });
    const t = setTimeout(async () => {
      setCalculando(true);
      setErro(null);
      try {
        const primeira = await pedirPrevia(montar(elegiveis));
        if (!vivo) return;
        const removidas: Previa['removidas'] = [];
        const restantes: LinhaDeConta[] = [];
        elegiveis.forEach((l, i) => {
          const e = primeira.itens[i]?.plano.erros ?? [];
          if (e.length) removidas.push({ linha: l, motivo: e[0] }); else restantes.push(l);
        });
        if (restantes.length === 0) {
          setPrevia({ itens: [], resultado: [], porteiro: { ok: true }, removidas });
          return;
        }
        const sugeridos = new Map(restantes.map(l => [l.chave, primeira.itens[elegiveis.indexOf(l)].encargos_sugeridos]));
        const saldosNaMoeda = new Map<string, number>();
        for (const l of restantes) {
          const cb = primeira.itens[elegiveis.indexOf(l)].cambio;
          if (cb) saldosNaMoeda.set(l.chave, cb.saldo_moeda);
        }
        const itens = montar(restantes, politica ? sugeridos : undefined, saldosNaMoeda);
        const final = await pedirPrevia(itens);
        if (!vivo) return;
        setPrevia({ itens, resultado: final.itens, porteiro: final.porteiro, removidas });
        // Pedido novo, chave nova: a mesma chave só serve para repetir o mesmo pedido.
        setChave(generateId());
      } catch (e) {
        if (vivo) { setPrevia(null); setErro(e instanceof Error ? e.message : 'A prévia falhou.'); }
      } finally {
        if (vivo) setCalculando(false);
      }
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [aberto, elegiveis, data, contaId, forma, politica, cambios, meio]);

  async function gravar() {
    if (!previa || previa.itens.length === 0 || gravando) return;
    setGravando(true);
    const corpoDoPedido = {
      modo: 'gravar',
      itens: previa.itens.map((it, i) => ({
        ...it,
        esperado: { status_depois: previa.resultado[i].plano.status_depois, valor_baixado_depois: previa.resultado[i].plano.valor_baixado_depois },
      })),
    };
    try {
      const r = await fetch('/api/baixas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': chave },
        body: JSON.stringify(corpoDoPedido),
      });
      const corpo = (await r.json().catch(() => ({}))) as RespostaComSegundoFator & { error?: string; pedir_aprovacao?: PedidoDeAprovacao };
      if (r.status === 409 && corpo.pedir_aprovacao) {
        oferecerAprovacao(corpo.error || 'Precisa de aprovação.', corpo.pedir_aprovacao, corpoDoPedido, chave);
        onFechar();
        return;
      }
      // Sem a verificação em duas etapas (E7): o aviso leva a Meu perfil.
      if (levarParaSegundoFator(r.status, corpo)) { onFechar(); return; }
      if (!r.ok) { setErro(corpo.error || `Erro ${r.status}`); return; }
      lembrarSegundoFator(corpo);
      const n = previa.itens.length;
      toast.success(n === 1 ? 'Conta liquidada' : `${n} contas liquidadas`, 'O caixa e o extrato já mostram as baixas.');
      onConcluido();
    } catch {
      setErro('Sem resposta do servidor. Nada foi gravado; tente de novo.');
    } finally {
      setGravando(false);
    }
  }

  const resultado = previa?.resultado ?? [];
  const soma = (tipo: 'contas_pagar' | 'contas_receber') =>
    round2(resultado.filter(r => r.titulo_tabela === tipo).reduce((s, r) => s + r.plano.valor, 0));
  const nPagar = resultado.filter(r => r.titulo_tabela === 'contas_pagar').length;
  const nReceber = resultado.length - nPagar;
  const encargos = round2(resultado.reduce((s, r) => s + r.plano.juros + r.plano.multa - r.plano.desconto, 0));
  const foraDaLista = [...deFora, ...(previa?.removidas ?? [])];
  const n = previa?.itens.length ?? 0;

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={elegiveis.length === 1 ? 'Liquidar conta' : `Liquidar ${elegiveis.length} contas`}
      descricao="Registra o pagamento ou o recebimento de cada conta pelo saldo em aberto, na data e na conta bancária escolhidas."
      largura={640}
      resumo={previa && n > 0 ? (
        <span className="tabular-nums">
          {nReceber > 0 ? <>Recebe <b className="text-[var(--fin-text)]">{formatBRL(soma('contas_receber'))}</b> de {nReceber === 1 ? '1 conta' : `${nReceber} contas`}</> : null}
          {nReceber > 0 && nPagar > 0 ? ' e ' : null}
          {nPagar > 0 ? <>{nReceber > 0 ? 'paga' : 'Paga'} <b className="text-[var(--fin-text)]">{formatBRL(soma('contas_pagar'))}</b> de {nPagar === 1 ? '1 conta' : `${nPagar} contas`}</> : null}
          {encargos !== 0 ? <>, com {formatBRL(Math.abs(encargos))} de {encargos > 0 ? 'juros e multa' : 'desconto'}</> : null}.
        </span>
      ) : null}
      acaoPrimaria={{
        rotulo: n <= 1 ? 'Liquidar' : `Liquidar ${n} contas`,
        onClick: gravar,
        carregando: gravando,
        desabilitado: calculando || !previa || n === 0,
      }}
      acaoSecundaria={{ rotulo: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
          <Rotulo texto="Data do pagamento">
            <Input type="date" value={data} onChange={e => setData(e.target.value)} className={CAMPO} />
          </Rotulo>
          <Rotulo texto="Conta bancária">
            <select value={contaId} onChange={e => setContaId(e.target.value)} className={SELECT}>
              <option value="">A prevista em cada conta</option>
              {contasDaEscolha.map(c => (
                <option key={c.id} value={c.id}>{c.nome}{c.moeda && c.moeda !== 'BRL' ? ` (${c.moeda})` : ''}</option>
              ))}
            </select>
          </Rotulo>
          <Rotulo texto="Forma" ajuda={formaEscolhida ? detalheDaForma(formaEscolhida) || undefined : undefined}>
            <select value={forma} onChange={e => escolherForma(e.target.value)} className={SELECT}>
              <option value="">Não informar</option>
              {formasDaEscolha.map(f => <option key={f.codigo} value={f.codigo}>{f.nome}</option>)}
            </select>
          </Rotulo>
        </div>

        {ehCheque ? (
          <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
            <Rotulo texto="Nº do cheque" ajuda={elegiveis.length > 1 ? 'Um cheque para todas as contas da lista.' : undefined}>
              <Input
                inputMode="numeric"
                autoComplete="off"
                maxLength={12}
                value={cheque}
                onChange={e => setCheque(algarismos(e.target.value, 12))}
                placeholder="000123"
                className={cn(CAMPO, 'tabular-nums')}
              />
            </Rotulo>
          </div>
        ) : null}
        {ehCartao ? (
          <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
            <Rotulo texto="Final do cartão" ajuda="Só os 4 últimos dígitos.">
              <Input
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={ultimos4}
                onChange={e => setUltimos4(algarismos(e.target.value, 4))}
                placeholder="1234"
                aria-describedby="lote-cartao-aviso"
                className={cn(CAMPO, 'tabular-nums')}
              />
            </Rotulo>
            <Rotulo texto="Autorização" ajuda="O código do comprovante.">
              <Input
                autoComplete="off"
                maxLength={20}
                value={autorizacao}
                onChange={e => setAutorizacao(e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 20))}
                placeholder="A1B2C3"
                className={cn(CAMPO, 'uppercase tabular-nums')}
              />
            </Rotulo>
            <p id="lote-cartao-aviso" className="fin-t-caption self-end text-[var(--fin-text-3)] sm:pb-[var(--fin-s-2)]">
              O número completo do cartão nunca é pedido nem guardado.
            </p>
          </div>
        ) : null}

        {emMoeda.length > 0 ? (
          <fieldset className="flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] p-[var(--fin-s-3)]">
            <legend className="px-1 fin-t-body-strong text-[var(--fin-text)]">Câmbio de cada conta em moeda</legend>
            <p className="fin-t-caption text-[var(--fin-text-2)]">
              {contaEmMoeda
                ? `A conta bancária é em ${moedaDaConta}: informe o câmbio de cada conta.`
                : 'Com o câmbio do dia, a conta é quitada pelo que falta na moeda e a diferença para o câmbio lançado vira variação cambial. Sem câmbio, ela é liquidada pelo saldo em reais, como sempre.'}
            </p>
            <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
              {emMoeda.map(l => {
                const c = cambios[l.chave];
                return (
                  <li key={l.chave} className="grid grid-cols-1 gap-[var(--fin-s-2)] py-[var(--fin-s-3)] first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                    <div className="min-w-0">
                      <p className="truncate fin-t-body-strong text-[var(--fin-text)]">{l.pessoa || 'Sem nome'}</p>
                      <p className="truncate fin-t-caption text-[var(--fin-text-2)]">{l.descricao}</p>
                      <p className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">Em aberto {formatBRL(l.saldo)} · {l.moeda}</p>
                    </div>
                    <CampoCambio
                      moeda={l.moeda}
                      valor={c?.valor ?? 0}
                      carimbo={c?.carimbo ?? null}
                      lado={l.tipo === 'receber' ? 'compra' : 'venda'}
                      obrigatorio={contaEmMoeda}
                      rotulo={`Câmbio (${l.moeda})`}
                      ajuda={`Quantos reais vale 1 ${l.moeda} neste pagamento.`}
                      onChange={(v, k) => setCambios(atual => ({ ...atual, [l.chave]: { valor: v, carimbo: k } }))}
                    />
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : null}
        <label className="inline-flex min-h-11 items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)] lg:min-h-9">
          <input type="checkbox" checked={politica} onChange={e => setPolitica(e.target.checked)} className="size-4 accent-[var(--fin-accent)]" />
          Calcular juros, multa e desconto pela regra da agência
        </label>

        {previa && !previa.porteiro.ok ? (
          <p role="status" className="flex items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-warning-soft)] p-[var(--fin-s-3)] fin-t-body text-[var(--fin-warning-text)]">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{previa.porteiro.error} {previa.porteiro.pedir_aprovacao ? 'Ao confirmar, você poderá pedir aprovação.' : ''}</span>
          </p>
        ) : null}
        {erro ? <p role="alert" className="rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] p-[var(--fin-s-3)] fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : null}

        <ListaDaPrevia
          carregando={calculando && !previa}
          titulo="O que vai acontecer"
          itens={resultado.map(r => {
            const l = elegiveis.find(x => x.tabela === r.titulo_tabela && x.id === r.titulo_id);
            const enc = round2(r.plano.juros + r.plano.multa - r.plano.desconto);
            return {
              chave: `${r.titulo_tabela}:${r.titulo_id}`,
              titulo: r.pessoa || l?.pessoa || 'Sem nome',
              detalhe: r.descricao || l?.descricao || '',
              ok: true,
              valor: r.plano.valor,
              nota: [
                r.cambio ? `${formatarNaMoeda(r.cambio.variacao.valor_moeda, r.cambio.moeda_titulo)} a ${formatarCambio(r.cambio.variacao.cambio_pago)}` : '',
                r.cambio && r.cambio.variacao.resultado !== 0
                  ? `${rotuloDaVariacao(r.cambio.variacao.resultado).toLowerCase()} de ${formatBRL(Math.abs(r.cambio.variacao.resultado))}`
                  : '',
                enc > 0 ? `inclui ${formatBRL(enc)} de juros e multa` : enc < 0 ? `com ${formatBRL(-enc)} de desconto` : '',
                r.plano.saldo_depois > 0 ? `fica ${formatBRL(r.plano.saldo_depois)} em aberto` : r.titulo_tabela === 'contas_pagar' ? 'fica paga' : 'fica recebida',
              ].filter(Boolean).join(' · '),
            };
          })}
          fora={foraDaLista.map(f => ({ chave: f.linha.chave, titulo: f.linha.pessoa || 'Sem nome', detalhe: f.linha.descricao, motivo: f.motivo }))}
        />
        {descreverMeio(meio) ? (
          <p className="fin-t-caption text-[var(--fin-text-2)]">
            Fica registrado em cada baixa: {descreverMeio(meio)}.
          </p>
        ) : null}
        {elegiveis.some(l => l.parcial) && contaId ? (
          <p className={cn('fin-t-caption text-[var(--fin-text-3)]')}>
            Contas já pagas em parte continuam na conta bancária das parcelas anteriores.
          </p>
        ) : null}
      </div>
    </RecordSheet>
  );
}

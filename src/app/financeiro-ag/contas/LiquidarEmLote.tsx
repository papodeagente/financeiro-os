'use client';

import * as React from 'react';
import { TriangleAlert } from 'lucide-react';

import type { LinhaDeConta } from '@/lib/contas-pagar-receber';
import type { ItemBaixa, ResultadoItem } from '@/lib/baixas-servidor';
import { hojeISO, round2 } from '@/lib/money';
import { toast } from '@/lib/toast';
import { cn, formatBRL, generateId } from '@/lib/utils';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Input } from '@/components/ui/input';
import { oferecerAprovacao, type PedidoDeAprovacao } from './aprovacao';
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
 */

type Previa = {
  itens: ItemBaixa[];
  resultado: ResultadoItem[];
  porteiro: { ok: true } | { ok: false; error: string; pedir_aprovacao?: PedidoDeAprovacao };
  removidas: Array<{ linha: LinhaDeConta; motivo: string }>;
};

const FORMAS = [
  { valor: '', rotulo: 'Não informar' },
  { valor: 'PIX', rotulo: 'Pix' },
  { valor: 'TED', rotulo: 'Transferência (TED)' },
  { valor: 'BOLETO', rotulo: 'Boleto' },
  { valor: 'CARTAO', rotulo: 'Cartão' },
  { valor: 'DINHEIRO', rotulo: 'Dinheiro' },
  { valor: 'CHEQUE', rotulo: 'Cheque' },
  { valor: 'DEPOSITO', rotulo: 'Depósito' },
];

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
  }, [aberto]);

  React.useEffect(() => {
    if (!aberto || elegiveis.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(data)) { setPrevia(null); return; }
    let vivo = true;
    const montar = (ls: LinhaDeConta[], sugeridos?: Map<string, ResultadoItem['encargos_sugeridos']>): ItemBaixa[] => ls.map(l => {
      const s = sugeridos?.get(l.chave);
      const juros = s ? s.juros : 0;
      const multa = s ? s.multa : 0;
      const desconto = s ? s.desconto_antecipacao : 0;
      return {
        titulo_tabela: l.tabela, titulo_id: l.id, data,
        // Conta já paga em parte continua na mesma conta bancária das parcelas anteriores.
        conta_bancaria_id: l.parcial ? null : contaId || null,
        forma, valor: round2(l.saldo + juros + multa - desconto), juros, multa, desconto,
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
        const itens = montar(restantes, politica ? sugeridos : undefined);
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
  }, [aberto, elegiveis, data, contaId, forma, politica]);

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
      const corpo = (await r.json().catch(() => ({}))) as { error?: string; pedir_aprovacao?: PedidoDeAprovacao };
      if (r.status === 409 && corpo.pedir_aprovacao) {
        oferecerAprovacao(corpo.error || 'Precisa de aprovação.', corpo.pedir_aprovacao, corpoDoPedido, chave);
        onFechar();
        return;
      }
      if (!r.ok) { setErro(corpo.error || `Erro ${r.status}`); return; }
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
              {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Rotulo>
          <Rotulo texto="Forma">
            <select value={forma} onChange={e => setForma(e.target.value)} className={SELECT}>
              {FORMAS.map(f => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
            </select>
          </Rotulo>
        </div>
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
                enc > 0 ? `inclui ${formatBRL(enc)} de juros e multa` : enc < 0 ? `com ${formatBRL(-enc)} de desconto` : '',
                r.plano.saldo_depois > 0 ? `fica ${formatBRL(r.plano.saldo_depois)} em aberto` : r.titulo_tabela === 'contas_pagar' ? 'fica paga' : 'fica recebida',
              ].filter(Boolean).join(' · '),
            };
          })}
          fora={foraDaLista.map(f => ({ chave: f.linha.chave, titulo: f.linha.pessoa || 'Sem nome', detalhe: f.linha.descricao, motivo: f.motivo }))}
        />
        {elegiveis.some(l => l.parcial) && contaId ? (
          <p className={cn('fin-t-caption text-[var(--fin-text-3)]')}>
            Contas já pagas em parte continuam na conta bancária das parcelas anteriores.
          </p>
        ) : null}
      </div>
    </RecordSheet>
  );
}

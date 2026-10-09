'use client';

import { useEffect, useMemo, useState } from 'react';

import type { ContaReceber } from '@/lib/crm-types';
import { updateEntity } from '@/lib/crm-storage';
import { hojeISO, num, round2 } from '@/lib/money';
import { normalizarPlataforma, type DescontoPadrao } from '@/lib/taxa-plataforma';
import { nomeDaPlataforma, plataformaDaConta } from '@/lib/plataformas/rotulo';
import { toast } from '@/lib/toast';
import { DialogBaixa } from './DialogBaixa';

export type BaixaDeReceberProps = {
  /** A conta a receber; null fecha o diálogo. */
  conta: ContaReceber | null;
  onFechar: () => void;
  /** Depois de gravar: a tela recarrega o que mostra. */
  onRegistrada?: () => void;
  /** Plataformas que a agência já usou, para o seletor aprender. */
  plataformasUsadas?: string[];
};

/** Quanto ainda falta receber (desconta baixas parciais já lançadas). */
export function valorEmAberto(i: ContaReceber): number {
  return round2(num(i.valor_final) - num(i.valor_recebido));
}

/**
 * A baixa de uma conta a receber, num lugar só.
 *
 * A tela de contas a receber e a visão geral abrem ESTE componente: não
 * existe um segundo caminho de baixa. A regra vive aqui:
 *  - valor >= saldo em aberto  → RECEBIDO, valor_recebido = valor_final
 *  - valor < saldo em aberto   → PARCIAL, valor_recebido ACUMULA as baixas
 *  - a taxa da plataforma ACUMULA, como o valor recebido.
 * Nunca marca RECEBIDO integral quando entrou menos do que o devido.
 */
export function BaixaDeReceber({ conta, onFechar, onRegistrada, plataformasUsadas = [] }: BaixaDeReceberProps) {
  const [descontosPadrao, setDescontosPadrao] = useState<DescontoPadrao[]>([]);
  const [baixando, setBaixando] = useState(false);

  // Sem os padrões a baixa só não vem pré-calculada: falhar aqui não trava nada.
  useEffect(() => {
    let vivo = true;
    fetch('/api/plataformas/descontos')
      .then(r => (r.ok ? r.json() : null))
      .then((corpo: { padroes?: DescontoPadrao[] } | null) => {
        if (vivo && corpo && Array.isArray(corpo.padroes)) setDescontosPadrao(corpo.padroes);
      })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, []);

  const usadas = useMemo(
    () => [...plataformasUsadas, ...descontosPadrao.map(p => p.plataforma)].filter(Boolean),
    [plataformasUsadas, descontosPadrao],
  );

  async function guardarDescontoPadrao(padrao: DescontoPadrao) {
    try {
      const res = await fetch('/api/plataformas/descontos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(padrao),
      });
      const corpo = (await res.json().catch(() => ({}))) as { padroes?: DescontoPadrao[]; error?: string };
      if (!res.ok) throw new Error(corpo.error || `Erro ${res.status}`);
      if (Array.isArray(corpo.padroes)) setDescontosPadrao(corpo.padroes);
      toast.success('Desconto padrão guardado.');
    } catch (e) {
      toast.error('O recebimento foi registrado, mas o desconto padrão não foi guardado.', e instanceof Error ? e.message : '');
    }
  }

  async function baixar(
    item: ContaReceber,
    dados: { valorInformado: number; taxaInformada: number; plataforma: string; novoPadrao: DescontoPadrao | null },
  ) {
    const informado = round2(dados.valorInformado);
    if (informado <= 0) return;

    const acumulado = round2(num(item.valor_recebido) + informado);
    // tolerância de meio centavo pra não deixar conta aberta por arredondamento
    const quitado = acumulado >= round2(num(item.valor_final)) - 0.005;
    const taxaAcumulada = round2(num(item.taxa) + Math.max(0, round2(dados.taxaInformada)));
    const plataforma = normalizarPlataforma(dados.plataforma) || (item.taxa_plataforma ?? '');
    const atualizada: ContaReceber = {
      ...item,
      status: quitado ? 'RECEBIDO' : 'PARCIAL',
      data_recebimento: hojeISO(),
      valor_recebido: quitado ? round2(num(item.valor_final)) : acumulado,
      taxa: taxaAcumulada,
      taxa_plataforma: taxaAcumulada > 0 ? plataforma : (item.taxa_plataforma ?? ''),
    };
    setBaixando(true);
    try {
      await updateEntity('contas-receber', atualizada);
      onFechar();
      toast.success(quitado ? 'Conta marcada como recebida.' : 'Recebimento em parte registrado.');
      // O padrão é guardado DEPOIS da baixa e à parte dela: falhar aqui não
      // pode desfazer nem esconder um recebimento que já foi registrado.
      if (dados.novoPadrao) await guardarDescontoPadrao(dados.novoPadrao);
      onRegistrada?.();
    } catch {
      toast.error('Não foi possível registrar o recebimento.');
    } finally {
      setBaixando(false);
    }
  }

  return (
    <DialogBaixa
      aberto={conta !== null}
      onOpenChange={aberto => { if (!aberto) onFechar(); }}
      contaId={conta?.id ?? null}
      cliente={conta?.cliente_nome ?? ''}
      descricao={conta?.descricao ?? ''}
      valorDaConta={conta ? num(conta.valor_final) : 0}
      jaRecebido={conta ? num(conta.valor_recebido) : 0}
      emAberto={conta ? valorEmAberto(conta) : 0}
      taxaJaRetida={conta ? num(conta.taxa) : 0}
      // Conta que veio de integração já sabe a plataforma: o padrão dela
      // entra sozinho, sem a pessoa precisar escolher.
      plataformaAtual={conta ? normalizarPlataforma(conta.taxa_plataforma) || nomeDaPlataforma(plataformaDaConta(conta) ?? '') : ''}
      plataformasUsadas={usadas}
      descontosPadrao={descontosPadrao}
      processando={baixando}
      onConfirmar={dados => (conta ? baixar(conta, dados) : undefined)}
    />
  );
}

export default BaixaDeReceber;

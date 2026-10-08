'use client';

import Link from 'next/link';

import { RecordSheet } from '@/components/fin/RecordSheet';
import { Money } from '@/components/fin/Money';
import { EtiquetaDaPlataforma } from '@/components/fin/EtiquetaDaPlataforma';
import type { ContaReceber } from '@/lib/crm-types';
import { num, round2 } from '@/lib/money';
import { descreverFormaDePagamento, descreverParcelamento } from '@/lib/plataformas/antecipacao';
import { descricaoSemPlataforma, nomeDaPlataforma, plataformaDaConta } from '@/lib/plataformas/rotulo';
import { formatBRL } from '@/lib/utils';

export type DetalheDaPlataformaProps = {
  conta: ContaReceber | null;
  onFechar: () => void;
};

function dataBR(iso: string | null | undefined): string {
  const s = String(iso ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : '';
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 border-b border-[var(--fin-border)] py-[var(--fin-s-3)] last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-[var(--fin-s-3)]">
      <dt className="fin-t-body text-[var(--fin-text-3)]">{rotulo}</dt>
      <dd className="min-w-0 break-words fin-t-body text-[var(--fin-text)]">{children}</dd>
    </div>
  );
}

/**
 * Como o cliente pagou um lançamento que veio de uma plataforma.
 *
 * Pedido do Bruno (08/10/2026): a venda antecipada entra num lançamento só,
 * e ao clicar nele aparece como aconteceu: em quantas vezes o cliente
 * parcelou, o valor da parcela, o cartão ou a forma de pagamento.
 */
export function DetalheDaPlataforma({ conta, onFechar }: DetalheDaPlataformaProps) {
  const plataforma = plataformaDaConta(conta);
  const nome = plataforma ? nomeDaPlataforma(plataforma) : '';
  const bruto = round2(num(conta?.valor_final));
  const taxa = round2(num(conta?.plataforma_taxa));
  const liquido = conta?.plataforma_liquido !== undefined ? round2(num(conta.plataforma_liquido)) : round2(bruto - taxa);
  const parcelas = Math.max(1, Math.trunc(num(conta?.plataforma_parcelas_comprador)) || 1);
  const recebida = conta?.status === 'RECEBIDO';
  const repasse = dataBR(conta?.plataforma_data_repasse || conta?.data_vencimento);
  const outrosIds = (conta?.plataforma_ids ?? []).filter(i => i && i !== conta?.plataforma_transacao);

  const quando = recebida
    ? `Caiu no banco${dataBR(conta?.data_recebimento) ? ` em ${dataBR(conta?.data_recebimento)}` : ''}.`
    : conta?.status === 'CANCELADO'
      ? 'Cancelada: não entra no caixa.'
      : `Previsto para ${repasse || 'a data do repasse'}.`;

  return (
    <RecordSheet
      aberto={conta !== null}
      onOpenChange={aberto => { if (!aberto) onFechar(); }}
      titulo={conta ? `Como ${conta.cliente_nome || 'o cliente'} pagou` : 'Como foi pago'}
      descricao={conta ? descricaoSemPlataforma(conta.descricao || '', plataforma) : undefined}
      acaoPrimaria={{ rotulo: 'Fechar', onClick: onFechar }}
      acaoSecundaria={null}
    >
      {conta ? (
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          <div className="flex flex-wrap items-end justify-between gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)] p-[var(--fin-s-4)]">
            <div className="flex flex-col gap-1">
              <span className="fin-t-caption text-[var(--fin-text-3)]">Valor da venda</span>
              <Money valor={bruto} estado="ok" size="metric" align="esquerda" className="min-w-0" />
            </div>
            {plataforma ? <EtiquetaDaPlataforma plataforma={plataforma} /> : null}
          </div>

          <dl className="flex flex-col">
            <Linha rotulo="Forma de pagamento">
              {descreverFormaDePagamento(conta.plataforma_forma || conta.forma_recebimento, conta.plataforma_cartao, conta.plataforma_cartao_final)}
            </Linha>
            <Linha rotulo="Parcelamento do cliente">
              {descreverParcelamento(parcelas, conta.plataforma_valor_parcela_comprador ?? undefined, formatBRL)}
              {parcelas > 1 && conta.plataforma_antecipada ? (
                <span className="block fin-t-caption text-[var(--fin-text-3)]">
                  O cliente paga em {parcelas}x no cartão, mas a {nome} antecipa: a agência recebe a venda inteira de uma vez.
                </span>
              ) : null}
            </Linha>
            <Linha rotulo="Recebimento">
              {conta.plataforma_antecipada ? 'Antecipado. ' : ''}{quando}
            </Linha>
            {taxa > 0 ? (
              <Linha rotulo={`Taxas da ${nome}`}>
                <span className="tabular-nums">{formatBRL(taxa)}</span>
                <span className="block fin-t-caption text-[var(--fin-text-3)]">Inclui o custo da antecipação, quando houver.</span>
              </Linha>
            ) : null}
            <Linha rotulo="Cai no banco">
              <span className="fin-t-body-strong tabular-nums">{formatBRL(liquido)}</span>
            </Linha>
            <Linha rotulo={`Pedido na ${nome}`}>
              <span className="font-mono text-[13px]">{conta.plataforma_transacao || '—'}</span>
              {outrosIds.length > 0 ? (
                <span className="block fin-t-caption text-[var(--fin-text-3)]">
                  Também conhecido como {outrosIds.join(', ')}
                </span>
              ) : null}
            </Linha>
            <Linha rotulo="Venda do CRM">
              {conta.venda_id ? (
                <Link href={`/vendas/${conta.venda_id}`} className="text-[var(--fin-accent)] underline-offset-2 hover:underline">
                  Abrir a venda
                </Link>
              ) : (
                <span>
                  Nenhuma venda do CRM ligada.{' '}
                  <Link href="/financeiro-ag/recebimentos" className="text-[var(--fin-accent)] underline-offset-2 hover:underline">
                    Conferir em Recebimentos
                  </Link>
                </span>
              )}
            </Linha>
          </dl>
        </div>
      ) : null}
    </RecordSheet>
  );
}

export default DetalheDaPlataforma;

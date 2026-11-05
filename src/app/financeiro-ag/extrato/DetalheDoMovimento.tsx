'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { RecordSheet } from '@/components/fin/RecordSheet';
import type { MovimentoCaixa } from '@/lib/movimentos-caixa';
import { cn, formatBRL } from '@/lib/utils';
import { ROTULO_DA_ORIGEM } from './GradeDeMovimentos';
import { dataCurta } from './periodos';

/** Onde se abre o registro que gerou o movimento (05/11/2026). */
export function linkDoRegistro(l: MovimentoCaixa): { href: string; rotulo: string } {
  const id = encodeURIComponent(l.registro_id);
  if (l.registro_tabela === 'contas_receber') return { href: `/financeiro-ag/receber?abrir=${id}`, rotulo: 'Abrir a conta a receber' };
  if (l.registro_tabela === 'contas_pagar') return { href: `/financeiro-ag/pagar?abrir=${id}`, rotulo: 'Abrir a conta a pagar' };
  return { href: '/financeiro-ag/transferencias', rotulo: 'Ver transferências' };
}

/**
 * O lançamento por inteiro, numa janela no centro e só de leitura. Mexer no
 * lançamento é na tela dele, pelo link: o extrato não tem segundo caminho de
 * edição nem de baixa.
 */
export function DetalheDoMovimento({ linha, multiConta, onFechar }: {
  linha: MovimentoCaixa | null;
  multiConta: boolean;
  onFechar: () => void;
}) {
  const l = linha;
  const campos: Array<[string, string]> = l ? [
    ['Data', l.data ? dataCurta(l.data) : 'Sem data (entra no saldo anterior de qualquer período)'],
    ['Conta', l.conta_nome],
    ['Origem', `${ROTULO_DA_ORIGEM[l.origem]}${l.plataforma ? ` · via ${l.plataforma}` : ''}`],
    ['Pessoa', l.pessoa_nome],
    ['CPF/CNPJ', l.cpf_cnpj],
    ['Número', l.numero],
    ['Venda', l.venda_numero || l.venda_id],
    ['Documento', l.documento],
    ['Forma', l.forma],
    ['Cheque/Cartão', l.cartao_cheque],
    ['Moeda de origem', l.moeda !== 'BRL' && l.valor_origem !== null
      ? `${l.moeda} ${l.valor_origem.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${l.cambio ? ` · câmbio ${l.cambio.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}` : ''}`
      : ''],
    ['Saldo da conta depois', formatBRL(l.saldo_conta)],
    ...(multiConta ? [['Saldo das contas escolhidas depois', formatBRL(l.saldo_total)] as [string, string]] : []),
    ['Informações', l.informacoes],
  ].filter(([, v]) => v) as Array<[string, string]> : [];
  const destino = l ? linkDoRegistro(l) : null;

  return (
    <RecordSheet
      aberto={l !== null}
      onOpenChange={v => { if (!v) onFechar(); }}
      titulo={l ? (l.descricao || ROTULO_DA_ORIGEM[l.origem]) : ''}
      descricao={l ? `${l.valor >= 0 ? 'Entrada' : 'Saída'} de ${formatBRL(Math.abs(l.valor))}` : undefined}
      largura={640}
      acaoPrimaria={{ rotulo: 'Fechar', onClick: onFechar }}
      acaoSecundaria={null}
      resumo={destino ? (
        <Link
          href={destino.href}
          className="inline-flex min-h-11 items-center gap-1 fin-t-body font-medium text-[var(--fin-accent)] underline-offset-2 hover:underline lg:min-h-9"
        >
          {destino.rotulo}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      ) : null}
    >
      {l ? (
        <dl className="grid grid-cols-1 gap-x-[var(--fin-s-5)] gap-y-[var(--fin-s-3)] sm:grid-cols-2">
          {campos.map(([rotulo, valor]) => (
            <div key={rotulo} className={cn('min-w-0', rotulo === 'Informações' && 'sm:col-span-2')}>
              <dt className="fin-t-caption text-[var(--fin-text-3)]">{rotulo}</dt>
              <dd className="fin-t-body text-[var(--fin-text)] [overflow-wrap:anywhere]">{valor}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </RecordSheet>
  );
}

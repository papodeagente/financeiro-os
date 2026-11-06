'use client';

import * as React from 'react';
import Link from 'next/link';

import { usePermissoes } from '@/app/financeiro-ag/contas/useContas';
import { api, ErroDaCobranca } from '@/lib/cobranca/contrato-telas';
import { mensagemDeErro } from '@/lib/cobranca/regras-telas';
import { formatBRL } from '@/lib/utils';
import { toast } from '@/lib/toast';

/**
 * "Repassar a taxa do boleto" na ficha do cliente (E7, 06/11/2026). Liga e
 * desliga na hora (sem botão de salvar): vale para os próximos boletos,
 * os já emitidos ficam como estão. O valor é o de Configurações › Cobrança.
 */
export function TaxaDeBoletoDoCliente({ clienteId }: { clienteId: string }) {
  const pode = usePermissoes();
  const [estado, setEstado] = React.useState<{ cobrar: boolean; taxa: number } | null>(null);
  const [gravando, setGravando] = React.useState(false);
  const id = React.useId();

  React.useEffect(() => {
    let vivo = true;
    api.taxaDoCliente(clienteId)
      .then(r => { if (vivo) setEstado({ cobrar: r.cobrar_taxa_boleto, taxa: r.taxa_boleto }); })
      .catch(() => { if (vivo) setEstado(null); });
    return () => { vivo = false; };
  }, [clienteId]);

  if (!estado) return null;

  async function mudar(cobrar: boolean) {
    setGravando(true);
    try {
      const r = await api.marcarTaxaDoCliente(clienteId, cobrar);
      setEstado({ cobrar: r.cobrar_taxa_boleto, taxa: r.taxa_boleto });
      toast.success(cobrar ? 'Taxa de boleto ligada para este cliente' : 'Taxa de boleto desligada', 'Vale para os próximos boletos; os já emitidos ficam como estão.');
    } catch (e) {
      toast.error('Não foi possível gravar.', e instanceof ErroDaCobranca ? mensagemDeErro(e.codigo, e.message, e.status) : undefined);
    } finally {
      setGravando(false);
    }
  }

  const semValor = estado.taxa <= 0;
  return (
    <div className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="fin-t-body-strong text-[var(--fin-text)]">Repassar a taxa do boleto</label>
        <p className="fin-t-caption text-[var(--fin-text-3)]">
          {semValor
            ? <>A agência ainda não definiu o valor. Defina em <Link href="/config/cobranca" className="text-[var(--fin-accent)] underline-offset-2 hover:underline">Configurações › Cobrança</Link>.</>
            : <>Soma {formatBRL(estado.taxa)} a cada boleto deste cliente. Pix e link de pagamento não levam a taxa.</>}
        </p>
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={estado.cobrar}
        checked={estado.cobrar}
        disabled={gravando || !pode('gerar_boletos')}
        onChange={e => { void mudar(e.target.checked); }}
        className="size-5 shrink-0 cursor-pointer accent-[var(--fin-accent)] disabled:cursor-not-allowed max-lg:size-6"
      />
    </div>
  );
}

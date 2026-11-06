'use client';

import { ConfirmDialog } from '@/components/fin/ConfirmDialog';

/**
 * Aviso de edição simultânea (06/11/2026, E7): o servidor respondeu 409
 * (`ErroAoGravar.conflito`) porque outra pessoa salvou este registro depois
 * que a tela abriu. Nada foi gravado. A tela oferece recarregar a versão
 * atual; continuar aqui mantém o que a pessoa digitou na tela (para copiar),
 * mas salvar de novo só depois de recarregar.
 */
export function AvisoDeEdicaoSimultanea({
  aberto,
  onOpenChange,
  onRecarregar,
  oQue = 'esta conta',
}: {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  onRecarregar: () => Promise<void> | void;
  /** "esta conta", "esta conta bancária", "este cadastro"... */
  oQue?: string;
}) {
  return (
    <ConfirmDialog
      aberto={aberto}
      onOpenChange={onOpenChange}
      titulo="Outra pessoa mudou isto enquanto você editava"
      oQueVaiAcontecer={`Alguém salvou uma alteração em ${oQue} depois que você abriu. Sua alteração não foi gravada, para não apagar a dela. Recarregue para ver a versão atual e refaça o que precisar.`}
      confirmarRotulo="Recarregar"
      voltarRotulo="Continuar vendo minha versão"
      onConfirmar={onRecarregar}
    />
  );
}

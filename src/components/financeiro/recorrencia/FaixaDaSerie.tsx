'use client';

/**
 * Faixa no lançamento que faz parte de uma repetição (05/11/2026): diz a
 * regra por extenso e oferece "Encerrar repetição", com prévia do que sai
 * (só as contas em aberto daqui para a frente; as pagas ficam).
 */
import * as React from 'react';

import { Callout } from '@/components/fin/Callout';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Money } from '@/components/fin/Money';
import { formatarData } from '@/lib/recorrencia';
import { encerrarSerie, lerSerie, type RespostaEncerramento, type SerieNaTela } from '@/lib/recorrencia-cliente';
import { toast } from '@/lib/toast';

export type FaixaDaSerieProps = {
  serieId: string;
  /** A série lida, para a tela usar a regra e a versão na pergunta de escopo. */
  onSerie?: (s: SerieNaTela | null) => void;
  onEncerrada: () => void;
};

const SITUACAO: Record<SerieNaTela['serie']['status'], string> = {
  ativa: 'As próximas são criadas sozinhas.',
  concluida: 'Todas as contas já foram criadas.',
  encerrada: 'Repetição encerrada.',
};

export function FaixaDaSerie({ serieId, onSerie, onEncerrada }: FaixaDaSerieProps) {
  const [serie, setSerie] = React.useState<SerieNaTela | null>(null);
  const [falhou, setFalhou] = React.useState(false);
  const [previa, setPrevia] = React.useState<RespostaEncerramento | null>(null);
  const [buscando, setBuscando] = React.useState(false);
  const [encerrando, setEncerrando] = React.useState(false);
  const avisar = React.useRef(onSerie);
  avisar.current = onSerie;

  React.useEffect(() => {
    let vivo = true;
    setFalhou(false);
    lerSerie(serieId)
      .then(s => { if (vivo) { setSerie(s); avisar.current?.(s); } })
      .catch(() => { if (vivo) { setFalhou(true); avisar.current?.(null); } });
    return () => { vivo = false; };
  }, [serieId]);

  async function pedirPrevia() {
    setBuscando(true);
    try {
      setPrevia(await encerrarSerie(serieId, { previa: true }));
    } catch (e) {
      toast.error('Não foi possível ver o que sai', e instanceof Error ? e.message : '');
    } finally {
      setBuscando(false);
    }
  }

  async function encerrar() {
    setEncerrando(true);
    try {
      const r = await encerrarSerie(serieId, { previa: false });
      toast.success('Repetição encerrada', r.removidos.length === 1 ? '1 conta em aberto excluída.' : `${r.removidos.length} contas em aberto excluídas.`);
      setPrevia(null);
      onEncerrada();
    } catch (e) {
      toast.error('Não foi possível encerrar', e instanceof Error ? e.message : '');
    } finally {
      setEncerrando(false);
    }
  }

  if (falhou) {
    return (
      <Callout tom="info" titulo="Faz parte de uma repetição">
        Não foi possível carregar a regra agora. A conta pode ser editada normalmente.
      </Callout>
    );
  }
  if (!serie) return null;
  const encerrada = serie.serie.status === 'encerrada';
  const removidos = previa?.removidos ?? [];

  return (
    <>
      <Callout
        tom="info"
        titulo={serie.serie.modo === 'parcelado' ? 'Faz parte de um parcelamento' : 'Faz parte de uma repetição'}
        acao={encerrada ? undefined : { rotulo: 'Encerrar repetição', onClick: () => { void pedirPrevia(); }, carregando: buscando }}
      >
        {serie.serie.descricao_regra}. {SITUACAO[serie.serie.status]}
      </Callout>

      <ConfirmDialog
        aberto={Boolean(previa)}
        onOpenChange={a => { if (!a) setPrevia(null); }}
        titulo="Encerrar esta repetição"
        oQueVaiAcontecer={
          removidos.length === 0
            ? 'Nenhuma conta nova será criada. Não há contas em aberto daqui para a frente para excluir.'
            : 'Nenhuma conta nova será criada, e as contas em aberto daqui para a frente são excluídas. Contas pagas, pagas em parte ou já vencidas ficam.'
        }
        detalhes={previa ? [
          { rotulo: 'Saem', valor: removidos.length === 1 ? '1 conta' : `${removidos.length} contas` },
          ...(removidos.length > 0 ? [
            { rotulo: 'Vencimentos', valor: `${formatarData(removidos[0].vencimento)} a ${formatarData(removidos[removidos.length - 1].vencimento)}` },
            { rotulo: 'Valor que sai', valor: <Money valor={previa.soma} size="strong" estado="ok" /> },
          ] : []),
          { rotulo: 'Ficam', valor: previa.mantidos === 1 ? '1 conta' : `${previa.mantidos} contas` },
        ] : undefined}
        confirmarRotulo="Encerrar repetição"
        tone="destrutivo"
        processando={encerrando}
        onConfirmar={encerrar}
      />
    </>
  );
}

export default FaixaDaSerie;

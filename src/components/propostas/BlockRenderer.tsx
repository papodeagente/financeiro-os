'use client';

import { TextoBlock } from './blocks/TextoBlock';
import { ServicoBlock } from './blocks/ServicoBlock';
import { RoteiroDiaBlock } from './blocks/RoteiroDiaBlock';
import { GaleriaBlock } from './blocks/GaleriaBlock';
import { InclusosBlock } from './blocks/InclusosBlock';
import { ValoresBlock } from './blocks/ValoresBlock';
import { DepoimentoBlock } from './blocks/DepoimentoBlock';
import { CtaBlock } from './blocks/CtaBlock';

interface Props {
  tipo: string;
  conteudo: Record<string, unknown>;
  onChange: (conteudo: Record<string, unknown>) => void;
}

export function BlockRenderer({ tipo, conteudo, onChange }: Props) {
  switch (tipo) {
    case 'TEXTO': return <TextoBlock conteudo={conteudo} onChange={onChange} />;
    case 'SERVICO': return <ServicoBlock conteudo={conteudo} onChange={onChange} />;
    case 'ROTEIRO_DIA': return <RoteiroDiaBlock conteudo={conteudo} onChange={onChange} />;
    case 'GALERIA': return <GaleriaBlock conteudo={conteudo} onChange={onChange} />;
    case 'INCLUSOS': return <InclusosBlock conteudo={conteudo} onChange={onChange} />;
    case 'VALORES': return <ValoresBlock conteudo={conteudo} onChange={onChange} />;
    case 'DEPOIMENTO': return <DepoimentoBlock conteudo={conteudo} onChange={onChange} />;
    case 'CTA': return <CtaBlock conteudo={conteudo} onChange={onChange} />;
    default: return <div className="text-xs text-[var(--t-text-muted)]">Tipo desconhecido: {tipo}</div>;
  }
}

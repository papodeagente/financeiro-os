'use client';

import { MessageSquareText } from 'lucide-react';

import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { PerguntarEmTexto } from '@/components/fin/PerguntarEmTexto';

export function TelaDePerguntar({ inicial }: { inicial: string }) {
  return (
    <MolduraDaPagina>
      <PageHeader
        icone={MessageSquareText}
        titulo="Perguntar ao financeiro"
        subtitulo="Escreva como falaria. A resposta traz o número, o filtro usado e o link para a tela."
      />
      <PerguntarEmTexto perguntaInicial={inicial} enviarAoAbrir={Boolean(inicial)} />
    </MolduraDaPagina>
  );
}

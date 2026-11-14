'use client';

import { FolderInput } from 'lucide-react';

import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';

/** Quem não é administrador vê por que não entra e o que pode consultar. */
export function SoAdministrador() {
  return (
    <MolduraDaPagina>
      <PageHeader
        icone={FolderInput}
        titulo="Mudar para o EnturOS"
        acoesSecundarias={[{ rotulo: 'Checklist de paridade', href: '/mudanca/paridade' }]}
      />
      <EmptyLesson
        motivo="sem-dado"
        titulo="Só o administrador da agência faz a mudança"
        oQueE="A mudança grava contas, pessoas, contas em aberto e saldos de uma vez. Por isso só o administrador começa, aplica, desfaz e conclui."
        comoComeca={[
          'Peça a um administrador da agência para abrir esta tela.',
          'Enquanto isso, o glossário mostra como cada nome do sistema anterior se chama aqui.',
        ]}
        acao={{ rotulo: 'Abrir o glossário', href: '/mudanca/glossario' }}
      />
    </MolduraDaPagina>
  );
}

'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Proposta, Cliente, Membro, createProposta } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { PropostaEditor } from '@/components/propostas/PropostaEditor';

function EditorLoader() {
  const searchParams = useSearchParams();
  const editId = searchParams.get('id');
  const [data, setData] = useState<{ proposta: Proposta; clientes: Cliente[]; membros: Membro[] } | null>(null);

  useEffect(() => {
    Promise.all([
      loadEntities<Cliente>('clientes'),
      loadEntities<Membro>('membros'),
      editId ? fetch(`/api/propostas/${editId}`).then(r => r.json()).catch(() => null) : Promise.resolve(null),
      loadEntities<Proposta>('propostas'),
    ]).then(([cl, mb, existing, all]) => {
      const proposta = existing?.id
        ? existing
        : createProposta(`PROP-${String(all.length + 1).padStart(4, '0')}`);
      setData({ proposta, clientes: cl, membros: mb });
    });
  }, [editId]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--t-green)]" />
      </div>
    );
  }

  return (
    <PropostaEditor
      proposta={data.proposta}
      clientes={data.clientes}
      membros={data.membros}
      isEdit={!!editId}
    />
  );
}

export default function PropostaNovaPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--t-green)]" />
      </div>
    }>
      <EditorLoader />
    </Suspense>
  );
}

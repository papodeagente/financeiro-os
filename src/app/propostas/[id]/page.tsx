'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Proposta, Cliente, Membro } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { PropostaEditor } from '@/components/propostas/PropostaEditor';

export default function EditPropostaPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<{ proposta: Proposta; clientes: Cliente[]; membros: Membro[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/propostas/${id}`).then(r => r.json()),
      loadEntities<Cliente>('clientes'),
      loadEntities<Membro>('membros'),
    ]).then(([proposta, cl, mb]) => {
      if (!proposta?.id) { setError(true); return; }
      setData({ proposta, clientes: cl, membros: mb });
    }).catch(() => setError(true));
  }, [id]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-lg font-medium text-[var(--t-text)]">Proposta nao encontrada</p>
          <p className="text-sm text-[var(--t-text-secondary)] mt-1">ID: {id}</p>
        </div>
      </div>
    );
  }

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
      isEdit={true}
    />
  );
}

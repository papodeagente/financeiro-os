'use client';

import { FolderKanban } from 'lucide-react';

export default function CustosProjetoPage() {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-[var(--t-green-bg)] flex items-center justify-center mx-auto">
          <FolderKanban className="w-8 h-8 text-[var(--t-green)]" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-[var(--t-text)]">Custos de Projeto</h1>
          <p className="text-sm text-[var(--t-text-muted)] mt-1">Em breve</p>
        </div>
      </div>
    </div>
  );
}

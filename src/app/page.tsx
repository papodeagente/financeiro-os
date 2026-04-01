'use client';

import { useState, useEffect, useRef } from 'react';
import { GrupoViagem } from '@/lib/types';
import { createGrupoViagem } from '@/lib/defaults';
import { loadGrupos, saveGrupos, deleteGrupo, exportGrupoJSON, importGrupoJSON } from '@/lib/storage';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Copy, Download, Upload, Trash2, FolderOpen } from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  const [grupos, setGrupos] = useState<GrupoViagem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setGrupos(loadGrupos()); }, []);

  const criarGrupo = () => {
    const novo = createGrupoViagem();
    const updated = [...grupos, novo];
    setGrupos(updated);
    saveGrupos(updated);
  };

  const duplicarGrupo = (g: GrupoViagem) => {
    const copia = { ...JSON.parse(JSON.stringify(g)), id: Date.now().toString(36) + Math.random().toString(36).substring(2, 9), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), grp_id: g.grp_id + ' (copia)' };
    const updated = [...grupos, copia];
    setGrupos(updated);
    saveGrupos(updated);
  };

  const removerGrupo = (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este grupo?')) return;
    deleteGrupo(id);
    setGrupos(grupos.filter(g => g.id !== id));
  };

  const exportar = (g: GrupoViagem) => {
    const json = exportGrupoJSON(g);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${g.grp_id || 'grupo'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const grupo = importGrupoJSON(ev.target?.result as string);
      if (grupo) {
        grupo.id = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
        const updated = [...grupos, grupo];
        setGrupos(updated);
        saveGrupos(updated);
      } else {
        alert('Arquivo JSON invalido');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="min-h-screen">
      <header className="bg-[#1a1a2e] text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Grupos <span className="text-[#d4a853]">OS</span></h1>
            <p className="text-sm text-gray-300 mt-1">Planejamento e precificacao de viagens em grupo</p>
          </div>
          <div className="flex gap-3">
            <Button onClick={criarGrupo} className="bg-[#d4a853] hover:bg-[#c49943] text-[#1a1a2e] font-semibold">
              <Plus className="w-4 h-4 mr-2" /> Novo Grupo
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="border-white/30 text-white hover:bg-white/10">
              <Upload className="w-4 h-4 mr-2" /> Importar JSON
            </Button>
            <input ref={fileInputRef} type="file" accept=".json" onChange={importar} className="hidden" />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {grupos.length === 0 ? (
          <div className="text-center py-20">
            <FolderOpen className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <h2 className="text-xl font-semibold text-gray-600">Nenhum grupo criado</h2>
            <p className="text-gray-400 mt-2">Clique em &quot;Novo Grupo&quot; para comecar</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {grupos.map(g => (
              <Card key={g.id} className="hover:shadow-lg transition-shadow border-l-4 border-l-[#d4a853]">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-bold text-lg text-[#1a1a2e]">{g.grp_id || 'Sem ID'}</h3>
                      <p className="text-sm text-gray-500">{g.origem_destino || 'Sem destino'}</p>
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 mb-4">
                    <div>Criado: {formatDate(g.created_at?.split('T')[0])}</div>
                    <div>Atualizado: {formatDate(g.updated_at?.split('T')[0])}</div>
                    <div>{g.periodos.length} periodo(s) | {g.trechos.length} trecho(s)</div>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/grupo/${g.id}`} className="flex-1">
                      <Button className="w-full bg-[#1a1a2e] hover:bg-[#2a2a4e] text-white" size="sm">
                        <FolderOpen className="w-4 h-4 mr-1" /> Abrir
                      </Button>
                    </Link>
                    <Button variant="outline" size="sm" onClick={() => duplicarGrupo(g)} title="Duplicar"><Copy className="w-4 h-4" /></Button>
                    <Button variant="outline" size="sm" onClick={() => exportar(g)} title="Exportar JSON"><Download className="w-4 h-4" /></Button>
                    <Button variant="outline" size="sm" onClick={() => removerGrupo(g.id)} title="Excluir" className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

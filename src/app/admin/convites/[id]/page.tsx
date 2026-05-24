'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Users as UsersIcon, ExternalLink, Calendar } from 'lucide-react';

interface Convite {
  id: string;
  codigo: string;
  nome: string;
  descricao: string;
  plano_slug: string;
  duracao_dias: number;
  max_usos: number | null;
  usos_atuais: number;
  expira_em: string | null;
  ativo: boolean;
  tag: string;
  created_at: string;
}

interface Uso {
  id: string;
  tenant_id: string;
  tenant_nome: string;
  tenant_slug: string;
  usuario_id: string;
  nome_cliente: string;
  email_cliente: string;
  ip: string;
  user_agent: string;
  used_at: string;
}

export default function AdminConviteDetalhesPage() {
  const params = useParams();
  const id = params?.id as string;
  const [convite, setConvite] = useState<Convite | null>(null);
  const [usos, setUsos] = useState<Uso[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/admin/convites/${id}`).then(r => r.json()).then(data => {
      if (data && !data.error) {
        setConvite(data.convite);
        setUsos(data.usos || []);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!convite) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <Link href="/admin/convites" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
        <p className="mt-6 text-slate-600">Convite não encontrado.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Link href="/admin/convites" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 mb-4">
        <ArrowLeft className="w-4 h-4" /> Convites
      </Link>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{convite.nome}</h1>
        {convite.descricao && <p className="text-sm text-slate-600 mt-1">{convite.descricao}</p>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <Stat label="Código" value={convite.codigo} mono />
          <Stat label="Plano" value={convite.plano_slug} />
          <Stat label="Duração" value={`${convite.duracao_dias} dias`} />
          <Stat label="Usos" value={`${convite.usos_atuais}${convite.max_usos != null ? ` / ${convite.max_usos}` : ''}`} />
        </div>
        {convite.tag && (
          <div className="mt-4 text-xs text-slate-500">
            Tag: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">{convite.tag}</code>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <UsersIcon className="w-4 h-4" />
          Quem usou ({usos.length})
        </h2>
        {usos.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">Nenhum uso registrado ainda.</p>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <th className="text-left px-2 py-2 font-semibold">Agência</th>
                  <th className="text-left px-2 py-2 font-semibold">Nome</th>
                  <th className="text-left px-2 py-2 font-semibold">E-mail</th>
                  <th className="text-left px-2 py-2 font-semibold">Data</th>
                  <th className="text-left px-2 py-2 font-semibold">IP</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {usos.map(u => (
                  <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-2.5 text-sm text-slate-700">
                      <Link href={`/admin/tenants/${u.tenant_id}`} className="text-blue-600 hover:underline">
                        {u.tenant_nome || u.tenant_slug || u.tenant_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-2 py-2.5 text-sm text-slate-700">{u.nome_cliente}</td>
                    <td className="px-2 py-2.5 text-sm text-slate-600">{u.email_cliente}</td>
                    <td className="px-2 py-2.5 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(u.used_at).toLocaleString('pt-BR')}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-xs text-slate-500 font-mono">{u.ip || '—'}</td>
                    <td className="px-2 py-2.5">
                      <Link href={`/admin/tenants/${u.tenant_id}`} className="text-slate-400 hover:text-slate-700">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-0.5">{label}</div>
      <div className={`text-lg font-bold text-slate-900 ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

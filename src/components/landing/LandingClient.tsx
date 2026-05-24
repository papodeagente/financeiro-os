'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Sparkles, Check, ArrowRight, Zap, FileText, Users, BarChart3,
  Plane, Hotel, Bot, Shield, Globe, Loader2,
} from 'lucide-react';
import { Logo } from '@/components/Logo';

interface Plano {
  id: string;
  slug: string;
  nome: string;
  descricao: string;
  preco_mensal: number;
  preco_anual: number;
  moeda: string;
  destaque: boolean;
  ordem: number;
  limites: Record<string, unknown>;
  features: string[];
}

const FEATURES_GRID = [
  { icon: FileText, title: 'Propostas premium', desc: 'Editor estilo Elementor com blocos visuais e templates prontos pra fechar viagens.' },
  { icon: Plane, title: 'Voos e hotéis na API', desc: 'Busca em tempo real do Google Flights e hotéis. Adiciona à proposta com 1 clique.' },
  { icon: Bot, title: 'Geração com IA', desc: 'Claude monta roteiros completos e textos comerciais baseados no destino e cliente.' },
  { icon: Users, title: 'CRM integrado', desc: 'Negociações, clientes, tarefas e anotações sincronizadas com cada proposta.' },
  { icon: BarChart3, title: 'Funis & campanhas', desc: 'Simulador de funil com fluxo visual e cenários comparativos.' },
  { icon: Globe, title: 'Domínio próprio', desc: 'Propostas publicadas em proposta.suaagencia.com.br (plano Founder Pro).' },
];

export function LandingClient() {
  const router = useRouter();
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [loadingPlanos, setLoadingPlanos] = useState(true);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    // Se logado, redireciona pra dashboard. Anonimo vê a LP.
    fetch('/api/auth/session').then(r => r.json()).then(data => {
      if (data?.userId) {
        router.replace('/dashboard');
      } else {
        setCheckingAuth(false);
      }
    }).catch(() => setCheckingAuth(false));

    fetch('/api/planos').then(r => r.json()).then((data: Plano[]) => {
      if (Array.isArray(data)) setPlanos(data);
      setLoadingPlanos(false);
    }).catch(() => setLoadingPlanos(false));
  }, [router]);

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Top nav */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-white/80 border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Logo variant="sidebar" href="/" />
          <nav className="flex items-center gap-2">
            <Link href="#planos" className="hidden sm:inline-flex items-center px-3 py-2 text-sm text-slate-600 hover:text-slate-900">
              Planos
            </Link>
            <Link href="/login" className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900">
              Entrar
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors"
            >
              Criar conta <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full bg-blue-500/10 blur-3xl" />
          <div className="absolute top-32 right-1/4 w-[500px] h-[500px] rounded-full bg-emerald-500/10 blur-3xl" />
        </div>

        <div className="max-w-7xl mx-auto px-6 pt-20 pb-24 sm:pt-28 sm:pb-32 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full border border-slate-200 bg-white/70 backdrop-blur text-xs text-slate-600">
            <Sparkles className="w-3 h-3 text-blue-600" />
            Sistema operacional pra agências de viagem
          </div>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-slate-900 max-w-4xl mx-auto leading-[1.1]">
            Propostas que <span className="bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-600 bg-clip-text text-transparent">fecham viagens</span>,
            <br />gestão que escala.
          </h1>
          <p className="mt-6 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
            Editor premium de propostas + CRM + funil de vendas + financeiro,
            tudo integrado em um único sistema feito pra agência de viagens brasileira.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 transition-all hover:scale-[1.02]"
            >
              Começar grátis por 14 dias <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="#planos"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold hover:border-slate-300 hover:bg-slate-50 transition-colors"
            >
              Ver planos
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Sem cartão de crédito · Cancela quando quiser
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-slate-100 bg-slate-50/50">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">Tudo que sua agência precisa</h2>
            <p className="mt-3 text-slate-600">Pare de pular entre 5 ferramentas. Um sistema único, integrado.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES_GRID.map(f => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="bg-white rounded-2xl p-6 border border-slate-100 hover:border-slate-200 hover:shadow-lg transition-all">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/15 to-emerald-500/15 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-blue-600" />
                  </div>
                  <h3 className="font-semibold text-slate-900 mb-1">{f.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Planos */}
      <section id="planos" className="border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">Planos transparentes</h2>
            <p className="mt-3 text-slate-600">Comece com 14 dias grátis. Cancela quando quiser.</p>
          </div>

          {loadingPlanos ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : planos.length === 0 ? (
            <p className="text-center text-slate-500">Planos em breve.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {planos.map(p => (
                <PlanoCard key={p.id} plano={p} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CTA final */}
      <section className="border-t border-slate-100 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Pronto pra parar de fazer proposta no Canva?
          </h2>
          <p className="mt-4 text-slate-300">
            Crie sua conta gratuita e experimente por 14 dias. Sem cartão de crédito.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 mt-8 px-7 py-3 rounded-xl bg-white text-slate-900 font-semibold hover:bg-slate-100 transition-colors"
          >
            Começar agora <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-6 py-10 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} Entur OS · Sistema operacional para agências de viagem
        </div>
      </footer>
    </div>
  );
}

function PlanoCard({ plano }: { plano: Plano }) {
  const features = Array.isArray(plano.features) ? plano.features : [];
  const isPro = plano.slug === 'founder-pro';
  const isDestaque = plano.destaque;
  return (
    <div
      className={`relative rounded-2xl p-6 border-2 transition-all ${
        isDestaque
          ? 'border-blue-500 bg-gradient-to-br from-white to-blue-50/30 shadow-xl scale-[1.02]'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      {isDestaque && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-blue-600 to-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider">
          Mais popular
        </div>
      )}
      <div className="flex items-center gap-2 mb-2">
        {isPro && <Shield className="w-4 h-4 text-emerald-600" />}
        {isDestaque && !isPro && <Zap className="w-4 h-4 text-blue-600" />}
        {!isDestaque && !isPro && <Sparkles className="w-4 h-4 text-slate-400" />}
        <h3 className="text-xl font-bold text-slate-900">{plano.nome}</h3>
      </div>
      <p className="text-sm text-slate-600 mb-4 min-h-[40px]">{plano.descricao}</p>
      <div className="mb-5">
        <span className="text-4xl font-bold text-slate-900">
          {plano.moeda === 'BRL' ? 'R$' : '$'} {Number(plano.preco_mensal).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
        </span>
        <span className="text-sm text-slate-500 ml-1">/mês</span>
      </div>
      <Link
        href={`/signup?plano=${plano.slug}`}
        className={`block text-center py-2.5 rounded-xl font-semibold text-sm transition-all ${
          isDestaque
            ? 'bg-gradient-to-r from-blue-600 to-emerald-600 text-white hover:shadow-lg hover:scale-[1.02]'
            : 'bg-slate-900 text-white hover:bg-slate-800'
        }`}
      >
        Começar grátis 14 dias
      </Link>
      <ul className="mt-6 space-y-2.5">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
            <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" strokeWidth={2.5} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

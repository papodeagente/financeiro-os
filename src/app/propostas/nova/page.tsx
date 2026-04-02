'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Proposta, Cliente, Membro, TemplateProposta,
  createProposta,
} from '@/lib/crm-types';
import { generateId } from '@/lib/utils';
import { loadEntities } from '@/lib/crm-storage';
import { PropostaEditor } from '@/components/propostas/PropostaEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  ArrowLeft, ArrowRight, Sparkles, Loader2, FileText,
  Search, Users, MapPin, Calendar, Wand2,
} from 'lucide-react';

type Step = 'template' | 'dados' | 'editor';

interface WizardData {
  template: TemplateProposta | null;
  cliente_id: string;
  destino: string;
  data_inicio: string;
  data_fim: string;
  num_passageiros: number;
  orcamento: string;
  gerar_ia: boolean;
}

export default function PropostaNovaPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('template');
  const [templates, setTemplates] = useState<TemplateProposta[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [searchTemplate, setSearchTemplate] = useState('');
  const [wizard, setWizard] = useState<WizardData>({
    template: null,
    cliente_id: '',
    destino: '',
    data_inicio: '',
    data_fim: '',
    num_passageiros: 2,
    orcamento: '',
    gerar_ia: true,
  });
  const [finalProposta, setFinalProposta] = useState<Proposta | null>(null);

  useEffect(() => {
    Promise.all([
      loadEntities<TemplateProposta>('templates-proposta'),
      loadEntities<Cliente>('clientes'),
      loadEntities<Membro>('membros'),
      loadEntities<Proposta>('propostas'),
    ]).then(([t, c, m, p]) => {
      setTemplates(t);
      setClientes(c);
      setMembros(m);
      setPropostas(p);
      setLoading(false);
      // Auto-seed if no templates
      if (t.length === 0) {
        fetch('/api/templates-proposta/seed', { method: 'POST' })
          .then(r => r.json())
          .then(() => loadEntities<TemplateProposta>('templates-proposta').then(setTemplates))
          .catch(() => {});
      }
    });
  }, []);

  const selectTemplate = (t: TemplateProposta) => {
    setWizard(prev => ({ ...prev, template: t }));
    setStep('dados');
  };

  const skipTemplate = () => {
    setWizard(prev => ({ ...prev, template: null }));
    setStep('dados');
  };

  const buildProposta = useCallback(async () => {
    const numero = `PROP-${String(propostas.length + 1).padStart(4, '0')}`;
    const p = createProposta(numero);
    const tmpl = wizard.template;

    // Apply template visual + sections
    if (tmpl) {
      p.visual = { ...tmpl.visual };
      p.secoes = tmpl.secoes_padrao.map(s => ({ ...s, id: generateId() }));
      p.cabecalho.mensagem_abertura = tmpl.mensagem_abertura_padrao;
    }

    // Apply wizard data
    if (wizard.cliente_id) {
      const c = clientes.find(cl => cl.id === wizard.cliente_id);
      p.cliente_id = wizard.cliente_id;
      p.cliente_nome = c ? (c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia || c.razao_social) : '';
      if (c && !p.cabecalho.subtitulo) {
        p.cabecalho.subtitulo = `Preparada especialmente para ${p.cliente_nome}`;
      }
    }

    if (wizard.destino) {
      p.cabecalho.titulo = tmpl
        ? `${tmpl.nome} — ${wizard.destino}`
        : `Proposta de Viagem — ${wizard.destino}`;
    }

    if (wizard.data_inicio) p.cabecalho.data_proposta = new Date().toISOString().split('T')[0];

    // Generate AI content if selected
    if (wizard.gerar_ia && wizard.destino) {
      setGenerating(true);
      try {
        const res = await fetch('/api/ai/proposta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modo: 'completo',
            contexto: {
              destino: wizard.destino,
              cliente_nome: p.cliente_nome,
              tipo_viagem: tmpl?.tipo_viagem || '',
              num_dias: wizard.data_inicio && wizard.data_fim
                ? Math.ceil((new Date(wizard.data_fim).getTime() - new Date(wizard.data_inicio).getTime()) / 86400000) + 1
                : 5,
            },
          }),
        });
        const data = await res.json();
        if (data.secoes && Array.isArray(data.secoes)) {
          p.secoes = data.secoes.map((s: { tipo: string; conteudo: Record<string, unknown> }, i: number) => ({
            id: generateId(),
            tipo: s.tipo,
            ordem: i,
            visivel: true,
            conteudo: s.conteudo,
          }));
        }
      } catch {
        // Keep template sections if AI fails
      }
      setGenerating(false);
    }

    return p;
  }, [wizard, clientes, propostas]);

  const handleFinish = async () => {
    const p = await buildProposta();
    setFinalProposta(p);
    setStep('editor');
  };

  const filteredTemplates = templates.filter(t => {
    if (!searchTemplate) return true;
    const q = searchTemplate.toLowerCase();
    return t.nome.toLowerCase().includes(q) || t.descricao.toLowerCase().includes(q) || t.tipo_viagem.toLowerCase().includes(q);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--t-green)]" />
      </div>
    );
  }

  // Step 3: Editor
  if (step === 'editor' && finalProposta) {
    return (
      <PropostaEditor
        proposta={finalProposta}
        clientes={clientes}
        membros={membros}
        isEdit={false}
      />
    );
  }

  return (
    <div className="min-h-full bg-[var(--t-bg)]">
      {/* Top bar */}
      <div className="border-b border-[var(--t-border)] bg-[var(--t-surface)]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/propostas')} className="text-[var(--t-text-muted)] hover:text-[var(--t-text)]">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-[var(--t-text)]">Nova Proposta</h1>
              <p className="text-xs text-[var(--t-text-secondary)]">
                {step === 'template' ? 'Passo 1 de 2 — Escolha um template' : 'Passo 2 de 2 — Dados da viagem'}
              </p>
            </div>
          </div>
          {/* Steps indicator */}
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
              step === 'template' ? 'bg-[var(--t-green)] text-white dark:text-[#0a0a14]' : 'bg-[var(--t-green)]/20 text-[var(--t-green)]'
            }`}>1</div>
            <div className="w-8 h-0.5 bg-[var(--t-border)]" />
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
              step === 'dados' ? 'bg-[var(--t-green)] text-white dark:text-[#0a0a14]' : 'bg-[var(--t-bg)] text-[var(--t-text-muted)] border border-[var(--t-border)]'
            }`}>2</div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Step 1: Template */}
        {step === 'template' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-[var(--t-text)]">Escolha um template</h2>
                <p className="text-sm text-[var(--t-text-secondary)] mt-1">
                  Comece com um modelo pre-configurado ou crie do zero
                </p>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t-text-muted)]" />
                <Input
                  placeholder="Buscar template..."
                  value={searchTemplate}
                  onChange={e => setSearchTemplate(e.target.value)}
                  className="pl-10 bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Blank template */}
              <Card
                className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] hover:border-[var(--t-green)] transition-colors cursor-pointer group"
                onClick={skipTemplate}
              >
                <CardContent className="p-0">
                  <div className="h-36 bg-[var(--t-bg)] flex items-center justify-center rounded-t-lg">
                    <FileText className="w-12 h-12 text-[var(--t-text-muted)] group-hover:text-[var(--t-green)] transition-colors" />
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-[var(--t-text)]">Em branco</h3>
                    <p className="text-xs text-[var(--t-text-secondary)] mt-1">
                      Comece do zero sem template pre-definido
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Template cards */}
              {filteredTemplates.map(t => (
                <Card
                  key={t.id}
                  className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] hover:border-[var(--t-green)] transition-colors cursor-pointer group overflow-hidden"
                  onClick={() => selectTemplate(t)}
                >
                  <CardContent className="p-0">
                    <div className="h-36 bg-cover bg-center relative" style={{
                      backgroundImage: t.imagem_preview ? `url(${t.imagem_preview})` : undefined,
                      backgroundColor: t.imagem_preview ? undefined : t.visual.cor_primaria,
                    }}>
                      <div className="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors" />
                      <div className="absolute top-3 left-3">
                        <span className="text-2xl">{t.icone}</span>
                      </div>
                      <div className="absolute bottom-3 right-3">
                        <span className="text-[10px] bg-white/20 backdrop-blur-sm text-white px-2 py-0.5 rounded-full">
                          {t.secoes_padrao.length} blocos
                        </span>
                      </div>
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-[var(--t-text)]">{t.nome}</h3>
                      <p className="text-xs text-[var(--t-text-secondary)] mt-1 line-clamp-2">
                        {t.descricao}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Dados */}
        {step === 'dados' && (
          <div className="max-w-2xl mx-auto space-y-8">
            <div>
              <h2 className="text-xl font-bold text-[var(--t-text)]">Dados da viagem</h2>
              <p className="text-sm text-[var(--t-text-secondary)] mt-1">
                Preencha as informacoes basicas{wizard.template ? ` para o template "${wizard.template.nome}"` : ''}
              </p>
            </div>

            {wizard.template && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--t-bg-secondary)] border border-[var(--t-border)]">
                <span className="text-2xl">{wizard.template.icone}</span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-[var(--t-text)]">{wizard.template.nome}</div>
                  <div className="text-xs text-[var(--t-text-secondary)]">{wizard.template.descricao}</div>
                </div>
                <button
                  onClick={() => { setWizard(prev => ({ ...prev, template: null })); setStep('template'); }}
                  className="text-xs text-[var(--t-text-muted)] hover:text-[var(--t-text)] underline"
                >
                  Trocar
                </button>
              </div>
            )}

            <div className="space-y-5">
              {/* Cliente */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-[var(--t-text)] mb-2">
                  <Users className="w-4 h-4 text-[var(--t-green)]" />
                  Cliente
                </label>
                <select
                  value={wizard.cliente_id}
                  onChange={e => setWizard(prev => ({ ...prev, cliente_id: e.target.value }))}
                  className="w-full bg-[var(--t-input-bg)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2.5 text-sm"
                >
                  <option value="">Selecionar cliente (opcional)</option>
                  {clientes.filter(c => c.status === 'ATIVO').map(c => (
                    <option key={c.id} value={c.id}>
                      {c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia || c.razao_social}
                    </option>
                  ))}
                </select>
              </div>

              {/* Destino */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-[var(--t-text)] mb-2">
                  <MapPin className="w-4 h-4 text-[var(--t-green)]" />
                  Destino principal
                </label>
                <Input
                  value={wizard.destino}
                  onChange={e => setWizard(prev => ({ ...prev, destino: e.target.value }))}
                  placeholder="Ex: Paris, Orlando, Maldivas..."
                  className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                />
              </div>

              {/* Datas */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-[var(--t-text)] mb-2">
                    <Calendar className="w-4 h-4 text-[var(--t-green)]" />
                    Ida
                  </label>
                  <Input
                    type="date"
                    value={wizard.data_inicio}
                    onChange={e => setWizard(prev => ({ ...prev, data_inicio: e.target.value }))}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-[var(--t-text)] mb-2">
                    <Calendar className="w-4 h-4 text-[var(--t-green)]" />
                    Volta
                  </label>
                  <Input
                    type="date"
                    value={wizard.data_fim}
                    onChange={e => setWizard(prev => ({ ...prev, data_fim: e.target.value }))}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
              </div>

              {/* Passageiros */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-[var(--t-text)] mb-2">
                  <Users className="w-4 h-4 text-[var(--t-green)]" />
                  Passageiros
                </label>
                <Input
                  type="number"
                  min={1}
                  value={wizard.num_passageiros}
                  onChange={e => setWizard(prev => ({ ...prev, num_passageiros: parseInt(e.target.value) || 1 }))}
                  className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] w-32"
                />
              </div>

              {/* AI toggle */}
              <div className="p-4 rounded-lg border border-purple-500/30 bg-purple-500/5">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wizard.gerar_ia}
                    onChange={e => setWizard(prev => ({ ...prev, gerar_ia: e.target.checked }))}
                    className="w-4 h-4 rounded border-[var(--t-border)] text-purple-500 focus:ring-purple-500"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-purple-400">
                      <Wand2 className="w-4 h-4" />
                      Gerar conteudo com IA
                    </div>
                    <p className="text-xs text-[var(--t-text-secondary)] mt-0.5">
                      A IA preenchera automaticamente roteiro, textos e dicas com base no destino e template escolhidos
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-[var(--t-border)]">
              <Button
                variant="ghost"
                onClick={() => setStep('template')}
                className="text-[var(--t-text-secondary)] gap-2"
              >
                <ArrowLeft className="w-4 h-4" /> Voltar
              </Button>
              <Button
                onClick={handleFinish}
                disabled={generating}
                className="bg-[var(--t-green)] hover:bg-[var(--t-green)]/90 text-white dark:text-[#0a0a14] gap-2 px-6"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Gerando com IA...
                  </>
                ) : (
                  <>
                    {wizard.gerar_ia && wizard.destino ? <Sparkles className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                    Criar Proposta
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

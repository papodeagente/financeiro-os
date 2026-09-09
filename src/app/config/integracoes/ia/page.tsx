'use client';

/**
 * Chaves de IA. Duas chaves, um botão de testar cada uma.
 *
 * A tela antiga carregava seletor de modelo, TTLs de cache e as APIs de
 * viagem que o sistema deixou de usar. Nada disso ajudava a decidir a única
 * coisa que se decide aqui: a chave funciona ou não.
 *
 * AS CHAVES QUE SUMIRAM DA TELA CONTINUAM GRAVADAS. `config` é carregado
 * inteiro do servidor e salvo inteiro; tirar os campos daqui apenas para de
 * mostrá-los. Montar o objeto do zero na hora de salvar é que apagaria
 * Amadeus, Google Places e os TTLs de cache no primeiro clique.
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, XCircle } from 'lucide-react';

import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { ConfiguracaoAPIs } from '@/lib/crm-types';

type Provedor = 'anthropic' | 'openai';

interface Cartao {
  chave: Provedor;
  nome: string;
  oQueFaz: string;
  ondeConseguir: string;
  url: string;
}

const CARTOES: Cartao[] = [
  {
    chave: 'anthropic',
    nome: 'Anthropic (Claude)',
    oQueFaz: 'Escreve e revisa os textos das propostas.',
    ondeConseguir: 'console.anthropic.com',
    url: 'https://console.anthropic.com/settings/keys',
  },
  {
    chave: 'openai',
    nome: 'OpenAI',
    oQueFaz: 'Gera as imagens usadas nas propostas.',
    ondeConseguir: 'platform.openai.com',
    url: 'https://platform.openai.com/api-keys',
  },
];

const CAIXA =
  'flex flex-col gap-4 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-5';

interface EstadoTeste {
  ok: boolean;
  error?: string;
  message?: string;
}

export default function ChavesIAPage() {
  const [config, setConfig] = useState<ConfiguracaoAPIs | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [visivel, setVisivel] = useState<Record<string, boolean>>({});
  const [testes, setTestes] = useState<Record<string, EstadoTeste | null>>({});
  const [testando, setTestando] = useState<Record<string, boolean>>({});

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await fetch('/api/apis-config');
      const dados = await res.json();
      if (dados?.error) { setErro(dados.error); return; }
      // O que veio do servidor é preservado inteiro, inclusive o que esta
      // tela não mostra.
      setConfig((dados ?? {}) as ConfiguracaoAPIs);
      setErro('');
    } catch {
      setErro('Não foi possível carregar as chaves.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  function alterar(provedor: Provedor, campo: 'api_key' | 'ativo', valor: string | boolean) {
    setConfig(c => (c ? {
      ...c,
      [provedor]: { ...(c[provedor] ?? {}), [campo]: valor },
    } as ConfiguracaoAPIs : c));
  }

  async function salvar() {
    if (!config || salvando) return;
    setSalvando(true);
    try {
      const res = await fetch('/api/apis-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const corpo = await res.json().catch(() => null);
        toast.error('Não foi possível salvar', corpo?.error || '');
        return;
      }
      toast.success('Chaves salvas');
    } finally {
      setSalvando(false);
    }
  }

  async function testar(provedor: Provedor) {
    if (!config) return;
    setTestando(t => ({ ...t, [provedor]: true }));
    setTestes(t => ({ ...t, [provedor]: null }));
    try {
      const res = await fetch('/api/apis-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provedor, config: config[provedor] }),
      });
      const resultado = (await res.json()) as EstadoTeste;
      setTestes(t => ({ ...t, [provedor]: resultado }));
    } catch {
      setTestes(t => ({ ...t, [provedor]: { ok: false, error: 'Não foi possível testar agora.' } }));
    } finally {
      setTestando(t => ({ ...t, [provedor]: false }));
    }
  }

  return (
    <PageShell width="full" padding="md" gap="md" className="max-w-[760px]">
      <PageHeader
        titulo="Inteligência artificial"
        subtitulo="Suas chaves da Anthropic e da OpenAI. O consumo é cobrado direto pelo fornecedor."
        acaoPrimaria={{
          rotulo: salvando ? 'Salvando…' : 'Salvar',
          onClick: () => { void salvar(); },
        }}
        acoesSecundarias={[{ rotulo: 'Voltar às integrações', href: '/config/integracoes' }]}
      />

      <DataState
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={{ mensagem: erro, onTentarDeNovo: () => { void carregar(); } }}
        esqueleto={<div className="fin-t-body text-[var(--fin-text-3)]">Carregando…</div>}
      >
        {config ? (
          <div className="flex flex-col gap-4">
            {CARTOES.map(cartao => {
              const atual = (config[cartao.chave] ?? {}) as { api_key?: string; ativo?: boolean };
              const teste = testes[cartao.chave];
              const mostrando = visivel[cartao.chave] === true;
              return (
                <section key={cartao.chave} className={CAIXA}>
                  <div className="flex flex-col gap-1">
                    <h2 className="fin-t-subhead text-[var(--fin-text)]">{cartao.nome}</h2>
                    <p className="fin-t-caption text-[var(--fin-text-3)]">{cartao.oQueFaz}</p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`chave-${cartao.chave}`}>Chave de API</Label>
                    <div className="flex gap-2">
                      <Input
                        id={`chave-${cartao.chave}`}
                        type={mostrando ? 'text' : 'password'}
                        autoComplete="off"
                        value={atual.api_key ?? ''}
                        onChange={e => alterar(cartao.chave, 'api_key', e.target.value)}
                        placeholder="Cole a chave aqui"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={mostrando ? 'Esconder a chave' : 'Mostrar a chave'}
                        onClick={() => setVisivel(v => ({ ...v, [cartao.chave]: !mostrando }))}
                      >
                        {mostrando
                          ? <EyeOff aria-hidden="true" className="size-4" />
                          : <Eye aria-hidden="true" className="size-4" />}
                      </Button>
                    </div>
                    <span className="fin-t-caption text-[var(--fin-text-3)]">
                      A chave é criada em{' '}
                      <a
                        href={cartao.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--fin-accent)] underline"
                      >
                        {cartao.ondeConseguir}
                      </a>
                      .
                    </span>
                  </div>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={atual.ativo === true}
                      onChange={e => alterar(cartao.chave, 'ativo', e.target.checked)}
                    />
                    <span className="fin-t-body text-[var(--fin-text)]">
                      Usar esta integração
                    </span>
                  </label>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => { void testar(cartao.chave); }}
                      disabled={testando[cartao.chave] || !(atual.api_key ?? '').trim()}
                    >
                      {testando[cartao.chave] ? 'Testando…' : 'Testar chave'}
                    </Button>
                    {teste ? (
                      <span
                        className={cn(
                          'fin-t-caption flex items-center gap-2',
                          teste.ok ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-negative)]',
                        )}
                      >
                        {teste.ok
                          ? <CheckCircle2 aria-hidden="true" className="size-4" />
                          : <XCircle aria-hidden="true" className="size-4" />}
                        {teste.ok
                          ? (teste.message || 'A chave funciona.')
                          : (teste.error || 'A chave não funcionou.')}
                      </span>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
      </DataState>
    </PageShell>
  );
}

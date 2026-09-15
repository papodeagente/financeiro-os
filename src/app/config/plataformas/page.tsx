'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, TriangleAlert } from 'lucide-react';
import type { ContaBancaria } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { toast } from '@/lib/toast';

interface CampoCred { chave: string; rotulo: string; tipo: string; obrigatorio: boolean; ajuda: string }
interface Plataforma { id: string; nome: string; campos: CampoCred[] }
interface Config {
  plataforma: string; ativo: boolean; conta_bancaria_id: string;
  emitir_nota: boolean; mascaras: Record<string, string>; atualizado_em: string;
}
interface EventoLinha {
  plataforma: string; id_externo: string; tipo: string; status: string;
  erro: string | null; created_at: string; descricao: string | null; valor: string | null;
}

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]';
const CAMPO =
  'h-9 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] ' +
  'px-2 fin-t-body text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-[var(--fin-accent)]';
const BOTAO =
  'inline-flex h-9 items-center gap-1.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] ' +
  'bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] ' +
  'disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';
const BOTAO_PRIMARIO =
  'inline-flex h-9 items-center gap-1.5 rounded-[var(--fin-r-md)] bg-[var(--fin-accent)] px-3 ' +
  'fin-t-body-strong text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] disabled:opacity-50 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

export default function PlataformasPage() {
  const [dados, setDados] = useState<{
    tenantId: string; cofre_disponivel: boolean;
    plataformas: Plataforma[]; configs: Config[]; eventos: EventoLinha[];
  } | null>(null);
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, Record<string, string>>>({});
  const [salvando, setSalvando] = useState('');
  const [copiado, setCopiado] = useState('');

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [r, cb] = await Promise.all([
        fetch('/api/plataformas').then(async x => {
          if (!x.ok) throw new Error((await x.json()).error || `Erro ${x.status}`);
          return x.json();
        }),
        loadEntities<ContaBancaria>('contas-bancarias').catch(() => []),
      ]);
      setDados(r);
      setContas(cb);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const cfg = (id: string) => dados?.configs.find(c => c.plataforma === id);
  const campo = (id: string, chave: string) => form[id]?.[chave] ?? '';
  const setCampo = (id: string, chave: string, v: string) =>
    setForm(f => ({ ...f, [id]: { ...(f[id] ?? {}), [chave]: v } }));

  function urlWebhook(id: string): string {
    if (!dados) return '';
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    return `${base}/api/v1/plataformas/${id}/${dados.tenantId}`;
  }

  async function copiar(id: string) {
    try {
      await navigator.clipboard.writeText(urlWebhook(id));
      setCopiado(id);
      setTimeout(() => setCopiado(''), 2000);
    } catch {
      toast.error('Não foi possível copiar', 'Selecione o endereço e copie à mão.');
    }
  }

  async function enviar(id: string, acao: 'salvar' | 'testar') {
    setSalvando(`${id}-${acao}`);
    try {
      const c = cfg(id);
      const dadosForm = form[id] ?? {};
      const extras: Record<string, string> = {};
      for (const campoDef of dados?.plataformas.find(p => p.id === id)?.campos ?? []) {
        if (campoDef.chave !== 'api_key' && campoDef.chave !== 'segredo_webhook') {
          extras[campoDef.chave] = dadosForm[campoDef.chave] ?? c?.mascaras?.[campoDef.chave] ?? '';
        }
      }
      const r = await fetch('/api/plataformas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao,
          plataforma: id,
          ativo: dadosForm.ativo === 'nao' ? false : (dadosForm.ativo === 'sim' || c?.ativo || false),
          conta_bancaria_id: dadosForm.conta_bancaria_id ?? c?.conta_bancaria_id ?? '',
          emitir_nota: dadosForm.emitir_nota === 'sim',
          api_key: dadosForm.api_key ?? '',
          segredo_webhook: dadosForm.segredo_webhook ?? '',
          extras,
        }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || `Erro ${r.status}`);
      toast.success(acao === 'testar' ? 'Credencial aceita' : 'Configuração salva', json.conta ?? '');
      setForm(f => ({ ...f, [id]: {} }));
      await carregar();
    } catch (e) {
      toast.error(acao === 'testar' ? 'A plataforma recusou' : 'Não foi possível salvar',
                  e instanceof Error ? e.message : '');
    } finally {
      setSalvando('');
    }
  }

  return (
    <div className="flex flex-col gap-[var(--fin-s-5)]">
      <PageHeader
        titulo="Plataformas de venda"
        subtitulo="Venda fechada na plataforma entra sozinha no financeiro"
      />

      <DataState
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { carregar(); } } : null}
        esqueleto={<div className={`${CARTAO} h-64`} aria-hidden />}
      >
        {dados && !dados.cofre_disponivel && (
          <div className={`${CARTAO} flex items-start gap-2 border-[var(--fin-negative)] bg-[var(--fin-negative-soft)] p-[var(--fin-s-4)]`}>
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--fin-negative-text)]" aria-hidden />
            <div>
              <p className="fin-t-body-strong text-[var(--fin-text)]">O cofre de credenciais não está configurado</p>
              <p className="fin-t-caption text-[var(--fin-text-2)]">
                Chave de plataforma move dinheiro, então ela só é gravada cifrada. Defina a variável
                INTEGRACOES_MASTER_KEY no servidor, com 64 caracteres hexadecimais, e recarregue.
                Enquanto isso, salvar credencial fica bloqueado de propósito.
              </p>
            </div>
          </div>
        )}

        {dados?.plataformas.map(p => {
          const c = cfg(p.id);
          const configurada = Boolean(c?.mascaras?.api_key || c?.mascaras?.segredo_webhook);
          return (
            <section key={p.id} className={`${CARTAO} overflow-hidden`}>
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                <div>
                  <h2 className="fin-t-subhead text-[var(--fin-text)]">{p.nome}</h2>
                  <p className="fin-t-caption text-[var(--fin-text-3)]">
                    {configurada
                      ? (c?.ativo ? 'Ligada e recebendo vendas' : 'Configurada, mas desligada')
                      : 'Ainda não configurada'}
                  </p>
                </div>
                <label className="flex items-center gap-2 fin-t-body text-[var(--fin-text-2)]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--fin-accent)]"
                    checked={campo(p.id, 'ativo') === 'sim' || (campo(p.id, 'ativo') !== 'nao' && Boolean(c?.ativo))}
                    onChange={e => setCampo(p.id, 'ativo', e.target.checked ? 'sim' : 'nao')}
                  />
                  Ligada
                </label>
              </header>

              <div className="flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-4)]">
                <div className="flex flex-col gap-1">
                  <span className="fin-t-overline text-[var(--fin-text-3)]">Endereço do webhook</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-2 py-1.5 fin-t-caption text-[var(--fin-text-2)]">
                      {urlWebhook(p.id)}
                    </code>
                    <button type="button" className={BOTAO} onClick={() => copiar(p.id)}>
                      {copiado === p.id ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                      {copiado === p.id ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                  <span className="fin-t-caption text-[var(--fin-text-3)]">
                    Cole este endereço no painel da {p.nome}. Ele é exclusivo desta agência.
                  </span>
                </div>

                <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2">
                  {p.campos.map(cd => (
                    <div key={cd.chave} className="flex flex-col gap-1">
                      <label htmlFor={`${p.id}-${cd.chave}`} className="fin-t-overline text-[var(--fin-text-3)]">
                        {cd.rotulo}{cd.obrigatorio ? '' : ' (opcional)'}
                      </label>
                      <input
                        id={`${p.id}-${cd.chave}`}
                        type={cd.tipo === 'segredo' ? 'password' : 'text'}
                        autoComplete="off"
                        className={CAMPO}
                        value={campo(p.id, cd.chave)}
                        placeholder={c?.mascaras?.[cd.chave] || 'Não configurado'}
                        onChange={e => setCampo(p.id, cd.chave, e.target.value)}
                      />
                      <span className="fin-t-caption text-[var(--fin-text-3)]">{cd.ajuda}</span>
                    </div>
                  ))}

                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${p.id}-conta`} className="fin-t-overline text-[var(--fin-text-3)]">
                      Conta que recebe
                    </label>
                    <select
                      id={`${p.id}-conta`}
                      className={CAMPO}
                      value={campo(p.id, 'conta_bancaria_id') || c?.conta_bancaria_id || ''}
                      onChange={e => setCampo(p.id, 'conta_bancaria_id', e.target.value)}
                    >
                      <option value="">Caixa geral</option>
                      {contas.map(cb => <option key={cb.id} value={cb.id}>{cb.nome}</option>)}
                    </select>
                    <span className="fin-t-caption text-[var(--fin-text-3)]">
                      Onde o valor da venda entra no fluxo de caixa.
                    </span>
                  </div>
                </div>

                {/* O segredo nunca volta do servidor: campo em branco quer
                    dizer "não mexi", e não "apague". */}
                {configurada ? (
                  <p className="fin-t-caption text-[var(--fin-text-3)]">
                    Deixe os campos de segredo em branco para manter o que já está gravado. O que foi
                    salvo não é exibido de volta, nem para você.
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={BOTAO_PRIMARIO}
                    disabled={Boolean(salvando) || !dados.cofre_disponivel}
                    onClick={() => enviar(p.id, 'salvar')}
                  >
                    {salvando === `${p.id}-salvar` ? 'Salvando...' : 'Salvar'}
                  </button>
                  <button
                    type="button"
                    className={BOTAO}
                    disabled={Boolean(salvando) || !configurada}
                    onClick={() => enviar(p.id, 'testar')}
                  >
                    <Link2 className="h-4 w-4" aria-hidden />
                    {salvando === `${p.id}-testar` ? 'Testando...' : 'Testar credencial'}
                  </button>
                </div>
              </div>
            </section>
          );
        })}

        {dados && dados.eventos.length > 0 && (
          <section className={`${CARTAO} overflow-hidden`}>
            <header className="border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
              <h2 className="fin-t-subhead text-[var(--fin-text)]">Últimos avisos recebidos</h2>
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                O que cada plataforma mandou e o que o financeiro fez com isso
              </p>
            </header>
            <ul className="divide-y divide-[var(--fin-border)]">
              {dados.eventos.map(ev => (
                <li key={`${ev.plataforma}-${ev.id_externo}`} className="flex flex-wrap items-center gap-3 px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate fin-t-body text-[var(--fin-text)]">
                      {ev.descricao || ev.tipo}
                    </p>
                    <p className="fin-t-caption text-[var(--fin-text-3)]">
                      {ev.plataforma} · {ev.tipo} · {String(ev.created_at).slice(0, 10).split('-').reverse().join('/')}
                    </p>
                    {ev.erro ? (
                      <p className="fin-t-caption text-[var(--fin-warning-text)]">{ev.erro}</p>
                    ) : null}
                  </div>
                  <span className={`fin-t-caption ${
                    ev.status === 'PROCESSADO' ? 'text-[var(--fin-positive)]'
                      : ev.status === 'PENDENTE_HUMANO' ? 'text-[var(--fin-warning-text)]'
                      : 'text-[var(--fin-text-3)]'
                  }`}>
                    {ev.status === 'PROCESSADO' ? 'Lançado'
                      : ev.status === 'PENDENTE_HUMANO' ? 'Precisa de você'
                      : ev.status === 'IGNORADO' ? 'Sem efeito'
                      : ev.status}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </DataState>
    </div>
  );
}

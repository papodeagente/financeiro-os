'use client';

/**
 * Meu perfil › Verificação em duas etapas (E7, 06/11/2026).
 *
 * Quem paga sem ser administrador precisa do código do aplicativo
 * autenticador (ver src/lib/segundo-fator-pagador.ts). Aqui a pessoa ativa
 * sem sair do sistema: o servidor gera a chave, ela cadastra no aplicativo e
 * digita o primeiro código. Quem já ativou e entrou antes confirma o código
 * para pagar nesta sessão.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from '@/lib/toast';
import { QrDoAutenticador } from './QrDoAutenticador';

interface Situacao {
  ativo: boolean;
  administrador: boolean;
  exigido_para_pagar: boolean;
  verificada_nesta_sessao: boolean;
  prazo: string;
}

interface Cadastro { segredo: string; uri?: string }

function dataBR(iso: string): string {
  const [a, m, d] = iso.split('-');
  return d && m && a ? `${d}/${m}/${a}` : iso;
}

const CAMPO = 'mt-1.5 w-full max-w-[12rem] rounded-md border border-[var(--fin-border)] bg-[var(--fin-surface)] px-3 py-2 text-base tracking-[0.3em] tabular-nums text-[var(--fin-text)] outline-none focus:border-[var(--fin-accent)] focus-visible:ring-2 focus-visible:ring-[var(--fin-accent)]/30';
const BOTAO = 'inline-flex items-center gap-1.5 rounded-md bg-[var(--fin-accent)] px-4 py-2 text-sm font-semibold text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] disabled:opacity-60';

export function SegundoFatorDoPerfil() {
  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [cadastro, setCadastro] = useState<Cadastro | null>(null);
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch('/api/auth/segundo-fator', { cache: 'no-store' });
    if (r.ok) setSituacao(await r.json());
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function enviar(corpo: Record<string, unknown>) {
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch('/api/auth/segundo-fator', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      });
      const c = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; segredo?: string; uri?: string };
      if (r.ok && c.ok) {
        toast.success(situacao?.ativo ? 'Código confirmado.' : 'Verificação em duas etapas ativada.', 'Pagar e transferir já estão liberados nesta sessão.');
        setCadastro(null);
        setCodigo('');
        await carregar();
        return;
      }
      if (c.segredo) setCadastro({ segredo: c.segredo, uri: c.uri });
      // O primeiro pedido só traz a chave: não é erro.
      if (corpo.codigo) setErro(c.error || 'Código inválido. Confira o aplicativo e tente de novo.');
    } catch {
      setErro('Sem resposta do servidor. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  if (!situacao) return null;
  const grupos = cadastro?.segredo.match(/.{1,4}/g)?.join(' ') ?? '';
  const pronto = situacao.ativo && situacao.verificada_nesta_sessao;

  return (
    <section id="segundo-fator" aria-labelledby="titulo-segundo-fator"
      className="mt-6 scroll-mt-6 rounded-2xl border border-[var(--fin-border)] bg-[var(--fin-surface)] p-6 shadow-[var(--fin-e-card)]">
      <div className="flex items-start gap-3">
        <ShieldCheck aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${pronto ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-accent)]'}`} />
        <div className="min-w-0 flex-1">
          <h2 id="titulo-segundo-fator" className="fin-t-subhead text-[var(--fin-text)]">Verificação em duas etapas</h2>
          <p className="mt-1 max-w-[65ch] text-sm text-[var(--fin-text-2)]">
            {situacao.administrador
              ? 'Ativa: administradores entram sempre com a senha e o código do aplicativo autenticador.'
              : pronto
                ? 'Ativa. Pagar, transferir e aprovar pagamentos estão liberados nesta sessão.'
                : situacao.ativo
                  ? 'Ativa. Você entrou antes de confirmar o código: digite o código do aplicativo para pagar nesta sessão.'
                  : situacao.exigido_para_pagar
                    ? `Pagar, transferir e aprovar pagamentos pedem o código do aplicativo autenticador (obrigatório a partir de ${dataBR(situacao.prazo)}). O resto do sistema não muda.`
                    : 'Proteja sua conta com o código do aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password).'}
          </p>
        </div>
        {pronto && (
          <span className="inline-flex shrink-0 items-center gap-1 text-sm text-[var(--fin-positive)]">
            <Check aria-hidden="true" className="size-4" /> Ativa
          </span>
        )}
      </div>

      {!situacao.administrador && !pronto && (
        <div className="mt-5 space-y-4 border-t border-[var(--fin-border)] pt-5">
          {!situacao.ativo && !cadastro && (
            <button type="button" className={BOTAO} disabled={enviando} onClick={() => void enviar({})}>
              {enviando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <KeyRound aria-hidden="true" className="size-4" />}
              Ativar agora
            </button>
          )}

          {cadastro && (
            <div className="max-w-[65ch] space-y-3 text-sm text-[var(--fin-text-2)]">
              <p>No celular, abra o aplicativo autenticador, toque em adicionar conta e leia o QR code. Depois digite o código de 6 números que ele mostrar.</p>
              {cadastro.uri && <div className="w-fit"><QrDoAutenticador uri={cadastro.uri} /></div>}
              <details>
                <summary className="cursor-pointer text-[var(--fin-accent)]">Não consegue ler o QR?</summary>
                <p className="mt-2">Escolha adicionar com chave e digite:</p>
                <span className="mt-1 block select-all break-all font-mono text-base tracking-wider text-[var(--fin-text)]">{grupos}</span>
                {cadastro.uri && (
                  <a href={cadastro.uri} className="text-[var(--fin-accent)] underline underline-offset-2">Abrir no aplicativo deste aparelho</a>
                )}
              </details>
            </div>
          )}

          {(cadastro || situacao.ativo) && (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={e => {
                e.preventDefault();
                void enviar(cadastro ? { segredo_novo: cadastro.segredo, codigo } : { codigo });
              }}
            >
              <label className="block">
                <span className="text-[11px] font-semibold uppercase text-[var(--fin-text-3)]">Código do aplicativo</span>
                <input
                  className={CAMPO}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={codigo}
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setCodigo(v);
                    // O sexto número envia sozinho.
                    if (v.length === 6 && codigo.length !== 6 && !enviando) {
                      void enviar(cadastro ? { segredo_novo: cadastro.segredo, codigo: v } : { codigo: v });
                    }
                  }}
                  placeholder="000000"
                  aria-invalid={erro ? true : undefined}
                  aria-describedby={erro ? 'erro-segundo-fator' : undefined}
                />
              </label>
              <button type="submit" className={BOTAO} disabled={enviando || codigo.length !== 6}>
                {enviando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Check aria-hidden="true" className="size-4" />}
                {cadastro ? 'Ativar' : 'Confirmar código'}
              </button>
            </form>
          )}
          {erro && <p id="erro-segundo-fator" role="alert" className="text-sm text-[var(--fin-negative-text)]">{erro}</p>}
        </div>
      )}
    </section>
  );
}

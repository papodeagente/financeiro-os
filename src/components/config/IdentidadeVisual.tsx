'use client';

/**
 * Configurações > Dados da Agência > Identidade visual (13/11/2026).
 *
 * A logo (enviada pelo /api/upload, guardada no volume do servidor) e as
 * duas cores da agência, usadas no recibo e nos documentos para o cliente.
 * A prévia é o topo do recibo de verdade (mesma regra de cor:
 * src/lib/marca-da-agencia.ts). A tela só muda o formulário; quem grava é o
 * "Salvar" da página.
 */
import { useRef, useState } from 'react';
import { ImageUp, Loader2, Palette, Trash2 } from 'lucide-react';
import { COR_DESTAQUE_PADRAO, COR_PRIMARIA_PADRAO, corValida, marcaDoDocumento } from '@/lib/marca-da-agencia';
import { toast } from '@/lib/toast';

const TIPOS = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024;

const CAMPO_COR = 'h-10 w-28 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 font-mono text-sm uppercase text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

type Cores = { primaria?: string; destaque?: string };

/** Fora do componente de propósito: definido dentro, o campo perdia o foco a cada letra. */
function CampoDeCor({ rotulo, ajuda, padrao, chave, cores, onCores }: {
  rotulo: string; ajuda: string; padrao: string; chave: 'primaria' | 'destaque';
  cores: Cores | undefined; onCores: (c: Cores) => void;
}) {
  const valor = cores?.[chave];
  const atual = corValida(valor) ?? padrao;
  return (
    <div className="space-y-1.5">
      <span className="block text-xs uppercase tracking-wide text-[var(--fin-text-3)]">{rotulo}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${rotulo}: escolher`}
          value={atual.toLowerCase()}
          onChange={e => onCores({ ...cores, [chave]: e.target.value.toUpperCase() })}
          className="h-10 w-12 cursor-pointer rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] p-1"
        />
        <input
          aria-label={`${rotulo}: código`}
          className={CAMPO_COR}
          value={valor ?? ''}
          placeholder={padrao}
          maxLength={7}
          onChange={e => onCores({ ...cores, [chave]: e.target.value.trim() })}
        />
      </div>
      <p className="text-xs text-[var(--fin-text-3)]">
        {valor && !corValida(valor) ? 'Código inválido: use o formato #1A2B3C. Vale o padrão até corrigir.' : ajuda}
      </p>
    </div>
  );
}

export function IdentidadeVisual({
  logo, cores, nome, onLogo, onCores,
}: {
  logo: string;
  cores: { primaria?: string; destaque?: string } | undefined;
  nome: string;
  onLogo: (url: string) => void;
  onCores: (c: { primaria?: string; destaque?: string }) => void;
}) {
  const arquivo = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const marca = marcaDoDocumento({ cores });

  async function enviar(f: File) {
    if (!TIPOS.includes(f.type)) {
      toast.error('Use uma imagem PNG, JPG ou WebP.');
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error('A logo passa de 2 MB. Reduza a imagem e envie de novo.');
      return;
    }
    setEnviando(true);
    try {
      const corpo = new FormData();
      corpo.append('files', f);
      const r = await fetch('/api/upload', { method: 'POST', body: corpo });
      const j = await r.json().catch(() => null);
      const url = Array.isArray(j) ? j[0]?.url : null;
      if (!r.ok || !url) {
        toast.error(j?.error || 'Não foi possível enviar a logo.');
        return;
      }
      onLogo(url);
      toast.success('Logo enviada.', 'Clique em Salvar para gravar.');
    } catch {
      toast.error('Sem resposta do servidor. Tente de novo.');
    } finally {
      setEnviando(false);
      if (arquivo.current) arquivo.current.value = '';
    }
  }

  return (
    <section
      aria-labelledby="titulo-identidade"
      className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-5 shadow-[var(--fin-e-card)]"
    >
      <h2 id="titulo-identidade" className="flex items-center gap-2 text-base font-semibold text-[var(--fin-accent)]">
        <Palette className="size-4" aria-hidden="true" /> Identidade visual
      </h2>
      <p className="mt-1 text-sm text-[var(--fin-text-2)]">A logo e as cores da agência no recibo e nos documentos para o cliente.</p>

      <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {/* Logo */}
          <div className="space-y-2">
            <span className="block text-xs uppercase tracking-wide text-[var(--fin-text-3)]">Logo</span>
            <div className="flex items-center gap-3">
              <div className="flex h-16 w-40 items-center justify-center rounded-[var(--fin-r-md)] border border-dashed border-[var(--fin-border-strong)] bg-[var(--fin-surface-2)] p-2">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt={`Logo de ${nome || 'agência'}`} className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-xs text-[var(--fin-text-3)]">Sem logo</span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => arquivo.current?.click()}
                  disabled={enviando}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-sm text-[var(--fin-text)] hover:bg-[var(--fin-surface-2)] disabled:opacity-60"
                >
                  {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ImageUp className="size-4" aria-hidden="true" />}
                  {logo ? 'Trocar logo' : 'Enviar logo'}
                </button>
                {logo ? (
                  <button
                    type="button"
                    onClick={() => onLogo('')}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[var(--fin-r-md)] px-2 text-xs text-[var(--fin-negative-text)] hover:bg-[var(--fin-negative-soft)]"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" /> Remover
                  </button>
                ) : null}
              </div>
              <input
                ref={arquivo}
                type="file"
                accept={TIPOS.join(',')}
                className="sr-only"
                aria-label="Arquivo da logo"
                onChange={e => { const f = e.target.files?.[0]; if (f) void enviar(f); }}
              />
            </div>
            <p className="text-xs text-[var(--fin-text-3)]">PNG, JPG ou WebP até 2 MB. Fundo transparente fica melhor.</p>
          </div>

          <CampoDeCor rotulo="Cor principal" ajuda="Faixa do topo, valor e total do recibo." padrao={COR_PRIMARIA_PADRAO} chave="primaria" cores={cores} onCores={onCores} />
          <CampoDeCor rotulo="Cor de destaque" ajuda="Faixa do rodapé do recibo." padrao={COR_DESTAQUE_PADRAO} chave="destaque" cores={cores} onCores={onCores} />
        </div>

        {/* Prévia: o topo do recibo */}
        <div>
          <span className="block text-xs uppercase tracking-wide text-[var(--fin-text-3)]">Prévia no recibo</span>
          <div className="mt-2 overflow-hidden rounded-[12px] border border-[var(--fin-border)] bg-white" aria-hidden="true">
            <div className="h-1.5" style={{ background: marca.primaria }} />
            <div className="flex items-start justify-between gap-3 px-4 pt-4">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" className="max-h-9 max-w-[120px] object-contain" />
              ) : (
                <span className="text-[13px] font-semibold" style={{ color: marca.primariaNoPapel }}>{nome || 'Sua agência'}</span>
              )}
              <span className="text-[9px] font-semibold uppercase tracking-[0.28em]" style={{ color: marca.primariaNoPapel }}>Recibo</span>
            </div>
            <div className="mx-4 mt-3 rounded-[8px] px-3 py-2.5" style={{ background: marca.primariaSuave, borderLeft: `3px solid ${marca.primaria}` }}>
              <span className="block text-[8px] font-semibold uppercase tracking-[0.12em]" style={{ color: '#6B7280' }}>Valor recebido</span>
              <span className="block text-[18px] font-semibold tabular-nums" style={{ color: marca.primariaNoPapel }}>R$ 5.195,00</span>
            </div>
            <div className="mx-4 my-3 flex justify-end">
              <span className="rounded-[6px] px-2.5 py-1 text-[10px] font-semibold tabular-nums" style={{ background: marca.primaria, color: marca.textoSobrePrimaria }}>
                TOTAL R$ 5.195,00
              </span>
            </div>
            <div className="h-1" style={{ background: marca.destaque }} />
          </div>
        </div>
      </div>
    </section>
  );
}

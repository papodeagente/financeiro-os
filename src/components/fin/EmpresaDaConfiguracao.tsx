'use client';

/**
 * Configurações por empresa (06/11/2026, E7 G2): a faixa no topo das telas de
 * Configurações › Financeiro, Cobrança, Vendas e Notas fiscais.
 *
 * Diz de qual empresa é a configuração que está na tela, troca de empresa e
 * oferece "Copiar de outra empresa". Com uma empresa só, não desenha nada e a
 * tela é a de sempre.
 *
 * A empresa em edição vem do endereço (`?empresa=<id>`); `naEmpresa(url)`
 * leva o mesmo parâmetro às chamadas de API da tela.
 */
import * as React from 'react';
import { Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { EMPRESA_PRINCIPAL_ID, ROTULO_DA_SECAO, type SecaoPorEmpresa } from '@/lib/empresas';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useEmpresas } from './useEmpresas';

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0';
const CONTROLE = cn(
  'fin-t-body h-11 min-h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] sm:w-64 lg:h-10 lg:min-h-10',
  FOCO,
);

/** A empresa da configuração em edição (do endereço). Vazio = a principal. */
export function empresaEmEdicao(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('empresa')?.trim() ?? '';
}

/** A URL da API com a empresa em edição (quando não é a principal). */
export function naEmpresa(url: string): string {
  const empresa = empresaEmEdicao();
  if (!empresa || empresa === EMPRESA_PRINCIPAL_ID) return url;
  return `${url}${url.includes('?') ? '&' : '?'}empresa=${encodeURIComponent(empresa)}`;
}

/** O que cada seção leva na cópia, por extenso, para a confirmação. */
const O_QUE_COPIA: Record<SecaoPorEmpresa, string> = {
  financeiro: 'juros, multa, tolerância, desconto por antecipação e as categorias dos encargos',
  cobranca: 'provedor padrão, tipo de cobrança, encargos e a régua de lembretes',
  vendas: 'quais componentes contam como receita',
  notas: 'o enquadramento do serviço, alíquota, regime e série. A conexão com o emissor e o certificado continuam os da empresa',
};

export function EmpresaDaConfiguracao({ secao }: { secao: SecaoPorEmpresa }) {
  const { multi, empresas, carregando, pode_editar } = useEmpresas();
  const [copiando, setCopiando] = React.useState(false);
  const [origem, setOrigem] = React.useState('');
  const [processando, setProcessando] = React.useState(false);
  // Vem do endereço; a faixa só desenha depois de ler as empresas (no cliente).
  const [atual] = React.useState(() => empresaEmEdicao() || EMPRESA_PRINCIPAL_ID);

  if (carregando || !multi) return null;
  const empresaAtual = empresas.find(e => e.id === atual);
  const outras = empresas.filter(e => e.id !== atual);

  function trocar(id: string) {
    const p = new URLSearchParams(window.location.search);
    if (id === EMPRESA_PRINCIPAL_ID) p.delete('empresa'); else p.set('empresa', id);
    const q = p.toString();
    // A tela inteira passa a ler e gravar a configuração da outra empresa.
    window.location.search = q ? `?${q}` : '';
  }

  async function copiar() {
    if (!origem) return;
    setProcessando(true);
    try {
      const res = await fetch('/api/empresas/copiar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secao, de: origem, para: atual }),
      });
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof corpo?.error === 'string' ? corpo.error : 'Tente de novo.');
      toast.success(`Configuração copiada de ${empresas.find(e => e.id === origem)?.nome ?? 'outra empresa'}.`);
      window.location.reload();
    } catch (e) {
      toast.error('Não foi possível copiar.', e instanceof Error ? e.message : '');
      setProcessando(false);
    }
  }

  return (
    <section
      aria-label="Empresa desta configuração"
      className="flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)] sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-[var(--fin-s-1)]">
        <label htmlFor="empresa-da-configuracao" className="fin-t-body-strong text-[var(--fin-text)]">
          {ROTULO_DA_SECAO[secao]} de qual empresa
        </label>
        <p className="fin-t-caption text-[var(--fin-text-3)]">
          {empresaAtual?.principal
            ? 'A principal. As outras empresas seguem esta até terem a própria.'
            : 'O que você mudar aqui vale só para esta empresa; o resto segue a principal.'}
        </p>
      </div>
      <div className="flex flex-col gap-[var(--fin-s-2)] sm:flex-row sm:items-center">
        <Select value={atual} onValueChange={v => trocar(String(v ?? EMPRESA_PRINCIPAL_ID))}>
          <SelectTrigger id="empresa-da-configuracao" className={cn(CONTROLE, 'justify-between gap-2')}>
            <SelectValue>{() => empresaAtual?.nome ?? 'Empresa principal'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {empresas.map(e => (
              <SelectItem key={e.id} value={e.id} className="fin-t-body">{e.nome}{e.principal ? ' (principal)' : ''}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pode_editar && outras.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => { setOrigem(outras[0]?.id ?? ''); setCopiando(true); }}
            className={cn('h-11 gap-[var(--fin-s-2)] lg:h-10', FOCO)}
          >
            <Copy aria-hidden="true" className="size-4" />
            Copiar de outra empresa
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        aberto={copiando}
        onOpenChange={setCopiando}
        titulo="Copiar de outra empresa"
        oQueVaiAcontecer={`A configuração de ${ROTULO_DA_SECAO[secao]} de ${empresaAtual?.nome ?? 'esta empresa'} passa a ser igual à da empresa escolhida: ${O_QUE_COPIA[secao]}.`}
        previa={
          <div className="flex flex-col gap-[var(--fin-s-1)]">
            <label htmlFor="empresa-origem" className="fin-t-body-strong text-[var(--fin-text)]">Copiar de</label>
            <Select value={origem} onValueChange={v => setOrigem(String(v ?? ''))}>
              <SelectTrigger id="empresa-origem" className={cn(CONTROLE, 'justify-between gap-2 sm:w-full')}>
                <SelectValue>{() => outras.find(e => e.id === origem)?.nome ?? 'Escolha a empresa'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {outras.map(e => (
                  <SelectItem key={e.id} value={e.id} className="fin-t-body">{e.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
        confirmarRotulo="Copiar configuração"
        processando={processando}
        confirmarDesabilitado={!origem}
        onConfirmar={copiar}
      />
    </section>
  );
}

export default EmpresaDaConfiguracao;

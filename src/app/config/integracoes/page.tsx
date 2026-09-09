'use client';

/**
 * Integrações: a porta de entrada.
 *
 * Antes esta rota era a tela de chaves da IA, cheia de campo técnico, e as
 * outras integrações viviam em cantos diferentes do menu. Quem chegava aqui
 * precisava saber de antemão o que estava procurando.
 *
 * Agora é uma lista curta: o que dá para conectar, se está conectado, e o que
 * cada coisa faz em uma frase. A configuração de cada uma continua na página
 * dela, com os campos que só interessam a quem já decidiu conectar.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BrainCircuit, FileText, Link2, type LucideIcon } from 'lucide-react';

import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { cn } from '@/lib/utils';

type Situacao = 'conectado' | 'pendente' | 'desligado' | 'sem-acesso';

interface Integracao {
  chave: string;
  nome: string;
  /** Uma frase, no idioma de quem usa: o que muda na agência. */
  oQueFaz: string;
  icone: LucideIcon;
  href: string;
  situacao: Situacao;
  /** Complemento curto do estado, quando ajuda a saber o próximo passo. */
  detalhe: string;
}

const APARENCIA: Record<Situacao, { rotulo: string; classe: string }> = {
  conectado: {
    rotulo: 'Conectado',
    classe: 'border-[var(--fin-positive)] text-[var(--fin-positive)]',
  },
  pendente: {
    rotulo: 'Falta terminar',
    classe: 'border-[var(--fin-warning)] text-[var(--fin-warning-text)]',
  },
  desligado: {
    rotulo: 'Não conectado',
    classe: 'border-[var(--fin-border-strong)] text-[var(--fin-text-3)]',
  },
  'sem-acesso': {
    rotulo: 'Sem permissão',
    classe: 'border-[var(--fin-border-strong)] text-[var(--fin-text-3)]',
  },
};

function Cartao({ item }: { item: Integracao }) {
  const { rotulo, classe } = APARENCIA[item.situacao];
  const Icone = item.icone;
  const bloqueado = item.situacao === 'sem-acesso';

  const conteudo = (
    <>
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]"
      >
        <Icone className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{item.nome}</span>
          <span className={cn('fin-t-caption rounded-full border px-2 py-0.5', classe)}>
            {rotulo}
          </span>
        </span>
        <span className="fin-t-caption text-[var(--fin-text-3)]">{item.oQueFaz}</span>
        {item.detalhe ? (
          <span className="fin-t-caption text-[var(--fin-text-2)]">{item.detalhe}</span>
        ) : null}
      </span>
    </>
  );

  const classeBase = cn(
    'flex items-start gap-4 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)]',
    'bg-[var(--fin-surface)] p-4 text-left transition-colors',
    bloqueado
      ? 'opacity-70'
      : 'hover:border-[var(--fin-border-strong)] hover:bg-[var(--fin-surface-2)]',
    'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2',
  );

  if (bloqueado) {
    return <div className={classeBase}>{conteudo}</div>;
  }
  return (
    <Link href={item.href} className={classeBase}>
      {conteudo}
    </Link>
  );
}

export default function IntegracoesPage() {
  const [itens, setItens] = useState<Integracao[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    // Cada integração é consultada em separado e o erro de uma não derruba a
    // lista: a tela existe justamente para dizer o que ainda não está de pé.
    const pegar = async (url: string): Promise<{ ok: boolean; corpo: unknown }> => {
      try {
        const res = await fetch(url);
        return { ok: res.ok, corpo: await res.json() };
      } catch {
        return { ok: false, corpo: null };
      }
    };

    try {
    const [ia, crm, fiscal] = await Promise.all([
      pegar('/api/apis-config'),
      pegar('/api/v1/crm/status'),
      pegar('/api/fiscal/config'),
    ]);

    const iaCfg = (ia.corpo ?? {}) as Record<string, { api_key?: string; ativo?: boolean }>;
    const temChaveIA = Boolean(
      (iaCfg.anthropic?.api_key || '').trim() || (iaCfg.openai?.api_key || '').trim(),
    );
    const iaLigada = Boolean(iaCfg.anthropic?.ativo || iaCfg.openai?.ativo);

    const crmCorpo = (crm.corpo ?? {}) as { ativo?: boolean };
    const crmLigado = crm.ok && crmCorpo.ativo === true;

    const fiscalCfg = ((fiscal.corpo ?? {}) as { config?: Record<string, unknown> }).config ?? {};
    const temEmissor = Boolean(String(fiscalCfg.provedor ?? '').trim());
    const temCertificado = Boolean(
      (fiscalCfg.certificado as { referencia_gateway?: string } | null)?.referencia_gateway,
    );

    setItens([
      {
        chave: 'crm',
        nome: 'CRM Entur',
        oQueFaz:
          'Venda fechada no CRM entra aqui como conta a receber do cliente e conta a pagar do fornecedor.',
        icone: Link2,
        href: '/config/crm',
        situacao: crmLigado ? 'conectado' : 'desligado',
        detalhe: crmLigado ? '' : 'Configure a URL e o segredo compartilhado para ligar.',
      },
      {
        chave: 'fiscal',
        nome: 'Nota fiscal',
        oQueFaz:
          'Emite a NFS-e da parcela assim que você confirma o recebimento, com o certificado da agência.',
        icone: FileText,
        href: '/config/fiscal',
        situacao: !fiscal.ok
          ? 'sem-acesso'
          : temEmissor && temCertificado
            ? 'conectado'
            : temEmissor
              ? 'pendente'
              : 'desligado',
        detalhe: !fiscal.ok
          ? 'Só quem tem acesso ao financeiro configura a nota fiscal.'
          : temEmissor && !temCertificado
            ? 'Falta enviar o certificado digital A1.'
            : '',
      },
      {
        chave: 'ia',
        nome: 'Inteligência artificial',
        oQueFaz:
          'Escreve textos e gera imagens nas propostas. Você usa a sua própria chave e paga direto ao fornecedor.',
        icone: BrainCircuit,
        href: '/config/integracoes/ia',
        situacao: temChaveIA && iaLigada ? 'conectado' : temChaveIA ? 'pendente' : 'desligado',
        detalhe:
          temChaveIA && !iaLigada ? 'A chave está salva, mas a integração está desligada.' : '',
      },
    ]);
    } finally {
      // Sai do estado de carregando mesmo se algo acima falhar: tela travada
      // em "verificando" não diz nada a ninguém.
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <PageShell width="full" padding="md" gap="md" className="max-w-[760px]">
      <PageHeader
        titulo="Integrações"
        subtitulo="Conecte o Entur OS às ferramentas que a agência já usa."
      />

      <DataState
        estado={carregando ? 'carregando' : 'ok'}
        erro={{ mensagem: '', onTentarDeNovo: () => { void carregar(); } }}
        esqueleto={
          <div className="fin-t-body text-[var(--fin-text-3)]">Verificando as integrações…</div>
        }
      >
        <div className="flex flex-col gap-3">
          {itens.map(i => (
            <Cartao key={i.chave} item={i} />
          ))}
        </div>
      </DataState>
    </PageShell>
  );
}

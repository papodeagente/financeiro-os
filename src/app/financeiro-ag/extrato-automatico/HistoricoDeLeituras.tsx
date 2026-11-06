'use client';

/**
 * As últimas leituras de uma conta: quando, quem pediu, o período lido e o
 * que entrou. A falha aparece com a frase que a agência entende, nunca com o
 * erro cru do banco.
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, CircleSlash, XCircle } from 'lucide-react';

import { RecordSheet } from '@/components/fin/RecordSheet';
import { DataState } from '@/components/fin/DataState';
import { cn } from '@/lib/utils';
import type { ConexaoBancaria, LeituraDoHistorico } from './useExtratoAutomatico';

const fmtHora = (iso: string) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso));
const fmtDia = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

function resumo(l: LeituraDoHistorico): string {
  if (l.status === 'OK') {
    const partes = [
      l.inseridas === 1 ? '1 lançamento novo' : `${l.inseridas.toLocaleString('pt-BR')} lançamentos novos`,
      l.duplicadas ? `${l.duplicadas.toLocaleString('pt-BR')} já estavam` : null,
      l.atualizadas ? `${l.atualizadas.toLocaleString('pt-BR')} confirmados pelo banco` : null,
    ].filter(Boolean);
    return partes.join(', ');
  }
  if (l.status === 'EXECUTANDO') return 'Lendo agora';
  if (l.status === 'ABANDONADA') return l.mensagem ?? 'A leitura parou no meio e foi liberada.';
  return l.mensagem ?? 'A leitura não deu certo.';
}

export function HistoricoDeLeituras({ conexao, onFechar }: { conexao: ConexaoBancaria | null; onFechar: () => void }) {
  // O resultado guarda de qual conexão e de qual tentativa ele é: enquanto
  // não bate com a pedida, a janela mostra o esqueleto.
  const [tentativa, setTentativa] = useState(0);
  const [resultado, setResultado] = useState<{ chave: string; linhas: LeituraDoHistorico[]; erro: string | null } | null>(null);
  const chave = conexao ? `${conexao.id}#${tentativa}` : '';

  useEffect(() => {
    if (!conexao) return;
    let vivo = true;
    const esta = `${conexao.id}#${tentativa}`;
    fetch(`/api/extrato-automatico/${encodeURIComponent(conexao.id)}`, { cache: 'no-store' })
      .then(async r => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error ?? 'Não foi possível abrir o histórico.');
        if (vivo) setResultado({ chave: esta, linhas: j.historico ?? [], erro: null });
      })
      .catch(e => { if (vivo) setResultado({ chave: esta, linhas: [], erro: e instanceof Error ? e.message : 'Não foi possível abrir o histórico.' }); });
    return () => { vivo = false; };
  }, [conexao, tentativa]);

  const atual = resultado?.chave === chave ? resultado : null;
  const estado: 'carregando' | 'ok' | 'erro' = !atual ? 'carregando' : atual.erro ? 'erro' : 'ok';
  const linhas = atual?.linhas ?? [];
  const erro = atual?.erro ?? '';

  const esqueleto = (
    <div className="flex flex-col gap-[var(--fin-s-2)]">
      {[0, 1, 2, 3].map(i => <span key={i} className="block h-12 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />)}
    </div>
  );

  return (
    <RecordSheet
      aberto={conexao !== null}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={`Leituras da ${conexao?.conta_nome ?? 'conta'}`}
      descricao="As últimas 20, da mais recente para a mais antiga. Horário de Brasília."
      largura={640}
      acaoPrimaria={{ rotulo: 'Fechar', onClick: onFechar }}
      acaoSecundaria={null}
    >
      <DataState
        estado={estado}
        erro={estado === 'erro' ? { mensagem: erro, onTentarDeNovo: () => setTentativa(t => t + 1) } : null}
        esqueleto={esqueleto}
      >
        {linhas.length === 0 ? (
          <p className="fin-t-body text-[var(--fin-text-2)]">Nenhuma leitura ainda. A primeira sai sozinha em instantes.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-[var(--fin-border)]">
            {linhas.map(l => {
              const ok = l.status === 'OK';
              const Icone = ok ? CheckCircle2 : l.status === 'FALHOU' ? XCircle : CircleSlash;
              return (
                <li key={l.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-[var(--fin-s-3)] py-[var(--fin-s-3)]">
                  <Icone
                    aria-hidden="true"
                    className={cn('mt-0.5 size-4', ok ? 'text-[var(--fin-positive)]' : l.status === 'FALHOU' ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-3)]')}
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-[var(--fin-s-2)]">
                      <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{fmtHora(l.iniciada_em)}</span>
                      <span className="fin-t-caption text-[var(--fin-text-3)]">
                        {l.origem === 'manual' ? 'pedida na tela' : 'automática'}
                        {l.janela ? `, de ${fmtDia(l.janela.de)} a ${fmtDia(l.janela.ate)}` : ''}
                      </span>
                    </div>
                    <span className={cn('fin-t-body', ok ? 'text-[var(--fin-text-2)]' : 'text-[var(--fin-text)]')}>{resumo(l)}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </DataState>
    </RecordSheet>
  );
}

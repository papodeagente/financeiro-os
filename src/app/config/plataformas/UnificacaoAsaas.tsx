'use client';

/**
 * Asaas do CRM e do Financeiro (E7, 06/11/2026): o assistente de unificação.
 *
 * Aparece só quando há o que decidir: o Asaas conectado nos dois sistemas
 * (ou já unificado). Mostra o plano em frases (o que muda, o que impede) e só
 * aplica com a confirmação; "Desfazer" volta o CRM para a chave e o aviso
 * dele. A tela nunca recebe chave: só o final dela e a carteira.
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft, CheckCircle2, LoaderCircle, RefreshCw, Undo2 } from 'lucide-react';
import { Callout } from '@/components/fin/Callout';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { toast } from '@/lib/toast';

interface Plano {
  situacao: 'unificado' | 'pode_unificar' | 'bloqueado' | 'nada_a_fazer';
  resumo: string;
  bloqueios: string[];
  passos: string[];
  eventos_a_incluir: string[];
  assinatura: string;
  estado: { ativo: boolean; desde: string | null; aplicado_por_nome: string | null; aviso_do_crm: string | null } | null;
  financeiro: { conectado: boolean; carteira: string | null };
  crm: { situacao: string; conectado: boolean; chave_final: string | null; carteira: string | null; aviso_automatico: boolean };
  aviso_do_crm?: string;
}

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';
const BOTAO =
  'inline-flex h-9 items-center gap-1.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] ' +
  'bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] ' +
  'disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';
const BOTAO_PRIMARIO =
  'inline-flex h-9 items-center gap-1.5 rounded-[var(--fin-r-md)] bg-[var(--fin-accent)] px-3 ' +
  'fin-t-body-strong text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] disabled:opacity-50 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

function dataCurta(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function avisoDoCrmEmFrase(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v === 'desligado') return 'O aviso próprio do CRM foi desligado no Asaas.';
  if (v === 'sem_cadastro_automatico') return 'O aviso do CRM foi cadastrado à mão no Asaas: desligue-o no painel do Asaas.';
  if (v.startsWith('nao_desligado')) return 'O CRM não conseguiu desligar o aviso dele no Asaas: desligue-o no painel do Asaas (até lá o mesmo pagamento é conferido duas vezes, sem efeito em dobro).';
  return null;
}

export function UnificacaoAsaas() {
  const [plano, setPlano] = useState<Plano | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<'aplicar' | 'desfazer' | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch('/api/plataformas/asaas-crm', { cache: 'no-store' });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || 'Não deu para ler a situação do Asaas.');
      setPlano(j as Plano);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para ler a situação do Asaas.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function executar(acao: 'aplicar' | 'desfazer') {
    if (!plano) return;
    setEnviando(true);
    try {
      const r = await fetch('/api/plataformas/asaas-crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(acao === 'aplicar' ? { acao, assinatura: plano.assinatura } : { acao }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || 'Não deu certo. Nada mudou.');
      setPlano(j as Plano);
      setConfirmar(null);
      toast.success(acao === 'aplicar' ? 'Asaas unificado: o CRM passa a usar esta conexão.' : 'Desfeito: o CRM voltou para a conexão dele.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu certo. Nada mudou.');
      setConfirmar(null);
      await carregar();
    } finally {
      setEnviando(false);
    }
  }

  // Sem nada a decidir (CRM sem Asaas, sem integração): o bloco não aparece.
  if (carregando && !plano) return null;
  if (!erro && (!plano || plano.situacao === 'nada_a_fazer')) return null;

  const unificado = plano?.situacao === 'unificado';
  const avisoCrm = avisoDoCrmEmFrase(plano?.estado?.aviso_do_crm ?? plano?.aviso_do_crm);

  return (
    <section className={`${CARTAO} overflow-hidden`} aria-labelledby="asaas-crm-titulo">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
        <div className="min-w-0">
          <h2 id="asaas-crm-titulo" className="fin-t-subhead text-[var(--fin-text)]">Asaas do CRM e do Financeiro</h2>
          <p className="fin-t-caption text-[var(--fin-text-3)]">
            {unificado
              ? `Uma conexão só, guardada aqui${plano?.estado?.desde ? ` desde ${dataCurta(plano.estado.desde)}` : ''}${plano?.estado?.aplicado_por_nome ? `, por ${plano.estado.aplicado_por_nome}` : ''}`
              : 'Uma conexão só: a chave e o aviso ficam aqui, e o CRM usa esta conexão'}
          </p>
        </div>
        <button type="button" className={BOTAO} onClick={carregar} disabled={carregando || enviando}>
          {carregando ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
          Conferir de novo
        </button>
      </header>

      <div className="flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-4)]">
        {erro ? <Callout tom="negativo" titulo="Não deu para ler a situação">{erro}</Callout> : null}

        {plano ? (
          <>
            <p className="flex items-start gap-2 fin-t-body text-[var(--fin-text)]">
              {unificado ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--fin-positive)]" aria-hidden /> : null}
              {plano.resumo}
            </p>

            {plano.situacao === 'bloqueado' && plano.bloqueios.length > 0 ? (
              <Callout tom="aviso" titulo="Antes de unificar">
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  {plano.bloqueios.map(b => <li key={b}>{b}</li>)}
                </ul>
              </Callout>
            ) : null}

            {plano.passos.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="fin-t-label text-[var(--fin-text-2)]">{unificado ? 'Ao desfazer' : 'O que muda'}</span>
                <ol className="flex list-decimal flex-col gap-1 pl-5 fin-t-body text-[var(--fin-text-2)] marker:text-[var(--fin-text-3)]">
                  {plano.passos.map(p => <li key={p}>{p}</li>)}
                </ol>
              </div>
            ) : null}

            {unificado && avisoCrm ? <Callout tom="info">{avisoCrm}</Callout> : null}

            <div className="flex flex-wrap gap-2">
              {plano.situacao === 'pode_unificar' ? (
                <button type="button" className={BOTAO_PRIMARIO} disabled={enviando} onClick={() => setConfirmar('aplicar')}>
                  <ArrowRightLeft className="h-4 w-4" aria-hidden />
                  Unificar o Asaas
                </button>
              ) : null}
              {unificado ? (
                <button type="button" className={BOTAO} disabled={enviando} onClick={() => setConfirmar('desfazer')}>
                  <Undo2 className="h-4 w-4" aria-hidden />
                  Desfazer a unificação
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      <ConfirmDialog
        aberto={confirmar === 'aplicar'}
        onOpenChange={v => { if (!v && !enviando) setConfirmar(null); }}
        titulo="Unificar o Asaas"
        oQueVaiAcontecer="O CRM passa a criar as cobranças das propostas por esta conexão e os avisos de pagamento chegam aqui. Nada é apagado e dá para desfazer."
        detalhes={plano ? [
          { rotulo: 'Conta Asaas (carteira)', valor: plano.financeiro.carteira ?? '-' },
          { rotulo: 'Chave do CRM', valor: `final ${plano.crm.chave_final ?? '----'}, fica guardada sem uso` },
          ...(plano.eventos_a_incluir.length ? [{ rotulo: 'Aviso daqui passa a avisar', valor: plano.eventos_a_incluir.join(', ') }] : []),
        ] : []}
        confirmarRotulo="Unificar"
        processando={enviando}
        onConfirmar={() => executar('aplicar')}
      />
      <ConfirmDialog
        aberto={confirmar === 'desfazer'}
        onOpenChange={v => { if (!v && !enviando) setConfirmar(null); }}
        titulo="Desfazer a unificação"
        oQueVaiAcontecer="O CRM volta a usar a chave e o aviso dele no Asaas. As cobranças já criadas continuam valendo e o CRM segue acompanhando cada uma."
        confirmarRotulo="Desfazer"
        processando={enviando}
        onConfirmar={() => executar('desfazer')}
      />
    </section>
  );
}

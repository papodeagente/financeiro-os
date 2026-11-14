'use client';

/**
 * Extrato automático (06/11/2026, E6 parte B).
 *
 * Uma linha por conta bancária: está ligada ao banco? Leu quando? Vai ler
 * quando? Precisa de algo da agência (certificado vencendo, credencial
 * recusada)? Daqui se conecta, lê na hora, renova e desconecta. O extrato
 * que chega entra na conciliação de sempre; esta tela não confere nada.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, Clock3, History, Landmark, Link2, PlugZap, RefreshCw, RotateCw, Unplug } from 'lucide-react';

import { cn, formatBRL } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { quandoSera } from '@/lib/extrato-automatico/regras';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/fin/Callout';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { StatusChip } from '@/components/fin/StatusChip';

import { HistoricoDeLeituras } from './HistoricoDeLeituras';
import { JanelaDeConexao, type ModoDaJanela } from './JanelaDeConexao';
import {
  fraseDaLeitura, lerAgora, useExtratoAutomatico,
  type ConexaoBancaria, type ContaLiberada,
} from './useExtratoAutomatico';

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';
const BOTAO = 'h-11 gap-[var(--fin-s-1)] px-3 lg:h-9';
const fmtDia = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

const TOM_DA_SAUDE = {
  ok: 'text-[var(--fin-text-2)]',
  atencao: 'text-[var(--fin-warning-text)]',
  critico: 'text-[var(--fin-negative-text)]',
  desligado: 'text-[var(--fin-text-3)]',
} as const;

interface LinhaDaTela {
  conta: ContaLiberada;
  conexao: ConexaoBancaria | null;
}

function LinhaDaConta({
  linha, agora, podeConectar, podeLer, lendo, onConectar, onRenovar, onLer, onHistorico, onDesconectar,
}: {
  linha: LinhaDaTela;
  agora: Date;
  podeConectar: boolean;
  podeLer: boolean;
  lendo: boolean;
  onConectar: () => void;
  onRenovar: () => void;
  onLer: () => void;
  onHistorico: () => void;
  onDesconectar: () => void;
}) {
  const c = linha.conexao;
  const ligada = c !== null && c.status !== 'DESCONECTADA';
  const saude = c?.saude;
  const certificado = saude?.certificado ?? null;
  const pedeRenovacao = ligada && (c.status === 'EXPIRADA' || certificado !== null);

  return (
    <li className="grid gap-[var(--fin-s-3)] px-[var(--fin-s-4)] py-[var(--fin-s-4)] lg:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)_auto] lg:items-start lg:gap-[var(--fin-s-5)]">
      {/* A conta */}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="fin-t-body-strong truncate text-[var(--fin-text)]">{linha.conta.nome}</span>
        <span className="fin-t-caption text-[var(--fin-text-3)]">
          {ligada ? `${c.provedor_nome}, ${c.vezes_por_dia === 1 ? '1 leitura por dia' : `${c.vezes_por_dia} leituras por dia`}` : 'Extrato por arquivo'}
        </span>
      </div>

      {/* O estado, em palavras */}
      <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
        <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
          <StatusChip dominio="conexao_banco" valor={ligada ? c.status : 'SEM_CONEXAO'} dot />
          {saude && ligada ? <span className="fin-t-body-strong text-[var(--fin-text)]">{saude.titulo}</span> : null}
        </div>
        <p className={cn('fin-t-body max-w-[72ch]', TOM_DA_SAUDE[ligada && saude ? saude.nivel : 'desligado'])}>
          {ligada && saude ? saude.frase : 'O extrato desta conta entra quando alguém importa o arquivo do banco na conciliação.'}
        </p>
        {ligada && certificado && c.status !== 'EXPIRADA' ? (
          <p className={cn('fin-t-caption flex items-start gap-[var(--fin-s-1)]', certificado.nivel === 'aviso' ? 'text-[var(--fin-warning-text)]' : 'text-[var(--fin-negative-text)]')}>
            <CalendarClock aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            {certificado.frase}
          </p>
        ) : null}
        {ligada && c.status !== 'EXPIRADA' ? (
          <p className="fin-t-caption flex flex-wrap gap-x-[var(--fin-s-3)] gap-y-0.5 text-[var(--fin-text-3)]">
            {c.proxima_sincronizacao_em ? (
              <span className="inline-flex items-center gap-[var(--fin-s-1)]">
                <Clock3 aria-hidden="true" className="size-3.5" />
                Próxima leitura {quandoSera(c.proxima_sincronizacao_em, agora)}
              </span>
            ) : null}
            {c.saldo_banco !== null && c.saldo_banco_em ? (
              <span className="tabular-nums">Saldo no banco {formatBRL(c.saldo_banco)} em {fmtDia(c.saldo_banco_em).slice(0, 5)}</span>
            ) : null}
            {c.expira_em && !certificado ? <span>Certificado até {fmtDia(c.expira_em)}</span> : null}
          </p>
        ) : null}
      </div>

      {/* O que dá para fazer */}
      <div className="flex flex-wrap items-center gap-[var(--fin-s-2)] lg:justify-end">
        {!ligada ? (
          podeConectar ? (
            <Button type="button" variant="outline" className={BOTAO} onClick={onConectar}>
              <PlugZap aria-hidden="true" className="size-4" />
              {c?.status === 'DESCONECTADA' ? 'Conectar de novo' : 'Conectar'}
            </Button>
          ) : null
        ) : (
          <>
            {pedeRenovacao && podeConectar ? (
              <Button
                type="button"
                className={cn(BOTAO, 'bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)]')}
                onClick={onRenovar}
              >
                <RotateCw aria-hidden="true" className="size-4" />
                {c.status === 'EXPIRADA' && c.ultimo_erro?.motivo !== 'CERTIFICADO_EXPIRADO' && !certificado ? 'Reconectar' : 'Renovar certificado'}
              </Button>
            ) : null}
            {podeLer ? (
              <Button type="button" variant="outline" className={BOTAO} disabled={lendo} aria-busy={lendo} onClick={onLer}>
                <RefreshCw aria-hidden="true" className={cn('size-4', lendo && 'animate-spin')} />
                {lendo ? 'Lendo' : 'Ler agora'}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" className={BOTAO} onClick={onHistorico}>
              <History aria-hidden="true" className="size-4" />
              Leituras
            </Button>
            {podeConectar ? (
              <Button
                type="button"
                variant="ghost"
                className={cn(BOTAO, 'text-[var(--fin-text-3)] hover:text-[var(--fin-negative-text)]')}
                onClick={onDesconectar}
                aria-label={`Desconectar ${linha.conta.nome}`}
              >
                <Unplug aria-hidden="true" className="size-4" />
                <span className="lg:sr-only xl:not-sr-only">Desconectar</span>
              </Button>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

export default function ExtratoAutomaticoPage() {
  const { dados, estado, erro, recarregar } = useExtratoAutomatico();
  const [janela, setJanelaBruta] = useState<ModoDaJanela | null>(null);
  // Cada abertura monta uma janela nova (nada do que foi digitado sobrevive).
  const [aberturas, setAberturas] = useState(0);
  const setJanela = (m: ModoDaJanela | null) => {
    if (m) setAberturas(n => n + 1);
    setJanelaBruta(m);
  };
  const [historico, setHistorico] = useState<ConexaoBancaria | null>(null);
  const [desconectando, setDesconectando] = useState<ConexaoBancaria | null>(null);
  const [processando, setProcessando] = useState(false);
  const [lendo, setLendo] = useState<string | null>(null);
  const agora = useMemo(() => new Date(), [dados]); // eslint-disable-line react-hooks/exhaustive-deps

  const linhas: LinhaDaTela[] = useMemo(() => {
    if (!dados) return [];
    const porConta = new Map(dados.conexoes.map(c => [c.conta_bancaria_id, c]));
    return dados.contas.map(conta => ({ conta, conexao: porConta.get(conta.id) ?? null }));
  }, [dados]);
  const semConexao = linhas.filter(l => !l.conexao || l.conexao.status === 'DESCONECTADA').map(l => l.conta);
  const ligadas = linhas.filter(l => l.conexao && l.conexao.status !== 'DESCONECTADA');
  const precisam = ligadas.filter(l => l.conexao && l.conexao.saude.nivel !== 'ok').length;
  const podeConectar = Boolean(dados?.pode_conectar && dados.cofre_disponivel && dados.provedores.length > 0);

  async function ler(c: ConexaoBancaria) {
    if (lendo) return;
    setLendo(c.id);
    try {
      const r = await lerAgora(c.id);
      const f = fraseDaLeitura(r.corpo);
      if (f.tom === 'sucesso') toast.success(f.titulo, f.detalhe);
      else if (f.tom === 'erro') toast.error(f.titulo, f.detalhe);
      else toast.info(f.titulo, f.detalhe);
      await recarregar();
    } catch {
      toast.error('Sem resposta do servidor', 'A leitura automática continua na próxima hora.');
    } finally {
      setLendo(null);
    }
  }

  async function confirmarDesconectar() {
    if (!desconectando || processando) return;
    setProcessando(true);
    try {
      const r = await fetch(`/api/extrato-automatico/${encodeURIComponent(desconectando.id)}`, { method: 'DELETE' });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível desconectar.');
      toast.success('Conta desconectada', 'As credenciais foram apagadas. O extrato que já chegou continua na conciliação.');
      setDesconectando(null);
      await recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível desconectar.');
    } finally {
      setProcessando(false);
    }
  }

  const esqueleto = (
    <div className={cn(CARTAO, 'flex flex-col divide-y divide-[var(--fin-border)]')}>
      {[0, 1, 2].map(i => (
        <div key={i} className="grid gap-[var(--fin-s-3)] p-[var(--fin-s-4)] lg:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)_auto]">
          <span className="block h-4 w-40 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="flex flex-col gap-[var(--fin-s-2)]">
            <span className="block h-5 w-56 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
            <span className="block h-4 w-full max-w-md rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          </span>
          <span className="block h-9 w-28 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
        </div>
      ))}
    </div>
  );

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={Landmark}
        titulo="Extrato automático"
        subtitulo="O Financeiro lê o extrato direto do banco da agência e cada lançamento entra na conciliação. Sem baixar arquivo, sem custo por leitura."
        acaoPrimaria={podeConectar && semConexao.length > 0 ? { rotulo: 'Conectar conta', icone: PlugZap, onClick: () => setJanela({ tipo: 'nova' }) } : undefined}
        onRecarregar={recarregar}
      />

      {estado === 'sem-acesso' ? (
        <EmptyLesson motivo="erro" titulo="Sem acesso a esta tela" oQueE={erro ?? 'Seu perfil não inclui ver as contas bancárias.'} />
      ) : (
        <DataState
          estado={estado === 'ok' ? 'ok' : estado === 'erro' ? 'erro' : 'carregando'}
          erro={estado === 'erro' ? { mensagem: erro ?? 'Não foi possível carregar.', onTentarDeNovo: () => void recarregar() } : null}
          esqueleto={esqueleto}
        >
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            {dados && !dados.cofre_disponivel && dados.pode_conectar ? (
              <Callout tom="negativo" titulo="O cofre de credenciais não está ligado neste servidor">
                Sem ele não dá para guardar as credenciais do banco com segurança, então a conexão fica desligada. Fale com o suporte do EnturOS. A importação por arquivo continua funcionando.
              </Callout>
            ) : null}

            {linhas.length === 0 ? (
              <EmptyLesson
                motivo="sem-dado"
                titulo="Cadastre uma conta bancária primeiro"
                oQueE="A leitura automática é por conta: cada conta do banco fica ligada à integração que a agência cria no próprio banco."
                comoComeca={[
                  'Abra Contas bancárias e cadastre a conta.',
                  'Volte aqui e clique em Conectar conta.',
                  'Siga o passo a passo do banco: leva uns minutos e é de graça.',
                ]}
                acao={{ rotulo: 'Ir para contas bancárias', href: '/financeiro-ag/contas-bancarias' }}
              />
            ) : (
              <section aria-labelledby="titulo-contas" className="flex flex-col gap-[var(--fin-s-3)]">
                <div className="flex flex-wrap items-baseline justify-between gap-[var(--fin-s-2)]">
                  <h2 id="titulo-contas" className="fin-t-subhead text-[var(--fin-text)]">Contas bancárias</h2>
                  <span className="fin-t-caption text-[var(--fin-text-3)]">
                    {ligadas.length === 0
                      ? 'Nenhuma conta lendo sozinha ainda'
                      : `${ligadas.length} de ${linhas.length} ${linhas.length === 1 ? 'conta lê' : 'contas leem'} sozinhas${precisam ? `, ${precisam} ${precisam === 1 ? 'precisa' : 'precisam'} de atenção` : ''}`}
                  </span>
                </div>
                <ul className={cn(CARTAO, 'flex flex-col divide-y divide-[var(--fin-border)]')}>
                  {linhas.map(l => (
                    <LinhaDaConta
                      key={l.conta.id}
                      linha={l}
                      agora={agora}
                      podeConectar={podeConectar}
                      podeLer={Boolean(dados?.pode_ler)}
                      lendo={lendo === l.conexao?.id}
                      onConectar={() => setJanela({ tipo: 'nova', contaId: l.conta.id })}
                      onRenovar={() => l.conexao && setJanela({ tipo: 'renovar', conexao: l.conexao })}
                      onLer={() => l.conexao && void ler(l.conexao)}
                      onHistorico={() => setHistorico(l.conexao)}
                      onDesconectar={() => setDesconectando(l.conexao)}
                    />
                  ))}
                </ul>
              </section>
            )}

            {linhas.length > 0 ? (
              <section aria-labelledby="titulo-como" className="grid gap-[var(--fin-s-4)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="flex flex-col gap-[var(--fin-s-2)]">
                  <h2 id="titulo-como" className="fin-t-subhead text-[var(--fin-text)]">Como a leitura funciona</h2>
                  <ul className="fin-t-body flex list-disc flex-col gap-[var(--fin-s-1)] pl-5 text-[var(--fin-text-2)] marker:text-[var(--fin-text-3)]">
                    <li>A primeira leitura traz os últimos 90 dias. Depois, cada leitura relê os 3 dias anteriores, porque o banco às vezes ajusta lançamentos recentes.</li>
                    <li>Nada entra duas vezes: cada lançamento tem o código do banco, e o mesmo lançamento importado por arquivo é reconhecido.</li>
                    <li>A integração só tem permissão de consulta. O Financeiro não paga, não transfere e não mexe na conta.</li>
                  </ul>
                </div>
                <div className="flex flex-col gap-[var(--fin-s-2)]">
                  <h2 className="fin-t-subhead text-[var(--fin-text)]">Quando algo para</h2>
                  <ul className="fin-t-body flex list-disc flex-col gap-[var(--fin-s-1)] pl-5 text-[var(--fin-text-2)] marker:text-[var(--fin-text-3)]">
                    <li>Se o banco não responde, tentamos de novo em 1 hora, depois em 4 e depois uma vez por dia. Na terceira falha seguida, avisamos no sino.</li>
                    <li>O certificado do banco vale 1 ano. Avisamos 30 e 7 dias antes de vencer; renovar mantém tudo o que já foi lido.</li>
                    <li>
                      Enquanto a conexão estiver parada, o extrato continua entrando por arquivo na{' '}
                      <Link href="/financeiro-ag/conciliacao" className="inline-flex items-center gap-0.5 font-medium text-[var(--fin-accent)] underline underline-offset-2">
                        conciliação
                        <Link2 aria-hidden="true" className="size-3.5" />
                      </Link>
                      .
                    </li>
                  </ul>
                </div>
              </section>
            ) : null}
          </div>
        </DataState>
      )}

      {dados && janela ? (
        <JanelaDeConexao
          key={aberturas}
          aberto
          modo={janela}
          contasSemConexao={semConexao}
          provedores={dados.provedores}
          onFechar={() => setJanela(null)}
          onMudou={() => void recarregar()}
        />
      ) : null}

      <HistoricoDeLeituras conexao={historico} onFechar={() => setHistorico(null)} />

      <ConfirmDialog
        aberto={desconectando !== null}
        onOpenChange={a => { if (!a) setDesconectando(null); }}
        titulo="Desconectar esta conta do banco"
        oQueVaiAcontecer="O ClientSecret, o certificado e a chave desta conta são apagados agora. O extrato que já chegou continua na conciliação, com tudo o que foi conferido. Para voltar a ler sozinho, é preciso conectar de novo."
        detalhes={desconectando ? [
          { rotulo: 'Conta', valor: desconectando.conta_nome },
          { rotulo: 'Banco', valor: desconectando.provedor_nome },
        ] : undefined}
        confirmarRotulo="Desconectar"
        tone="destrutivo"
        processando={processando}
        onConfirmar={confirmarDesconectar}
      />
    </MolduraDaPagina>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import { CalendarClock, Copy, Link2Off, Pause, Pencil, Play, Send, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { Callout } from '@/components/fin/Callout';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { usePodeExportar } from '@/components/fin/BotaoExportar';
import { FormularioDeEnvio, type EnvioParaEditar } from '@/components/relatorios/FormularioDeEnvio';
import { ROTULO_RELATORIO_AGENDAVEL } from '@/lib/relatorios-agendados/regras';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * Envios agendados de relatório (E7, G3): o que sai, quando, para quem, o que
 * aconteceu no último envio; enviar agora, pausar, mudar, apagar; e os links
 * de leitura de cada envio, com quantas vezes abriram e o botão de desligar.
 */

interface Agendamento extends EnvioParaEditar {
  descricao: string;
  criado_por_nome: string;
  ver_receita: boolean;
  proximo_envio: string | null;
  ultimo_envio: string | null;
  ultimo_resultado: string;
}
interface Envio { id: string; de: string; ate: string; frase: string; detalhe: string; situacao: string; linhas: number; manual: boolean; criado_em: string; leitura_id: string | null }
interface Leitura { id: string; criado_em: string; expira_em: string; situacao: 'valendo' | 'vencido' | 'revogado'; acessos: number; ultimo_acesso: string | null; url: string | null }

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const dia = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const ROTULO_LINK: Record<Leitura['situacao'], string> = { valendo: 'Valendo', vencido: 'Venceu', revogado: 'Desligado' };
const TOM_LINK: Record<Leitura['situacao'], string> = {
  valendo: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]',
  vencido: 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]',
  revogado: 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]',
};

export function TelaDeEnvios() {
  const [lista, setLista] = React.useState<Agendamento[]>([]);
  const [crm, setCrm] = React.useState<boolean | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  const [aberto, setAberto] = React.useState<Agendamento | null>(null);
  const [detalhe, setDetalhe] = React.useState<{ envios: Envio[]; leituras: Leitura[] } | null>(null);
  const [editando, setEditando] = React.useState<Agendamento | null>(null);
  const [apagando, setApagando] = React.useState<Agendamento | null>(null);
  const [linkNovo, setLinkNovo] = React.useState<{ url: string; expira_em: string; situacao: string } | null>(null);
  const [ocupado, setOcupado] = React.useState<string | null>(null);
  const podeMudar = usePodeExportar();

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      const r = await fetch('/api/relatorios/agendados', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível abrir os envios.');
      setLista(j.agendamentos);
      setCrm(Boolean(j.crm_ligado));
      setEstado('ok');
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir os envios.');
      setEstado('erro');
    }
  }, []);
  React.useEffect(() => { void carregar(); }, [carregar]);

  const abrir = React.useCallback(async (a: Agendamento) => {
    setAberto(a);
    setDetalhe(null);
    const r = await fetch(`/api/relatorios/agendados/${encodeURIComponent(a.id)}`, { cache: 'no-store' });
    const j = await r.json().catch(() => null);
    if (r.ok && j) setDetalhe({ envios: j.envios, leituras: j.leituras });
  }, []);

  // Vindo do sino (?abrir=id): abre o envio assim que a lista chega.
  const pedidoDeAbrir = React.useRef<string | null>(null);
  React.useEffect(() => { pedidoDeAbrir.current = new URLSearchParams(window.location.search).get('abrir'); }, []);
  React.useEffect(() => {
    const id = pedidoDeAbrir.current;
    if (!id || estado !== 'ok') return;
    pedidoDeAbrir.current = null;
    const a = lista.find(x => x.id === id);
    if (a) void abrir(a);
  }, [estado, lista, abrir]);

  async function enviarAgora(a: Agendamento) {
    setOcupado(a.id);
    try {
      const r = await fetch(`/api/relatorios/agendados/${encodeURIComponent(a.id)}/enviar`, { method: 'POST' });
      const j = await r.json().catch(() => null);
      const res = j?.resultado;
      if (!r.ok || !res) { toast.error('Não foi possível enviar.', j?.error ?? res?.detalhe ?? ''); return; }
      if (res.situacao === 'pulado') { toast.warning('Nada saiu.', res.detalhe); return; }
      if (res.url) setLinkNovo({ url: res.url, expira_em: res.expira_em, situacao: res.situacao });
      void carregar();
      if (aberto?.id === a.id) void abrir(a);
    } finally {
      setOcupado(null);
    }
  }

  async function alternar(a: Agendamento) {
    setOcupado(a.id);
    const r = await fetch(`/api/relatorios/agendados/${encodeURIComponent(a.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: !a.ativo }) });
    setOcupado(null);
    if (!r.ok) { toast.error('Não foi possível mudar.', (await r.json().catch(() => null))?.error ?? ''); return; }
    toast.success(a.ativo ? 'Envio pausado' : 'Envio retomado');
    void carregar();
  }

  async function revogar(l: Leitura) {
    const r = await fetch(`/api/relatorios/agendados/leituras/${encodeURIComponent(l.id)}/revogar`, { method: 'POST' });
    if (!r.ok) { toast.error('Não foi possível desligar o link.', (await r.json().catch(() => null))?.error ?? ''); return; }
    toast.success('Link desligado', 'Quem abrir agora vê que o link não abre mais.');
    if (aberto) void abrir(aberto);
  }

  async function copiar(url: string) {
    try { await navigator.clipboard.writeText(url); toast.success('Link copiado'); } catch { toast.error('Não foi possível copiar.', 'Selecione o link e copie.'); }
  }

  const colunas: FinColuna<Agendamento>[] = [
    { id: 'nome', cabecalho: 'Envio', tipo: 'texto', sortable: true, acessor: a => a.nome, prioridade: 3, minWidth: 220,
      render: a => (
        <span className="flex flex-col">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{a.nome}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{ROTULO_RELATORIO_AGENDAVEL[a.relatorio] ?? 'Relatório'} · {a.descricao}</span>
        </span>
      ) },
    { id: 'para', cabecalho: 'Para', tipo: 'texto', prioridade: 2, render: a => <span className="fin-t-body text-[var(--fin-text-2)]">{a.destinatarios.length === 1 ? a.destinatarios[0] : `${a.destinatarios[0]} e mais ${a.destinatarios.length - 1}`}</span> },
    { id: 'proximo', cabecalho: 'Próximo envio', tipo: 'texto', sortable: true, acessor: a => a.proximo_envio ?? '', prioridade: 3,
      render: a => (a.ativo ? <span className="tabular-nums">{quando(a.proximo_envio)}</span> : <span className="fin-t-caption font-medium text-[var(--fin-text-3)]">Pausado</span>) },
    { id: 'ultimo', cabecalho: 'Último envio', tipo: 'texto', prioridade: 1,
      render: a => (a.ultimo_envio ? <span className="flex flex-col"><span className="tabular-nums">{quando(a.ultimo_envio)}</span><span className="fin-t-caption text-[var(--fin-text-3)]">{a.ultimo_resultado}</span></span> : <span className="text-[var(--fin-text-3)]">Ainda não saiu</span>) },
    { id: 'acoes', cabecalho: '', tipo: 'acoes',
      render: a => (podeMudar ? (
        <span className="flex justify-end gap-1">
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Enviar agora: ${a.nome}`} title="Enviar agora" disabled={ocupado === a.id} onClick={e => { e.stopPropagation(); void enviarAgora(a); }}><Send className="size-4" /></Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`${a.ativo ? 'Pausar' : 'Retomar'}: ${a.nome}`} title={a.ativo ? 'Pausar' : 'Retomar'} disabled={ocupado === a.id} onClick={e => { e.stopPropagation(); void alternar(a); }}>{a.ativo ? <Pause className="size-4" /> : <Play className="size-4" />}</Button>
        </span>
      ) : null) },
  ];

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={CalendarClock}
        titulo="Envios agendados"
        subtitulo="Relatórios que saem sozinhos por e-mail, com um link de leitura que vale por um tempo e pode ser desligado."
        acoesSecundarias={[
          { rotulo: 'Relatórios de vendas', href: '/relatorios/vendas' },
          { rotulo: 'Resultado do mês', href: '/financeiro-ag/dre' },
          { rotulo: 'Fluxo de caixa', href: '/financeiro-ag/fluxo-caixa' },
        ]}
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
      />
      <div className={RITMO_DA_PAGINA}>
        {crm === false ? (
          <Callout tom="info">
            O CRM não está ligado, então o e-mail não sai sozinho. A cada envio, o link de leitura fica pronto aqui e no sino para você copiar e mandar.
          </Callout>
        ) : null}
        <FinTable<Agendamento>
          linhas={lista}
          colunas={colunas}
          chave={a => a.id}
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
          vazio={{
            motivo: 'sem-dado', titulo: 'Nenhum envio agendado',
            oQueE: 'Relatórios que saem sozinhos por e-mail todo dia, toda semana ou todo mês.',
            comoComeca: ['Abra Relatórios de vendas, o Resultado do mês, o Fluxo de caixa ou a Visão geral', 'Escolha os filtros', 'Use "Agendar envio"'],
            acao: { rotulo: 'Abrir relatórios de vendas', href: '/relatorios/vendas' },
          }}
          onLinhaClick={a => { void abrir(a); }}
        />
      </div>

      {aberto ? (
        <RecordSheet
          aberto
          onOpenChange={o => { if (!o) setAberto(null); }}
          largura={640}
          titulo={aberto.nome}
          descricao={`${aberto.descricao}. Salvo por ${aberto.criado_por_nome || 'alguém da agência'}${aberto.ver_receita ? '' : ', sem o ganho da agência'}.`}
          acaoPrimaria={podeMudar ? { rotulo: ocupado === aberto.id ? 'Enviando…' : 'Enviar agora', onClick: () => enviarAgora(aberto), carregando: ocupado === aberto.id } : { rotulo: 'Fechar janela', onClick: () => setAberto(null) }}
          acaoSecundaria={{ rotulo: 'Fechar', onClick: () => setAberto(null) }}
        >
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            <div className="flex flex-col gap-[var(--fin-s-1)]">
              <p className="fin-t-caption font-medium text-[var(--fin-text-2)]">Para</p>
              <p className="fin-t-body break-words text-[var(--fin-text)]">{aberto.destinatarios.join(', ')}</p>
            </div>
            {podeMudar ? (
              <div className="flex flex-wrap gap-[var(--fin-s-2)]">
                <Button type="button" variant="outline" size="sm" onClick={() => { setEditando(aberto); setAberto(null); }} className="h-11 gap-1.5 lg:h-9"><Pencil className="size-4" aria-hidden="true" /> Mudar</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => { void alternar(aberto); setAberto(null); }} className="h-11 gap-1.5 lg:h-9">{aberto.ativo ? <><Pause className="size-4" aria-hidden="true" /> Pausar</> : <><Play className="size-4" aria-hidden="true" /> Retomar</>}</Button>
                <Button type="button" variant="destructive" size="sm" onClick={() => { setApagando(aberto); setAberto(null); }} className="h-11 gap-1.5 lg:h-9"><Trash2 className="size-4" aria-hidden="true" /> Apagar</Button>
              </div>
            ) : null}

            <section aria-label="Últimos envios" className="flex flex-col gap-[var(--fin-s-2)]">
              <h3 className="fin-t-subhead text-[var(--fin-text)]">Últimos envios</h3>
              {!detalhe ? <p className="fin-t-body text-[var(--fin-text-3)]">Carregando…</p> : detalhe.envios.length === 0 ? (
                <p className="fin-t-body text-[var(--fin-text-2)]">Ainda não saiu nenhum. Use &ldquo;Enviar agora&rdquo; para ver como chega.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-[var(--fin-border)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)]">
                  {detalhe.envios.map(e => (
                    <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-[var(--fin-s-3)] px-[var(--fin-s-3)] py-[var(--fin-s-2)]">
                      <span className="fin-t-body text-[var(--fin-text)]">{e.frase}{e.manual ? ' (na hora)' : ''}</span>
                      <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">{quando(e.criado_em)}{e.de ? ` · ${dia(e.de)} a ${dia(e.ate)}` : ''}{e.linhas ? ` · ${e.linhas} ${e.linhas === 1 ? 'linha' : 'linhas'}` : ''}</span>
                      {e.detalhe ? <span className="w-full fin-t-caption text-[var(--fin-text-2)]">{e.detalhe}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Links de leitura" className="flex flex-col gap-[var(--fin-s-2)]">
              <h3 className="fin-t-subhead text-[var(--fin-text)]">Links de leitura</h3>
              <p className="fin-t-caption text-[var(--fin-text-3)]">Cada envio cria um link. Aqui dá para copiar de novo os que ainda valem, ver se abriram e desligar.</p>
              {detalhe && detalhe.leituras.length ? (
                <ul className="flex flex-col divide-y divide-[var(--fin-border)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)]">
                  {detalhe.leituras.map(l => (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-[var(--fin-s-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)]">
                      <span className="flex flex-col">
                        <span className="fin-t-body tabular-nums text-[var(--fin-text)]">Criado em {quando(l.criado_em)}</span>
                        <span className="fin-t-caption text-[var(--fin-text-3)]">
                          {l.situacao === 'valendo' ? `Vale até ${quando(l.expira_em)}` : ROTULO_LINK[l.situacao]} · {l.acessos === 0 ? 'ninguém abriu' : `aberto ${l.acessos} ${l.acessos === 1 ? 'vez' : 'vezes'}`}
                        </span>
                      </span>
                      <span className="flex items-center gap-[var(--fin-s-2)]">
                        <span className={cn('rounded-[var(--fin-r-sm)] px-2 py-0.5 fin-t-caption font-medium', TOM_LINK[l.situacao])}>{ROTULO_LINK[l.situacao]}</span>
                        {l.url ? (
                          <Button type="button" variant="ghost" size="sm" onClick={() => { void copiar(l.url!); }} className="h-11 gap-1.5 lg:h-8"><Copy className="size-4" aria-hidden="true" /> Copiar</Button>
                        ) : null}
                        {l.situacao === 'valendo' && podeMudar ? (
                          <Button type="button" variant="ghost" size="sm" onClick={() => { void revogar(l); }} className="h-11 gap-1.5 lg:h-8"><Link2Off className="size-4" aria-hidden="true" /> Desligar</Button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : detalhe ? <p className="fin-t-body text-[var(--fin-text-2)]">Nenhum link ainda.</p> : null}
            </section>
          </div>
        </RecordSheet>
      ) : null}

      {linkNovo ? (
        <RecordSheet
          aberto
          onOpenChange={o => { if (!o) setLinkNovo(null); }}
          largura={480}
          titulo={linkNovo.situacao === 'so_link' ? 'Link pronto para mandar' : linkNovo.situacao === 'enviado' ? 'Enviado pelo CRM' : 'Na fila do CRM'}
          descricao={linkNovo.situacao === 'so_link' ? 'O CRM não está ligado: copie o link e mande para quem precisa.' : 'O CRM manda o e-mail com este link. Ele também está aqui, se quiser repassar.'}
          acaoPrimaria={{ rotulo: 'Copiar link', onClick: () => copiar(linkNovo.url) }}
          acaoSecundaria={{ rotulo: 'Fechar', onClick: () => setLinkNovo(null) }}
        >
          <div className="flex flex-col gap-[var(--fin-s-2)]">
            <div className="flex items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-2)]">
              <code className="min-w-0 flex-1 truncate fin-t-caption text-[var(--fin-text)]">{linkNovo.url}</code>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Copiar link" onClick={() => { void copiar(linkNovo.url); }}><Copy className="size-4" /></Button>
            </div>
            <p className="fin-t-caption text-[var(--fin-text-3)]">Vale até {quando(linkNovo.expira_em)}. Enquanto valer, ele fica também em Links de leitura deste envio.</p>
            <Link href={linkNovo.url} target="_blank" rel="noreferrer" className="fin-t-body text-[var(--fin-accent)] underline-offset-4 hover:underline">Abrir como quem recebe</Link>
          </div>
        </RecordSheet>
      ) : null}

      {editando ? (
        <FormularioDeEnvio
          aberto
          existente={editando}
          onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); void carregar(); }}
          consulta={editando.consulta}
          nomeSugerido={editando.nome}
          resumoDosFiltros="Os mesmos filtros de quando o envio foi agendado. Para mudar os filtros, agende de novo a partir do relatório."
          crmLigado={crm}
        />
      ) : null}

      <ConfirmDialog
        aberto={Boolean(apagando)}
        onOpenChange={o => { if (!o) setApagando(null); }}
        titulo={`Apagar "${apagando?.nome ?? ''}"?`}
        oQueVaiAcontecer="O envio para de sair e todos os links de leitura dele são desligados na hora. Quem já baixou o arquivo continua com ele."
        confirmarRotulo="Apagar envio"
        tone="destrutivo"
        onConfirmar={async () => {
          if (!apagando) return;
          const r = await fetch(`/api/relatorios/agendados/${encodeURIComponent(apagando.id)}`, { method: 'DELETE' });
          if (!r.ok) { toast.error('Não foi possível apagar.', (await r.json().catch(() => null))?.error ?? ''); return; }
          toast.success('Envio apagado');
          setApagando(null);
          void carregar();
        }}
      />
    </MolduraDaPagina>
  );
}

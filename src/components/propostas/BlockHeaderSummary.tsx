'use client';

import {
  Plane, Hotel, Car, Bus, TrainFront, Ship, Calendar, MapPin,
  Image as ImageIcon, MessageCircle, Clock,
} from 'lucide-react';
import type { ComponentType } from 'react';

interface Props {
  tipo: string;
  conteudo: Record<string, unknown>;
}

// Helpers ----------------------------------------------------------------

function fmtBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n).trim()}…` : s;
}

// Limpa HTML grosseiramente (RichTextEditor salva como HTML). Pega texto
// puro pra mostrar no header.
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function fmtDateBR(d: string): string {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return d;
  return `${day}/${m}`;
}

const TRANSPORTE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  VOO: Plane,
  TRANSFER: Car,
  TREM: TrainFront,
  ONIBUS: Bus,
  CARRO: Car,
  BARCO: Ship,
};

// Renderers --------------------------------------------------------------

function AlojamentoSummary({ c }: { c: Record<string, unknown> }) {
  const nome = (c.hotel_nome as string) || (c.destino_nome as string) || 'Hospedagem';
  const imagem = c.hotel_imagem as string | undefined;
  const estrelas = (c.hotel_estrelas as number) || 0;
  const cidade = (c.destino_nome as string) || '';
  const checkIn = (c.check_in as string) || '';
  const checkOut = (c.check_out as string) || '';

  return (
    <div className="flex items-center gap-2 min-w-0">
      {imagem ? (
        <img
          src={imagem}
          alt=""
          className="w-7 h-7 rounded object-cover shrink-0 border border-[var(--t-border)]"
          referrerPolicy="no-referrer"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <Hotel className="w-4 h-4 text-[var(--t-text-muted)] shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-xs text-[var(--t-text)] truncate">
          {truncate(nome, 38)}
          {estrelas > 0 && (
            <span className="ml-1.5 text-amber-500 text-[10px]">{'★'.repeat(Math.min(estrelas, 5))}</span>
          )}
        </div>
        {(cidade || checkIn) && (
          <div className="text-[10px] text-[var(--t-text-muted)] truncate">
            {cidade}
            {checkIn && checkOut && ` · ${fmtDateBR(checkIn)}→${fmtDateBR(checkOut)}`}
          </div>
        )}
      </div>
    </div>
  );
}

function VooSummary({ c }: { c: Record<string, unknown> }) {
  const cia = (c.companhia as string) || '';
  const numero = (c.numero_voo as string) || '';
  const origem = (c.origem as string) || '';
  const destino = (c.destino as string) || '';
  const hSaida = (c.horario_saida as string) || '';
  const hChegada = (c.horario_chegada as string) || '';
  const data = (c.data as string) || '';
  const logo = c.companhia_logo as string | undefined;
  const etapa = (c.voo_etapa as string) || '';

  if (!origem && !destino && !cia) {
    return <span className="text-[10px] text-[var(--t-text-muted)] italic">Voo não configurado</span>;
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      {logo ? (
        <img
          src={logo}
          alt={cia}
          className="w-5 h-5 rounded object-contain shrink-0 bg-white border border-[var(--t-border)]"
          referrerPolicy="no-referrer"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <Plane className="w-4 h-4 text-[var(--t-text-muted)] shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-xs text-[var(--t-text)] truncate flex items-center gap-1.5">
          <span className="tabular-nums font-medium">{origem || '???'}</span>
          <span className="text-[var(--t-text-muted)]">→</span>
          <span className="tabular-nums font-medium">{destino || '???'}</span>
          {etapa && (
            <span className="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded bg-[var(--t-blue)]/10 text-[var(--t-blue)]">{etapa}</span>
          )}
        </div>
        <div className="text-[10px] text-[var(--t-text-muted)] truncate">
          {[cia, numero, fmtDateBR(data), hSaida && hChegada ? `${hSaida}→${hChegada}` : ''].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  );
}

function TransporteSummary({ c }: { c: Record<string, unknown> }) {
  const tipo = (c.tipo as string) || 'TRANSFER';
  // VOO ja tem seu proprio render dedicado; aqui so cuida do resto.
  if (tipo === 'VOO') return <VooSummary c={c} />;

  const Icon = TRANSPORTE_ICONS[tipo] || Car;
  const origem = (c.origem as string) || '';
  const destino = (c.destino as string) || '';
  const data = (c.data as string) || '';
  const companhia = (c.companhia as string) || '';

  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon className="w-4 h-4 text-[var(--t-text-muted)] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-[var(--t-text)] truncate">
          {origem || destino ? `${origem || '?'} → ${destino || '?'}` : `${tipo.toLowerCase()}`}
        </div>
        {(companhia || data) && (
          <div className="text-[10px] text-[var(--t-text-muted)] truncate">
            {[companhia, fmtDateBR(data)].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

function RoteiroDiaSummary({ c }: { c: Record<string, unknown> }) {
  const dias = (c.dias as Array<{ atividades?: unknown[] }> | undefined) || [];
  const totalAtividades = dias.reduce((acc, d) => acc + (d.atividades?.length || 0), 0);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Calendar className="w-4 h-4 text-[var(--t-text-muted)] shrink-0" />
      <span className="text-xs text-[var(--t-text)] truncate">
        {dias.length} {dias.length === 1 ? 'dia' : 'dias'}
        {totalAtividades > 0 && (
          <span className="text-[var(--t-text-muted)]"> · {totalAtividades} atividade{totalAtividades !== 1 ? 's' : ''}</span>
        )}
      </span>
    </div>
  );
}

function ValoresSummary({ c }: { c: Record<string, unknown> }) {
  const opcoes = (c.opcoes as Array<{ titulo?: string; valor_total?: number; destaque?: boolean }>) || [];
  if (opcoes.length === 0) return <span className="text-[10px] text-[var(--t-text-muted)] italic">Sem opções</span>;
  const principal = opcoes.find(o => o.destaque) || opcoes[0];
  const valor = principal?.valor_total || 0;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-[var(--t-text)] truncate">
          <span className="tabular-nums font-medium text-[var(--t-green)]">{fmtBRL(valor)}</span>
          {opcoes.length > 1 && (
            <span className="text-[10px] text-[var(--t-text-muted)] ml-1.5">+{opcoes.length - 1} {opcoes.length === 2 ? 'opção' : 'opções'}</span>
          )}
        </div>
        {principal?.titulo && (
          <div className="text-[10px] text-[var(--t-text-muted)] truncate">{principal.titulo}</div>
        )}
      </div>
    </div>
  );
}

function TextoSummary({ c }: { c: Record<string, unknown> }) {
  const titulo = (c.titulo as string) || '';
  const corpo = stripHtml((c.corpo as string) || '');
  if (!titulo && !corpo) return <span className="text-[10px] text-[var(--t-text-muted)] italic">Texto vazio</span>;
  return (
    <span className="text-xs text-[var(--t-text)] truncate">
      {titulo && <span className="font-medium">{truncate(titulo, 40)}</span>}
      {titulo && corpo && <span className="text-[var(--t-text-muted)]"> · </span>}
      {corpo && <span className="text-[var(--t-text-muted)]">{truncate(corpo, 60)}</span>}
    </span>
  );
}

function ServicoSummary({ c }: { c: Record<string, unknown> }) {
  const icone = (c.icone as string) || '';
  const titulo = (c.titulo as string) || '';
  const valor = (c.valor as number) || 0;
  const exibirValor = (c.exibir_valor as boolean) ?? true;
  return (
    <span className="text-xs text-[var(--t-text)] truncate flex items-center gap-1.5">
      {icone && <span>{icone}</span>}
      {titulo || <span className="text-[var(--t-text-muted)] italic">Serviço sem título</span>}
      {valor > 0 && exibirValor && (
        <span className="text-[10px] text-[var(--t-green)] tabular-nums">{fmtBRL(valor)}</span>
      )}
    </span>
  );
}

function GaleriaSummary({ c }: { c: Record<string, unknown> }) {
  const imagens = (c.imagens as string[]) || [];
  return (
    <div className="flex items-center gap-2 min-w-0">
      <ImageIcon className="w-4 h-4 text-[var(--t-text-muted)] shrink-0" />
      <span className="text-xs text-[var(--t-text)]">
        {imagens.length} {imagens.length === 1 ? 'foto' : 'fotos'}
      </span>
      {imagens.length > 0 && (
        <div className="flex -space-x-1 ml-1">
          {imagens.slice(0, 3).map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              className="w-5 h-5 rounded object-cover border border-[var(--t-border)] bg-[var(--t-bg)]"
              referrerPolicy="no-referrer"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InclusosSummary({ c }: { c: Record<string, unknown> }) {
  const inclusos = ((c.inclusos as string[]) || []).filter(Boolean);
  const naoInclusos = ((c.nao_inclusos as string[]) || []).filter(Boolean);
  return (
    <span className="text-xs text-[var(--t-text)]">
      <span className="text-[var(--t-green)] font-medium">{inclusos.length} incluso{inclusos.length !== 1 ? 's' : ''}</span>
      <span className="text-[var(--t-text-muted)]"> · </span>
      <span className="text-red-500">{naoInclusos.length} não inclus{naoInclusos.length === 1 ? 'o' : 'os'}</span>
    </span>
  );
}

function DepoimentoSummary({ c }: { c: Record<string, unknown> }) {
  const dep = (c.depoimentos as Array<{ autor?: string }>) || [];
  return (
    <span className="text-xs text-[var(--t-text)] truncate flex items-center gap-1.5">
      <MessageCircle className="w-4 h-4 text-[var(--t-text-muted)] shrink-0" />
      {dep.length} depoimento{dep.length !== 1 ? 's' : ''}
      {dep[0]?.autor && <span className="text-[10px] text-[var(--t-text-muted)] truncate">— {dep[0].autor}</span>}
    </span>
  );
}

function CtaSummary({ c }: { c: Record<string, unknown> }) {
  const texto = (c.texto_botao as string) || '';
  const acao = (c.tipo_acao as string) || '';
  return (
    <span className="text-xs text-[var(--t-text)] truncate">
      {texto ? `"${truncate(texto, 32)}"` : <span className="italic text-[var(--t-text-muted)]">Sem texto</span>}
      {acao && <span className="text-[10px] text-[var(--t-text-muted)] ml-1.5">→ {acao}</span>}
    </span>
  );
}

function VideoSummary({ c }: { c: Record<string, unknown> }) {
  const titulo = (c.titulo as string) || '';
  const url = (c.url as string) || '';
  return (
    <span className="text-xs text-[var(--t-text)] truncate">
      {titulo || (url ? truncate(url, 50) : <span className="italic text-[var(--t-text-muted)]">Sem vídeo</span>)}
    </span>
  );
}

function MapaSummary({ c }: { c: Record<string, unknown> }) {
  const titulo = (c.titulo as string) || '';
  const pontos = ((c.pontos as unknown[]) || []).length;
  return (
    <span className="text-xs text-[var(--t-text)] truncate flex items-center gap-1.5">
      <MapPin className="w-4 h-4 text-[var(--t-text-muted)] shrink-0" />
      {titulo || 'Mapa'}
      <span className="text-[10px] text-[var(--t-text-muted)]">· {pontos} ponto{pontos !== 1 ? 's' : ''}</span>
    </span>
  );
}

function FaqSummary({ c }: { c: Record<string, unknown> }) {
  const titulo = (c.titulo as string) || 'Perguntas Frequentes';
  const perguntas = ((c.perguntas as unknown[]) || []).length;
  return (
    <span className="text-xs text-[var(--t-text)] truncate">
      {truncate(titulo, 40)}
      <span className="text-[10px] text-[var(--t-text-muted)] ml-1.5">· {perguntas} pergunta{perguntas !== 1 ? 's' : ''}</span>
    </span>
  );
}

function CountdownSummary({ c }: { c: Record<string, unknown> }) {
  const data = (c.data_evento as string) || '';
  const titulo = (c.titulo as string) || '';
  return (
    <span className="text-xs text-[var(--t-text)] truncate flex items-center gap-1.5">
      <Clock className="w-4 h-4 text-[var(--t-text-muted)] shrink-0" />
      {titulo || 'Countdown'}
      {data && <span className="text-[10px] text-[var(--t-text-muted)]">→ {fmtDateBR(data)}</span>}
    </span>
  );
}

// Dispatcher -------------------------------------------------------------

export function BlockHeaderSummary({ tipo, conteudo }: Props) {
  switch (tipo) {
    case 'ALOJAMENTO': return <AlojamentoSummary c={conteudo} />;
    case 'VOO': return <VooSummary c={conteudo} />;
    case 'TRANSPORTE': return <TransporteSummary c={conteudo} />;
    case 'ROTEIRO_DIA': return <RoteiroDiaSummary c={conteudo} />;
    case 'VALORES': return <ValoresSummary c={conteudo} />;
    case 'TEXTO': return <TextoSummary c={conteudo} />;
    case 'SERVICO': return <ServicoSummary c={conteudo} />;
    case 'GALERIA': return <GaleriaSummary c={conteudo} />;
    case 'INCLUSOS': return <InclusosSummary c={conteudo} />;
    case 'DEPOIMENTO': return <DepoimentoSummary c={conteudo} />;
    case 'CTA': return <CtaSummary c={conteudo} />;
    case 'VIDEO': return <VideoSummary c={conteudo} />;
    case 'MAPA': return <MapaSummary c={conteudo} />;
    case 'FAQ': return <FaqSummary c={conteudo} />;
    case 'COUNTDOWN': return <CountdownSummary c={conteudo} />;
    default: return null;
  }
}

'use client';

import { SecaoProposta, type AlojamentoData, type TransporteData } from '@/lib/crm-types';
import { CheckCircle2, XCircle, MessageCircle, Star, Clock, MapPin } from 'lucide-react';
import { MapaRoteiro } from '@/components/propostas/MapaRoteiro';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';
import { RichFlightCard } from './RichFlightCard';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

// ─── TEXTO ───
function TextoPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const c = conteudo as { titulo?: string; corpo?: string; imagem_url?: string };
  const isHTML = c.corpo?.includes('<');
  return (
    <div className="space-y-3">
      {c.titulo && <h3 className="text-2xl font-bold tracking-tight">{c.titulo}</h3>}
      {c.imagem_url && (
        <div className="rounded-xl overflow-hidden shadow-sm">
          <img src={c.imagem_url} alt={c.titulo || ''} className="w-full h-auto max-h-[400px] object-cover" />
        </div>
      )}
      {c.corpo && (
        isHTML
          ? <div className="prose prose-sm max-w-none leading-relaxed opacity-80 [&_a]:text-emerald-600 [&_a]:underline [&_mark]:bg-yellow-200/50 [&_blockquote]:border-l-4 [&_blockquote]:border-emerald-300 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:opacity-70" dangerouslySetInnerHTML={{ __html: c.corpo }} />
          : <p className="whitespace-pre-wrap leading-relaxed opacity-80 text-[15px]">{c.corpo}</p>
      )}
    </div>
  );
}

// ─── SERVICO ───
function ServicoPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const c = conteudo as { icone?: string; titulo?: string; descricao?: string; detalhes?: string[]; imagem?: string; valor?: number; exibir_valor?: boolean };
  const hasImage = !!c.imagem;

  return (
    <div className={`rounded-2xl overflow-hidden shadow-sm border border-gray-100 ${hasImage ? '' : 'p-5'}`}>
      {hasImage && (
        <div className="relative h-48 w-full">
          <img src={c.imagem} alt={c.titulo || ''} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <div className="absolute bottom-4 left-5 right-5">
            <div className="flex items-center gap-2">
              {c.icone && <span className="text-2xl drop-shadow-lg">{c.icone}</span>}
              <h4 className="text-xl font-bold text-white drop-shadow-lg">{c.titulo}</h4>
            </div>
          </div>
        </div>
      )}
      <div className={hasImage ? 'p-5' : ''}>
        {!hasImage && (
          <div className="flex items-center gap-2 mb-2">
            {c.icone && <span className="text-2xl">{c.icone}</span>}
            <h4 className="text-lg font-bold">{c.titulo}</h4>
          </div>
        )}
        {c.descricao && <p className="opacity-70 text-sm whitespace-pre-wrap leading-relaxed">{c.descricao}</p>}
        {c.detalhes && c.detalhes.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {c.detalhes.filter(d => d !== '---').map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        )}
        {c.exibir_valor && c.valor && c.valor > 0 && (
          <div className="mt-3 text-xl font-bold text-emerald-600">{BRL(c.valor)}</div>
        )}
      </div>
    </div>
  );
}

// ─── ROTEIRO DIA ───
function RoteiroDiaPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const dias = (conteudo as { dias?: Array<{ numero: number; titulo: string; descricao: string; imagem?: string; lat?: number; lng?: number; atividades?: string[] }> }).dias || [];
  const pontosComCoord = dias.filter(d => d.lat && d.lng).map(d => ({
    lat: d.lat!, lng: d.lng!, label: d.titulo, dia: d.numero,
  }));

  return (
    <div className="space-y-4">
      {pontosComCoord.length > 0 && (
        <div className="mb-6 rounded-2xl overflow-hidden shadow-sm">
          <MapaRoteiro pontos={pontosComCoord} height="320px" />
        </div>
      )}
      {dias.map((dia, i) => (
        <div key={i} className="flex gap-4">
          <div className="flex flex-col items-center">
            <div className="w-11 h-11 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-md">
              {dia.numero}
            </div>
            {i < dias.length - 1 && <div className="w-0.5 flex-1 bg-emerald-200 mt-1" />}
          </div>
          <div className="flex-1 pb-6">
            <h4 className="font-bold text-lg">{dia.titulo}</h4>
            {dia.imagem && (
              <img src={dia.imagem} alt={dia.titulo} className="mt-2 rounded-xl w-full max-h-56 object-cover shadow-sm" />
            )}
            {dia.descricao && <p className="mt-2 text-sm opacity-75 whitespace-pre-wrap leading-relaxed">{dia.descricao}</p>}
            {dia.atividades && dia.atividades.length > 0 && (
              <ul className="mt-2 space-y-1">
                {dia.atividades.map((a, j) => (
                  <li key={j} className="flex items-start gap-1.5 text-sm">
                    <Star className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500 fill-amber-500" />
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── GALERIA ───
function GaleriaPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const imgs = (conteudo as { imagens?: Array<{ url: string; legenda?: string }> }).imagens || [];
  if (imgs.length === 0) return null;

  // Hero layout: first image large, rest in grid
  const [hero, ...rest] = imgs;

  return (
    <div className="space-y-2">
      {/* Hero image */}
      <div className="relative rounded-2xl overflow-hidden shadow-sm">
        <img src={hero.url} alt={hero.legenda || ''} className="w-full h-72 object-cover" />
        {hero.legenda && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-3">
            <span className="text-white text-sm font-medium">{hero.legenda}</span>
          </div>
        )}
      </div>
      {/* Thumbnails */}
      {rest.length > 0 && (
        <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
          {rest.map((img, i) => (
            <div key={i} className="relative group rounded-xl overflow-hidden">
              <img src={img.url} alt={img.legenda || ''} className="w-full h-32 object-cover transition-transform group-hover:scale-105" />
              {img.legenda && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {img.legenda}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── INCLUSOS ───
function InclusosPreview({ conteudo, idioma }: { conteudo: Record<string, unknown>; idioma?: IdiomaProposal }) {
  const c = conteudo as { inclusos?: string[]; nao_inclusos?: string[] };
  const inclusos = (c.inclusos || []).filter(Boolean);
  const naoInclusos = (c.nao_inclusos || []).filter(Boolean);
  const i18n = t(idioma);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {inclusos.length > 0 && (
        <div className="bg-emerald-50 rounded-2xl p-5 border border-emerald-100">
          <h4 className="font-bold text-emerald-800 mb-3 flex items-center gap-2 text-base">
            <CheckCircle2 className="w-5 h-5" /> {i18n.oQueEstaIncluso}
          </h4>
          <ul className="space-y-2">
            {inclusos.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-emerald-900">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {naoInclusos.length > 0 && (
        <div className="bg-red-50 rounded-2xl p-5 border border-red-100">
          <h4 className="font-bold text-red-800 mb-3 flex items-center gap-2 text-base">
            <XCircle className="w-5 h-5" /> {i18n.naoIncluso}
          </h4>
          <ul className="space-y-2">
            {naoInclusos.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-red-900">
                <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── VALORES ───
function ValoresPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const c = conteudo as { opcoes?: Array<{ titulo: string; valor_total: number; destaque: boolean; parcelas: Array<{ forma: string; valor_parcela: number; valor_total: number; destaque: boolean }> }>; observacoes_valores?: string };
  const opcoes = c.opcoes || [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {opcoes.map((opc, i) => (
          <div key={i} className={`rounded-2xl p-6 border-2 shadow-sm transition-transform ${
            opc.destaque
              ? 'border-emerald-500 bg-emerald-50 scale-[1.02]'
              : 'border-gray-200 bg-white'
          }`}>
            {opc.destaque && (
              <span className="inline-block bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full mb-3">
                Recomendado
              </span>
            )}
            <h4 className="font-bold text-lg">{opc.titulo}</h4>
            <div className="text-3xl font-black text-emerald-600 mt-2">{BRL(opc.valor_total)}</div>
            {opc.parcelas && opc.parcelas.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-gray-200 pt-3">
                {opc.parcelas.map((p, pi) => (
                  <div key={pi} className={`text-sm flex justify-between ${p.destaque ? 'font-semibold text-emerald-700' : 'opacity-60'}`}>
                    <span>{p.forma}</span>
                    <span>{BRL(p.valor_parcela)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {c.observacoes_valores && (
        <p className="text-xs opacity-50 text-center">{c.observacoes_valores}</p>
      )}
    </div>
  );
}

// ─── DEPOIMENTO ───
function DepoimentoPreview({ conteudo, idioma }: { conteudo: Record<string, unknown>; idioma?: IdiomaProposal }) {
  const deps = (conteudo as { depoimentos?: Array<{ texto: string; autor: string; foto?: string; foto_url?: string; destino?: string }> }).depoimentos || [];
  const i18n = t(idioma);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {deps.map((d, i) => (
        <div key={i} className="bg-gray-50 rounded-2xl p-5 border border-gray-100 shadow-sm">
          <p className="italic text-[15px] leading-relaxed text-gray-700">&ldquo;{d.texto}&rdquo;</p>
          <div className="flex items-center gap-3 mt-4">
            {(d.foto_url || d.foto) && <img src={d.foto_url || d.foto} alt={d.autor} className="w-10 h-10 rounded-full object-cover ring-2 ring-white shadow" />}
            <div>
              <div className="text-sm font-bold">{d.autor}</div>
              {d.destino && <div className="text-xs opacity-50">{i18n.viajouPara} {d.destino}</div>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── CTA ───
function CtaPreview({ conteudo, corPrimaria, idioma }: { conteudo: Record<string, unknown>; corPrimaria: string; idioma?: IdiomaProposal }) {
  const c = conteudo as { texto_botao?: string; tipo_acao?: string; numero_whatsapp?: string; mensagem_predefinida?: string; cor_botao?: string; imagem_fundo?: string };
  const cor = c.cor_botao || corPrimaria || '#004aad';

  const handleClick = () => {
    if (c.tipo_acao === 'WHATSAPP' && c.numero_whatsapp) {
      const msg = c.mensagem_predefinida ? encodeURIComponent(c.mensagem_predefinida) : '';
      window.open(`https://wa.me/55${c.numero_whatsapp.replace(/\D/g, '')}${msg ? `?text=${msg}` : ''}`, '_blank');
    }
  };

  return (
    <div
      className="text-center py-12 rounded-2xl relative overflow-hidden"
      style={c.imagem_fundo ? { backgroundImage: `url(${c.imagem_fundo})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
    >
      {c.imagem_fundo && <div className="absolute inset-0 bg-black/40" />}
      <div className="relative z-10">
        <button
          onClick={handleClick}
          style={{ backgroundColor: cor }}
          className="inline-flex items-center gap-2 px-10 py-4 text-white font-bold rounded-full text-lg shadow-xl hover:shadow-2xl hover:scale-105 transition-all"
        >
          {c.tipo_acao === 'WHATSAPP' && <MessageCircle className="w-5 h-5" />}
          {c.texto_botao || t(idioma).entrarEmContato}
        </button>
      </div>
    </div>
  );
}

// ─── VIDEO ───
function VideoPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const c = conteudo as { url?: string; titulo?: string };
  if (!c.url) return null;
  let embedUrl = '';
  const url = c.url;
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (ytMatch) embedUrl = `https://www.youtube-nocookie.com/embed/${ytMatch[1]}`;
  else if (vimeoMatch) embedUrl = `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  else embedUrl = url;

  return (
    <div className="space-y-2">
      {c.titulo && <h3 className="text-xl font-bold">{c.titulo}</h3>}
      <div className="relative w-full rounded-2xl overflow-hidden shadow-sm" style={{ paddingBottom: '56.25%' }}>
        <iframe src={embedUrl} className="absolute inset-0 w-full h-full" allowFullScreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" />
      </div>
    </div>
  );
}

// ─── MAPA ───
function MapaPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const c = conteudo as { titulo?: string; pontos?: Array<{ lat: number; lng: number; label: string }> };
  const pontos = (c.pontos || []).filter(p => p.lat && p.lng);
  if (pontos.length === 0) return null;
  return (
    <div className="space-y-2">
      {c.titulo && <h3 className="text-xl font-bold">{c.titulo}</h3>}
      <div className="rounded-2xl overflow-hidden shadow-sm">
        <MapaRoteiro pontos={pontos.map((p, i) => ({ ...p, dia: i + 1 }))} height="400px" />
      </div>
    </div>
  );
}

// ─── FAQ ───
function FAQPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const c = conteudo as { titulo?: string; perguntas?: Array<{ pergunta: string; resposta: string }> };
  const perguntas = (c.perguntas || []).filter(p => p.pergunta);
  if (perguntas.length === 0) return null;
  return (
    <div className="space-y-3">
      {c.titulo && <h3 className="text-xl font-bold">{c.titulo}</h3>}
      <div className="space-y-2">
        {perguntas.map((faq, i) => (
          <details key={i} className="group rounded-xl border border-gray-200 overflow-hidden">
            <summary className="flex items-center justify-between px-5 py-3.5 cursor-pointer font-medium text-sm hover:bg-gray-50">
              {faq.pergunta}
              <span className="text-gray-400 group-open:rotate-180 transition-transform text-lg">&#9662;</span>
            </summary>
            <div className="px-5 pb-4 text-sm opacity-75 whitespace-pre-wrap leading-relaxed">{faq.resposta}</div>
          </details>
        ))}
      </div>
    </div>
  );
}

// ─── COUNTDOWN ───
function CountdownPreview({ conteudo, idioma }: { conteudo: Record<string, unknown>; idioma?: IdiomaProposal }) {
  const c = conteudo as { titulo?: string; data_evento?: string; mensagem?: string };
  const i18n = t(idioma);
  if (!c.data_evento) return null;
  const target = new Date(c.data_evento + 'T00:00:00').getTime();
  const diff = target - Date.now();
  if (diff <= 0) {
    return (
      <div className="text-center py-8">
        {c.titulo && <h3 className="text-xl font-bold mb-2">{c.titulo}</h3>}
        <p className="text-lg text-emerald-600 font-bold">{c.mensagem || i18n.grandiaDiaChegou}</p>
      </div>
    );
  }
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  return (
    <div className="text-center py-8">
      {c.titulo && <h3 className="text-xl font-bold mb-5">{c.titulo}</h3>}
      <div className="flex justify-center gap-4">
        {[{ v: days, l: i18n.dias }, { v: hours, l: i18n.horas }, { v: minutes, l: i18n.minutos }].map((item, i) => (
          <div key={i} className="flex flex-col items-center">
            <div className="w-20 h-20 rounded-2xl bg-emerald-600 flex items-center justify-center text-3xl font-black text-white shadow-lg">
              {item.v}
            </div>
            <span className="text-xs mt-2 font-medium opacity-50 uppercase tracking-wider">{item.l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ALOJAMENTO — Card visual rico ───
const REGIME_LABELS: Record<string, string> = {
  RO: 'Room Only', BB: 'Bed & Breakfast', HB: 'Half Board', FB: 'Full Board', AI: 'All Inclusive',
};

function safeImg(url?: string): string {
  if (!url) return '';
  // Local uploads + same-origin paths render directly
  if (url.startsWith('/')) return url;
  // Already proxied
  if (url.includes('/api/img-proxy')) return url;
  // External — go through proxy so referrer/CORS issues don't break it
  return `/api/img-proxy?url=${encodeURIComponent(url)}`;
}

function AlojamentoPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const a = conteudo as Partial<AlojamentoData>;

  const hasGallery = a.hotel_galeria && a.hotel_galeria.length > 0;
  const hasImage = !!a.hotel_imagem;
  const starCount = a.hotel_estrelas || 0;

  if (a.viagem_noturna) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl bg-indigo-50 border border-indigo-100">
        <span className="text-2xl">✈️</span>
        <div>
          <h4 className="font-bold">Viagem Noturna</h4>
          <p className="text-sm opacity-60">{a.destino_nome}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm border border-gray-100">
      {/* Image hero */}
      {hasImage && (
        <div className="relative h-52 w-full">
          <img src={safeImg(a.hotel_imagem)} alt={a.hotel_nome || ''} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute bottom-4 left-5 right-5">
            <div className="flex items-center gap-2">
              <h4 className="text-xl font-bold text-white drop-shadow-lg">{a.hotel_nome || 'Hotel'}</h4>
              {starCount > 0 && <span className="text-amber-400 text-sm drop-shadow">{'★'.repeat(starCount)}</span>}
            </div>
            {a.destino_nome && (
              <div className="flex items-center gap-1 mt-0.5 text-white/80 text-sm">
                <MapPin className="w-3 h-3" /> {a.destino_nome}
              </div>
            )}
          </div>
          {/* Rating badge */}
          {a.rating && (
            <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm rounded-lg px-2.5 py-1 shadow">
              <div className="flex items-center gap-1">
                <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                <span className="text-sm font-bold">{a.rating}</span>
                {a.reviews_count && <span className="text-[10px] text-gray-500">({a.reviews_count.toLocaleString('pt-BR')})</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Gallery strip */}
      {hasGallery && (
        <div className="flex gap-0.5 overflow-x-auto bg-gray-100">
          {a.hotel_galeria!.slice(0, 6).map((url, i) => (
            <img key={i} src={safeImg(url)} alt="" className="w-20 h-14 object-cover shrink-0" loading="lazy" referrerPolicy="no-referrer" />
          ))}
        </div>
      )}

      {/* Info */}
      <div className="p-5">
        {!hasImage && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">🏨</span>
            <h4 className="text-lg font-bold">{a.hotel_nome || 'Hotel'}</h4>
            {starCount > 0 && <span className="text-amber-500 text-sm">{'★'.repeat(starCount)}</span>}
          </div>
        )}

        {/* Stay info row */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {a.check_in && (
            <span><span className="opacity-50">Check-in:</span> <span className="font-medium">{new Date(a.check_in + 'T12:00:00').toLocaleDateString('pt-BR')}</span></span>
          )}
          {a.check_out && (
            <span><span className="opacity-50">Check-out:</span> <span className="font-medium">{new Date(a.check_out + 'T12:00:00').toLocaleDateString('pt-BR')}</span></span>
          )}
          {a.noites ? <span className="font-medium">{a.noites} noite{a.noites !== 1 ? 's' : ''}</span> : null}
          {a.regime && <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full text-xs font-medium">{REGIME_LABELS[a.regime] || a.regime}</span>}
        </div>

        {/* Price */}
        {a.preco_noite && (
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-xl font-bold text-emerald-600">R$ {a.preco_noite.toLocaleString('pt-BR')}</span>
            <span className="text-xs opacity-50">/noite</span>
            {a.preco_total && <span className="text-sm opacity-50 ml-2">Total: R$ {a.preco_total.toLocaleString('pt-BR')}</span>}
          </div>
        )}

        {/* Amenities */}
        {a.amenities && a.amenities.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {a.amenities.slice(0, 8).map((am, i) => (
              <span key={i} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{am}</span>
            ))}
          </div>
        )}

        {/* Description */}
        {a.hotel_descricao && (
          <p className="text-sm opacity-60 mt-3 line-clamp-3 whitespace-pre-wrap">{a.hotel_descricao}</p>
        )}
      </div>
    </div>
  );
}

// ─── TRANSPORTE — Boarding pass estilo cia aérea ───
const TRANSPORTE_ICONS: Record<string, string> = {
  VOO: '✈️', TRANSFER: '🚐', TREM: '🚆', ONIBUS: '🚌', CARRO: '🚗', BARCO: '⛴️',
};

function TransportePreview({ conteudo, corPrimaria }: { conteudo: Record<string, unknown>; corPrimaria: string }) {
  const tr = conteudo as Partial<TransporteData>;
  const isVoo = tr.tipo === 'VOO';

  if (!isVoo) {
    const icon = TRANSPORTE_ICONS[tr.tipo || 'TRANSFER'] || '🚐';
    return (
      <div className="flex items-center gap-4 p-5 rounded-2xl bg-gray-50 border border-gray-100 shadow-sm">
        <span className="text-3xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <h4 className="text-lg font-bold">{tr.origem || '?'} → {tr.destino || '?'}</h4>
          <div className="flex flex-wrap gap-3 mt-1 text-sm opacity-60">
            {tr.data && <span>{new Date(tr.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}</span>}
            {tr.horario_saida && tr.horario_chegada && <span>{tr.horario_saida} → {tr.horario_chegada}</span>}
            {tr.tempo_estimado && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {tr.tempo_estimado}</span>}
            {tr.distancia_km ? <span>{tr.distancia_km} km</span> : null}
          </div>
          {tr.detalhes && <p className="text-sm opacity-60 mt-1">{tr.detalhes}</p>}
        </div>
      </div>
    );
  }

  // VOO → cartão rico com expansão
  return <RichFlightCard voo={tr} corPrimaria={corPrimaria} />;
}

// ─── MAIN RENDERER ───
interface Props {
  secoes: SecaoProposta[];
  corPrimaria: string;
  idioma?: IdiomaProposal;
}

export function PreviewRenderer({ secoes, corPrimaria, idioma }: Props) {
  return (
    <div className="space-y-10">
      {secoes.filter(s => s.visivel).map(secao => (
        <div key={secao.id}>
          {secao.tipo === 'TEXTO' && <TextoPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'SERVICO' && <ServicoPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'ROTEIRO_DIA' && <RoteiroDiaPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'GALERIA' && <GaleriaPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'INCLUSOS' && <InclusosPreview conteudo={secao.conteudo} idioma={idioma} />}
          {secao.tipo === 'VALORES' && <ValoresPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'DEPOIMENTO' && <DepoimentoPreview conteudo={secao.conteudo} idioma={idioma} />}
          {secao.tipo === 'CTA' && <CtaPreview conteudo={secao.conteudo} corPrimaria={corPrimaria} idioma={idioma} />}
          {secao.tipo === 'VIDEO' && <VideoPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'MAPA' && <MapaPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'FAQ' && <FAQPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'COUNTDOWN' && <CountdownPreview conteudo={secao.conteudo} idioma={idioma} />}
          {secao.tipo === 'ALOJAMENTO' && <AlojamentoPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'TRANSPORTE' && <TransportePreview conteudo={secao.conteudo} corPrimaria={corPrimaria} />}
        </div>
      ))}
    </div>
  );
}

'use client';

import { SecaoProposta } from '@/lib/crm-types';
import { CheckCircle2, XCircle, MessageCircle, Star } from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function TextoPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const c = conteudo as { titulo?: string; corpo?: string };
  const isHTML = c.corpo?.includes('<');
  return (
    <div className="space-y-2">
      {c.titulo && <h3 className="text-xl font-semibold">{c.titulo}</h3>}
      {c.corpo && (
        isHTML
          ? <div className="prose prose-sm max-w-none leading-relaxed opacity-80 [&_a]:text-emerald-500 [&_a]:underline [&_mark]:bg-yellow-200/50 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:opacity-70" dangerouslySetInnerHTML={{ __html: c.corpo }} />
          : <p className="whitespace-pre-wrap leading-relaxed opacity-80">{c.corpo}</p>
      )}
    </div>
  );
}

function ServicoPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const c = conteudo as { icone?: string; titulo?: string; descricao?: string; detalhes?: string[]; imagem?: string; valor?: number; exibir_valor?: boolean };
  return (
    <div className="flex gap-4">
      {c.imagem && (
        <img src={c.imagem} alt={c.titulo || ''} className="w-32 h-24 rounded-lg object-cover shrink-0" />
      )}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          {c.icone && <span className="text-2xl">{c.icone}</span>}
          <h4 className="text-lg font-semibold">{c.titulo}</h4>
        </div>
        {c.descricao && <p className="mt-1 opacity-80 text-sm whitespace-pre-wrap">{c.descricao}</p>}
        {c.detalhes && c.detalhes.length > 0 && (
          <ul className="mt-2 space-y-1">
            {c.detalhes.map((d, i) => (
              <li key={i} className="flex items-start gap-1.5 text-sm">
                <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-500" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        )}
        {c.exibir_valor && c.valor && c.valor > 0 && (
          <div className="mt-2 text-lg font-bold text-emerald-600">{BRL(c.valor)}</div>
        )}
      </div>
    </div>
  );
}

function RoteiroDiaPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const dias = (conteudo as { dias?: Array<{ numero: number; titulo: string; descricao: string; imagem?: string; atividades?: string[] }> }).dias || [];
  return (
    <div className="space-y-4">
      {dias.map((dia, i) => (
        <div key={i} className="flex gap-4">
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm shrink-0">
              {dia.numero}
            </div>
            {i < dias.length - 1 && <div className="w-0.5 flex-1 bg-emerald-200 mt-1" />}
          </div>
          <div className="flex-1 pb-4">
            <h4 className="font-semibold">{dia.titulo}</h4>
            {dia.descricao && <p className="mt-1 text-sm opacity-80 whitespace-pre-wrap">{dia.descricao}</p>}
            {dia.imagem && <img src={dia.imagem} alt={dia.titulo} className="mt-2 rounded-lg max-h-48 object-cover" />}
            {dia.atividades && dia.atividades.length > 0 && (
              <ul className="mt-2 space-y-1">
                {dia.atividades.map((a, j) => (
                  <li key={j} className="flex items-start gap-1.5 text-sm">
                    <Star className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" />
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

function GaleriaPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const imgs = (conteudo as { imagens?: Array<{ url: string; legenda?: string }> }).imagens || [];
  if (imgs.length === 0) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {imgs.map((img, i) => (
        <div key={i} className="relative group">
          <img src={img.url} alt={img.legenda || ''} className="w-full h-48 object-cover rounded-lg" />
          {img.legenda && (
            <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs px-2 py-1 rounded-b-lg">
              {img.legenda}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function InclusosPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const c = conteudo as { inclusos?: string[]; nao_inclusos?: string[] };
  const inclusos = (c.inclusos || []).filter(Boolean);
  const naoInclusos = (c.nao_inclusos || []).filter(Boolean);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {inclusos.length > 0 && (
        <div>
          <h4 className="font-semibold text-emerald-700 mb-2 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> O que esta incluso
          </h4>
          <ul className="space-y-1.5">
            {inclusos.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {naoInclusos.length > 0 && (
        <div>
          <h4 className="font-semibold text-red-600 mb-2 flex items-center gap-1.5">
            <XCircle className="w-4 h-4" /> Nao incluso
          </h4>
          <ul className="space-y-1.5">
            {naoInclusos.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ValoresPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const c = conteudo as { opcoes?: Array<{ titulo: string; valor_total: number; destaque: boolean; parcelas: Array<{ forma: string; valor_parcela: number; valor_total: number; destaque: boolean }> }>; observacoes_valores?: string };
  const opcoes = c.opcoes || [];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {opcoes.map((opc, i) => (
          <div key={i} className={`rounded-xl p-4 border-2 ${opc.destaque ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
            <h4 className="font-semibold text-lg">{opc.titulo}</h4>
            <div className="text-2xl font-bold text-emerald-600 mt-1">{BRL(opc.valor_total)}</div>
            {opc.parcelas && opc.parcelas.length > 0 && (
              <div className="mt-2 space-y-1">
                {opc.parcelas.map((p, pi) => (
                  <div key={pi} className={`text-sm ${p.destaque ? 'font-semibold text-emerald-700' : 'opacity-70'}`}>
                    {p.forma}: {BRL(p.valor_parcela)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {c.observacoes_valores && (
        <p className="text-xs opacity-60 mt-2">{c.observacoes_valores}</p>
      )}
    </div>
  );
}

function DepoimentoPreview({ conteudo }: { conteudo: Record<string, unknown> }) {
  const deps = (conteudo as { depoimentos?: Array<{ texto: string; autor: string; foto?: string; destino?: string }> }).depoimentos || [];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {deps.map((d, i) => (
        <div key={i} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
          <p className="italic text-sm leading-relaxed">&ldquo;{d.texto}&rdquo;</p>
          <div className="flex items-center gap-2 mt-3">
            {d.foto && <img src={d.foto} alt={d.autor} className="w-8 h-8 rounded-full object-cover" />}
            <div>
              <div className="text-sm font-semibold">{d.autor}</div>
              {d.destino && <div className="text-xs opacity-60">Viajou para {d.destino}</div>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CtaPreview({ conteudo, corPrimaria }: { conteudo: Record<string, unknown>; corPrimaria: string }) {
  const c = conteudo as { texto_botao?: string; tipo_acao?: string; numero_whatsapp?: string; mensagem_predefinida?: string; cor_botao?: string };
  const cor = c.cor_botao || corPrimaria || '#10b981';

  const handleClick = () => {
    if (c.tipo_acao === 'WHATSAPP' && c.numero_whatsapp) {
      const msg = c.mensagem_predefinida ? encodeURIComponent(c.mensagem_predefinida) : '';
      window.open(`https://wa.me/55${c.numero_whatsapp.replace(/\D/g, '')}${msg ? `?text=${msg}` : ''}`, '_blank');
    }
  };

  return (
    <div className="text-center py-4">
      <button
        onClick={handleClick}
        style={{ backgroundColor: cor }}
        className="inline-flex items-center gap-2 px-8 py-3 text-white font-semibold rounded-full text-lg shadow-lg hover:opacity-90 transition-opacity"
      >
        {c.tipo_acao === 'WHATSAPP' && <MessageCircle className="w-5 h-5" />}
        {c.texto_botao || 'Entrar em contato'}
      </button>
    </div>
  );
}

interface Props {
  secoes: SecaoProposta[];
  corPrimaria: string;
}

export function PreviewRenderer({ secoes, corPrimaria }: Props) {
  return (
    <div className="space-y-8">
      {secoes.filter(s => s.visivel).map(secao => (
        <div key={secao.id}>
          {secao.tipo === 'TEXTO' && <TextoPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'SERVICO' && <ServicoPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'ROTEIRO_DIA' && <RoteiroDiaPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'GALERIA' && <GaleriaPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'INCLUSOS' && <InclusosPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'VALORES' && <ValoresPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'DEPOIMENTO' && <DepoimentoPreview conteudo={secao.conteudo} />}
          {secao.tipo === 'CTA' && <CtaPreview conteudo={secao.conteudo} corPrimaria={corPrimaria} />}
        </div>
      ))}
    </div>
  );
}

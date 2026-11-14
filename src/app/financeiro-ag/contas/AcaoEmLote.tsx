'use client';

import * as React from 'react';

import type { LinhaDeConta } from '@/lib/contas-pagar-receber';
import type { AcaoDeLote, ResultadoDoLote } from '@/lib/contas-em-lote';
import { addDias, hojeISO } from '@/lib/money';
import { toast } from '@/lib/toast';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Input } from '@/components/ui/input';
import { Segmentado } from '@/components/fin/Segmentado';
import { CAMPO, SELECT, ListaDaPrevia, Rotulo } from './pecas';

/**
 * Reagendar vencimento, Recategorizar e Excluir em lote (05/11/2026). A
 * prévia vem do servidor conta por conta (o que muda e o que fica de fora,
 * com o motivo); confirmar grava só as contas prontas, numa transação, com a
 * assinatura da prévia. Depois de gravar, a janela mostra o que foi feito.
 */

export type Categoria = { id: string; codigo?: string; nome: string; tipo?: string; ativo?: boolean };
export type Centro = { id: string; nome: string; ativo?: boolean };

const TITULO: Record<AcaoDeLote, string> = {
  reagendar: 'Reagendar vencimento',
  recategorizar: 'Mudar categoria ou centro de custo',
  excluir: 'Excluir contas',
};

const DESCRICAO: Record<AcaoDeLote, string> = {
  reagendar: 'Muda o vencimento das contas em aberto que ainda não tiveram pagamento nem recebimento.',
  recategorizar: 'Troca a categoria, o centro de custo ou os dois nas contas escolhidas.',
  excluir: 'Tira as contas do financeiro. O que já foi pago ou recebido volta para a conta bancária.',
};

const VERBO: Record<AcaoDeLote, [string, string]> = {
  reagendar: ['Reagendar', 'reagendada'],
  recategorizar: ['Aplicar', 'alterada'],
  excluir: ['Excluir', 'excluída'],
};

const NAO_MUDAR = '__nao_mudar__';

export function AcaoEmLote({
  acao, linhas, categorias, centros, onFechar, onConcluido,
}: {
  acao: AcaoDeLote | null;
  linhas: LinhaDeConta[];
  categorias: Categoria[];
  centros: Centro[];
  onFechar: () => void;
  onConcluido: () => void;
}) {
  const aberto = acao !== null;
  const [modoData, setModoData] = React.useState<'data' | 'dias'>('data');
  const [novaData, setNovaData] = React.useState(addDias(hojeISO(), 7));
  const [dias, setDias] = React.useState('7');
  const [categoria, setCategoria] = React.useState(NAO_MUDAR);
  const [centro, setCentro] = React.useState(NAO_MUDAR);
  const [previa, setPrevia] = React.useState<ResultadoDoLote | null>(null);
  const [feito, setFeito] = React.useState<ResultadoDoLote | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [calculando, setCalculando] = React.useState(false);
  const [gravando, setGravando] = React.useState(false);

  React.useEffect(() => {
    if (!aberto) return;
    setModoData('data'); setNovaData(addDias(hojeISO(), 7)); setDias('7');
    setCategoria(NAO_MUDAR); setCentro(NAO_MUDAR);
    setPrevia(null); setFeito(null); setErro(null);
  }, [aberto, acao]);

  const parametros = React.useMemo((): Record<string, unknown> | null => {
    if (acao === 'reagendar') {
      if (modoData === 'data') return /^\d{4}-\d{2}-\d{2}$/.test(novaData) ? { nova_data: novaData } : null;
      const n = Number(dias);
      return Number.isInteger(n) && n !== 0 ? { dias: n } : null;
    }
    if (acao === 'recategorizar') {
      const p: Record<string, unknown> = {};
      if (categoria !== NAO_MUDAR) p.categoria_id = categoria;
      if (centro !== NAO_MUDAR) p.centro_custo_id = centro;
      return Object.keys(p).length ? p : null;
    }
    return acao === 'excluir' ? {} : null;
  }, [acao, modoData, novaData, dias, categoria, centro]);

  const itens = React.useMemo(() => linhas.map(l => ({ tabela: l.tabela, id: l.id })), [linhas]);

  React.useEffect(() => {
    if (!aberto || feito) return;
    if (!parametros) { setPrevia(null); return; }
    let vivo = true;
    const t = setTimeout(async () => {
      setCalculando(true);
      setErro(null);
      try {
        const r = await fetch('/api/contas-pagar-receber/lote', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modo: 'previa', acao, itens, ...parametros }),
        });
        const corpo = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) { setPrevia(null); setErro(typeof corpo?.error === 'string' ? corpo.error : `Erro ${r.status}`); return; }
        setPrevia(corpo as ResultadoDoLote);
      } catch {
        if (vivo) setErro('Sem resposta do servidor.');
      } finally {
        if (vivo) setCalculando(false);
      }
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [aberto, acao, itens, parametros, feito]);

  async function gravar() {
    if (!acao || !previa || previa.prontos === 0 || gravando) return;
    setGravando(true);
    setErro(null);
    try {
      const prontos = previa.itens.filter(i => i.ok).map(i => ({ tabela: i.tabela, id: i.id }));
      const r = await fetch('/api/contas-pagar-receber/lote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modo: 'gravar', acao, itens: prontos, assinatura: previa.assinatura, ...parametros }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(typeof corpo?.error === 'string' ? corpo.error : `Erro ${r.status}`);
        // Algo mudou: refaz a prévia com o estado atual.
        if (r.status === 409 || r.status === 423) setPrevia(null);
        return;
      }
      const resultado = corpo as ResultadoDoLote;
      setFeito(resultado);
      const n = resultado.prontos;
      toast.success(`${n} ${n === 1 ? 'conta' : 'contas'} ${VERBO[acao][1]}${n === 1 ? '' : 's'}`);
      onConcluido();
    } catch {
      setErro('Sem resposta do servidor. Nada foi alterado; tente de novo.');
    } finally {
      setGravando(false);
    }
  }

  // Categorias do tipo das contas escolhidas (despesa para pagar, receita para receber).
  const temPagar = linhas.some(l => l.tipo === 'pagar');
  const temReceber = linhas.some(l => l.tipo === 'receber');
  const categoriasDoTipo = categorias
    .filter(c => c.ativo !== false)
    .filter(c => !c.tipo || (temPagar && c.tipo === 'DESPESA') || (temReceber && c.tipo === 'RECEITA'))
    .sort((a, b) => String(a.codigo ?? '').localeCompare(String(b.codigo ?? ''), undefined, { numeric: true }) || a.nome.localeCompare(b.nome));

  const base = feito ?? previa;
  const prontos = base?.itens.filter(i => i.ok) ?? [];
  const fora = feito ? [] : base?.itens.filter(i => !i.ok) ?? [];
  const nome = (i: { tabela: string; id: string; pessoa: string; descricao: string }) => {
    const l = linhas.find(x => x.tabela === i.tabela && x.id === i.id);
    return { titulo: i.pessoa || l?.pessoa || 'Sem nome', detalhe: i.descricao || l?.descricao || '' };
  };

  if (!acao) return null;

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={TITULO[acao]}
      descricao={DESCRICAO[acao]}
      largura={640}
      resumo={feito
        ? `Pronto: ${feito.prontos} ${feito.prontos === 1 ? 'conta' : 'contas'} ${VERBO[acao][1]}${feito.prontos === 1 ? '' : 's'}.`
        : previa ? `${previa.prontos} de ${previa.itens.length} ${previa.itens.length === 1 ? 'conta' : 'contas'} ${previa.prontos === 1 ? 'muda' : 'mudam'}.` : null}
      acaoPrimaria={feito
        ? { rotulo: 'Fechar', onClick: onFechar }
        : {
          rotulo: previa && previa.prontos > 0 ? `${VERBO[acao][0]} ${previa.prontos === 1 ? '1 conta' : `${previa.prontos} contas`}` : VERBO[acao][0],
          onClick: gravar,
          carregando: gravando,
          desabilitado: calculando || !previa || previa.prontos === 0,
        }}
      acaoSecundaria={feito ? null : { rotulo: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        {!feito && acao === 'reagendar' ? (
          <div className="flex flex-col gap-[var(--fin-s-3)]">
            <Segmentado
              rotulo="Como mudar o vencimento"
              valor={modoData}
              onChange={v => setModoData(v as 'data' | 'dias')}
              opcoes={[{ valor: 'data', rotulo: 'Nova data' }, { valor: 'dias', rotulo: 'Mover dias' }]}
            />
            {modoData === 'data' ? (
              <Rotulo texto="Novo vencimento" ajuda="Todas as contas escolhidas passam a vencer neste dia.">
                <Input type="date" value={novaData} onChange={e => setNovaData(e.target.value)} className={`${CAMPO} sm:w-48`} />
              </Rotulo>
            ) : (
              <Rotulo texto="Quantos dias" ajuda="Cada conta anda a partir do próprio vencimento. Número negativo adianta.">
                <Input type="number" inputMode="numeric" step={1} value={dias} onChange={e => setDias(e.target.value)} className={`${CAMPO} sm:w-32`} />
              </Rotulo>
            )}
          </div>
        ) : null}

        {!feito && acao === 'recategorizar' ? (
          <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
            <Rotulo texto="Categoria" ajuda={temPagar && temReceber ? 'Categoria de despesa vale só para as contas a pagar, e a de receita só para as a receber.' : undefined}>
              <select value={categoria} onChange={e => setCategoria(e.target.value)} className={SELECT}>
                <option value={NAO_MUDAR}>Não mudar</option>
                {categoriasDoTipo.map(c => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} · ` : ''}{c.nome}</option>)}
              </select>
            </Rotulo>
            <Rotulo texto="Centro de custo">
              <select value={centro} onChange={e => setCentro(e.target.value)} className={SELECT}>
                <option value={NAO_MUDAR}>Não mudar</option>
                <option value="">Sem centro de custo</option>
                {centros.filter(c => c.ativo !== false).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </Rotulo>
          </div>
        ) : null}

        {erro ? <p role="alert" className="rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] p-[var(--fin-s-3)] fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : null}

        {parametros || feito ? (
          <ListaDaPrevia
            carregando={calculando && !previa}
            concluido={Boolean(feito)}
            titulo={feito ? 'Feito' : acao === 'excluir' ? 'Vão ser excluídas' : 'Vão mudar'}
            itens={prontos.map(i => ({
              chave: `${i.tabela}:${i.id}`, ...nome(i), ok: true, valor: i.valor,
              nota: acao === 'excluir' ? undefined : i.antes && i.depois ? `${i.antes} → ${i.depois}` : undefined,
              aviso: i.aviso,
            }))}
            fora={fora.map(i => ({ chave: `${i.tabela}:${i.id}`, ...nome(i), motivo: i.motivo ?? '' }))}
          />
        ) : (
          <p className="fin-t-body text-[var(--fin-text-3)]">Escolha o que mudar para ver a prévia, conta por conta.</p>
        )}
      </div>
    </RecordSheet>
  );
}

'use client';

/**
 * A gaveta de conferência de UMA linha do extrato.
 *
 * Pedido do Bruno (05/10/2026): "Ao tocar em conferir, tenho que conseguir
 * conciliar agregando a uma venda que aconteceu ou criando uma nova, ou
 * agregando a uma conta paga já lançada, ou criando uma nova." E: "Se o
 * extrato é do banco, tudo é consolidado." A linha do banco é fato; aqui
 * se decide a que lançamento ele pertence, e o lançamento passa a refletir
 * o fato (baixado com a data e o valor do banco).
 *
 * Abre do lado da linha tocada, onde a pessoa está olhando. Antes, Conferir
 * só trocava o cartão do alto da página, fora da tela de quem rolou até a
 * linha, e parecia que nada acontecia.
 */

import * as React from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, ExternalLink, Plus, Search } from 'lucide-react';

import type { Cliente, ContaBancaria, ContaPagar, ContaReceber, ExtratoLinha, PlanoContas, VendaCRM } from '@/lib/crm-types';
import { cn, formatBRL, formatDate } from '@/lib/utils';
import { round2 } from '@/lib/money';
import { nomeDoCliente } from '@/lib/cliente-nome';
import {
  categoriaPeloHistorico,
  contraparteDaDescricao,
  descreverPlanoDaConciliacao,
  emAberto,
  jaBaixado,
  normalizarNome,
  ordenarCandidatas,
  planoDaConciliacao,
  preSelecao,
  type ContaConciliavel,
} from '@/lib/conciliacao-plano';
import { toast } from '@/lib/toast';

import { Input } from '@/components/ui/input';
import { Field } from '@/components/fin/Field';
import { Money } from '@/components/fin/Money';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { EtiquetaDaPlataforma } from '@/components/fin/EtiquetaDaPlataforma';
import { descricaoSemPlataforma, nomeDaPlataforma, plataformaDaConta } from '@/lib/plataformas/rotulo';

export interface GavetaDeConciliacaoProps {
  linha: ExtratoLinha | null;
  posicao: { atual: number; total: number } | null;
  contasBancarias: ContaBancaria[];
  contasReceber: ContaReceber[];
  contasPagar: ContaPagar[];
  vendas: VendaCRM[];
  clientes: Cliente[];
  planoContas: PlanoContas[];
  /** Contas que outra linha conciliada já usa. */
  idsJaConciliados: Set<string>;
  /** Venda recém-criada pelo formulário, para já vir escolhida. */
  vendaInicial?: string | null;
  onFechar: () => void;
  onConciliada: (mensagem: string) => Promise<void> | void;
  onPular: () => void;
  onMarcar: (status: 'IGNORADO' | 'DIVERGENTE') => Promise<void>;
  onCriarVenda: (linha: ExtratoLinha, contraparte: string) => void;
}

interface Grupo {
  chave: string;
  tipo: 'venda' | 'conta';
  vendaId: string | null;
  clienteId: string | null;
  titulo: string;
  sub: string;
  contas: ContaConciliavel[];
  /** Detalhe de cada conta, para a lista de parcelas. */
  detalhe: Record<string, { rotulo: string; data: string }>;
  /** Integração de onde veio o recebimento (conta solta de plataforma). */
  plataforma: string | null;
  valor: number;
  data: string;
  nomes: string[];
}

const FOCO = 'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2';

function conciliavelCR(c: ContaReceber): ContaConciliavel {
  return { id: c.id, tipo: 'CONTA_RECEBER', status: c.status, valor_final: round2(c.valor_final), valor_baixado: c.valor_recebido, data_vencimento: c.data_vencimento, conta_bancaria_id: c.conta_bancaria_id };
}
function conciliavelCP(c: ContaPagar): ContaConciliavel {
  return { id: c.id, tipo: 'CONTA_PAGAR', status: c.status, valor_final: round2(c.valor_final), valor_baixado: c.valor_pago, data_vencimento: c.data_vencimento, conta_bancaria_id: c.conta_bancaria_id };
}
const QUITADA = new Set(['RECEBIDO', 'PAGO']);

/**
 * Conta única escolhida fica marcada mesmo quando o plano vai recusar: assim
 * a frase do rodapé diz o motivo (valor maior, sobra) em vez de pedir uma
 * escolha que a pessoa acabou de fazer.
 */
function marcarAoEscolher(g: Grupo, valorExtrato: number): string[] {
  const ids = preSelecao(g.contas, valorExtrato);
  if (ids.length === 0 && g.contas.length === 1) return [g.contas[0].id];
  return ids;
}

/** O valor que representa a conta na comparação: o aberto, ou o baixado se já quitada. */
function valorDeReferencia(contas: ContaConciliavel[], alvo: number): number {
  const abertas = contas.filter(c => emAberto(c) > 0);
  const igual = contas.find(c => Math.abs((emAberto(c) || jaBaixado(c)) - alvo) <= 0.01);
  if (igual) return emAberto(igual) || jaBaixado(igual);
  if (abertas.length > 0) return round2(abertas.reduce((s, c) => s + emAberto(c), 0));
  return round2(contas.reduce((s, c) => s + jaBaixado(c), 0));
}

function rotuloDaConta(c: ContaConciliavel, receber: boolean, extra: string): string {
  if (QUITADA.has(c.status)) return `${extra}${receber ? 'Recebida' : 'Paga'}, ainda sem prova do banco`;
  if (c.status === 'PARCIAL') return `${extra}${formatBRL(emAberto(c))} em aberto de ${formatBRL(c.valor_final)}`;
  return `${extra}Vence em ${formatDate(c.data_vencimento)}`;
}

export function GavetaDeConciliacao(p: GavetaDeConciliacaoProps) {
  const { linha } = p;
  const receber = (linha?.valor ?? 0) >= 0;
  const valor = round2(Math.abs(linha?.valor ?? 0));
  const contraparte = React.useMemo(() => contraparteDaDescricao(linha?.descricao ?? ''), [linha?.descricao]);

  const [modo, setModo] = React.useState<'existente' | 'nova'>('existente');
  const [novaReceita, setNovaReceita] = React.useState<'venda' | 'outra'>('venda');
  const [busca, setBusca] = React.useState('');
  const [selecionado, setSelecionado] = React.useState<string | null>(null);
  const [marcadas, setMarcadas] = React.useState<Set<string>>(new Set());
  const [nome, setNome] = React.useState('');
  const [descricao, setDescricao] = React.useState('');
  const [categoria, setCategoria] = React.useState('');
  const [enviando, setEnviando] = React.useState(false);
  const [tentou, setTentou] = React.useState(false);

  const clientePorId = React.useMemo(() => new Map(p.clientes.map(c => [c.id, c])), [p.clientes]);

  const grupos = React.useMemo<Grupo[]>(() => {
    if (!linha) return [];
    const usada = (id: string) => p.idsJaConciliados.has(id);
    if (receber) {
      const elegivel = (c: ContaReceber) => c.status !== 'CANCELADO' && !usada(c.id) && (emAberto(conciliavelCR(c)) > 0 || QUITADA.has(c.status));
      const porVenda = new Map<string, ContaReceber[]>();
      const soltas: ContaReceber[] = [];
      const vendaIds = new Set(p.vendas.map(v => v.id));
      for (const c of p.contasReceber) {
        if (!elegivel(c)) continue;
        const v = c.venda_id || c.origem_venda_id || '';
        if (v && vendaIds.has(v)) {
          if (!porVenda.has(v)) porVenda.set(v, []);
          porVenda.get(v)!.push(c);
        } else soltas.push(c);
      }
      const lista: Grupo[] = [];
      for (const v of p.vendas) {
        if (v.status === 'CANCELADO' || v.status === 'ORCAMENTO') continue;
        const crs = (porVenda.get(v.id) ?? []).sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento));
        const temAlgumaConta = p.contasReceber.some(c => (c.venda_id || c.origem_venda_id) === v.id && c.status !== 'CANCELADO');
        // Venda com todas as contas já conciliadas não é candidata; venda sem
        // conta nenhuma é (o recebimento pode ser lançado nela).
        if (crs.length === 0 && temAlgumaConta) continue;
        const cliente = clientePorId.get(v.cliente_id);
        const nomeCliente = cliente ? nomeDoCliente(cliente) : 'Cliente sem cadastro';
        const contas = crs.map(conciliavelCR);
        const detalhe: Grupo['detalhe'] = {};
        for (const c of crs) {
          const parcela = c.total_parcelas > 1 ? `Parcela ${c.parcela_numero} de ${c.total_parcelas}. ` : '';
          const via = plataformaDaConta(c) ? `Via ${nomeDaPlataforma(plataformaDaConta(c)!)}. ` : '';
          detalhe[c.id] = { rotulo: rotuloDaConta(conciliavelCR(c), true, `${via}${parcela}`), data: c.data_vencimento };
        }
        lista.push({
          chave: `venda:${v.id}`, tipo: 'venda', vendaId: v.id, clienteId: v.cliente_id || null,
          titulo: nomeCliente, sub: `Venda ${v.numero}, de ${formatDate(v.data_venda)}`,
          contas, detalhe, plataforma: null,
          valor: contas.length > 0 ? valorDeReferencia(contas, valor) : round2(v.valor_final || v.valor_total_venda || 0),
          data: v.data_venda, nomes: [nomeCliente, v.numero],
        });
      }
      for (const c of soltas) {
        const k = conciliavelCR(c);
        const plataforma = plataformaDaConta(c);
        const desc = descricaoSemPlataforma(c.descricao || '', plataforma);
        lista.push({
          chave: `cr:${c.id}`, tipo: 'conta', vendaId: null, clienteId: c.cliente_id || null,
          titulo: c.cliente_nome || desc || 'Conta a receber', sub: desc || 'Conta a receber',
          contas: [k], detalhe: { [c.id]: { rotulo: rotuloDaConta(k, true, ''), data: c.data_vencimento } }, plataforma,
          valor: emAberto(k) || jaBaixado(k), data: c.data_recebimento || c.data_vencimento, nomes: [c.cliente_nome, c.descricao],
        });
      }
      return lista;
    }
    return p.contasPagar
      .filter(c => c.status !== 'CANCELADO' && !usada(c.id) && (emAberto(conciliavelCP(c)) > 0 || QUITADA.has(c.status)))
      .map(c => {
        const k = conciliavelCP(c);
        return {
          chave: `cp:${c.id}`, tipo: 'conta' as const, vendaId: null, clienteId: null,
          titulo: c.fornecedor_nome || 'Sem fornecedor', sub: c.descricao || 'Conta a pagar',
          contas: [k], detalhe: { [c.id]: { rotulo: rotuloDaConta(k, false, ''), data: c.data_vencimento } }, plataforma: null,
          valor: emAberto(k) || jaBaixado(k), data: c.data_pagamento || c.data_vencimento, nomes: [c.fornecedor_nome, c.descricao],
        };
      });
  }, [linha, receber, valor, p.contasReceber, p.contasPagar, p.vendas, p.idsJaConciliados, clientePorId]);

  const ordenados = React.useMemo(
    () => (linha ? ordenarCandidatas(grupos, linha.valor, linha.data, contraparte) : []),
    [grupos, linha, contraparte],
  );

  const termo = normalizarNome(busca);
  const digitos = busca.replace(/\D/g, '');
  const visiveis = React.useMemo(() => {
    if (!termo && !digitos) return ordenados.slice(0, 8);
    return ordenados
      .filter(g => {
        const texto = normalizarNome(`${g.titulo} ${g.sub} ${g.nomes.join(' ')}`);
        const porTexto = termo && texto.includes(termo);
        const porValor = digitos.length >= 2 && Math.round(g.valor * 100).toString().includes(digitos);
        return porTexto || porValor;
      })
      .slice(0, 30);
  }, [ordenados, termo, digitos]);

  const categorias = React.useMemo(
    () => p.planoContas
      .filter(c => c.ativo !== false && c.tipo === (receber ? 'RECEITA' : 'DESPESA'))
      .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'pt-BR', { numeric: true })),
    [p.planoContas, receber],
  );
  const nomesConhecidos = React.useMemo(
    () => [...new Set((receber ? p.contasReceber.map(c => c.cliente_nome) : p.contasPagar.map(c => c.fornecedor_nome)).filter(Boolean))].sort().slice(0, 300),
    [receber, p.contasReceber, p.contasPagar],
  );

  // Linha nova na gaveta: tudo volta ao começo, já com o palpite certo.
  React.useEffect(() => {
    if (!linha) return;
    setBusca('');
    setTentou(false);
    setNome(contraparte);
    setDescricao(linha.descricao);
    setCategoria(receber ? '' : categoriaPeloHistorico(contraparte, p.contasPagar));
    setNovaReceita('venda');
    // Pré-escolhe só com prova forte: o mesmo valor, ou o nome da contraparte
    // numa conta com saldo em aberto que cobre o valor do banco. Palpite
    // fraco pré-escolhido trava o botão sem a pessoa saber por quê.
    const alvo = normalizarNome(contraparte);
    const forte = (g: Grupo) =>
      Math.abs(g.valor - valor) <= 0.01
      || (!!alvo && normalizarNome(g.nomes.join(' ')).includes(alvo)
          && round2(g.contas.reduce((s, c) => s + emAberto(c), 0)) >= valor - 0.01);
    const inicial = p.vendaInicial ? ordenados.find(g => g.vendaId === p.vendaInicial) : null;
    const provavel = inicial ?? ordenados.find(forte) ?? null;
    if (provavel) {
      setModo('existente');
      setSelecionado(provavel.chave);
      setMarcadas(new Set(marcarAoEscolher(provavel, linha.valor)));
    } else {
      setModo(ordenados.length > 0 && receber ? 'existente' : 'nova');
      setSelecionado(null);
      setMarcadas(new Set());
    }
    // Só quando a LINHA muda; recalcular a cada recarga apagaria a escolha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linha?.id, p.vendaInicial]);

  const grupo = selecionado ? grupos.find(g => g.chave === selecionado) ?? null : null;
  const contasMarcadas = grupo ? grupo.contas.filter(c => marcadas.has(c.id)) : [];
  const plano = linha ? planoDaConciliacao(contasMarcadas, linha.valor, linha.conta_bancaria_id) : null;
  const vendaSemConta = !!grupo && grupo.tipo === 'venda' && grupo.contas.length === 0;
  const contaDoBanco = p.contasBancarias.find(c => c.id === linha?.conta_bancaria_id);
  const pagaEmOutroBanco = contasMarcadas.some(c => QUITADA.has(c.status) && c.conta_bancaria_id && c.conta_bancaria_id !== linha?.conta_bancaria_id);

  function escolher(g: Grupo) {
    if (!linha) return;
    setSelecionado(g.chave);
    setMarcadas(new Set(marcarAoEscolher(g, linha.valor)));
  }

  function alternar(id: string) {
    setMarcadas(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function enviar(corpo: Record<string, unknown>, mensagem: string) {
    if (!linha || enviando) return;
    setEnviando(true);
    try {
      const r = await fetch('/api/conciliacao/conciliar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extrato_id: linha.id, ...corpo }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || 'Não foi possível conciliar.');
      await p.onConciliada(mensagem);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível conciliar.');
    } finally {
      setEnviando(false);
    }
  }

  // ── A ação principal muda com o que está escolhido ──────────────────────
  let acao: { rotulo: string; onClick: () => void | Promise<void>; desabilitado?: boolean };
  let resumo: React.ReactNode = null;
  if (!linha) {
    acao = { rotulo: 'Conciliar', onClick: () => {}, desabilitado: true };
  } else if (modo === 'existente') {
    if (vendaSemConta && grupo) {
      acao = {
        rotulo: 'Lançar o recebimento nesta venda',
        onClick: () => enviar({ acao: 'criar', nome: grupo.titulo, descricao: `Recebimento da ${grupo.sub.split(',')[0]}`, venda_id: grupo.vendaId, cliente_id: grupo.clienteId }, `Recebimento de ${formatBRL(valor)} lançado na venda e conciliado.`),
      };
      resumo = `A venda não tem conta a receber. Este recebimento de ${formatBRL(valor)} vira uma conta já recebida em ${formatDate(linha.data)}, ligada a ela.`;
    } else {
      acao = {
        rotulo: 'Conciliar',
        desabilitado: !plano?.ok,
        onClick: () => enviar(
          { acao: 'vincular', contas: contasMarcadas.map(c => ({ tipo: c.tipo, id: c.id })) },
          plano ? `Conciliada: ${descreverPlanoDaConciliacao(plano, formatBRL, receber).replace(/\.$/, '')}.` : 'Conciliada.',
        ),
      };
      resumo = grupo && plano ? (
        <span className="flex flex-col gap-[var(--fin-s-1)]">
          <span className={plano.ok ? 'text-[var(--fin-text-2)]' : 'text-[var(--fin-warning-text)]'}>
            {descreverPlanoDaConciliacao(plano, formatBRL, receber)}
          </span>
          {plano.ok && <span>Com a data do banco ({formatDate(linha.data)}){contaDoBanco ? `, em ${contaDoBanco.nome}` : ''}.</span>}
          {pagaEmOutroBanco && <span className="text-[var(--fin-warning-text)]">No sistema esta conta foi baixada em outra conta bancária. O vínculo não muda isso.</span>}
        </span>
      ) : null;
    }
  } else if (!receber) {
    acao = {
      rotulo: 'Criar conta paga e conciliar',
      onClick: () => {
        setTentou(true);
        if (!nome.trim()) return;
        return enviar({ acao: 'criar', nome: nome.trim(), descricao: descricao.trim(), categoria_id: categoria || undefined }, `Conta a pagar criada e conciliada: ${nome.trim()}, ${formatBRL(valor)}.`);
      },
    };
    resumo = `Nasce uma conta a pagar já paga: ${formatBRL(valor)} em ${formatDate(linha.data)}${contaDoBanco ? `, saindo de ${contaDoBanco.nome}` : ''}.`;
  } else if (novaReceita === 'venda') {
    acao = { rotulo: 'Abrir o formulário de venda', onClick: () => p.onCriarVenda(linha, contraparte) };
    resumo = 'O formulário abre com a data deste recebimento. Ao salvar a venda, você volta para cá com ela escolhida para conciliar.';
  } else {
    acao = {
      rotulo: 'Criar recebimento e conciliar',
      onClick: () => {
        setTentou(true);
        if (!nome.trim()) return;
        return enviar({ acao: 'criar', nome: nome.trim(), descricao: descricao.trim(), categoria_id: categoria || undefined }, `Recebimento criado e conciliado: ${nome.trim()}, ${formatBRL(valor)}.`);
      },
    };
    resumo = `Nasce uma conta a receber já recebida: ${formatBRL(valor)} em ${formatDate(linha.data)}${contaDoBanco ? `, em ${contaDoBanco.nome}` : ''}. Não entra como venda.`;
  }

  const abas = receber
    ? [{ id: 'existente', rotulo: 'Venda que já existe' }, { id: 'nova', rotulo: 'Lançar novo' }]
    : [{ id: 'existente', rotulo: 'Conta já lançada' }, { id: 'nova', rotulo: 'Nova conta a pagar' }];

  return (
    <RecordSheet
      aberto={linha !== null}
      onOpenChange={aberto => { if (!aberto) p.onFechar(); }}
      titulo={receber ? 'Conferir entrada do banco' : 'Conferir saída do banco'}
      descricao={p.posicao ? `${p.posicao.atual.toLocaleString('pt-BR')} de ${p.posicao.total.toLocaleString('pt-BR')} a conferir nesta conta` : 'Linha escolhida na lista'}
      largura={640}
      resumo={resumo}
      acaoPrimaria={{ rotulo: acao.rotulo, onClick: acao.onClick, carregando: enviando, desabilitado: acao.desabilitado }}
      acaoSecundaria={{ rotulo: 'Deixar para depois', onClick: p.onPular }}
    >
      {linha && (
        <div className="flex flex-col gap-[var(--fin-s-5)]">
          {/* O fato: o que o banco diz */}
          <section className="flex items-start gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-4)]">
            <span
              aria-hidden="true"
              className={cn(
                'grid size-10 shrink-0 place-items-center rounded-[var(--fin-r-md)]',
                receber ? 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]' : 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]',
              )}
            >
              {receber ? <ArrowDownLeft className="size-5" /> : <ArrowUpRight className="size-5" />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-[var(--fin-s-1)]">
              <p className="fin-t-body-strong break-words text-[var(--fin-text)]">{linha.descricao}</p>
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                {formatDate(linha.data)}, {receber ? 'entrou em' : 'saiu de'} {contaDoBanco?.nome ?? 'conta do extrato'}
                {contraparte ? `. ${receber ? 'De' : 'Para'}: ${contraparte}` : ''}
              </p>
            </div>
            <Money valor={linha.valor} size="metricSm" estado="ok" sinal="sempre" tone={receber ? 'positivo' : 'neutro'} className="min-w-0 shrink-0" />
          </section>

          {/* Já existe ou é novo */}
          <div role="tablist" aria-label="Como conciliar" className="grid grid-cols-2 gap-1 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] p-1">
            {abas.map(a => (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={modo === a.id}
                onClick={() => setModo(a.id as 'existente' | 'nova')}
                className={cn(
                  'fin-t-body h-9 rounded-[calc(var(--fin-r-md)-2px)] px-3 transition-colors',
                  FOCO,
                  modo === a.id ? 'bg-[var(--fin-surface)] font-medium text-[var(--fin-text)] shadow-[var(--fin-e1)]' : 'text-[var(--fin-text-2)] hover:text-[var(--fin-text)]',
                )}
              >
                {a.rotulo}
              </button>
            ))}
          </div>

          {modo === 'existente' ? (
            <div className="flex flex-col gap-[var(--fin-s-3)]">
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--fin-text-3)]" />
                <Input
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder={receber ? 'Cliente, nº da venda ou valor' : 'Fornecedor, descrição ou valor'}
                  aria-label={receber ? 'Buscar venda' : 'Buscar conta a pagar'}
                  className="h-11 pl-9 lg:h-10"
                />
              </div>
              <p className="fin-t-overline text-[var(--fin-text-3)]">
                {termo || digitos
                  ? `${visiveis.length === 30 ? 'Primeiros 30' : visiveis.length} ${visiveis.length === 1 ? 'resultado' : 'resultados'}`
                  : grupos.length === 0
                    ? receber ? 'Nenhuma venda com recebimento a conferir' : 'Nenhuma conta a pagar a conferir'
                    : 'Mais prováveis primeiro'}
              </p>

              {visiveis.length === 0 ? (
                <div className="flex flex-col items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-dashed border-[var(--fin-border-strong)] p-[var(--fin-s-4)]">
                  <p className="fin-t-body text-[var(--fin-text-2)]">
                    {termo || digitos
                      ? 'Nada encontrado com essa busca.'
                      : receber
                        ? 'Não há venda com conta a receber em aberto nem recebida sem prova do banco.'
                        : 'Não há conta a pagar em aberto nem paga sem prova do banco.'}
                  </p>
                  <button type="button" onClick={() => setModo('nova')} className={cn('fin-t-body-strong inline-flex items-center gap-1 text-[var(--fin-accent)] hover:underline', FOCO)}>
                    <Plus aria-hidden="true" className="size-4" />
                    {receber ? 'Lançar como novo' : 'Criar a conta a pagar'}
                  </button>
                </div>
              ) : (
                <ul role="radiogroup" aria-label={receber ? 'Vendas' : 'Contas a pagar'} className="flex flex-col gap-[var(--fin-s-2)]">
                  {visiveis.map(g => {
                    const ativo = g.chave === selecionado;
                    const igual = Math.abs(g.valor - valor) <= 0.01;
                    const quitada = g.contas.length > 0 && g.contas.every(c => QUITADA.has(c.status));
                    return (
                      <li key={g.chave} className={cn('rounded-[var(--fin-r-md)] border transition-colors', ativo ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border)] bg-[var(--fin-surface)] hover:border-[var(--fin-border-strong)]')}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={ativo}
                          onClick={() => escolher(g)}
                          className={cn('flex w-full items-center gap-[var(--fin-s-3)] p-[var(--fin-s-3)] text-left', FOCO, 'rounded-[var(--fin-r-md)]')}
                        >
                          <span aria-hidden="true" className={cn('grid size-4 shrink-0 place-items-center rounded-full border', ativo ? 'border-[var(--fin-accent)] bg-[var(--fin-accent)]' : 'border-[var(--fin-border-strong)]')}>
                            {ativo && <span className="size-1.5 rounded-full bg-[var(--fin-text-on-fill)]" />}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="fin-t-body-strong truncate text-[var(--fin-text)]">{g.titulo}</span>
                            <span className="flex min-w-0 items-center gap-[var(--fin-s-2)]">
                              {g.plataforma && <EtiquetaDaPlataforma plataforma={g.plataforma} />}
                              <span className="fin-t-caption min-w-0 truncate text-[var(--fin-text-3)]">{g.sub}</span>
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-0.5">
                            <Money valor={g.valor} size="strong" estado="ok" className="min-w-0" />
                            <span className={cn('fin-t-caption', igual ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-text-3)]')}>
                              {igual ? 'Mesmo valor' : quitada ? (receber ? 'Já recebida' : 'Já paga') : g.contas.length === 0 ? 'Sem conta a receber' : 'Em aberto'}
                            </span>
                          </span>
                        </button>

                        {ativo && (g.contas.length > 1 || g.tipo === 'venda') && (
                          <div className="flex flex-col gap-[var(--fin-s-2)] border-t border-[var(--fin-accent)]/20 px-[var(--fin-s-3)] pt-[var(--fin-s-2)] pb-[var(--fin-s-3)]">
                            {g.contas.length === 0 ? (
                              <p className="fin-t-caption text-[var(--fin-text-2)]">
                                Esta venda ainda não tem conta a receber. Dá para lançar este recebimento nela.
                              </p>
                            ) : (
                              <>
                                <p className="fin-t-caption text-[var(--fin-text-2)]">Marque o que este valor quita:</p>
                                <ul className="flex flex-col gap-1">
                                  {g.contas.map(c => {
                                    const marcada = marcadas.has(c.id);
                                    return (
                                      <li key={c.id}>
                                        <label className="flex cursor-pointer items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-sm)] px-1 py-1 hover:bg-[var(--fin-surface)]">
                                          <input type="checkbox" checked={marcada} onChange={() => alternar(c.id)} className="size-4 accent-[var(--fin-accent)]" />
                                          <span className="fin-t-caption min-w-0 flex-1 text-[var(--fin-text)]">{g.detalhe[c.id]?.rotulo}</span>
                                          <Money valor={emAberto(c) || jaBaixado(c)} size="caption" estado="ok" className="min-w-0" />
                                        </label>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </>
                            )}
                            {g.vendaId && (
                              <a href={`/vendas/${g.vendaId}`} target="_blank" rel="noreferrer" className={cn('fin-t-caption inline-flex w-fit items-center gap-1 text-[var(--fin-accent)] hover:underline', FOCO)}>
                                Abrir a venda <ExternalLink aria-hidden="true" className="size-3" />
                              </a>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-[var(--fin-s-4)]">
              {receber && (
                <div role="radiogroup" aria-label="O que é este recebimento" className="grid gap-[var(--fin-s-2)] sm:grid-cols-2">
                  {([
                    { id: 'venda', titulo: 'É uma venda nova', texto: 'Abre o formulário de venda com a data deste recebimento.' },
                    { id: 'outra', titulo: 'Não é venda', texto: 'Rendimento, reembolso, aporte ou devolução.' },
                  ] as const).map(o => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={novaReceita === o.id}
                      onClick={() => setNovaReceita(o.id)}
                      className={cn(
                        'flex flex-col gap-1 rounded-[var(--fin-r-md)] border p-[var(--fin-s-3)] text-left transition-colors',
                        FOCO,
                        novaReceita === o.id ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border)] hover:border-[var(--fin-border-strong)]',
                      )}
                    >
                      <span className="fin-t-body-strong inline-flex items-center gap-1 text-[var(--fin-text)]">
                        {novaReceita === o.id && <Check aria-hidden="true" className="size-4 text-[var(--fin-accent)]" />}
                        {o.titulo}
                      </span>
                      <span className="fin-t-caption text-[var(--fin-text-2)]">{o.texto}</span>
                    </button>
                  ))}
                </div>
              )}

              {(!receber || novaReceita === 'outra') && (
                <div className="flex flex-col gap-[var(--fin-s-4)]">
                  <Field rotulo={receber ? 'De quem veio' : 'Para quem foi'} obrigatorio erro={tentou && !nome.trim() ? (receber ? 'Informe de quem veio o dinheiro.' : 'Informe para quem foi o pagamento.') : null} ajuda={contraparte ? 'Lido da descrição do banco. Ajuste se precisar.' : undefined}>
                    {a => (
                      <>
                        <Input {...a} value={nome} onChange={e => setNome(e.target.value)} list={`${a.id}-nomes`} autoComplete="off" className="h-11 lg:h-10" />
                        <datalist id={`${a.id}-nomes`}>
                          {nomesConhecidos.map(n => <option key={n} value={n} />)}
                        </datalist>
                      </>
                    )}
                  </Field>
                  <Field rotulo="Descrição">
                    {a => <Input {...a} value={descricao} onChange={e => setDescricao(e.target.value)} className="h-11 lg:h-10" />}
                  </Field>
                  <Field rotulo="Categoria" ajuda={!receber && categoria && categoria === categoriaPeloHistorico(contraparte, p.contasPagar) ? 'A mesma das outras contas deste fornecedor.' : undefined}>
                    {a => (
                      <select
                        {...a}
                        value={categoria}
                        onChange={e => setCategoria(e.target.value)}
                        className={cn('fin-t-body h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] lg:h-10', FOCO)}
                      >
                        <option value="">Sem categoria</option>
                        {categorias.map(c => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} ${c.nome}` : c.nome}</option>)}
                      </select>
                    )}
                  </Field>
                  <dl className="grid grid-cols-2 gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-3)]">
                    <div className="flex flex-col gap-0.5">
                      <dt className="fin-t-overline text-[var(--fin-text-3)]">Valor</dt>
                      <dd><Money valor={valor} size="strong" estado="ok" align="esquerda" className="min-w-0" /></dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="fin-t-overline text-[var(--fin-text-3)]">{receber ? 'Recebido em' : 'Pago em'}</dt>
                      <dd className="fin-t-body-strong text-[var(--fin-text)]">{formatDate(linha.data)}</dd>
                    </div>
                    <p className="fin-t-caption col-span-2 text-[var(--fin-text-3)]">Valor e data vêm do banco e não mudam: o extrato é o fato.</p>
                  </dl>
                </div>
              )}
            </div>
          )}

          {/* Saídas que não são conciliação */}
          <div className="flex flex-wrap items-center gap-x-[var(--fin-s-4)] gap-y-1 border-t border-[var(--fin-border)] pt-[var(--fin-s-3)]">
            <span className="fin-t-caption text-[var(--fin-text-3)]">Não é lançamento?</span>
            <button type="button" disabled={enviando} onClick={() => void p.onMarcar('IGNORADO')} className={cn('fin-t-caption text-[var(--fin-text-2)] underline-offset-2 hover:text-[var(--fin-text)] hover:underline', FOCO)}>
              Ignorar (tarifa, transferência entre contas suas)
            </button>
            <button type="button" disabled={enviando} onClick={() => void p.onMarcar('DIVERGENTE')} className={cn('fin-t-caption text-[var(--fin-text-2)] underline-offset-2 hover:text-[var(--fin-text)] hover:underline', FOCO)}>
              Marcar como divergente
            </button>
          </div>
        </div>
      )}
    </RecordSheet>
  );
}

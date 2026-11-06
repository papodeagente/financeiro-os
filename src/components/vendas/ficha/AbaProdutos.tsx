'use client';

/**
 * Aba Produtos da ficha da venda (E5): a lista dos produtos com o que o
 * cliente paga, o que vai ao fornecedor e a receita, e a janela de edição
 * com passageiros e componentes de receita (Comissão, Over, Taxa DU, RAV,
 * Fee, Markup, Desconto...).
 */
import * as React from 'react';
import { Briefcase, Copy, Plus, RotateCcw, Trash2, UserPlus, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Segmentado } from '@/components/fin/Segmentado';
import { Field } from '@/components/fin/Field';
import { CampoCambio } from '@/components/fin/CampoCambio';
import { descreverCarimbo } from '@/lib/cambio';
import {
  BASES_DO_PERCENTUAL, CAMPOS_DO_TIPO, COMPONENTES, COMPONENTES_COM_BASE, ROTULO_BASE_DO_PERCENTUAL, ROTULO_QUEM_COBRA, ROTULO_TIPO_PASSAGEIRO, ROTULO_TIPO_PRODUTO,
  TIPOS_COMPONENTE_DA_TELA, TIPOS_PRODUTO,
  basePercentualDoComponente, diariasEntre, normalizarProduto, novoIdDaVenda, totaisDoProduto,
  type BaseDoPercentual, type ComponenteDeReceita, type ParteDaVenda, type Passageiro, type ProdutoDaVenda, type TipoComponente, type TipoPassageiro, type TipoProduto,
} from '@/lib/venda-modelo';
import { cn } from '@/lib/utils';
import { CampoReais, CONTROLE, dataBR, naMoeda, Pilula, reais, ROTULO, SELECT } from './comum';

export const MOEDAS = ['BRL', 'USD', 'EUR', 'GBP', 'ARS', 'CLP', 'UYU', 'MXN', 'CAD', 'CHF', 'JPY', 'AUD'] as const;

export interface PessoaDaLista { id: string; nome: string }

/** Componentes que o tipo sugere primeiro (atalhos da janela). */
function atalhosDoTipo(tipo: TipoProduto): TipoComponente[] {
  if (tipo === 'AEREO' || tipo === 'AEREO_AGENCIA') return ['COMISSAO', 'OVER', 'TAXA_DU', 'FEE', 'DESCONTO'];
  return ['COMISSAO', 'OVER', 'RAV', 'FEE', 'MARKUP', 'DESCONTO'];
}

export function produtoVazio(sequencia: number): ProdutoDaVenda {
  return normalizarProduto({ id: novoIdDaVenda('pd'), tipo: 'HOSPEDAGEM', quem_cobra: 'AGENCIA', moeda: 'BRL' }, sequencia);
}

/**
 * Cópia do produto (E7): mesmos valores, fornecedor e componentes, com ids
 * novos e sem o que é só do original (localizador, cancelamento, componentes
 * que o cancelamento gravou).
 */
export function copiaDoProduto(p: ProdutoDaVenda, sequencia: number): ProdutoDaVenda {
  const novosPax = new Map(p.passageiros.map(x => [x.id, novoIdDaVenda('px')]));
  return {
    ...p,
    id: novoIdDaVenda('pd'), sequencia, localizador: '', cancelado_em: null,
    descricao: p.descricao ? `${p.descricao} (cópia)`.slice(0, 300) : '',
    passageiros: p.passageiros.map(x => ({ ...x, id: novosPax.get(x.id)!, cancelado_em: null })),
    componentes: p.componentes.filter(c => !COMPONENTES[c.tipo].interno).map(c => ({
      ...c, id: novoIdDaVenda('cp'), passageiro_id: c.passageiro_id ? novosPax.get(c.passageiro_id) ?? null : null,
    })),
    detalhes: { ...p.detalhes },
  };
}

export function AbaProdutos({
  produtos, removidos = [], editavel, verReceita, fornecedores, onSalvarProduto, onRemoverProduto, onRestaurarProduto,
}: {
  produtos: ProdutoDaVenda[];
  /** Produtos tirados da venda, guardados para restaurar (E7). */
  removidos?: ProdutoDaVenda[];
  editavel: boolean;
  verReceita: boolean;
  fornecedores: PessoaDaLista[];
  onSalvarProduto: (p: ProdutoDaVenda) => void;
  onRemoverProduto: (id: string) => void;
  onRestaurarProduto?: (id: string) => void;
}) {
  const [aberto, setAberto] = React.useState<ProdutoDaVenda | null>(null);
  const [novo, setNovo] = React.useState(false);
  const [verRemovidos, setVerRemovidos] = React.useState(false);
  const [lista, setLista] = React.useState(false);
  const temPassageiro = produtos.some(p => p.passageiros.length > 0);

  const colunas: FinColuna<ProdutoDaVenda>[] = [
    {
      id: 'produto', cabecalho: 'Produto', tipo: 'texto', minWidth: 240,
      acessor: p => p.descricao,
      render: p => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate fin-t-body-strong text-[var(--fin-text)]">{p.descricao || ROTULO_TIPO_PRODUTO[p.tipo]}</span>
          <span className="truncate fin-t-caption text-[var(--fin-text-3)]">
            {ROTULO_TIPO_PRODUTO[p.tipo]}
            {p.localizador ? ` · ${p.localizador}` : ''}
            {p.cancelado_em ? ` · cancelado em ${dataBR(p.cancelado_em)}` : ''}
          </span>
        </div>
      ),
    },
    {
      id: 'fornecedor', cabecalho: 'Fornecedor', tipo: 'texto', minWidth: 180, prioridade: 2,
      acessor: p => p.fornecedor?.nome ?? '',
      render: p => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate fin-t-body text-[var(--fin-text)]">{p.fornecedor?.nome || <span className="text-[var(--fin-warning-text)]">Falta o fornecedor</span>}</span>
          {p.representante?.nome ? <span className="truncate fin-t-caption text-[var(--fin-text-3)]">via {p.representante.nome}</span> : null}
        </div>
      ),
    },
    {
      id: 'quem', cabecalho: 'Quem cobra', tipo: 'texto', minWidth: 120, prioridade: 1,
      render: p => <Pilula tom={p.quem_cobra === 'AGENCIA' ? 'acento' : 'violeta'}>{p.quem_cobra === 'AGENCIA' ? 'Agência' : 'Fornecedor'}</Pilula>,
    },
    {
      id: 'pax', cabecalho: 'Passageiros', tipo: 'texto', minWidth: 96, prioridade: 1,
      acessor: p => p.passageiros.length,
      render: p => <span className="tabular-nums fin-t-body text-[var(--fin-text-2)]">{p.passageiros.length ? totaisDoProduto(p).passageiros_ativos : '—'}</span>,
    },
    {
      id: 'cliente', cabecalho: 'Cliente paga', tipo: 'dinheiro', minWidth: 120,
      valor: p => totaisDoProduto(p).brl.valor_cliente / 100,
      sub: p => (p.moeda !== 'BRL' ? <span>{naMoeda(totaisDoProduto(p).valor_cliente, p.moeda)} a {p.cambio.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</span> : null),
    },
    { id: 'fornecedor_recebe', cabecalho: 'Fornecedor recebe', tipo: 'dinheiro', minWidth: 120, prioridade: 2, valor: p => totaisDoProduto(p).brl.valor_fornecedor / 100 },
    ...(verReceita ? [{ id: 'receita', cabecalho: 'Receita', tipo: 'dinheiro' as const, minWidth: 110, valor: (p: ProdutoDaVenda) => totaisDoProduto(p).brl.receita_bruta / 100, tone: (p: ProdutoDaVenda) => (totaisDoProduto(p).brl.receita_bruta < 0 ? 'negativo' as const : 'neutro' as const) }] : []),
    ...(editavel ? [{
      id: 'acoes', cabecalho: '', tipo: 'acoes' as const,
      render: (p: ProdutoDaVenda) => (
        <span className="flex justify-end">
          <Button type="button" variant="ghost" size="icon" aria-label={`Criar cópia de ${p.descricao || ROTULO_TIPO_PRODUTO[p.tipo]}`} title="Criar cópia"
            onClick={e => { e.stopPropagation(); setNovo(true); setAberto(copiaDoProduto(p, produtos.length + 1)); }}>
            <Copy aria-hidden="true" className="size-4 text-[var(--fin-text-3)]" />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remover ${p.descricao || ROTULO_TIPO_PRODUTO[p.tipo]}`} title="Remover (dá para restaurar)"
            onClick={e => { e.stopPropagation(); onRemoverProduto(p.id); }}>
            <Trash2 aria-hidden="true" className="size-4 text-[var(--fin-text-3)]" />
          </Button>
        </span>
      ),
    }] : []),
  ];

  return (
    <div className="flex flex-col gap-[var(--fin-s-3)]">
      {editavel || temPassageiro ? (
        <div className="flex flex-wrap justify-end gap-[var(--fin-s-2)]">
          {temPassageiro ? (
            <Button type="button" variant="outline" onClick={() => setLista(true)}>
              <Users aria-hidden="true" className="size-4" /> Lista de passageiros
            </Button>
          ) : null}
          {editavel ? (
            <Button type="button" onClick={() => { setNovo(true); setAberto(produtoVazio(produtos.length + 1)); }}>
              <Plus aria-hidden="true" className="size-4" /> Adicionar produto
            </Button>
          ) : null}
        </div>
      ) : null}
      <FinTable
        linhas={produtos}
        colunas={colunas}
        chave={p => p.id}
        estado="ok"
        densidade="compacta"
        onLinhaClick={p => { setNovo(false); setAberto(p); }}
        vazio={{
          motivo: 'sem-dado', titulo: 'Nenhum produto ainda',
          oQueE: 'Cada produto (aéreo, hospedagem, pacote...) diz quanto o cliente paga, quanto vai ao fornecedor e quanto fica para a agência.',
          comoComeca: editavel ? ['Adicione o produto e o fornecedor.', 'Inclua os passageiros com a tarifa e as taxas.', 'Marque os componentes de receita: comissão, Taxa DU, RAV, fee.'] : undefined,
          acao: editavel ? { rotulo: 'Adicionar produto', onClick: () => { setNovo(true); setAberto(produtoVazio(produtos.length + 1)); } } : undefined,
        }}
      />
      {removidos.length ? (
        <section aria-label="Produtos removidos" className="flex flex-col gap-[var(--fin-s-2)]">
          <button type="button" aria-expanded={verRemovidos} onClick={() => setVerRemovidos(v => !v)}
            className="self-start fin-t-caption text-[var(--fin-text-2)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]">
            {verRemovidos ? 'Esconder' : 'Mostrar'} {removidos.length === 1 ? 'o produto removido' : `os ${removidos.length} produtos removidos`}
          </button>
          {verRemovidos ? (
            <ul className="flex flex-col divide-y divide-[var(--fin-border)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)]">
              {removidos.map(p => (
                <li key={p.id} className="flex items-center justify-between gap-[var(--fin-s-3)] px-[var(--fin-s-3)] py-[var(--fin-s-2)]">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate fin-t-body text-[var(--fin-text-2)]">{p.descricao || ROTULO_TIPO_PRODUTO[p.tipo]}</span>
                    <span className="truncate fin-t-caption text-[var(--fin-text-3)]">{ROTULO_TIPO_PRODUTO[p.tipo]}{p.fornecedor?.nome ? ` · ${p.fornecedor.nome}` : ''} · {naMoeda(totaisDoProduto(p).valor_cliente, p.moeda)}</span>
                  </span>
                  {editavel && onRestaurarProduto ? (
                    <Button type="button" variant="outline" size="sm" className="h-11 shrink-0 lg:h-8" onClick={() => onRestaurarProduto(p.id)}>
                      <RotateCcw aria-hidden="true" className="size-3.5" /> Restaurar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="fin-t-caption text-[var(--fin-text-3)]">Produto removido não entra em conta nenhuma. Restaurado, volta como estava e as contas se refazem ao salvar.</p>
        </section>
      ) : null}
      {lista ? <ListaDePassageiros produtos={produtos} onFechar={() => setLista(false)} /> : null}
      {aberto ? (
        <EditorDeProduto
          key={aberto.id}
          inicial={aberto}
          novo={novo}
          editavel={editavel}
          verReceita={verReceita}
          fornecedores={fornecedores}
          onFechar={() => setAberto(null)}
          onSalvar={p => { onSalvarProduto(p); setAberto(null); }}
        />
      ) : null}
    </div>
  );
}

function SeletorDePessoa({ rotulo, valor, lista, onChange, desabilitado, ajuda, opcional }: {
  rotulo: string; valor: ParteDaVenda | null; lista: PessoaDaLista[]; onChange: (p: ParteDaVenda | null) => void; desabilitado?: boolean; ajuda?: string; opcional?: boolean;
}) {
  const conhecido = valor?.id && lista.some(x => x.id === valor.id);
  return (
    <Field rotulo={rotulo} ajuda={ajuda}>
      {a => (
        <select
          {...a} disabled={desabilitado} className={SELECT}
          value={valor ? (conhecido ? valor.id : '__atual') : ''}
          onChange={e => {
            const v = e.target.value;
            if (!v) return onChange(null);
            if (v === '__atual') return;
            const p = lista.find(x => x.id === v);
            onChange(p ? { id: p.id, nome: p.nome } : null);
          }}
        >
          <option value="">{opcional ? 'Nenhum' : 'Escolha…'}</option>
          {valor && !conhecido ? <option value="__atual">{valor.nome || 'Cadastro sem nome'}</option> : null}
          {lista.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </select>
      )}
    </Field>
  );
}

function EditorDeProduto({ inicial, novo, editavel, verReceita, fornecedores, onFechar, onSalvar }: {
  inicial: ProdutoDaVenda; novo: boolean; editavel: boolean; verReceita: boolean; fornecedores: PessoaDaLista[];
  onFechar: () => void; onSalvar: (p: ProdutoDaVenda) => void;
}) {
  const [p, setP] = React.useState<ProdutoDaVenda>(inicial);
  const [sujo, setSujo] = React.useState(false);
  const mudar = (parcial: Partial<ProdutoDaVenda>) => { setP(x => ({ ...x, ...parcial })); setSujo(true); };
  const t = totaisDoProduto(p);
  const estrangeira = p.moeda !== 'BRL';
  const prefixo = estrangeira ? p.moeda : 'R$';

  const mudarPax = (id: string, parcial: Partial<Passageiro>) => mudar({ passageiros: p.passageiros.map(x => (x.id === id ? { ...x, ...parcial } : x)) });
  // Viagem corporativa (E7): centro de custo e matrícula de cada viajante no cliente.
  // Aparece sozinha quando algum passageiro já tem; senão, a pessoa liga.
  const [verCorporativo, setVerCorporativo] = React.useState(() => inicial.passageiros.some(x => x.corporativo?.centro_custo || x.corporativo?.matricula));
  const mudarCorp = (x: Passageiro, campo: 'centro_custo' | 'matricula', valor: string) => mudarPax(x.id, { corporativo: { ...(x.corporativo ?? {}), [campo]: valor } });
  const mudarComp = (id: string, parcial: Partial<ComponenteDeReceita>) => mudar({ componentes: p.componentes.map(x => (x.id === id ? { ...x, ...parcial } : x)) });
  const novoComp = (tipo: TipoComponente) => mudar({ componentes: [...p.componentes, { id: novoIdDaVenda('cp'), tipo, valor_centavos: 0, percentual: null, passageiro_id: null, descricao: '' }] });
  // A mesma conta da gravação: tarifa, tarifa com taxas ou (Over) a comissão.
  const baseDoPct = (c: ComponenteDeReceita) => basePercentualDoComponente(p, c);
  const [carimbo, setCarimbo] = React.useState<Parameters<typeof descreverCarimbo>[0]>(null);

  return (
    <RecordSheet
      aberto
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={novo ? 'Novo produto' : (p.descricao || ROTULO_TIPO_PRODUTO[p.tipo])}
      descricao={editavel ? 'Valores na moeda do produto. As contas da venda se refazem sozinhas ao salvar a venda.' : 'Venda fechada: só leitura.'}
      largura={960}
      sujo={sujo}
      resumo={
        <span className="flex flex-wrap gap-x-[var(--fin-s-4)] gap-y-1 fin-t-caption text-[var(--fin-text-2)]">
          <span>Cliente paga <strong className="tabular-nums text-[var(--fin-text)]">{naMoeda(t.valor_cliente, p.moeda)}</strong></span>
          <span>Fornecedor recebe <strong className="tabular-nums text-[var(--fin-text)]">{naMoeda(t.valor_fornecedor, p.moeda)}</strong></span>
          {verReceita ? <span>Receita <strong className={cn('tabular-nums', t.receita_bruta < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-positive)]')}>{naMoeda(t.receita_bruta, p.moeda)}</strong></span> : null}
          {estrangeira ? <span>Em reais: {reais(t.brl.valor_cliente)}</span> : null}
        </span>
      }
      acaoPrimaria={editavel
        ? { rotulo: novo ? 'Incluir na venda' : 'Guardar o produto', onClick: () => onSalvar(normalizarProduto(p, p.sequencia)) }
        : { rotulo: 'Fechar', onClick: onFechar }}
      acaoSecundaria={editavel ? { rotulo: 'Cancelar', onClick: onFechar } : null}
    >
      <fieldset disabled={!editavel} className="flex min-w-0 flex-col gap-[var(--fin-s-5)]">
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
          <Field rotulo="Tipo">
            {a => (
              <select {...a} className={SELECT} value={p.tipo} onChange={e => mudar({ tipo: e.target.value as TipoProduto })}>
                {TIPOS_PRODUTO.map(x => <option key={x} value={x}>{ROTULO_TIPO_PRODUTO[x]}</option>)}
              </select>
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field rotulo="Descrição" ajuda="Como a equipe reconhece o produto: trecho, hotel, roteiro.">
              {a => <Input {...a} className={CONTROLE} value={p.descricao} maxLength={300} onChange={e => mudar({ descricao: e.target.value })} />}
            </Field>
          </div>
          <SeletorDePessoa rotulo="Fornecedor" valor={p.fornecedor} lista={fornecedores} onChange={v => mudar({ fornecedor: v })} />
          <SeletorDePessoa rotulo="Representante" opcional ajuda="Consolidadora ou operadora por onde comprou. Com representante, o acerto é com ele." valor={p.representante} lista={fornecedores} onChange={v => mudar({ representante: v })} />
          <Field rotulo="Localizador">
            {a => <Input {...a} className={CONTROLE} value={p.localizador} maxLength={80} onChange={e => mudar({ localizador: e.target.value })} />}
          </Field>
        </div>

        <div className="flex flex-col gap-[var(--fin-s-2)]">
          <span className={ROTULO}>Quem recebe do cliente</span>
          <Segmentado
            rotulo="Quem recebe do cliente"
            valor={p.quem_cobra}
            onChange={v => mudar({ quem_cobra: v })}
            opcoes={[{ valor: 'AGENCIA', rotulo: 'A agência' }, { valor: 'FORNECEDOR', rotulo: 'O fornecedor, direto' }]}
            cheio="celular"
          />
          <p className="fin-t-caption text-[var(--fin-text-3)]">
            {ROTULO_QUEM_COBRA[p.quem_cobra]}. {p.quem_cobra === 'AGENCIA'
              ? 'A agência recebe o total e paga ao fornecedor o líquido.'
              : 'O cliente paga o fornecedor; o fornecedor fica devendo a receita da agência (comissão a receber).'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-[var(--fin-s-3)] sm:grid-cols-5">
          <Field rotulo="Moeda">
            {a => (
              <select {...a} className={SELECT} value={p.moeda} onChange={e => mudar({ moeda: e.target.value, cambio: e.target.value === 'BRL' ? 1 : p.cambio })}>
                {MOEDAS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
          </Field>
          {estrangeira ? null : (
            <Field rotulo="Câmbio">
              {a => <Input {...a} className={cn(CONTROLE, 'text-right tabular-nums')} disabled value="1" />}
            </Field>
          )}
          <Field rotulo="Início">
            {a => <Input {...a} type="date" className={CONTROLE} value={p.data_inicio} onChange={e => mudar({ data_inicio: e.target.value })} />}
          </Field>
          <Field rotulo="Fim">
            {a => <Input {...a} type="date" className={CONTROLE} value={p.data_fim} onChange={e => mudar({ data_fim: e.target.value })} />}
          </Field>
          <Field rotulo="Pagar o fornecedor em" ajuda="Vazio: prazo do cadastro.">
            {a => <Input {...a} type="date" className={CONTROLE} value={p.data_pagamento_fornecedor} onChange={e => mudar({ data_pagamento_fornecedor: e.target.value })} />}
          </Field>
        </div>

        {estrangeira ? (
          <div className="max-w-xl">
            <CampoCambio
              moeda={p.moeda} valor={p.cambio} carimbo={carimbo} lado="venda"
              ajuda={`Quantos reais vale 1 ${p.moeda}. Sempre dá para digitar; a sugestão ao lado é a cotação do momento.`}
              onChange={(cambio, c) => { setCarimbo(c); mudar({ cambio, detalhes: { ...p.detalhes, cambio_origem: descreverCarimbo(c).slice(0, 300) } }); }}
            />
            {p.detalhes.cambio_origem && !carimbo ? <p className="mt-1 fin-t-caption text-[var(--fin-text-3)]">Câmbio gravado: {p.detalhes.cambio_origem}.</p> : null}
          </div>
        ) : null}

        {CAMPOS_DO_TIPO[p.tipo].length ? (
          <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
            {CAMPOS_DO_TIPO[p.tipo].map(c => {
              const pelasDatas = c.chave === 'diarias'
                ? diariasEntre(p.detalhes.checkin || p.detalhes.retirada_data || p.data_inicio, p.detalhes.checkout || p.detalhes.devolucao_data || p.data_fim)
                : 0;
              return (
                <Field key={c.chave} rotulo={c.rotulo} ajuda={c.chave === 'diarias' && pelasDatas ? `Pelas datas: ${pelasDatas}.` : c.ajuda}>
                  {a => (
                    <Input {...a}
                      type={c.formato === 'data' ? 'date' : c.formato === 'numero' ? 'number' : 'text'}
                      inputMode={c.formato === 'numero' ? 'numeric' : undefined} min={c.formato === 'numero' ? 0 : undefined}
                      placeholder={c.chave === 'diarias' && pelasDatas ? String(pelasDatas) : undefined}
                      className={cn(CONTROLE, c.formato === 'numero' && 'text-right tabular-nums')}
                      value={p.detalhes[c.chave] ?? ''} maxLength={300}
                      onChange={e => mudar({ detalhes: { ...p.detalhes, [c.chave]: e.target.value } })} />
                  )}
                </Field>
              );
            })}
          </div>
        ) : null}

        <section aria-labelledby="t-pax" className="flex flex-col gap-[var(--fin-s-2)]">
          <div className="flex items-center justify-between gap-[var(--fin-s-2)]">
            <h3 id="t-pax" className="fin-t-body-strong text-[var(--fin-text)]">Passageiros</h3>
            <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
            {p.passageiros.length > 0 ? (
              <Button type="button" variant="ghost" size="sm" className="h-11 lg:h-8" aria-pressed={verCorporativo}
                onClick={() => setVerCorporativo(v => !v)}>
                <Briefcase aria-hidden="true" className="size-4" /> {verCorporativo ? 'Esconder dados corporativos' : 'Dados corporativos'}
              </Button>
            ) : null}
            {editavel ? (
              <Button type="button" variant="outline" size="sm" className="h-11 lg:h-8"
                onClick={() => mudar({ passageiros: [...p.passageiros, { id: novoIdDaVenda('px'), nome: '', tipo: 'ADT', documento: '', tarifa_centavos: 0, taxas_centavos: 0, outras_taxas_centavos: 0, cancelado_em: null }] })}>
                <UserPlus aria-hidden="true" className="size-4" /> Passageiro
              </Button>
            ) : null}
            </div>
          </div>
          {p.passageiros.length === 0 ? (
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] p-[var(--fin-s-3)] sm:grid-cols-3">
              <p className="fin-t-caption text-[var(--fin-text-2)] sm:col-span-3">Produto sem passageiro (seguro em grupo, ingresso, serviço): quantidade, valor unitário e taxas.</p>
              <Field rotulo="Quantidade">
                {a => <Input {...a} type="number" min={1} step={1} className={cn(CONTROLE, 'text-right tabular-nums')} value={String(p.quantidade)} onChange={e => mudar({ quantidade: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />}
              </Field>
              <div className="flex flex-col gap-1">
                <span className={ROTULO}>Valor unitário (tarifa)</span>
                <CampoReais rotulo="Valor unitário" prefixo={prefixo} centavos={p.valor_unitario_centavos} onChange={v => mudar({ valor_unitario_centavos: v })} desabilitado={!editavel} />
              </div>
              <div className="flex flex-col gap-1">
                <span className={ROTULO}>Taxas</span>
                <CampoReais rotulo="Taxas" prefixo={prefixo} centavos={p.taxas_centavos} onChange={v => mudar({ taxas_centavos: v })} desabilitado={!editavel} />
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-[var(--fin-r-md)] border border-[var(--fin-border)]">
              <table className={cn('w-full border-collapse fin-t-body', verCorporativo ? 'min-w-[1080px]' : 'min-w-[760px]')}>
                <thead className="bg-[var(--fin-surface-2)]">
                  <tr className="text-left fin-t-overline text-[var(--fin-text-3)]">
                    <th className="px-3 py-2 font-medium">Nome</th>
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Documento</th>
                    <th className="px-3 py-2 text-right font-medium">Tarifa</th>
                    <th className="px-3 py-2 text-right font-medium">{p.tipo.startsWith('AEREO') ? 'Taxa de embarque' : 'Taxas'}</th>
                    <th className="px-3 py-2 text-right font-medium">Outras taxas</th>
                    {verCorporativo ? (
                      <>
                        <th className="px-3 py-2 font-medium">Centro de custo no cliente</th>
                        <th className="px-3 py-2 font-medium">Matrícula</th>
                      </>
                    ) : null}
                    <th className="px-3 py-2"><span className="sr-only">Remover</span></th>
                  </tr>
                </thead>
                <tbody>
                  {p.passageiros.map((x, i) => (
                    <tr key={x.id} className={cn('border-t border-[var(--fin-border)]', x.cancelado_em && 'opacity-60')}>
                      <td className="px-2 py-1.5">
                        <Input aria-label={`Nome do passageiro ${i + 1}`} className={CONTROLE} value={x.nome} onChange={e => mudarPax(x.id, { nome: e.target.value })} />
                        {x.cancelado_em ? <span className="mt-0.5 block fin-t-caption text-[var(--fin-negative-text)]">Cancelado em {dataBR(x.cancelado_em)}</span> : null}
                      </td>
                      <td className="px-2 py-1.5">
                        <select aria-label={`Tipo do passageiro ${i + 1}`} className={cn(SELECT, 'w-28')} value={x.tipo} onChange={e => mudarPax(x.id, { tipo: e.target.value as TipoPassageiro })}>
                          {(['ADT', 'CHD', 'INF'] as const).map(k => <option key={k} value={k}>{ROTULO_TIPO_PASSAGEIRO[k]}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5"><Input aria-label={`Documento do passageiro ${i + 1}`} className={CONTROLE} value={x.documento} onChange={e => mudarPax(x.id, { documento: e.target.value })} /></td>
                      <td className="px-2 py-1.5"><CampoReais rotulo={`Tarifa do passageiro ${i + 1}`} prefixo={prefixo} centavos={x.tarifa_centavos} onChange={v => mudarPax(x.id, { tarifa_centavos: v })} desabilitado={!editavel} /></td>
                      <td className="px-2 py-1.5"><CampoReais rotulo={`Taxas do passageiro ${i + 1}`} prefixo={prefixo} centavos={x.taxas_centavos} onChange={v => mudarPax(x.id, { taxas_centavos: v })} desabilitado={!editavel} /></td>
                      <td className="px-2 py-1.5"><CampoReais rotulo={`Outras taxas do passageiro ${i + 1}`} prefixo={prefixo} centavos={x.outras_taxas_centavos} onChange={v => mudarPax(x.id, { outras_taxas_centavos: v })} desabilitado={!editavel} /></td>
                      {verCorporativo ? (
                        <>
                          <td className="px-2 py-1.5"><Input aria-label={`Centro de custo no cliente do passageiro ${i + 1}`} className={CONTROLE} maxLength={120} value={x.corporativo?.centro_custo ?? ''} disabled={!editavel} onChange={e => mudarCorp(x, 'centro_custo', e.target.value)} /></td>
                          <td className="px-2 py-1.5"><Input aria-label={`Matrícula do passageiro ${i + 1}`} className={cn(CONTROLE, 'w-32')} maxLength={60} value={x.corporativo?.matricula ?? ''} disabled={!editavel} onChange={e => mudarCorp(x, 'matricula', e.target.value)} /></td>
                        </>
                      ) : null}
                      <td className="px-1 py-1.5 text-right">
                        {editavel ? (
                          <Button type="button" variant="ghost" size="icon" aria-label={`Remover ${x.nome || `passageiro ${i + 1}`}`}
                            onClick={() => mudar({ passageiros: p.passageiros.filter(y => y.id !== x.id), componentes: p.componentes.filter(c => c.passageiro_id !== x.id) })}>
                            <Trash2 aria-hidden="true" className="size-4 text-[var(--fin-text-3)]" />
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="t-comp" className="flex flex-col gap-[var(--fin-s-2)]">
          <div className="flex flex-col gap-1">
            <h3 id="t-comp" className="fin-t-body-strong text-[var(--fin-text)]">Componentes de receita</h3>
            <p className="fin-t-caption text-[var(--fin-text-3)]">Comissão e Over saem da tarifa (o fornecedor fica com menos). Taxa DU, RAV, Fee e Markup somam ao que o cliente paga; Desconto tira. O Abatimento do fornecedor baixa o que o cliente paga e o que o fornecedor recebe, sem mexer na receita. Percentual vale sobre a tarifa; no Over, escolha a base.</p>
          </div>
          {editavel ? (
            <div className="flex flex-wrap gap-[var(--fin-s-2)]">
              {atalhosDoTipo(p.tipo).map(tp => (
                <Button key={tp} type="button" variant="outline" size="sm" className="h-11 lg:h-8" onClick={() => novoComp(tp)}>
                  <Plus aria-hidden="true" className="size-3.5" /> {COMPONENTES[tp].rotulo}
                </Button>
              ))}
              <select aria-label="Outro componente" className={cn(SELECT, 'h-11 w-auto lg:h-8')} value="" onChange={e => { if (e.target.value) novoComp(e.target.value as TipoComponente); }}>
                <option value="">Outro…</option>
                {TIPOS_COMPONENTE_DA_TELA.filter(tp => !atalhosDoTipo(p.tipo).includes(tp)).map(tp => <option key={tp} value={tp}>{COMPONENTES[tp].rotulo}</option>)}
              </select>
            </div>
          ) : null}
          {p.componentes.length ? (
            <div className="overflow-x-auto rounded-[var(--fin-r-md)] border border-[var(--fin-border)]">
              <table className="w-full min-w-[820px] border-collapse fin-t-body">
                <thead className="bg-[var(--fin-surface-2)]">
                  <tr className="text-left fin-t-overline text-[var(--fin-text-3)]">
                    <th className="px-3 py-2 font-medium">Componente</th>
                    <th className="px-3 py-2 font-medium">De quem</th>
                    <th className="px-3 py-2 text-right font-medium">%</th>
                    <th className="px-3 py-2 font-medium">Sobre</th>
                    <th className="px-3 py-2 text-right font-medium">Valor</th>
                    <th className="px-3 py-2"><span className="sr-only">Remover</span></th>
                  </tr>
                </thead>
                <tbody>
                  {p.componentes.map(c => {
                    // Os do cancelamento (parte D) são do sistema: aparecem, não se editam.
                    const doSistema = Boolean(COMPONENTES[c.tipo].interno);
                    const mexe = editavel && !doSistema;
                    return (
                    <tr key={c.id} className="border-t border-[var(--fin-border)]">
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-2">
                          <span className={cn('fin-t-body-strong', COMPONENTES[c.tipo].sinal < 0 ? 'text-[var(--fin-negative-text)]' : COMPONENTES[c.tipo].sinal === 0 ? 'text-[var(--fin-text-2)]' : 'text-[var(--fin-text)]')}>{COMPONENTES[c.tipo].rotulo}</span>
                        </span>
                        <span className="block fin-t-caption text-[var(--fin-text-3)]">{doSistema && c.descricao ? c.descricao : COMPONENTES[c.tipo].ajuda}</span>
                      </td>
                      <td className="px-2 py-1.5">
                        <select aria-label={`${COMPONENTES[c.tipo].rotulo}: de quem`} disabled={!mexe} className={cn(SELECT, 'w-44')} value={c.passageiro_id ?? ''} onChange={e => mudarComp(c.id, { passageiro_id: e.target.value || null })}>
                          <option value="">Produto inteiro</option>
                          {p.passageiros.map((x, i) => <option key={x.id} value={x.id}>{x.nome || `Passageiro ${i + 1}`}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label={`${COMPONENTES[c.tipo].rotulo}: percentual`} disabled={!mexe} type="number" inputMode="decimal" min={0} step="0.01" className={cn(CONTROLE, 'w-24 text-right tabular-nums')}
                          value={c.percentual ?? ''}
                          onChange={e => {
                            const pct = e.target.value === '' ? null : Math.max(0, Number(e.target.value.replace(',', '.')) || 0);
                            mudarComp(c.id, { percentual: pct, valor_centavos: pct === null ? c.valor_centavos : Math.round(baseDoPct(c) * pct / 100) });
                          }} />
                      </td>
                      <td className="px-2 py-1.5">
                        {COMPONENTES_COM_BASE.has(c.tipo) ? (
                          <select aria-label={`${COMPONENTES[c.tipo].rotulo}: base do percentual`} disabled={!mexe} className={cn(SELECT, 'w-48')}
                            value={c.base ?? 'TARIFA'}
                            onChange={e => {
                              const base = e.target.value as BaseDoPercentual;
                              const comBase = { ...c, base: base === 'TARIFA' ? undefined : base };
                              mudarComp(c.id, { base: comBase.base, ...(c.percentual !== null ? { valor_centavos: Math.round(baseDoPct(comBase) * c.percentual / 100) } : {}) });
                            }}>
                            {BASES_DO_PERCENTUAL.map(b => <option key={b} value={b}>{ROTULO_BASE_DO_PERCENTUAL[b]}</option>)}
                          </select>
                        ) : <span className="px-1 fin-t-caption text-[var(--fin-text-3)]">{c.percentual !== null ? 'tarifa' : '—'}</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        <CampoReais rotulo={`${COMPONENTES[c.tipo].rotulo}: valor`} prefixo={prefixo} centavos={c.valor_centavos} onChange={v => mudarComp(c.id, { valor_centavos: v, percentual: null })} desabilitado={!mexe} />
                      </td>
                      <td className="px-1 py-1.5 text-right">
                        {mexe ? (
                          <Button type="button" variant="ghost" size="icon" aria-label={`Remover ${COMPONENTES[c.tipo].rotulo}`} onClick={() => mudar({ componentes: p.componentes.filter(y => y.id !== c.id) })}>
                            <Trash2 aria-hidden="true" className="size-4 text-[var(--fin-text-3)]" />
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-2)]">
              Sem componente, a agência não ganha nada neste produto: o cliente paga a tarifa e as taxas, que vão inteiras ao fornecedor.
            </p>
          )}
        </section>
      </fieldset>
    </RecordSheet>
  );
}

/**
 * Lista de passageiros da venda (E7): todos os produtos numa tabela só, para
 * conferir nomes e documentos, copiar ou baixar.
 */
function ListaDePassageiros({ produtos, onFechar }: { produtos: ProdutoDaVenda[]; onFechar: () => void }) {
  const linhas = produtos.flatMap(p => p.passageiros.map(x => ({
    id: `${p.id}:${x.id}`, nome: x.nome, tipo: ROTULO_TIPO_PASSAGEIRO[x.tipo], documento: x.documento,
    produto: p.descricao || ROTULO_TIPO_PRODUTO[p.tipo], localizador: p.localizador,
    situacao: x.cancelado_em || p.cancelado_em ? `Cancelado em ${dataBR(x.cancelado_em || p.cancelado_em)}` : 'Ativo',
  })));
  const csv = () => {
    const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const corpo = [['Nome', 'Tipo', 'Documento', 'Produto', 'Localizador', 'Situação'], ...linhas.map(l => [l.nome, l.tipo, l.documento, l.produto, l.localizador, l.situacao])]
      .map(l => l.map(esc).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`\ufeff${corpo}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'passageiros-da-venda.csv'; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <RecordSheet
      aberto onOpenChange={a => { if (!a) onFechar(); }}
      titulo="Lista de passageiros"
      descricao={`${linhas.length} ${linhas.length === 1 ? 'passageiro' : 'passageiros'} em ${produtos.filter(p => p.passageiros.length).length} produto(s).`}
      largura={960}
      acaoPrimaria={{ rotulo: 'Baixar em CSV', onClick: csv }}
      acaoSecundaria={{ rotulo: 'Fechar', onClick: onFechar }}
    >
      <div className="overflow-x-auto rounded-[var(--fin-r-md)] border border-[var(--fin-border)]">
        <table className="w-full min-w-[680px] border-collapse fin-t-body">
          <thead className="bg-[var(--fin-surface-2)]">
            <tr className="text-left fin-t-overline text-[var(--fin-text-3)]">
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Documento</th>
              <th className="px-3 py-2 font-medium">Produto</th>
              <th className="px-3 py-2 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(l => (
              <tr key={l.id} className="border-t border-[var(--fin-border)]">
                <td className="px-3 py-1.5 text-[var(--fin-text)]">{l.nome || '—'}</td>
                <td className="px-3 py-1.5 text-[var(--fin-text-2)]">{l.tipo}</td>
                <td className="px-3 py-1.5 tabular-nums text-[var(--fin-text-2)]">{l.documento || <span className="text-[var(--fin-warning-text)]">Falta</span>}</td>
                <td className="px-3 py-1.5 text-[var(--fin-text-2)]">{l.produto}{l.localizador ? <span className="text-[var(--fin-text-3)]"> · {l.localizador}</span> : null}</td>
                <td className={cn('px-3 py-1.5', l.situacao === 'Ativo' ? 'text-[var(--fin-text-2)]' : 'text-[var(--fin-negative-text)]')}>{l.situacao}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RecordSheet>
  );
}

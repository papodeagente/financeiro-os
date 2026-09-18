'use client';

/**
 * Serviços da empresa para a nota fiscal.
 *
 * Existe porque o seletor de serviço na emissão precisa de uma lista curta e
 * certa. Sem cadastro, quem emite escolhe toda vez dentro da lista nacional
 * inteira — e escolher errado ali não é engano de tela, é código de tributação
 * errado na nota, que a prefeitura aceita e o fisco cobra depois.
 *
 * Cada serviço guarda o código de tributação, o CNAE, a alíquota do ISS e um
 * texto padrão. O que estiver aqui aparece em "SERVIÇOS CADASTRADOS" no topo
 * do seletor, antes da lista nacional.
 */
import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { toast } from '@/lib/toast';
import { num, round2 } from '@/lib/money';
import { ISS_MAXIMO, ISS_MINIMO } from '@/lib/nfse-formulario';
import type { ServicoFiscalCadastrado } from '@/lib/nfse-tipos';

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-4';
const CAMPO =
  'h-10 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] ' +
  'px-3 fin-t-body text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-[var(--fin-accent)]';
const BOTAO =
  'inline-flex h-10 items-center gap-1.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] ' +
  'bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] disabled:opacity-50';
const BOTAO_PRIMARIO =
  'inline-flex h-10 items-center gap-1.5 rounded-[var(--fin-r-md)] bg-[var(--fin-accent)] px-3 ' +
  'fin-t-body-strong text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] disabled:opacity-50';

interface OpcaoNacional { codigo: string; item: string; titulo: string }

function linhaVazia(): ServicoFiscalCadastrado {
  return {
    id: `novo-${Math.random().toString(36).slice(2, 10)}`,
    codigo_tributacao: '',
    cnae: '',
    descricao: '',
    aliquota_iss: 0,
    nbs: '',
    descricao_padrao: '',
  };
}

export default function ServicosFiscaisPage() {
  const [servicos, setServicos] = useState<ServicoFiscalCadastrado[] | null>(null);
  const [nacional, setNacional] = useState<OpcaoNacional[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        fetch('/api/fiscal/servicos-empresa').then(r => r.json()),
        fetch('/api/fiscal/servicos?busca=').then(r => r.json()),
      ]);
      if (a?.error) { setErro(a.error); setServicos([]); return; }
      setServicos((a?.servicos ?? []) as ServicoFiscalCadastrado[]);
      setNacional((b?.servicos ?? []) as OpcaoNacional[]);
    } catch {
      setErro('Não foi possível carregar os serviços.');
      setServicos([]);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  function alterar(id: string, campo: keyof ServicoFiscalCadastrado, valor: string | number) {
    setServicos(lista => (lista ?? []).map(s => (s.id === id ? { ...s, [campo]: valor } : s)));
  }

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    try {
      const res = await fetch('/api/fiscal/servicos-empresa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servicos }),
      });
      const corpo = await res.json();
      if (!res.ok) { toast.error('Não foi possível salvar', corpo?.error || ''); return; }
      // O servidor devolve a lista saneada: adotar a resposta evita a tela
      // mostrar um serviço sem código que não chegou a ser gravado.
      setServicos(corpo.servicos as ServicoFiscalCadastrado[]);
      toast.success('Serviços salvos');
    } finally {
      setSalvando(false);
    }
  }

  const lista = servicos ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        titulo="Serviços da nota fiscal"
        subtitulo="O que a empresa presta. Cada serviço leva o código de tributação e a alíquota que vão na nota."
      />

      {servicos === null ? (
        <DataState estado="carregando" esqueleto={<div className={`${CARTAO} h-32`} />}>
          {null}
        </DataState>
      ) : erro ? (
        <DataState
          estado="erro"
          erro={{ mensagem: erro, onTentarDeNovo: () => { void carregar(); } }}
          esqueleto={null}
        >
          {null}
        </DataState>
      ) : (
        <>
          {lista.length === 0 ? (
            <div className={CARTAO}>
              <p className="fin-t-body text-[var(--fin-text-2)]">
                Nenhum serviço cadastrado ainda. Sem cadastro, quem emite escolhe na lista
                nacional a cada nota, e o código de tributação errado só aparece na fiscalização.
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            {lista.map(s => {
              const aliquota = round2(num(s.aliquota_iss));
              const foraDaFaixa = aliquota > 0 && (aliquota < ISS_MINIMO || aliquota > ISS_MAXIMO);
              return (
                <div key={s.id} className={`${CARTAO} flex flex-col gap-3`}>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1.5">
                      <span className="fin-t-caption text-[var(--fin-text-2)]">Serviço prestado</span>
                      <select
                        className={CAMPO}
                        value={s.codigo_tributacao}
                        onChange={e => {
                          const cod = e.target.value;
                          const op = nacional.find(n => n.codigo === cod);
                          setServicos(l => (l ?? []).map(x => (x.id === s.id
                            ? { ...x, codigo_tributacao: cod, descricao: x.descricao || op?.titulo || '' }
                            : x)));
                        }}
                      >
                        <option value="">Escolha na lista nacional</option>
                        {nacional.map(n => (
                          <option key={n.codigo} value={n.codigo}>
                            {`${n.codigo} | ${n.item} ${n.titulo}`}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="fin-t-caption text-[var(--fin-text-2)]">Nome que aparece no seletor</span>
                      <input
                        className={CAMPO}
                        value={s.descricao}
                        placeholder="Agenciamento de viagens"
                        onChange={e => alterar(s.id, 'descricao', e.target.value)}
                      />
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="fin-t-caption text-[var(--fin-text-2)]">CNAE</span>
                      <input
                        className={CAMPO}
                        value={s.cnae}
                        inputMode="numeric"
                        placeholder="7911200"
                        onChange={e => alterar(s.id, 'cnae', e.target.value.replace(/\D+/g, '').slice(0, 7))}
                      />
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="fin-t-caption text-[var(--fin-text-2)]">Alíquota do ISS (%)</span>
                      <input
                        className={CAMPO}
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        value={s.aliquota_iss || ''}
                        placeholder="0,00"
                        onChange={e => alterar(s.id, 'aliquota_iss', num(e.target.value))}
                      />
                      {foraDaFaixa ? (
                        <span className="fin-t-caption text-[var(--fin-warning-text)]">
                          O ISS costuma ficar entre {ISS_MINIMO}% e {ISS_MAXIMO}% (LC 116 e LC
                          157/2016). Confirme com a contabilidade.
                        </span>
                      ) : null}
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="fin-t-caption text-[var(--fin-text-2)]">Código NBS (opcional)</span>
                      <input
                        className={CAMPO}
                        value={s.nbs ?? ''}
                        placeholder="Só para serviço exportado"
                        onChange={e => alterar(s.id, 'nbs', e.target.value)}
                      />
                    </label>

                    <label className="flex flex-col gap-1.5 sm:col-span-2">
                      <span className="fin-t-caption text-[var(--fin-text-2)]">
                        Descrição padrão da nota (opcional)
                      </span>
                      <textarea
                        className={`${CAMPO} h-auto py-2`}
                        rows={2}
                        value={s.descricao_padrao ?? ''}
                        placeholder="Texto que entra sozinho na descrição ao escolher este serviço"
                        onChange={e => alterar(s.id, 'descricao_padrao', e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      className={BOTAO}
                      onClick={() => setServicos(l => (l ?? []).filter(x => x.id !== s.id))}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                      Remover
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BOTAO}
              onClick={() => setServicos(l => [...(l ?? []), linhaVazia()])}
            >
              <Plus aria-hidden="true" className="size-4" />
              Adicionar serviço
            </button>
            <button type="button" className={BOTAO_PRIMARIO} disabled={salvando} onClick={() => { void salvar(); }}>
              {salvando ? 'Salvando…' : 'Salvar serviços'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

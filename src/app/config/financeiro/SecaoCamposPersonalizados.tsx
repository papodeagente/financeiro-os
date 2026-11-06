'use client';

/**
 * Configurações › Financeiro › Campos personalizados (06/11/2026, E7).
 * A agência cria os campos que quer guardar nas contas a pagar e a receber:
 * nome, tipo, a quem vale e se é obrigatório. Aparecem no lançamento, na lista
 * Contas a Pagar/Receber (como coluna escolhível) e na planilha.
 *
 * Não existe "apagar": desativar esconde o campo do lançamento, e o que já
 * foi preenchido continua nas contas.
 */
import { naEmpresa } from '@/components/fin/EmpresaDaConfiguracao';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  LIMITES, ROTULO_DO_ALCANCE, ROTULO_DO_TIPO, TIPOS, idParaNome, problemaNasDefinicoes,
  type AplicaA, type CampoPersonalizado, type TipoDoCampoPersonalizado,
} from '@/lib/campos-personalizados';
import { toast } from '@/lib/toast';

const SECAO = 'flex max-w-3xl flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)]';
const CONTROLE = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body lg:h-10';
const GATILHO = `${CONTROLE} justify-between gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0`;
const ICONE = 'inline-flex size-9 items-center justify-center rounded-[var(--fin-r-md)] text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';
const ALCANCES: AplicaA[] = ['ambos', 'pagar', 'receber'];

type Linha = CampoPersonalizado & { novo?: boolean; opcaoNova?: string };

export function SecaoCamposPersonalizados() {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [gravado, setGravado] = useState('[]');
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(naEmpresa('/api/config/financeiro/campos-personalizados'), { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { campos?: CampoPersonalizado[] }) => {
        if (!vivo) return;
        const campos = Array.isArray(j?.campos) ? j.campos : [];
        setLinhas(campos);
        setGravado(JSON.stringify(campos));
        setEstado('ok');
      })
      .catch(() => { if (vivo) setEstado('erro'); });
    return () => { vivo = false; };
  }, []);

  const limpas = (): CampoPersonalizado[] => linhas.map(({ novo: _n, opcaoNova: _o, ...c }) => { void _n; void _o; return c; });
  const mudou = estado === 'ok' && JSON.stringify(limpas()) !== gravado;
  const problema = estado === 'ok' ? problemaNasDefinicoes(limpas()) : null;

  const mudar = (i: number, parte: Partial<Linha>) => setLinhas(ls => ls.map((l, j) => (j === i ? { ...l, ...parte } : l)));
  const mover = (i: number, d: -1 | 1) => setLinhas(ls => {
    const j = i + d;
    if (j < 0 || j >= ls.length) return ls;
    const c = [...ls];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  });
  const adicionar = () => setLinhas(ls => {
    const usados = new Set(ls.map(l => l.id));
    return [...ls, { id: idParaNome(`campo ${ls.length + 1}`, usados), nome: '', tipo: 'texto', ativo: true, aplica_a: 'ambos', novo: true }];
  });
  const incluirOpcao = (i: number) => {
    const l = linhas[i];
    const t = (l.opcaoNova ?? '').trim().slice(0, LIMITES.opcao);
    if (!t) return;
    if ((l.opcoes ?? []).some(o => o.toLowerCase() === t.toLowerCase())) { mudar(i, { opcaoNova: '' }); return; }
    mudar(i, { opcoes: [...(l.opcoes ?? []), t].slice(0, LIMITES.opcoes), opcaoNova: '' });
  };

  async function salvar() {
    if (salvando || problema) return;
    setSalvando(true);
    try {
      // Campo novo ganha o id pelo nome (renomear depois não muda o id).
      const usados = new Set(linhas.filter(l => !l.novo).map(l => l.id));
      const envio = limpas().map((c, i) => {
        if (!linhas[i].novo) return c;
        const id = idParaNome(c.nome, usados);
        usados.add(id);
        return { ...c, id };
      });
      const r = await fetch(naEmpresa('/api/config/financeiro/campos-personalizados'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campos: envio }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof corpo?.error === 'string' ? corpo.error : `Erro ${r.status}`);
      const campos = Array.isArray(corpo.campos) ? corpo.campos as CampoPersonalizado[] : envio;
      setLinhas(campos);
      setGravado(JSON.stringify(campos));
      toast.success('Campos personalizados salvos');
    } catch (e) {
      toast.error('Não foi possível salvar os campos', e instanceof Error ? e.message : '');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section aria-labelledby="t-campos-personalizados" className={SECAO}>
      <div className="flex flex-col gap-[var(--fin-s-1)]">
        <h2 id="t-campos-personalizados" className="fin-t-subhead text-[var(--fin-text)]">Campos personalizados das contas</h2>
        <p className="fin-t-caption text-[var(--fin-text-2)]">
          Informações a mais que a agência quer guardar em cada conta a pagar ou a receber, como o pedido do cliente ou quem aprovou.
          Aparecem no lançamento, como coluna na lista de contas e na planilha. Desativar esconde o campo, sem apagar o que já foi preenchido.
        </p>
      </div>

      {estado === 'erro' ? (
        <p role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">Não foi possível ler os campos. Recarregue a página.</p>
      ) : estado === 'carregando' ? (
        <p className="fin-t-caption text-[var(--fin-text-3)]">Carregando…</p>
      ) : linhas.length === 0 ? (
        <p className="fin-t-body text-[var(--fin-text-2)]">Nenhum campo ainda. As contas usam só os campos de sempre.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-[var(--fin-border)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)]">
          {linhas.map((l, i) => (
            <li key={`${l.id}-${i}`} className={`flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-3)]${l.ativo ? '' : ' bg-[var(--fin-surface-2)]'}`}>
              <div className="flex flex-wrap items-end gap-[var(--fin-s-2)]">
                <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
                  <span className="fin-t-caption text-[var(--fin-text-2)]">Nome</span>
                  <Input
                    value={l.nome}
                    maxLength={LIMITES.nome}
                    placeholder="Ex.: Pedido do cliente"
                    onChange={e => mudar(i, { nome: e.target.value })}
                    className={CONTROLE}
                  />
                </label>
                <label className="flex w-44 flex-col gap-1">
                  <span className="fin-t-caption text-[var(--fin-text-2)]">Tipo</span>
                  <Select value={l.tipo} onValueChange={v => mudar(i, { tipo: v as TipoDoCampoPersonalizado })} disabled={!l.novo}>
                    <SelectTrigger className={GATILHO}><SelectValue>{() => ROTULO_DO_TIPO[l.tipo]}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {TIPOS.map(t => <SelectItem key={t} value={t} className="fin-t-body">{ROTULO_DO_TIPO[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex w-48 flex-col gap-1">
                  <span className="fin-t-caption text-[var(--fin-text-2)]">Vale para</span>
                  <Select value={l.aplica_a} onValueChange={v => mudar(i, { aplica_a: v as AplicaA })}>
                    <SelectTrigger className={GATILHO}><SelectValue>{() => ROTULO_DO_ALCANCE[l.aplica_a]}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {ALCANCES.map(a => <SelectItem key={a} value={a} className="fin-t-body">{ROTULO_DO_ALCANCE[a]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <div className="flex items-center">
                  <button type="button" className={ICONE} onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir ${l.nome || 'campo'}`}>
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" className={ICONE} onClick={() => mover(i, 1)} disabled={i === linhas.length - 1} aria-label={`Descer ${l.nome || 'campo'}`}>
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {l.tipo === 'lista' ? (
                <div className="flex flex-col gap-[var(--fin-s-2)]">
                  <span className="fin-t-caption text-[var(--fin-text-2)]">Opções da lista</span>
                  {(l.opcoes ?? []).length > 0 ? (
                    <ul className="flex flex-wrap gap-[var(--fin-s-1)]">
                      {(l.opcoes ?? []).map(o => (
                        <li key={o} className="inline-flex items-center gap-1 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)] py-0.5 pl-2 pr-0.5 fin-t-caption text-[var(--fin-text)]">
                          {o}
                          <button
                            type="button"
                            className="inline-flex size-6 items-center justify-center rounded-[var(--fin-r-sm)] text-[var(--fin-text-3)] hover:bg-[var(--fin-border)] hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)]"
                            onClick={() => mudar(i, { opcoes: (l.opcoes ?? []).filter(x => x !== o) })}
                            aria-label={`Tirar a opção ${o}`}
                          >
                            <X className="size-3.5" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex max-w-md gap-[var(--fin-s-2)]">
                    <Input
                      value={l.opcaoNova ?? ''}
                      maxLength={LIMITES.opcao}
                      placeholder="Nova opção"
                      aria-label={`Nova opção para ${l.nome || 'o campo'}`}
                      onChange={e => mudar(i, { opcaoNova: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); incluirOpcao(i); } }}
                      className={CONTROLE}
                    />
                    <Button type="button" variant="outline" onClick={() => incluirOpcao(i)} disabled={!(l.opcaoNova ?? '').trim()}>Incluir</Button>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-x-[var(--fin-s-5)] gap-y-[var(--fin-s-2)]">
                <label className="flex items-center gap-2 fin-t-body text-[var(--fin-text)]">
                  <input type="checkbox" checked={Boolean(l.obrigatorio)} onChange={e => mudar(i, { obrigatorio: e.target.checked || undefined })}
                    className="size-4 accent-[var(--fin-accent)]" />
                  Obrigatório ao lançar
                </label>
                <label className="flex items-center gap-2 fin-t-body text-[var(--fin-text)]">
                  <input type="checkbox" checked={l.ativo} onChange={e => mudar(i, { ativo: e.target.checked })}
                    className="size-4 accent-[var(--fin-accent)]" />
                  Ativo
                </label>
                {!l.novo ? null : (
                  <button type="button" className="fin-t-caption text-[var(--fin-text-2)] underline-offset-2 hover:text-[var(--fin-negative-text)] hover:underline"
                    onClick={() => setLinhas(ls => ls.filter((_, j) => j !== i))}>
                    Desistir deste campo
                  </button>
                )}
              </div>
              {l.novo ? null : <p className="fin-t-caption text-[var(--fin-text-3)]">O tipo não muda depois de salvo, para não estragar o que já foi preenchido.</p>}
            </li>
          ))}
        </ol>
      )}

      {problema && mudou ? <p role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">{problema}</p> : null}

      <div className="flex flex-wrap gap-[var(--fin-s-2)]">
        <Button type="button" variant="outline" onClick={adicionar} disabled={estado !== 'ok' || linhas.length >= LIMITES.campos}>
          <Plus className="size-4" aria-hidden="true" /> Novo campo
        </Button>
        <Button type="button" onClick={() => { void salvar(); }} disabled={salvando || !mudou || Boolean(problema)}>
          {salvando ? 'Salvando…' : 'Salvar campos'}
        </Button>
      </div>
    </section>
  );
}

export default SecaoCamposPersonalizados;

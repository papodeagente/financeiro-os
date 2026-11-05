'use client';

// Configurações › Perfis de acesso (05/11/2026).
// Perfil: nome, acesso completo, pessoas, direitos por módulo e contas
// bancárias que ele vê, com "Salvar e duplicar". O papel de cada pessoa é o
// limite: o perfil só tira. Também: restrição por pessoa e a matriz papel × direito.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, Landmark, Minus, Plus, Save, ShieldCheck, Trash2, UsersRound } from 'lucide-react';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { Segmentado } from '@/components/fin/Segmentado';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Field } from '@/components/fin/Field';
import { Caixinha, MatrizDeDireitos, type ModuloDoCatalogo } from '@/components/fin/MatrizDeDireitos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

interface Grupo { id: string; nome: string; acesso_total: boolean; acoes: string[]; contas: string[]; membros: string[] }
interface Restricao { usuario_id: string; contas_liberadas: string[]; acoes_negadas: string[] }
interface Pessoa { id: string; nome: string; email: string; papel: 'ADMIN' | 'OPERADOR' | 'VENDEDOR'; ativo: boolean }
interface Conta { id: string; nome: string; detalhe?: string }
interface Dados {
  grupos: Grupo[]; restricoes: Restricao[]; usuarios: Pessoa[]; contas: Conta[];
  catalogo: ModuloDoCatalogo[]; tetos: Record<'ADMIN' | 'OPERADOR' | 'VENDEDOR', string[]>;
}

const PAPEL: Record<string, string> = { ADMIN: 'Administrador', OPERADOR: 'Operador', VENDEDOR: 'Vendedor' };
const PAINEL = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';
type Visao = 'grupos' | 'pessoas' | 'matriz';

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(corpo?.error || 'Não foi possível concluir agora.');
  return corpo as T;
}

function grupoNovo(dados: Dados, base?: Grupo): Grupo {
  if (base) return { ...base, id: '', nome: `Cópia de ${base.nome}`.slice(0, 80), membros: [] };
  return { id: '', nome: '', acesso_total: false, acoes: [...dados.tetos.OPERADOR], contas: [], membros: [] };
}

export default function PerfisDeAcessoPage() {
  const { user } = useAuth();
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [visao, setVisao] = useState<Visao>('grupos');

  const carregar = useCallback(async () => {
    try {
      setErro(null);
      setDados(await pedir<Dados>('/api/perfis-de-acesso'));
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <MolduraDaPagina>
      <PageHeader
        titulo="Perfis de acesso"
        icone={UsersRound}
        subtitulo="O papel do usuário (Administrador, Operador, Vendedor) é o limite. O perfil só tira direitos e contas; administrador nunca é limitado."
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
      />
      <Segmentado<Visao>
        rotulo="Mostrar"
        valor={visao}
        onChange={setVisao}
        opcoes={[
          { valor: 'grupos', rotulo: 'Perfis', contagem: dados?.grupos.length },
          { valor: 'pessoas', rotulo: 'Por pessoa' },
          { valor: 'matriz', rotulo: 'Matriz de direitos' },
        ]}
      />
      <DataState
        estado={erro ? 'erro' : dados ? 'ok' : 'carregando'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => void carregar() } : null}
        esqueleto={<div className={cn(PAINEL, 'h-96 animate-pulse')} />}
      >
        {dados && visao === 'grupos' && <VisaoGrupos dados={dados} recarregar={carregar} />}
        {dados && visao === 'pessoas' && <VisaoPessoas dados={dados} recarregar={carregar} meuId={user?.id ?? ''} />}
        {dados && visao === 'matriz' && <VisaoMatriz dados={dados} />}
      </DataState>
    </MolduraDaPagina>
  );
}

// ---------------------------------------------------------------------------

function VisaoGrupos({ dados, recarregar }: { dados: Dados; recarregar: () => Promise<void> }) {
  const [selecionado, setSelecionado] = useState<string | null>(dados.grupos[0]?.id ?? null);
  const [rascunho, setRascunho] = useState<Grupo | null>(dados.grupos[0] ?? null);
  const [salvando, setSalvando] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const [erroNome, setErroNome] = useState<string | null>(null);

  const original = dados.grupos.find(g => g.id === selecionado) ?? null;
  const sujo = rascunho !== null && JSON.stringify(rascunho) !== JSON.stringify(original ?? grupoNovo(dados));
  const tetoOperador = useMemo(() => new Set(dados.tetos.OPERADOR), [dados.tetos.OPERADOR]);
  const totalDoTeto = dados.tetos.OPERADOR.length;

  const abrir = (g: Grupo | null, base?: Grupo) => {
    if (sujo && !window.confirm('Há alterações não salvas neste perfil. Descartar?')) return;
    setErroNome(null);
    setSelecionado(g?.id ?? null);
    setRascunho(g ? { ...g } : grupoNovo(dados, base));
  };

  async function salvar(copiar: boolean) {
    if (!rascunho) return;
    if (!rascunho.nome.trim()) { setErroNome('Dê um nome ao perfil.'); return; }
    setSalvando(true);
    try {
      const { grupo } = await pedir<{ grupo: Grupo }>('/api/perfis-de-acesso', { method: 'POST', body: JSON.stringify({ grupo: rascunho }) });
      await recarregar();
      toast.success(copiar ? 'Perfil salvo. Agora ajuste a cópia.' : 'Perfil salvo.');
      if (copiar) { setSelecionado(null); setRascunho(grupoNovo(dados, grupo)); }
      else { setSelecionado(grupo.id); setRascunho(grupo); }
    } catch (e) {
      toast.error('Não salvou', e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarExclusao() {
    if (!original) return;
    try {
      await pedir(`/api/perfis-de-acesso/${encodeURIComponent(original.id)}`, { method: 'DELETE' });
      toast.success('Perfil excluído.');
      setExcluir(false);
      setSelecionado(null);
      setRascunho(null);
      await recarregar();
    } catch (e) {
      toast.error('Não excluiu', e instanceof Error ? e.message : undefined);
    }
  }

  if (dados.grupos.length === 0 && !rascunho) {
    return (
      <EmptyLesson
        motivo="sem-dado"
        titulo="Nenhum perfil de acesso ainda"
        oQueE="Sem perfil, cada pessoa faz tudo o que o papel dela permite. Crie um perfil para limitar o que um time faz e quais contas bancárias ele vê."
        comoComeca={['Crie o perfil (ex.: Tesouraria, Contas a pagar).', 'Desmarque o que o time não deve fazer.', 'Escolha as pessoas e, se quiser, só algumas contas.']}
        acao={{ rotulo: 'Criar o primeiro perfil', onClick: () => abrir(null) }}
      />
    );
  }

  const membros = new Set(rascunho?.membros ?? []);
  const contas = new Set(rascunho?.contas ?? []);
  const set = (parcial: Partial<Grupo>) => setRascunho(r => (r ? { ...r, ...parcial } : r));

  return (
    <div className="grid gap-[var(--fin-s-4)] lg:grid-cols-[minmax(240px,300px)_1fr]">
      <nav aria-label="Perfis de acesso" className={cn(PAINEL, 'flex h-fit flex-col p-2')}>
        <ul className="flex flex-col gap-0.5">
          {dados.grupos.map(g => {
            const ativo = g.id === selecionado;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => abrir(g)}
                  aria-current={ativo ? 'true' : undefined}
                  className={cn(
                    'flex w-full flex-col items-start rounded-[var(--fin-r-md)] px-3 py-2 text-left transition-colors duration-[var(--fin-dur-rapida)]',
                    ativo ? 'bg-[var(--fin-accent-soft)]' : 'hover:bg-[var(--fin-surface-2)]',
                  )}
                >
                  <span className={cn('fin-t-body-strong', ativo ? 'text-[var(--fin-accent)]' : 'text-[var(--fin-text)]')}>{g.nome}</span>
                  <span className="fin-t-caption text-[var(--fin-text-3)]">
                    {g.membros.length} pessoa{g.membros.length === 1 ? '' : 's'} · {g.acesso_total ? 'Acesso completo' : `${g.acoes.filter(a => tetoOperador.has(a)).length} de ${totalDoTeto} direitos`}
                    {g.contas.length > 0 ? ` · ${g.contas.length} conta${g.contas.length === 1 ? '' : 's'}` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <Button variant="ghost" className="mt-1 justify-start gap-2 text-[var(--fin-accent)]" onClick={() => abrir(null)}>
          <Plus aria-hidden="true" /> Novo perfil
        </Button>
      </nav>

      {rascunho && (
        <section aria-label={rascunho.nome || 'Novo perfil'} className={cn(PAINEL, 'flex min-w-0 flex-col')}>
          <div className="flex flex-col gap-[var(--fin-s-5)] p-[var(--fin-s-4)] sm:p-[var(--fin-s-5)]">
            <div className="grid gap-[var(--fin-s-4)] sm:grid-cols-[1fr_auto] sm:items-end">
              <Field rotulo="Nome do perfil" obrigatorio erro={erroNome}>
                {a => <Input {...a} value={rascunho.nome} maxLength={80} placeholder="Ex.: Contas a pagar" onChange={e => { setErroNome(null); set({ nome: e.target.value }); }} />}
              </Field>
              <label className="flex cursor-pointer items-center gap-2 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] px-3 py-2.5">
                <Caixinha marcada={rascunho.acesso_total} onChange={v => set({ acesso_total: v, contas: v ? [] : rascunho.contas })} />
                <span className="fin-t-body-strong">Acesso completo</span>
              </label>
            </div>

            <Bloco titulo="Direitos" ajuda={rascunho.acesso_total
              ? 'Com acesso completo, cada pessoa do perfil faz tudo o que o papel dela permite.'
              : 'Desmarque o que este perfil não deve fazer. Os apagados são só do administrador, que nunca é limitado.'}>
              {!rascunho.acesso_total && (
                <MatrizDeDireitos
                  catalogo={dados.catalogo}
                  marcadas={new Set(rascunho.acoes)}
                  teto={tetoOperador}
                  onChange={s => set({ acoes: [...s] })}
                />
              )}
            </Bloco>

            <Bloco titulo="Pessoas neste perfil" ajuda="Quem está em mais de um perfil soma os direitos e as contas de todos.">
              {dados.usuarios.length === 0 ? (
                <p className="fin-t-body text-[var(--fin-text-3)]">Nenhuma pessoa cadastrada em Usuários.</p>
              ) : (
                <ul className="grid gap-1 sm:grid-cols-2">
                  {dados.usuarios.map(p => (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-[var(--fin-r-md)] px-2 py-2 hover:bg-[var(--fin-surface-2)]">
                        <Caixinha marcada={membros.has(p.id)} onChange={v => set({ membros: v ? [...membros, p.id] : [...membros].filter(x => x !== p.id) })} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="fin-t-body truncate">{p.nome || p.email}{!p.ativo && <span className="text-[var(--fin-text-3)]"> (inativo)</span>}</span>
                          <span className="fin-t-caption text-[var(--fin-text-3)]">
                            {PAPEL[p.papel] ?? p.papel}{p.papel === 'ADMIN' ? ' · nunca é limitado' : ''}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </Bloco>

            <Bloco titulo="Contas bancárias que este perfil vê" ajuda={rascunho.acesso_total ? 'Com acesso completo, o perfil vê todas as contas.' : 'Marque as contas. Sem nenhuma marcada, o perfil vê todas.'}>
              <SeletorDeContas
                contas={dados.contas}
                marcadas={contas}
                desabilitado={rascunho.acesso_total}
                onChange={s => set({ contas: [...s] })}
              />
            </Bloco>
          </div>

          <footer className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-b-[var(--fin-r-lg)] border-t border-[var(--fin-border)] bg-[var(--fin-surface)] px-[var(--fin-s-4)] py-3 sm:px-[var(--fin-s-5)]">
            {original && (
              <Button variant="ghost" className="gap-2 text-[var(--fin-negative-text)]" onClick={() => setExcluir(true)} disabled={salvando}>
                <Trash2 aria-hidden="true" /> Excluir perfil
              </Button>
            )}
            <span className="fin-t-caption mr-auto text-[var(--fin-text-3)]">{sujo ? 'Alterações não salvas' : original ? 'Tudo salvo' : 'Perfil novo'}</span>
            <Button variant="outline" className="gap-2" onClick={() => void salvar(true)} disabled={salvando}>
              <Copy aria-hidden="true" /> Salvar e duplicar
            </Button>
            <Button className="gap-2" onClick={() => void salvar(false)} disabled={salvando || (!sujo && !!original)}>
              <Save aria-hidden="true" /> {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </footer>
        </section>
      )}

      <ConfirmDialog
        aberto={excluir}
        onOpenChange={setExcluir}
        titulo={`Excluir o perfil ${original?.nome ?? ''}?`}
        oQueVaiAcontecer="As pessoas deste perfil voltam a fazer o que o papel delas permite (ou o que os outros perfis delas permitem). Nenhum lançamento é apagado."
        detalhes={original ? [{ rotulo: 'Pessoas', valor: String(original.membros.length) }] : undefined}
        confirmarRotulo="Excluir perfil"
        tone="destrutivo"
        onConfirmar={confirmarExclusao}
      />
    </div>
  );
}

function Bloco({ titulo, ajuda, children }: { titulo: string; ajuda?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[var(--fin-s-3)]">
      <div className="flex flex-col gap-0.5">
        <h2 className="fin-t-subhead text-[var(--fin-text)]">{titulo}</h2>
        {ajuda && <p className="fin-t-caption max-w-[70ch] text-[var(--fin-text-3)]">{ajuda}</p>}
      </div>
      {children}
    </div>
  );
}

function SeletorDeContas({
  contas, marcadas, onChange, desabilitado,
}: { contas: Conta[]; marcadas: ReadonlySet<string>; onChange: (s: Set<string>) => void; desabilitado?: boolean }) {
  if (contas.length === 0) return <p className="fin-t-body text-[var(--fin-text-3)]">Nenhuma conta bancária cadastrada.</p>;
  return (
    <ul className={cn('grid gap-1 sm:grid-cols-2', desabilitado && 'opacity-60')}>
      {contas.map(c => (
        <li key={c.id}>
          <label className={cn('flex items-center gap-3 rounded-[var(--fin-r-md)] px-2 py-2', desabilitado ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--fin-surface-2)]')}>
            <Caixinha
              marcada={marcadas.has(c.id)}
              desabilitada={desabilitado}
              onChange={v => { const s = new Set(marcadas); if (v) s.add(c.id); else s.delete(c.id); onChange(s); }}
            />
            <Landmark aria-hidden="true" className="size-4 shrink-0 text-[var(--fin-text-3)]" />
            <span className="flex min-w-0 flex-col">
              <span className="fin-t-body truncate">{c.nome}</span>
              {c.detalhe && <span className="fin-t-caption truncate text-[var(--fin-text-3)]">{c.detalhe}</span>}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

function VisaoPessoas({ dados, recarregar, meuId }: { dados: Dados; recarregar: () => Promise<void>; meuId: string }) {
  const pessoas = dados.usuarios.filter(p => p.papel !== 'ADMIN');
  const [selecionada, setSelecionada] = useState<string | null>(pessoas[0]?.id ?? null);
  const pessoa = pessoas.find(p => p.id === selecionada) ?? null;
  const restricao = dados.restricoes.find(r => r.usuario_id === selecionada);
  const teto = useMemo(() => new Set(pessoa ? dados.tetos[pessoa.papel] ?? [] : []), [pessoa, dados.tetos]);
  const [permitidas, setPermitidas] = useState<Set<string>>(new Set());
  const [contas, setContas] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const negadas = new Set(restricao?.acoes_negadas ?? []);
    setPermitidas(new Set([...teto].filter(a => !negadas.has(a))));
    setContas(new Set(restricao?.contas_liberadas ?? []));
  }, [restricao, teto]);

  if (pessoas.length === 0) {
    return (
      <EmptyLesson
        motivo="sem-dado"
        titulo="Só há administradores"
        oQueE="Administrador nunca é restringido. A restrição por pessoa vale para operadores e vendedores."
      />
    );
  }

  const gruposDe = (id: string) => dados.grupos.filter(g => g.membros.includes(id)).map(g => g.nome);

  async function salvar() {
    if (!pessoa) return;
    setSalvando(true);
    try {
      await pedir('/api/perfis-de-acesso', {
        method: 'POST',
        body: JSON.stringify({ restricao: { usuario_id: pessoa.id, contas_liberadas: [...contas], acoes_negadas: [...teto].filter(a => !permitidas.has(a)) } }),
      });
      await recarregar();
      toast.success('Restrição salva.');
    } catch (e) {
      toast.error('Não salvou', e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="grid gap-[var(--fin-s-4)] lg:grid-cols-[minmax(240px,300px)_1fr]">
      <nav aria-label="Pessoas" className={cn(PAINEL, 'h-fit p-2')}>
        <ul className="flex flex-col gap-0.5">
          {pessoas.map(p => {
            const ativo = p.id === selecionada;
            const r = dados.restricoes.find(x => x.usuario_id === p.id);
            const grupos = gruposDe(p.id);
            return (
              <li key={p.id}>
                <button type="button" onClick={() => setSelecionada(p.id)} aria-current={ativo ? 'true' : undefined}
                  className={cn('flex w-full flex-col items-start rounded-[var(--fin-r-md)] px-3 py-2 text-left', ativo ? 'bg-[var(--fin-accent-soft)]' : 'hover:bg-[var(--fin-surface-2)]')}>
                  <span className={cn('fin-t-body-strong', ativo ? 'text-[var(--fin-accent)]' : 'text-[var(--fin-text)]')}>{p.nome || p.email}</span>
                  <span className="fin-t-caption text-[var(--fin-text-3)]">
                    {PAPEL[p.papel]}{grupos.length ? ` · ${grupos.join(', ')}` : ''}{r ? ' · restrição própria' : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      {pessoa && (
        <section aria-label={pessoa.nome} className={cn(PAINEL, 'flex min-w-0 flex-col')}>
          <div className="flex flex-col gap-[var(--fin-s-5)] p-[var(--fin-s-4)] sm:p-[var(--fin-s-5)]">
            <div className="flex items-start gap-3">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--fin-accent)]" />
              <p className="fin-t-body max-w-[70ch] text-[var(--fin-text-2)]">
                Vale por cima dos perfis de {pessoa.nome || 'esta pessoa'}{gruposDe(pessoa.id).length ? ` (${gruposDe(pessoa.id).join(', ')})` : ''}: só tira.
                {pessoa.papel === 'VENDEDOR' && ' Como vendedor, o papel já não alcança o financeiro.'}
              </p>
            </div>
            {pessoa.id === meuId ? (
              <p className="fin-t-body text-[var(--fin-text-3)]">O próprio acesso não se limita aqui; peça a outro administrador.</p>
            ) : (
              <>
                <Bloco titulo="Direitos" ajuda="Marcado = pode. Desmarque o que esta pessoa não deve fazer.">
                  <MatrizDeDireitos catalogo={dados.catalogo} marcadas={permitidas} teto={teto} onChange={setPermitidas} foraDoTeto="O papel não permite" />
                </Bloco>
                <Bloco titulo="Contas bancárias que esta pessoa vê" ajuda="Marque as contas. Sem nenhuma marcada, vale o que os perfis dela mostram.">
                  <SeletorDeContas contas={dados.contas} marcadas={contas} onChange={setContas} />
                </Bloco>
              </>
            )}
          </div>
          {pessoa.id !== meuId && (
            <footer className="sticky bottom-0 flex justify-end gap-2 rounded-b-[var(--fin-r-lg)] border-t border-[var(--fin-border)] bg-[var(--fin-surface)] px-[var(--fin-s-4)] py-3 sm:px-[var(--fin-s-5)]">
              <Button className="gap-2" onClick={() => void salvar()} disabled={salvando}>
                <Save aria-hidden="true" /> {salvando ? 'Salvando…' : 'Salvar restrição'}
              </Button>
            </footer>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function VisaoMatriz({ dados }: { dados: Dados }) {
  const tetos = {
    ADMIN: new Set(dados.tetos.ADMIN), OPERADOR: new Set(dados.tetos.OPERADOR), VENDEDOR: new Set(dados.tetos.VENDEDOR),
  };
  const Celula = ({ sim, rotulo }: { sim: boolean; rotulo: string }) => (
    <td className="px-3 py-2 text-center">
      {sim
        ? <Check aria-label={`${rotulo}: pode`} className="mx-auto size-4 text-[var(--fin-positive)]" />
        : <Minus aria-label={`${rotulo}: não pode`} className="mx-auto size-4 text-[var(--fin-text-3)]" />}
    </td>
  );
  return (
    <div className={cn(PAINEL, 'overflow-x-auto')}>
      <table className="w-full min-w-[640px] border-collapse text-left">
        <caption className="sr-only">Quem pode fazer cada coisa, por papel e por perfil de acesso</caption>
        <thead>
          <tr className="border-b border-[var(--fin-border)] bg-[var(--fin-surface-2)]">
            <th scope="col" className="fin-t-overline px-4 py-2 text-[var(--fin-text-3)]">Direito</th>
            {['Administrador', 'Operador', 'Vendedor'].map(p => <th key={p} scope="col" className="fin-t-overline px-3 py-2 text-center text-[var(--fin-text-3)]">{p}</th>)}
            {dados.grupos.map(g => <th key={g.id} scope="col" className="fin-t-overline px-3 py-2 text-center text-[var(--fin-accent)]">{g.nome}</th>)}
          </tr>
        </thead>
        {dados.catalogo.map(({ modulo, acoes }) => (
          <tbody key={modulo.id}>
            <tr><th colSpan={4 + dados.grupos.length} scope="colgroup" className="fin-t-body-strong border-b border-[var(--fin-border)] px-4 pb-1 pt-3 text-[var(--fin-text)]">{modulo.rotulo}</th></tr>
            {acoes.map(a => (
              <tr key={a.id} className="border-b border-[var(--fin-border)] last:border-0">
                <th scope="row" className="fin-t-body px-4 py-2 font-normal text-[var(--fin-text-2)]">{a.rotulo}</th>
                <Celula sim={tetos.ADMIN.has(a.id)} rotulo="Administrador" />
                <Celula sim={tetos.OPERADOR.has(a.id)} rotulo="Operador" />
                <Celula sim={tetos.VENDEDOR.has(a.id)} rotulo="Vendedor" />
                {dados.grupos.map(g => <Celula key={g.id} sim={tetos.OPERADOR.has(a.id) && (g.acesso_total || g.acoes.includes(a.id))} rotulo={g.nome} />)}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <p className="fin-t-caption border-t border-[var(--fin-border)] px-4 py-2 text-[var(--fin-text-3)]">
        Coluna de perfil mostra o que um operador nesse perfil pode. Vendedor num perfil continua limitado ao papel dele.
      </p>
    </div>
  );
}

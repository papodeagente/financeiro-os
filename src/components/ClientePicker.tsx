'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Pencil, Plus, Search, TriangleAlert, UserRound } from 'lucide-react';

import type { Cliente } from '@/lib/crm-types';
import { createCliente } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity } from '@/lib/crm-storage';
import { documentoDoCliente, nomeDoCliente, tipoPessoa } from '@/lib/cliente-nome';
import {
  apenasDigitos, documentoValido, faltaParaNota, formatarDocumento,
  mascararCep, mascararDocumento, prontoParaNota, tipoDoDocumento,
} from '@/lib/cliente-documento';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';

/**
 * Escolher, criar ou corrigir um cliente sem sair do formulário.
 *
 * POR QUE EXISTE. O cadastro rápido que havia na tela de venda pedia nome,
 * e-mail e telefone — nunca o CPF ou CNPJ. Como a prefeitura recusa nota sem o
 * documento do tomador, toda pessoa cadastrada por ali nascia impossibilitada
 * de gerar nota, e o problema só aparecia semanas depois, na hora de emitir,
 * com a venda fechada e o cliente esperando. E o formulário de conta a receber
 * nem guardava o vínculo: só um nome em texto livre, que a nota não consegue
 * usar para nada.
 *
 * A DECISÃO CENTRAL: o componente diz AGORA se a nota vai sair. Quem escolhe
 * um cliente sem documento vê a frase e o botão de completar no mesmo lugar em
 * que está trabalhando — não em outra tela, não em outro dia.
 *
 * Documento em branco é PERMITIDO: cliente sem CPF existe e compra. Documento
 * ERRADO não é — um dígito trocado tem o tamanho certo, passa despercebido e é
 * recusado pela prefeitura depois.
 */

export interface ClienteEscolhido {
  id: string;
  nome: string;
  documento: string;
  prontoParaNota: boolean;
}

interface Props {
  /** cliente_id já vinculado, se houver. */
  value?: string;
  /** Nome em texto livre de um registro antigo, sem vínculo. */
  nome?: string;
  onChange: (cliente: ClienteEscolhido | null) => void;
  /** Mostra o aviso de nota fiscal. Ligado onde a nota importa. */
  avisarSobreNota?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
}

type Rascunho = {
  tipo: 'PF' | 'PJ';
  nome: string;
  documento: string;
  email: string;
  telefone: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
};

const RASCUNHO_VAZIO: Rascunho = {
  tipo: 'PF', nome: '', documento: '', email: '', telefone: '',
  cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '',
};

const CAMPO =
  'h-10 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] ' +
  'px-2 fin-t-body text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-[var(--fin-accent)]';

/** O rascunho a partir de um cliente existente, para o modo de edição. */
function rascunhoDe(c: Cliente): Rascunho {
  const pf = tipoPessoa(c.tipo) === 'PF';
  return {
    tipo: pf ? 'PF' : 'PJ',
    nome: nomeDoCliente(c),
    documento: formatarDocumento(documentoDoCliente(c)),
    email: c.email ?? '',
    telefone: c.telefone_principal ?? '',
    cep: c.cep ?? '', logradouro: c.logradouro ?? '', numero: c.numero ?? '',
    complemento: c.complemento ?? '', bairro: c.bairro ?? '',
    cidade: c.cidade ?? '', estado: c.estado ?? '',
  };
}

export function ClientePicker({
  value, nome, onChange, avisarSobreNota = true,
  placeholder = 'Buscar cliente cadastrado', className = '', id,
}: Props) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [modo, setModo] = useState<'lista' | 'novo' | 'editar'>('lista');
  const [rascunho, setRascunho] = useState<Rascunho>(RASCUNHO_VAZIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setClientes(await loadEntities<Cliente>('clientes'));
    } catch {
      // Lista vazia é o pior caso: o campo vira cadastro novo, que funciona.
    }
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) fecharTudo();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') fecharTudo(); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  function fecharTudo() {
    setAberto(false);
    setModo('lista');
    setBusca('');
  }

  const selecionado = useMemo(
    () => (value ? clientes.find(c => c.id === value) ?? null : null),
    [value, clientes],
  );
  const rotulo = selecionado ? nomeDoCliente(selecionado) : (nome || '');
  const documentoAtual = selecionado ? documentoDoCliente(selecionado) : '';
  const faltas = selecionado ? faltaParaNota(selecionado, nomeDoCliente(selecionado)) : [];

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const digitos = apenasDigitos(busca);
    const lista = q
      ? clientes.filter(c => {
          const n = nomeDoCliente(c).toLowerCase();
          const doc = apenasDigitos(documentoDoCliente(c));
          const mail = String(c.email ?? '').toLowerCase();
          return n.includes(q) || mail.includes(q) || (digitos.length >= 3 && doc.includes(digitos));
        })
      : clientes;
    // Quem está pronto para nota aparece primeiro: é o que a pessoa quer achar.
    return [...lista].sort((a, b) => {
      const pa = prontoParaNota(a, nomeDoCliente(a)) ? 0 : 1;
      const pb = prontoParaNota(b, nomeDoCliente(b)) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return nomeDoCliente(a).localeCompare(nomeDoCliente(b), 'pt-BR');
    }).slice(0, 40);
  }, [clientes, busca]);

  function escolher(c: Cliente) {
    onChange({
      id: c.id,
      nome: nomeDoCliente(c),
      documento: documentoDoCliente(c),
      prontoParaNota: prontoParaNota(c, nomeDoCliente(c)),
    });
    fecharTudo();
  }

  function abrirNovo() {
    // O que a pessoa já digitou na busca vira o nome: ela não redigita.
    setRascunho({ ...RASCUNHO_VAZIO, nome: busca.trim() || nome || '' });
    setEditandoId(null);
    setModo('novo');
  }

  function abrirEdicao(c: Cliente) {
    setRascunho(rascunhoDe(c));
    setEditandoId(c.id);
    setModo('editar');
  }

  async function buscarCep() {
    const cep = apenasDigitos(rascunho.cep);
    if (cep.length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const j = await r.json();
      if (!j.erro) {
        setRascunho(p => ({
          ...p,
          logradouro: j.logradouro || p.logradouro,
          bairro: j.bairro || p.bairro,
          cidade: j.localidade || p.cidade,
          estado: j.uf || p.estado,
        }));
      }
    } catch {
      // Consulta de CEP é conveniência: falhar não pode travar o cadastro.
    } finally {
      setBuscandoCep(false);
    }
  }

  async function salvar() {
    const nomeFinal = rascunho.nome.trim();
    if (!nomeFinal) { toast.error('Informe o nome do cliente'); return; }
    // Vazio passa; errado não. Um dígito trocado tem o tamanho certo e só é
    // recusado lá na prefeitura, quando não dá mais para consertar rápido.
    if (!documentoValido(rascunho.documento)) {
      toast.error(
        tipoDoDocumento(rascunho.documento) === 'invalido'
          ? 'Esse CPF ou CNPJ não confere. Verifique os dígitos.'
          : 'Documento inválido.',
      );
      return;
    }

    setSalvando(true);
    try {
      const base = editandoId
        ? { ...(clientes.find(c => c.id === editandoId) as Cliente) }
        : createCliente();
      const doc = apenasDigitos(rascunho.documento);
      const pf = rascunho.tipo === 'PF';

      const atualizado: Cliente = {
        ...base,
        tipo: rascunho.tipo,
        nome_completo: pf ? nomeFinal : base.nome_completo,
        razao_social: pf ? base.razao_social : nomeFinal,
        nome_fantasia: pf ? base.nome_fantasia : nomeFinal,
        cpf: pf ? doc : '',
        cnpj: pf ? '' : doc,
        email: rascunho.email.trim(),
        telefone_principal: rascunho.telefone.trim(),
        cep: rascunho.cep.trim(),
        logradouro: rascunho.logradouro.trim(),
        numero: rascunho.numero.trim(),
        complemento: rascunho.complemento.trim(),
        bairro: rascunho.bairro.trim(),
        cidade: rascunho.cidade.trim(),
        estado: rascunho.estado.trim().toUpperCase().slice(0, 2),
      };

      if (editandoId) await updateEntity('clientes', atualizado);
      else await saveEntity('clientes', atualizado);

      setClientes(prev =>
        editandoId ? prev.map(c => (c.id === atualizado.id ? atualizado : c)) : [...prev, atualizado],
      );
      escolher(atualizado);
      toast.success(editandoId ? 'Cadastro atualizado' : 'Cliente cadastrado');
    } catch {
      toast.error(editandoId ? 'Não foi possível salvar o cadastro' : 'Não foi possível cadastrar');
    } finally {
      setSalvando(false);
    }
  }

  const faltamNoRascunho = faltaParaNota(
    { cpf: rascunho.tipo === 'PF' ? rascunho.documento : '', cnpj: rascunho.tipo === 'PJ' ? rascunho.documento : '' },
    rascunho.nome,
  );

  return (
    <div ref={caixa} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        onClick={() => setAberto(v => !v)}
        className={`${CAMPO} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`flex min-w-0 items-center gap-2 ${rotulo ? '' : 'text-[var(--fin-text-3)]'}`}>
          <UserRound className="size-4 shrink-0 text-[var(--fin-text-3)]" aria-hidden />
          <span className="truncate">{rotulo || placeholder}</span>
          {documentoAtual && (
            <span className="fin-t-caption shrink-0 tabular-nums text-[var(--fin-text-3)]">
              {formatarDocumento(documentoAtual)}
            </span>
          )}
        </span>
        <ChevronDown className="size-4 shrink-0 text-[var(--fin-text-3)]" aria-hidden />
      </button>

      {/* O aviso fica FORA do dropdown, visível com ele fechado: é o que
          impede a pessoa de descobrir o problema só na hora de emitir. */}
      {avisarSobreNota && rotulo && faltas.length > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 fin-t-caption text-[var(--fin-warning-text)]">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {selecionado
            ? `Falta ${faltas.join(' e ')} — sem isso a nota fiscal não sai.`
            : 'Este nome não está vinculado a um cadastro, então a nota fiscal não sai.'}
          <button
            type="button"
            onClick={() => { setAberto(true); if (selecionado) abrirEdicao(selecionado); else abrirNovo(); }}
            className="font-semibold text-[var(--fin-accent)] underline underline-offset-2"
          >
            {selecionado ? 'Completar cadastro' : 'Vincular a um cadastro'}
          </button>
        </p>
      )}

      {aberto && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-[26rem] overflow-y-auto rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e2)]">
          {modo === 'lista' ? (
            <>
              <div className="sticky top-0 border-b border-[var(--fin-border)] bg-[var(--fin-surface)] p-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-[var(--fin-text-3)]" aria-hidden />
                  <Input
                    autoFocus
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    placeholder="Nome, CPF, CNPJ ou e-mail"
                    className="h-9 pl-8 text-sm"
                  />
                </div>
              </div>

              {carregando ? (
                <p className="flex items-center gap-2 p-3 fin-t-caption text-[var(--fin-text-3)]">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando clientes…
                </p>
              ) : filtrados.length === 0 ? (
                <p className="p-3 fin-t-caption text-[var(--fin-text-3)]">
                  {busca.trim() ? 'Nenhum cliente com esse termo.' : 'Nenhum cliente cadastrado ainda.'}
                </p>
              ) : (
                <ul>
                  {filtrados.map(c => {
                    const n = nomeDoCliente(c);
                    const doc = documentoDoCliente(c);
                    const pronto = prontoParaNota(c, n);
                    return (
                      <li key={c.id}>
                        <div className="flex items-center gap-1 border-b border-[var(--fin-border)] last:border-0">
                          <button
                            type="button"
                            onClick={() => escolher(c)}
                            className="flex min-h-[44px] min-w-0 flex-1 flex-col items-start justify-center px-3 py-1.5 text-left hover:bg-[var(--fin-surface-2)]"
                          >
                            <span className="flex w-full items-center gap-2">
                              <span className="fin-t-body min-w-0 truncate text-[var(--fin-text)]">{n}</span>
                              {value === c.id && <Check className="size-4 shrink-0 text-[var(--fin-accent)]" aria-hidden />}
                            </span>
                            <span className="fin-t-caption flex flex-wrap items-center gap-x-2 text-[var(--fin-text-3)]">
                              <span className="tabular-nums">{doc ? formatarDocumento(doc) : 'sem CPF/CNPJ'}</span>
                              {c.email ? <span className="truncate">{c.email}</span> : null}
                              {/* Ícone MAIS palavra: cor sozinha não diz nada
                                  a quem não distingue, nem no papel. */}
                              {!pronto && (
                                <span className="inline-flex items-center gap-1 text-[var(--fin-warning-text)]">
                                  <TriangleAlert className="size-3" aria-hidden /> nota fiscal não sai
                                </span>
                              )}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => abrirEdicao(c)}
                            title={`Editar cadastro de ${n}`}
                            aria-label={`Editar cadastro de ${n}`}
                            className="mr-1 flex size-10 shrink-0 items-center justify-center rounded-[var(--fin-r-sm)] text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]"
                          >
                            <Pencil className="size-4" aria-hidden />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <button
                type="button"
                onClick={abrirNovo}
                className="sticky bottom-0 flex min-h-[44px] w-full items-center gap-2 border-t border-[var(--fin-border)] bg-[var(--fin-surface)] px-3 fin-t-body-strong text-[var(--fin-accent)] hover:bg-[var(--fin-surface-2)]"
              >
                <Plus className="size-4" aria-hidden />
                {busca.trim() ? `Cadastrar "${busca.trim()}"` : 'Cadastrar novo cliente'}
              </button>
            </>
          ) : (
            <div className="flex flex-col gap-3 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="fin-t-body-strong text-[var(--fin-text)]">
                  {modo === 'editar' ? 'Editar cadastro' : 'Novo cliente'}
                </p>
                <button
                  type="button"
                  onClick={() => setModo('lista')}
                  className="fin-t-caption text-[var(--fin-text-3)] underline underline-offset-2"
                >
                  voltar à lista
                </button>
              </div>

              <div className="flex gap-2">
                {(['PF', 'PJ'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setRascunho(p => ({ ...p, tipo: t }))}
                    className={`h-9 flex-1 rounded-[var(--fin-r-md)] border fin-t-body ${
                      rascunho.tipo === t
                        ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)] text-[var(--fin-accent)] font-semibold'
                        : 'border-[var(--fin-border)] text-[var(--fin-text-2)]'
                    }`}
                  >
                    {t === 'PF' ? 'Pessoa física' : 'Empresa'}
                  </button>
                ))}
              </div>

              <label className="flex flex-col gap-1">
                <span className="fin-t-caption text-[var(--fin-text-3)]">
                  {rascunho.tipo === 'PF' ? 'Nome completo' : 'Razão social ou nome fantasia'}
                </span>
                <Input
                  autoFocus
                  value={rascunho.nome}
                  onChange={e => setRascunho(p => ({ ...p, nome: e.target.value }))}
                  className="h-10"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="fin-t-caption text-[var(--fin-text-3)]">
                  {rascunho.tipo === 'PF' ? 'CPF' : 'CNPJ'}
                </span>
                <Input
                  inputMode="numeric"
                  value={rascunho.documento}
                  onChange={e => setRascunho(p => ({ ...p, documento: mascararDocumento(e.target.value) }))}
                  placeholder={rascunho.tipo === 'PF' ? '000.000.000-00' : '00.000.000/0000-00'}
                  className="h-10 tabular-nums"
                />
                {/* O motivo do campo, escrito onde ele é preenchido. */}
                <span className="fin-t-caption text-[var(--fin-text-3)]">
                  A prefeitura exige o documento do tomador para emitir a nota.
                </span>
                {tipoDoDocumento(rascunho.documento) === 'invalido' && (
                  <span className="fin-t-caption text-[var(--fin-negative-text)]">
                    Esses dígitos não conferem. Um número errado é recusado na hora de emitir.
                  </span>
                )}
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="fin-t-caption text-[var(--fin-text-3)]">E-mail</span>
                  <Input
                    type="email"
                    value={rascunho.email}
                    onChange={e => setRascunho(p => ({ ...p, email: e.target.value }))}
                    className="h-10"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="fin-t-caption text-[var(--fin-text-3)]">Telefone</span>
                  <Input
                    value={rascunho.telefone}
                    onChange={e => setRascunho(p => ({ ...p, telefone: e.target.value }))}
                    className="h-10"
                  />
                </label>
              </div>

              <details className="rounded-[var(--fin-r-md)] border border-[var(--fin-border)]">
                <summary className="flex min-h-[40px] cursor-pointer items-center px-2 fin-t-caption text-[var(--fin-text-2)]">
                  Endereço (alguns municípios exigem na nota)
                </summary>
                <div className="flex flex-col gap-2 p-2">
                  <div className="grid grid-cols-3 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="fin-t-caption text-[var(--fin-text-3)]">CEP</span>
                      <div className="relative">
                        <Input
                          inputMode="numeric"
                          value={rascunho.cep}
                          onChange={e => setRascunho(p => ({ ...p, cep: mascararCep(e.target.value) }))}
                          onBlur={buscarCep}
                          placeholder="00000-000"
                          className="h-10 tabular-nums"
                        />
                        {buscandoCep && (
                          <Loader2 className="absolute right-2 top-1/2 size-4 -translate-y-1/2 animate-spin text-[var(--fin-text-3)]" aria-hidden />
                        )}
                      </div>
                    </label>
                    <label className="col-span-2 flex flex-col gap-1">
                      <span className="fin-t-caption text-[var(--fin-text-3)]">Logradouro</span>
                      <Input value={rascunho.logradouro} onChange={e => setRascunho(p => ({ ...p, logradouro: e.target.value }))} className="h-10" />
                    </label>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="fin-t-caption text-[var(--fin-text-3)]">Número</span>
                      <Input value={rascunho.numero} onChange={e => setRascunho(p => ({ ...p, numero: e.target.value }))} className="h-10" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="fin-t-caption text-[var(--fin-text-3)]">Complemento</span>
                      <Input value={rascunho.complemento} onChange={e => setRascunho(p => ({ ...p, complemento: e.target.value }))} className="h-10" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="fin-t-caption text-[var(--fin-text-3)]">Bairro</span>
                      <Input value={rascunho.bairro} onChange={e => setRascunho(p => ({ ...p, bairro: e.target.value }))} className="h-10" />
                    </label>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="col-span-2 flex flex-col gap-1">
                      <span className="fin-t-caption text-[var(--fin-text-3)]">Cidade</span>
                      <Input value={rascunho.cidade} onChange={e => setRascunho(p => ({ ...p, cidade: e.target.value }))} className="h-10" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="fin-t-caption text-[var(--fin-text-3)]">UF</span>
                      <Input
                        value={rascunho.estado}
                        onChange={e => setRascunho(p => ({ ...p, estado: e.target.value.toUpperCase().slice(0, 2) }))}
                        maxLength={2}
                        className="h-10 uppercase"
                      />
                    </label>
                  </div>
                </div>
              </details>

              {/* O veredito antes de salvar, não depois de emitir. */}
              <p className={`fin-t-caption ${faltamNoRascunho.length === 0 ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-warning-text)]'}`}>
                {faltamNoRascunho.length === 0
                  ? 'Pronto para emitir nota fiscal.'
                  : `Falta ${faltamNoRascunho.join(' e ')} para a nota fiscal sair. Dá para salvar assim e completar depois.`}
              </p>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModo('lista')}
                  className="h-10 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] px-3 fin-t-body text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={salvar}
                  disabled={salvando}
                  className="inline-flex h-10 items-center gap-2 rounded-[var(--fin-r-md)] bg-[var(--fin-accent)] px-4 fin-t-body-strong text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] disabled:opacity-60"
                >
                  {salvando && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {modo === 'editar' ? 'Salvar e usar' : 'Cadastrar e usar'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ClientePicker;

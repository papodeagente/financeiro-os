'use client';

import * as React from 'react';

import { Field } from '@/components/fin/Field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  camposDaTabela, formatarValorDoCampo, normalizarDefinicoes, valorParaGravar, valorVazio,
  type CampoPersonalizado, type TabelaDoTitulo,
} from '@/lib/campos-personalizados';

/**
 * Campos que a agência criou para as contas (06/11/2026, E7), dentro do
 * lançamento de conta a pagar ou a receber. Carrega as definições sozinho
 * (Configurações › Financeiro › Campos personalizados). Sem campos para esta
 * tabela, não ocupa espaço. Campo desativado só aparece, para leitura, na
 * conta que já tem valor nele.
 */

const CONTROLE = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body lg:h-10';
const GATILHO = `${CONTROLE} justify-between gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0`;
const VAZIO = '__vazio__';

// As definições mudam pouco: uma leitura por página aberta basta.
let cache: Promise<CampoPersonalizado[]> | null = null;
function carregarDefinicoes(): Promise<CampoPersonalizado[]> {
  if (!cache) {
    cache = fetch('/api/config/financeiro/campos-personalizados', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => normalizarDefinicoes(j))
      .catch(e => { cache = null; throw e; });
  }
  return cache;
}

export function CamposPersonalizadosDoTitulo({
  tabela,
  valores,
  onChange,
  desabilitado = false,
}: {
  tabela: TabelaDoTitulo;
  valores: Record<string, unknown>;
  onChange: (valores: Record<string, unknown>) => void;
  desabilitado?: boolean;
}) {
  const [defs, setDefs] = React.useState<CampoPersonalizado[] | null>(null);
  const [erro, setErro] = React.useState(false);
  // Texto e número como a pessoa digita; o valor gravado é convertido.
  const [rascunho, setRascunho] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    let vivo = true;
    carregarDefinicoes().then(d => { if (vivo) setDefs(d); }).catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, []);

  if (erro) {
    return (
      <p role="status" className="fin-t-caption text-[var(--fin-text-3)]">
        Os campos personalizados não carregaram agora. O resto da conta salva normalmente.
      </p>
    );
  }
  if (!defs) return null;

  const visiveis = camposDaTabela(defs, tabela, { incluirInativos: true })
    .filter(d => d.ativo || !valorVazio(valores[d.id]));
  if (visiveis.length === 0) return null;

  const mudar = (def: CampoPersonalizado, entrada: unknown) => {
    const proximo = { ...valores };
    const v = valorParaGravar(def, entrada);
    if (v === null) delete proximo[def.id];
    else proximo[def.id] = v;
    onChange(proximo);
  };

  return (
    <section aria-labelledby="t-campos-da-agencia" className="flex flex-col gap-[var(--fin-s-3)]">
      <div className="flex flex-col gap-[var(--fin-s-1)]">
        <h3 id="t-campos-da-agencia" className="fin-t-body-strong text-[var(--fin-text)]">Campos da agência</h3>
        <p className="fin-t-caption text-[var(--fin-text-3)]">Informações que a sua agência pediu para guardar em cada conta.</p>
      </div>
      <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
        {visiveis.map(def => {
          const valor = valores[def.id];
          const bloqueado = desabilitado || !def.ativo;
          const ajuda = !def.ativo ? 'Campo desativado: só leitura.' : undefined;
          if (def.tipo === 'sim_nao' || def.tipo === 'lista') {
            const opcoes = def.tipo === 'sim_nao'
              ? [{ v: 'sim', r: 'Sim' }, { v: 'nao', r: 'Não' }]
              : [...(def.opcoes ?? []), ...(typeof valor === 'string' && valor && !(def.opcoes ?? []).includes(valor) ? [valor] : [])]
                .map(o => ({ v: o, r: o }));
            const atual = def.tipo === 'sim_nao'
              ? (valor === true ? 'sim' : valor === false ? 'nao' : VAZIO)
              : (typeof valor === 'string' && valor ? valor : VAZIO);
            return (
              <Field key={def.id} rotulo={def.nome} obrigatorio={def.obrigatorio && def.ativo} ajuda={ajuda}>
                {a => (
                  <Select
                    value={atual}
                    onValueChange={v => mudar(def, String(v) === VAZIO ? null : def.tipo === 'sim_nao' ? String(v) === 'sim' : String(v))}
                    disabled={bloqueado}
                  >
                    <SelectTrigger id={a.id} aria-describedby={a['aria-describedby']} aria-invalid={a['aria-invalid']} className={GATILHO}>
                      <SelectValue>{() => (atual === VAZIO ? 'Não informado' : opcoes.find(o => o.v === atual)?.r ?? atual)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={VAZIO} className="fin-t-body">Não informado</SelectItem>
                      {opcoes.map(o => <SelectItem key={o.v} value={o.v} className="fin-t-body">{o.r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            );
          }
          const mostrado = rascunho[def.id] ?? (def.tipo === 'data'
            ? (typeof valor === 'string' ? valor.slice(0, 10) : '')
            : def.tipo === 'numero' ? formatarValorDoCampo(def, valor) : (valor === undefined || valor === null ? '' : String(valor)));
          return (
            <Field key={def.id} rotulo={def.nome} obrigatorio={def.obrigatorio && def.ativo} ajuda={ajuda}>
              {a => (
                <Input
                  {...a}
                  type={def.tipo === 'data' ? 'date' : 'text'}
                  inputMode={def.tipo === 'numero' ? 'decimal' : undefined}
                  maxLength={def.tipo === 'texto' ? 500 : undefined}
                  value={mostrado}
                  disabled={bloqueado}
                  onChange={e => {
                    const t = e.target.value;
                    setRascunho(r => ({ ...r, [def.id]: t }));
                    mudar(def, t);
                  }}
                  onBlur={() => setRascunho(r => { const { [def.id]: _x, ...resto } = r; void _x; return resto; })}
                  className={`${CONTROLE}${def.tipo === 'numero' || def.tipo === 'data' ? ' tabular-nums' : ''}`}
                />
              )}
            </Field>
          );
        })}
      </div>
    </section>
  );
}

export default CamposPersonalizadosDoTitulo;

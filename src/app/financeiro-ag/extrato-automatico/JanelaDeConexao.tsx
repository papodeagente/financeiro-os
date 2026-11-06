'use client';

/**
 * Conectar (ou renovar) uma conta ao banco, passo a passo, numa janela no
 * centro: a conta, o caminho no site do banco, as credenciais e a
 * conferência. Os campos e o passo a passo vêm do adaptador do banco: nada
 * aqui sabe qual banco é.
 *
 * Os arquivos .crt e .key são lidos no navegador e seguem no corpo da
 * requisição, por HTTPS, direto para o cofre. Nunca passam pela rota de
 * upload (pública) e nunca voltam para a tela.
 */

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, FileKey2, FileUp, LoaderCircle, ShieldCheck } from 'lucide-react';

import type { CampoCredencial } from '@/lib/extrato-automatico/contrato';
import { cn, formatBRL } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/fin/Callout';
import { Field } from '@/components/fin/Field';
import { ProgressoDeEtapas } from '@/components/fin/ProgressoDeEtapas';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Segmentado } from '@/components/fin/Segmentado';

import { fraseDaLeitura, lerAgora, type ConexaoBancaria, type ContaLiberada, type ProvedorParaTela, type RespostaDaLeitura } from './useExtratoAutomatico';

type Etapa = 'conta' | 'banco' | 'credenciais' | 'validar';

const ROTULO_ETAPA: Record<Etapa, string> = {
  conta: 'Conta',
  banco: 'No banco',
  credenciais: 'Credenciais',
  validar: 'Conferência',
};

export type ModoDaJanela =
  | { tipo: 'nova'; contaId?: string }
  | { tipo: 'renovar'; conexao: ConexaoBancaria };

type Resultado =
  | { ok: true; id: string; mensagem: string; expiraEm: string | null; saldo: number | null }
  | { ok: false; erro: string };

const fmtDia = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

function chaveDoCorpo(campo: CampoCredencial): { extra: boolean; nome: string } {
  return campo.chave.startsWith('extra:') ? { extra: true, nome: campo.chave.slice(6) } : { extra: false, nome: campo.chave };
}

/** Campo de arquivo: mostra só o nome escolhido, nunca o conteúdo. */
function CampoDeArquivo({
  campo, nome, erro, obrigatorio, onEscolher,
}: {
  campo: CampoCredencial;
  nome: string | null;
  erro: string | null;
  obrigatorio: boolean;
  onEscolher: (arquivo: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Field rotulo={campo.rotulo} obrigatorio={obrigatorio} ajuda={campo.ajuda} erro={erro}>
      {({ id, ...aria }) => (
        <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
          <input
            ref={ref}
            id={id}
            type="file"
            accept={(campo.aceita ?? []).join(',')}
            className="sr-only"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) onEscolher(f);
              e.target.value = '';
            }}
            {...aria}
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-[var(--fin-s-1)] lg:h-10"
            onClick={() => ref.current?.click()}
          >
            <FileUp aria-hidden="true" className="size-4" />
            {nome ? 'Trocar arquivo' : 'Escolher arquivo'}
          </Button>
          {nome ? (
            <span className="fin-t-body inline-flex min-w-0 items-center gap-[var(--fin-s-1)] text-[var(--fin-text)]">
              <FileKey2 aria-hidden="true" className="size-4 shrink-0 text-[var(--fin-positive)]" />
              <span className="truncate">{nome}</span>
            </span>
          ) : (
            <span className="fin-t-caption text-[var(--fin-text-3)]">Nenhum arquivo escolhido</span>
          )}
        </div>
      )}
    </Field>
  );
}

export function JanelaDeConexao({
  aberto, modo, contasSemConexao, provedores, onFechar, onMudou,
}: {
  aberto: boolean;
  modo: ModoDaJanela;
  contasSemConexao: ContaLiberada[];
  provedores: ProvedorParaTela[];
  onFechar: () => void;
  /** Algo mudou no servidor (conectou, leu): a tela recarrega. */
  onMudou: () => void;
}) {
  const renovar = modo.tipo === 'renovar';
  const etapas: Etapa[] = renovar ? ['banco', 'credenciais', 'validar'] : ['conta', 'banco', 'credenciais', 'validar'];
  // A janela nasce a cada abertura (a página a monta com uma chave nova):
  // credencial digitada nunca fica guardada na tela entre uma vez e outra.
  const [indice, setIndice] = useState(0);
  const [contaId, setContaId] = useState(() => (modo.tipo === 'renovar' ? modo.conexao.conta_bancaria_id : (modo.contaId ?? contasSemConexao[0]?.id ?? '')));
  const [provedorId, setProvedorId] = useState(() => (modo.tipo === 'renovar' ? modo.conexao.provedor : (provedores[0]?.id ?? '')));
  const [valores, setValores] = useState<Record<string, string>>({});
  const [arquivos, setArquivos] = useState<Record<string, string>>({});
  const [errosCampo, setErrosCampo] = useState<Record<string, string>>({});
  const [vezes, setVezes] = useState<'1' | '2' | '4'>(() => {
    if (modo.tipo !== 'renovar') return '1';
    const v = modo.conexao.vezes_por_dia;
    return v >= 4 ? '4' : v >= 2 ? '2' : '1';
  });
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [lendo, setLendo] = useState(false);
  const [leitura, setLeitura] = useState<RespostaDaLeitura | null>(null);

  const provedor = provedores.find(p => p.id === provedorId) ?? provedores[0];
  const etapa = etapas[Math.min(indice, etapas.length - 1)];
  const conta = contasSemConexao.find(c => c.id === contaId)
    ?? (modo.tipo === 'renovar' ? { id: modo.conexao.conta_bancaria_id, nome: modo.conexao.conta_nome, moeda: 'BRL' } : null);
  const campos = useMemo(() => provedor?.campos ?? [], [provedor]);
  // Na renovação o banco mantém as credenciais de texto: só os arquivos são obrigatórios.
  const obrigatorio = (c: CampoCredencial) => c.obrigatorio && (!renovar || c.tipo === 'arquivo_pem');
  const sujo = !resultado?.ok && (Object.values(valores).some(Boolean) || Object.keys(arquivos).length > 0);

  async function escolherArquivo(campo: CampoCredencial, arquivo: File) {
    const nome = arquivo.name;
    if (/\.zip$/i.test(nome)) {
      setErrosCampo(e => ({ ...e, [campo.chave]: 'Este é o arquivo compactado. Descompacte e escolha o arquivo de dentro dele.' }));
      return;
    }
    if (arquivo.size > 64_000) {
      setErrosCampo(e => ({ ...e, [campo.chave]: 'Arquivo grande demais para ser um certificado ou uma chave. Confira se escolheu o arquivo certo.' }));
      return;
    }
    const texto = await arquivo.text();
    setValores(v => ({ ...v, [campo.chave]: texto }));
    setArquivos(a => ({ ...a, [campo.chave]: nome }));
    setErrosCampo(e => Object.fromEntries(Object.entries(e).filter(([k]) => k !== campo.chave)));
  }

  function conferirCampos(): boolean {
    const erros: Record<string, string> = {};
    for (const c of campos) {
      if (obrigatorio(c) && !(valores[c.chave] ?? '').trim()) {
        erros[c.chave] = c.tipo === 'arquivo_pem' ? 'Escolha o arquivo.' : 'Preencha este campo.';
      }
    }
    setErrosCampo(erros);
    return Object.keys(erros).length === 0;
  }

  async function validarEConectar() {
    if (!provedor || !contaId) return;
    setEnviando(true);
    setResultado(null);
    const credencial: { extras: Record<string, string>; [k: string]: unknown } = { extras: {} };
    for (const c of campos) {
      const v = (valores[c.chave] ?? '').trim();
      if (!v) continue;
      const { extra, nome } = chaveDoCorpo(c);
      if (extra) credencial.extras[nome] = v;
      else credencial[nome] = v;
    }
    try {
      const r = await fetch('/api/extrato-automatico', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conta_bancaria_id: contaId, provedor: provedor.id, vezes_por_dia: Number(vezes), credencial }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setResultado({ ok: false, erro: j?.error ?? 'Não foi possível conectar agora.' });
        return;
      }
      setResultado({ ok: true, id: String(j.id), mensagem: String(j.mensagem), expiraEm: j.expira_em ?? null, saldo: typeof j.saldo_no_banco === 'number' ? j.saldo_no_banco : null });
      // Credencial validada e guardada: a tela não segura mais nada.
      setValores({});
      onMudou();
    } catch {
      setResultado({ ok: false, erro: 'Sem resposta do servidor. Confira a internet e tente de novo.' });
    } finally {
      setEnviando(false);
    }
  }

  async function trazerExtrato() {
    if (!resultado?.ok) return;
    setLendo(true);
    try {
      const r = await lerAgora(resultado.id);
      setLeitura(r.corpo);
      onMudou();
    } catch {
      setLeitura({ resultado: 'falhou', sincronizacao_id: null, motivo: 'DESCONHECIDO', mensagem: 'Sem resposta do servidor. A leitura sai sozinha na próxima hora.', status: 'ATIVA' });
    } finally {
      setLendo(false);
    }
  }

  function avancar() {
    if (etapa === 'conta' && !contaId) return;
    if (etapa === 'credenciais' && !conferirCampos()) return;
    setIndice(i => Math.min(i + 1, etapas.length - 1));
  }

  // ── Ações do rodapé, por etapa ─────────────────────────────────────────
  let primaria: { rotulo: string; onClick: () => void | Promise<void>; carregando?: boolean; desabilitado?: boolean };
  if (etapa === 'validar') {
    if (resultado?.ok) {
      primaria = leitura
        ? { rotulo: 'Concluir', onClick: onFechar }
        : { rotulo: lendo ? 'Lendo o extrato' : 'Trazer o extrato agora', onClick: trazerExtrato, carregando: lendo };
    } else if (resultado && !resultado.ok) {
      primaria = { rotulo: 'Voltar e corrigir', onClick: () => { setResultado(null); setIndice(etapas.indexOf('credenciais')); } };
    } else {
      primaria = { rotulo: enviando ? 'Conferindo com o banco' : renovar ? 'Conferir e renovar' : 'Conferir e conectar', onClick: validarEConectar, carregando: enviando, desabilitado: !conta };
    }
  } else {
    primaria = { rotulo: 'Continuar', onClick: avancar, desabilitado: etapa === 'conta' && !contaId };
  }
  const secundaria = resultado?.ok
    ? null
    : indice > 0 && !enviando
      ? { rotulo: 'Voltar', onClick: () => { setResultado(null); setIndice(i => Math.max(0, i - 1)); } }
      : undefined;

  const passos = renovar ? (provedor?.apresentacao.passosRenovacao ?? []) : (provedor?.apresentacao.passos ?? []);
  const nomeDoBanco = provedor?.apresentacao.nome ?? 'banco';

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={renovar ? `Renovar a conexão da ${conta?.nome ?? 'conta'}` : 'Conectar uma conta ao banco'}
      descricao={renovar
        ? 'Envie o certificado e a chave novos. O histórico do extrato e da conciliação continua o mesmo.'
        : 'O Financeiro passa a ler o extrato sozinho, todo dia, direto do banco da agência.'}
      largura={640}
      sujo={sujo}
      acaoPrimaria={primaria}
      acaoSecundaria={secundaria}
    >
      <div className="flex flex-col gap-[var(--fin-s-5)]">
        <ProgressoDeEtapas etapas={etapas.map(e => ROTULO_ETAPA[e])} atual={indice} />

        {etapa === 'conta' && (
          <section className="flex flex-col gap-[var(--fin-s-3)]" aria-label="Escolha a conta">
            <h3 className="fin-t-subhead text-[var(--fin-text)]">Qual conta vai ler o extrato sozinha?</h3>
            {contasSemConexao.length === 0 ? (
              <Callout tom="info" titulo="Todas as contas já estão conectadas">
                Para ligar outra, cadastre a conta em Contas bancárias e volte aqui.
              </Callout>
            ) : (
              <div role="radiogroup" aria-label="Conta bancária" className="flex flex-col gap-[var(--fin-s-2)]">
                {contasSemConexao.map(c => {
                  const marcada = c.id === contaId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={marcada}
                      onClick={() => setContaId(c.id)}
                      className={cn(
                        'flex min-h-11 items-center justify-between gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border px-[var(--fin-s-3)] py-[var(--fin-s-2)] text-left',
                        'transition-[background-color,border-color] duration-[var(--fin-dur-rapida)]',
                        marcada
                          ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]'
                          : 'border-[var(--fin-border-strong)] bg-[var(--fin-surface)] hover:bg-[var(--fin-surface-2)]',
                      )}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="fin-t-body-strong truncate text-[var(--fin-text)]">{c.nome}</span>
                        {c.moeda !== 'BRL' ? <span className="fin-t-caption text-[var(--fin-text-3)]">Conta em {c.moeda}</span> : null}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'grid size-5 shrink-0 place-items-center rounded-full border',
                          marcada ? 'border-[var(--fin-accent)] bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)]' : 'border-[var(--fin-border-strong)]',
                        )}
                      >
                        {marcada ? <Check className="size-3" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {provedores.length > 1 ? (
              <Segmentado
                rotulo="Banco"
                opcoes={provedores.map(p => ({ valor: p.id, rotulo: p.apresentacao.nome }))}
                valor={provedorId}
                onChange={setProvedorId}
              />
            ) : (
              <p className="fin-t-caption text-[var(--fin-text-2)]">
                Leitura automática disponível para: <span className="fin-t-body-strong text-[var(--fin-text)]">{nomeDoBanco}</span>. Para outros bancos, o extrato continua entrando por arquivo na conciliação.
              </p>
            )}
          </section>
        )}

        {etapa === 'banco' && (
          <section className="flex flex-col gap-[var(--fin-s-4)]" aria-label={`No site do ${nomeDoBanco}`}>
            <div className="flex flex-col gap-[var(--fin-s-1)]">
              <h3 className="fin-t-subhead text-[var(--fin-text)]">
                {renovar ? `Renove no ${nomeDoBanco}` : `Crie a integração no ${nomeDoBanco}`}
              </h3>
              <p className="fin-t-caption text-[var(--fin-text-2)]">
                {renovar
                  ? 'Leva uns minutos. Deixe esta janela aberta e volte quando tiver os arquivos.'
                  : 'É de graça e feito pela própria empresa, sem falar com gerente. Deixe esta janela aberta e siga os passos.'}
              </p>
            </div>
            <ol className="flex flex-col gap-[var(--fin-s-3)]">
              {passos.map((p, i) => (
                <li key={p.titulo} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-[var(--fin-s-3)]">
                  <span aria-hidden="true" className="fin-t-caption grid size-6 place-items-center rounded-full bg-[var(--fin-surface-2)] font-semibold tabular-nums text-[var(--fin-text-2)]">
                    {i + 1}
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="fin-t-body-strong text-[var(--fin-text)]">{p.titulo}</span>
                    <span className="fin-t-body text-[var(--fin-text-2)]">{p.texto}</span>
                  </span>
                </li>
              ))}
            </ol>
            {!renovar && provedor?.apresentacao.alerta ? (
              <Callout tom="aviso" titulo="Só a permissão de consulta">
                {provedor.apresentacao.alerta}
              </Callout>
            ) : null}
          </section>
        )}

        {etapa === 'credenciais' && (
          <section className="flex flex-col gap-[var(--fin-s-4)]" aria-label="Credenciais da integração">
            <div className="flex flex-col gap-[var(--fin-s-1)]">
              <h3 className="fin-t-subhead text-[var(--fin-text)]">{renovar ? 'Os arquivos novos' : 'O que o banco entregou'}</h3>
              <p className="fin-t-caption text-[var(--fin-text-2)]">
                {renovar
                  ? 'O ClientId e o ClientSecret ficam como estão. Só preencha se o banco trocou.'
                  : 'Copie e cole o ClientId e o ClientSecret, e escolha os dois arquivos que vieram no ZIP.'}
              </p>
            </div>
            {campos.map(c => (
              c.tipo === 'arquivo_pem' ? (
                <CampoDeArquivo
                  key={c.chave}
                  campo={c}
                  nome={arquivos[c.chave] ?? null}
                  erro={errosCampo[c.chave] ?? null}
                  obrigatorio={obrigatorio(c)}
                  onEscolher={f => void escolherArquivo(c, f)}
                />
              ) : (
                <Field key={c.chave} rotulo={c.rotulo} obrigatorio={obrigatorio(c)} ajuda={renovar && c.obrigatorio ? 'Em branco, fica o que está guardado.' : c.ajuda} erro={errosCampo[c.chave] ?? null}>
                  {aria => (
                    <Input
                      {...aria}
                      type={c.tipo === 'segredo' ? 'password' : 'text'}
                      autoComplete="off"
                      spellCheck={false}
                      value={valores[c.chave] ?? ''}
                      onChange={e => setValores(v => ({ ...v, [c.chave]: e.target.value }))}
                    />
                  )}
                </Field>
              )
            ))}
            <div className="flex flex-col gap-[var(--fin-s-2)]">
              <span className="fin-t-body-strong text-[var(--fin-text)]">Quantas vezes por dia ler o extrato</span>
              <Segmentado
                rotulo="Leituras por dia"
                opcoes={[{ valor: '1', rotulo: '1 vez' }, { valor: '2', rotulo: '2 vezes' }, { valor: '4', rotulo: '4 vezes' }]}
                valor={vezes}
                onChange={setVezes}
              />
              <span className="fin-t-caption text-[var(--fin-text-3)]">Na conciliação dá para pedir uma leitura na hora, sempre que precisar.</span>
            </div>
            <p className="fin-t-caption flex items-start gap-[var(--fin-s-2)] text-[var(--fin-text-2)]">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-positive)]" />
              O ClientSecret, o certificado e a chave são guardados cifrados e nunca aparecem de novo, nem para você.
            </p>
          </section>
        )}

        {etapa === 'validar' && (
          <section className="flex flex-col gap-[var(--fin-s-4)]" aria-label="Conferência" aria-live="polite">
            {!resultado && (
              <>
                <h3 className="fin-t-subhead text-[var(--fin-text)]">Pronto para conferir</h3>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-[var(--fin-s-4)] gap-y-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-3)]">
                  <dt className="fin-t-caption text-[var(--fin-text-3)]">Conta</dt>
                  <dd className="fin-t-body-strong text-[var(--fin-text)]">{conta?.nome ?? '-'}</dd>
                  <dt className="fin-t-caption text-[var(--fin-text-3)]">Banco</dt>
                  <dd className="fin-t-body text-[var(--fin-text)]">{nomeDoBanco}</dd>
                  <dt className="fin-t-caption text-[var(--fin-text-3)]">Leituras</dt>
                  <dd className="fin-t-body text-[var(--fin-text)]">{vezes === '1' ? '1 vez por dia' : `${vezes} vezes por dia`}</dd>
                </dl>
                <p className="fin-t-body text-[var(--fin-text-2)]">
                  {enviando
                    ? 'Conferindo os arquivos e fazendo uma consulta de teste no banco. Leva alguns segundos.'
                    : 'Ao conferir, o Financeiro olha os arquivos e faz uma consulta de teste no banco. Só grava se o banco aceitar.'}
                </p>
                {enviando ? (
                  <span className="fin-t-caption inline-flex items-center gap-[var(--fin-s-2)] text-[var(--fin-text-3)]">
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    Falando com o {nomeDoBanco}
                  </span>
                ) : null}
              </>
            )}

            {resultado && !resultado.ok && (
              <Callout tom="negativo" titulo={renovar ? 'A renovação não foi aceita' : 'A conexão não foi aceita'}>
                {resultado.erro} Nada foi gravado.
              </Callout>
            )}

            {resultado?.ok && (
              <>
                <Callout tom="positivo" titulo={resultado.mensagem}>
                  {[
                    resultado.expiraEm ? `O certificado vale até ${fmtDia(resultado.expiraEm)}; avisamos 30 dias antes.` : null,
                    resultado.saldo !== null ? `Saldo no banco agora: ${formatBRL(resultado.saldo)}.` : null,
                  ].filter(Boolean).join(' ')}
                </Callout>
                {leitura ? (() => {
                  const f = fraseDaLeitura(leitura);
                  return (
                    <Callout tom={f.tom === 'erro' ? 'negativo' : f.tom === 'sucesso' ? 'positivo' : 'info'} titulo={f.titulo}>
                      {f.detalhe}{' '}
                      {f.tom !== 'erro' ? (
                        <Link href="/financeiro-ag/conciliacao" className="font-medium text-[var(--fin-accent)] underline underline-offset-2">
                          Abrir a conciliação
                        </Link>
                      ) : null}
                    </Callout>
                  );
                })() : (
                  <p className="fin-t-body text-[var(--fin-text-2)]">
                    {renovar
                      ? 'As próximas leituras já usam o certificado novo.'
                      : 'A primeira leitura traz os últimos 90 dias e sai sozinha em instantes. Se preferir, traga agora e confira na conciliação.'}
                  </p>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </RecordSheet>
  );
}

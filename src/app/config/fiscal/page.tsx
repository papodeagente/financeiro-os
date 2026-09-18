'use client';

/**
 * Nota fiscal: o caminho curto, em três etapas.
 *
 * A tela antiga (agora em /config/fiscal/avancado) mostrava todos os campos da
 * configuração ao mesmo tempo e pedia que fossem apertados na ordem certa.
 * Quem chegava não sabia por onde começar, e errar a ordem produzia erro no
 * campo errado.
 *
 * Aqui o certificado é a porta de entrada: dele saem CNPJ, razão social e
 * validade; do CNPJ sai o resto (empresa no emissor, cidade, atividade,
 * Simples). O usuário entrega um arquivo e uma senha, confere o que foi
 * descoberto e ativa.
 *
 * O ESTADO VEM DO QUE ESTÁ GRAVADO, não de um passo a passo em memória: um F5
 * no meio não perde nada, e reabrir a tela mostra onde a configuração parou.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, Lock, ShieldCheck, Upload } from 'lucide-react';

import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { Callout } from '@/components/fin/Callout';
import { ChecklistViva, type ItemDaChecklist } from '@/components/fin/ChecklistViva';
import { ListaDeFatos, type Fato } from '@/components/fin/ListaDeFatos';
import { ProgressoDeEtapas } from '@/components/fin/ProgressoDeEtapas';
import { Comemoracao } from '@/components/fin/Comemoracao';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/toast';
import { hojeISO } from '@/lib/money';
import { cn } from '@/lib/utils';
import { BuscaComLista, type OpcaoBusca } from './Busca';
import { servicoDoCodigo } from '@/lib/lc116-servicos';
import type { ConfigFiscal } from '@/lib/nfse-tipos';

interface Emitente {
  cnpj: string;
  razao_social: string;
  inscricao_municipal: string;
}

interface Passo {
  nome: string;
  ok: boolean;
  detalhe: string;
}

interface Pendencias {
  pronto: boolean;
  itens: string[];
}

interface Municipio {
  emite: boolean;
  detalhe: string;
  convenio: string;
}

const CARTAO =
  'flex flex-col gap-4 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-4 lg:p-5';

function dataBR(iso: string): string {
  const t = String(iso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return '';
  return t.split('-').reverse().join('/');
}

function cnpjFormatado(v: string): string {
  const d = String(v ?? '').replace(/\D+/g, '');
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Dias até o certificado vencer. Negativo quando já venceu. */
function diasAte(iso: string): number | null {
  const t = String(iso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [a, m, d] = t.split('-').map(Number);
  const [ha, hm, hd] = hojeISO().split('-').map(Number);
  return Math.round(
    (Date.UTC(a, m - 1, d) - Date.UTC(ha, hm - 1, hd)) / 86_400_000,
  );
}

export default function NotaFiscalPage() {
  const [config, setConfig] = useState<ConfigFiscal | null>(null);
  const [emitente, setEmitente] = useState<Emitente | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState('');

  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const [trabalhando, setTrabalhando] = useState(false);
  const [passos, setPassos] = useState<Passo[]>([]);
  const [pendencias, setPendencias] = useState<Pendencias | null>(null);
  const [municipio, setMunicipio] = useState<Municipio | null>(null);
  const [erro, setErro] = useState('');
  const [ativou, setAtivou] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/fiscal/config');
      const corpo = await res.json();
      if (!res.ok) { setErroCarga(corpo?.error || 'Não foi possível carregar.'); return; }
      setConfig(corpo.config as ConfigFiscal);
      setEmitente(corpo.emitente as Emitente);
      setErroCarga('');
    } catch {
      setErroCarga('Não foi possível carregar.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const cert = config?.certificado ?? null;
  const diasDoCert = cert ? diasAte(cert.validade_fim) : null;
  const certVencido = diasDoCert !== null && diasDoCert < 0;
  const temCertificado = Boolean(cert?.referencia_gateway) && !certVencido;

  // A etapa sai do que está gravado, nunca de um contador em memória: F5 no
  // meio da configuração não devolve a pessoa para o começo.
  const etapa: 'enviar' | 'conferir' | 'pronto' = useMemo(() => {
    if (!temCertificado) return 'enviar';
    if (pendencias?.pronto) return 'pronto';
    const faltaMunicipio = String(config?.cod_municipio_ibge ?? '').replace(/\D+/g, '').length !== 7;
    const faltaServico = !String(config?.cod_tributacao_nacional ?? '').trim();
    const faltaRegime = Number(config?.simples_nacional ?? 0) >= 2
      && !['1', '2', '3'].includes(String(config?.regime_apuracao ?? ''));
    if (faltaMunicipio || faltaServico || faltaRegime) return 'conferir';
    return pendencias === null ? 'conferir' : 'pronto';
  }, [temCertificado, pendencias, config]);

  const indiceEtapa = etapa === 'enviar' ? 0 : etapa === 'conferir' ? 1 : 2;

  function alterar<K extends keyof ConfigFiscal>(campo: K, valor: ConfigFiscal[K]) {
    setConfig(c => (c ? { ...c, [campo]: valor } : c));
  }

  /** Envia o certificado e, se der certo, encadeia a configuração. */
  async function enviarEConfigurar() {
    if (trabalhando) return;
    if (!arquivo) { setErro('Escolha o arquivo do certificado.'); return; }
    if (!senha) { setErro('Informe a senha do certificado.'); return; }
    setErro('');
    setTrabalhando(true);
    setPassos([
      { nome: 'Lendo o certificado', ok: false, detalhe: '' },
      { nome: 'Cadastrando a agência no emissor', ok: false, detalhe: '' },
      { nome: 'Enviando o certificado', ok: false, detalhe: '' },
    ]);
    try {
      const form = new FormData();
      form.append('arquivo', arquivo);
      form.append('senha', senha);
      const res = await fetch('/api/fiscal/certificado', { method: 'POST', body: form });
      const corpo = await res.json();
      if (!res.ok) {
        setErro(corpo?.error || 'O certificado não foi aceito.');
        setPassos([]);
        return;
      }
      setConfig(corpo.config as ConfigFiscal);
      const lido = corpo.certificado as { razao_social?: string; cnpj?: string; validade_fim?: string } | undefined;
      setPassos([
        {
          nome: 'Lendo o certificado',
          ok: true,
          detalhe: lido
            ? `${lido.razao_social} · ${cnpjFormatado(lido.cnpj ?? '')} · válido até ${dataBR(lido.validade_fim ?? '')}`
            : '',
        },
        { nome: 'Cadastrando a agência no emissor', ok: true, detalhe: corpo.empresa_id ? `Empresa #${corpo.empresa_id}` : '' },
        { nome: 'Enviando o certificado', ok: true, detalhe: 'Aceito pelo emissor.' },
      ]);
      // A senha some da memória assim que deixa de ser necessária.
      setSenha('');
      setArquivo(null);
      if (arquivoRef.current) arquivoRef.current.value = '';
      await configurar();
    } catch {
      setErro('Não foi possível enviar o certificado agora.');
      setPassos([]);
    } finally {
      setTrabalhando(false);
    }
  }

  /** Busca na Receita, deduz o serviço e sincroniza com o emissor. */
  async function configurar() {
    setTrabalhando(true);
    setPassos(p => [
      ...p,
      { nome: 'Buscando os dados na Receita', ok: false, detalhe: '' },
      { nome: 'Conferindo se a cidade emite', ok: false, detalhe: '' },
      { nome: 'Cadastrando o prestador', ok: false, detalhe: '' },
    ]);
    try {
      const res = await fetch('/api/fiscal/configurar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config ?? {}),
      });
      const corpo = await res.json();
      if (Array.isArray(corpo.passos)) {
        setPassos(anteriores => [
          ...anteriores.filter(p => p.ok),
          ...(corpo.passos as Passo[]),
        ]);
      }
      if (!res.ok) { setErro(corpo?.error || 'Não foi possível configurar.'); return; }
      if (corpo.config) setConfig(corpo.config as ConfigFiscal);
      if (corpo.pendencias) setPendencias(corpo.pendencias as Pendencias);
      if (corpo.municipio) setMunicipio(corpo.municipio as Municipio);
      if (corpo.pendencias?.pronto) setAtivou(true);
      void carregar();
    } catch {
      setErro('Não foi possível configurar agora.');
    } finally {
      setTrabalhando(false);
    }
  }

  /** Reenvia a configuração conferida e ativa a emissão. */
  async function ativar() {
    if (trabalhando || !config) return;
    setTrabalhando(true);
    setErro('');
    try {
      const res = await fetch('/api/fiscal/prestador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const corpo = await res.json();
      if (!res.ok) { setErro(corpo?.error || 'O emissor não aceitou a configuração.'); return; }
      if (corpo.config) setConfig(corpo.config as ConfigFiscal);
      setPendencias(corpo as Pendencias);
      if (corpo.pronto) {
        setAtivou(true);
        toast.success('Nota fiscal ativada', 'A agência já pode emitir.');
      }
    } finally {
      setTrabalhando(false);
    }
  }

  const buscarMunicipios = useCallback(async (termo: string): Promise<OpcaoBusca[]> => {
    const res = await fetch(`/api/fiscal/municipios?busca=${encodeURIComponent(termo)}`);
    const corpo = await res.json();
    return ((corpo.municipios ?? []) as Array<{ ibge: string; nome: string; uf: string }>).map(m => ({
      valor: m.ibge,
      titulo: `${m.nome} / ${m.uf}`,
      detalhe: `Código IBGE ${m.ibge}`,
    }));
  }, []);

  const buscarServicos = useCallback(async (termo: string): Promise<OpcaoBusca[]> => {
    const res = await fetch(`/api/fiscal/servicos?busca=${encodeURIComponent(termo)}`);
    const corpo = await res.json();
    return ((corpo.servicos ?? []) as Array<{ codigo: string; item: string; titulo: string }>).map(sv => ({
      valor: sv.codigo,
      titulo: sv.titulo,
      detalhe: `Item ${sv.item} da LC 116`,
    }));
  }, []);

  const itensChecklist: ItemDaChecklist[] = passos.map((p, i) => ({
    chave: `${p.nome}-${i}`,
    titulo: p.nome,
    estado: p.ok ? 'feito' : p.detalhe ? 'falhou' : trabalhando ? 'fazendo' : 'aguardando',
    detalhe: p.detalhe,
  }));

  const servicoEscolhido = servicoDoCodigo(config?.cod_tributacao_nacional ?? '');

  return (
    <PageShell width="full" padding="md" gap="md" className="max-w-[760px]">
      <PageHeader
        titulo="Nota fiscal"
        subtitulo="Envie o certificado digital e a agência fica pronta para emitir."
        acoesSecundarias={[{ rotulo: 'Ajuste manual', href: '/config/fiscal/avancado' }]}
      />

      <DataState
        estado={carregando ? 'carregando' : erroCarga ? 'erro' : 'ok'}
        erro={{ mensagem: erroCarga, onTentarDeNovo: () => { void carregar(); } }}
        esqueleto={<div className="fin-t-body text-[var(--fin-text-3)]">Carregando…</div>}
      >
        {config ? (
          <div className="flex flex-col gap-4">
            <ProgressoDeEtapas etapas={['Enviar', 'Conferir', 'Pronto']} atual={indiceEtapa} />

            {erro ? <Callout tom="negativo" titulo="Não deu certo">{erro}</Callout> : null}

            {certVencido ? (
              <Callout tom="negativo" titulo="O certificado venceu">
                Venceu em {dataBR(cert?.validade_fim ?? '')}. Peça um novo à sua certificadora e
                envie aqui — a agência continua cadastrada no emissor.
              </Callout>
            ) : null}

            {/* ---------- ETAPA 1: ENVIAR ---------- */}
            {etapa === 'enviar' ? (
              <section className={CARTAO}>
                <div className="flex flex-col gap-1">
                  <h2 className="fin-t-subhead text-[var(--fin-text)]">
                    Envie o certificado digital da agência
                  </h2>
                  <p className="fin-t-caption text-[var(--fin-text-3)]">
                    É o arquivo .pfx (ou .p12) que a certificadora entregou, mais a senha dele.
                    Dele saem o CNPJ e o nome da empresa: você não digita nada disso.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="arquivo-cert">Arquivo do certificado</Label>
                  <label
                    htmlFor="arquivo-cert"
                    className="flex min-h-[104px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--fin-r-md)] border border-dashed border-[var(--fin-border-strong)] p-4 text-center hover:bg-[var(--fin-surface-2)]"
                  >
                    <Upload aria-hidden="true" className="size-6 text-[var(--fin-text-3)]" />
                    <span className="fin-t-body text-[var(--fin-text)]">
                      {arquivo ? arquivo.name : 'Toque para escolher o arquivo'}
                    </span>
                    <span className="fin-t-caption text-[var(--fin-text-3)]">
                      .pfx ou .p12, até 2 MB
                    </span>
                  </label>
                  <input
                    id="arquivo-cert"
                    ref={arquivoRef}
                    type="file"
                    accept=".pfx,.p12"
                    className="sr-only"
                    onChange={e => setArquivo(e.target.files?.[0] ?? null)}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="senha-cert">Senha do certificado</Label>
                  <div className="flex gap-2">
                    <Input
                      id="senha-cert"
                      type={mostrarSenha ? 'text' : 'password'}
                      autoComplete="off"
                      className="text-base"
                      value={senha}
                      onChange={e => setSenha(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setMostrarSenha(v => !v)}
                    >
                      {mostrarSenha ? 'Ocultar' : 'Mostrar'}
                    </Button>
                  </div>
                  <span className="fin-t-caption text-[var(--fin-text-3)]">
                    A mesma usada para instalar o certificado no computador.
                  </span>
                </div>

                <p className="fin-t-caption flex items-start gap-2 text-[var(--fin-text-3)]">
                  <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  O arquivo e a senha não ficam guardados no Entur OS: vão direto para o emissor
                  da nota, que é quem assina.
                </p>

                <Button
                  type="button"
                  className="h-12 w-full lg:h-11 lg:w-auto lg:self-start"
                  onClick={() => { void enviarEConfigurar(); }}
                  disabled={trabalhando}
                >
                  {trabalhando ? 'Configurando…' : 'Enviar e configurar'}
                </Button>
              </section>
            ) : null}

            {/* ---------- O QUE ESTÁ ACONTECENDO ---------- */}
            {itensChecklist.length > 0 ? (
              <section className={CARTAO}>
                <h2 className="fin-t-subhead text-[var(--fin-text)]">O que o sistema fez</h2>
                <ChecklistViva itens={itensChecklist} />
              </section>
            ) : null}

            {/* ---------- ETAPA 2: CONFERIR ---------- */}
            {etapa === 'conferir' && cert ? (
              <>
                <section className={CARTAO}>
                  <div className="flex flex-col gap-1">
                    <h2 className="fin-t-subhead text-[var(--fin-text)]">
                      Confira se é a sua empresa
                    </h2>
                    <p className="fin-t-caption text-[var(--fin-text-3)]">
                      Tudo abaixo veio do certificado e da Receita. Corrija o que estiver
                      diferente antes de ativar.
                    </p>
                  </div>

                  <ListaDeFatos
                    itens={[
                      {
                        rotulo: 'Empresa',
                        valor: cert.titular || emitente?.razao_social || '—',
                        fonte: 'certificado',
                      },
                      { rotulo: 'CNPJ', valor: cnpjFormatado(cert.cnpj), fonte: 'certificado' },
                      ...(cert.responsavel_nome
                        ? [{
                            rotulo: 'Responsável',
                            valor: cert.responsavel_nome,
                            fonte: 'certificado' as const,
                          }]
                        : []),
                      {
                        rotulo: 'Certificado',
                        valor: `Válido até ${dataBR(cert.validade_fim)}`,
                        fonte: 'certificado',
                        chip:
                          diasDoCert !== null && diasDoCert <= 30
                            ? { texto: `vence em ${diasDoCert} dias`, tom: 'aviso' }
                            : { texto: 'válido', tom: 'positivo' },
                      },
                      {
                        rotulo: 'Cidade',
                        valor: municipio?.detalhe || config.cod_municipio_ibge || 'Não descoberta',
                        fonte: 'receita',
                      },
                      {
                        rotulo: 'Serviço na nota',
                        valor: servicoEscolhido
                          ? `${servicoEscolhido.titulo} (item ${servicoEscolhido.item})`
                          : 'Escolha abaixo',
                        fonte: servicoEscolhido ? 'proposto' : undefined,
                      },
                      {
                        rotulo: 'Simples Nacional',
                        valor:
                          config.simples_nacional === 2
                            ? 'MEI'
                            : config.simples_nacional === 3
                              ? 'ME / EPP'
                              : 'Não optante',
                        fonte: 'receita',
                      },
                    ] as Fato[]}
                  />
                </section>

                {municipio && !municipio.emite ? (
                  <Callout tom="aviso" titulo="Esta cidade ainda não emite pelo sistema nacional">
                    A prefeitura de {municipio.detalhe} mantém sistema próprio. Por enquanto a
                    nota não sai por aqui.
                  </Callout>
                ) : null}

                <section className={CARTAO}>
                  <h2 className="fin-t-subhead text-[var(--fin-text)]">O que falta responder</h2>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="servico">O que a agência presta?</Label>
                    <BuscaComLista
                      id="servico"
                      valor={config.cod_tributacao_nacional}
                      onValor={v => alterar('cod_tributacao_nacional', v)}
                      onBuscar={buscarServicos}
                      placeholder="Escolha o serviço"
                      placeholderBusca="Procurar pelo que a agência faz"
                      minimo={0}
                      rotuloEscolhido={servicoEscolhido?.titulo}
                    />
                  </div>

                  {String(config.cod_municipio_ibge ?? '').replace(/\D+/g, '').length !== 7 ? (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="cidade">Cidade da agência</Label>
                      <BuscaComLista
                        id="cidade"
                        valor={config.cod_municipio_ibge}
                        onValor={v => alterar('cod_municipio_ibge', v)}
                        onBuscar={buscarMunicipios}
                        placeholder="Digite o nome da cidade"
                        placeholderBusca="Procurar cidade pelo nome"
                      />
                    </div>
                  ) : null}

                  {Number(config.simples_nacional) >= 2 ? (
                    <fieldset className="flex flex-col gap-2">
                      <legend className="fin-t-body-strong text-[var(--fin-text)]">
                        Como o ISS da nota é recolhido?
                      </legend>
                      {[
                        { v: '1', t: 'Tudo pela guia do Simples (DAS)', d: 'É o caso da maioria.' },
                        { v: '2', t: 'O ISS é pago à prefeitura', d: 'Federais pelo Simples, ISS por fora.' },
                        { v: '3', t: 'Tudo fora do Simples', d: 'Federais e ISS pela legislação de cada um.' },
                      ].map(op => (
                        <label
                          key={op.v}
                          className={cn(
                            'flex min-h-14 cursor-pointer items-start gap-3 rounded-[var(--fin-r-md)] border p-3',
                            config.regime_apuracao === op.v
                              ? 'border-[var(--fin-accent)] bg-[var(--fin-surface-2)]'
                              : 'border-[var(--fin-border)]',
                          )}
                        >
                          <input
                            type="radio"
                            name="regime-apuracao"
                            className="mt-1 size-5"
                            checked={config.regime_apuracao === op.v}
                            onChange={() => alterar('regime_apuracao', op.v)}
                          />
                          <span className="flex min-w-0 flex-col">
                            <span className="fin-t-body text-[var(--fin-text)]">{op.t}</span>
                            <span className="fin-t-caption text-[var(--fin-text-3)]">{op.d}</span>
                          </span>
                        </label>
                      ))}
                      <span className="fin-t-caption text-[var(--fin-text-3)]">
                        Na dúvida, a primeira opção. Confirme com a contabilidade.
                      </span>
                    </fieldset>
                  ) : null}

                  {pendencias && !pendencias.pronto && pendencias.itens.length > 0 ? (
                    <Callout tom="aviso" titulo="O emissor ainda aponta">
                      <ul className="list-disc pl-4">
                        {pendencias.itens.map(i => <li key={i}>{i}</li>)}
                      </ul>
                    </Callout>
                  ) : null}

                  <Button
                    type="button"
                    className="h-12 w-full lg:h-11 lg:w-auto lg:self-start"
                    onClick={() => { void ativar(); }}
                    disabled={trabalhando || !config.cod_tributacao_nacional}
                  >
                    {trabalhando ? 'Ativando…' : 'Ativar emissão de notas'}
                  </Button>
                </section>
              </>
            ) : null}

            {/* ---------- ETAPA 3: PRONTO ---------- */}
            {etapa === 'pronto' && cert ? (
              <>
                {ativou ? (
                  <Comemoracao
                    chave="fiscal-ativado"
                    titulo="Nota fiscal ativada"
                    detalhe="A agência já pode emitir notas nas parcelas recebidas."
                  />
                ) : null}

                <Callout tom="positivo" titulo="Tudo pronto para emitir">
                  A nota sai em Contas a receber: confirme um recebimento e toque em Emitir nota.
                </Callout>

                <section className={CARTAO}>
                  <h2 className="fin-t-subhead text-[var(--fin-text)]">Como está configurado</h2>
                  <ListaDeFatos
                    itens={[
                      { rotulo: 'Empresa', valor: cert.titular, fonte: 'certificado' },
                      { rotulo: 'CNPJ', valor: cnpjFormatado(cert.cnpj), fonte: 'certificado' },
                      {
                        rotulo: 'Certificado',
                        valor: `Válido até ${dataBR(cert.validade_fim)}`,
                        fonte: 'certificado',
                        chip:
                          diasDoCert !== null && diasDoCert <= 30
                            ? { texto: `vence em ${diasDoCert} dias`, tom: 'aviso' }
                            : { texto: 'válido', tom: 'positivo' },
                      },
                      {
                        rotulo: 'Cidade',
                        valor: municipio?.detalhe || config.cod_municipio_ibge,
                        fonte: 'receita',
                      },
                      {
                        rotulo: 'Serviço na nota',
                        valor: servicoEscolhido
                          ? `${servicoEscolhido.titulo} (item ${servicoEscolhido.item})`
                          : config.cod_tributacao_nacional,
                        fonte: 'proposto',
                      },
                    ] as Fato[]}
                  />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {/* O Button local não suporta asChild: o link é estilizado
                        direto, mantendo altura de toque de 48px no celular. */}
                    <Link
                      href="/financeiro-ag/receber"
                      className="fin-t-body inline-flex h-12 w-full items-center justify-center rounded-[var(--fin-r-md)] bg-[var(--fin-accent)] px-4 text-white hover:opacity-90 lg:h-11 lg:w-auto"
                    >
                      <FileText aria-hidden="true" className="mr-2 size-4" />
                      Ir para Contas a receber
                    </Link>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 w-full lg:h-11 lg:w-auto"
                      onClick={() => { void configurar(); }}
                      disabled={trabalhando}
                    >
                      {trabalhando ? 'Conferindo…' : 'Conferir de novo'}
                    </Button>
                  </div>
                </section>

                {diasDoCert !== null && diasDoCert <= 30 ? (
                  <Callout tom="aviso" titulo={`O certificado vence em ${diasDoCert} dias`}>
                    Vence em {dataBR(cert.validade_fim)}. Providencie a renovação para a emissão
                    não parar. Quando tiver o novo, envie em Ajuste manual › Certificado.
                  </Callout>
                ) : null}
              </>
            ) : null}

            {/* O catálogo que alimenta o seletor de serviço na emissão. Sem
                caminho daqui, a tela só existiria pelo link dentro do diálogo
                de emitir — que é onde ninguém procura por cadastro. */}
            <p className="fin-t-caption flex items-center gap-2 text-[var(--fin-text-3)]">
              <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
              O que a empresa presta?{' '}
              <Link href="/config/fiscal/servicos" className="text-[var(--fin-accent)] underline">
                Serviços da nota fiscal
              </Link>
            </p>

            {/* Quem já sabe o que quer não precisa passar pelo caminho guiado. */}
            <p className="fin-t-caption flex items-center gap-2 text-[var(--fin-text-3)]">
              <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
              Precisa mexer num campo específico?{' '}
              <Link href="/config/fiscal/avancado" className="text-[var(--fin-accent)] underline">
                Ajuste manual
              </Link>
            </p>
          </div>
        ) : null}
      </DataState>
    </PageShell>
  );
}

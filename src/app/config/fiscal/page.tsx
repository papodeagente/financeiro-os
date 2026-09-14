'use client';

/**
 * Configuração fiscal: emissor, certificado digital e enquadramento do
 * serviço. É a página que destrava o botão "Emitir nota" nas contas a receber.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, Upload } from 'lucide-react';

import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { BuscaComLista, type OpcaoBusca } from './Busca';
import { servicoDoCodigo } from '@/lib/lc116-servicos';
import { toast } from '@/lib/toast';
import { hojeISO } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { ConfigFiscal } from '@/lib/nfse-tipos';

interface Emitente {
  cnpj: string;
  inscricao_municipal: string;
  razao_social: string;
  regime_tributario: string;
}

const CAIXA =
  'flex flex-col gap-4 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-5';
const SELECT =
  'h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text)]';

function Secao({ titulo, descricao, children }: {
  titulo: string; descricao: string; children: React.ReactNode;
}) {
  return (
    <section className={CAIXA}>
      <div className="flex flex-col gap-1">
        <h2 className="fin-t-subhead text-[var(--fin-text)]">{titulo}</h2>
        <p className="fin-t-caption text-[var(--fin-text-3)]">{descricao}</p>
      </div>
      {children}
    </section>
  );
}

export default function ConfigFiscalPage() {
  const [config, setConfig] = useState<ConfigFiscal | null>(null);
  const [emitente, setEmitente] = useState<Emitente | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [enviandoCert, setEnviandoCert] = useState(false);
  const [senhaCert, setSenhaCert] = useState('');
  const arquivoRef = useRef<HTMLInputElement>(null);
  // O que o próprio emissor diz que falta. Vem de lá porque é lá que a
  // emissão é recusada: repetir a validação aqui só criaria divergência.
  const [pendencias, setPendencias] = useState<{ pronto: boolean; itens: string[] } | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [municipio, setMunicipio] = useState<{ emite: boolean; detalhe: string; convenio: string } | null>(null);
  const [conferindoMunicipio, setConferindoMunicipio] = useState(false);
  const [conectando, setConectando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [confirmarDesconexao, setConfirmarDesconexao] = useState(false);
  const [chaveOperacao, setChaveOperacao] = useState('');
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [atividades, setAtividades] = useState<Array<{ item: string; codigo: string; titulo: string }>>([]);
  const [mostrarAvancado, setMostrarAvancado] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await fetch('/api/fiscal/config');
      const corpo = await res.json();
      if (!res.ok) { setErro(corpo?.error || 'Não foi possível carregar.'); return; }
      setConfig(corpo.config as ConfigFiscal);
      setEmitente(corpo.emitente as Emitente);
      setErro('');
    } catch {
      setErro('Não foi possível carregar.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  function mudar<K extends keyof ConfigFiscal>(campo: K, valor: ConfigFiscal[K]) {
    setConfig(c => (c ? { ...c, [campo]: valor } : c));
  }

  async function salvar() {
    if (!config || salvando) return;
    setSalvando(true);
    try {
      const res = await fetch('/api/fiscal/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const corpo = await res.json();
      if (!res.ok) { toast.error('Não foi possível salvar', corpo?.error || ''); return; }
      setConfig(corpo.config as ConfigFiscal);
      toast.success('Configuração fiscal salva');
    } finally {
      setSalvando(false);
    }
  }

  async function enviarCertificado() {
    const arquivo = arquivoRef.current?.files?.[0];
    if (!arquivo) { toast.error('Selecione o arquivo do certificado'); return; }
    if (!senhaCert) { toast.error('Informe a senha do certificado'); return; }
    setEnviandoCert(true);
    try {
      const form = new FormData();
      form.append('arquivo', arquivo);
      form.append('senha', senhaCert);
      const res = await fetch('/api/fiscal/certificado', { method: 'POST', body: form });
      const corpo = await res.json();
      if (!res.ok) { toast.error('O certificado não foi aceito', corpo?.error || ''); return; }
      setConfig(corpo.config as ConfigFiscal);
      // A senha existiu só durante o envio; não fica no navegador nem no banco.
      setSenhaCert('');
      if (arquivoRef.current) arquivoRef.current.value = '';
      toast.success('Certificado enviado');
    } finally {
      setEnviandoCert(false);
    }
  }

  /**
   * Conecta a agência: o sistema cadastra a empresa na AceleraAPI com a chave
   * da operação e guarda o token dela. A agência não digita token nenhum.
   */
  /**
   * Desfaz o vínculo desta agência. O cadastro na AceleraAPI continua lá:
   * reconectar com o mesmo CNPJ reaproveita a mesma empresa.
   */
  async function desconectar() {
    if (desconectando) return;
    setDesconectando(true);
    try {
      const res = await fetch('/api/fiscal/empresa', { method: 'DELETE' });
      const corpo = await res.json();
      if (!res.ok) { toast.error('Não foi possível desconectar', corpo?.error || ''); return; }
      setConfig(corpo.config as ConfigFiscal);
      setPendencias(null);
      setConfirmarDesconexao(false);
      toast.success('Agência desconectada', 'Conecte de novo para emitir notas.');
    } finally {
      setDesconectando(false);
    }
  }

  /**
   * Puxa da Receita o que dá para preencher sozinho: razão social, endereço,
   * código IBGE do município e CNAE. Só preenche campo vazio.
   */
  async function buscarDadosDoCnpj() {
    if (buscandoCnpj) return;
    setBuscandoCnpj(true);
    try {
      const res = await fetch('/api/fiscal/autopreencher', { method: 'POST' });
      const corpo = await res.json();
      if (!res.ok) { toast.error('Não foi possível buscar o CNPJ', corpo?.error || ''); return; }
      setConfig(corpo.config as ConfigFiscal);
      if (corpo.pendencias) setPendencias(corpo.pendencias);
      if (corpo.municipio) setMunicipio(corpo.municipio);
      if (Array.isArray(corpo.atividades)) setAtividades(corpo.atividades);
      const lista = (corpo.preenchidos ?? []) as string[];
      toast.success(
        lista.length > 0 ? 'Dados preenchidos pela Receita' : 'Nada a preencher',
        lista.length > 0
          ? lista.join(', ')
          : 'Os campos já estavam preenchidos e foram mantidos.',
      );
      // Recarrega para a tela refletir o que foi gravado no cadastro da agência.
      void carregar();
    } finally {
      setBuscandoCnpj(false);
    }
  }

  async function conectar() {
    if (conectando) return;
    setConectando(true);
    try {
      const res = await fetch('/api/fiscal/empresa', { method: 'POST' });
      const corpo = await res.json();
      if (!res.ok) { toast.error('Não foi possível conectar', corpo?.error || ''); return; }
      setConfig(corpo.config as ConfigFiscal);
      if (corpo.pendencias) setPendencias(corpo.pendencias);
      if (corpo.chave_operacao) setChaveOperacao(corpo.chave_operacao as string);
      toast.success(
        corpo.ja_conectada ? 'Esta agência já está conectada' : 'Agência conectada à AceleraAPI',
      );
    } finally {
      setConectando(false);
    }
  }

  /** Empurra o cadastro do prestador e lê as pendências que sobraram. */
  async function sincronizarPrestador() {
    if (sincronizando) return;
    setSincronizando(true);
    try {
      const res = await fetch('/api/fiscal/prestador', { method: 'POST' });
      const corpo = await res.json();
      if (!res.ok) { toast.error('Não foi possível sincronizar', corpo?.error || ''); return; }
      setPendencias(corpo as { pronto: boolean; itens: string[] });
      if (corpo.pronto) toast.success('Prestador configurado no emissor');
      else toast.error('O emissor ainda aponta pendências', '');
    } finally {
      setSincronizando(false);
    }
  }

  /**
   * `codigo` explícito existe porque a escolha na lista precisa conferir o
   * município que acabou de ser escolhido, e não o que ainda está no state:
   * o React só aplica a mudança no próximo render.
   */
  async function conferirMunicipio(codigo?: string) {
    const ibge = (codigo ?? config?.cod_municipio_ibge ?? '').replace(/\D+/g, '');
    if (ibge.length !== 7) { toast.error('Informe o código IBGE com 7 dígitos'); return; }
    setConferindoMunicipio(true);
    try {
      const res = await fetch(`/api/fiscal/municipio/${ibge}`);
      const corpo = await res.json();
      if (!res.ok) { toast.error('Não foi possível consultar', corpo?.error || ''); return; }
      setMunicipio(corpo as { emite: boolean; detalhe: string; convenio: string });
    } finally {
      setConferindoMunicipio(false);
    }
  }

  async function removerCertificado() {
    const res = await fetch('/api/fiscal/certificado', { method: 'DELETE' });
    const corpo = await res.json();
    if (!res.ok) { toast.error('Não foi possível remover', corpo?.error || ''); return; }
    setConfig(corpo.config as ConfigFiscal);
    toast.success('Certificado removido');
  }

  /** Municípios do IBGE, que é quem define o código. */
  const buscarMunicipios = useCallback(async (termo: string): Promise<OpcaoBusca[]> => {
    const res = await fetch(`/api/fiscal/municipios?busca=${encodeURIComponent(termo)}`);
    const corpo = await res.json();
    return ((corpo.municipios ?? []) as Array<{ ibge: string; nome: string; uf: string }>).map(m => ({
      valor: m.ibge,
      titulo: `${m.nome} / ${m.uf}`,
      detalhe: `Código IBGE ${m.ibge}`,
    }));
  }, []);

  /** Serviços da LC 116, procurados pelo que a agência faz. */
  const buscarServicosFiscais = useCallback(async (termo: string): Promise<OpcaoBusca[]> => {
    const res = await fetch(`/api/fiscal/servicos?busca=${encodeURIComponent(termo)}`);
    const corpo = await res.json();
    return ((corpo.servicos ?? []) as Array<{
      codigo: string; item: string; titulo: string; descricao: string;
    }>).map(sv => ({
      valor: sv.codigo,
      titulo: sv.titulo,
      detalhe: `Item ${sv.item} da LC 116 · código ${sv.codigo}`,
    }));
  }, []);

  /** Tabela CNAE do IBGE, procurada pela descrição da atividade. */
  const buscarCnaes = useCallback(async (termo: string): Promise<OpcaoBusca[]> => {
    const res = await fetch(`/api/fiscal/cnaes?busca=${encodeURIComponent(termo)}`);
    const corpo = await res.json();
    return ((corpo.cnaes ?? []) as Array<{
      codigo: string; formatado: string; descricao: string; grupo: string;
    }>).map(c => ({
      valor: c.codigo,
      titulo: c.descricao,
      detalhe: [c.formatado, c.grupo].filter(Boolean).join(' · '),
    }));
  }, []);

  /** Fornecedores já cadastrados, para o bloco de intermediador. */
  const buscarFornecedores = useCallback(async (termo: string): Promise<OpcaoBusca[]> => {
    const res = await fetch('/api/fornecedores-crm');
    const lista = (await res.json()) as Array<{
      id: string; razao_social?: string; nome_fantasia?: string; cnpj?: string;
    }>;
    const q = termo.trim().toLowerCase();
    return (Array.isArray(lista) ? lista : [])
      .filter(f => {
        if (!q) return true;
        return `${f.nome_fantasia ?? ''} ${f.razao_social ?? ''} ${f.cnpj ?? ''}`
          .toLowerCase().includes(q);
      })
      .slice(0, 30)
      .map(f => ({
        valor: String(f.cnpj ?? ''),
        titulo: f.nome_fantasia || f.razao_social || 'Fornecedor sem nome',
        detalhe: [f.razao_social, f.cnpj].filter(Boolean).join(' · ') || 'Sem CNPJ cadastrado',
      }));
  }, []);

  const cert = config?.certificado ?? null;
  const vencido = Boolean(cert?.validade_fim && cert.validade_fim < hojeISO());

  return (
    <PageShell width="full" padding="md" gap="md" className="max-w-[900px]">
      <PageHeader
        titulo="Nota fiscal"
        subtitulo="Emissor, certificado digital e como o serviço da agência é tributado."
        acaoPrimaria={{ rotulo: salvando ? 'Salvando…' : 'Salvar', onClick: () => { void salvar(); } }}
      />

      <DataState
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={{ mensagem: erro, onTentarDeNovo: () => { void carregar(); } }}
        esqueleto={
          <div className="fin-t-body text-[var(--fin-text-3)]">Carregando a configuração fiscal…</div>
        }
      >
        {config ? (
          <div className="flex flex-col gap-4">
            {/* Datas conferidas em 14/09/2026 nas orientações da Receita
                Federal e no Ato Conjunto RFB/CGIBS nº 4/2026. O painel existe
                porque a agência está configurando a nota agora, a duas
                semanas de a primeira data virar. */}
            <section className={`${CAIXA} border-[var(--fin-warning)] bg-[var(--fin-warning-soft)]`}>
              <div className="flex flex-col gap-1">
                <h2 className="fin-t-subhead text-[var(--fin-warning-text)]">
                  Reforma tributária: o que muda na sua nota
                </h2>
                <p className="fin-t-caption text-[var(--fin-text-2)]">
                  2026 é ano de adaptação. O IBS e a CBS aparecem na nota como informação e
                  não entram no total da operação, nem mudam o que você paga hoje.
                </p>
              </div>
              <ul className="flex flex-col gap-2">
                <li className="fin-t-body text-[var(--fin-text)]">
                  <strong>1º de outubro de 2026</strong> — o destaque de IBS e CBS passa a ser
                  obrigatório na NFS-e. Até 31 de dezembro de 2026 a falta dessas informações
                  não faz a nota ser recusada.
                </li>
                <li className="fin-t-body text-[var(--fin-text)]">
                  <strong>1º de janeiro de 2027</strong> — a obrigatoriedade alcança quem é do
                  Simples Nacional.
                </li>
                <li className="fin-t-body text-[var(--fin-text)]">
                  A alíquota de teste é de <strong>1%</strong> (0,9% de CBS e 0,1% de IBS), com
                  caráter informativo.
                </li>
              </ul>
              <p className="fin-t-caption text-[var(--fin-text-2)]">
                O que isso significa para configurar aqui: o campo que mais importa continua
                sendo a <strong>atividade da empresa</strong>. É o CNAE que define o serviço, o
                serviço que define o código de tributação, e é esse conjunto que a reforma usa
                para classificar a operação. Cadastrar a atividade certa hoje é o que evita
                retrabalho quando o destaque virar obrigatório.
              </p>
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                Esta tela não calcula IBS nem CBS. Quando o emissor passar a aceitar esses
                campos, eles entram aqui. Confirme o enquadramento com a sua contabilidade.
              </p>
            </section>

            <Secao
              titulo="Emissor"
              descricao="Quem transmite a nota para a prefeitura. O emissor simulado percorre o fluxo inteiro sem emitir documento fiscal, para conferir os valores antes de contratar."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="provedor">Emissor</Label>
                  <select
                    id="provedor" className={SELECT} value={config.provedor}
                    onChange={e => mudar('provedor', e.target.value as ConfigFiscal['provedor'])}
                  >
                    <option value="">Não configurado</option>
                    <option value="aceleraapi">AceleraAPI (padrão nacional)</option>
                    <option value="plugnotas">PlugNotas</option>
                    <option value="simulado">Simulado (não emite de verdade)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ambiente">Ambiente</Label>
                  <select
                    id="ambiente" className={SELECT} value={config.ambiente}
                    onChange={e => mudar('ambiente', e.target.value as ConfigFiscal['ambiente'])}
                  >
                    <option value="HOMOLOGACAO">Homologação (teste)</option>
                    <option value="PRODUCAO">Produção (nota valendo)</option>
                  </select>
                </div>
                {config.provedor === 'aceleraapi' ? (
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <span className="fin-t-body-strong text-[var(--fin-text)]">
                      {config.token_mascarado
                        ? `Agência conectada (${config.token_mascarado})`
                        : 'Agência ainda não conectada'}
                    </span>
                    <p className="fin-t-caption text-[var(--fin-text-3)]">
                      Você não precisa de token. Ao conectar, o Entur OS cadastra a agência na
                      AceleraAPI com o CNPJ e a razão social de Configurações › Agência, e guarda a
                      credencial dela no servidor.
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button type="button" onClick={() => { void conectar(); }} disabled={conectando}>
                        {conectando
                          ? 'Conectando…'
                          : config.token_mascarado ? 'Reconectar' : 'Conectar esta agência'}
                      </Button>
                      {config.empresa_id ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => { void buscarDadosDoCnpj(); }}
                          disabled={buscandoCnpj}
                        >
                          {buscandoCnpj ? 'Buscando…' : 'Preencher pelo CNPJ'}
                        </Button>
                      ) : null}
                      {config.empresa_id ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setConfirmarDesconexao(true)}
                          disabled={desconectando}
                        >
                          Desconectar
                        </Button>
                      ) : null}
                      {config.empresa_id ? (
                        <span className="fin-t-caption text-[var(--fin-text-3)]">
                          Empresa #{config.empresa_id} na AceleraAPI
                          {chaveOperacao ? ` · conta ${chaveOperacao}` : ''}.
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <Label htmlFor="token">Token do emissor</Label>
                    <Input
                      id="token" type="password" autoComplete="off"
                      placeholder={config.token_mascarado ? `Salvo (${config.token_mascarado}). Deixe em branco para manter.` : 'Cole o token'}
                      value={config.token ?? ''}
                      onChange={e => mudar('token', e.target.value)}
                    />
                    <p className="fin-t-caption text-[var(--fin-text-3)]">
                      O token fica só no servidor. Esta tela nunca recebe o valor completo de volta.
                    </p>
                  </div>
                )}
              </div>
            </Secao>

            <Secao
              titulo="Certificado digital A1"
              descricao="É o certificado que assina a nota. O arquivo é repassado ao emissor e não fica guardado aqui — o sistema mantém só a validade, para avisar antes de vencer. Certificado A3 (token ou cartão) não serve: exige alguém plugando o dispositivo a cada emissão."
            >
              {cert ? (
                <div className="flex flex-col gap-3">
                  <div className={`flex flex-col gap-1 rounded-[var(--fin-r-md)] border p-3 ${vencido ? 'border-[var(--fin-negative)]' : 'border-[var(--fin-border)] bg-[var(--fin-surface-2)]'}`}>
                    <span className="fin-t-body-strong flex items-center gap-2 text-[var(--fin-text)]">
                      <ShieldCheck aria-hidden="true" className="size-4" />
                      {cert.titular || cert.nome_arquivo}
                    </span>
                    <span className="fin-t-caption text-[var(--fin-text-3)]">
                      {cert.cnpj ? `CNPJ ${cert.cnpj} · ` : ''}
                      {cert.validade_fim
                        ? `${vencido ? 'Venceu' : 'Vence'} em ${cert.validade_fim.split('-').reverse().join('/')}`
                        : 'Validade não informada pelo emissor'}
                    </span>
                    {vencido ? (
                      <span className="fin-t-caption text-[var(--fin-negative)]">
                        Certificado vencido: nenhuma nota será emitida até enviar um novo.
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <Button type="button" variant="outline" onClick={() => { void removerCertificado(); }}>
                      Remover certificado
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="arquivo-cert">Arquivo (.pfx ou .p12)</Label>
                  <input
                    id="arquivo-cert" ref={arquivoRef} type="file" accept=".pfx,.p12"
                    className="fin-t-body text-[var(--fin-text-2)]"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="senha-cert">Senha do certificado</Label>
                  <Input
                    id="senha-cert" type="password" autoComplete="off"
                    value={senhaCert} onChange={e => setSenhaCert(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Button
                  type="button" onClick={() => { void enviarCertificado(); }}
                  disabled={enviandoCert}
                >
                  <Upload aria-hidden="true" className="mr-2 size-4" />
                  {enviandoCert ? 'Enviando…' : cert ? 'Substituir certificado' : 'Enviar certificado'}
                </Button>
              </div>
            </Secao>

            <Secao
              titulo="Como a agência é tributada"
              descricao="A escolha padrão de cada nota. Numa agência de viagens o valor da venda não é receita: quando a agência agencia, o ISS incide só sobre a comissão. Cada nota permite confirmar ou trocar isso na hora."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="regime">Padrão das notas</Label>
                  <select
                    id="regime" className={SELECT} value={config.regime_padrao}
                    onChange={e => mudar('regime_padrao', e.target.value as ConfigFiscal['regime_padrao'])}
                  >
                    <option value="INTERMEDIACAO">Intermediando (nota da comissão)</option>
                    <option value="PRESTACAO_DIRETA">Serviço próprio (nota do valor cheio)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="forma-base">Formato da intermediação</Label>
                  <select
                    id="forma-base" className={SELECT} value={config.forma_base_intermediacao}
                    onChange={e => mudar('forma_base_intermediacao', e.target.value as ConfigFiscal['forma_base_intermediacao'])}
                  >
                    <option value="VALOR_COMISSAO">Nota do valor da comissão</option>
                    <option value="TOTAL_COM_DEDUCAO">Valor cheio com repasse como dedução</option>
                  </select>
                </div>
              </div>
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                {config.provedor === 'aceleraapi'
                  ? 'O padrão nacional não tem campo de dedução, então só o formato "nota do valor da comissão" é emitido. O outro fica bloqueado na hora de emitir, em vez de sair com valor diferente do configurado.'
                  : 'Os dois formatos dão o mesmo imposto; o que muda é o que aparece no documento. Confirme com a contabilidade qual o seu município aceita.'}
              </p>

              <div className="flex flex-col gap-2">
                <span className="fin-t-body-strong text-[var(--fin-text)]">
                  Terceiro intermediador
                </span>
                <p className="fin-t-caption text-[var(--fin-text-3)]">
                  Preencha só quando outra empresa intermedeia a venda entre a agência e o cliente
                  (um marketplace, por exemplo). Deixe vazio quando a própria agência é quem
                  intermedeia: esse caso é o padrão acima, não este bloco.
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <BuscaComLista
                    id="intermediario-doc"
                    valor={config.intermediario_padrao?.cpf_cnpj ?? ''}
                    onValor={(v, opcao) => mudar('intermediario_padrao', {
                      cpf_cnpj: v,
                      // Escolher da lista traz a razão social junto: digitar
                      // os dois à mão é onde nasce divergência de cadastro.
                      razao_social: opcao
                        ? opcao.titulo
                        : (config.intermediario_padrao?.razao_social ?? ''),
                      inscricao_municipal: config.intermediario_padrao?.inscricao_municipal ?? '',
                    })}
                    onBuscar={buscarFornecedores}
                    placeholder="CNPJ ou CPF"
                    placeholderBusca="Procurar nos fornecedores cadastrados"
                    minimo={0}
                  />
                  <Input
                    placeholder="Razão social"
                    value={config.intermediario_padrao?.razao_social ?? ''}
                    onChange={e => mudar('intermediario_padrao', {
                      cpf_cnpj: config.intermediario_padrao?.cpf_cnpj ?? '',
                      razao_social: e.target.value,
                      inscricao_municipal: config.intermediario_padrao?.inscricao_municipal ?? '',
                    })}
                  />
                  <Input
                    placeholder="Inscrição municipal"
                    value={config.intermediario_padrao?.inscricao_municipal ?? ''}
                    onChange={e => mudar('intermediario_padrao', {
                      cpf_cnpj: config.intermediario_padrao?.cpf_cnpj ?? '',
                      razao_social: config.intermediario_padrao?.razao_social ?? '',
                      inscricao_municipal: e.target.value,
                    })}
                  />
                </div>
              </div>
            </Secao>

            {config.provedor === 'aceleraapi' ? (
              <Secao
                titulo="Prestador no padrão nacional"
                descricao="A nota nacional não leva o prestador em cada emissão: ele é cadastrado uma vez no emissor. Preencha, salve e sincronize — as pendências abaixo vêm do próprio emissor, que é quem recusa a nota."
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="ibge">Código IBGE do município (7 dígitos)</Label>
                    <BuscaComLista
                      id="ibge"
                      valor={config.cod_municipio_ibge}
                      onValor={(v, opcao) => {
                        mudar('cod_municipio_ibge', v);
                        // Escolher a cidade já responde a pergunta que vem
                        // logo depois: ela emite pelo Emissor Nacional?
                        if (opcao) setTimeout(() => { void conferirMunicipio(v); }, 0);
                      }}
                      onBuscar={buscarMunicipios}
                      placeholder="Digite o nome da cidade ou o código"
                      placeholderBusca="Procurar cidade pelo nome"
                    />
                    <Button type="button" variant="outline" className="self-start"
                      onClick={() => { void conferirMunicipio(); }}
                      disabled={conferindoMunicipio}
                    >
                      {conferindoMunicipio ? 'Conferindo…' : 'A cidade emite?'}
                    </Button>
                    {municipio ? (
                      <span className={`fin-t-caption ${municipio.emite ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-negative)]'}`}>
                        {municipio.emite
                          ? `${municipio.detalhe || 'O município'} emite pelo Emissor Nacional.`
                          : `${municipio.detalhe || 'Este município'} não emite pelo Emissor Nacional`
                            + (municipio.convenio ? ` (convênio: ${municipio.convenio.toLowerCase()})` : '')
                            + '. A prefeitura mantém sistema próprio, então a nota seria recusada.'}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="codtribnac">Código de tributação nacional (6 dígitos)</Label>
                    <BuscaComLista
                      id="codtribnac"
                      valor={config.cod_tributacao_nacional}
                      onValor={v => mudar('cod_tributacao_nacional', v)}
                      onBuscar={buscarServicosFiscais}
                      placeholder="Escolha o serviço ou digite o código"
                      placeholderBusca="Procurar pelo que a agência faz"
                      minimo={0}
                      rotuloEscolhido={
                        servicoDoCodigo(config.cod_tributacao_nacional)
                          ? `${servicoDoCodigo(config.cod_tributacao_nacional)?.titulo} (item ${servicoDoCodigo(config.cod_tributacao_nacional)?.item})`
                          : undefined
                      }
                    />
                    <span className="fin-t-caption text-[var(--fin-text-3)]">
                      Procure pelo serviço que a agência presta. O código é uma proposta: ao
                      sincronizar, o emissor confirma se ele vale — e é isso que garante a nota
                      antes de emitir.
                    </span>
                  </div>
                  {/* O Simples vem da Receita pelo CNPJ. Vira campo editável
                      só quando a consulta não respondeu — pedir à agência um
                      dado que o sistema sabe olhar é pedir erro. */}
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="simples">Simples Nacional</Label>
                    <select id="simples" className={SELECT} value={config.simples_nacional}
                      onChange={e => mudar('simples_nacional', Number(e.target.value) as 1 | 2 | 3)}
                    >
                      <option value={1}>Não optante</option>
                      <option value={2}>MEI</option>
                      <option value={3}>ME / EPP</option>
                    </select>
                    <span className="fin-t-caption text-[var(--fin-text-3)]">
                      Preenchido pela consulta do CNPJ. Só mude se a Receita estiver desatualizada.
                    </span>
                  </div>
                  {/* Só existe para quem é do Simples: fora daí a AceleraAPI
                      nem aceita o campo. */}
                  {config.simples_nacional >= 2 ? (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="apuracao">Regime de apuração</Label>
                      <Input id="apuracao" value={config.regime_apuracao}
                        onChange={e => mudar('regime_apuracao', e.target.value)} />
                      <span className="fin-t-caption text-[var(--fin-text-3)]">
                        Exigido porque a empresa é do Simples.
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* O que a empresa declarou fazer na Receita. Confirmar aqui é
                    mais seguro do que escolher às cegas numa lista genérica. */}
                {atividades.length > 0 ? (
                  <div className="flex flex-col gap-2 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)] p-3">
                    <span className="fin-t-body-strong text-[var(--fin-text)]">
                      O que a sua empresa faz, segundo a Receita
                    </span>
                    <div className="flex flex-col gap-1">
                      {atividades.map(a => {
                        const escolhido = config.cod_tributacao_nacional === a.codigo;
                        return (
                          <button
                            key={a.codigo}
                            type="button"
                            onClick={() => mudar('cod_tributacao_nacional', a.codigo)}
                            className={cn(
                              'flex items-center justify-between gap-3 rounded-[var(--fin-r-sm)] px-2 py-1.5 text-left',
                              escolhido
                                ? 'bg-[var(--fin-surface)] ring-1 ring-[var(--fin-accent)]'
                                : 'hover:bg-[var(--fin-surface)]',
                            )}
                          >
                            <span className="fin-t-body text-[var(--fin-text)]">{a.titulo}</span>
                            <span className="fin-t-caption text-[var(--fin-text-3)]">
                              item {a.item} · {a.codigo}
                              {escolhido ? ' · em uso' : ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {/* Numeração vinda de outro sistema é caso de migração. Fora
                    do caminho principal porque preenchida à toa pula número. */}
                <button
                  type="button"
                  onClick={() => setMostrarAvancado(v => !v)}
                  className="fin-t-caption self-start text-[var(--fin-accent)]"
                >
                  {mostrarAvancado ? 'Esconder' : 'Já emitia nota em outro sistema?'}
                </button>
                {mostrarAvancado ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="ultdps">Último DPS emitido em outro sistema</Label>
                    <Input id="ultdps" value={config.ultimo_numero_dps}
                      onChange={e => mudar('ultimo_numero_dps', e.target.value)} />
                    <span className="fin-t-caption text-[var(--fin-text-3)]">
                      Deixe vazio se a agência nunca emitiu NFS-e. Preencher sem necessidade pula
                      números da sua numeração.
                    </span>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" onClick={() => { void sincronizarPrestador(); }}
                    disabled={sincronizando}
                  >
                    {sincronizando ? 'Sincronizando…' : 'Sincronizar prestador com o emissor'}
                  </Button>
                  <span className="fin-t-caption text-[var(--fin-text-3)]">
                    Salve antes de sincronizar.
                  </span>
                </div>

                {pendencias ? (
                  pendencias.pronto ? (
                    <p className="fin-t-body text-[var(--fin-positive)]">
                      O emissor está pronto para emitir.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <span className="fin-t-body-strong text-[var(--fin-negative)]">
                        O emissor ainda não emite:
                      </span>
                      <ul className="list-disc pl-5">
                        {pendencias.itens.map(i => (
                          <li key={i} className="fin-t-caption text-[var(--fin-text-2)]">{i}</li>
                        ))}
                      </ul>
                    </div>
                  )
                ) : null}
              </Secao>
            ) : null}

            <Secao
              titulo="Enquadramento do serviço"
              descricao="Os códigos que a prefeitura exige. Agência de viagens costuma usar item 9.02 da lista da LC 116 e CNAE 7911-2/00, mas confirme com a contabilidade."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="item">Item da lista de serviço</Label>
                  <Input id="item" value={config.item_lista_servico}
                    onChange={e => mudar('item_lista_servico', e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="cnae">CNAE</Label>
                  <BuscaComLista
                    id="cnae"
                    valor={config.cnae}
                    onValor={v => mudar('cnae', v)}
                    onBuscar={buscarCnaes}
                    placeholder="Digite a atividade ou o código"
                    placeholderBusca="Procurar na tabela do IBGE"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="codtrib">Código de tributação do município</Label>
                  <Input id="codtrib" value={config.codigo_tributacao_municipio}
                    onChange={e => mudar('codigo_tributacao_municipio', e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="aliquota">
                    {config.provedor === 'aceleraapi'
                      ? 'Alíquota de ISS (%) — só para estimar'
                      : 'Alíquota de ISS (%)'}
                  </Label>
                  <Input id="aliquota" type="number" step="0.01" min="0" max="100"
                    value={config.aliquota_iss}
                    onChange={e => mudar('aliquota_iss', Number(e.target.value))} />
                  {config.provedor === 'aceleraapi' ? (
                    <span className="fin-t-caption text-[var(--fin-text-3)]">
                      No padrão nacional quem calcula o ISS é a prefeitura, a partir do código de
                      tributação. Este número só serve para mostrar a estimativa antes de emitir.
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="natureza">Natureza da operação</Label>
                  <Input id="natureza" value={config.natureza_operacao}
                    onChange={e => mudar('natureza_operacao', e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="serie">Série do RPS</Label>
                  <Input id="serie" value={config.serie_rps}
                    onChange={e => mudar('serie_rps', e.target.value)} />
                </div>
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={config.iss_retido_padrao}
                  onChange={e => mudar('iss_retido_padrao', e.target.checked)} />
                <span className="fin-t-body text-[var(--fin-text)]">
                  ISS normalmente retido pelo tomador
                </span>
              </label>
              <div className="flex flex-col gap-2">
                <Label htmlFor="discriminacao">Descrição padrão do serviço</Label>
                <Textarea id="discriminacao" rows={2} value={config.discriminacao_padrao}
                  onChange={e => mudar('discriminacao_padrao', e.target.value)} />
                <p className="fin-t-caption text-[var(--fin-text-3)]">
                  Aceita {'{cliente}'}, {'{venda}'}, {'{parcela}'}, {'{descricao}'} e {'{repasse}'}.
                </p>
              </div>
            </Secao>

            <Secao
              titulo="Dados da agência na nota"
              descricao="Vêm de Configurações › Agência. O CNPJ é obrigatório. A inscrição municipal é opcional no padrão nacional e não existe na base da Receita, então é o único dado que precisa ser digitado se a sua prefeitura exigir."
            >
              <div className="fin-t-body text-[var(--fin-text-2)]">
                <p>{emitente?.razao_social || 'Razão social não preenchida'}</p>
                <p>
                  {emitente?.cnpj ? `CNPJ ${emitente.cnpj}` : 'CNPJ não preenchido'}
                  {' · '}
                  {emitente?.inscricao_municipal
                    ? `Inscrição municipal ${emitente.inscricao_municipal}`
                    : 'Inscrição municipal não preenchida'}
                </p>
              </div>
            </Secao>
          </div>
        ) : null}
      </DataState>
      <ConfirmDialog
        aberto={confirmarDesconexao}
        onOpenChange={a => { if (!a) setConfirmarDesconexao(false); }}
        titulo="Desconectar esta agência da AceleraAPI"
        oQueVaiAcontecer="A agência para de emitir nota até você conectar de novo. O cadastro dela na AceleraAPI continua existindo e as notas já emitidas não mudam."
        detalhes={[
          {
            rotulo: 'O que sai daqui',
            valor: 'A credencial da agência e o certificado digital enviado.',
          },
          {
            rotulo: 'Para reconectar',
            valor: 'O mesmo CNPJ reaproveita a empresa que já existe, sem criar cadastro duplicado. O certificado precisa ser enviado de novo.',
          },
        ]}
        confirmarRotulo="Desconectar"
        tone="destrutivo"
        processando={desconectando}
        onConfirmar={() => { void desconectar(); }}
      />
    </PageShell>
  );
}

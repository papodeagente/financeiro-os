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
import { toast } from '@/lib/toast';
import { hojeISO } from '@/lib/money';
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

  async function removerCertificado() {
    const res = await fetch('/api/fiscal/certificado', { method: 'DELETE' });
    const corpo = await res.json();
    if (!res.ok) { toast.error('Não foi possível remover', corpo?.error || ''); return; }
    setConfig(corpo.config as ConfigFiscal);
    toast.success('Certificado removido');
  }

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
                Os dois formatos dão o mesmo imposto; o que muda é o que aparece no documento.
                Confirme com a contabilidade qual o seu município aceita.
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
                  <Input
                    placeholder="CNPJ ou CPF"
                    value={config.intermediario_padrao?.cpf_cnpj ?? ''}
                    onChange={e => mudar('intermediario_padrao', {
                      cpf_cnpj: e.target.value,
                      razao_social: config.intermediario_padrao?.razao_social ?? '',
                      inscricao_municipal: config.intermediario_padrao?.inscricao_municipal ?? '',
                    })}
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
                  <Input id="cnae" value={config.cnae}
                    onChange={e => mudar('cnae', e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="codtrib">Código de tributação do município</Label>
                  <Input id="codtrib" value={config.codigo_tributacao_municipio}
                    onChange={e => mudar('codigo_tributacao_municipio', e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="aliquota">Alíquota de ISS (%)</Label>
                  <Input id="aliquota" type="number" step="0.01" min="0" max="100"
                    value={config.aliquota_iss}
                    onChange={e => mudar('aliquota_iss', Number(e.target.value))} />
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
              descricao="Vêm de Configurações › Agência. A prefeitura recusa a nota sem CNPJ e inscrição municipal do emitente."
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
    </PageShell>
  );
}

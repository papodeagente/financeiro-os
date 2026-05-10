'use client';

import { GrupoViagem, SERVICOS, MOEDAS } from '@/lib/types';
import { createPeriodo, createTrecho } from '@/lib/defaults';
import { calcDiarias } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';

interface Props {
  grupo: GrupoViagem;
  onChange: (grupo: GrupoViagem) => void;
}

export function InfTab({ grupo, onChange }: Props) {
  const update = (partial: Partial<GrupoViagem>) => onChange({ ...grupo, ...partial });

  const updatePeriodo = (idx: number, field: string, value: string | null) => {
    const periodos = [...grupo.periodos];
    periodos[idx] = { ...periodos[idx], [field]: value };
    update({ periodos });
  };

  const addPeriodo = () => {
    if (grupo.periodos.length < 10) update({ periodos: [...grupo.periodos, createPeriodo()] });
  };

  const removePeriodo = (idx: number) => {
    update({ periodos: grupo.periodos.filter((_, i) => i !== idx) });
  };

  const updateTrecho = (idx: number, field: string, value: string | number | null) => {
    const trechos = [...grupo.trechos];
    trechos[idx] = { ...trechos[idx], [field]: value };
    update({ trechos });
  };

  const addTrecho = () => {
    if (grupo.trechos.length < 4) update({ trechos: [...grupo.trechos, createTrecho()] });
  };

  const removeTrecho = (idx: number) => {
    update({ trechos: grupo.trechos.filter((_, i) => i !== idx) });
  };

  const updateNavio = (field: string, value: string | null) => {
    update({ navio_info: { ...grupo.navio_info, [field]: value } });
  };

  const updateParams = (field: string, value: number) => {
    update({ params: { ...grupo.params, [field]: value } });
  };

  const updateCambio = (servico: string, field: string, value: string | number | null) => {
    const cambio = { ...grupo.cambio };
    cambio[servico] = { ...cambio[servico], [field]: value as never };
    update({ cambio });
  };

  const updateLink = (key: string, value: string) => {
    update({ links: { ...grupo.links, [key]: value } });
  };

  const totalDiarias = grupo.periodos.reduce((sum, p) => sum + calcDiarias(p.check_in, p.check_out), 0)
    + calcDiarias(grupo.navio_info.embarque, grupo.navio_info.desembarque);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>GRP ID</Label>
          <Input value={grupo.grp_id} onChange={e => update({ grp_id: e.target.value })} placeholder="GRP#001" />
        </div>
        <div>
          <Label>Origem x Destino</Label>
          <Input value={grupo.origem_destino} onChange={e => update({ origem_destino: e.target.value })} placeholder="São Paulo x Lisboa" />
        </div>
      </div>

      {/* Períodos */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-[var(--t-text)]">Períodos</h3>
          <Button variant="outline" size="sm" onClick={addPeriodo} disabled={grupo.periodos.length >= 10}>
            <Plus className="w-4 h-4 mr-1" /> Período
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
                <th className="p-2 text-left">#</th>
                <th className="p-2">Check-in</th>
                <th className="p-2">Check-out</th>
                <th className="p-2">Diárias</th>
                <th className="p-2">Destino</th>
                <th className="p-2">Hotel</th>
                <th className="p-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {grupo.periodos.map((p, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-[var(--t-surface)]' : 'bg-[var(--t-surface-hover)]'}>
                  <td className="p-2 font-medium">{i + 1}</td>
                  <td className="p-2"><Input type="date" value={p.check_in || ''} onChange={e => updatePeriodo(i, 'check_in', e.target.value || null)} className="h-8" /></td>
                  <td className="p-2"><Input type="date" value={p.check_out || ''} onChange={e => updatePeriodo(i, 'check_out', e.target.value || null)} className="h-8" /></td>
                  <td className="p-2 text-center font-bold">{calcDiarias(p.check_in, p.check_out) || '—'}</td>
                  <td className="p-2"><Input value={p.destino} onChange={e => updatePeriodo(i, 'destino', e.target.value)} className="h-8" placeholder="Cidade" /></td>
                  <td className="p-2"><Input value={p.hotel} onChange={e => updatePeriodo(i, 'hotel', e.target.value)} className="h-8" placeholder="Hotel" /></td>
                  <td className="p-2">
                    {grupo.periodos.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => removePeriodo(i)} className="h-8 w-8 p-0 text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Trechos Aéreos */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-[var(--t-text)]">Trechos Aéreos</h3>
          <Button variant="outline" size="sm" onClick={addTrecho} disabled={grupo.trechos.length >= 4}>
            <Plus className="w-4 h-4 mr-1" /> Trecho
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
                <th className="p-2 text-left">Trecho</th>
                <th className="p-2">Data</th>
                <th className="p-2">QTD ADT</th>
                <th className="p-2">QTD CHD</th>
                <th className="p-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {grupo.trechos.map((t, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-[var(--t-surface)]' : 'bg-[var(--t-surface-hover)]'}>
                  <td className="p-2 font-medium">Trecho {i + 1}</td>
                  <td className="p-2"><Input type="date" value={t.data || ''} onChange={e => updateTrecho(i, 'data', e.target.value || null)} className="h-8" /></td>
                  <td className="p-2"><Input type="number" min={0} value={t.qtd_adt || ''} onChange={e => updateTrecho(i, 'qtd_adt', parseInt(e.target.value) || 0)} className="h-8 w-20 text-center" /></td>
                  <td className="p-2"><Input type="number" min={0} value={t.qtd_chd || ''} onChange={e => updateTrecho(i, 'qtd_chd', parseInt(e.target.value) || 0)} className="h-8 w-20 text-center" /></td>
                  <td className="p-2">
                    {grupo.trechos.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => removeTrecho(i)} className="h-8 w-8 p-0 text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Navio */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--t-text)] mb-3">Cruzeiro (Navio)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><Label>Embarque</Label><Input type="date" value={grupo.navio_info.embarque || ''} onChange={e => updateNavio('embarque', e.target.value || null)} /></div>
          <div><Label>Desembarque</Label><Input type="date" value={grupo.navio_info.desembarque || ''} onChange={e => updateNavio('desembarque', e.target.value || null)} /></div>
          <div><Label>Diárias</Label><Input disabled value={calcDiarias(grupo.navio_info.embarque, grupo.navio_info.desembarque) || '—'} /></div>
          <div><Label>Cidade Embarque</Label><Input value={grupo.navio_info.cidade_embarque} onChange={e => updateNavio('cidade_embarque', e.target.value)} /></div>
          <div><Label>Cidade Desembarque</Label><Input value={grupo.navio_info.cidade_desembarque} onChange={e => updateNavio('cidade_desembarque', e.target.value)} /></div>
          <div><Label>Nome do Cruzeiro</Label><Input value={grupo.navio_info.nome_cruzeiro} onChange={e => updateNavio('nome_cruzeiro', e.target.value)} /></div>
        </div>
      </div>

      {/* Total Diárias */}
      <div className="bg-[var(--t-header-bg)] text-[var(--t-header-text)] p-4 rounded-lg flex items-center justify-between">
        <span className="font-semibold">Total de Diárias</span>
        <span className="text-2xl font-bold text-[var(--t-accent)]">{totalDiarias}</span>
      </div>

      {/* Parâmetros do roteiro — apenas o essencial pro modelo custo+venda */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--t-text)] mb-3">Parâmetros do roteiro</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <Label>Parcelas</Label>
            <Input
              type="number"
              step={1}
              min={1}
              value={grupo.params.parcelas}
              onChange={e => updateParams('parcelas', parseInt(e.target.value) || 1)}
            />
          </div>
          {(grupo.tipo ?? 'GRUPO') === 'GRUPO' && (
            <>
              <div>
                <Label>QTD Mín. PAX</Label>
                <Input
                  type="number"
                  step={1}
                  min={1}
                  value={grupo.params.qtd_min_pax}
                  onChange={e => updateParams('qtd_min_pax', parseInt(e.target.value) || 1)}
                />
              </div>
              <div>
                <Label>QTD Máx. PAX</Label>
                <Input
                  type="number"
                  step={1}
                  min={1}
                  value={grupo.params.qtd_max_pax}
                  onChange={e => updateParams('qtd_max_pax', parseInt(e.target.value) || 1)}
                />
              </div>
              <div>
                <Label>Cortesia</Label>
                <Input
                  type="number"
                  step={1}
                  min={0}
                  value={grupo.params.cortesia}
                  onChange={e => updateParams('cortesia', parseInt(e.target.value) || 0)}
                />
              </div>
              {grupo.params.cortesia > 0 && (
                <div>
                  <Label>Cortesia no apto</Label>
                  <select
                    value={grupo.params.cortesia_apto ?? 'dbl'}
                    onChange={e => update({
                      params: { ...grupo.params, cortesia_apto: e.target.value as 'sgl' | 'dbl' | 'tpl' | 'qdp' },
                    })}
                    className="flex h-10 w-full rounded-md border border-[var(--t-border)] bg-[var(--t-input-bg)] px-3 py-2 text-sm"
                  >
                    <option value="sgl">SGL</option>
                    <option value="dbl">DBL</option>
                    <option value="tpl">TPL</option>
                    <option value="qdp">QDP</option>
                  </select>
                </div>
              )}
            </>
          )}
        </div>

        {/* Configurações avançadas — só para quem usa o fluxo antigo de
            markup automático em vez de preço de venda manual. Default
            zerado em novos grupos. */}
        <details className="mt-4 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] overflow-hidden">
          <summary className="px-4 py-2.5 cursor-pointer text-sm text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] select-none">
            Configurações avançadas (markup e taxas — opcional)
          </summary>
          <div className="p-4 border-t border-[var(--t-border)]">
            <p className="text-xs text-[var(--t-text-muted)] mb-3">
              No modelo novo (preço de venda manual por item), estes campos não são usados.
              Mantenha em <strong>0</strong> para usar o fluxo simplificado. Para grupos legados
              com markup automático, edite aqui.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {([
                ['markup', 'Markup', 0.01],
                ['contrato', 'Contrato (R$)', 0.01],
                ['tx_ad_mp', 'TX AD MP', 0.0001],
                ['tx_boleto', 'TX Boleto (R$)', 0.01],
              ] as [string, string, number][]).map(([key, label, step]) => (
                <div key={key}>
                  <Label>{label}</Label>
                  <Input
                    type="number"
                    step={step}
                    value={grupo.params[key as keyof typeof grupo.params] as number}
                    onChange={e => updateParams(key, parseFloat(e.target.value) || 0)}
                  />
                </div>
              ))}
            </div>
          </div>
        </details>
      </div>

      {/* Câmbio por Serviço */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--t-text)] mb-3">Câmbio por Serviço</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
                <th className="p-2 text-left">Serviço</th>
                <th className="p-2">Câmbio</th>
                <th className="p-2">Moeda</th>
                <th className="p-2">Deadline</th>
              </tr>
            </thead>
            <tbody>
              {SERVICOS.map((s, i) => (
                <tr key={s} className={i % 2 === 0 ? 'bg-[var(--t-surface)]' : 'bg-[var(--t-surface-hover)]'}>
                  <td className="p-2 font-medium uppercase">{s}</td>
                  <td className="p-2">
                    <Input type="number" step={0.01} value={grupo.cambio[s]?.valor ?? 1} onChange={e => updateCambio(s, 'valor', parseFloat(e.target.value) || 1)} className="h-8 w-24" />
                  </td>
                  <td className="p-2">
                    <Select value={grupo.cambio[s]?.moeda || 'BRL'} onValueChange={v => updateCambio(s, 'moeda', v)}>
                      <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MOEDAS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-2">
                    <Input type="date" value={grupo.cambio[s]?.deadline || ''} onChange={e => updateCambio(s, 'deadline', e.target.value || null)} className="h-8" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Links Úteis */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--t-text)] mb-3">Links Úteis</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {['OP CRM', 'Pasta Drive', 'Check-list', 'PDF Roteiro', 'Form RSV', 'LP Conv.', 'LP Roteiro'].map(key => (
            <div key={key}>
              <Label>{key}</Label>
              <Input type="url" value={grupo.links[key] || ''} onChange={e => updateLink(key, e.target.value)} placeholder="https://..." className="h-8" />
            </div>
          ))}
        </div>
      </div>

      {/* Descrição */}
      <div>
        <Label>Descrição do Orçamento</Label>
        <Textarea
          value={grupo.descricao_orcamento}
          onChange={e => update({ descricao_orcamento: e.target.value })}
          placeholder="Descreva os itens inclusos na proposta..."
          rows={4}
        />
      </div>
    </div>
  );
}

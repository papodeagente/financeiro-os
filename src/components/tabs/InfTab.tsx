'use client';

import { GrupoViagem, Passageiro, SERVICOS, MOEDAS } from '@/lib/types';
import { createPassageiro, createPeriodo, createTrecho } from '@/lib/defaults';
import { calcDiarias } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Users, UserPlus, RefreshCw } from 'lucide-react';
import { toast } from '@/lib/toast';

interface Props {
  grupo: GrupoViagem;
  onChange: (grupo: GrupoViagem) => void;
}

export function InfTab({ grupo, onChange }: Props) {
  const update = (partial: Partial<GrupoViagem>) => onChange({ ...grupo, ...partial });

  // ---- Passageiros ---------------------------------------------------
  const passageiros: Passageiro[] = grupo.passageiros || [];
  const qtdAdt = passageiros.filter(p => p.tipo === 'ADT').length;
  const qtdChd = passageiros.filter(p => p.tipo === 'CHD').length;
  const totalPax = passageiros.length;

  const setPassageiros = (lista: Passageiro[]) => update({ passageiros: lista });

  const addPassageiro = (tipo: 'ADT' | 'CHD') => {
    setPassageiros([...passageiros, createPassageiro(tipo)]);
  };

  const updatePassageiro = (id: string, patch: Partial<Passageiro>) => {
    setPassageiros(passageiros.map(p => {
      if (p.id !== id) return p;
      const next = { ...p, ...patch };
      // Quando muda CHD→ADT, zera idade. Quando muda ADT→CHD, default 0.
      if (patch.tipo === 'ADT') next.idade = undefined;
      else if (patch.tipo === 'CHD' && next.idade === undefined) next.idade = 0;
      return next;
    }));
  };

  const removePassageiro = (id: string) => {
    setPassageiros(passageiros.filter(p => p.id !== id));
  };

  // Aplica os passageiros como fonte de verdade: preenche qtd_min_pax
  // (usado nos cálculos por pax) e qtd_adt/qtd_chd de cada trecho aéreo.
  const aplicarAosCalculos = () => {
    if (totalPax === 0) return;
    const trechosSync = grupo.trechos.map(t => ({ ...t, qtd_adt: qtdAdt, qtd_chd: qtdChd }));
    update({
      passageiros,
      trechos: trechosSync,
      params: { ...grupo.params, qtd_min_pax: totalPax },
    });
    toast.success(`${totalPax} passageiro${totalPax > 1 ? 's' : ''} aplicados`, `${qtdAdt} ADT · ${qtdChd} CHD em ${grupo.trechos.length} trecho${grupo.trechos.length !== 1 ? 's' : ''} aéreo${grupo.trechos.length !== 1 ? 's' : ''}`);
  };

  // ---- Períodos ------------------------------------------------------

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

      {/* Passageiros — fonte de verdade pra qtd_pax e qtd_adt/chd nos
          trechos. Disponível pra GRUPO e PROPOSTA (mesmo quando não é
          grupo o vendedor pode listar os pax da proposta com idades). */}
      <div className="border border-[var(--t-border)] bg-[var(--t-surface)] rounded-xl overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between border-b border-[var(--t-border)]">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--t-text-secondary)]" />
            <h3 className="text-sm font-semibold text-[var(--t-text)]">Passageiros</h3>
            {totalPax > 0 && (
              <span className="text-[11px] text-[var(--t-text-muted)] ml-2">
                {totalPax} {totalPax === 1 ? 'pessoa' : 'pessoas'} ·
                {' '}<b className="text-[var(--t-text-secondary)]">{qtdAdt}</b> adulto{qtdAdt !== 1 ? 's' : ''} ·
                {' '}<b className="text-[var(--t-text-secondary)]">{qtdChd}</b> criança{qtdChd !== 1 ? 's' : ''}
                {qtdChd > 0 && (
                  <>
                    {' '}<span className="text-[var(--t-text-muted)]">(idades {passageiros.filter(p => p.tipo === 'CHD').map(p => p.idade ?? 0).join(', ')})</span>
                  </>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => addPassageiro('ADT')} className="h-8">
              <UserPlus className="w-3.5 h-3.5 mr-1" /> Adulto
            </Button>
            <Button variant="outline" size="sm" onClick={() => addPassageiro('CHD')} className="h-8">
              <UserPlus className="w-3.5 h-3.5 mr-1" /> Criança
            </Button>
          </div>
        </div>

        {passageiros.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <Users className="w-6 h-6 text-[var(--t-text-muted)] mx-auto mb-2" />
            <p className="text-sm text-[var(--t-text-secondary)] mb-1">Nenhum passageiro cadastrado ainda.</p>
            <p className="text-xs text-[var(--t-text-muted)]">
              Liste todas as pessoas da proposta (adulto / criança com idade) para gerar o preço total por pessoa.
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-[var(--t-border)]">
              {passageiros.map((p, i) => (
                <div key={p.id} className="px-4 py-2.5 grid grid-cols-[24px_120px_minmax(120px,180px)_1fr_32px] items-center gap-3">
                  <div className="text-[11px] font-mono text-[var(--t-text-muted)] tabular-nums">{i + 1}.</div>
                  <select
                    value={p.tipo}
                    onChange={e => updatePassageiro(p.id, { tipo: e.target.value as 'ADT' | 'CHD' })}
                    className="h-8 px-2 rounded-md border border-[var(--t-border)] bg-[var(--t-input-bg)] text-sm text-[var(--t-text)]"
                  >
                    <option value="ADT">Adulto</option>
                    <option value="CHD">Criança</option>
                  </select>
                  {p.tipo === 'CHD' ? (
                    <select
                      value={p.idade ?? 0}
                      onChange={e => updatePassageiro(p.id, { idade: parseInt(e.target.value) })}
                      className="h-8 px-2 rounded-md border border-[var(--t-border)] bg-[var(--t-input-bg)] text-sm text-[var(--t-text)]"
                    >
                      {Array.from({ length: 13 }, (_, n) => (
                        <option key={n} value={n}>
                          {n === 0 ? 'Menor de 1 ano' : `${n} ${n === 1 ? 'ano' : 'anos'}`}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="h-8 flex items-center px-2 text-xs text-[var(--t-text-muted)]">
                      Idade adulta
                    </div>
                  )}
                  <Input
                    value={p.nome || ''}
                    onChange={e => updatePassageiro(p.id, { nome: e.target.value })}
                    placeholder="Nome (opcional)"
                    className="h-8"
                  />
                  <Button variant="ghost" size="sm" onClick={() => removePassageiro(p.id)} className="h-8 w-8 p-0 text-red-500" title="Remover passageiro">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="px-4 py-2.5 bg-[var(--t-surface-hover)] flex items-center justify-between gap-3 text-xs text-[var(--t-text-secondary)]">
              <span>
                Esses passageiros alimentam <b className="text-[var(--t-text)]">qtd. ADT/CHD</b> dos trechos aéreos e a <b className="text-[var(--t-text)]">qtd. de pax</b> usada nos cálculos por pessoa.
              </span>
              <Button variant="outline" size="sm" onClick={aplicarAosCalculos} className="h-8 shrink-0">
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Aplicar aos trechos
              </Button>
            </div>
          </>
        )}
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
              {grupo.periodos.map((p, i) => {
                // check_in mínimo: data de check_out do período anterior
                // (sequência cronológica). Para o 1º período, sem restrição.
                const checkInMin = i > 0 ? (grupo.periodos[i - 1]?.check_out || '') : '';
                // check_out deve ser depois do check_in deste período
                const checkOutMin = p.check_in
                  ? new Date(new Date(p.check_in).getTime() + 86400000).toISOString().split('T')[0]
                  : '';
                return (
                <tr key={i} className={i % 2 === 0 ? 'bg-[var(--t-surface)]' : 'bg-[var(--t-surface-hover)]'}>
                  <td className="p-2 font-medium">{i + 1}</td>
                  <td className="p-2">
                    <Input
                      type="date"
                      value={p.check_in || ''}
                      min={checkInMin}
                      onChange={e => updatePeriodo(i, 'check_in', e.target.value || null)}
                      className="h-8"
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      type="date"
                      value={p.check_out || ''}
                      min={checkOutMin}
                      onChange={e => updatePeriodo(i, 'check_out', e.target.value || null)}
                      disabled={!p.check_in}
                      title={!p.check_in ? 'Defina primeiro o check-in' : ''}
                      className="h-8"
                    />
                  </td>
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
                );
              })}
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
              {grupo.trechos.map((t, i) => {
                // Trechos seguem cronologicamente. 1º trecho = depois do
                // 1º check_in da viagem. Demais = depois do trecho anterior.
                const trechoMin = i > 0
                  ? (grupo.trechos[i - 1]?.data || '')
                  : (grupo.periodos[0]?.check_in || '');
                return (
                <tr key={i} className={i % 2 === 0 ? 'bg-[var(--t-surface)]' : 'bg-[var(--t-surface-hover)]'}>
                  <td className="p-2 font-medium">Trecho {i + 1}</td>
                  <td className="p-2">
                    <Input
                      type="date"
                      value={t.data || ''}
                      min={trechoMin}
                      onChange={e => updateTrecho(i, 'data', e.target.value || null)}
                      className="h-8"
                    />
                  </td>
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
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Navio */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--t-text)] mb-3">Cruzeiro (Navio)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Embarque</Label>
            <Input
              type="date"
              value={grupo.navio_info.embarque || ''}
              min={grupo.periodos[0]?.check_in || ''}
              onChange={e => updateNavio('embarque', e.target.value || null)}
            />
          </div>
          <div>
            <Label>Desembarque</Label>
            <Input
              type="date"
              value={grupo.navio_info.desembarque || ''}
              min={grupo.navio_info.embarque
                ? new Date(new Date(grupo.navio_info.embarque).getTime() + 86400000).toISOString().split('T')[0]
                : ''}
              disabled={!grupo.navio_info.embarque}
              title={!grupo.navio_info.embarque ? 'Defina primeiro o embarque' : ''}
              onChange={e => updateNavio('desembarque', e.target.value || null)}
            />
          </div>
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

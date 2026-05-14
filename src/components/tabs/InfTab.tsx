'use client';

import { GrupoViagem, Passageiro, MOEDAS } from '@/lib/types';
import { createPassageiro, createPeriodo, createTrecho } from '@/lib/defaults';
import { calcDiarias } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Users, UserPlus, RefreshCw } from 'lucide-react';
import { toast } from '@/lib/toast';

interface Props {
  grupo: GrupoViagem;
  onChange: (grupo: GrupoViagem) => void;
}

export function InfTab({ grupo, onChange }: Props) {
  const update = (partial: Partial<GrupoViagem>) => onChange({ ...grupo, ...partial });

  const tipo = grupo.tipo || 'GRUPO';
  const isGrupo = tipo === 'GRUPO';

  // ---- Passageiros (oculto para tipo GRUPO — neste momento o grupo
  //      ainda será vendido, importa apenas a qtd. de vagas disponíveis,
  //      gerenciada em Gestão de Grupos.) -----------------------------
  const passageiros: Passageiro[] = grupo.passageiros || [];
  const qtdAdt = passageiros.filter(p => p.tipo === 'ADT').length;
  const qtdChd = passageiros.filter(p => p.tipo === 'CHD').length;
  const totalPax = passageiros.length;

  const setPassageiros = (lista: Passageiro[]) => update({ passageiros: lista });

  const addPassageiro = (t: 'ADT' | 'CHD') => {
    setPassageiros([...passageiros, createPassageiro(t)]);
  };

  const updatePassageiro = (id: string, patch: Partial<Passageiro>) => {
    setPassageiros(passageiros.map(p => {
      if (p.id !== id) return p;
      const next = { ...p, ...patch };
      if (patch.tipo === 'ADT') next.idade = undefined;
      else if (patch.tipo === 'CHD' && next.idade === undefined) next.idade = 0;
      return next;
    }));
  };

  const removePassageiro = (id: string) => {
    setPassageiros(passageiros.filter(p => p.id !== id));
  };

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

  // ---- Data única da viagem -----------------------------------------
  // Em vez de uma tabela de múltiplos períodos, mantemos um intervalo
  // único (início → fim). Internamente continua sendo um array com 1
  // entrada; os hotéis, voos e demais serviços terão suas próprias
  // datas dentro deste intervalo, editáveis em cada aba.
  const periodoUnico = grupo.periodos[0] || createPeriodo();
  const dataInicio = periodoUnico.check_in || '';
  const dataFim = periodoUnico.check_out || '';

  const setData = (field: 'check_in' | 'check_out', value: string | null) => {
    const novoPeriodo = { ...periodoUnico, [field]: value };
    update({ periodos: [novoPeriodo] });
  };

  // ---- Trechos Aéreos -----------------------------------------------
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

  // ---- Navio --------------------------------------------------------
  const updateNavio = (field: string, value: string | null) => {
    update({ navio_info: { ...grupo.navio_info, [field]: value } });
  };

  const totalDiarias = calcDiarias(dataInicio, dataFim)
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

      {/* Passageiros — apenas para Personalizado e Operadora. Em GRUPO,
          os passageiros ainda não são nomeados (controlamos vagas). */}
      {!isGrupo && (
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
      )}

      {/* Data da viagem + Moeda */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--t-text)] mb-3">Data da viagem</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label>Início da viagem</Label>
            <Input
              type="date"
              value={dataInicio}
              onChange={e => setData('check_in', e.target.value || null)}
            />
          </div>
          <div>
            <Label>Fim da viagem</Label>
            <Input
              type="date"
              value={dataFim}
              min={dataInicio
                ? new Date(new Date(dataInicio).getTime() + 86400000).toISOString().split('T')[0]
                : ''}
              disabled={!dataInicio}
              title={!dataInicio ? 'Defina primeiro o início' : ''}
              onChange={e => setData('check_out', e.target.value || null)}
            />
          </div>
          <div>
            <Label>Diárias</Label>
            <Input disabled value={calcDiarias(dataInicio, dataFim) || '—'} />
          </div>
          <div>
            <Label>Moeda do produto</Label>
            <Select
              value={grupo.moeda || 'BRL'}
              onValueChange={v => update({ moeda: v as typeof MOEDAS[number] })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MOEDAS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-[var(--t-text-muted)] mt-2">
          As datas de hotéis, voos e demais serviços ficam dentro deste intervalo e podem ser editadas em cada aba. A proposta final é apresentada na moeda escolhida — sem conversão de câmbio.
        </p>
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
                const trechoMin = i > 0
                  ? (grupo.trechos[i - 1]?.data || '')
                  : (dataInicio || '');
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
              min={dataInicio || ''}
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
    </div>
  );
}

'use client';

/**
 * Painel direito do canvas. Renderiza formulário contextual ao node
 * selecionado — campos variam por categoria mas o shape do config é
 * unificado (campos não-usados ficam undefined).
 */

import type { Node } from '@xyflow/react';
import type { CategoriaNode, NodeConfig, TipoNode, DadosReaisAgencia } from '@/lib/funil-types';
import { CATEGORIA_INFO, tipoInfo } from './categorias';
import { MoneyInput } from '@/components/MoneyInput';

interface NodeData extends Record<string, unknown> {
  tipo: TipoNode;
  categoria: CategoriaNode;
  label: string;
  config: NodeConfig;
}

interface PainelConfigNodeProps {
  node: Node<NodeData>;
  onChange: (patch: Partial<NodeData>) => void;
  dadosReais?: DadosReaisAgencia | null;
  usarDadosReais: boolean;
}

export function PainelConfigNode({ node, onChange, dadosReais, usarDadosReais }: PainelConfigNodeProps) {
  const info = CATEGORIA_INFO[node.data.categoria];
  const config = node.data.config;

  const updateConfig = (patch: Partial<NodeConfig>) => {
    onChange({ config: { ...config, ...patch } });
  };

  return (
    <div className="space-y-4">
      {/* Cabeçalho com cor da categoria */}
      <div className="flex items-center gap-2 pb-2 border-b border-[var(--t-border)]">
        {(() => {
          const tInfo = tipoInfo(node.data.tipo);
          const TIcon = tInfo?.icone ?? info.icon;
          const brandColor = tInfo?.brandColor ?? info.color;
          return (
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: brandColor + '18' }}>
              <TIcon className="w-3.5 h-3.5" style={{ color: brandColor }} />
            </div>
          );
        })()}
        <div className="min-w-0">
          <p className="text-[10px] text-[var(--t-text-muted)] uppercase tracking-wider">{info.label}</p>
          <p className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)] truncate">
            {info.tipos.find(t => t.tipo === node.data.tipo)?.label ?? node.data.tipo}
          </p>
        </div>
      </div>

      {/* Nome */}
      <div>
        <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Nome</label>
        <input
          value={node.data.label}
          onChange={e => onChange({ label: e.target.value })}
          className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
        />
      </div>

      {/* Tráfego: visitantes + investimento */}
      {node.data.categoria === 'trafego' && (
        <>
          <Field label="Visitantes">
            <input
              type="number"
              min={0}
              value={config.visitantes ?? ''}
              onChange={e => updateConfig({ visitantes: parseFloat(e.target.value) || 0 })}
              className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
            />
          </Field>
          <Field label="Investimento (R$)">
            <MoneyInput
              value={config.investimento ?? null}
              onChange={v => updateConfig({ investimento: v ?? 0 })}
            />
          </Field>
          <Field label="CPC (R$)">
            <MoneyInput
              value={config.cpc ?? null}
              onChange={v => updateConfig({ cpc: v ?? 0 })}
            />
          </Field>
        </>
      )}

      {/* Captura/Nutrição/Qualificação/Proposta/Upsell: taxa */}
      {['captura', 'nutricao', 'qualificacao', 'proposta', 'upsell'].includes(node.data.categoria) && (
        <>
          <SliderField
            label="Taxa de conversão"
            value={config.taxa_conversao ?? 0}
            max={100}
            suffix="%"
            onChange={v => updateConfig({ taxa_conversao: v })}
          />
          {node.data.categoria === 'proposta' && usarDadosReais && dadosReais && dadosReais.taxa_proposta_aceita > 0 && (
            <button
              onClick={() => updateConfig({ taxa_conversao: dadosReais.taxa_proposta_aceita })}
              className="mt-1 text-[10px] text-[var(--t-green)] hover:underline"
              type="button"
            >
              Usar taxa real ({dadosReais.taxa_proposta_aceita.toFixed(1)}%)
            </button>
          )}
        </>
      )}

      {/* Nutrição: taxa de resposta/abertura */}
      {node.data.categoria === 'nutricao' && (
        <>
          <SliderField
            label="Taxa de resposta"
            value={config.taxa_resposta ?? 0}
            max={100}
            suffix="%"
            onChange={v => updateConfig({ taxa_resposta: v })}
          />
          <SliderField
            label="Taxa de abertura"
            value={config.taxa_abertura ?? 0}
            max={100}
            suffix="%"
            onChange={v => updateConfig({ taxa_abertura: v })}
          />
        </>
      )}

      {/* Proposta + Fechamento + Upsell: ticket + margem */}
      {(node.data.categoria === 'fechamento' || node.data.categoria === 'upsell') && (
        <>
          <SliderField
            label="Taxa de conversão"
            value={config.taxa_conversao ?? 0}
            max={100}
            suffix="%"
            onChange={v => updateConfig({ taxa_conversao: v })}
          />
          <Field label="Ticket / valor do produto (R$)">
            <MoneyInput
              value={config.valor_produto ?? null}
              onChange={v => updateConfig({ valor_produto: v ?? 0 })}
            />
            {usarDadosReais && dadosReais && dadosReais.ticket_medio > 0 && (
              <button
                onClick={() => updateConfig({ valor_produto: dadosReais.ticket_medio })}
                className="mt-1 text-[10px] text-[var(--t-green)] hover:underline"
                type="button"
              >
                Usar ticket médio real ({dadosReais.ticket_medio.toFixed(0)})
              </button>
            )}
          </Field>
          <SliderField
            label="Margem líquida"
            value={config.margem_liquida ?? 100}
            max={100}
            suffix="%"
            onChange={v => updateConfig({ margem_liquida: v })}
          />
        </>
      )}

      {/* Custos adicionais */}
      <Field label="Custo fixo (R$)">
        <MoneyInput
          value={config.custo_fixo ?? null}
          onChange={v => updateConfig({ custo_fixo: v ?? 0 })}
        />
      </Field>
      <Field label="Custo por unidade (R$)">
        <MoneyInput
          value={config.custo_por_unidade ?? null}
          onChange={v => updateConfig({ custo_por_unidade: v ?? 0 })}
        />
      </Field>

      {/* Observações */}
      <Field label="Observações">
        <textarea
          value={config.observacoes ?? ''}
          onChange={e => updateConfig({ observacoes: e.target.value })}
          rows={3}
          className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)] resize-none"
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">{label}</label>
      {children}
    </div>
  );
}

function SliderField({
  label, value, max, suffix, onChange,
}: {
  label: string; value: number; max: number; suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[var(--text-caption)] text-[var(--t-text-muted)]">{label}</label>
        <span className="text-[var(--text-caption)] font-semibold text-[var(--t-text)]">
          {value.toFixed(0)}{suffix}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-[var(--t-green)]"
      />
    </div>
  );
}

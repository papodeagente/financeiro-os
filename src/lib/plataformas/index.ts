import type { AdapterPlataforma, PlataformaId } from './tipos';
import { adapterAsaas } from './asaas';
import { adapterHotmart } from './hotmart';
import { adapterPagarme } from './pagarme';

/** Registro dos adapters. Plataforma nova entra AQUI e em mais lugar
 *  nenhum: nem o webhook, nem a tela, nem o financeiro mudam. */
export const ADAPTERS: Record<PlataformaId, AdapterPlataforma> = {
  hotmart: adapterHotmart,
  asaas: adapterAsaas,
  pagarme: adapterPagarme,
};

export function acharAdapter(id: string): AdapterPlataforma | null {
  return (ADAPTERS as Record<string, AdapterPlataforma>)[id] ?? null;
}

export const PLATAFORMAS = Object.values(ADAPTERS).map(a => ({
  id: a.id,
  nome: a.nome,
  campos: a.camposCredencial(),
  capacidades: a.capacidades,
}));

export * from './tipos';

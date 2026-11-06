/**
 * Adaptadores conhecidos. O domínio procura aqui pelo `provedor` (opaco) e
 * decide pelas capacidades, nunca pelo nome do banco. Banco novo = um
 * adaptador novo nesta lista, nada mais.
 */
import type { AdaptadorBancario, CampoCredencial, ApresentacaoDoProvedor, Capacidades } from './contrato';
import { adaptadorArquivo } from './adaptador-arquivo';
import { adaptadorInter } from './adaptador-inter';

const ADAPTADORES: readonly AdaptadorBancario[] = [adaptadorInter, adaptadorArquivo];

export function adaptadorDe(provedor: string): AdaptadorBancario | null {
  return ADAPTADORES.find(a => a.id === provedor) ?? null;
}

export interface ProvedorParaTela {
  id: string;
  apresentacao: ApresentacaoDoProvedor;
  capacidades: Capacidades;
  campos: CampoCredencial[];
}

/** Os que coletam sozinhos: é a lista que a tela de conexão oferece. */
export function provedoresDeColeta(): ProvedorParaTela[] {
  return ADAPTADORES.filter(a => a.capacidades.coletaAutomatica).map(a => ({
    id: a.id, apresentacao: a.apresentacao, capacidades: a.capacidades, campos: a.camposCredencial(),
  }));
}

/**
 * Telas dos módulos da versão completa (14/11/2026). Chamada no layout da
 * pasta de cada prefixo de TELAS_DOS_MODULOS (modulos.ts): a agência sem o
 * módulo vê a página 404 do sistema, como se a tela não existisse. O menu e
 * o ⌘K já não mostram; isto barra quem digita o endereço.
 *
 *   export default async function Layout({ children }) {
 *     await exigirModuloNaTela('cobranca');
 *     return children;
 *   }
 */
import { notFound } from 'next/navigation';
import { getSession } from './auth';
import { temModulo } from './modulos-servidor';
import type { ModuloId } from './modulos';

export async function exigirModuloNaTela(id: ModuloId): Promise<void> {
  const sessao = await getSession();
  const tenantId = sessao?.impersonatingTenantId || sessao?.tenantId || '';
  if (!tenantId || !(await temModulo(tenantId, id))) notFound();
}

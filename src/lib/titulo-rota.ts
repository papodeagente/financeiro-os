/**
 * Peças comuns das rotas /api/titulos/[tabela]/[id]/... (E7, frente D).
 * `tabela` no endereço: "pagar" ou "receber".
 */
import { NextResponse } from 'next/server';
import pool from './db';
import { getSession } from './auth';
import type { TabelaDoTitulo } from './contas-excluidas';
import { tituloForaDasEmpresas, type ExecutorEmpresas } from './empresas-servidor';

export function tabelaDoEndereco(v: string): TabelaDoTitulo | null {
  if (v === 'pagar' || v === 'contas_pagar' || v === 'contas-pagar') return 'contas_pagar';
  if (v === 'receber' || v === 'contas_receber' || v === 'contas-receber') return 'contas_receber';
  return null;
}

/** Título de empresa não liberada para a pessoa: como se não existisse (E7, G2). */
export async function tituloEscondido(tabela: TabelaDoTitulo, id: string): Promise<boolean> {
  if (!pool) return false;
  return tituloForaDasEmpresas(pool as unknown as ExecutorEmpresas, await getSession(), tabela, id);
}

export const naoAchado = () => NextResponse.json({ error: 'Esta conta não existe ou não está liberada para você.' }, { status: 404 });

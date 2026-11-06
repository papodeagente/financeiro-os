'use client';

/**
 * Dados da tela de extrato automático: conexões (sem segredo nenhum), contas
 * liberadas, bancos que leem sozinhos e o que a pessoa pode fazer. Quem
 * decide é o servidor; a tela só esconde o botão que não serviria.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ConexaoBancaria, LeituraDoHistorico, ResultadoLeitura } from '@/lib/extrato-automatico/servidor';
import type { ProvedorParaTela } from '@/lib/extrato-automatico/registro';

export type { ConexaoBancaria, LeituraDoHistorico, ProvedorParaTela };

export interface ContaLiberada {
  id: string;
  nome: string;
  moeda: string;
}

export interface DadosDoExtratoAutomatico {
  conexoes: ConexaoBancaria[];
  contas: ContaLiberada[];
  provedores: ProvedorParaTela[];
  cofre_disponivel: boolean;
  pode_conectar: boolean;
  pode_ler: boolean;
}

export type RespostaDaLeitura = ResultadoLeitura & { conexao?: ConexaoBancaria | null; error?: string };

export function useExtratoAutomatico(opcoes: { silencioso403?: boolean } = {}) {
  const [dados, setDados] = useState<DadosDoExtratoAutomatico | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro' | 'sem-acesso'>('carregando');
  const [erro, setErro] = useState<string | null>(null);
  const { silencioso403 = false } = opcoes;

  /** Busca sem tocar no estado; quem chama aplica (no efeito, só no retorno). */
  const buscar = useCallback(async (): Promise<
    { tipo: 'ok'; dados: DadosDoExtratoAutomatico } | { tipo: 'sem-acesso' | 'erro'; mensagem: string }
  > => {
    try {
      const r = await fetch('/api/extrato-automatico', { cache: 'no-store' });
      const j = await r.json().catch(() => null);
      if (r.status === 403 || r.status === 401) return { tipo: 'sem-acesso', mensagem: j?.error ?? 'Seu acesso não inclui o extrato automático.' };
      if (!r.ok) return { tipo: 'erro', mensagem: j?.error ?? 'Não foi possível carregar as conexões.' };
      return { tipo: 'ok', dados: j as DadosDoExtratoAutomatico };
    } catch {
      return { tipo: 'erro', mensagem: 'Não foi possível carregar as conexões.' };
    }
  }, []);

  const aplicar = useCallback((r: Awaited<ReturnType<typeof buscar>>) => {
    if (r.tipo === 'ok') {
      setDados(r.dados);
      setErro(null);
      setEstado('ok');
      return;
    }
    setEstado(r.tipo);
    setErro(r.tipo === 'sem-acesso' && silencioso403 ? null : r.mensagem);
  }, [silencioso403]);

  const recarregar = useCallback(async () => {
    aplicar(await buscar());
  }, [aplicar, buscar]);

  useEffect(() => {
    let vivo = true;
    void buscar().then(r => { if (vivo) aplicar(r); });
    return () => { vivo = false; };
  }, [buscar, aplicar]);

  return { dados, estado, erro, recarregar };
}

/** "Ler agora": a mesma leitura da tarefa de hora em hora. */
export async function lerAgora(conexaoId: string): Promise<{ ok: boolean; status: number; corpo: RespostaDaLeitura }> {
  const r = await fetch(`/api/extrato-automatico/${encodeURIComponent(conexaoId)}/sincronizar`, { method: 'POST' });
  const corpo = (await r.json().catch(() => ({ resultado: 'falhou', mensagem: 'Resposta inesperada.' }))) as RespostaDaLeitura;
  return { ok: r.ok, status: r.status, corpo };
}

/** Frase curta do resultado de uma leitura, para o aviso na tela. */
export function fraseDaLeitura(r: RespostaDaLeitura): { tom: 'sucesso' | 'info' | 'erro'; titulo: string; detalhe?: string } {
  if (r.resultado === 'ok') {
    if (r.inseridas === 0 && r.atualizadas === 0) return { tom: 'info', titulo: 'Extrato lido: nada novo', detalhe: 'Tudo o que o banco mostrou já estava na conciliação.' };
    const n = r.inseridas;
    return {
      tom: 'sucesso',
      titulo: n === 1 ? 'Extrato lido: 1 lançamento novo' : `Extrato lido: ${n.toLocaleString('pt-BR')} lançamentos novos`,
      detalhe: r.parcial ? 'Parte do período fica para a próxima leitura, que sai sozinha em minutos.' : 'Já estão na conciliação, esperando a conferência.',
    };
  }
  if (r.resultado === 'falhou') return { tom: 'erro', titulo: 'A leitura não deu certo', detalhe: r.mensagem };
  return { tom: 'info', titulo: 'mensagem' in r && r.mensagem ? r.mensagem : (r.error ?? 'Nada a ler agora.') };
}

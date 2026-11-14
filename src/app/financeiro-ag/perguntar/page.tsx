import { TelaDePerguntar } from './TelaDePerguntar';

/**
 * Perguntar em texto (E7, fechamento). A caixa da visão geral, em tela
 * própria, para o ⌘K abrir: /financeiro-ag/perguntar?q=<pergunta> já
 * pergunta ao abrir.
 */
export default async function PerguntarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = (await searchParams).q;
  const inicial = (Array.isArray(q) ? q[0] : q ?? '').slice(0, 500);
  return <TelaDePerguntar inicial={inicial} />;
}

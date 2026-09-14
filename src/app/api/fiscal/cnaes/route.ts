import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';

/**
 * Busca de CNAE pelo que a empresa faz.
 *
 * A fonte é o IBGE, que é quem mantém a tabela. São 1.332 subclasses e 3,6 MB:
 * a lista é carregada uma vez e fica em memória do servidor, como a de
 * municípios. Sem isto, a agência teria que sair da tela para descobrir o
 * código numa consulta externa e voltar para colar sete dígitos.
 */

interface Cnae {
  codigo: string;
  descricao: string;
  /** Descrição da classe acima, para desempatar códigos parecidos. */
  grupo: string;
  busca: string;
}

const URL_IBGE = 'https://servicodados.ibge.gov.br/api/v2/cnae/subclasses';

let cache: Cnae[] | null = null;
let carregando: Promise<Cnae[]> | null = null;

function semAcento(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function aninhado(o: unknown, ...chaves: string[]): string {
  const v = chaves.reduce<unknown>(
    (acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined),
    o,
  );
  return typeof v === 'string' ? v : '';
}

async function listaDeCnaes(): Promise<Cnae[]> {
  if (cache) return cache;
  if (carregando) return carregando;

  carregando = (async () => {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), 25_000);
    try {
      const res = await fetch(URL_IBGE, { signal: controle.signal });
      if (!res.ok) throw new Error(`IBGE respondeu ${res.status}`);
      const bruto = (await res.json()) as Array<Record<string, unknown>>;
      const lista: Cnae[] = bruto.map(c => {
        const codigo = String(c.id ?? '').replace(/\D+/g, '');
        const descricao = String(c.descricao ?? '');
        const grupo = aninhado(c, 'classe', 'grupo', 'descricao')
          || aninhado(c, 'classe', 'descricao');
        return {
          codigo,
          descricao,
          grupo,
          // O código entra na busca para quem já sabe o número achar direto.
          busca: semAcento(`${descricao} ${grupo} ${codigo}`),
        };
      }).filter(c => c.codigo.length === 7 && c.descricao);
      if (lista.length === 0) throw new Error('IBGE devolveu lista vazia');
      cache = lista;
      return lista;
    } finally {
      clearTimeout(timer);
      carregando = null;
    }
  })();

  return carregando;
}

/** Formata 7911200 como 7911-2/00, que é como o CNAE aparece em documento. */
function formatar(codigo: string): string {
  if (codigo.length !== 7) return codigo;
  return `${codigo.slice(0, 4)}-${codigo.slice(4, 5)}/${codigo.slice(5)}`;
}

export async function GET(req: Request) {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });

    const termo = semAcento(new URL(req.url).searchParams.get('busca') ?? '');
    if (termo.length < 2) return NextResponse.json({ cnaes: [] });

    const lista = await listaDeCnaes();
    const digitos = termo.replace(/\D+/g, '');
    const achados = lista
      .filter(c => (digitos ? c.codigo.includes(digitos) : c.busca.includes(termo)))
      .sort((a, b) => {
        // Quem começa com o termo vem antes do que só o contém no meio.
        const aComeca = semAcento(a.descricao).startsWith(termo) ? 0 : 1;
        const bComeca = semAcento(b.descricao).startsWith(termo) ? 0 : 1;
        if (aComeca !== bComeca) return aComeca - bComeca;
        return a.descricao.localeCompare(b.descricao, 'pt-BR');
      })
      .slice(0, 30)
      .map(c => ({
        codigo: c.codigo,
        formatado: formatar(c.codigo),
        descricao: c.descricao,
        grupo: c.grupo,
      }));

    return NextResponse.json({ cnaes: achados });
  } catch (e) {
    // IBGE fora do ar não trava o cadastro: o campo continua aceitando o
    // código digitado à mão.
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json(
      { cnaes: [], error: `Não foi possível consultar a tabela CNAE agora (${msg}).` },
      { status: 200 },
    );
  }
}

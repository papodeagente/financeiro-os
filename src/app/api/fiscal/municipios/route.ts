import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';

/**
 * Busca de municípios pelo nome, para a agência não ter que saber o código
 * IBGE de cabeça.
 *
 * A fonte é o IBGE, que é quem define o código. A lista inteira tem 5.571
 * municípios e 2,4 MB: baixar a cada tecla digitada seria absurdo, então ela
 * é carregada uma vez e fica em memória do servidor. Se o IBGE estiver fora,
 * a tela continua aceitando o código digitado à mão.
 */

interface Municipio {
  ibge: string;
  nome: string;
  uf: string;
  /** Nome sem acento e em minúsculas, para a busca não depender de digitação. */
  busca: string;
}

const URL_IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios';

let cache: Municipio[] | null = null;
let carregando: Promise<Municipio[]> | null = null;

function semAcento(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Lê um caminho aninhado sem estourar quando falta um nível. */
function aninhado(o: unknown, ...chaves: string[]): unknown {
  return chaves.reduce<unknown>(
    (acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined),
    o,
  );
}

/**
 * A sigla da UF vive em dois caminhos diferentes na resposta do IBGE
 * (microrregiao e regiao-imediata). Ler só um deixaria municípios sem estado.
 */
function siglaDaUF(m: unknown): string {
  const porMicro = aninhado(m, 'microrregiao', 'mesorregiao', 'UF', 'sigla');
  if (typeof porMicro === 'string' && porMicro) return porMicro;
  const porImediata = aninhado(m, 'regiao-imediata', 'regiao-intermediaria', 'UF', 'sigla');
  return typeof porImediata === 'string' ? porImediata : '';
}

async function listaDeMunicipios(): Promise<Municipio[]> {
  if (cache) return cache;
  // Duas buscas simultâneas na primeira carga não podem virar dois downloads
  // de 2,4 MB: a segunda espera a promessa da primeira.
  if (carregando) return carregando;

  carregando = (async () => {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), 20_000);
    try {
      const res = await fetch(URL_IBGE, { signal: controle.signal });
      if (!res.ok) throw new Error(`IBGE respondeu ${res.status}`);
      const bruto = (await res.json()) as Array<Record<string, unknown>>;
      const lista: Municipio[] = bruto.map(m => {
        const nome = String(m.nome ?? '');
        return {
          ibge: String(m.id ?? ''),
          nome,
          uf: siglaDaUF(m),
          busca: semAcento(nome),
        };
      }).filter(m => m.ibge.length === 7 && m.nome);
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

export async function GET(req: Request) {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });

    const url = new URL(req.url);
    const termo = semAcento(url.searchParams.get('busca') ?? '');
    const uf = String(url.searchParams.get('uf') ?? '').toUpperCase().slice(0, 2);

    if (termo.length < 2 && !uf) {
      return NextResponse.json({ municipios: [] });
    }

    const lista = await listaDeMunicipios();
    const achados = lista
      .filter(m => (!uf || m.uf === uf) && (!termo || m.busca.includes(termo)))
      // Quem começa com o termo vem antes: "Rio de Janeiro" antes de
      // "Barra do Rio", que é o que a pessoa espera ao digitar "rio".
      .sort((a, b) => {
        const aComeca = a.busca.startsWith(termo) ? 0 : 1;
        const bComeca = b.busca.startsWith(termo) ? 0 : 1;
        if (aComeca !== bComeca) return aComeca - bComeca;
        return a.nome.localeCompare(b.nome, 'pt-BR');
      })
      .slice(0, 30)
      .map(m => ({ ibge: m.ibge, nome: m.nome, uf: m.uf }));

    return NextResponse.json({ municipios: achados });
  } catch (e) {
    // Falha do IBGE não pode travar a configuração: a tela continua
    // aceitando o código digitado à mão.
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json(
      { municipios: [], error: `Não foi possível consultar o IBGE agora (${msg}).` },
      { status: 200 },
    );
  }
}

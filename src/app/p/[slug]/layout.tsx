import type { Metadata } from 'next';
import pool, { initDB } from '@/lib/db';
import { resolverPropostaPublica, type Consulta } from '@/lib/proposta-publica';

interface Props {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    await initDB();
    if (!pool) return { title: 'Proposta de Viagem' };

    // O slug é o token público da proposta: precisa casar por igualdade e
    // ter o formato validado, como já fazem as rotas de API.
    //
    // O LIKE com o slug cru transformava esta página num oráculo de
    // prefixo: '/p/%' casava com QUALQUER proposta de QUALQUER agência, e
    // '/p/ab%' respondia com o título real ou "não encontrada", permitindo
    // descobrir um id inteiro caractere a caractere. De posse do id, a
    // proposta completa (valores, cliente, aceite, leads) sai pela rota
    // pública que a serve.
    const r = await resolverPropostaPublica(pool as unknown as Consulta, slug);
    if (!r) return { title: 'Proposta nao encontrada' };
    const proposta = r.data as { cabecalho?: { titulo?: string; subtitulo?: string }; visual?: { imagem_capa?: string } };

    const titulo = proposta.cabecalho?.titulo || 'Proposta de Viagem';
    const subtitulo = proposta.cabecalho?.subtitulo || 'Confira sua proposta personalizada';
    const imagemCapa = proposta.visual?.imagem_capa || undefined;

    return {
      title: titulo,
      description: subtitulo,
      openGraph: {
        title: titulo,
        description: subtitulo,
        type: 'website',
        ...(imagemCapa ? { images: [{ url: imagemCapa, width: 1200, height: 630 }] } : {}),
      },
    };
  } catch {
    return { title: 'Proposta de Viagem' };
  }
}

export default function PublicPropostaLayout({ children }: Props) {
  return <>{children}</>;
}

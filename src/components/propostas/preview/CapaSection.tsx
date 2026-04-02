import { Proposta } from '@/lib/crm-types';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';

interface Props {
  proposta: Proposta;
}

export function CapaSection({ proposta }: Props) {
  const { visual, cabecalho } = proposta;
  const corPrimaria = visual.cor_primaria || '#00F0FF';
  const i18n = t((proposta.idioma || 'pt-BR') as IdiomaProposal);

  if (visual.estilo_capa === 'FULLSCREEN' && visual.imagem_capa) {
    return (
      <div className="relative h-[70vh] min-h-[400px] flex items-center justify-center overflow-hidden">
        <img
          src={visual.imagem_capa}
          alt={cabecalho.titulo}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative text-center text-white px-6 max-w-3xl">
          <h1 className="text-4xl md:text-5xl font-bold leading-tight drop-shadow-lg">
            {cabecalho.titulo || i18n.suaProposta}
          </h1>
          {cabecalho.subtitulo && (
            <p className="text-xl md:text-2xl mt-4 opacity-90 drop-shadow">{cabecalho.subtitulo}</p>
          )}
        </div>
      </div>
    );
  }

  if (visual.estilo_capa === 'SPLIT' && visual.imagem_capa) {
    return (
      <div className="flex flex-col md:flex-row min-h-[400px]">
        <div className="flex-1 flex items-center justify-center p-8 md:p-12" style={{ backgroundColor: corPrimaria }}>
          <div className="text-white max-w-lg">
            <h1 className="text-3xl md:text-4xl font-bold leading-tight">
              {cabecalho.titulo || i18n.suaProposta}
            </h1>
            {cabecalho.subtitulo && (
              <p className="text-lg mt-4 opacity-90">{cabecalho.subtitulo}</p>
            )}
          </div>
        </div>
        <div className="flex-1">
          <img
            src={visual.imagem_capa}
            alt={cabecalho.titulo}
            className="w-full h-full object-cover min-h-[300px]"
          />
        </div>
      </div>
    );
  }

  // MINIMAL or no image
  return (
    <div className="py-16 md:py-24 px-6 text-center" style={{ backgroundColor: corPrimaria }}>
      <div className="max-w-3xl mx-auto text-white">
        <h1 className="text-3xl md:text-5xl font-bold leading-tight">
          {cabecalho.titulo || i18n.suaProposta}
        </h1>
        {cabecalho.subtitulo && (
          <p className="text-lg md:text-xl mt-4 opacity-90">{cabecalho.subtitulo}</p>
        )}
        {cabecalho.data_proposta && (
          <p className="text-sm mt-6 opacity-60">
            {new Date(cabecalho.data_proposta + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
        )}
      </div>
    </div>
  );
}

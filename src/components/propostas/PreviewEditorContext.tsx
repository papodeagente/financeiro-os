'use client';

import { createContext, useContext } from 'react';

// Context que sinaliza pros renderers de preview (AccommodationSummary,
// TransportSummary, etc.) que estamos dentro do EDITOR. Quando o
// callback onBlockSelect e provido, clicks nos elementos rendereiros
// disparam selecao do bloco no editor (vs comportamento padrao de
// abrir modal / expandir).
//
// blockType identifica como o conteudoId deve ser mapeado de volta
// para o SecaoProposta.id no PropostaEditor.
export type PreviewEditorBlockType =
  | 'ALOJAMENTO'
  | 'VOO_OR_TRANSPORTE'
  | 'VALORES_OR_INCLUSOS'
  | 'ROTEIRO_DIA'
  // SECAO_ID: o conteudoId passado JA e a secao.id (vs conteudo.id
  // que e o caso de ALOJAMENTO etc.). Usado pelos wrappers genericos
  // de TEXTO, FAQ, DEPOIMENTO, GALERIA, VIDEO etc.
  | 'SECAO_ID';

interface PreviewEditorContextValue {
  // Quando definido, o preview esta sendo renderizado dentro do editor.
  // Renderers devem chamar essa funcao no click ao inves do
  // comportamento publico (modal, expand, scroll, etc).
  onBlockSelect?: (blockType: PreviewEditorBlockType, conteudoId: string) => void;
}

const PreviewEditorContext = createContext<PreviewEditorContextValue>({});

export const PreviewEditorProvider = PreviewEditorContext.Provider;
export const usePreviewEditor = () => useContext(PreviewEditorContext);

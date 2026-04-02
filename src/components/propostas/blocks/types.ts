export interface BlockProps {
  conteudo: Record<string, unknown>;
  onChange: (conteudo: Record<string, unknown>) => void;
}

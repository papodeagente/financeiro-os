export interface TemaProposta {
  id: string;
  nome: string;
  descricao: string;
  cor_primaria: string;
  cor_secundaria: string;
  cor_texto: string;
  cor_fundo: string;
  fonte: string;
  preview_gradient: string;
}

export const TEMAS: TemaProposta[] = [
  {
    id: 'padrao',
    nome: 'Padrao',
    descricao: 'Verde e branco classico',
    cor_primaria: '#10b981',
    cor_secundaria: '#0a0a14',
    cor_texto: '#1a1a2e',
    cor_fundo: '#ffffff',
    fonte: 'Inter',
    preview_gradient: 'linear-gradient(135deg, #10b981 0%, #ffffff 100%)',
  },
  {
    id: 'oceano',
    nome: 'Oceano',
    descricao: 'Azul profundo e turquesa',
    cor_primaria: '#0ea5e9',
    cor_secundaria: '#0c4a6e',
    cor_texto: '#0c4a6e',
    cor_fundo: '#f0f9ff',
    fonte: 'Inter',
    preview_gradient: 'linear-gradient(135deg, #0ea5e9 0%, #f0f9ff 100%)',
  },
  {
    id: 'romance',
    nome: 'Romance',
    descricao: 'Rosa e dourado elegante',
    cor_primaria: '#e11d48',
    cor_secundaria: '#881337',
    cor_texto: '#4a0519',
    cor_fundo: '#fff1f2',
    fonte: 'Playfair Display',
    preview_gradient: 'linear-gradient(135deg, #e11d48 0%, #fff1f2 100%)',
  },
  {
    id: 'luxo',
    nome: 'Luxo',
    descricao: 'Preto e dourado sofisticado',
    cor_primaria: '#d4a853',
    cor_secundaria: '#1a1a1a',
    cor_texto: '#e5e5e5',
    cor_fundo: '#0a0a0a',
    fonte: 'Playfair Display',
    preview_gradient: 'linear-gradient(135deg, #d4a853 0%, #0a0a0a 100%)',
  },
  {
    id: 'natureza',
    nome: 'Natureza',
    descricao: 'Verde oliva e terra',
    cor_primaria: '#65a30d',
    cor_secundaria: '#3f6212',
    cor_texto: '#1a2e05',
    cor_fundo: '#f7fee7',
    fonte: 'Inter',
    preview_gradient: 'linear-gradient(135deg, #65a30d 0%, #f7fee7 100%)',
  },
  {
    id: 'sunset',
    nome: 'Sunset',
    descricao: 'Laranja e roxo vibrante',
    cor_primaria: '#f97316',
    cor_secundaria: '#7c3aed',
    cor_texto: '#1e1b4b',
    cor_fundo: '#fffbeb',
    fonte: 'Inter',
    preview_gradient: 'linear-gradient(135deg, #f97316 0%, #7c3aed 100%)',
  },
  {
    id: 'minimalista',
    nome: 'Minimalista',
    descricao: 'Cinza suave e clean',
    cor_primaria: '#6b7280',
    cor_secundaria: '#374151',
    cor_texto: '#111827',
    cor_fundo: '#f9fafb',
    fonte: 'Inter',
    preview_gradient: 'linear-gradient(135deg, #6b7280 0%, #f9fafb 100%)',
  },
  {
    id: 'tropical',
    nome: 'Tropical',
    descricao: 'Turquesa e coral',
    cor_primaria: '#14b8a6',
    cor_secundaria: '#fb7185',
    cor_texto: '#134e4a',
    cor_fundo: '#f0fdfa',
    fonte: 'Inter',
    preview_gradient: 'linear-gradient(135deg, #14b8a6 0%, #fb7185 100%)',
  },
];

export function getTemaPorId(id: string): TemaProposta | undefined {
  return TEMAS.find(t => t.id === id);
}

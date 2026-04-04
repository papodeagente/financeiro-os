import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function minPositivo(valores: (number | null | undefined)[]): number {
  const positivos = valores.filter((v): v is number => v !== null && v !== undefined && v > 0);
  return positivos.length > 0 ? Math.min(...positivos) : 0;
}

export function calcDiarias(checkIn: string | null, checkOut: string | null): number {
  if (!checkIn || !checkOut) return 0;
  const d1 = new Date(checkIn);
  const d2 = new Date(checkOut);
  const diff = Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function parseBRL(str: string): number | null {
  if (!str || str === '\u2014') return null;
  const cleaned = str.replace(/[R$\s.]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

export function formatDate(date: string | null): string {
  if (!date) return '\u2014';
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString('pt-BR');
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

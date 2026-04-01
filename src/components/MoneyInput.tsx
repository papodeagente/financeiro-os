'use client';

import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';

interface MoneyInputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  className?: string;
  placeholder?: string;
  highlight?: boolean;
}

export function MoneyInput({ value, onChange, className = '', placeholder = 'R$ 0,00', highlight = false }: MoneyInputProps) {
  const [focused, setFocused] = useState(false);
  const [displayValue, setDisplayValue] = useState('');

  const formatForDisplay = useCallback((v: number | null): string => {
    if (v === null || v === 0) return '';
    return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }, []);

  const handleFocus = () => {
    setFocused(true);
    setDisplayValue(value ? value.toString().replace('.', ',') : '');
  };

  const handleBlur = () => {
    setFocused(false);
    setDisplayValue('');
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDisplayValue(raw);
    const cleaned = raw.replace(/[^\d,.-]/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    onChange(isNaN(num) ? null : num);
  };

  return (
    <Input
      type="text"
      inputMode="decimal"
      className={`text-right h-8 text-sm ${highlight ? 'bg-green-50 font-bold border-green-400' : ''} ${className}`}
      placeholder={placeholder}
      value={focused ? displayValue : formatForDisplay(value)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={handleChange}
    />
  );
}

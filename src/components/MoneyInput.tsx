'use client';

import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { parseMoneyBR } from '@/lib/money';

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
    // Mantém o mesmo texto pt-BR que estava visível (com milhar) — o parser
    // aceita "1.234,56" de volta sem perder as casas.
    setDisplayValue(formatForDisplay(value));
  };

  const handleBlur = () => {
    setFocused(false);
    setDisplayValue('');
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDisplayValue(raw);
    // parseMoneyBR entende milhar e decimal ("1.500" = 1500, "1.234,56" = 1234.56)
    onChange(parseMoneyBR(raw));
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

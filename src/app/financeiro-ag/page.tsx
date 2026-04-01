'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function FinanceiroAgPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/financeiro-ag/receber'); }, [router]);
  return null;
}

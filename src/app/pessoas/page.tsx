'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function PessoasPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/pessoas/clientes'); }, [router]);
  return null;
}

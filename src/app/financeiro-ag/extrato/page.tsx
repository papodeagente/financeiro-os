'use client';

import { TelaDeMovimentos } from './TelaDeMovimentos';

/** Extrato de conta (05/11/2026): uma ou várias contas, com saldo linha a linha. */
export default function ExtratoDeContaPage() {
  return <TelaDeMovimentos leiaute="extrato" />;
}

/**
 * Landing page publica do Entur OS Financeiro.
 *
 * - Renderiza marketing pra anonimos.
 * - Logged-in users sao redirecionados pra /dashboard via client-side
 *   (depois do mount). O middleware NAO bloqueia '/' pra logged-in;
 *   eles veem a LP brevemente antes do replace().
 *
 * Estrutura:
 *   Hero + CTA -> features -> planos (dinamico /api/planos) -> CTA final.
 */

import { LandingClient } from '@/components/landing/LandingClient';

export const dynamic = 'force-dynamic'; // sempre renderiza fresh

export default function HomePage() {
  return <LandingClient />;
}

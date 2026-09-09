import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { EmissorAceleraAPI } from '@/lib/nfse-acelera';

/**
 * O município da agência já emite pelo padrão nacional?
 *
 * A consulta na AceleraAPI é pública e não gasta crédito, mas esta rota
 * continua exigindo sessão: ela existe para a tela de configuração, e abrir
 * um proxy anônimo para fora seria dar um caminho de saída gratuito para
 * quem não está autenticado.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ ibge: string }> }) {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const { ibge } = await params;
    const codigo = String(ibge ?? '').replace(/\D+/g, '');
    if (codigo.length !== 7) {
      return NextResponse.json(
        { error: 'O código IBGE do município tem 7 dígitos.' },
        { status: 400 },
      );
    }
    const r = await new EmissorAceleraAPI().municipioEmite(codigo);
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

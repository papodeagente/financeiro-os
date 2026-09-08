import { redirect } from 'next/navigation';

/**
 * A equipe deixou de ter cadastro próprio.
 *
 * Esta tela gravava em `membros`, um cadastro paralelo ao time real de
 * `usuarios`. As duas listas nunca se encontravam: a venda do CRM gravava
 * vendedor_id apontando para `usuarios` e a comissão procurava em
 * `membros`, então nenhuma venda do CRM gerava comissão e a tela de
 * comissões oferecia vendedor que não era ninguém do time.
 *
 * Agora existe uma lista só. Quem cadastra pessoa é Configurações,
 * Usuários; quem define plano e meta é Equipe, Vendedores e planos.
 * Manter esta tela viva recriaria a duplicidade no primeiro cadastro novo.
 */
export default function EquipeLegadoPage() {
  redirect('/equipe/vendedores');
}

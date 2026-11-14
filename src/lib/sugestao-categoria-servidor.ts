/**
 * Sugestão de categoria pelo histórico (E7, frente D, 06/11/2026), para o
 * lançamento à mão — no pagar e no receber. É a mesma conta que a leitura do
 * boleto já fazia no pagar (as categorias mais usadas nas contas da mesma
 * pessoa: mesmo cadastro, mesmo CPF/CNPJ ou mesmo nome), agora sem precisar
 * ler documento e também para cliente.
 *
 * Só sugere: a tela mostra e a pessoa escolhe. Categoria desativada ou do
 * tipo errado (receita numa conta a pagar) nunca aparece.
 */
import type { ExecutorSQL } from './caixa-atomico';
import type { CategoriaSugerida } from './leitura-documento';
import type { TabelaDoTitulo } from './contas-excluidas';
import { nomeComparavel } from './fornecedor-sync';
import { soDigitosDoBoleto } from './boleto-linha';

const JANELA = 3000;
const txt = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();

export interface PessoaDoLancamento {
  pessoa_id?: string;
  nome?: string;
  documento?: string;
}

/** Até três categorias, da mais usada para a menos usada. */
export async function sugerirCategoriaPeloHistorico(
  exec: ExecutorSQL, tenantId: string, tabela: TabelaDoTitulo, p: PessoaDoLancamento,
): Promise<CategoriaSugerida[]> {
  const id = txt(p.pessoa_id);
  const nome = nomeComparavel(txt(p.nome));
  const doc = soDigitosDoBoleto(txt(p.documento));
  const documento = doc.length === 11 || doc.length === 14 ? doc : '';
  if (!id && !nome && !documento) return [];
  const pagar = tabela === 'contas_pagar';
  const { rows } = await exec.query(
    `SELECT data->>'categoria_id' AS categoria_id,
            data->>'${pagar ? 'fornecedor_id' : 'cliente_id'}' AS pessoa_id,
            data->>'${pagar ? 'fornecedor_nome' : 'cliente_nome'}' AS pessoa_nome,
            ${pagar ? `data->>'fornecedor_cnpj'` : `COALESCE(data->>'cliente_documento', data->>'cliente_cpf_cnpj', '')`} AS documento
       FROM ${tabela}
      WHERE tenant_id = $1 AND COALESCE(data->>'categoria_id', '') <> ''
        AND COALESCE(data->>'status', '') <> 'CANCELADO'
      ORDER BY updated_at DESC NULLS LAST
      LIMIT ${JANELA}`,
    [tenantId],
  );
  const contagem = new Map<string, number>();
  for (const r of rows) {
    const mesmo = (id !== '' && txt(r.pessoa_id) === id)
      || (documento !== '' && soDigitosDoBoleto(txt(r.documento)) === documento)
      || (nome !== '' && nomeComparavel(txt(r.pessoa_nome)) === nome);
    if (!mesmo) continue;
    const c = txt(r.categoria_id);
    contagem.set(c, (contagem.get(c) ?? 0) + 1);
  }
  if (contagem.size === 0) return [];
  const { rows: cats } = await exec.query(
    `SELECT id, codigo, data->>'nome' AS nome, COALESCE(data->>'ativo', 'true') AS ativo,
            UPPER(COALESCE(data->>'tipo', tipo, '')) AS tipo
       FROM plano_contas WHERE tenant_id = $1 AND id = ANY($2::text[])`,
    [tenantId, [...contagem.keys()]],
  );
  const contrario = pagar ? 'RECEITA' : 'DESPESA';
  return cats
    .filter(r => r.ativo !== 'false' && r.tipo !== contrario)
    .map(r => ({ id: String(r.id), codigo: txt(r.codigo), nome: txt(r.nome), vezes: contagem.get(String(r.id)) ?? 0 }))
    .sort((a, b) => b.vezes - a.vezes || a.codigo.localeCompare(b.codigo))
    .slice(0, 3);
}

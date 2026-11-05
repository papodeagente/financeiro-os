/**
 * "Ler boleto ou nota" (05/11/2026): o lado do servidor.
 *
 *  - LEITURA GUARDADA POR ARQUIVO. A chave é (agência, hash SHA-256 do
 *    arquivo). O mesmo arquivo de novo devolve a mesma leitura, sem chamar a
 *    IA e sem custo. Enquanto uma leitura está em curso, a mesma chave fica
 *    reservada ("lendo"): dois cliques ou duas abas não pagam duas vezes. Se
 *    a leitura falha, a reserva é desfeita e dá para tentar de novo; uma
 *    reserva esquecida (processo caiu) expira em 5 minutos.
 *  - FORNECEDOR. O mesmo caminho de identidade do cadastro
 *    (fornecedor-sync.ts › acharFornecedor): CNPJ pelos dígitos; sem CNPJ
 *    igual, o nome só junta quando um único cadastro tem esse nome e o
 *    documento não se contradiz. E-mail e telefone nunca juntam ninguém.
 *    Sem casamento, a tela SUGERE criar; nada é criado aqui.
 *  - CATEGORIA. As categorias que a agência já usou nas contas a pagar do
 *    mesmo fornecedor (pelo cadastro, pelo CNPJ ou pelo nome), da mais usada
 *    para a menos usada. Categoria excluída ou desativada não é sugerida.
 *
 * Não importa nada do Next, para os testes rodarem contra um Postgres real.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { acharFornecedor, nomeComparavel, nomeDoFornecedor } from './fornecedor-sync';
import type { ExtracaoDoDocumento, FornecedorSugerido, CategoriaSugerida, SugestoesDaLeitura } from './leitura-documento';
import { soDigitosDoBoleto } from './boleto-linha';

export const LEITURA_DOCUMENTO_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS leituras_de_documento (
  tenant_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'lendo',
  extracao JSONB,
  arquivo TEXT NOT NULL DEFAULT '',
  nome_original TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  tamanho BIGINT NOT NULL DEFAULT 0,
  modelo TEXT NOT NULL DEFAULT '',
  criado_por TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, hash)
);
CREATE INDEX IF NOT EXISTS idx_leituras_de_documento_recentes ON leituras_de_documento (tenant_id, created_at DESC);
`;

/** Leituras novas (que chamam a IA) por agência por hora. Repetida não conta. */
export const LIMITE_DE_LEITURAS_POR_HORA = 60;
/** Reserva "lendo" que ninguém concluiu (processo caiu) expira depois disto. */
const RESERVA_EXPIRA_MIN = 5;

export type Reserva =
  | { tipo: 'guardada'; extracao: ExtracaoDoDocumento; arquivo: string; nome_original: string }
  | { tipo: 'reservada' }
  | { tipo: 'em_curso' }
  | { tipo: 'limite' };

/**
 * Pega a leitura guardada deste arquivo ou reserva a chave para ler agora.
 * Só quem recebe `reservada` chama a IA.
 */
export async function reservarLeitura(
  exec: ExecutorSQL,
  args: { tenantId: string; hash: string; nomeOriginal: string; mime: string; tamanho: number; usuarioId: string },
): Promise<Reserva> {
  const { rows: existentes } = await exec.query(
    `SELECT estado, extracao, arquivo, nome_original,
            updated_at < NOW() - make_interval(mins => ${RESERVA_EXPIRA_MIN}) AS expirada
       FROM leituras_de_documento WHERE tenant_id = $1 AND hash = $2`,
    [args.tenantId, args.hash],
  );
  const atual = existentes[0];
  if (atual?.estado === 'pronto' && atual.extracao) {
    return {
      tipo: 'guardada',
      extracao: atual.extracao as ExtracaoDoDocumento,
      arquivo: String(atual.arquivo ?? ''),
      nome_original: String(atual.nome_original ?? ''),
    };
  }

  // Limite por hora: protege a conta de IA da agência de um laço ou de abuso.
  const { rows: contagem } = await exec.query(
    `SELECT COUNT(*)::int AS n FROM leituras_de_documento
      WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [args.tenantId],
  );
  if (!atual && Number(contagem[0]?.n ?? 0) >= LIMITE_DE_LEITURAS_POR_HORA) return { tipo: 'limite' };

  if (!atual) {
    const { rows } = await exec.query(
      `INSERT INTO leituras_de_documento (tenant_id, hash, estado, nome_original, mime, tamanho, criado_por)
       VALUES ($1, $2, 'lendo', $3, $4, $5, $6)
       ON CONFLICT (tenant_id, hash) DO NOTHING
       RETURNING hash`,
      [args.tenantId, args.hash, args.nomeOriginal.slice(0, 160), args.mime, args.tamanho, args.usuarioId],
    );
    if (rows.length > 0) return { tipo: 'reservada' };
    // Outra requisição reservou no meio do caminho.
    return { tipo: 'em_curso' };
  }

  if (atual.expirada) {
    const { rows } = await exec.query(
      `UPDATE leituras_de_documento SET updated_at = NOW(), criado_por = $3
        WHERE tenant_id = $1 AND hash = $2 AND estado = 'lendo'
          AND updated_at < NOW() - make_interval(mins => ${RESERVA_EXPIRA_MIN})
        RETURNING hash`,
      [args.tenantId, args.hash, args.usuarioId],
    );
    if (rows.length > 0) return { tipo: 'reservada' };
  }
  return { tipo: 'em_curso' };
}

export async function concluirLeitura(
  exec: ExecutorSQL,
  args: { tenantId: string; hash: string; extracao: ExtracaoDoDocumento; arquivo: string; modelo: string },
): Promise<void> {
  await exec.query(
    `UPDATE leituras_de_documento
        SET estado = 'pronto', extracao = $3, arquivo = $4, modelo = $5, updated_at = NOW()
      WHERE tenant_id = $1 AND hash = $2`,
    [args.tenantId, args.hash, JSON.stringify(args.extracao), args.arquivo, args.modelo.slice(0, 80)],
  );
}

/** A leitura falhou: libera a chave para a próxima tentativa. */
export async function desistirDaLeitura(exec: ExecutorSQL, tenantId: string, hash: string): Promise<void> {
  await exec.query(
    `DELETE FROM leituras_de_documento WHERE tenant_id = $1 AND hash = $2 AND estado = 'lendo'`,
    [tenantId, hash],
  );
}

const txt = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();

/** Quantas contas a pagar recentes olhar para sugerir a categoria. */
const JANELA_DO_HISTORICO = 3000;

export async function sugestoesParaLeitura(
  exec: ExecutorSQL,
  tenantId: string,
  lido: { nome: string; documento: string },
): Promise<SugestoesDaLeitura> {
  const documento = soDigitosDoBoleto(lido.documento);
  const temFornecedor = !!(lido.nome || documento);
  let fornecedor: FornecedorSugerido | null = null;
  if (temFornecedor) {
    const achado = await acharFornecedor(exec, tenantId, {
      crmId: '', financeiroId: '', chaveDaVenda: '',
      nome: lido.nome,
      documento: documento.length === 11 || documento.length === 14 ? documento : '',
      email: '', telefone: '', atualizadoEm: '',
    });
    if (achado && (achado.como === 'documento' || achado.como === 'nome')) {
      fornecedor = {
        id: achado.linha.id,
        nome: nomeDoFornecedor(achado.linha.data) || lido.nome,
        documento: soDigitosDoBoleto(achado.linha.data.cnpj),
        como: achado.como,
      };
    }
  }

  // Histórico: contas do mesmo cadastro, do mesmo CNPJ ou do mesmo nome.
  const nomes = new Set([nomeComparavel(lido.nome), nomeComparavel(fornecedor?.nome ?? '')].filter(Boolean));
  const docs = new Set([documento, fornecedor?.documento ?? ''].filter((d) => d.length === 11 || d.length === 14));
  const contagem = new Map<string, number>();
  if (fornecedor || nomes.size > 0 || docs.size > 0) {
    const { rows } = await exec.query(
      `SELECT data->>'categoria_id' AS categoria_id, data->>'fornecedor_id' AS fornecedor_id,
              data->>'fornecedor_nome' AS fornecedor_nome, data->>'fornecedor_cnpj' AS fornecedor_cnpj
         FROM contas_pagar
        WHERE tenant_id = $1 AND COALESCE(data->>'categoria_id', '') <> ''
          AND COALESCE(data->>'status', '') <> 'CANCELADO'
        ORDER BY updated_at DESC NULLS LAST
        LIMIT ${JANELA_DO_HISTORICO}`,
      [tenantId],
    );
    for (const r of rows) {
      const mesmo =
        (fornecedor && txt(r.fornecedor_id) === fornecedor.id) ||
        (docs.size > 0 && docs.has(soDigitosDoBoleto(r.fornecedor_cnpj))) ||
        (nomes.size > 0 && nomes.has(nomeComparavel(r.fornecedor_nome)));
      if (!mesmo) continue;
      const id = txt(r.categoria_id);
      contagem.set(id, (contagem.get(id) ?? 0) + 1);
    }
  }

  let categorias: CategoriaSugerida[] = [];
  if (contagem.size > 0) {
    const { rows } = await exec.query(
      `SELECT id, codigo, data->>'nome' AS nome, COALESCE(data->>'ativo', 'true') AS ativo,
              UPPER(COALESCE(data->>'tipo', tipo, '')) AS tipo
         FROM plano_contas WHERE tenant_id = $1 AND id = ANY($2::text[])`,
      [tenantId, [...contagem.keys()]],
    );
    categorias = rows
      .filter((r) => r.ativo !== 'false' && r.tipo !== 'RECEITA')
      .map((r) => ({ id: String(r.id), codigo: txt(r.codigo), nome: txt(r.nome), vezes: contagem.get(String(r.id)) ?? 0 }))
      .sort((a, b) => b.vezes - a.vezes || a.codigo.localeCompare(b.codigo))
      .slice(0, 3);
  }

  return { fornecedor, sugerir_criar: !fornecedor && temFornecedor && !!lido.nome, categorias };
}

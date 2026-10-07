/**
 * Desconto padrão de cada plataforma de pagamento, por agência.
 *
 * Pedido do Bruno (07/10/2026): "Caso o usuário deseje, ele também pode
 * cadastrar um % de desconto padrão para cada plataforma, aí o sistema
 * automaticamente calcula esse percentual."
 *
 * É configuração, não fato: serve para a baixa já chegar com o líquido
 * calculado. O que a conta grava continua sendo a taxa em reais que a pessoa
 * confirmou (ver taxa-plataforma.ts), então mudar o padrão amanhã não
 * reescreve nenhuma baixa de ontem.
 *
 * A chave é chaveDaPlataforma: "Pagar.me", "pagarme" e "PAGAR ME" são o mesmo
 * padrão. O nome gravado é o canônico, para a tela mostrar sempre igual.
 */
import type { ExecutorSQL } from './caixa-atomico';
import {
  chaveDaPlataforma,
  normalizarPlataforma,
  validarPercentualPadrao,
  mensagemDoPercentualInvalido,
  type DescontoPadrao,
} from './taxa-plataforma';
import { round2 } from './money';

export class ErroDescontoPadrao extends Error {
  status: number;
  constructor(mensagem: string, status = 400) {
    super(mensagem);
    this.status = status;
  }
}

function linhaParaPadrao(r: Record<string, unknown>): DescontoPadrao {
  return { plataforma: String(r.plataforma ?? ''), percentual: round2(Number(r.percentual)) };
}

export async function listarDescontosPadrao(exec: ExecutorSQL, tenantId: string): Promise<DescontoPadrao[]> {
  const { rows } = await exec.query(
    `SELECT plataforma, percentual FROM plataformas_desconto_padrao
      WHERE tenant_id = $1
      ORDER BY plataforma`,
    [tenantId],
  );
  return rows.map(linhaParaPadrao);
}

/** Cria ou troca o padrão da plataforma. Devolve como ficou gravado. */
export async function salvarDescontoPadrao(
  exec: ExecutorSQL,
  tenantId: string,
  plataforma: string,
  percentual: number,
  usuario = '',
): Promise<DescontoPadrao> {
  const nome = normalizarPlataforma(plataforma);
  const chave = chaveDaPlataforma(nome);
  if (!chave) throw new ErroDescontoPadrao('Escolha a plataforma.');
  const invalido = validarPercentualPadrao(percentual);
  if (invalido) throw new ErroDescontoPadrao(mensagemDoPercentualInvalido(invalido));
  // A coluna guarda duas casas; arredondar antes impede que 0,004 passe na
  // validação e vire 0,00, que o CHECK do banco recusaria com erro cru.
  const pct = round2(Number(percentual));
  if (pct <= 0) throw new ErroDescontoPadrao(mensagemDoPercentualInvalido('vazio'));

  const { rows } = await exec.query(
    `INSERT INTO plataformas_desconto_padrao (tenant_id, chave, plataforma, percentual, atualizado_por, atualizado_em)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (tenant_id, chave) DO UPDATE
        SET plataforma = EXCLUDED.plataforma,
            percentual = EXCLUDED.percentual,
            atualizado_por = EXCLUDED.atualizado_por,
            atualizado_em = NOW()
     RETURNING plataforma, percentual`,
    [tenantId, chave, nome, pct, usuario],
  );
  return linhaParaPadrao(rows[0]);
}

/** Tira o padrão. Devolve false quando não havia nada para tirar. */
export async function removerDescontoPadrao(
  exec: ExecutorSQL,
  tenantId: string,
  plataforma: string,
): Promise<boolean> {
  const chave = chaveDaPlataforma(plataforma);
  if (!chave) return false;
  const r = await exec.query(
    `DELETE FROM plataformas_desconto_padrao WHERE tenant_id = $1 AND chave = $2`,
    [tenantId, chave],
  );
  return (r.rowCount ?? 0) > 0;
}

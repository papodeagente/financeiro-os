/**
 * COMISSÃO CALCULADA PELO CRM: a gravação. As regras estão em
 * comissao-do-crm.ts; aqui só se aplica a decisão no banco.
 *
 * A comissão é gravada pelo MESMO caminho de /api/comissoes: o upsert por id
 * com guarda de tenant e as colunas indexadas (venda_id, vendedor_id,
 * status), seguido do mesmo gancho `sincronizarContaDaComissao`, que cria ou
 * atualiza a conta a pagar `cp-comissao-<id>` na agenda de pagamento da
 * agência. A rota HTTP não serve aqui porque lê o tenant da sessão, e o
 * webhook não tem sessão.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { sincronizarContaDaComissao } from './comissao-conta';
import {
  decidirComissaoDoCrm, idDaComissaoDoCrm, montarComissaoDoCrm,
  type ApuracaoDoCrm, type AvisoDaComissao,
} from './comissao-do-crm';
import type { ComissaoVenda } from './crm-types';
import { hojeISO } from './money';

/** O upsert do CRUD de comissões, com o gancho da conta a pagar. */
export async function gravarComissao(
  exec: ExecutorSQL,
  tenantId: string,
  comissao: ComissaoVenda,
  hoje?: string,
): Promise<Awaited<ReturnType<typeof sincronizarContaDaComissao>>> {
  const r = await exec.query(
    `INSERT INTO comissoes (id, tenant_id, data, venda_id, vendedor_id, status, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET data = $3::jsonb, updated_at = NOW(),
        venda_id = $4, vendedor_id = $5, status = $6
     WHERE comissoes.tenant_id = EXCLUDED.tenant_id`,
    [comissao.id, tenantId, JSON.stringify(comissao), comissao.venda_id ?? '', comissao.vendedor_id ?? '', comissao.status],
  );
  // O CRUD aceita o no-op em silêncio. Aqui não: sem a linha, o gancho
  // criaria uma conta a pagar de uma comissão que esta agência não tem.
  if ((r.rowCount ?? 0) === 0) {
    throw new Error(`a comissão ${comissao.id} já existe em outra agência`);
  }
  return sincronizarContaDaComissao(tenantId, comissao, exec, hoje);
}

/**
 * Marca a agência como "a comissão vem do CRM", na configuração da
 * integração (crm_config.data.comissao_pelo_crm). A partir daí a tela de
 * comissões não calcula as vendas do CRM pelos planos daqui. Só a primeira
 * marca grava a data; as seguintes não mudam nada.
 */
export async function marcarComissaoPeloCrm(exec: ExecutorSQL, tenantId: string, quando: string): Promise<boolean> {
  const r = await exec.query(
    `UPDATE crm_config
        SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('comissao_pelo_crm', true, 'comissao_pelo_crm_desde', $2::text)
      WHERE id = 'singleton' AND tenant_id = $1
        AND COALESCE(data->>'comissao_pelo_crm', '') <> 'true'`,
    [tenantId, quando],
  );
  return (r.rowCount ?? 0) > 0;
}

export interface ResultadoDaApuracao {
  acao: string;
  comissaoId: string;
  aviso?: AvisoDaComissao;
  /** Para o aviso apontar o mês certo na tela. */
  competencia: string;
}

/**
 * Aplica uma apuração do CRM. Roda dentro de uma transação (quem chama abre):
 * a trava por comissão serializa dois eventos do mesmo vendedor e mês que
 * cheguem juntos, inclusive quando a linha ainda não existe.
 */
export async function aplicarComissaoApurada(
  exec: ExecutorSQL,
  tenantId: string,
  ap: ApuracaoDoCrm,
  vendedor: { id: string; nome?: string; cadastroPendente?: boolean },
  eventoId: string,
  hoje: string = hojeISO(),
): Promise<ResultadoDaApuracao> {
  const id = idDaComissaoDoCrm(ap.vendedor_id, ap.competencia);
  await exec.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [tenantId, id]);

  const { rows } = await exec.query(`SELECT data, status FROM comissoes WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const anterior = rows[0]
    ? ({ ...(rows[0].data as ComissaoVenda), status: ((rows[0].data as ComissaoVenda)?.status ?? rows[0].status) } as ComissaoVenda)
    : null;

  const nova = montarComissaoDoCrm(ap, vendedor, eventoId);
  const decisao = decidirComissaoDoCrm(anterior, nova, hoje);
  await marcarComissaoPeloCrm(exec, tenantId, new Date().toISOString());

  const pendente = vendedor.cadastroPendente ? ' (vendedor ainda sem cadastro completo no financeiro)' : '';
  if (decisao.tipo === 'gravar' || decisao.tipo === 'cancelar') {
    const conta = await gravarComissao(exec, tenantId, decisao.comissao, hoje);
    const sobreConta = conta.duplicataCancelada
      ? `; conta a pagar ${conta.id} ${conta.acao}, duplicata ${conta.duplicataCancelada} cancelada`
      : `; conta a pagar ${conta.id} ${conta.acao}`;
    return {
      acao: `${decisao.acao}${sobreConta}${pendente}`,
      comissaoId: id,
      aviso: decisao.tipo === 'cancelar' ? decisao.aviso : undefined,
      competencia: ap.competencia,
    };
  }
  return {
    acao: `${decisao.acao}${pendente}`,
    comissaoId: id,
    aviso: decisao.tipo === 'avisar' ? decisao.aviso : undefined,
    competencia: ap.competencia,
  };
}

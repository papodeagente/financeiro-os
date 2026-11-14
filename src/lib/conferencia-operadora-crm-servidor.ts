/**
 * Extrato da consolidadora vindo do CRM (E7 frente E, 06/11/2026): o evento
 * `EXTRATO_CONSOLIDADORA` abre uma conferência de operadora A REVISAR, pelo
 * MESMO `criarConferencia` do arquivo solto na tela. Nada é aplicado
 * sozinho: a conferência compara e propõe; a comissão que a consolidadora diz
 * ter pago vai para o esperado × recebido do fornecedor (o que a conferência
 * já faz, `sincronizarComissoesDoExtrato`).
 *
 * Idempotente: uma conferência por extrato do CRM (a chave entra no lugar do
 * hash do arquivo). O mesmo extrato de novo não abre outra nem mexe na que
 * existe (as decisões das pessoas ficam).
 *
 * A operadora: o cadastro que o CRM manda (caminho único de identidade do
 * fornecedor, como na venda); sem ele, o fornecedor daqui com o mesmo nome,
 * quando é um só. Sem nenhum, a conferência abre sem operadora ligada e a
 * comissão deste extrato não entra no esperado × recebido (a conferência das
 * linhas com as vendas vale igual).
 *
 * O aviso no sino é devolvido para quem chama mandar DEPOIS de gravar: dentro
 * da transação, uma falha no aviso envenenaria a gravação da conferência.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { conferenciaDoArquivo, criarConferencia } from './conferencia-operadora-servidor';
import { lerExtratoDoCrm } from './conferencia-operadora-crm';
import { lerFornecedorDaVenda, nomeComparavel, receberFornecedorDoCrm } from './fornecedor-sync';
import type { CriarNotificacaoInput } from './notificacoes';

export interface ResultadoDoExtratoDoCrm {
  acao: string;
  conferencia_id: string | null;
  /** Fornecedor cujo vínculo o CRM precisa receber de volta. */
  ecoar: string | null;
  /** O aviso para o sino, a mandar depois da transação. */
  aviso: CriarNotificacaoInput | null;
}

async function fornecedorPeloNome(exec: ExecutorSQL, tenantId: string, nome: string): Promise<{ id: string; nome: string } | null> {
  const alvo = nomeComparavel(nome);
  if (!alvo) return null;
  const { rows } = await exec.query(
    `SELECT id, nome_fantasia, data->>'razao_social' AS razao FROM fornecedores_crm
      WHERE tenant_id = $1 AND COALESCE(data->>'status', 'ATIVO') <> 'INATIVO'
        AND (lower(btrim(nome_fantasia)) = lower(btrim($2)) OR lower(btrim(COALESCE(data->>'razao_social', ''))) = lower(btrim($2))
             OR lower(btrim(nome_fantasia)) LIKE lower(btrim($2)) || '%')
      LIMIT 20`,
    [tenantId, nome],
  );
  const iguais = rows.filter(r => nomeComparavel(r.nome_fantasia) === alvo || nomeComparavel(r.razao) === alvo);
  return iguais.length === 1 ? { id: String(iguais[0].id), nome: String(iguais[0].nome_fantasia ?? '') } : null;
}

export async function receberExtratoDoCrm(exec: ExecutorSQL, tenantId: string, payload: Record<string, unknown>): Promise<ResultadoDoExtratoDoCrm> {
  const r = lerExtratoDoCrm(payload);
  if (!r.ok) return { acao: `${r.motivo}: nada a conferir`, conferencia_id: null, ecoar: null, aviso: null };
  const lido = r.lido;

  const ja = await conferenciaDoArquivo(exec, tenantId, lido.chave);
  if (ja) {
    return {
      acao: `extrato ${lido.extrato_id} do CRM já está na conferência ${ja.id} (${ja.status === 'FECHADA' ? 'fechada' : 'aberta'}): nada mudou`,
      conferencia_id: ja.id, ecoar: null, aviso: null,
    };
  }

  let fornecedor: { id: string; nome: string } | null = null;
  let ecoar: string | null = null;
  if (lido.fornecedor) {
    const achado = await receberFornecedorDoCrm(exec, tenantId, lerFornecedorDaVenda(lido.fornecedor), 'preencher');
    if (achado) {
      fornecedor = { id: achado.id, nome: achado.nome };
      if (achado.ecoar) ecoar = achado.id;
    }
  }
  if (!fornecedor && lido.operadora_nome) fornecedor = await fornecedorPeloNome(exec, tenantId, lido.operadora_nome);

  const nome = fornecedor?.nome || lido.operadora_nome || 'Operadora não informada no CRM';
  const { id } = await criarConferencia(exec, tenantId, {
    hash: lido.chave, extrato: lido.extrato, arquivo_nome: lido.arquivo_nome, origem: 'crm',
    fornecedor_id: fornecedor?.id ?? '', fornecedor_nome: nome,
    periodo_de: lido.extrato.periodo_de, periodo_ate: lido.extrato.periodo_ate,
    quem: { usuarioId: 'crm', usuarioNome: 'CRM' },
  });
  const { rows } = await exec.query(
    `SELECT situacao, COUNT(*)::int AS n FROM conferencias_operadora_linhas WHERE tenant_id = $1 AND conferencia_id = $2 GROUP BY situacao`,
    [tenantId, id],
  );
  const conta = (s: string) => Number(rows.find(x => x.situacao === s)?.n ?? 0);
  const resumo = `${lido.extrato.linhas.length} linha(s): ${conta('CONFERIDO')} conferida(s), ${conta('DIVERGENTE')} com diferença, ${conta('NAO_ENCONTRADO')} sem venda`;
  const semOperadora = fornecedor ? '' : ` A operadora "${nome}" não foi achada nos fornecedores: a comissão deste extrato não entra no esperado × recebido.`;
  const aviso: CriarNotificacaoInput = {
    tenantId,
    tipo: 'EXTRATO_OPERADORA_DO_CRM',
    titulo: `Extrato de ${nome} chegou do CRM para conferir`,
    descricao: `${resumo}. Nada foi baixado nem cancelado: confira as linhas e feche o período quando terminar.${semOperadora}${lido.avisos.length ? ` ${lido.avisos.join(' ')}` : ''}`,
    link: `/financeiro-ag/conferencia-operadora?id=${encodeURIComponent(id)}`,
    data: { conferencia_id: id, extrato_id: lido.extrato_id },
    chaveDeduplicacao: `extrato-crm:${lido.extrato_id}`,
  };
  return {
    acao: `extrato ${lido.extrato_id} do CRM aberto para conferir (conferência ${id}, ${nome}${fornecedor ? '' : ', sem operadora ligada'}): ${resumo}${lido.avisos.length ? `; ${lido.avisos.join(' ')}` : ''}`,
    conferencia_id: id, ecoar, aviso,
  };
}

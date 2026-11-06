/**
 * Mudança v2 (E7, 06/11/2026): o gravador de verdade das listas do
 * histórico. Usa os caminhos de sempre, nunca um atalho:
 *  - conta liquidada: a conta pelo gravador da v1 e a baixa por
 *    `registrarBaixas` (liquidação no servidor), com a compensação de
 *    abertura descrita em plano-historico.ts (o saldo da data de corte não muda);
 *  - venda: `salvarVenda` com origem "mudança" (não gera contas);
 *  - reembolso e crédito: `criarReembolso` e `criarCredito` da E5 (parte D);
 *  - meta: a tabela das metas por função (E5, parte F).
 * Tudo que grava deixa o vínculo (com o retrato) para o desfazer.
 */
import { randomUUID } from 'node:crypto';
import { moverCaixaOuFalhar, type ExecutorSQL } from '../caixa-atomico';
import { ensureCaixaGeral } from '../caixa-helpers';
import { registrarBaixas } from '../baixas-servidor';
import { salvarVenda } from '../venda-servidor';
import { criarReembolso } from '../reembolsos-servidor';
import { criarCredito } from '../credito-cliente-servidor';
import type { Gravador, OrigemDaLinha } from './plano';
import { dataBR } from './valores';

export type AcaoDoVinculo = 'criado' | 'vinculado' | 'saldo' | 'historico';
export type FuncaoDoVinculo = (tabela: string, id: string, acao: AcaoDoVinculo, o: OrigemDaLinha, chave?: string | null, dados?: Record<string, unknown>) => Promise<void>;
export type FuncaoDoRetrato = (tabela: string, id: string, loteId: string) => Promise<void>;

export const USUARIO_DA_MUDANCA = 'Mudança de sistema';

const txt = (v: unknown) => (v == null ? '' : String(v));
const NUMERICO = (campo: string) => `(CASE WHEN data->>'${campo}' ~ '^-?[0-9]+([.][0-9]+)?$' THEN (data->>'${campo}')::numeric ELSE 0 END)`;

type MetodosDoHistorico = Pick<Gravador, 'criarBaixaHistorica' | 'criarVenda' | 'gravarRegistro' | 'gravarMeta' | 'criarReembolso' | 'criarCredito'>;

export function gravadorDoHistorico(
  exec: ExecutorSQL, tenantId: string, vinculo: FuncaoDoVinculo, retrato: FuncaoDoRetrato,
  origemParaGravar: (o: OrigemDaLinha) => Record<string, unknown>,
): MetodosDoHistorico {
  return {
    async criarBaixaHistorica(tabela, tituloId, b, contaId, o) {
      const conta = contaId || (await ensureCaixaGeral(tenantId, exec));
      if (!conta) throw new Error('Não deu para achar a conta da liquidação nem o Caixa Geral.');
      const r = await registrarBaixas(exec, {
        tenantId, origem: 'migracao', usuarioNome: USUARIO_DA_MUDANCA, idempotencia: `mudanca:${o.lote_id}:${o.arquivo_id}:${o.linha}`, politica: null,
      }, [{
        titulo_tabela: tabela, titulo_id: tituloId, data: b.data, conta_bancaria_id: conta, forma: b.forma,
        valor: b.valor / 100, juros: b.juros / 100, multa: b.multa / 100, desconto: b.desconto / 100, taxa: b.taxa / 100,
        // Liquidado lá: o que faltar vira desconto e o que sobrar, acréscimo (a conta fecha como fechou lá).
        tratamento_diferenca: 'desconto', observacao: 'Liquidação trazida do sistema anterior',
      }], { gravar: true });
      const baixaId = txt(r.itens[0]?.baixa_id);
      const { rows } = await exec.query(`SELECT conta_bancaria_id, caixa_centavos FROM baixas WHERE tenant_id = $1 AND id = $2`, [tenantId, baixaId]);
      const contaDaBaixa = txt(rows[0]?.conta_bancaria_id) || conta;
      const caixa = Number(rows[0]?.caixa_centavos ?? 0);
      // A abertura vai para antes da baixa: o saldo de hoje e o da data de corte não mudam.
      if (caixa) {
        await moverCaixaOuFalhar(tenantId, contaDaBaixa, -caixa / 100, exec, {
          tipo: 'abertura', tabela: 'baixas', id: baixaId,
          descricao: `Histórico trazido do sistema anterior: a abertura passa para antes da liquidação de ${dataBR(b.data)}`,
        });
        await exec.query(
          `UPDATE contas_bancarias SET data = jsonb_set(data, '{saldo_inicial}', to_jsonb(ROUND(${NUMERICO('saldo_inicial')} - $3::numeric, 2)), true), updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2`,
          [tenantId, contaDaBaixa, (caixa / 100).toFixed(2)],
        );
      }
      await vinculo('baixas', baixaId, 'historico', o, null, { conta_id: contaDaBaixa, caixa_centavos: caixa, titulo_tabela: tabela, titulo_id: tituloId, data: b.data });
      await retrato(tabela, tituloId, o.lote_id);
      await retrato('contas_bancarias', contaDaBaixa, o.lote_id);
      return baixaId;
    },

    async criarVenda(venda, extra, o) {
      const id = randomUUID();
      await salvarVenda(exec, tenantId, { ...venda, id, numero: '' }, {
        usuario: { id: '', nome: USUARIO_DA_MUDANCA }, origem: 'mudanca', semEvento: true,
        cabecalho: { numero_anterior: extra.numero_anterior, origem_migracao: { ...origemParaGravar(o), chave: extra.chave } },
      });
      const { rows: num } = await exec.query(`SELECT numero FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = $2`, [tenantId, id]);
      const numero = txt(num[0]?.numero);
      // As contas trazidas com o mesmo Venda Nº são as contas desta venda.
      const ligados: string[] = [];
      for (const t of extra.titulos) {
        // origem VENDA: a posição da venda (cliente pago/pendente, fornecedor) lê estas contas. Não são
        // auto_gerado: a regeração da venda nunca as toca (e, com origem "mudança", nem roda).
        const extraVenda = JSON.stringify({ origem_venda_id: id, venda_id: id, origem_venda_numero: numero, origem: 'VENDA' });
        if (t.tabela === 'contas_receber') {
          await exec.query(`UPDATE contas_receber SET data = data || $3::jsonb, venda_id = $4, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, t.id, extraVenda, id]);
        } else {
          await exec.query(`UPDATE contas_pagar SET data = data || $3::jsonb, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, t.id, extraVenda]);
        }
        await retrato(t.tabela, t.id, o.lote_id);
        ligados.push(`${t.tabela}:${t.id}`);
      }
      await vinculo('vendas_crm', id, 'criado', o, extra.chave, { titulos: ligados, numero_anterior: extra.numero_anterior });
      return id;
    },

    async gravarRegistro(tipo, chave, resumo, dados, o) {
      const id = randomUUID();
      await exec.query(
        `INSERT INTO migracao_historico (id, tenant_id, lote_id, tipo, chave, data, valor_centavos, pessoa, numero, venda_id, dados, origem)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11::jsonb, $12::jsonb)`,
        [id, tenantId, o.lote_id, tipo, chave, resumo.data || null, resumo.valor, resumo.pessoa, resumo.numero, resumo.venda_id, JSON.stringify(dados), JSON.stringify(origemParaGravar(o))],
      );
      await vinculo('migracao_historico', id, 'criado', o, chave);
      return id;
    },

    async gravarMeta(pessoaFuncaoId, mes, centavos, o) {
      const { rows } = await exec.query(`SELECT valor_centavos FROM comissao_metas WHERE tenant_id = $1 AND pessoa_funcao_id = $2 AND mes = $3 FOR UPDATE`, [tenantId, pessoaFuncaoId, mes]);
      const antes = rows.length ? Number(rows[0].valor_centavos) : null;
      await exec.query(
        `INSERT INTO comissao_metas (tenant_id, pessoa_funcao_id, mes, valor_centavos) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, pessoa_funcao_id, mes) DO UPDATE SET valor_centavos = EXCLUDED.valor_centavos`,
        [tenantId, pessoaFuncaoId, mes, centavos],
      );
      await vinculo('comissao_metas', `${pessoaFuncaoId}|${mes}`, 'criado', o, null, { pessoa_funcao_id: pessoaFuncaoId, mes, antes, depois: centavos });
    },

    async criarReembolso(r, pessoa, conta, venda, chave, o) {
      const { rows: num } = venda
        ? await exec.query(`SELECT numero FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = $2`, [tenantId, venda.id])
        : { rows: [] as Array<Record<string, unknown>> };
      const novo = await criarReembolso(exec, tenantId, {
        tipo: r.tipo, venda_id: venda?.id ?? '', venda_numero: txt(num[0]?.numero), pessoa_id: pessoa.id, pessoa_nome: pessoa.nome,
        valor_centavos: r.valor, descricao: r.descricao || 'Reembolso trazido do sistema anterior', prazo: r.prazo ?? undefined, vinculado_a: `mudanca:${chave}`.slice(0, 200),
      }, USUARIO_DA_MUDANCA);
      if (conta) {
        // A conta deste reembolso já veio nas contas em aberto: o reembolso passa a ser dela (aprovado), sem conta nova.
        await exec.query(
          `UPDATE reembolsos SET situacao = 'APROVADO', conta_tabela = $3, conta_id = $4, atualizado_em = NOW(),
                  historico = historico || $5::jsonb WHERE tenant_id = $1 AND id = $2`,
          [tenantId, novo.id, conta.tabela, conta.id, JSON.stringify([{ em: new Date().toISOString(), quem: USUARIO_DA_MUDANCA, de: 'SOLICITADO', para: 'APROVADO', nota: 'A conta veio do sistema anterior.' }])],
        );
        await exec.query(`UPDATE ${conta.tabela} SET data = data || jsonb_build_object('reembolso_id', $3::text), updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, conta.id, novo.id]);
        await retrato(conta.tabela, conta.id, o.lote_id);
      }
      await vinculo('reembolsos', novo.id, 'criado', o, chave, { situacao: conta ? 'APROVADO' : 'SOLICITADO', conta: conta ? `${conta.tabela}:${conta.id}` : null });
      return novo.id;
    },

    async criarCredito(c, cliente, venda, chave, o) {
      const { rows: num } = venda
        ? await exec.query(`SELECT numero FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = $2`, [tenantId, venda.id])
        : { rows: [] as Array<Record<string, unknown>> };
      const credito = await criarCredito(exec, tenantId, {
        cliente_id: cliente.id, cliente_nome: cliente.nome, origem: 'AJUSTE', valor_centavos: c.saldo,
        ...(c.validade ? { validade: c.validade } : {}),
        descricao: c.descricao || 'Crédito trazido do sistema anterior', origem_venda_id: venda?.id ?? '', origem_venda_numero: txt(num[0]?.numero),
        origem_ref: `mudanca:${chave}`.slice(0, 200),
      }, USUARIO_DA_MUDANCA);
      await vinculo('creditos_cliente', credito.id, 'criado', o, chave, { valor_centavos: c.saldo });
      return credito.id;
    },
  };
}

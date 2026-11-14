/**
 * "Saúde da volta" (14/11/2026): o que a volta da versão completa pode ter
 * deixado para alguém olhar, agência por agência. Só leitura, só Super Admin.
 *
 * De 12/11 até a publicação rodou a versão simples em cima do banco da
 * completa. Cinco coisas podem ter ficado tortas nesse intervalo:
 *  a) integração com o CRM com o segredo só no cofre: a simples lia o texto,
 *     que a completa tinha tirado. Pode ter recusado avisos do CRM (401);
 *  b) cobrança emitida pela completa (referência `f1;`) paga no intervalo:
 *     a simples não reconhecia a referência e registrou uma venda direta;
 *  c) agência com período fechado: o banco travou mudança de dinheiro até a
 *     data, e a simples não tem tela para reabrir;
 *  d) segredo do autenticador sem máscara no histórico de auditoria (a
 *     simples não mascarava `totp`). Só a contagem: o valor nunca aparece;
 *  e) diferença do razão no intervalo, guardada na reabertura para revisar.
 */
import { INICIO_DA_VERSAO_SIMPLES } from './volta-acertos';

export interface Executor {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export type IdDoItem = 'crm_cofre' | 'cobranca_venda_direta' | 'periodos_fechados' | 'totp_no_historico' | 'razao_revisao';

export interface LinhaDaSaude {
  tenant_id: string;
  agencia: string;
  /** Frase curta do que foi achado nesta agência. */
  detalhe: string;
  /** Números da linha (para a tela ordenar e somar). */
  numeros?: Record<string, number>;
}

export interface ItemDaSaude {
  id: IdDoItem;
  titulo: string;
  explicacao: string;
  o_que_fazer: string;
  linhas: LinhaDaSaude[];
  /** Consulta que não rodou (tabela ausente etc.). */
  erro?: string;
}

export interface SaudeDaVolta {
  gerado_em: string;
  desde: string;
  itens: ItemDaSaude[];
}

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function nomesDasAgencias(exec: Executor): Promise<Map<string, string>> {
  const { rows } = await exec.query(`SELECT id, COALESCE(NULLIF(nome, ''), data->>'nome', id) AS nome FROM tenants`);
  return new Map(rows.map(r => [String(r.id), String(r.nome)]));
}

async function item(
  base: Omit<ItemDaSaude, 'linhas' | 'erro'>,
  ler: () => Promise<LinhaDaSaude[]>,
): Promise<ItemDaSaude> {
  try {
    return { ...base, linhas: await ler() };
  } catch (e) {
    return { ...base, linhas: [], erro: e instanceof Error ? e.message : String(e) };
  }
}

export async function diagnosticoDaVolta(exec: Executor, agora = new Date()): Promise<SaudeDaVolta> {
  const nomes = await nomesDasAgencias(exec);
  const nome = (t: unknown) => (t === '__platform__' ? 'Plataforma (Super Admin)' : nomes.get(String(t)) ?? String(t));
  const desde = INICIO_DA_VERSAO_SIMPLES;

  const crm = await item({
    id: 'crm_cofre',
    titulo: 'Integração com o CRM com o segredo só no cofre',
    explicacao: 'A versão completa guardou o segredo da integração cifrado. A versão simples procurava o segredo em texto, não achava, e pode ter recusado os avisos do CRM (erro 401) e mandado avisos sem assinatura desde 12/11.',
    o_que_fazer: 'Com a versão completa no ar o segredo volta a ser lido. Confira com a agência se as vendas e pagamentos do CRM desse período chegaram ao Financeiro; o que faltar, reenviar pelo CRM.',
  }, async () => {
    const { rows } = await exec.query(
      `SELECT c.tenant_id,
              (c.data->>'ativo') = 'true' AS ativo,
              (SELECT MAX(e.created_at) FROM crm_eventos_entrada e WHERE e.tenant_id = c.tenant_id) AS ultimo_aviso,
              (SELECT COUNT(*)::int FROM crm_eventos_entrada e WHERE e.tenant_id = c.tenant_id AND e.created_at >= $1::date) AS avisos_no_intervalo
         FROM crm_config c
        WHERE (c.data ? 'api_key_entur_cofre' OR c.data ? 'api_key_crm_cofre')
          AND (COALESCE(c.data->>'api_key_entur', '') = '' OR COALESCE(c.data->>'api_key_crm', '') = '')
        ORDER BY c.tenant_id`,
      [desde],
    );
    return rows.map(r => ({
      tenant_id: String(r.tenant_id), agencia: nome(r.tenant_id),
      detalhe: `${r.ativo ? 'Integração ligada' : 'Integração desligada'}; ${Number(r.avisos_no_intervalo)} aviso(s) do CRM aceitos desde ${desde.split('-').reverse().join('/')}.`,
      numeros: { avisos_no_intervalo: Number(r.avisos_no_intervalo) },
    }));
  });

  const cobrancas = await item({
    id: 'cobranca_venda_direta',
    titulo: 'Cobrança paga que virou venda direta',
    explicacao: 'A cobrança foi emitida pela versão completa (referência própria "f1;"). Paga no intervalo, a versão simples não reconheceu a referência e registrou o recebimento também como venda direta: o mesmo dinheiro pode estar em duas contas a receber.',
    o_que_fazer: 'Em Plataformas › Conciliação, desfaça a venda direta dessa transação. Depois confira na Cobrança que o título dela ficou pago uma vez só.',
  }, async () => {
    const { rows } = await exec.query(
      `SELECT t.tenant_id, t.plataforma, t.id_transacao, t.status_conciliacao, t.created_at,
              c.id AS cobranca_id, c.status AS cobranca_status, c.valor_centavos
         FROM plataformas_transacoes t
         LEFT JOIN cobrancas c ON c.tenant_id = t.tenant_id AND c.provedor = t.plataforma
              AND (c.id_externo = t.id_transacao OR c.carne_id_externo = t.id_transacao OR strpos(t.data::text, c.referencia) > 0)
        WHERE t.created_at >= $1::date
          AND (strpos(t.data::text, 'f1;') > 0 OR c.id IS NOT NULL)
        ORDER BY t.tenant_id, t.created_at`,
      [desde],
    );
    return rows.map(r => ({
      tenant_id: String(r.tenant_id), agencia: nome(r.tenant_id),
      detalhe: `${String(r.plataforma)} ${String(r.id_transacao)}: transação ${String(r.status_conciliacao).toLowerCase()}` +
        (r.cobranca_id ? `, cobrança ${String(r.cobranca_status)} de ${reais(Number(r.valor_centavos ?? 0))}.` : ', cobrança não encontrada pelo id.'),
      numeros: { valor_centavos: Number(r.valor_centavos ?? 0) },
    }));
  });

  const periodos = await item({
    id: 'periodos_fechados',
    titulo: 'Agência com período fechado',
    explicacao: 'O fechamento de período trava no próprio banco qualquer mudança de dinheiro até a data. A versão simples não tem a tela de Fechar Caixa: quem tentou baixar ou editar um título antigo nesse intervalo recebeu um erro sem saber por quê.',
    o_que_fazer: 'Combine com a agência: se ela não usa o fechamento, reabra o período (com motivo) pelo Fechar Caixa, liberando o núcleo completo para ela, ou deixe como está se a trava foi intencional.',
  }, async () => {
    const { rows } = await exec.query(
      `SELECT p.tenant_id, p.conta_bancaria_id, p.fechado_ate::text AS ate,
              COALESCE(b.data->>'nome', '') AS conta
         FROM periodos_fechados p
         LEFT JOIN contas_bancarias b ON b.tenant_id = p.tenant_id AND b.id = p.conta_bancaria_id
        ORDER BY p.tenant_id, p.conta_bancaria_id`,
    );
    return rows.map(r => ({
      tenant_id: String(r.tenant_id), agencia: nome(r.tenant_id),
      detalhe: `${r.conta_bancaria_id ? `Conta ${String(r.conta || r.conta_bancaria_id)}` : 'Agência inteira'} fechada até ${String(r.ate).split('-').reverse().join('/')}.`,
    }));
  });

  const totp = await item({
    id: 'totp_no_historico',
    titulo: 'Autenticador sem máscara no histórico de auditoria',
    explicacao: 'A auditoria da versão simples não mascarava os campos do autenticador (verificação em duas etapas). O histórico é imutável: as linhas ficam, mas o segredo nelas não pode continuar valendo. Aqui só a contagem; o valor nunca é mostrado.',
    o_que_fazer: 'Quem tem "segredo em texto" deve refazer o autenticador (Equipe › redefinir a verificação em duas etapas) para o segredo antigo deixar de valer. "Cifrado" só se abre com a chave mestra; "passo" é só o contador e não é segredo.',
  }, async () => {
    const { rows } = await exec.query(
      `WITH campos AS (
         SELECT a.tenant_id, a.id, lower(x->>'campo') AS campo
           FROM audit_log a
           CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(a.data->'alteracoes') = 'array' THEN a.data->'alteracoes' ELSE '[]'::jsonb END) x
          WHERE a.entidade IN ('usuarios', 'super_admins')
            AND lower(x->>'campo') LIKE '%totp%'
            AND (COALESCE(x->>'valor_novo', '') NOT IN ('', '[PROTEGIDO]')
              OR COALESCE(x->>'valor_anterior', '') NOT IN ('', '[PROTEGIDO]')))
       SELECT tenant_id,
              COUNT(DISTINCT id) FILTER (WHERE campo LIKE '%totp_segredo%')::int AS texto,
              COUNT(DISTINCT id) FILTER (WHERE campo LIKE '%totp_cofre%')::int AS cifrado,
              COUNT(DISTINCT id) FILTER (WHERE campo NOT LIKE '%totp_segredo%' AND campo NOT LIKE '%totp_cofre%')::int AS passo
         FROM campos GROUP BY tenant_id ORDER BY tenant_id`,
    );
    return rows.map(r => ({
      tenant_id: String(r.tenant_id), agencia: nome(r.tenant_id),
      detalhe: `${Number(r.texto)} com segredo em texto, ${Number(r.cifrado)} cifrado(s), ${Number(r.passo)} só com o passo.`,
      numeros: { texto: Number(r.texto), cifrado: Number(r.cifrado), passo: Number(r.passo) },
    }));
  });

  const razao = await item({
    id: 'razao_revisao',
    titulo: 'Diferença do razão no intervalo, para revisar',
    explicacao: 'Na volta, o razão de cada agência foi reaberto pelo saldo de hoje. O dinheiro que se moveu de 12/11 até a publicação não passou pelo razão: a diferença de cada conta ficou numa contrapartida "a revisar". Nenhum saldo foi ajustado.',
    o_que_fazer: 'Confira com a agência os pagamentos, recebimentos e transferências dessa conta no intervalo. Se baterem com a diferença, está explicada; se não, procure lançamento em dobro ou faltando.',
  }, async () => {
    const { rows } = await exec.query(
      `SELECT r.tenant_id, r.conta_bancaria_id, r.dia::text AS dia, r.diferenca_centavos::bigint AS dif,
              COALESCE(b.data->>'nome', r.conta_bancaria_id) AS conta, COALESCE(NULLIF(b.data->>'moeda', ''), 'BRL') AS moeda
         FROM razao_conferencias r
         LEFT JOIN contas_bancarias b ON b.tenant_id = r.tenant_id AND b.id = r.conta_bancaria_id
        WHERE r.tipo = 'reabertura' AND r.diferenca_centavos <> 0
        ORDER BY r.tenant_id, ABS(r.diferenca_centavos) DESC`,
    );
    return rows.map(r => {
      const dif = Number(r.dif ?? 0);
      const valor = r.moeda === 'BRL' ? reais(dif) : `${String(r.moeda)} ${(dif / 100).toFixed(2)}`;
      return {
        tenant_id: String(r.tenant_id), agencia: nome(r.tenant_id),
        detalhe: `${String(r.conta)}: ${dif > 0 ? 'entrou' : 'saiu'} ${valor.replace('-', '')} a mais do que o razão sabia.`,
        numeros: { diferenca_centavos: dif },
      };
    });
  });

  return { gerado_em: agora.toISOString(), desde, itens: [crm, cobrancas, periodos, totp, razao] };
}

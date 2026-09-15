/**
 * Plataformas: configuração por agência e processamento de evento.
 *
 * O caminho do dinheiro segue a regra da casa: a conta a receber nasce e a
 * baixa move o saldo por `aplicarMovimentoCaixaAtomico`, dentro de UMA
 * transação com o registro do evento. Se a gravação falhar no meio, nada
 * fica pela metade, e o webhook devolve erro para a plataforma reenviar.
 */
import pool from '../db';
import { generateId } from '../utils';
import { round2, num, hojeISO } from '../money';
import { emTransacao, aplicarMovimentoCaixaAtomico, type ExecutorSQL } from '../caixa-atomico';
import { cifrar, decifrar, mascarar } from '../cofre';
import { acharAdapter } from './index';
import type { CredenciaisPlataforma, EventoNormalizado, PlataformaId } from './tipos';

export interface ConfigPlataforma {
  plataforma: PlataformaId;
  ativo: boolean;
  /** Conta bancária que recebe o dinheiro. Vazio usa a Caixa Geral. */
  conta_bancaria_id: string;
  /** Emitir nota fiscal sozinho quando a venda entra. */
  emitir_nota: boolean;
  /** Só para exibição. O segredo real fica cifrado. */
  mascaras: Record<string, string>;
  atualizado_em: string;
}

export class ErroPlataforma extends Error {}

/** Configuração da agência, sem segredo nenhum: serve para a tela. */
export async function listarConfigs(tenantId: string): Promise<ConfigPlataforma[]> {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT plataforma, ativo, data FROM plataformas_config WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows.map(r => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return {
      plataforma: r.plataforma as PlataformaId,
      ativo: r.ativo === true,
      conta_bancaria_id: String(d.conta_bancaria_id ?? ''),
      emitir_nota: d.emitir_nota === true,
      mascaras: (d.mascaras ?? {}) as Record<string, string>,
      atualizado_em: String(d.atualizado_em ?? ''),
    };
  });
}

/** Credenciais decifradas. NUNCA sai desta camada para a resposta HTTP. */
export async function carregarCredenciais(
  tenantId: string,
  plataforma: string,
): Promise<{ cred: CredenciaisPlataforma; config: ConfigPlataforma } | null> {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT plataforma, ativo, data FROM plataformas_config
      WHERE tenant_id = $1 AND plataforma = $2 LIMIT 1`,
    [tenantId, plataforma],
  );
  if (rows.length === 0) return null;

  const d = (rows[0].data ?? {}) as Record<string, unknown>;
  let cred: CredenciaisPlataforma = { api_key: '', segredo_webhook: '', extras: {} };
  if (d.credencial) {
    try {
      cred = JSON.parse(decifrar(d.credencial)) as CredenciaisPlataforma;
    } catch {
      // Cofre indisponível ou chave mestra trocada. Devolver credencial
      // vazia faria o webhook recusar por "token não confere", escondendo
      // a causa real; por isso o erro é explícito.
      throw new ErroPlataforma(
        'A credencial gravada não pôde ser lida. Cadastre a credencial desta plataforma de novo.',
      );
    }
  }
  return {
    cred,
    config: {
      plataforma: rows[0].plataforma as PlataformaId,
      ativo: rows[0].ativo === true,
      conta_bancaria_id: String(d.conta_bancaria_id ?? ''),
      emitir_nota: d.emitir_nota === true,
      mascaras: (d.mascaras ?? {}) as Record<string, string>,
      atualizado_em: String(d.atualizado_em ?? ''),
    },
  };
}

export async function salvarConfig(
  tenantId: string,
  plataforma: string,
  entrada: {
    ativo: boolean;
    conta_bancaria_id: string;
    emitir_nota: boolean;
    /** Só os campos que o usuário digitou agora. Campo em branco mantém o
     *  que já estava: a tela nunca recebe o segredo de volta, então enviar
     *  vazio significa "não mexi nele", e não "apague". */
    credencial: Partial<CredenciaisPlataforma> & { extras?: Record<string, string> };
  },
): Promise<void> {
  if (!pool) throw new ErroPlataforma('Banco indisponível.');
  const adapter = acharAdapter(plataforma);
  if (!adapter) throw new ErroPlataforma(`Plataforma desconhecida: ${plataforma}`);

  const atual = await carregarCredenciais(tenantId, plataforma).catch(() => null);
  const base: CredenciaisPlataforma = atual?.cred ?? { api_key: '', segredo_webhook: '', extras: {} };

  const cred: CredenciaisPlataforma = {
    api_key: entrada.credencial.api_key?.trim() || base.api_key,
    segredo_webhook: entrada.credencial.segredo_webhook?.trim() || base.segredo_webhook,
    extras: { ...base.extras, ...(entrada.credencial.extras ?? {}) },
  };

  const faltando = adapter.camposCredencial()
    .filter(c => c.obrigatorio)
    .filter(c => {
      const v = c.chave === 'api_key' ? cred.api_key
        : c.chave === 'segredo_webhook' ? cred.segredo_webhook
        : cred.extras[c.chave];
      return !String(v ?? '').trim();
    })
    .map(c => c.rotulo);
  if (faltando.length > 0) {
    throw new ErroPlataforma(`Preencha: ${faltando.join(', ')}.`);
  }

  const mascaras: Record<string, string> = {
    api_key: mascarar(cred.api_key),
    segredo_webhook: mascarar(cred.segredo_webhook),
  };
  for (const [k, v] of Object.entries(cred.extras)) mascaras[k] = v;

  const data = {
    credencial: cifrar(JSON.stringify(cred)),
    conta_bancaria_id: entrada.conta_bancaria_id ?? '',
    emitir_nota: entrada.emitir_nota === true,
    mascaras,
    atualizado_em: new Date().toISOString(),
  };

  await pool.query(
    `INSERT INTO plataformas_config (id, tenant_id, plataforma, ativo, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
     ON CONFLICT (tenant_id, plataforma) DO UPDATE
        SET ativo = EXCLUDED.ativo, data = EXCLUDED.data, updated_at = NOW()`,
    [generateId(), tenantId, plataforma, entrada.ativo === true, JSON.stringify(data)],
  );
}

export interface ResultadoProcessamento {
  processado: boolean;
  acao: string;
}

/**
 * Registra o evento e, quando é dinheiro, cria a venda no financeiro.
 *
 * Tudo numa transação só. O índice único (tenant, plataforma, id_externo)
 * é o que segura o reenvio: a plataforma reenvia por desenho quando não
 * recebe 200 a tempo, e sem isso a mesma venda entraria duas vezes.
 */
export async function processarEvento(
  tenantId: string,
  plataforma: string,
  evento: EventoNormalizado,
): Promise<ResultadoProcessamento> {
  if (!pool) throw new ErroPlataforma('Banco indisponível.');

  const conf = await carregarCredenciais(tenantId, plataforma);
  const contaBancaria = conf?.config.conta_bancaria_id || null;

  return emTransacao(async (exec: ExecutorSQL) => {
    // Chave única: a segunda tentativa não insere e o evento é ignorado.
    const ins = await exec.query(
      `INSERT INTO plataformas_eventos (id, tenant_id, plataforma, id_externo, tipo, status, data, created_at)
       VALUES ($1, $2, $3, $4, $5, 'RECEBIDO', $6::jsonb, NOW())
       ON CONFLICT (tenant_id, plataforma, id_externo) DO NOTHING`,
      [generateId(), tenantId, plataforma, evento.id_externo, evento.tipo, JSON.stringify(evento)],
    );
    if ((ins.rowCount ?? 0) === 0) {
      return { processado: false, acao: 'duplicado, ignorado' };
    }

    if (evento.tipo === 'IGNORADO') {
      await exec.query(
        `UPDATE plataformas_eventos SET status = 'IGNORADO'
          WHERE tenant_id = $1 AND plataforma = $2 AND id_externo = $3`,
        [tenantId, plataforma, evento.id_externo],
      );
      return { processado: true, acao: 'evento sem efeito financeiro' };
    }

    if (evento.tipo !== 'PAGAMENTO_CONFIRMADO') {
      // Estorno e chargeback ainda não escrevem no financeiro sozinhos:
      // devolver dinheiro é decisão com consequência, e a venda pode já
      // ter virado nota fiscal. O evento fica registrado e visível.
      await exec.query(
        `UPDATE plataformas_eventos SET status = 'PENDENTE_HUMANO',
                erro = 'Estorno recebido. Ajuste a venda e a nota manualmente.'
          WHERE tenant_id = $1 AND plataforma = $2 AND id_externo = $3`,
        [tenantId, plataforma, evento.id_externo],
      );
      return { processado: true, acao: 'estorno registrado para conferência' };
    }

    // Moeda estrangeira não vira real por conta própria: já inflou receita
    // em produção. Fica registrado e aguarda decisão de câmbio.
    if (evento.moeda && evento.moeda !== 'BRL') {
      await exec.query(
        `UPDATE plataformas_eventos SET status = 'PENDENTE_HUMANO',
                erro = $4
          WHERE tenant_id = $1 AND plataforma = $2 AND id_externo = $3`,
        [tenantId, plataforma, evento.id_externo,
         `Venda em ${evento.moeda}. Informe o câmbio e lance manualmente para a receita não sair errada.`],
      );
      return { processado: true, acao: `venda em ${evento.moeda} separada para conferência` };
    }

    const valor = round2(num(evento.valor_bruto));
    if (valor <= 0) {
      await exec.query(
        `UPDATE plataformas_eventos SET status = 'IGNORADO', erro = 'Valor zero.'
          WHERE tenant_id = $1 AND plataforma = $2 AND id_externo = $3`,
        [tenantId, plataforma, evento.id_externo],
      );
      return { processado: true, acao: 'valor zero, nada lançado' };
    }

    // Cliente: casa por email dentro da agência para não duplicar a cada
    // compra da mesma pessoa.
    const email = evento.comprador.email.trim().toLowerCase();
    let clienteId = '';
    if (email) {
      const r = await exec.query(
        `SELECT id FROM clientes WHERE tenant_id = $1 AND LOWER(TRIM(data->>'email')) = $2 LIMIT 1`,
        [tenantId, email],
      );
      clienteId = String(r.rows[0]?.id ?? '');
    }
    if (!clienteId) {
      clienteId = generateId();
      const cliente = {
        id: clienteId,
        nome: evento.comprador.nome || email || 'Comprador',
        cpf_cnpj: evento.comprador.documento,
        tipo: 'fisica',
        email,
        telefone: evento.comprador.telefone,
        origem: plataforma,
      };
      await exec.query(
        `INSERT INTO clientes (id, nome, cpf_cnpj, tipo, data, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'fisica', $4::jsonb, $5, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [clienteId, cliente.nome, cliente.cpf_cnpj, JSON.stringify(cliente), tenantId],
      );
    }

    const hoje = hojeISO();
    const dataPagamento = evento.data_pagamento || hoje;
    const contaId = `plat-${plataforma}-${evento.id_transacao || evento.id_externo}`;

    const conta = {
      id: contaId,
      origem: 'VENDA',
      venda_id: null,
      grupo_id: null,
      cliente_id: clienteId,
      cliente_nome: evento.comprador.nome || email || 'Comprador',
      descricao: `${evento.descricao} · ${plataforma}`,
      categoria_id: '',
      centro_custo: '',
      valor_original: valor,
      juros: 0, multa: 0, desconto: 0,
      valor_final: valor,
      data_emissao: dataPagamento,
      data_vencimento: dataPagamento,
      // Já entrou: a plataforma só avisa depois de o dinheiro ser confirmado.
      data_recebimento: dataPagamento,
      valor_recebido: valor,
      conta_bancaria_id: contaBancaria,
      forma_recebimento: evento.forma_pagamento || plataforma,
      parcela_numero: 1, total_parcelas: 1,
      boleto_emitido: false, boleto_codigo: '', boleto_url: '',
      status: 'RECEBIDO',
      rateio: [], anexos: [],
      observacoes: `Gerada automaticamente pela integração com ${plataforma}. Transação ${evento.id_transacao}.`,
      plataforma_origem: plataforma,
      plataforma_transacao: evento.id_transacao,
      plataforma_taxa: round2(num(evento.valor_taxa)),
    };

    const insConta = await exec.query(
      `INSERT INTO contas_receber (id, venda_id, cliente_id, status, data, tenant_id, created_at, updated_at)
       VALUES ($1, NULL, $2, $3, $4::jsonb, $5, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [contaId, clienteId, 'RECEBIDO', JSON.stringify(conta), tenantId],
    );

    // Só move caixa se a conta foi REALMENTE criada agora. Sem esta
    // checagem, um reenvio que passasse pela chave do evento (por exemplo
    // depois de alguém apagar o evento) creditaria o valor duas vezes.
    if ((insConta.rowCount ?? 0) > 0) {
      await aplicarMovimentoCaixaAtomico(tenantId, contaBancaria, valor, exec);
    }

    await exec.query(
      `UPDATE plataformas_eventos SET status = 'PROCESSADO'
        WHERE tenant_id = $1 AND plataforma = $2 AND id_externo = $3`,
      [tenantId, plataforma, evento.id_externo],
    );

    return {
      processado: true,
      acao: (insConta.rowCount ?? 0) > 0
        ? `venda lançada (${contaId})`
        : 'conta já existia, caixa não foi movido de novo',
    };
  });
}

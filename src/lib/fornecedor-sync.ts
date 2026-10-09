/**
 * O fornecedor entre o CRM e o Financeiro: CAMINHO ÚNICO de identidade e de
 * atualização, usado pela mudança de cadastro no CRM (FORNECEDOR_ATUALIZADO)
 * e pela lista de fornecedores da venda fechada (VENDA_FECHADA).
 *
 * POR QUE EXISTE. Até 09/10/2026 o cadastro só andava num sentido e pela
 * metade: o Financeiro avisava o CRM, que descartava o aviso, e o CRM só
 * mandava fornecedor dentro de uma venda, com uma chave que mudava conforme o
 * cadastro (CNPJ, depois id, depois nome). O fornecedor criado no CRM não
 * existia aqui até a primeira venda, e o daqui nunca chegava lá. Era comum a
 * conta a pagar sair no nome de um fornecedor e a venda no de outro.
 *
 * QUEM É QUEM, na ordem de força do sinal:
 *   1. o id do fornecedor no CRM (crm_supplier_id, o vínculo);
 *   2. o id daqui que o CRM já conhece (financeiro_id);
 *   3. a chave antiga da venda (external_id: crm_cnpj_..., crm_supplier_...);
 *   4. o CPF/CNPJ, comparado só pelos dígitos (o daqui pode estar formatado);
 *   5. o nome, sem acento e sem pontuação, quando só UM cadastro tem esse nome
 *      e os documentos não se contradizem;
 *   6. cadastro novo.
 * O vínculo nunca é trocado: um cadastro já ligado a outro fornecedor do CRM
 * continua ligado a ele (são duplicados lá, e um só aqui).
 *
 * O QUE MUDA NO CADASTRO.
 *   - Venda fechada só PREENCHE o que está vazio.
 *   - Mudança de cadastro no CRM SOBRESCREVE o campo que veio com valor. Vazio
 *     nunca apaga: o cadastro rápido de um lado não pode zerar o completo do
 *     outro.
 *   - Evento mais velho que o último aplicado não muda nada (o CRM envia em
 *     paralelo, e a ordem de chegada não é a ordem em que a pessoa salvou).
 *   - CNPJ que já é de outro fornecedor daqui não é copiado (seria o mesmo
 *     fornecedor duas vezes).
 *
 * QUEM AVISA QUEM. Quem recebe nunca reenvia o mesmo dado, senão os dois
 * sistemas conversariam para sempre. A única volta é o ECO: quando o CRM ainda
 * não sabe qual cadastro daqui é o dele, o Financeiro responde com o cadastro
 * completo e o vínculo. O CRM não ecoa um evento que já traz o vínculo, então
 * a conversa termina ali.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { createFornecedorCRM, type FornecedorCRM } from './crm-types';
import { normalizarNome } from './conciliacao-plano';
import { documentoComparavel, emailComparavel, soDigitos } from './plataformas/conciliacao';
import { generateId } from './utils';

/** O que o CRM diz de um fornecedor. Campo vazio é "não sei". */
export interface FornecedorDoCrm {
  /** Id do fornecedor no CRM. Vazio quando a venda trouxe só um nome livre. */
  crmId: string;
  /** Id daqui que o CRM já conhece. */
  financeiroId: string;
  /** Chave da venda (crm_cnpj_..., crm_supplier_..., crm_supplier_name_...). */
  chaveDaVenda: string;
  nome: string;
  /** Só dígitos, 11 ou 14. Qualquer outra coisa vira vazio. */
  documento: string;
  email: string;
  telefone: string;
  /** Ausente: não mexe no status. */
  ativo?: boolean;
  /** Quando o CRM gravou (ISO). Vazio: sempre aplica. */
  atualizadoEm: string;
}

export type ModoDoCrm = 'sobrescrever' | 'preencher';

export type ComoAchou = 'vinculo' | 'id-do-financeiro' | 'chave-da-venda' | 'documento' | 'nome' | 'novo';

export interface ResultadoDoFornecedor {
  id: string;
  nome: string;
  como: ComoAchou;
  criado: boolean;
  /** O vínculo com o CRM foi gravado agora. */
  vinculado: boolean;
  /** Campos que mudaram aqui. */
  mudou: string[];
  /** O evento era mais velho que o último aplicado: só o vínculo foi feito. */
  antigo: boolean;
  /** CNPJ que veio e não foi copiado por já ser de outro fornecedor daqui. */
  documentoEmUso: string;
  /** Responder ao CRM com o cadastro e o vínculo. */
  ecoar: boolean;
}

const txt = (v: unknown): string =>
  (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();

function idDoCrm(v: unknown): string {
  const s = txt(v);
  // Aceita o id cru (12) e a forma das chaves antigas (crm_supplier_12).
  const m = s.match(/^(?:crm_supplier_)?(\d+)$/);
  return m ? m[1] : '';
}

function quandoValido(v: unknown): string {
  const s = txt(v);
  return s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : '';
}

/** FORNECEDOR_ATUALIZADO: o cadastro do CRM, como ele está agora. */
export function lerFornecedorDoCrm(p: Record<string, unknown>): FornecedorDoCrm {
  const ativo = p.ativo;
  return {
    crmId: idDoCrm(p.crm_supplier_id),
    financeiroId: txt(p.financeiro_id),
    chaveDaVenda: '',
    nome: txt(p.nome),
    documento: documentoComparavel(p.documento),
    email: txt(p.email),
    telefone: txt(p.telefone),
    ativo: typeof ativo === 'boolean' ? ativo : undefined,
    atualizadoEm: quandoValido(p.atualizado_em),
  };
}

/** Um fornecedor da lista `fornecedores` da VENDA_FECHADA. */
export function lerFornecedorDaVenda(f: Record<string, unknown>): FornecedorDoCrm {
  const chave = txt(f.fornecedor_id);
  return {
    // CRM antigo não manda crm_supplier_id; a chave crm_supplier_<id> diz o mesmo.
    crmId: idDoCrm(f.crm_supplier_id) || idDoCrm(chave),
    financeiroId: txt(f.financeiro_id),
    chaveDaVenda: chave,
    nome: txt(f.fornecedor_nome),
    documento: documentoComparavel(f.fornecedor_cnpj),
    email: txt(f.fornecedor_email),
    telefone: txt(f.fornecedor_telefone),
    atualizadoEm: '',
  };
}

/** Sufixos de razão social que não mudam quem é a empresa. */
const SUFIXOS = new Set(['ltda', 'eireli', 'me', 'epp', 'sa', 's a', 'cia']);

/**
 * Nome que serve para comparar: sem acento, minúsculo, só letras e números, e
 * sem sufixo de razão social ("Rextur Ltda." é "rextur"). A MESMA regra do CRM
 * (shared/fornecedorDaConexao.ts lá): os dois lados precisam achar o mesmo par.
 */
export function nomeComparavel(v: unknown): string {
  let s = normalizarNome(txt(v));
  for (;;) {
    const partes = s.split(' ');
    const doisUltimos = partes.slice(-2).join(' ');
    if (partes.length > 2 && SUFIXOS.has(doisUltimos)) { s = partes.slice(0, -2).join(' '); continue; }
    if (partes.length > 1 && SUFIXOS.has(partes[partes.length - 1])) { s = partes.slice(0, -1).join(' '); continue; }
    return s;
  }
}

/** Nome que a pessoa vê: o fantasia e, sem ele, a razão social. */
export function nomeDoFornecedor(f: Pick<FornecedorCRM, 'nome_fantasia' | 'razao_social'>): string {
  return txt(f.nome_fantasia) || txt(f.razao_social);
}

/**
 * O cadastro com todos os campos. Fornecedor criado pela venda do CRM antes
 * desta versão tinha só nome e CNPJ, e a tela quebrava ao ler o e-mail.
 */
export function cadastroCompleto(data: Partial<FornecedorCRM> & { id: string }): FornecedorCRM {
  const base = createFornecedorCRM();
  return {
    ...base,
    ...data,
    id: data.id,
    regras_faturamento: { ...base.regras_faturamento, ...(data.regras_faturamento ?? {}) },
    dados_bancarios: Array.isArray(data.dados_bancarios) ? data.dados_bancarios : [],
    anexos: Array.isArray(data.anexos) ? data.anexos : [],
    marcadores: Array.isArray(data.marcadores) ? data.marcadores : [],
    campos_personalizados: data.campos_personalizados ?? {},
    status: data.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
  };
}

/**
 * Aplica o que o CRM disse ao cadastro daqui. Puro: devolve o cadastro novo e
 * o nome dos campos que mudaram.
 */
export function mesclarFornecedor(
  atual: FornecedorCRM,
  vindo: FornecedorDoCrm,
  modo: ModoDoCrm,
): { data: FornecedorCRM; mudou: string[] } {
  const data = { ...atual };
  const mudou: string[] = [];
  const sobrescreve = modo === 'sobrescrever';

  if (vindo.nome) {
    const fantasia = txt(atual.nome_fantasia);
    if (sobrescreve ? fantasia !== vindo.nome : !fantasia) {
      data.nome_fantasia = vindo.nome;
      mudou.push('nome');
      // A razão social que só repetia o nome acompanha o nome.
      const razao = txt(atual.razao_social);
      if (!razao || (sobrescreve && razao === fantasia)) data.razao_social = vindo.nome;
    }
  }
  if (vindo.documento) {
    const doc = documentoComparavel(atual.cnpj);
    if (sobrescreve ? doc !== vindo.documento : !doc) {
      data.cnpj = vindo.documento;
      mudou.push('documento');
    }
  }
  if (vindo.email) {
    const email = emailComparavel(atual.email);
    if (sobrescreve ? email !== emailComparavel(vindo.email) : !email) {
      data.email = vindo.email;
      mudou.push('email');
    }
  }
  if (vindo.telefone) {
    const tel = soDigitos(atual.telefone);
    if (sobrescreve ? tel !== soDigitos(vindo.telefone) : !tel) {
      data.telefone = vindo.telefone;
      mudou.push('telefone');
    }
  }
  if (sobrescreve && vindo.ativo !== undefined) {
    const status = vindo.ativo ? 'ATIVO' : 'INATIVO';
    if (atual.status !== status) {
      data.status = status;
      mudou.push(vindo.ativo ? 'reativado' : 'desativado');
    }
  }
  return { data, mudou };
}

/**
 * Cadastro daqui com o mesmo nome, quando ele é o único e nada o contradiz:
 * ligado a outro fornecedor do CRM ou com outro CPF/CNPJ não é o mesmo.
 */
export function candidatoPeloNome<T extends { nome: string; documento: string; crmId: string }>(
  cadastros: readonly T[],
  vindo: Pick<FornecedorDoCrm, 'nome' | 'documento' | 'crmId'>,
): T | null {
  const alvo = nomeComparavel(vindo.nome);
  if (!alvo) return null;
  const mesmos = cadastros.filter(c => nomeComparavel(c.nome) === alvo);
  if (mesmos.length !== 1) return null;
  const c = mesmos[0];
  if (c.crmId && c.crmId !== vindo.crmId) return null;
  const doc = documentoComparavel(c.documento);
  if (doc && vindo.documento && doc !== vindo.documento) return null;
  return c;
}

type Linha = {
  id: string;
  data: FornecedorCRM;
  crm_supplier_id: string | null;
  external_id: string | null;
  crm_atualizado_em: string | null;
};

const COLUNAS = `id, data, crm_supplier_id, external_id, crm_atualizado_em`;

function lerLinha(r: Record<string, unknown> | undefined): Linha | null {
  if (!r) return null;
  const quando = r.crm_atualizado_em;
  return {
    id: String(r.id),
    data: cadastroCompleto({ ...((r.data ?? {}) as Partial<FornecedorCRM>), id: String(r.id) }),
    crm_supplier_id: r.crm_supplier_id == null ? null : String(r.crm_supplier_id),
    external_id: r.external_id == null ? null : String(r.external_id),
    crm_atualizado_em: quando == null ? null : new Date(quando as string).toISOString(),
  };
}

async function primeira(exec: ExecutorSQL, sql: string, args: unknown[]): Promise<Linha | null> {
  const { rows } = await exec.query(sql, args);
  return lerLinha(rows[0]);
}

/** Acha o cadastro daqui que é o fornecedor do CRM, na ordem do cabeçalho. */
export async function acharFornecedor(
  exec: ExecutorSQL,
  tenantId: string,
  vindo: FornecedorDoCrm,
): Promise<{ linha: Linha; como: Exclude<ComoAchou, 'novo'> } | null> {
  if (vindo.crmId) {
    const l = await primeira(exec, `SELECT ${COLUNAS} FROM fornecedores_crm WHERE tenant_id = $1 AND crm_supplier_id = $2 LIMIT 1`, [tenantId, vindo.crmId]);
    if (l) return { linha: l, como: 'vinculo' };
  }
  if (vindo.financeiroId) {
    const l = await primeira(exec, `SELECT ${COLUNAS} FROM fornecedores_crm WHERE tenant_id = $1 AND id = $2`, [tenantId, vindo.financeiroId]);
    if (l) return { linha: l, como: 'id-do-financeiro' };
  }
  if (vindo.chaveDaVenda) {
    const l = await primeira(exec, `SELECT ${COLUNAS} FROM fornecedores_crm WHERE tenant_id = $1 AND external_id = $2 LIMIT 1`, [tenantId, vindo.chaveDaVenda]);
    if (l) return { linha: l, como: 'chave-da-venda' };
  }
  if (vindo.documento) {
    // O CNPJ digitado na tela fica formatado; o que veio da venda, só dígitos.
    const l = await primeira(
      exec,
      `SELECT ${COLUNAS} FROM fornecedores_crm
        WHERE tenant_id = $1 AND regexp_replace(cnpj, '\\D', '', 'g') = $2
        ORDER BY created_at, id LIMIT 1`,
      [tenantId, vindo.documento],
    );
    if (l) return { linha: l, como: 'documento' };
  }
  if (vindo.nome) {
    const { rows } = await exec.query(
      `SELECT id, nome_fantasia, data->>'razao_social' AS razao_social, cnpj, crm_supplier_id
         FROM fornecedores_crm WHERE tenant_id = $1`,
      [tenantId],
    );
    const cadastros = rows.map(r => ({
      id: String(r.id),
      nome: txt(r.nome_fantasia) || txt(r.razao_social),
      documento: txt(r.cnpj),
      crmId: txt(r.crm_supplier_id),
    }));
    const c = candidatoPeloNome(cadastros, vindo);
    if (c) {
      const l = await primeira(exec, `SELECT ${COLUNAS} FROM fornecedores_crm WHERE tenant_id = $1 AND id = $2`, [tenantId, c.id]);
      if (l) return { linha: l, como: 'nome' };
    }
  }
  return null;
}

/**
 * Recebe um fornecedor do CRM: acha (ou cria) o cadastro daqui, grava o
 * vínculo e aplica os campos. Roda dentro de uma transação: o lock por empresa
 * impede que duas entregas do mesmo fornecedor criem dois cadastros.
 */
export async function receberFornecedorDoCrm(
  exec: ExecutorSQL,
  tenantId: string,
  vindo: FornecedorDoCrm,
  modo: ModoDoCrm,
): Promise<ResultadoDoFornecedor | null> {
  await exec.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext('fornecedores_crm'))`, [tenantId]);

  const achado = await acharFornecedor(exec, tenantId, vindo);

  if (!achado) {
    if (!vindo.nome && !vindo.documento && !vindo.crmId && !vindo.chaveDaVenda) return null;
    const id = generateId();
    const nome = vindo.nome || 'Fornecedor';
    const data = cadastroCompleto({
      id,
      nome_fantasia: nome,
      razao_social: nome,
      cnpj: vindo.documento,
      email: vindo.email,
      telefone: vindo.telefone,
      status: vindo.ativo === false ? 'INATIVO' : 'ATIVO',
    });
    await exec.query(
      `INSERT INTO fornecedores_crm (id, nome_fantasia, cnpj, categoria, data, external_id, crm_supplier_id, crm_atualizado_em, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, '', $4, $5, $6, $7, $8, NOW(), NOW())`,
      [id, nome, vindo.documento, JSON.stringify({ ...data, origem: 'crm' }), vindo.chaveDaVenda || null, vindo.crmId || null, vindo.atualizadoEm || null, tenantId],
    );
    return {
      id, nome, como: 'novo', criado: true, vinculado: !!vindo.crmId, mudou: [], antigo: false, documentoEmUso: '',
      // Nasceu aqui pelo CRM: ele precisa saber qual é o cadastro.
      ecoar: true,
    };
  }

  const { linha, como } = achado;
  const vincular = !!vindo.crmId && !linha.crm_supplier_id;
  const antigo = modo === 'sobrescrever' && !!vindo.atualizadoEm && !!linha.crm_atualizado_em
    && vindo.atualizadoEm < linha.crm_atualizado_em;

  let { data, mudou } = antigo ? { data: linha.data, mudou: [] as string[] } : mesclarFornecedor(linha.data, vindo, modo);

  let documentoEmUso = '';
  if (mudou.includes('documento')) {
    const { rows } = await exec.query(
      `SELECT 1 FROM fornecedores_crm WHERE tenant_id = $1 AND id <> $2 AND regexp_replace(cnpj, '\\D', '', 'g') = $3 LIMIT 1`,
      [tenantId, linha.id, vindo.documento],
    );
    if (rows.length > 0) {
      documentoEmUso = vindo.documento;
      data = { ...data, cnpj: linha.data.cnpj };
      mudou = mudou.filter(c => c !== 'documento');
    }
  }

  // A chave da venda mais recente fica no cadastro, para a próxima venda
  // achá-lo no passo 3 (ninguém mais tem essa chave: o passo 3 falhou).
  const novaChave = vindo.chaveDaVenda && como !== 'chave-da-venda' && linha.external_id !== vindo.chaveDaVenda
    ? vindo.chaveDaVenda : null;
  const novoQuando = modo === 'sobrescrever' && vindo.atualizadoEm && !antigo ? vindo.atualizadoEm : null;

  if (mudou.length > 0 || vincular || novaChave || novoQuando) {
    await exec.query(
      `UPDATE fornecedores_crm
          SET data = $3,
              nome_fantasia = $4,
              cnpj = $5,
              crm_supplier_id = COALESCE($6, crm_supplier_id),
              external_id = COALESCE($7, external_id),
              crm_atualizado_em = COALESCE($8::timestamptz, crm_atualizado_em),
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [
        linha.id, tenantId, JSON.stringify(data), data.nome_fantasia ?? '', data.cnpj ?? '',
        vincular ? vindo.crmId : null, novaChave, novoQuando,
      ],
    );
  }

  return {
    id: linha.id,
    nome: nomeDoFornecedor(data) || vindo.nome,
    como,
    criado: false,
    vinculado: vincular,
    mudou,
    antigo,
    documentoEmUso,
    // O CRM não sabe qual cadastro daqui é o dele (ou acha que é outro).
    ecoar: !!vindo.crmId && vindo.financeiroId !== linha.id,
  };
}

const COMO_TEXTO: Record<ComoAchou, string> = {
  'vinculo': 'pelo vínculo',
  'id-do-financeiro': 'pelo cadastro daqui',
  'chave-da-venda': 'pela venda anterior',
  'documento': 'pelo CPF/CNPJ',
  'nome': 'pelo nome',
  'novo': '',
};

/** O que aconteceu, para o histórico da integração. */
export function descreverFornecedor(r: ResultadoDoFornecedor): string {
  const partes = [r.criado ? `fornecedor "${r.nome}" cadastrado` : `fornecedor "${r.nome}" encontrado ${COMO_TEXTO[r.como]}`];
  if (r.vinculado) partes.push('ligado ao CRM');
  if (r.antigo) partes.push('alteração mais antiga que a última recebida, ignorada');
  else if (r.mudou.length > 0) partes.push(`atualizado: ${r.mudou.join(', ')}`);
  if (r.documentoEmUso) partes.push(`CPF/CNPJ ${r.documentoEmUso} já é de outro fornecedor, não copiado`);
  return partes.join('; ');
}

/**
 * O cadastro como o CRM recebe (FORNECEDOR_CADASTRADO). Um só formato para a
 * tela, o eco e o envio de todos.
 */
export function payloadParaOCrm(
  f: FornecedorCRM,
  crmSupplierId: string | null,
  documentoNormalizado: string,
): Record<string, unknown> {
  return {
    fornecedor_id: f.id,
    financeiro_id: f.id,
    external_id: `entur_fornecedor_${f.id}`,
    crm_supplier_id: crmSupplierId || null,
    nome_fantasia: f.nome_fantasia ?? '',
    razao_social: f.razao_social ?? '',
    cnpj: documentoNormalizado,
    tipo: f.tipo ?? 'OUTROS',
    telefone: f.telefone ?? '',
    email: f.email ?? '',
    whatsapp: f.whatsapp ?? '',
    contato_principal: f.contato_principal ?? '',
    endereco_completo: f.endereco_completo ?? '',
    cidade: f.cidade ?? '',
    estado: f.estado ?? '',
    regras_faturamento: f.regras_faturamento ?? null,
    ativo: f.status !== 'INATIVO',
    atualizado_em: new Date().toISOString(),
  };
}

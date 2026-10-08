/**
 * O cliente que chega do CRM: CAMINHO ÚNICO de identidade e de atualização,
 * usado pela venda fechada (VENDA_FECHADA) e pela mudança de cadastro
 * (CLIENTE_ATUALIZADO).
 *
 * POR QUE EXISTE. Até 07/10/2026 a venda procurava o cliente só pelo id do
 * contato no CRM. Quem já existia no financeiro (cadastrado à mão, ou criado
 * pelo pagamento da Hotmart/Asaas com o mesmo CPF) ganhava um segundo
 * cadastro, e o contato que o CRM mesclou com outro virava um terceiro. E o
 * cliente achado nunca era atualizado: o CPF que o vendedor preencheu no CRM
 * depois da primeira venda nunca chegava aqui.
 *
 * QUEM É QUEM, na ordem de força do sinal:
 *   1. o id do contato no CRM (external_id);
 *   2. um id antigo do mesmo contato (contatos mesclados no CRM): o cadastro
 *      passa a carregar o id novo;
 *   3. ADOÇÃO de um cadastro do financeiro sem vínculo com o CRM, pelo
 *      CPF/CNPJ (forte) ou, sem documento que case, pelo e-mail;
 *   4. cadastro novo.
 * Cadastro já ligado a OUTRO contato do CRM nunca é adotado: para o CRM são
 * duas pessoas, e juntar aqui esconderia isso.
 *
 * O QUE MUDA NO CADASTRO.
 *   - Venda fechada só PREENCHE o que está vazio. O que alguém digitou no
 *     financeiro nunca é trocado por uma venda.
 *   - Mudança de cadastro no CRM é explícita: o campo alterado, com valor,
 *     SOBRESCREVE (colunas e JSON). Vazio nunca apaga, em nenhum dos dois.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { generateId } from './utils';
import { nomeDoCliente, tipoPessoa, type ClienteNomeavel } from './cliente-nome';
import { documentoComparavel, emailComparavel, soDigitos, telefoneComparavel } from './plataformas/conciliacao';

export type TipoClienteCRM = 'fisica' | 'juridica';

export interface EmpresaCRM {
  nome: string;
  /** Só dígitos, ou vazio. */
  cnpj: string;
}

export interface DadosClienteCRM {
  nome: string;
  /** Só dígitos, 11 (CPF) ou 14 (CNPJ). Qualquer outra coisa vira vazio. */
  documento: string;
  email: string;
  telefone: string;
  tipo: TipoClienteCRM | '';
  empresa: EmpresaCRM | null;
}

/** Um campo da mudança de cadastro. Ausente ou vazio é "não mexer". */
export type AlteracoesClienteCRM = Partial<DadosClienteCRM>;

const txt = (v: unknown): string =>
  (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();

export function tipoClienteCRM(v: unknown): TipoClienteCRM | '' {
  const t = txt(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (t === 'fisica' || t === 'pf') return 'fisica';
  if (t === 'juridica' || t === 'pj') return 'juridica';
  return '';
}

export function empresaCRM(v: unknown): EmpresaCRM | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const nome = txt(o.nome);
  if (!nome) return null;
  const cnpj = documentoComparavel(o.cnpj);
  return { nome, cnpj: cnpj.length === 14 ? cnpj : '' };
}

/** O retrato do cliente no formato do CLIENTE_ATUALIZADO (`cliente`). */
export function lerDadosCliente(o: unknown): DadosClienteCRM {
  const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  return {
    nome: txt(x.nome),
    documento: documentoComparavel(x.cpf_cnpj),
    email: txt(x.email),
    telefone: txt(x.telefone),
    tipo: tipoClienteCRM(x.tipo),
    empresa: empresaCRM(x.empresa),
  };
}

/** Só os campos alterados que trazem valor. null e vazio ficam de fora: nunca apagam. */
export function lerAlteracoesCliente(o: unknown): AlteracoesClienteCRM {
  const d = lerDadosCliente(o);
  const saida: AlteracoesClienteCRM = {};
  if (d.nome) saida.nome = d.nome;
  if (d.documento) saida.documento = d.documento;
  if (d.email) saida.email = d.email;
  if (d.telefone) saida.telefone = d.telefone;
  if (d.tipo) saida.tipo = d.tipo;
  if (d.empresa) saida.empresa = d.empresa;
  return saida;
}

/**
 * O cliente da venda fechada, que vem em campos soltos no payload.
 * `cliente_cpf_cnpj` (contrato v2, só dígitos) vence o `cliente_cpf` antigo.
 */
export function dadosClienteDaVenda(p: Record<string, unknown>): DadosClienteCRM {
  return {
    nome: txt(p.cliente_nome),
    documento: documentoComparavel(p.cliente_cpf_cnpj) || documentoComparavel(p.cliente_cpf),
    email: txt(p.cliente_email),
    telefone: txt(p.cliente_telefone),
    tipo: tipoClienteCRM(p.cliente_tipo),
    empresa: empresaCRM(p.cliente_empresa),
  };
}

/** Ids antigos do mesmo contato, sem o atual, sem repetição. */
export function lerIdsAnteriores(v: unknown, atual: string): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(txt).filter(id => id && id !== atual))].slice(0, 50);
}

// ---------------------------------------------------------------------------
// Mescla: função pura, é onde o "nunca sobrescreve o que foi digitado" mora
// ---------------------------------------------------------------------------

export interface LinhaCliente {
  nome: string;
  cpf_cnpj: string;
  tipo: string;
  data: Record<string, unknown>;
}

export interface MesclaCliente {
  linha: LinhaCliente;
  /** Campos que mudaram, na ordem em que mudaram. */
  campos: string[];
}

/** O cadastro usa o vocabulário da tela ('PF'/'PJ') ou o do banco ('fisica'/'juridica')? */
function usaPfPj(l: LinhaCliente): boolean {
  const t = txt(l.data.tipo || l.tipo).toUpperCase();
  return t === 'PF' || t === 'PJ';
}

function tipoNoVocabulario(l: LinhaCliente, t: TipoClienteCRM): string {
  if (usaPfPj(l)) return t === 'juridica' ? 'PJ' : 'PF';
  return t;
}

/** O documento do cadastro, em qualquer um dos campos onde ele mora. */
export function documentoDoCadastro(l: LinhaCliente): string {
  for (const v of [l.cpf_cnpj, l.data.cpf_cnpj, l.data.cpf, l.data.cnpj]) {
    const d = documentoComparavel(v);
    if (d) return d;
  }
  return '';
}

/**
 * Funde o que o CRM mandou com o cadastro que já existe.
 *
 * `alteracoes` null é venda fechada: só preenche vazio. Com `alteracoes` é
 * mudança de cadastro: o que veio com valor sobrescreve, o resto só preenche.
 */
export function mesclarCliente(
  atual: LinhaCliente,
  dados: DadosClienteCRM,
  alteracoes: AlteracoesClienteCRM | null,
): MesclaCliente {
  const data: Record<string, unknown> = { ...atual.data };
  let nome = atual.nome ?? '';
  let cpfCnpj = atual.cpf_cnpj ?? '';
  let tipo = atual.tipo ?? '';
  const campos: string[] = [];
  const marcar = (campo: string) => { if (!campos.includes(campo)) campos.push(campo); };
  const ehPj = () => tipoPessoa(txt(data.tipo || tipo)) === 'PJ';
  const base: LinhaCliente = { nome, cpf_cnpj: cpfCnpj, tipo, data: atual.data };

  const gravarTipo = (t: TipoClienteCRM) => {
    const v = tipoNoVocabulario(base, t);
    if (tipo === v && txt(data.tipo) === v) return;
    tipo = v;
    data.tipo = v;
    marcar('tipo');
  };

  // ── Documento (antes do nome: o tipo de pessoa sai dele) ────────────────
  const docs = [cpfCnpj, data.cpf_cnpj, data.cpf, data.cnpj];
  // "Tem documento" é ter qualquer dígito em qualquer campo: um valor que
  // alguém digitou, mesmo incompleto, não é trocado por uma venda.
  const temDocumento = docs.some(v => soDigitos(v) !== '');
  const docAtual = documentoDoCadastro(base);
  const gravarDocumento = (d: string, t: TipoClienteCRM | '') => {
    cpfCnpj = d;
    data.cpf_cnpj = d;
    if (d.length === 14) data.cnpj = d; else data.cpf = d;
    marcar('cpf_cnpj');
    gravarTipo(t || (d.length === 14 ? 'juridica' : 'fisica'));
  };
  if (alteracoes?.documento && alteracoes.documento !== docAtual) {
    gravarDocumento(alteracoes.documento, alteracoes.tipo || dados.tipo);
  } else if (!temDocumento && dados.documento) {
    gravarDocumento(dados.documento, dados.tipo);
  }
  if (alteracoes?.tipo) gravarTipo(alteracoes.tipo);

  // ── Nome ────────────────────────────────────────────────────────────────
  const nomeExibido = nomeDoCliente({ ...(data as ClienteNomeavel), nome: txt(data.nome) || nome, tipo: txt(data.tipo || tipo) });
  // O nome que a mudança do CRM substitui: o da pessoa física, ou o `nome`
  // simples. Nome fantasia e razão social de empresa são do financeiro.
  const nomeProprio = ehPj() ? (txt(data.nome) || txt(nome)) : (txt(data.nome_completo) || txt(data.nome) || txt(nome));
  const gravarNome = (n: string) => {
    nome = n;
    data.nome = n;
    if (!ehPj()) data.nome_completo = n;
    else if (!txt(data.razao_social) && !txt(data.nome_fantasia)) data.razao_social = n;
    marcar('nome');
  };
  if (alteracoes?.nome && alteracoes.nome !== nomeProprio) gravarNome(alteracoes.nome);
  else if (!nomeExibido && dados.nome) gravarNome(dados.nome);

  // ── E-mail ──────────────────────────────────────────────────────────────
  const emailAtual = txt(data.email);
  if (alteracoes?.email && emailComparavel(alteracoes.email) !== emailComparavel(emailAtual)) {
    data.email = alteracoes.email;
    marcar('email');
  } else if (!emailAtual && dados.email) {
    data.email = dados.email;
    marcar('email');
  }

  // ── Telefone ────────────────────────────────────────────────────────────
  const telAtual = [data.telefone, data.telefone_principal, data.whatsapp].map(txt).find(Boolean) ?? '';
  const mesmoTelefone = (a: string, b: string) => {
    const x = telefoneComparavel(a), y = telefoneComparavel(b);
    return x && y ? x === y : soDigitos(a) === soDigitos(b);
  };
  const gravarTelefone = (t: string) => {
    data.telefone = t;
    data.telefone_principal = t;
    marcar('telefone');
  };
  if (alteracoes?.telefone && !mesmoTelefone(alteracoes.telefone, telAtual)) gravarTelefone(alteracoes.telefone);
  else if (!telAtual && dados.telefone) gravarTelefone(dados.telefone);

  // ── Empresa do contato (informativa: não há campo dela na tela) ─────────
  const empAtual = (data.empresa && typeof data.empresa === 'object' ? data.empresa : null) as EmpresaCRM | null;
  const empNova = alteracoes ? (alteracoes.empresa ?? dados.empresa) : null;
  const mesmaEmpresa = (a: EmpresaCRM | null, b: EmpresaCRM) => !!a && txt(a.nome) === b.nome && txt(a.cnpj) === b.cnpj;
  if (empNova && !mesmaEmpresa(empAtual, empNova)) {
    data.empresa = empNova;
    marcar('empresa');
  } else if (!alteracoes && !txt(empAtual?.nome) && dados.empresa) {
    data.empresa = dados.empresa;
    marcar('empresa');
  }

  return { linha: { nome, cpf_cnpj: cpfCnpj, tipo, data }, campos };
}

// ---------------------------------------------------------------------------
// No banco
// ---------------------------------------------------------------------------

export interface EntradaClienteCRM {
  /** Id do contato no CRM ("crm_contact_<id>"). */
  externalId: string;
  /** Ids antigos do mesmo contato (mesclados no CRM). */
  anteriores: string[];
  /** O retrato do cliente: só preenche vazio. */
  dados: DadosClienteCRM;
  /** null na venda fechada; os campos alterados no CLIENTE_ATUALIZADO. */
  alteracoes: AlteracoesClienteCRM | null;
}

export type ComoAchouCliente = 'external_id' | 'id_anterior' | 'documento' | 'email' | 'novo';

export interface ClienteResolvido {
  id: string;
  como: ComoAchouCliente;
  /** Campos do cadastro que mudaram agora. */
  campos: string[];
  /** Outros cadastros ligados a ids antigos do mesmo contato. Ficam como estão. */
  outros: string[];
}

interface LinhaDoBanco {
  id: string;
  nome: string;
  cpf_cnpj: string;
  tipo: string;
  data: Record<string, unknown>;
  external_id: string;
}

const COLUNAS = `id, nome, cpf_cnpj, tipo, data, external_id`;

function lerLinha(r: Record<string, unknown>): LinhaDoBanco {
  return {
    id: String(r.id),
    nome: String(r.nome ?? ''),
    cpf_cnpj: String(r.cpf_cnpj ?? ''),
    tipo: String(r.tipo ?? ''),
    data: (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>,
    external_id: String(r.external_id ?? ''),
  };
}

const DIGITOS = (expr: string) => `regexp_replace(COALESCE(${expr}, ''), '[^0-9]', '', 'g')`;

/**
 * Acha (ou cria) o cliente do contato do CRM e aplica o que mudou.
 * Roda no executor de quem chama (pool ou transação).
 */
export async function resolverClienteCRM(
  exec: ExecutorSQL,
  tenantId: string,
  e: EntradaClienteCRM,
): Promise<ClienteResolvido> {
  if (!tenantId || !e.externalId) throw new Error('cliente do CRM sem id do contato');

  const documento = e.alteracoes?.documento || e.dados.documento;
  const email = emailComparavel(e.alteracoes?.email || e.dados.email);
  const outros: string[] = [];
  let achado: LinhaDoBanco | null = null;
  let como: ComoAchouCliente = 'novo';

  // (1) o mesmo contato
  {
    const { rows } = await exec.query(
      `SELECT ${COLUNAS} FROM clientes WHERE tenant_id = $1 AND external_id = $2 LIMIT 1`,
      [tenantId, e.externalId],
    );
    if (rows[0]) { achado = lerLinha(rows[0]); como = 'external_id'; }
  }

  // (2) um id antigo do mesmo contato: o cadastro mais antigo herda o id novo
  if (!achado && e.anteriores.length > 0) {
    const { rows } = await exec.query(
      `SELECT ${COLUNAS} FROM clientes
        WHERE tenant_id = $1 AND external_id = ANY($2::text[])
        ORDER BY created_at ASC, id ASC`,
      [tenantId, e.anteriores],
    );
    if (rows[0]) {
      achado = lerLinha(rows[0]);
      como = 'id_anterior';
      for (const r of rows.slice(1)) outros.push(String(r.id));
    }
  }

  // (3) adoção pelo documento: só cadastro SEM vínculo com o CRM
  if (!achado && documento) {
    const { rows } = await exec.query(
      `SELECT ${COLUNAS} FROM clientes
        WHERE tenant_id = $1 AND COALESCE(external_id, '') = ''
          AND $2 IN (${DIGITOS('cpf_cnpj')}, ${DIGITOS(`data->>'cpf_cnpj'`)},
                     ${DIGITOS(`data->>'cpf'`)}, ${DIGITOS(`data->>'cnpj'`)})
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
      [tenantId, documento],
    );
    if (rows[0]) { achado = lerLinha(rows[0]); como = 'documento'; }
  }

  // (4) adoção pelo e-mail, quando o documento não casou. Cadastro com OUTRO
  //     documento é outra pessoa usando o mesmo e-mail (família, empresa).
  if (!achado && email) {
    const { rows } = await exec.query(
      `SELECT ${COLUNAS} FROM clientes
        WHERE tenant_id = $1 AND COALESCE(external_id, '') = ''
          AND LOWER(TRIM(COALESCE(data->>'email', ''))) = $2
        ORDER BY created_at ASC, id ASC
        LIMIT 20`,
      [tenantId, email],
    );
    const candidato = rows.map(lerLinha).find(l => {
      const doc = documentoDoCadastro(l);
      return !documento || !doc || doc === documento;
    });
    if (candidato) { achado = candidato; como = 'email'; }
  }

  if (achado) {
    const m = mesclarCliente(achado, e.dados, e.alteracoes);
    const anterioresGravados = Array.isArray(achado.data.external_ids_anteriores)
      ? (achado.data.external_ids_anteriores as unknown[]).map(txt).filter(Boolean)
      : [];
    const anteriores = [...new Set([
      ...anterioresGravados,
      ...e.anteriores,
      ...(achado.external_id && achado.external_id !== e.externalId ? [achado.external_id] : []),
    ])].filter(id => id !== e.externalId);
    const vinculoMudou = achado.external_id !== e.externalId || txt(achado.data.external_id) !== e.externalId;
    const anterioresMudaram = anteriores.length !== anterioresGravados.length;

    if (m.campos.length > 0 || vinculoMudou || anterioresMudaram) {
      const data: Record<string, unknown> = { ...m.linha.data, external_id: e.externalId };
      if (anteriores.length > 0) data.external_ids_anteriores = anteriores;
      await exec.query(
        `UPDATE clientes
            SET nome = $3, cpf_cnpj = $4, tipo = $5, data = $6::jsonb, external_id = $7, updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        [achado.id, tenantId, m.linha.nome, m.linha.cpf_cnpj, m.linha.tipo || 'fisica', JSON.stringify(data), e.externalId],
      );
    }
    return { id: achado.id, como, campos: m.campos, outros };
  }

  // (5) cadastro novo, com o que veio (a mudança explícita vence o retrato)
  const v: DadosClienteCRM = { ...e.dados, ...(e.alteracoes ?? {}) };
  const id = generateId();
  const tipo: TipoClienteCRM = v.tipo || (v.documento.length === 14 ? 'juridica' : 'fisica');
  const data: Record<string, unknown> = {
    id,
    nome: v.nome,
    cpf_cnpj: v.documento,
    tipo,
    email: v.email,
    telefone: v.telefone,
    origem: 'crm',
    external_id: e.externalId,
  };
  if (v.empresa) data.empresa = v.empresa;
  if (e.anteriores.length > 0) data.external_ids_anteriores = e.anteriores;
  await exec.query(
    `INSERT INTO clientes (id, nome, cpf_cnpj, tipo, data, external_id, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW(), NOW())`,
    [id, v.nome, v.documento, tipo, JSON.stringify(data), e.externalId, tenantId],
  );
  return { id, como: 'novo', campos: [], outros };
}

/** A frase do evento: o que aconteceu com o cliente, para quem lê o log. */
export function descreverCliente(r: ClienteResolvido): string {
  const como: Record<ComoAchouCliente, string> = {
    external_id: 'achado pelo id do CRM',
    id_anterior: 'achado por um id antigo do contato (mesclado no CRM)',
    documento: 'cadastro existente adotado pelo CPF/CNPJ',
    email: 'cadastro existente adotado pelo e-mail',
    novo: 'cadastro novo',
  };
  const partes = [como[r.como]];
  if (r.campos.length > 0) partes.push(`mudou ${r.campos.join(', ')}`);
  if (r.outros.length > 0) partes.push(`outros cadastros do mesmo contato ficaram como estavam: ${r.outros.join(', ')}`);
  return `cliente ${r.id} (${partes.join('; ')})`;
}

/**
 * Várias empresas dentro da agência (06/11/2026, E7 frente G2). Lógica pura:
 * não toca banco nem rede, serve a tela e o servidor.
 *
 * Uma agência pode ter mais de um CNPJ (lojas, filiais, uma empresa para
 * cada linha de negócio). Toda agência nasce com UMA empresa, a principal
 * (`EMPRESA_PRINCIPAL_ID`), montada sozinha a partir dos dados da agência; os
 * registros de antes ficam todos nela.
 *
 * REGRA DE OURO: com uma empresa só, nada muda. Nenhum seletor, nenhuma
 * coluna, nenhum filtro: `escopoVisivel` devolve `null` ("sem recorte") e
 * todas as funções de filtro deixam a lista intacta. A multiempresa só
 * aparece quando a agência cadastra a segunda empresa.
 */

/** Id fixo da empresa principal, o mesmo em toda agência. */
export const EMPRESA_PRINCIPAL_ID = 'principal';

export interface Empresa {
  id: string;
  nome: string;
  razao_social: string;
  cnpj: string;
  principal: boolean;
  ativa: boolean;
  /** Ordem de exibição (a principal primeiro). */
  ordem?: number;
}

/** Empresas em que a pessoa trabalha agora. `null` = sem recorte (todas). */
export type EmpresasVisiveis = readonly string[] | null;

const texto = (v: unknown, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Só os dígitos. */
export function soDigitos(v: unknown): string {
  return String(v ?? '').replace(/\D+/g, '');
}

/** CNPJ com os dígitos verificadores certos (14 dígitos, não repetidos). */
export function cnpjValido(v: unknown): boolean {
  const d = soDigitos(v);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (base: string, pesos: number[]) => {
    const s = pesos.reduce((acc, p, i) => acc + Number(base[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(d[12]) && d2 === Number(d[13]);
}

/** 12.345.678/0001-90 */
export function formatarCnpj(v: unknown): string {
  const d = soDigitos(v);
  if (d.length !== 14) return String(v ?? '');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export type ResultadoEmpresa = { ok: true; empresa: Omit<Empresa, 'id' | 'principal'> } | { ok: false; erro: string };

/**
 * Confere o cadastro de uma empresa vindo da tela. Nome obrigatório; CNPJ,
 * quando preenchido, precisa ser válido (a principal pode ficar sem CNPJ,
 * como a agência de hoje pode).
 */
export function normalizarEmpresa(entrada: Record<string, unknown>): ResultadoEmpresa {
  const nome = texto(entrada.nome, 80);
  if (!nome) return { ok: false, erro: 'Dê um nome à empresa (como ela aparece nas listas).' };
  const razao = texto(entrada.razao_social, 160);
  const cnpj = soDigitos(entrada.cnpj);
  if (cnpj && !cnpjValido(cnpj)) return { ok: false, erro: 'O CNPJ não confere. Revise os números.' };
  return {
    ok: true,
    empresa: { nome, razao_social: razao, cnpj, ativa: entrada.ativa !== false, ordem: Number.isFinite(Number(entrada.ordem)) ? Number(entrada.ordem) : undefined },
  };
}

/** A principal a partir dos dados da agência (nome fantasia, razão, CNPJ). */
export function principalDaAgencia(agencia: Record<string, unknown> | null | undefined): Empresa {
  const a = agencia ?? {};
  const razao = texto(a.razao_social, 160);
  const nome = texto(a.nome_fantasia, 80) || razao.slice(0, 80) || 'Empresa principal';
  return { id: EMPRESA_PRINCIPAL_ID, nome, razao_social: razao, cnpj: soDigitos(a.cnpj), principal: true, ativa: true, ordem: 0 };
}

/** Principal primeiro, depois por nome. */
export function ordenarEmpresas<T extends Pick<Empresa, 'nome' | 'principal'> & { ordem?: number }>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => {
    if (a.principal !== b.principal) return a.principal ? -1 : 1;
    const oa = a.ordem ?? 1000, ob = b.ordem ?? 1000;
    if (oa !== ob) return oa - ob;
    return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
  });
}

// ---------------------------------------------------------------------------
// Escopo: o que a pessoa vê agora

/**
 * As empresas que entram nas listas e relatórios agora.
 *
 * - `todas`: as empresas ATIVAS da agência.
 * - `permitidas`: as liberadas para a pessoa pelo perfil de acesso (`null` =
 *   todas, o padrão).
 * - `selecao`: o que ela marcou no seletor (vazio = todas as que pode ver).
 *
 * Devolve `null` quando não há recorte nenhum: a agência tem uma empresa só,
 * ou a pessoa vê todas. Nesse caso nenhuma lista muda.
 */
export function escopoVisivel(args: {
  todas: readonly string[];
  permitidas: readonly string[] | null;
  selecao: readonly string[] | null | undefined;
}): EmpresasVisiveis {
  const todas = [...new Set(args.todas)];
  // Uma empresa só: nunca há recorte (regra de ouro).
  if (todas.length < 2) return null;
  const podeVer = args.permitidas === null ? todas : todas.filter(e => args.permitidas!.includes(e));
  const marcadas = (args.selecao ?? []).filter(e => podeVer.includes(e));
  const visiveis = marcadas.length > 0 ? marcadas : podeVer;
  if (visiveis.length === todas.length) return null;
  return [...visiveis].sort();
}

/** A empresa gravada no registro; sem nenhuma, a principal (registro de antes). */
export function empresaDoRegistro(item: Record<string, unknown> | null | undefined): string {
  const e = texto(item?.empresa_id, 80);
  return e || EMPRESA_PRINCIPAL_ID;
}

/**
 * Empresas que o registro toca: a dele e as do rateio entre empresas. Uma
 * despesa rateada entre A e B aparece em quem vê A e em quem vê B (cada um
 * soma só a sua parte nos relatórios por fatia).
 */
export function empresasDoRegistro(item: Record<string, unknown> | null | undefined): string[] {
  const set = new Set<string>([empresaDoRegistro(item)]);
  const rateio = item?.rateio;
  if (Array.isArray(rateio)) {
    let algumaLinhaComEmpresa = false;
    const doRateio = new Set<string>();
    for (const l of rateio) {
      const e = texto((l as Record<string, unknown> | null)?.empresa_id, 80);
      if (e) { algumaLinhaComEmpresa = true; doRateio.add(e); }
    }
    // Rateado entre empresas: as linhas dizem onde o dinheiro cai. Linha sem
    // empresa fica na empresa do registro.
    if (algumaLinhaComEmpresa) {
      const semEmpresa = rateio.some(l => !texto((l as Record<string, unknown> | null)?.empresa_id, 80));
      const saida = new Set(doRateio);
      if (semEmpresa) saida.add(empresaDoRegistro(item));
      return [...saida].sort();
    }
  }
  return [...set];
}

/** O registro aparece para quem vê `visiveis`? */
export function registroVisivel(item: Record<string, unknown>, visiveis: EmpresasVisiveis): boolean {
  if (visiveis === null) return true;
  return empresasDoRegistro(item).some(e => visiveis.includes(e));
}

/** Empresas em que a conta bancária está disponível (a dela e as marcadas). */
export function empresasDaContaBancaria(conta: Record<string, unknown> | null | undefined): string[] {
  const set = new Set<string>([empresaDoRegistro(conta)]);
  const disp = conta?.empresas_disponiveis;
  if (Array.isArray(disp)) for (const e of disp) { const t = texto(e, 80); if (t) set.add(t); }
  return [...set].sort();
}

export function contaBancariaVisivel(conta: Record<string, unknown>, visiveis: EmpresasVisiveis): boolean {
  if (visiveis === null) return true;
  return empresasDaContaBancaria(conta).some(e => visiveis.includes(e));
}

/** A conta bancária pode ser usada num lançamento da empresa `empresa`? */
export function contaDisponivelNaEmpresa(conta: Record<string, unknown>, empresa: string): boolean {
  return empresasDaContaBancaria(conta).includes(empresa || EMPRESA_PRINCIPAL_ID);
}

export interface FiltroDeEmpresa {
  /** 'registro' (empresa_id + rateio), 'conta_bancaria' (cadastro de contas) ou 'por_conta' (pela conta bancária da linha). */
  tipo: 'registro' | 'conta_bancaria' | 'por_conta';
  /** Para 'por_conta': campos com id de conta bancária (basta UM visível). */
  campos?: string[];
}

/**
 * Filtra as linhas já lidas. `contasVisiveis` só é usado pelo tipo
 * 'por_conta' (ids das contas bancárias que a pessoa vê agora).
 */
export function filtrarPorEmpresa<T extends Record<string, unknown>>(
  itens: T[], filtro: FiltroDeEmpresa | undefined, visiveis: EmpresasVisiveis, contasVisiveis?: ReadonlySet<string>,
): T[] {
  if (!filtro || visiveis === null) return itens;
  switch (filtro.tipo) {
    case 'registro': return itens.filter(i => registroVisivel(i, visiveis));
    case 'conta_bancaria': return itens.filter(i => contaBancariaVisivel(i, visiveis));
    case 'por_conta': {
      const campos = filtro.campos ?? ['conta_bancaria_id'];
      return itens.filter(i => {
        const ids = campos.map(c => texto(i[c], 120)).filter(Boolean);
        if (ids.length === 0) return true;
        return ids.some(id => contasVisiveis?.has(id) ?? false);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Permissão por empresa (perfis de acesso)

export interface GrupoComEmpresas { acesso_total: boolean; empresas: string[] }
export interface RestricaoComEmpresas { empresas_liberadas: string[] }

/**
 * Empresas liberadas para a pessoa, pela mesma regra das contas bancárias:
 * perfil sem empresa marcada libera todas; com mais de um perfil, vale a
 * soma; a restrição própria corta por cima. `null` = todas. Diferente das
 * contas, "acesso completo" NÃO libera todas as empresas: o gerente da loja
 * pode ter acesso completo só na loja dele.
 */
export function empresasLiberadasPor(
  nuncaRestringido: boolean,
  grupos: readonly GrupoComEmpresas[],
  usuario: RestricaoComEmpresas | null,
): string[] | null {
  if (nuncaRestringido) return null;
  let doGrupo: Set<string> | null = null;
  if (grupos.length > 0 && !grupos.some(g => g.empresas.length === 0)) {
    doGrupo = new Set(grupos.flatMap(g => g.empresas));
  }
  const doUsuario = usuario && usuario.empresas_liberadas.length > 0 ? new Set(usuario.empresas_liberadas) : null;
  if (!doGrupo && !doUsuario) return null;
  if (doGrupo && doUsuario) return [...doGrupo].filter(e => doUsuario.has(e)).sort();
  return [...(doGrupo ?? doUsuario)!].sort();
}

// ---------------------------------------------------------------------------
// Configurações por empresa

/** Seções de configuração que valem por empresa. */
export const SECOES_POR_EMPRESA = ['financeiro', 'cobranca', 'vendas', 'notas'] as const;
export type SecaoPorEmpresa = (typeof SECOES_POR_EMPRESA)[number];

export const ROTULO_DA_SECAO: Record<SecaoPorEmpresa, string> = {
  financeiro: 'Financeiro',
  cobranca: 'Cobrança',
  vendas: 'Vendas',
  notas: 'Notas fiscais',
};

export function ehSecaoPorEmpresa(v: unknown): v is SecaoPorEmpresa {
  return typeof v === 'string' && (SECOES_POR_EMPRESA as readonly string[]).includes(v);
}

/**
 * Chaves que NUNCA se copiam de uma empresa para outra: são da empresa (o
 * token e a conexão do emissor, o certificado, o número do emissor). Copiar
 * isso faria a empresa B emitir com o CNPJ da A.
 */
export const CHAVES_QUE_NAO_SE_COPIAM: Record<SecaoPorEmpresa, readonly string[]> = {
  // A conta previsão é uma conta bancária da própria empresa (E7, frente D).
  financeiro: ['conta_previsao_padrao'],
  cobranca: ['credenciais', 'token', 'chave_api', 'webhook_segredo', 'conta_id'],
  vendas: [],
  notas: ['token', 'token_cofre', 'token_mascarado', 'empresa_id', 'certificado', 'conectado', 'cnpj', 'inscricao_municipal', 'id'],
};

/** O que a cópia leva: tudo, menos o que é da própria empresa. */
export function configParaCopiar(secao: SecaoPorEmpresa, origem: Record<string, unknown>, destinoAtual: Record<string, unknown> = {}): Record<string, unknown> {
  const fica = new Set(CHAVES_QUE_NAO_SE_COPIAM[secao]);
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(origem ?? {})) if (!fica.has(k)) saida[k] = v;
  for (const k of fica) if (k in destinoAtual) saida[k] = destinoAtual[k];
  return saida;
}

// ---------------------------------------------------------------------------
// Rateio entre empresas (a dimensão nova das linhas de rateio)

/** As empresas usadas nas linhas do rateio existem e estão ativas? Devolve o erro ou null. */
export function recusaDoRateioEntreEmpresas(
  rateio: unknown, empresasAtivas: readonly string[],
): string | null {
  if (!Array.isArray(rateio)) return null;
  for (let i = 0; i < rateio.length; i++) {
    const e = texto((rateio[i] as Record<string, unknown> | null)?.empresa_id, 80);
    if (e && !empresasAtivas.includes(e)) return `A empresa da linha ${i + 1} do rateio não existe ou está inativa.`;
  }
  return null;
}

/** Texto curto para o seletor: "Todas as empresas", "Loja Centro", "2 empresas". */
export function rotuloDaSelecao(selecionadas: readonly string[], empresas: readonly Pick<Empresa, 'id' | 'nome'>[]): string {
  if (selecionadas.length === 0 || selecionadas.length === empresas.length) return 'Todas as empresas';
  if (selecionadas.length === 1) return empresas.find(e => e.id === selecionadas[0])?.nome ?? '1 empresa';
  return `${selecionadas.length} empresas`;
}

/**
 * Parte das empresas visíveis num título (0 a 1). Sem rateio entre empresas:
 * 1 se a empresa dele é visível, 0 se não. Com rateio: a soma dos percentuais
 * das linhas das empresas visíveis (linha sem empresa conta para a do título).
 */
export function parteNasEmpresas(item: Record<string, unknown>, visiveis: EmpresasVisiveis): number {
  if (visiveis === null) return 1;
  const propria = empresaDoRegistro(item);
  const rateio = Array.isArray(item.rateio) ? (item.rateio as Array<Record<string, unknown>>) : [];
  const comEmpresa = rateio.some(l => texto(l?.empresa_id, 80));
  if (!comEmpresa) return visiveis.includes(propria) ? 1 : 0;
  let total = 0, dentro = 0;
  for (const l of rateio) {
    const p = Number(l?.percentual) || 0;
    if (p <= 0) continue;
    total += p;
    if (visiveis.includes(texto(l?.empresa_id, 80) || propria)) dentro += p;
  }
  return total > 0 ? dentro / total : (visiveis.includes(propria) ? 1 : 0);
}

const CAMPOS_DE_VALOR = ['valor_final', 'valor_original', 'valor_pago', 'valor_recebido', 'juros', 'multa', 'desconto', 'taxa'] as const;

/**
 * Os títulos como as telas que somam no navegador (DRE, Fluxo de caixa)
 * devem ver no recorte de empresas: o título rateado entre empresas entra só
 * com a parte das empresas visíveis; o de fora some. `null` = a lista igual.
 */
export function contasNoRecorte<T extends object>(contas: readonly T[], visiveis: EmpresasVisiveis): T[] {
  if (visiveis === null) return contas as T[];
  const saida: T[] = [];
  for (const c of contas) {
    const parte = parteNasEmpresas(c as Record<string, unknown>, visiveis);
    if (parte <= 0) continue;
    if (parte >= 1) { saida.push(c); continue; }
    const copia = { ...(c as Record<string, unknown>) };
    for (const k of CAMPOS_DE_VALOR) {
      const v = Number(copia[k]);
      if (copia[k] != null && copia[k] !== '' && Number.isFinite(v)) copia[k] = Math.round(v * parte * 100) / 100;
    }
    saida.push(copia as T);
  }
  return saida;
}

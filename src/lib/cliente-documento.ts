/**
 * O documento e o endereço do cliente — o que a nota fiscal precisa dele.
 *
 * POR QUE EXISTE. A prefeitura recusa nota sem CPF ou CNPJ do tomador
 * (nfse-calculo.ts:299), e o cadastro rápido de cliente que existia nas telas
 * de venda pedia nome, e-mail e telefone — nunca o documento. Toda pessoa
 * cadastrada pelo caminho rápido nascia impossibilitada de gerar nota, e o
 * problema só aparecia semanas depois, na hora de emitir.
 *
 * DUAS FORMAS DE ENDEREÇO NO MESMO BANCO. O tipo Cliente guarda o endereço
 * PLANO (cep, logradouro, numero...), mas o montador do tomador lia
 * `cliente.endereco.cep` — uma chave que não existe em nenhum cliente. O
 * resultado é que TODA nota saía com o endereço do tomador em branco, sem erro
 * nenhum, porque os campos de endereço são opcionais no envio. Aqui as duas
 * formas são lidas, com a plana tendo precedência.
 *
 * VALIDAÇÃO DE VERDADE, não só contagem de dígitos. Um CPF com um dígito
 * trocado tem onze caracteres e passa em qualquer conferência de tamanho — e é
 * recusado pela prefeitura depois, quando a venda já está fechada e o cliente
 * esperando. O dígito verificador é conferido na entrada.
 */

export interface ClienteComDocumento {
  tipo?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
  cpf_cnpj?: string | null;
  // Endereço plano, que é o formato real do cadastro.
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  // Endereço aninhado, aceito como retaguarda para registro de outra origem.
  endereco?: Record<string, unknown> | null;
}

export interface EnderecoDoCliente {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
}

export type TipoDeDocumento = 'CPF' | 'CNPJ' | 'vazio' | 'invalido';

/** Só os dígitos. Máscara, ponto, traço e barra saem. */
export function apenasDigitos(valor: string | null | undefined): string {
  return String(valor ?? '').replace(/\D+/g, '');
}

/**
 * Confere o dígito verificador do CPF.
 *
 * Rejeita também as sequências repetidas (111.111.111-11 e irmãs): elas passam
 * na conta do dígito verificador e são recusadas por qualquer órgão.
 */
export function cpfValido(valor: string | null | undefined): boolean {
  const d = apenasDigitos(valor);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  const digito = (ate: number): number => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

/** Confere o dígito verificador do CNPJ. */
export function cnpjValido(valor: string | null | undefined): boolean {
  const d = apenasDigitos(valor);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const digito = (ate: number): number => {
    // Os pesos vão de 2 a 9, repetindo — daí a volta em 1 quando passa de 9.
    let peso = ate - 7;
    let soma = 0;
    for (let i = 0; i < ate; i++) {
      soma += Number(d[i]) * peso;
      peso -= 1;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(12) === Number(d[12]) && digito(13) === Number(d[13]);
}

/** O que este documento é, incluindo o veredito de "tem tamanho mas está errado". */
export function tipoDoDocumento(valor: string | null | undefined): TipoDeDocumento {
  const d = apenasDigitos(valor);
  if (!d) return 'vazio';
  if (d.length === 11) return cpfValido(d) ? 'CPF' : 'invalido';
  if (d.length === 14) return cnpjValido(d) ? 'CNPJ' : 'invalido';
  return 'invalido';
}

/** Vazio é aceito (cliente sem documento existe); errado não. */
export function documentoValido(valor: string | null | undefined): boolean {
  const t = tipoDoDocumento(valor);
  return t === 'CPF' || t === 'CNPJ' || t === 'vazio';
}

/** 000.000.000-00 ou 00.000.000/0000-00. Documento incompleto sai como está. */
export function formatarDocumento(valor: string | null | undefined): string {
  const d = apenasDigitos(valor);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
}

/** Máscara progressiva, para o campo se formatar enquanto a pessoa digita. */
export function mascararDocumento(valor: string | null | undefined): string {
  const d = apenasDigitos(valor).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
}

/** CEP com o traço, quando completo. */
export function mascararCep(valor: string | null | undefined): string {
  const d = apenasDigitos(valor).slice(0, 8);
  return d.length > 5 ? d.replace(/^(\d{5})(\d)/, '$1-$2') : d;
}

/**
 * O endereço do cliente, nas duas formas em que ele existe.
 *
 * A plana tem precedência porque é a que o cadastro grava; a aninhada entra só
 * quando a plana está vazia, para registro vindo de outra origem não perder o
 * endereço.
 */
export function enderecoDoCliente(
  cliente: ClienteComDocumento | null | undefined,
): EnderecoDoCliente {
  const aninhado = (cliente?.endereco ?? {}) as Record<string, unknown>;
  const ler = (chave: keyof EnderecoDoCliente): string => {
    const plano = String((cliente as Record<string, unknown> | null | undefined)?.[chave] ?? '').trim();
    if (plano) return plano;
    return String(aninhado?.[chave] ?? '').trim();
  };
  return {
    cep: ler('cep'),
    logradouro: ler('logradouro'),
    numero: ler('numero'),
    complemento: ler('complemento'),
    bairro: ler('bairro'),
    cidade: ler('cidade'),
    estado: ler('estado'),
  };
}

/** O que ainda falta neste cliente para a nota fiscal sair. */
export function faltaParaNota(
  cliente: (ClienteComDocumento & { nome?: string | null }) | null | undefined,
  nome: string,
): string[] {
  const faltas: string[] = [];
  if (!nome.trim()) faltas.push('nome');
  const documento =
    cliente?.cpf || cliente?.cnpj || cliente?.cpf_cnpj || '';
  const tipo = tipoDoDocumento(documento);
  if (tipo === 'vazio') faltas.push('CPF ou CNPJ');
  else if (tipo === 'invalido') faltas.push('CPF ou CNPJ válido');
  return faltas;
}

/** Atalho de leitura: dá para emitir nota para este cliente? */
export function prontoParaNota(
  cliente: (ClienteComDocumento & { nome?: string | null }) | null | undefined,
  nome: string,
): boolean {
  return faltaParaNota(cliente, nome).length === 0;
}

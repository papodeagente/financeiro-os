/**
 * Situação da empresa perante o Simples Nacional, lida da base da Receita.
 *
 * Por que este módulo existe: a NFS-e nacional recusa a nota com o erro
 * E0160 quando a opção declarada na DPS não bate com o cadastro do Simples
 * NO MÊS DE COMPETÊNCIA. Perguntar isso à agência é pedir um dado que ela
 * costuma errar, e que o sistema já tem como olhar sozinho.
 *
 * O defeito que isto corrige: a leitura anterior só aceitava a string
 * literal "true". As bases de CNPJ devolvem booleano (`opcao_pelo_simples:
 * true`), objeto aninhado (`simples: { optante: true }`) ou letra ("S").
 * Em todos esses casos a empresa optante era declarada NÃO OPTANTE, que é
 * exatamente o que o E0160 recusa.
 */

/** Vocabulário da AceleraAPI para o enquadramento. */
export type EnquadramentoSimples =
  /** A base não informou. Diferente de "não optante": com zero a tela
   *  mantém o que já estava configurado em vez de rebaixar sem ter lido. */
  | 0
  /** Não optante. */
  | 1
  /** Optante, MEI. */
  | 2
  /** Optante, ME ou EPP. */
  | 3;

export interface SituacaoSimples {
  enquadramento: EnquadramentoSimples;
  /** Frase curta explicando de onde veio a conclusão, para a tela poder
   *  mostrar e o suporte poder auditar sem abrir log. */
  motivo: string;
  data_opcao: string;
  data_exclusao: string;
}

/**
 * Lê um campo booleano em qualquer das formas que as bases usam.
 *
 * Devolve null quando o campo não existe, que é diferente de false: não
 * saber não é a mesma coisa que saber que não.
 */
export function lerBooleano(valor: unknown): boolean | null {
  if (valor === true || valor === false) return valor;
  if (typeof valor === 'number') return valor === 1 ? true : valor === 0 ? false : null;
  if (typeof valor === 'string') {
    const v = valor.trim().toLowerCase();
    if (!v) return null;
    if (['true', 'sim', 's', '1', 'optante'].includes(v)) return true;
    if (['false', 'nao', 'não', 'n', '0', 'nao optante', 'não optante'].includes(v)) return false;
  }
  return null;
}

/** Caminho com ponto dentro de um objeto, sem lançar no meio. */
function em(o: unknown, caminho: string): unknown {
  return caminho.split('.').reduce<unknown>(
    (acc, p) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[p] : undefined),
    o,
  );
}

/** Primeiro caminho que responda booleano de verdade. */
function booleanoEm(o: unknown, ...caminhos: string[]): boolean | null {
  for (const c of caminhos) {
    const b = lerBooleano(em(o, c));
    if (b !== null) return b;
  }
  return null;
}

/** Data em 'YYYY-MM-DD' a partir de ISO, 'DD/MM/YYYY' ou timestamp. */
export function lerData(valor: unknown): string {
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return new Date(valor).toISOString().slice(0, 10);
  }
  if (typeof valor !== 'string') return '';
  const v = valor.trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return '';
}

function dataEm(o: unknown, ...caminhos: string[]): string {
  for (const c of caminhos) {
    const d = lerData(em(o, c));
    if (d) return d;
  }
  return '';
}

const CAMINHOS_SIMPLES = [
  'opcao_pelo_simples', 'simples.optante', 'simples_nacional',
  'optante_simples_nacional', 'optante_simples', 'simples',
  'estabelecimento.simples.optante', 'empresa.simples.optante',
];

const CAMINHOS_MEI = [
  'opcao_pelo_mei', 'mei.optante', 'optante_mei', 'mei',
  'estabelecimento.mei.optante', 'empresa.simples.mei',
];

/**
 * Situação perante o Simples, opcionalmente no mês de competência.
 *
 * Quando a base informa a data de opção e a de exclusão, a resposta vale
 * PARA AQUELE MÊS: empresa que entrou no Simples em março continua não
 * optante numa nota de fevereiro, e é assim que o validador nacional pensa.
 * Sem competência informada, responde a situação de hoje.
 */
export function situacaoSimples(
  dados: unknown,
  mesCompetencia?: string,
): SituacaoSimples {
  const optanteSimples = booleanoEm(dados, ...CAMINHOS_SIMPLES);
  const optanteMei = booleanoEm(dados, ...CAMINHOS_MEI);

  const data_opcao = dataEm(
    dados,
    'data_opcao_pelo_simples', 'simples.data_opcao', 'data_opcao_simples',
    'simples.desde',
  );
  const data_exclusao = dataEm(
    dados,
    'data_exclusao_do_simples', 'simples.data_exclusao', 'data_exclusao_simples',
  );

  if (optanteSimples === null && optanteMei === null) {
    return {
      enquadramento: 0,
      motivo: 'A base consultada não informou a situação no Simples Nacional.',
      data_opcao,
      data_exclusao,
    };
  }

  // Fora da janela de opção, a empresa não era optante naquele mês, por
  // mais que seja hoje. É esta a comparação que o E0160 faz.
  if (mesCompetencia && /^\d{4}-\d{2}$/.test(mesCompetencia)) {
    const inicio = data_opcao.slice(0, 7);
    const fim = data_exclusao.slice(0, 7);
    if (inicio && mesCompetencia < inicio) {
      return {
        enquadramento: 1,
        motivo: `A empresa entrou no Simples em ${inicio}, depois da competência ${mesCompetencia}.`,
        data_opcao,
        data_exclusao,
      };
    }
    if (fim && mesCompetencia > fim) {
      return {
        enquadramento: 1,
        motivo: `A empresa saiu do Simples em ${fim}, antes da competência ${mesCompetencia}.`,
        data_opcao,
        data_exclusao,
      };
    }
  }

  // MEI é sempre optante do Simples, e o código dele é o mais específico.
  if (optanteMei === true) {
    return {
      enquadramento: 2,
      motivo: 'A Receita informa que a empresa é MEI.',
      data_opcao,
      data_exclusao,
    };
  }
  if (optanteSimples === true) {
    return {
      enquadramento: 3,
      motivo: 'A Receita informa que a empresa é optante do Simples Nacional.',
      data_opcao,
      data_exclusao,
    };
  }
  return {
    enquadramento: 1,
    motivo: 'A Receita informa que a empresa não é optante do Simples Nacional.',
    data_opcao,
    data_exclusao,
  };
}

/** Texto do enquadramento para a tela. */
export const ROTULO_ENQUADRAMENTO: Record<EnquadramentoSimples, string> = {
  0: 'Não informado',
  1: 'Não optante do Simples',
  2: 'Optante, MEI',
  3: 'Optante do Simples (ME ou EPP)',
};

/**
 * Explicação do erro E0160 para quem não é contador, com o que fazer.
 * A mensagem genérica de recusa não diz o que resolver.
 */
export function explicarE0160(enquadramentoEnviado: EnquadramentoSimples): string {
  return [
    'A Receita e a nota discordam sobre o Simples Nacional.',
    `A nota foi enviada como "${ROTULO_ENQUADRAMENTO[enquadramentoEnviado]}", e o cadastro do Simples`,
    'diz outra coisa para o mês da nota.',
    'Clique em atualizar os dados da empresa para buscar a situação na Receita e tente de novo.',
    'Se a empresa entrou ou saiu do Simples há poucos dias, a base federal pode levar até 48 horas para refletir.',
  ].join(' ');
}

/**
 * Traduz a recusa da NFS-e nacional para linguagem de quem não é contador.
 *
 * O que a prefeitura devolve é um JSON com códigos. Mostrar isso cru na
 * tela, como acontecia, transfere para a agência o trabalho de decifrar o
 * layout da SefinNacional. Cada código conhecido vira uma frase que diz o
 * que houve E o que fazer; o que não é conhecido continua aparecendo, para
 * o suporte não ficar sem o texto original.
 */

/** Códigos da SefinNacional que sabemos explicar. */
const EXPLICACAO_POR_CODIGO: Record<string, string> = {
  E0160:
    'A Receita e a nota discordam sobre o Simples Nacional. Clique em atualizar os dados da '
    + 'empresa para buscar a situação direto na Receita e emita de novo. Se a empresa entrou ou '
    + 'saiu do Simples nos últimos dias, a base federal pode levar até 48 horas para refletir.',
  E0001: 'O certificado digital não foi aceito. Confira se ele está dentro da validade e é do CNPJ da empresa.',
  E0043: 'A inscrição municipal informada não confere com o cadastro da prefeitura.',
  E0098: 'O código do serviço informado não é aceito neste município.',
};

export interface ErroNotaLegivel {
  /** Frase para o usuário. Vazia quando não reconhecemos nada. */
  explicacao: string;
  codigos: string[];
  /** Texto original da prefeitura, sempre preservado. */
  original: string;
}

/**
 * Procura códigos de erro em qualquer lugar do corpo devolvido, inclusive
 * dentro de uma string JSON, que é como a recusa costuma chegar.
 */
export function lerErroNota(corpo: unknown): ErroNotaLegivel {
  const original = typeof corpo === 'string' ? corpo : JSON.stringify(corpo ?? '');
  const codigos: string[] = [];
  const descricoes: string[] = [];

  const varrer = (v: unknown): void => {
    if (!v) return;
    if (Array.isArray(v)) { v.forEach(varrer); return; }
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const cod = String(o.Codigo ?? o.codigo ?? o.code ?? '').trim();
      if (/^E\d{3,4}$/i.test(cod)) {
        const c = cod.toUpperCase();
        if (!codigos.includes(c)) codigos.push(c);
        const desc = String(o.Descricao ?? o.descricao ?? o.description ?? '').trim();
        if (desc && !descricoes.includes(desc)) descricoes.push(desc);
      }
      Object.values(o).forEach(varrer);
      return;
    }
    if (typeof v === 'string') {
      // A recusa chega como string JSON dentro da mensagem. Tenta abrir.
      const t = v.trim();
      if (t.startsWith('{') || t.startsWith('[')) {
        try { varrer(JSON.parse(t)); return; } catch { /* segue como texto */ }
      }
      for (const m of t.matchAll(/\bE\d{3,4}\b/g)) {
        const c = m[0].toUpperCase();
        if (!codigos.includes(c)) codigos.push(c);
      }
    }
  };
  varrer(corpo);

  const explicadas = codigos.map(c => EXPLICACAO_POR_CODIGO[c]).filter(Boolean);
  return {
    explicacao: explicadas.join(' '),
    codigos,
    original,
  };
}

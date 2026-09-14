/**
 * Folha de pagamento.
 *
 * Custo de pessoa não é salário: é salário mais benefícios mais encargos
 * mais provisão de 13º e férias. Mostrar só o salário é o jeito clássico
 * de a agência achar que gasta menos do que gasta.
 *
 * Nenhuma alíquota é cravada em código. Encargo varia por regime e por
 * contrato, então vem do cadastro de cada pessoa e o sistema só sugere um
 * ponto de partida. Dinheiro sempre por round2/soma.
 */
import { round2, num, soma, divSegura, mesDe } from './money';
import type { TipoContrato, VinculoEmpresa } from './crm-types';

/** Sugestão de encargo por contrato, em percentual sobre o salário.
 *  É PONTO DE PARTIDA para o cadastro, nunca regra aplicada sozinha: a
 *  alíquota real depende do regime tributário e do enquadramento. */
export const ENCARGO_SUGERIDO: Record<TipoContrato, number> = {
  CLT: 36.8,
  PJ: 0,
  ESTAGIO: 0,
  AUTONOMO: 20,
};

export const PROVISIONA_POR_PADRAO: Record<TipoContrato, boolean> = {
  CLT: true,
  PJ: false,
  ESTAGIO: false,
  AUTONOMO: false,
};

export const ROTULO_CONTRATO: Record<TipoContrato, string> = {
  CLT: 'CLT',
  PJ: 'PJ',
  ESTAGIO: 'Estágio',
  AUTONOMO: 'Autônomo',
};

export interface CustoColaborador {
  salario: number;
  beneficios: number;
  encargos: number;
  /** 13º e férias rateados por mês, para o custo não dar salto em dezembro. */
  provisoes: number;
  total: number;
}

/**
 * Custo mensal de uma pessoa.
 *
 * Provisão de 13º é um salário dividido por 12. Provisão de férias é um
 * salário mais um terço, dividido por 12. Rateando todo mês, o custo do
 * ano fica correto e nenhum mês mente.
 */
export function custoMensal(v: VinculoEmpresa | undefined | null): CustoColaborador {
  const vazio = { salario: 0, beneficios: 0, encargos: 0, provisoes: 0, total: 0 };
  if (!v) return vazio;

  const salario = round2(num(v.salario_base));
  if (salario < 0) return vazio;

  const beneficios = soma((v.beneficios ?? []).map(b => num(b.valor)));
  const encargos = round2(salario * num(v.encargos_pct) / 100);

  const decimoTerceiro = v.provisiona_13_ferias ? divSegura(salario, 12) : 0;
  const ferias = v.provisiona_13_ferias ? divSegura(salario * (1 + 1 / 3), 12) : 0;
  const provisoes = round2(decimoTerceiro + ferias);

  return {
    salario,
    beneficios,
    encargos,
    provisoes,
    total: round2(salario + beneficios + encargos + provisoes),
  };
}

export interface PessoaNaFolha {
  id: string;
  nome: string;
  cargo: string;
  tipo_contrato: TipoContrato;
  data_admissao: string;
  data_desligamento: string;
  custo: CustoColaborador;
}

export interface ResumoFolha {
  pessoas: PessoaNaFolha[];
  quantidade: number;
  salarios: number;
  beneficios: number;
  encargos: number;
  provisoes: number;
  total: number;
  custo_medio: number;
  por_contrato: Array<{ tipo: TipoContrato; quantidade: number; total: number; share_pct: number }>;
}

export interface EntradaPessoa {
  id: string;
  nome: string;
  vinculo?: VinculoEmpresa;
}

/**
 * Quem está na folha em um mês.
 *
 * Admitido no dia 20 conta no mês da admissão, e desligado no dia 3 conta
 * no mês do desligamento: nos dois casos houve pagamento naquele mês. O
 * corte é por MÊS, não por dia, porque a folha é mensal.
 */
export function estaNaFolhaNoMes(v: VinculoEmpresa | undefined, mes: string): boolean {
  if (!v || !v.na_folha) return false;
  const admissao = mesDe(v.data_admissao);
  if (admissao && admissao > mes) return false;
  const saida = mesDe(v.data_desligamento);
  if (saida && saida < mes) return false;
  return true;
}

export function montarFolha(pessoas: EntradaPessoa[], mes: string): ResumoFolha {
  const naFolha = (pessoas ?? [])
    .filter(p => estaNaFolhaNoMes(p.vinculo, mes))
    .map<PessoaNaFolha>(p => ({
      id: p.id,
      nome: p.nome,
      cargo: p.vinculo?.cargo ?? '',
      tipo_contrato: p.vinculo?.tipo_contrato ?? 'CLT',
      data_admissao: p.vinculo?.data_admissao ?? '',
      data_desligamento: p.vinculo?.data_desligamento ?? '',
      custo: custoMensal(p.vinculo),
    }))
    .sort((a, b) => b.custo.total - a.custo.total);

  const salarios = soma(naFolha.map(p => p.custo.salario));
  const beneficios = soma(naFolha.map(p => p.custo.beneficios));
  const encargos = soma(naFolha.map(p => p.custo.encargos));
  const provisoes = soma(naFolha.map(p => p.custo.provisoes));
  const total = soma(naFolha.map(p => p.custo.total));

  const tipos = new Map<TipoContrato, PessoaNaFolha[]>();
  for (const p of naFolha) {
    const atual = tipos.get(p.tipo_contrato) ?? [];
    atual.push(p);
    tipos.set(p.tipo_contrato, atual);
  }

  return {
    pessoas: naFolha,
    quantidade: naFolha.length,
    salarios,
    beneficios,
    encargos,
    provisoes,
    total,
    custo_medio: naFolha.length > 0 ? round2(divSegura(total, naFolha.length)) : 0,
    por_contrato: [...tipos.entries()]
      .map(([tipo, lista]) => {
        const t = soma(lista.map(p => p.custo.total));
        return {
          tipo,
          quantidade: lista.length,
          total: t,
          share_pct: total > 0 ? round2(divSegura(t, total) * 100) : 0,
        };
      })
      .sort((a, b) => b.total - a.total),
  };
}

export interface PontoEvolucao {
  mes: string;
  folha: number;
  faturamento: number;
  /** Quanto da receita do mês foi para pessoas. */
  folha_sobre_faturamento_pct: number;
  pessoas: number;
}

/**
 * Evolução da folha contra o faturamento.
 *
 * O percentual só existe quando houve faturamento. Mês sem receita e com
 * folha não vira "infinito" nem 0%: devolve null, e a tela diz que não há
 * base de comparação. Zero ali seria mentira tranquilizadora.
 */
export function montarEvolucao(
  pessoas: EntradaPessoa[],
  faturamentoPorMes: Map<string, number>,
  meses: string[],
): PontoEvolucao[] {
  return meses.map(mes => {
    const folha = montarFolha(pessoas, mes);
    const faturamento = round2(num(faturamentoPorMes.get(mes)));
    return {
      mes,
      folha: folha.total,
      faturamento,
      folha_sobre_faturamento_pct:
        faturamento > 0 ? round2(divSegura(folha.total, faturamento) * 100) : 0,
      pessoas: folha.quantidade,
    };
  });
}

/** Id determinístico da conta a pagar da folha, para lançar duas vezes
 *  atualizar a MESMA conta em vez de duplicar a despesa. */
export function contaFolhaId(mes: string, colaboradorId: string): string {
  return `folha-${mes}-${colaboradorId}`;
}

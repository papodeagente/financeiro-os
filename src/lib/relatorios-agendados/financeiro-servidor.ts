/**
 * ENVIO AGENDADO DO DRE, DO FLUXO DE CAIXA E DA VISÃO GERAL (E7, fechamento).
 *
 * O servidor monta o MESMO documento de exportação da tela
 * (src/lib/exportacao/documentos-financeiro.ts) com os números calculados
 * pelas mesmas regras puras das telas (resultado-dre, caderno-caixa,
 * fluxo-comparativo, visao-geral), e com os DIREITOS DE QUEM SALVOU,
 * conferidos de novo a cada envio:
 *   · a pessoa precisa estar ativa e ainda poder abrir o financeiro, abrir
 *     relatórios e baixar em Excel e PDF; senão o envio não sai e fica o motivo;
 *   · as contas bancárias liberadas para ela (o recebido/pago numa conta
 *     fechada some, como na tela) e as empresas liberadas e marcadas por ela
 *     (rateio entre empresas entra só com a parte dela);
 *   · vendedor que não vê as vendas de todos: o DRE só com as vendas dele;
 *   · a folha prevista só entra no fluxo para quem pode ver a folha.
 *
 * Os filtros salvos chegam na `consulta` (forma de URL, sem datas): o período
 * é o de cada envio.
 */
import type { ExecutorSQL } from '../caixa-atomico';
import type { ContaBancaria, ContaPagar, ContaReceber, PlanoContas, VendaCRM, CentroCusto } from '../crm-types';
import { pode, contasPermitidas, type SessaoPermissoes } from '../permissoes-servidor';
import { podeEditarFinanceiro, podeVerTodasVendas, perfilCanonico } from '../permissoes';
import { filtrarPorConta } from '../filtro-de-conta';
import { contasNoRecorte, filtrarPorEmpresa } from '../empresas';
import { escopoDaSessao, type ExecutorEmpresas } from '../empresas-servidor';
import { vendasComLancamento, apenasVendasComLastro } from '../venda-lancamentos';
import { comissaoNaoCapturadaPorConta, dreMesAMes, mesesEntre, montarDRE } from '../resultado-dre';
import { aplicarRecorteDRE } from '../dre-recorte';
import { encargosPorTitulo, rotulosDasCategorias, type CategoriasEncargos, type LinhaDeBaixaComEncargo } from '../encargos-categorias';
import { variacaoPorTitulo } from '../cambio';
import { lancamentosDoCaixa, montarCaderno, competenciasDaFolha, type Periodo } from '../caderno-caixa';
import { gradeContaPorDia, lancamentosDaConta, type FiltroDeConta as FiltroDoFluxo } from '../fluxo-comparativo';
import { eventosFolhaPrevistos, DIA_PAGAMENTO_FOLHA_PADRAO, type EntradaPessoa } from '../folha-pagamento';
import { agendaDosProximosDias, mesAteHoje, posicaoDeHoje } from '../visao-geral';
import { rotuloDoPeriodo, type DocumentoExportado } from '../exportacao/documento';
import {
  documentoDaGradeDoFluxo, documentoDaVisaoGeral, documentoDoCadernoDoFluxo, documentoDoDREdoMes, documentoDoDREMesAMes,
  linhasDoDREnoModo, linhasDoMesAMesNoModo, rotuloDoMesDRE,
} from '../exportacao/documentos-financeiro';
import type { RelatorioAgendavel } from './regras';
import { agrupamentoDoPeriodo, filtrosDoDRE, filtrosDoFluxo } from './filtros-financeiro';

export type RelatorioFinanceiro = Exclude<RelatorioAgendavel, 'vendas'>;
export const RELATORIOS_FINANCEIROS: readonly RelatorioFinanceiro[] = ['dre', 'fluxo', 'visao_geral'];
export function ehRelatorioFinanceiro(r: string): r is RelatorioFinanceiro {
  return (RELATORIOS_FINANCEIROS as readonly string[]).includes(r);
}

type Linha = Record<string, unknown>;
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Recusa de direito: o envio não sai e o motivo fica no histórico. */
export class SemDireitoNoEnvio extends Error {
  codigo = 'SEM_DIREITO';
  status = 403;
}

// ============================================================
// Quem salvou
// ============================================================

/** A sessão de quem salvou, montada do cadastro de hoje (perfil e permissões atuais). Null: não está mais ativo. */
export async function sessaoDoAutor(exec: ExecutorSQL, tenantId: string, usuarioId: string): Promise<(SessaoPermissoes & { nome: string }) | null> {
  if (!usuarioId) return null;
  const { rows } = await exec.query(
    `SELECT id, nome, data FROM usuarios WHERE id = $1 AND (tenant_id = $2 OR tenant_id = '') LIMIT 1`,
    [usuarioId, tenantId],
  ).catch(() => ({ rows: [] as Linha[] }));
  const r = rows[0];
  if (!r) return null;
  const d = (r.data ?? {}) as Record<string, unknown>;
  if (d.ativo === false || d.ativo === 'false') return null;
  return {
    userId: txt(r.id), nome: txt(r.nome) || txt(d.nome), perfil: txt(d.perfil),
    permissoes: (d.permissoes && typeof d.permissoes === 'object' ? d.permissoes : {}) as Record<string, unknown>,
    tenantId,
  };
}

/** O que falta para quem salvou poder receber este relatório hoje (null = pode). */
export async function motivoSemDireito(exec: ExecutorSQL, sessao: SessaoPermissoes & { nome?: string }): Promise<string | null> {
  const quem = sessao.nome || 'quem salvou';
  if (perfilCanonico(sessao.perfil) === 'COLABORADOR') return `${quem} não tem mais acesso ao sistema`;
  if (!(await pode(sessao, 'ver_financeiro', { exec }))) return `${quem} não pode mais abrir o financeiro`;
  if (!(await pode(sessao, 'acessar_relatorios', { exec }))) return `${quem} não pode mais abrir relatórios`;
  if (!(await pode(sessao, 'exportar', { exec }))) return `${quem} não pode mais baixar em Excel e PDF`;
  return null;
}

// ============================================================
// Os títulos que a pessoa vê (as mesmas regras das listas)
// ============================================================

interface TitulosDaPessoa {
  receber: ContaReceber[];
  pagar: ContaPagar[];
  bancarias: ContaBancaria[];
}

async function lerTabela(exec: ExecutorSQL, tabela: string, tenantId: string): Promise<Linha[]> {
  const { rows } = await exec.query(`SELECT data FROM ${tabela} WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]);
  return rows.map(r => (r.data ?? {}) as Linha);
}

/**
 * Contas a receber e a pagar e contas bancárias como as listas entregam a
 * esta pessoa (conta liberada, empresa liberada e marcada), já no recorte de
 * empresas que o DRE e o fluxo usam (rateio só com a parte visível).
 */
export async function titulosDaPessoa(exec: ExecutorSQL, tenantId: string, sessao: SessaoPermissoes): Promise<TitulosDaPessoa & { visiveis: Awaited<ReturnType<typeof escopoDaSessao>>['visiveis'] }> {
  const [cr, cp, cb, contas, escopo] = await Promise.all([
    lerTabela(exec, 'contas_receber', tenantId),
    lerTabela(exec, 'contas_pagar', tenantId),
    lerTabela(exec, 'contas_bancarias', tenantId),
    contasPermitidas(sessao, exec),
    escopoDaSessao(sessao, exec as unknown as ExecutorEmpresas),
  ]);
  const visiveis = escopo.visiveis;
  const titulos = (lista: Linha[]) => contasNoRecorte(
    filtrarPorEmpresa(filtrarPorConta(lista, { campos: ['conta_bancaria_id'], soBaixados: true }, contas), { tipo: 'registro' }, visiveis),
    visiveis,
  );
  return {
    receber: titulos(cr) as unknown as ContaReceber[],
    pagar: titulos(cp) as unknown as ContaPagar[],
    bancarias: filtrarPorEmpresa(filtrarPorConta(cb, { cadastro: true }, contas), { tipo: 'conta_bancaria' }, visiveis) as unknown as ContaBancaria[],
    visiveis,
  };
}

// ============================================================
// Os três documentos
// ============================================================

async function documentoDoDRE(exec: ExecutorSQL, tenantId: string, sessao: SessaoPermissoes, consulta: string, de: string, ate: string): Promise<DocumentoExportado> {
  const f = filtrosDoDRE(consulta);
  const { receber, pagar, visiveis } = await titulosDaPessoa(exec, tenantId, sessao);
  const [vendasBrutas, plano, linhasEnc, categorias, variacoes, centros] = await Promise.all([
    podeVerTodasVendas(sessao)
      ? exec.query(`SELECT data FROM vendas_crm WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId])
      : exec.query(`SELECT data FROM vendas_crm WHERE tenant_id = $1 AND vendedor_id = $2 ORDER BY created_at DESC`, [tenantId, sessao.userId || '__sem_usuario__']),
    lerTabela(exec, 'plano_contas', tenantId),
    import('../encargos-servidor').then(m => m.linhasDeEncargos(exec, tenantId)).catch(() => [] as LinhaDeBaixaComEncargo[]),
    import('../encargos-servidor').then(m => m.categoriasDosEncargos(exec, tenantId)).catch(() => ({} as CategoriasEncargos)),
    import('../cambio-servidor').then(m => m.variacoesDaAgencia(exec, tenantId)).catch(() => [] as Array<{ titulo_tabela: string; titulo_id: string; variacao: number }>),
    f.centro ? import('../centros-custo-servidor').then(m => m.listarCentros(exec, tenantId)).catch(() => [] as CentroCusto[]) : Promise.resolve([] as CentroCusto[]),
  ]);
  const vendas = filtrarPorEmpresa(vendasBrutas.rows.map(r => (r.data ?? {}) as Linha), { tipo: 'registro' }, visiveis) as unknown as VendaCRM[];
  const planoContas = plano as unknown as PlanoContas[];
  const comLastro = apenasVendasComLastro(vendas, vendasComLancamento(receber, pagar));
  const centro = f.centro ? centros.find(c => c.id === f.centro) ?? null : null;
  // Centro salvo que não existe mais: o envio sai sem o recorte e diz isso.
  const recortado = aplicarRecorteDRE(
    { receber, pagar, vendas: comLastro, encargos: encargosPorTitulo(linhasEnc), variacoes: variacaoPorTitulo(variacoes) },
    { centro_id: centro ? centro.id : null, rateio: f.rateio }, centros,
  );
  const base = {
    receber: recortado.receber, pagar: recortado.pagar, vendasComLastro: recortado.vendas, planoContas,
    comissaoNaoCapturada: comissaoNaoCapturadaPorConta(recortado.receber, recortado.vendas),
    regime: f.regime, encargos: recortado.encargos, rotulosEncargos: rotulosDasCategorias(categorias, planoContas), variacoes: recortado.variacoes,
  };
  const meses = mesesEntre(de.slice(0, 7), ate.slice(0, 7), 24);
  const filtros = { periodo: '', regime: f.regime, centro: centro?.nome ?? null, rateio: f.rateio, comparadoCom: null };
  const nota = f.centro && !centro ? 'O centro de custo salvo no envio não existe mais: o resultado saiu sem esse recorte.' : '';
  let doc: DocumentoExportado;
  if (meses.length <= 1) {
    const mes = meses[0] ?? ate.slice(0, 7);
    const rotuloMes = rotuloDoMesDRE(mes);
    doc = documentoDoDREdoMes({ filtros: { ...filtros, periodo: rotuloMes }, rotuloMes, linhas: linhasDoDREnoModo(montarDRE({ ...base, mes }), f.simplificado) });
  } else {
    const mesAMes = dreMesAMes(base, meses);
    doc = documentoDoDREMesAMes({
      filtros: { ...filtros, periodo: `${rotuloDoMesDRE(meses[0])} a ${rotuloDoMesDRE(meses[meses.length - 1])}` },
      mesAMes, linhas: linhasDoMesAMesNoModo(mesAMes.linhas, f.simplificado),
    });
  }
  return nota ? { ...doc, nota: doc.nota ? `${nota} ${doc.nota}` : nota } : doc;
}

async function documentoDoFluxo(exec: ExecutorSQL, tenantId: string, sessao: SessaoPermissoes, consulta: string, de: string, ate: string, hoje: string): Promise<DocumentoExportado> {
  const f = filtrosDoFluxo(consulta);
  const { receber, pagar, bancarias } = await titulosDaPessoa(exec, tenantId, sessao);
  const periodo: Periodo = { tipo: 'mes', inicio: de, fim: ate, rotulo: rotuloDoPeriodo(de, ate), meses: '' };
  const agrupamento = f.agrupamento ?? agrupamentoDoPeriodo(de, ate);
  const { lerContaPrevisaoPadrao } = await import('../conta-previsao-servidor');
  const contaPrevisaoPadraoId = await lerContaPrevisaoPadrao(exec, tenantId).catch(() => null);

  // Folha prevista: só para quem pode ver a folha (como na tela).
  let folha: ReturnType<typeof eventosFolhaPrevistos> = [];
  if (f.folha && podeEditarFinanceiro(sessao)) {
    const [{ rows: pessoas }, { rows: ag }] = await Promise.all([
      exec.query(`SELECT id, nome, data FROM usuarios WHERE tenant_id = $1 AND COALESCE(data->>'cadastro_pendente', 'false') <> 'true' ORDER BY nome ASC`, [tenantId]),
      exec.query(`SELECT data->>'dia_pagamento_folha' AS dia FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`, [tenantId]),
    ]);
    const entrada: EntradaPessoa[] = pessoas.map(r => {
      const d = (r.data ?? {}) as Record<string, unknown>;
      return { id: txt(r.id), nome: txt(r.nome) || txt(d.nome), vinculo: d.vinculo as EntradaPessoa['vinculo'] };
    });
    folha = eventosFolhaPrevistos(entrada, competenciasDaFolha(periodo, hoje), Number(ag[0]?.dia) || DIA_PAGAMENTO_FOLHA_PADRAO, pagar.map(c => c.id));
  }

  const caixaGeralId = bancarias.find(c => c.nome === 'Caixa Geral')?.id ?? null;
  if (f.vista === 'grade') {
    const grade = gradeContaPorDia({ receber, pagar, folha, contas: bancarias, caixaGeralId, contaPrevisaoPadraoId, periodo, hoje });
    return documentoDaGradeDoFluxo({ grade, periodo, medida: f.medida });
  }
  // Conta salva que não está mais liberada (ou foi apagada): o envio não mostra outra no lugar.
  const conta = f.conta ? bancarias.find(c => c.id === f.conta) ?? null : null;
  if (f.conta && !conta) throw new SemDireitoNoEnvio('a conta bancária salva no envio não existe mais ou não está liberada para quem salvou');
  const filtro: FiltroDoFluxo = { contaId: conta?.id ?? null, caixaGeralId, contaPrevisaoPadraoId };
  const lancamentos = conta
    ? lancamentosDaConta({ receber, pagar, folha, filtro, hoje }).lancamentos
    : lancamentosDoCaixa({ receber, pagar, folha, hoje });
  const caderno = montarCaderno({ lancamentos, contas: conta ? [conta] : bancarias, periodo, agrupamento, hoje });
  return documentoDoCadernoDoFluxo({ caderno, periodo, agrupamento, conta: conta ? (conta.nome ?? '') : null });
}

async function documentoDaVisao(exec: ExecutorSQL, tenantId: string, sessao: SessaoPermissoes, hoje: string): Promise<DocumentoExportado> {
  const { receber, pagar, bancarias } = await titulosDaPessoa(exec, tenantId, sessao);
  return documentoDaVisaoGeral({
    hoje,
    posicao: posicaoDeHoje({ contasBancarias: bancarias, receber, pagar, hoje }),
    mes: mesAteHoje(receber, pagar, hoje),
    agenda: agendaDosProximosDias({ receber, pagar, hoje }),
  });
}

/**
 * O documento do envio agendado de DRE, fluxo ou visão geral, com os direitos
 * de hoje de quem salvou. Sem direito: `SemDireitoNoEnvio` com o motivo.
 */
export async function documentoFinanceiroDoAgendamento(
  exec: ExecutorSQL, tenantId: string,
  a: { relatorio: RelatorioFinanceiro; consulta: string; criado_por: string },
  de: string, ate: string, hoje: string,
): Promise<DocumentoExportado> {
  const sessao = await sessaoDoAutor(exec, tenantId, a.criado_por);
  if (!sessao) throw new SemDireitoNoEnvio('quem salvou não está mais ativo na agência; salve o envio de novo com outra pessoa');
  const motivo = await motivoSemDireito(exec, sessao);
  if (motivo) throw new SemDireitoNoEnvio(`${motivo}; salve o envio de novo com quem pode`);
  if (a.relatorio === 'dre') return documentoDoDRE(exec, tenantId, sessao, a.consulta, de, ate);
  if (a.relatorio === 'fluxo') return documentoDoFluxo(exec, tenantId, sessao, a.consulta, de, ate, hoje);
  return documentoDaVisao(exec, tenantId, sessao, hoje);
}

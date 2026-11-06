/**
 * Mudança de sistema (E4, 05/11/2026): as provas de que bateu.
 *
 * Três conferências, cada diferença com o motivo:
 *  1. por conta: saldo informado pelo sistema anterior na data de corte ×
 *     saldo da conta aqui (e o do razão);
 *  2. por pessoa: em aberto a pagar e a receber, arquivo × EnturOS;
 *  3. por mês × categoria: os títulos trazidos, arquivo × EnturOS.
 * E, por arquivo, a soma das linhas × a linha de total do rodapé.
 *
 * "Arquivo" é o que a planilha diz que está em aberto (as linhas legíveis,
 * inclusive as que ficaram de fora por repetidas ou ambíguas). "EnturOS" é
 * o que existe aqui agora, vindo desta mudança. A diferença de cada grupo é
 * a soma dos motivos: linha recusada, baixa ou alteração depois da mudança,
 * registro apagado. Grupo com diferença sem motivo é sinal de defeito e
 * aparece em `diferencas_sem_explicacao`.
 */
import type { ExecutorSQL } from '../caixa-atomico';
import { nomeComparavel } from '../fornecedor-sync';
import { num, paraCentavos } from '../money';
import type { Enriquecimento } from './plano';
import type { RegistroLido } from './interpretar';
import { definicaoDaLista, type ListaId, type Mapeamento } from './dicionario';
import { lerLote, rotuloDoCodigo, type Lote } from './servidor';
import { lerCentavos, normalizar, texto, type Celula } from './valores';

export interface ExplicacaoDaDiferenca { codigo: string; motivo: string; quantidade: number; centavos: number }

export interface LinhaDaProva {
  chave: string;
  rotulo: string;
  anterior_centavos: number;
  enturos_centavos: number;
  diferenca_centavos: number;
  explicacoes: ExplicacaoDaDiferenca[];
  /** A soma das explicações fecha a diferença. */
  explicada: boolean;
}

export interface ProvaDeConta extends LinhaDaProva {
  conta_id: string | null;
  razao_centavos: number | null;
}

export interface ProvaDoArquivo {
  arquivo_id: string;
  nome: string;
  lista: ListaId;
  linhas: number;
  soma_centavos: number;
  total_rodape_centavos: number | null;
  /** null = o arquivo não trouxe linha de total para comparar. */
  confere: boolean | null;
}

export interface ProvaDaMudanca {
  lote: Lote;
  gerada_em: string;
  data_corte: string | null;
  contas: ProvaDeConta[];
  pessoas: { pagar: LinhaDaProva[]; receber: LinhaDaProva[] };
  meses: Array<LinhaDaProva & { movimento: 'pagar' | 'receber'; mes: string; categoria: string }>;
  arquivos: ProvaDoArquivo[];
  /** Linhas que ficaram de fora sem entrar nas contas (já liquidadas, excluídas, ilegíveis...). */
  fora: Array<{ codigo: string; rotulo: string; quantidade: number }>;
  resumo: { criados: Record<string, number>; vinculados: number; recusados: number; ignorados: number; desfeitos: number; mantidos_no_desfazer: number };
  diferencas_sem_explicacao: number;
}

const txt = (v: unknown) => (v == null ? '' : String(v));

interface Acumulador {
  rotulo: string;
  anterior: number;
  enturos: number;
  explic: Map<string, ExplicacaoDaDiferenca>;
}

function acumular(m: Map<string, Acumulador>, chave: string, rotulo: string): Acumulador {
  let a = m.get(chave);
  if (!a) { a = { rotulo, anterior: 0, enturos: 0, explic: new Map() }; m.set(chave, a); }
  return a;
}

function explicar(a: Acumulador, codigo: string, motivo: string, centavos: number) {
  const e = a.explic.get(codigo) ?? { codigo, motivo, quantidade: 0, centavos: 0 };
  e.quantidade += 1;
  e.centavos += centavos;
  a.explic.set(codigo, e);
}

function fechar(chave: string, a: Acumulador): LinhaDaProva {
  const diferenca = a.anterior - a.enturos;
  const explicacoes = [...a.explic.values()].filter(e => e.centavos !== 0 || e.quantidade > 0);
  const soma = explicacoes.reduce((s, e) => s + e.centavos, 0);
  return {
    chave, rotulo: a.rotulo, anterior_centavos: a.anterior, enturos_centavos: a.enturos, diferenca_centavos: diferenca,
    explicacoes, explicada: soma === diferenca,
  };
}

const MOTIVO_DEPOIS: Record<string, string> = {
  baixado_depois: 'Recebeu baixa aqui depois da mudança',
  cancelado_depois: 'Foi cancelado aqui depois da mudança',
  alterado_depois: 'O valor foi alterado aqui depois da mudança',
  apagado: 'Não existe mais aqui (mudança desfeita ou lançamento apagado)',
};

/** Monta as provas de um lote. Só lê. */
export async function provasDoLote(exec: ExecutorSQL, tenantId: string, loteId: string): Promise<ProvaDaMudanca> {
  const lote = await lerLote(exec, tenantId, loteId);
  const { rows: linhas } = await exec.query(
    `SELECT m.arquivo_id, m.linha, m.tipo, m.celulas, m.resultado, m.codigo, m.motivo, m.dados, m.alvo_tabela, m.alvo_id,
            a.nome AS arquivo, a.lista, a.mapeamento, a.total_rodape
       FROM migracao_linhas m JOIN migracao_arquivos a ON a.id = m.arquivo_id
      WHERE m.tenant_id = $1 AND m.lote_id = $2
      ORDER BY a.ordem, m.linha`,
    [tenantId, loteId],
  );

  // Estado atual dos títulos e das contas trazidos.
  const idsPorTabela = new Map<string, Set<string>>();
  for (const l of linhas) {
    if (l.alvo_id && l.alvo_tabela) {
      const s = idsPorTabela.get(txt(l.alvo_tabela)) ?? new Set<string>();
      s.add(txt(l.alvo_id));
      idsPorTabela.set(txt(l.alvo_tabela), s);
    }
  }
  const titulos = new Map<string, { valor: number; status: string; pago: number }>();
  for (const [tabela, campoPago] of [['contas_receber', 'valor_recebido'], ['contas_pagar', 'valor_pago']] as const) {
    const ids = [...(idsPorTabela.get(tabela) ?? [])];
    if (!ids.length) continue;
    const { rows } = await exec.query(
      `SELECT id, data->>'valor_final' AS v, COALESCE(data->>'status', '') AS s, data->>'${campoPago}' AS p
         FROM ${tabela} WHERE tenant_id = $1 AND id = ANY($2::text[])`,
      [tenantId, ids],
    );
    for (const r of rows) titulos.set(`${tabela}:${txt(r.id)}`, { valor: paraCentavos(num(r.v)), status: txt(r.s), pago: paraCentavos(num(r.p)) });
  }

  const pessoas = { pagar: new Map<string, Acumulador>(), receber: new Map<string, Acumulador>() };
  const meses = new Map<string, Acumulador & { movimento: 'pagar' | 'receber'; mes: string; categoria: string }>();
  const fora = new Map<string, number>();
  const arquivos = new Map<string, ProvaDoArquivo & { colunas: number[] }>();
  const contasInformadas: Array<{ nome: string; contaId: string | null; saldo: number; resultado: string; codigo: string | null; motivo: string }> = [];
  const resumo = { criados: {} as Record<string, number>, vinculados: 0, recusados: 0, ignorados: 0, desfeitos: 0, mantidos_no_desfazer: 0 };

  for (const l of linhas) {
    const lista = txt(l.lista) as ListaId;
    const resultado = txt(l.resultado);
    const codigo = l.codigo == null ? null : txt(l.codigo);
    if (resultado === 'recusar') resumo.recusados += 1;
    if (resultado === 'ignorar') resumo.ignorados += 1;
    if (resultado === 'vincular') resumo.vinculados += 1;

    // Conferência do rodapé, por arquivo (colunas de dinheiro mapeadas).
    let arq = arquivos.get(txt(l.arquivo_id));
    if (!arq) {
      const map = (l.mapeamento ?? {}) as Mapeamento;
      const def = definicaoDaLista(lista);
      const colunas = (def?.campos ?? []).filter(c => c.tipo === 'dinheiro' && map[c.id] !== undefined).map(c => map[c.id]);
      // Nos títulos vale o valor final quando os dois estão ligados.
      const usadas = lista === 'titulos' && map.valor_final !== undefined ? [map.valor_final] : colunas.slice(0, 1);
      const rod = (l.total_rodape ?? {}) as Record<string, number>;
      const total = usadas.length && rod[String(usadas[0])] !== undefined ? Number(rod[String(usadas[0])]) : null;
      arq = { arquivo_id: txt(l.arquivo_id), nome: txt(l.arquivo), lista, linhas: 0, soma_centavos: 0, total_rodape_centavos: total, confere: null, colunas: usadas };
      arquivos.set(arq.arquivo_id, arq);
    }
    if (txt(l.tipo) === 'dado') {
      arq.linhas += 1;
      const c = arq.colunas[0];
      if (c !== undefined) arq.soma_centavos += lerCentavos(((l.celulas ?? []) as Celula[])[c]) ?? 0;
    }

    const dados = (l.dados ?? null) as { registro?: RegistroLido; enriq?: Enriquecimento } | null;
    const registro = dados?.registro;
    if (!registro) {
      if (txt(l.tipo) === 'dado' && codigo) fora.set(codigo, (fora.get(codigo) ?? 0) + 1);
      continue;
    }
    if (registro.lista === 'titulos') {
      const t = registro.dados;
      const chaveAlvo = l.alvo_tabela && l.alvo_id ? `${txt(l.alvo_tabela)}:${txt(l.alvo_id)}` : '';
      const atual = chaveAlvo ? titulos.get(chaveAlvo) : undefined;
      let enturos = 0;
      let explicacao: { codigo: string; motivo: string } | null = null;
      if (resultado === 'recusar') {
        explicacao = { codigo: codigo ?? 'recusado', motivo: rotuloDoCodigo(codigo ?? 'recusado') };
      } else if (resultado === 'criar' || resultado === 'vincular') {
        if (!l.alvo_id) {
          explicacao = { codigo: 'nao_aplicado', motivo: 'Ainda não aplicado' };
        } else if (!atual) {
          explicacao = { codigo: 'apagado', motivo: MOTIVO_DEPOIS.apagado };
        } else if (atual.status === 'CANCELADO') {
          explicacao = { codigo: 'cancelado_depois', motivo: MOTIVO_DEPOIS.cancelado_depois };
        } else if (atual.status === 'RECEBIDO' || atual.status === 'PAGO') {
          explicacao = { codigo: 'baixado_depois', motivo: MOTIVO_DEPOIS.baixado_depois };
        } else {
          enturos = atual.status === 'PARCIAL' ? Math.max(0, atual.valor - atual.pago) : atual.valor;
          if (atual.status === 'PARCIAL') explicacao = { codigo: 'baixado_depois', motivo: MOTIVO_DEPOIS.baixado_depois };
          else if (enturos !== t.valor) explicacao = { codigo: 'alterado_depois', motivo: MOTIVO_DEPOIS.alterado_depois };
        }
      }
      const quem = t.documento_pessoa || nomeComparavel(t.pessoa) || normalizar(t.pessoa);
      const rotuloPessoa = t.documento_pessoa ? `${t.pessoa} (${t.documento_pessoa})` : t.pessoa;
      const p = acumular(pessoas[t.movimento], quem, rotuloPessoa);
      const mes = t.vencimento.slice(0, 7);
      const categoria = t.categoria || '(sem categoria)';
      const chaveMes = `${t.movimento}|${mes}|${normalizar(categoria)}`;
      let m = meses.get(chaveMes);
      if (!m) {
        m = { ...acumular(new Map(), chaveMes, `${t.movimento === 'receber' ? 'A receber' : 'A pagar'} · ${mes.slice(5)}/${mes.slice(0, 4)} · ${categoria}`), movimento: t.movimento, mes, categoria };
        meses.set(chaveMes, m);
      }
      for (const a of [p, m]) {
        a.anterior += t.valor;
        a.enturos += enturos;
        if (explicacao) explicar(a, explicacao.codigo, explicacao.motivo, t.valor - enturos);
      }
    }
    if (registro.lista === 'saldos' || (registro.lista === 'contas' && registro.dados.saldo !== null && dados?.enriq?.usar_saldo !== false)) {
      const nome = registro.lista === 'saldos' ? registro.dados.conta : registro.dados.nome;
      const saldo = registro.lista === 'saldos' ? registro.dados.saldo : (registro.dados.saldo ?? 0);
      contasInformadas.push({ nome, contaId: l.alvo_id ? txt(l.alvo_id) : null, saldo, resultado, codigo, motivo: txt(l.motivo) });
    }
  }

  // Contas: saldo informado × saldo aqui (e o do razão).
  const { rows: contas } = await exec.query(
    `SELECT id, data FROM contas_bancarias WHERE tenant_id = $1`, [tenantId],
  );
  const razao = new Map<string, number>();
  const { rows: temRazao } = await exec.query(`SELECT to_regclass('public.razao_partidas') IS NOT NULL AS ok`);
  if (temRazao[0]?.ok) {
    const { rows } = await exec.query(
      `SELECT conta_bancaria_id, SUM(valor_centavos)::bigint AS s FROM razao_partidas WHERE tenant_id = $1 AND conta = 'BANCO' GROUP BY conta_bancaria_id`, [tenantId],
    );
    for (const r of rows) razao.set(txt(r.conta_bancaria_id), Number(r.s));
  }
  const { rows: vincSaldo } = await exec.query(
    `SELECT v.registro_id, v.hash, v.desfeito, md5(c.data::text) AS h FROM migracao_vinculos v
       LEFT JOIN contas_bancarias c ON c.tenant_id = v.tenant_id AND c.id = v.registro_id
      WHERE v.tenant_id = $1 AND v.lote_id = $2 AND v.acao = 'saldo'`,
    [tenantId, loteId],
  );
  const saldoMexido = new Map(vincSaldo.map(r => [txt(r.registro_id), { mudou: txt(r.h) !== txt(r.hash), desfeito: Boolean(r.desfeito) }]));
  const provasDeConta: ProvaDeConta[] = [];
  for (const ci of contasInformadas) {
    const conta = contas.find(c => txt(c.id) === ci.contaId)
      ?? contas.find(c => normalizar(((c.data ?? {}) as Record<string, unknown>).nome) === normalizar(ci.nome));
    const d = (conta?.data ?? {}) as Record<string, unknown>;
    const id = conta ? txt(conta.id) : null;
    const aqui = conta ? paraCentavos(num(d.saldo_atual)) : 0;
    const a: Acumulador = { rotulo: conta ? texto(d.nome) || ci.nome : ci.nome, anterior: ci.saldo, enturos: aqui, explic: new Map() };
    const dif = ci.saldo - aqui;
    if (dif !== 0) {
      const sm = id ? saldoMexido.get(id) : undefined;
      if (ci.resultado === 'recusar') explicar(a, ci.codigo ?? 'recusado', ci.motivo || rotuloDoCodigo(ci.codigo ?? ''), dif);
      else if (ci.codigo) explicar(a, ci.codigo, rotuloDoCodigo(ci.codigo), dif);
      else if (!conta) explicar(a, 'apagado', 'A conta não existe mais aqui (mudança desfeita)', dif);
      else if (sm?.desfeito) explicar(a, 'apagado', 'O saldo de abertura foi desfeito', dif);
      else if (sm?.mudou) explicar(a, 'movimento_depois', 'A conta teve movimento aqui depois da mudança', dif);
      else explicar(a, 'sem_motivo', 'Diferença sem motivo conhecido: confira', dif);
    }
    const linha = fechar(id ?? `conta:${normalizar(ci.nome)}`, a);
    if (a.explic.has('sem_motivo')) linha.explicada = false;
    provasDeConta.push({ ...linha, conta_id: id, razao_centavos: id && razao.has(id) ? razao.get(id)! : null });
  }

  const { rows: vinc } = await exec.query(
    `SELECT tabela, acao, desfeito, mantido_motivo FROM migracao_vinculos WHERE tenant_id = $1 AND lote_id = $2`, [tenantId, loteId],
  );
  for (const v of vinc) {
    if (txt(v.acao) === 'criado') resumo.criados[txt(v.tabela)] = (resumo.criados[txt(v.tabela)] ?? 0) + 1;
    if (v.desfeito) resumo.desfeitos += 1;
    if (v.mantido_motivo) resumo.mantidos_no_desfazer += 1;
  }

  const pagar = [...pessoas.pagar.entries()].map(([k, a]) => fechar(k, a)).sort((x, y) => x.rotulo.localeCompare(y.rotulo, 'pt-BR'));
  const receber = [...pessoas.receber.entries()].map(([k, a]) => fechar(k, a)).sort((x, y) => x.rotulo.localeCompare(y.rotulo, 'pt-BR'));
  const listaMeses = [...meses.entries()].map(([k, m]) => ({ ...fechar(k, m), movimento: m.movimento, mes: m.mes, categoria: m.categoria }))
    .sort((x, y) => x.movimento.localeCompare(y.movimento) || x.mes.localeCompare(y.mes) || x.categoria.localeCompare(y.categoria, 'pt-BR'));
  const listaArquivos = [...arquivos.values()].map(({ colunas: _c, ...a }) => ({
    ...a, confere: a.total_rodape_centavos === null ? null : a.total_rodape_centavos === a.soma_centavos,
  }));
  const todas = [...provasDeConta, ...pagar, ...receber, ...listaMeses];
  const { rows: agora } = await exec.query(`SELECT NOW() AS t`);
  return {
    lote, gerada_em: agora[0]?.t instanceof Date ? (agora[0].t as Date).toISOString() : txt(agora[0]?.t), data_corte: lote.data_corte,
    contas: provasDeConta, pessoas: { pagar, receber }, meses: listaMeses, arquivos: listaArquivos,
    fora: [...fora.entries()].map(([codigo, quantidade]) => ({ codigo, rotulo: rotuloDoCodigo(codigo), quantidade })).sort((a, b) => b.quantidade - a.quantidade),
    resumo, diferencas_sem_explicacao: todas.filter(l => !l.explicada).length,
  };
}

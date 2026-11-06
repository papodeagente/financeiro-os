/**
 * Mudança v2 (E7, 06/11/2026): o que fazer com cada linha do histórico.
 * Como plano.ts: o MESMO código decide no ensaio e na aplicação; só o
 * gravador muda (ensaio inventa ids, a aplicação grava).
 *
 * REGRA DO DINHEIRO EM DOBRO (contas já liquidadas e extrato):
 *   O saldo que o sistema anterior informou na data de corte JÁ CONTÉM todo
 *   o dinheiro que entrou e saiu até ali. Se a baixa antiga entrasse no
 *   saldo de novo, o dinheiro contaria duas vezes. Então cada baixa do
 *   histórico (data ≤ corte) entra pela liquidação de sempre (data, conta,
 *   razão, extrato), e a abertura da conta é levada para ANTES dela: um
 *   lançamento de abertura do mesmo valor no sentido contrário, e o saldo
 *   inicial da conta diminui (ou aumenta) o mesmo tanto. Resultado:
 *     · o saldo da conta HOJE não muda;
 *     · o saldo NA DATA DE CORTE continua o informado (o extrato parte do
 *       saldo inicial e, somando o histórico, chega nele);
 *     · o razão de cada conta soma exatamente o saldo.
 *   Vale em qualquer ordem (o saldo de abertura antes ou depois do
 *   histórico) porque a baixa e a sua compensação somam zero no caixa.
 *   O que foi liquidado DEPOIS do corte não é histórico: entra em aberto
 *   (regra da v1) e a baixa se dá aqui.
 */
import { normalizarVenda, totaisDoProduto, type ParteDaVenda, type Venda } from '../venda-modelo';
import { nomeComparavel } from '../fornecedor-sync';
import {
  acharConta, acharPessoa, chaveDoTitulo,
  type IndiceDeCadastros, type PapelSimples, type PessoaConhecida, type TituloDoLote, type VendaConhecida,
} from './identidade';
import type { RegistroDoHistorico, VendaAgrupada } from './interpretar-historico';
import type { PessoaLida } from './interpretar';
import {
  garantirCategoria, garantirCentro, pessoaVazia, registrarPessoa,
  type ContextoDoPlano, type Decisao, type Enriquecimento, type Gravador, type OrigemDaLinha,
} from './plano';
import { dataBR, normalizar, reais } from './valores';

const recusa = (codigo: string, motivo: string, chave: string | null = null): Decisao =>
  ({ resultado: 'recusar', codigo, motivo, avisos: [], alvo_tabela: null, alvo_id: null, chave });

/** Nome da pessoa usada quando a linha do extrato não diz quem é. */
export const PESSOA_SEM_NOME = 'Sem pessoa informada';

/** Acha (ou cria) a pessoa no papel pedido. Ambígua devolve a recusa. */
async function garantirPessoa(
  indice: IndiceDeCadastros, g: Gravador, o: OrigemDaLinha, papel: PapelSimples,
  nome: string, documento = '', email = '',
): Promise<{ pessoa: PessoaConhecida; criada: boolean } | { recusa: Decisao }> {
  const r = acharPessoa(indice, papel, { nome, documento, email });
  if (r.tipo === 'ambigua') return { recusa: recusa('pessoa_ambigua', r.motivo) };
  if (r.tipo === 'achou') return { pessoa: r.pessoa, criada: false };
  const nova: PessoaLida = { ...pessoaVazia(nome), documento, email, tipo_pessoa: documento.length === 14 ? 'PJ' : 'PF' };
  const id = await g.criarPessoa(papel, nova, o);
  return { pessoa: registrarPessoa(indice, id, papel, nova), criada: true };
}

const parte = (p: PessoaConhecida | null, nome = ''): ParteDaVenda | null =>
  p ? { id: p.id, nome: p.nome, ...(p.documento ? { documento: p.documento } : {}) } : nome ? { id: '', nome } : null;

/** A venda trazida com este número (de qualquer mudança não desfeita). */
export function vendaPorNumero(indice: IndiceDeCadastros, numero: string): VendaConhecida | null {
  const n = normalizar(numero);
  return n ? indice.vendas.find(v => normalizar(v.numero_anterior) === n) ?? null : null;
}

/** Divide `total` em `n` partes inteiras (o resto vai para a primeira). */
function repartir(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? total - base * n : 0));
}

/** A venda do modelo completo (E5) a partir das linhas agrupadas. */
export function vendaDoModelo(
  v: VendaAgrupada, cliente: PessoaConhecida, fornecedores: Map<string, PessoaConhecida>, chave: string,
): { venda: Venda; erros: string[]; avisos: string[] } {
  const avisos: string[] = [];
  const produtos = v.produtos.map((p, i) => {
    const pax = p.passageiros;
    const tarifas = repartir(p.tarifa, pax.length);
    const taxas = repartir(p.taxas, pax.length);
    const outras = repartir(p.outras_taxas, pax.length);
    const comp = (tipo: string, valor: number) => (valor > 0 ? [{ tipo, valor_centavos: valor }] : []);
    const unit = pax.length ? 0 : (p.quantidade > 0 ? Math.round(p.tarifa / p.quantidade) : p.tarifa);
    return {
      id: `${chave}:p${i + 1}`,
      tipo: p.tipo,
      descricao: p.descricao || p.produto,
      fornecedor: parte(fornecedores.get(normalizar(p.fornecedor)) ?? null, p.fornecedor),
      representante: parte(fornecedores.get(normalizar(p.representante)) ?? null, p.representante),
      quem_cobra: 'AGENCIA',
      moeda: p.moeda,
      cambio: p.cambio,
      localizador: p.localizador,
      data_inicio: p.data_inicio,
      data_fim: p.data_fim,
      quantidade: pax.length ? 1 : p.quantidade,
      valor_unitario_centavos: unit,
      taxas_centavos: pax.length ? 0 : p.taxas + p.outras_taxas,
      passageiros: pax.map((nome, k) => ({ id: `${chave}:p${i + 1}:x${k + 1}`, nome, tarifa_centavos: tarifas[k], taxas_centavos: taxas[k], outras_taxas_centavos: outras[k] })),
      componentes: [
        ...comp('COMISSAO', p.comissao), ...comp('OVER', p.over), ...comp('TAXA_DU', p.taxa_du), ...comp('RAV', p.rav),
        ...comp('FEE', p.fee), ...comp('MARKUP', p.markup), ...comp('DESCONTO', p.desconto), ...comp('TAXA_CC', p.taxa_cc),
      ],
      cancelado_em: p.cancelado_em,
      detalhes: { produto_no_sistema_anterior: p.produto },
    };
  });
  const { venda, erros } = normalizarVenda({
    id: '', numero: '', data_venda: v.data_venda,
    cliente: parte(cliente),
    vendedor: v.vendedor ? { id: '', nome: v.vendedor } : null,
    intermediario: v.intermediario ? parte(fornecedores.get(normalizar(v.intermediario)) ?? null, v.intermediario) : null,
    origem: 'mudanca', produtos, pagamentos: [],
    observacoes: `Venda Nº ${v.numero} trazida do sistema anterior.${v.empresa ? ` Empresa: ${v.empresa}.` : ''}`,
  });
  // Confere o valor de cada produto com o que o sistema anterior mostrava.
  venda.produtos.forEach((p, i) => {
    const lido = v.produtos[i];
    if (lido.valor_total === null || p.cancelado_em) return;
    const aqui = totaisDoProduto(p).valor_cliente;
    if (Math.abs(aqui - lido.valor_total) > 1) {
      avisos.push(`Produto ${i + 1} (${lido.produto}): o valor total lá era ${reais(lido.valor_total)} e aqui fica ${reais(aqui)}. Confira os componentes na ficha da venda.`);
    }
  });
  return { venda, erros: erros.map(e => e.mensagem), avisos };
}

/** Chave natural do registro do histórico (o mesmo arquivo duas vezes não duplica). */
export function chaveDoHistorico(r: RegistroDoHistorico): string {
  switch (r.lista) {
    case 'liquidados': return `liq:${chaveDoTitulo(r.dados)}|${r.dados.baixa.data}`;
    case 'movimentos': return `mov:${normalizar(r.dados.conta)}|${r.dados.data}|${r.dados.entrada ? 'e' : 's'}|${r.dados.valor}|${normalizar(r.dados.documento || r.dados.descricao)}|${r.dados.numero}`;
    case 'vendas': return `venda:${normalizar(r.dados.venda)}`;
    case 'faturas': return `fatura:${normalizar(r.dados.numero)}`;
    case 'notas': return `nota:${normalizar(r.dados.serie)}:${normalizar(r.dados.numero)}`;
    case 'comissoes_pagas': return `comissao:${nomeComparavel(r.dados.pessoa)}|${normalizar(r.dados.venda)}|${r.dados.data_venda}|${r.dados.valor}|${normalizar(r.dados.documento || r.dados.descricao)}`;
    case 'metas': return `meta:${nomeComparavel(r.dados.pessoa)}|${normalizar(r.dados.funcao)}|${r.dados.ano}`;
    case 'reembolsos': return `reembolso:${r.dados.tipo}|${r.dados.documento_pessoa || nomeComparavel(r.dados.pessoa)}|${r.dados.valor}|${normalizar(r.dados.venda)}|${r.dados.prazo ?? ''}`;
    case 'creditos': return `credito:${r.dados.documento_pessoa || nomeComparavel(r.dados.cliente)}|${r.dados.saldo}|${normalizar(r.dados.venda)}|${r.dados.validade ?? ''}`;
  }
}

/** Já trazido por outra mudança, ou repetido nesta? (devolve a recusa) */
function repetido(indice: IndiceDeCadastros, ctx: ContextoDoPlano, chave: string): Decisao | null {
  const outra = indice.registros.get(chave);
  if (outra) return recusa('ja_importado', `Já trazido por outra mudança (${outra}).`, chave);
  const aqui = ctx.chavesDoLote.get(chave);
  if (aqui) return recusa('duplicado_no_arquivo', `Repete a ${aqui}.`, chave);
  return null;
}

/** Decide (e grava, com o gravador de verdade) uma linha do histórico. */
export async function processarHistorico(
  registro: RegistroDoHistorico, _enriq: Enriquecimento, indice: IndiceDeCadastros, ctx: ContextoDoPlano, g: Gravador, o: OrigemDaLinha,
): Promise<Decisao> {
  const onde = `linha ${o.linha} de "${o.arquivo}"`;
  switch (registro.lista) {
    case 'liquidados': {
      const t = registro.dados;
      const chave = chaveDoHistorico(registro);
      const rep = repetido(indice, ctx, chave);
      if (rep) return rep;
      // A mesma conta pode vir como em aberto (lista da v1) e como liquidada: a de aberto já pegou a chave.
      const chaveV1 = chaveDoTitulo(t);
      if (indice.chavesImportadas.has(chaveV1) || ctx.chavesDoLote.has(chaveV1)) {
        return recusa('duplicado_no_arquivo', 'Esta conta já veio na lista das contas em aberto: entra uma vez só.', chave);
      }
      const papel: PapelSimples = t.movimento === 'receber' ? 'cliente' : 'fornecedor';
      const tabela = t.movimento === 'receber' ? 'contas_receber' : 'contas_pagar';
      const avisos: string[] = [];
      const p = await garantirPessoa(indice, g, o, papel, t.pessoa, t.documento_pessoa);
      if ('recusa' in p) return { ...p.recusa, chave };
      if (p.criada) avisos.push(`${papel === 'cliente' ? 'Cliente' : 'Fornecedor'} "${t.pessoa}" não estava cadastrado: será criado.`);
      let categoriaId = '';
      if (t.categoria) {
        const c = await garantirCategoria(indice, g, o, t.movimento === 'receber' ? 'RECEITA' : 'DESPESA', t.categoria, t.grupo);
        categoriaId = c.categoria.id;
        if (c.criada) avisos.push(`Categoria "${t.categoria}" não existia: será criada.`);
      }
      let centroId = '';
      let centroNome = '';
      if (t.centro_custo) {
        const c = await garantirCentro(indice, g, o, t.centro_custo);
        centroId = c.id; centroNome = c.nome;
      }
      let contaId: string | null = null;
      if (t.baixa.conta) {
        const c = acharConta(indice, { nome: t.baixa.conta });
        if (c) contaId = c.id;
        else avisos.push(`A conta "${t.baixa.conta}" não foi encontrada: a baixa entra no Caixa Geral.`);
      }
      ctx.chavesDoLote.set(chave, onde);
      const id = await g.criarTitulo(tabela, t, {
        pessoa_id: p.pessoa.id, pessoa_nome: p.pessoa.nome, categoria_id: categoriaId, centro_id: centroId, centro_nome: centroNome, conta_id: contaId,
      }, chave, o);
      const baixaId = await g.criarBaixaHistorica(tabela, id, t.baixa, contaId, o);
      indice.titulosDoLote.push({ tabela, id, pessoa_id: p.pessoa.id, valor: t.valor, venda: t.venda, liquidado: true });
      indice.baixas.push({
        id: baixaId, conta_id: contaId ?? '', data: t.baixa.data, valor: t.baixa.valor, entrada: t.movimento === 'receber',
        pessoa_id: p.pessoa.id, titulo_id: id, doLote: true,
      });
      return {
        resultado: 'criar', codigo: null,
        motivo: `Conta a ${t.movimento} de ${reais(t.valor)} liquidada em ${dataBR(t.baixa.data)}${t.baixa.conta ? ` na conta "${t.baixa.conta}"` : ''}: entra com a baixa, sem mudar o saldo da data de corte.`,
        avisos, alvo_tabela: tabela, alvo_id: id, chave,
      };
    }
    case 'movimentos': {
      const m = registro.dados;
      const chave = chaveDoHistorico(registro);
      const rep = repetido(indice, ctx, chave);
      if (rep) return rep;
      if (/transfer/.test(normalizar(`${m.descricao} ${m.forma} ${m.categoria}`))) {
        return recusa('transferencia', 'Transferência entre contas: não é receita nem despesa. O saldo da data de corte já a contém; lance em Transferências se quiser vê-la no extrato.', chave);
      }
      const conta = acharConta(indice, { nome: m.conta });
      if (!conta) return recusa('conta_nao_encontrada', `A conta "${m.conta}" não está na lista de contas nem cadastrada aqui.`, chave);
      // Já está numa conta liquidada (desta ou de outra mudança, ou lançada aqui)? Liga, não duplica.
      const doc = m.documento_pessoa;
      const nome = nomeComparavel(m.pessoa);
      const candidatas = indice.baixas.filter(b => !b.ligada && b.conta_id === conta.id && b.data === m.data && b.valor === m.valor && b.entrada === m.entrada);
      const daPessoa = candidatas.find(b => {
        const p = indice.pessoas.find(x => x.id === b.pessoa_id);
        return p && ((doc && p.documento === doc) || (nome && nomeComparavel(p.nome) === nome));
      });
      const achada = daPessoa ?? (candidatas.length === 1 ? candidatas[0] : null);
      ctx.chavesDoLote.set(chave, onde);
      if (achada) {
        achada.ligada = true;
        await g.vincular('baixas', achada.id, o, chave);
        return {
          resultado: 'vincular', codigo: null,
          motivo: `Já está aqui: é a baixa de ${dataBR(achada.data)} de ${reais(achada.valor)}${achada.doLote ? ' trazida nas contas liquidadas' : ''}.`,
          avisos: [], alvo_tabela: 'baixas', alvo_id: achada.id, chave,
        };
      }
      // Movimento solto (tarifa, rendimento, recebimento sem conta): vira uma conta liquidada.
      const papel: PapelSimples = m.entrada ? 'cliente' : 'fornecedor';
      const tabela = m.entrada ? 'contas_receber' : 'contas_pagar';
      const avisos: string[] = [];
      const p = await garantirPessoa(indice, g, o, papel, m.pessoa || PESSOA_SEM_NOME, m.documento_pessoa);
      if ('recusa' in p) return { ...p.recusa, chave };
      if (!m.pessoa) avisos.push(`Sem pessoa: fica com "${PESSOA_SEM_NOME}".`);
      let categoriaId = '';
      if (m.categoria) categoriaId = (await garantirCategoria(indice, g, o, m.entrada ? 'RECEITA' : 'DESPESA', m.categoria, '')).categoria.id;
      else avisos.push('Sem categoria: aparece em "sem categoria" nos relatórios até alguém escolher.');
      const titulo = {
        movimento: (m.entrada ? 'receber' : 'pagar') as 'receber' | 'pagar', pessoa: m.pessoa || PESSOA_SEM_NOME, razao_social: '', documento_pessoa: m.documento_pessoa,
        numero: m.numero, documento: m.documento, descricao: m.descricao || `Movimentação de ${dataBR(m.data)} na conta ${conta.nome}`, emissao: m.data, vencimento: m.data,
        liquidado_depois_do_corte: null, valor: m.valor, categoria: m.categoria, grupo: '', centro_custo: '', conta: m.conta, empresa: m.empresa,
        venda: m.venda, fatura: m.fatura, vendedor: '', parcela_numero: 1, total_parcelas: 1, forma: m.forma, observacoes: 'Movimentação trazida do extrato do sistema anterior.',
      };
      const id = await g.criarTitulo(tabela, titulo, {
        pessoa_id: p.pessoa.id, pessoa_nome: p.pessoa.nome, categoria_id: categoriaId, centro_id: '', centro_nome: '', conta_id: conta.id,
      }, chave, o);
      const baixaId = await g.criarBaixaHistorica(tabela, id, { data: m.data, conta: m.conta, valor: m.valor, juros: 0, multa: 0, desconto: 0, taxa: 0, forma: m.forma }, conta.id, o);
      indice.baixas.push({ id: baixaId, conta_id: conta.id, data: m.data, valor: m.valor, entrada: m.entrada, pessoa_id: p.pessoa.id, titulo_id: id, doLote: true, ligada: true });
      indice.titulosDoLote.push({ tabela, id, pessoa_id: p.pessoa.id, valor: m.valor, venda: m.venda, liquidado: true });
      return {
        resultado: 'criar', codigo: null,
        motivo: `${m.entrada ? 'Entrada' : 'Saída'} de ${reais(m.valor)} em ${dataBR(m.data)} na conta "${conta.nome}": vira uma conta liquidada, sem mudar o saldo da data de corte.`,
        avisos, alvo_tabela: tabela, alvo_id: id, chave,
      };
    }
    case 'vendas': {
      const chave = chaveDoHistorico(registro);
      const v = registro.venda;
      if (!v) {
        // Produto de uma venda montada na primeira linha dela.
        const venda = vendaPorNumero(indice, registro.dados.venda);
        if (!venda || !venda.doLote) {
          const motivoDaCabeca = ctx.vendasRecusadas?.get(chave);
          return recusa(motivoDaCabeca?.codigo ?? 'duplicado_no_arquivo', motivoDaCabeca ? `Produto da venda Nº ${registro.dados.venda}, que ficou de fora: ${motivoDaCabeca.motivo}` : `A venda Nº ${registro.dados.venda} não foi montada.`);
        }
        return { resultado: 'vincular', codigo: null, motivo: `Produto da venda Nº ${registro.dados.venda} (montada na primeira linha dela).`, avisos: [], alvo_tabela: 'vendas_crm', alvo_id: venda.id, chave: null };
      }
      const ja = vendaPorNumero(indice, v.numero);
      const guardarRecusa = (d: Decisao) => { (ctx.vendasRecusadas ??= new Map()).set(chave, { codigo: String(d.codigo), motivo: d.motivo }); return d; };
      if (ja && !ja.doLote) return guardarRecusa(recusa('ja_importado', `A venda Nº ${v.numero} já foi trazida por outra mudança.`, chave));
      const rep = repetido(indice, ctx, chave);
      if (rep) return guardarRecusa(rep);
      const avisos: string[] = [];
      const cli = await garantirPessoa(indice, g, o, 'cliente', v.cliente.nome, v.cliente.documento, v.cliente.email);
      if ('recusa' in cli) return guardarRecusa({ ...cli.recusa, chave });
      if (cli.criada) avisos.push(`Cliente "${v.cliente.nome}" não estava cadastrado: será criado.`);
      const fornecedores = new Map<string, PessoaConhecida>();
      for (const nomeF of new Set(v.produtos.flatMap(p => [p.fornecedor, p.representante]).concat(v.intermediario).filter(Boolean))) {
        const f = await garantirPessoa(indice, g, o, 'fornecedor', nomeF);
        if ('recusa' in f) { avisos.push(f.recusa.motivo); continue; }
        if (f.criada) avisos.push(`Fornecedor "${nomeF}" não estava cadastrado: será criado.`);
        fornecedores.set(normalizar(nomeF), f.pessoa);
      }
      const montada = vendaDoModelo(v, cli.pessoa, fornecedores, chave);
      if (montada.erros.length) return guardarRecusa(recusa('venda_invalida', montada.erros[0], chave));
      avisos.push(...montada.avisos);
      const nNum = normalizar(v.numero);
      const titulos = indice.titulosDoLote.filter(t => normalizar(t.venda) === nNum);
      ctx.chavesDoLote.set(chave, onde);
      const id = await g.criarVenda(montada.venda, { numero_anterior: v.numero, chave, titulos }, o);
      indice.vendas.push({ id, numero_anterior: v.numero, doLote: true });
      const futura = v.produtos.some(p => p.data_inicio && ctx.dataCorte && p.data_inicio > ctx.dataCorte && !p.cancelado_em);
      if (titulos.length) avisos.push(`${titulos.length} conta(s) trazida(s) com a Venda Nº ${v.numero} ficam ligadas a ela: as contas da venda são essas, nenhuma nasce de novo.`);
      else if (futura) avisos.push('Viagem que ainda vai acontecer e sem contas trazidas com o número dela: confira as contas a pagar e a receber dessa venda.');
      return {
        resultado: 'criar', codigo: null,
        motivo: `Venda Nº ${v.numero} de ${dataBR(v.data_venda)} com ${v.produtos.length} produto(s), no modelo completo, sem gerar contas de novo.`,
        avisos, alvo_tabela: 'vendas_crm', alvo_id: id, chave,
      };
    }
    case 'faturas':
    case 'notas':
    case 'comissoes_pagas': {
      const chave = chaveDoHistorico(registro);
      const rep = repetido(indice, ctx, chave);
      if (rep) return rep;
      const d = registro.dados;
      const venda = 'venda' in d && d.venda ? vendaPorNumero(indice, d.venda) : null;
      const resumo = registro.lista === 'faturas'
        ? { data: registro.dados.emissao ?? registro.dados.vencimento, valor: registro.dados.valor, pessoa: registro.dados.pessoa, numero: registro.dados.numero }
        : registro.lista === 'notas'
          ? { data: registro.dados.emissao, valor: registro.dados.valor, pessoa: registro.dados.tomador, numero: registro.dados.numero }
          : { data: registro.dados.pago_em ?? registro.dados.data_venda, valor: registro.dados.valor, pessoa: registro.dados.pessoa, numero: registro.dados.venda };
      ctx.chavesDoLote.set(chave, onde);
      const id = await g.gravarRegistro(registro.lista, chave, { ...resumo, venda_id: venda?.id ?? '' }, d as unknown as Record<string, unknown>, o);
      const texto = registro.lista === 'faturas' ? `Fatura Nº ${resumo.numero}` : registro.lista === 'notas' ? `Nota Nº ${resumo.numero}` : `Comissão de ${resumo.pessoa}`;
      return {
        resultado: 'criar', codigo: null,
        motivo: `${texto} de ${reais(resumo.valor)} fica como registro do sistema anterior${registro.lista === 'notas' ? ' (nunca é emitida de novo)' : registro.lista === 'comissoes_pagas' ? ' (não gera conta nem entra no cálculo de novo)' : ''}.`,
        avisos: venda ? [`Ligado à venda Nº ${('venda' in d && d.venda) || ''} trazida.`] : [], alvo_tabela: 'migracao_historico', alvo_id: id, chave,
      };
    }
    case 'metas': {
      const mt = registro.dados;
      const chave = chaveDoHistorico(registro);
      const aqui = ctx.chavesDoLote.get(chave);
      if (aqui) return recusa('duplicado_no_arquivo', `Repete a ${aqui}.`, chave);
      const nome = nomeComparavel(mt.pessoa);
      const funcao = normalizar(mt.funcao);
      const nasFuncoes = indice.pessoasFuncao.filter(p => nomeComparavel(p.pessoa_nome) === nome && (!funcao || normalizar(p.funcao_nome) === funcao));
      if (!nasFuncoes.length) {
        return recusa('pessoa_sem_funcao', `"${mt.pessoa}" não está ${mt.funcao ? `na função ${mt.funcao}` : 'em nenhuma função'} aqui. Cadastre em Equipe › Funções e solte o arquivo de novo.`, chave);
      }
      if (nasFuncoes.length > 1) return recusa('pessoa_ambigua', `"${mt.pessoa}" está em mais de uma função: ligue a coluna Função.`, chave);
      ctx.chavesDoLote.set(chave, onde);
      let n = 0;
      for (const [i, c] of mt.meses.entries()) {
        if (c === null) continue;
        await g.gravarMeta(nasFuncoes[0].id, `${mt.ano}-${String(i + 1).padStart(2, '0')}`, c, o);
        n += 1;
      }
      return { resultado: 'criar', codigo: null, motivo: `Metas de ${mt.pessoa} em ${mt.ano}: ${n} mês(es).`, avisos: [], alvo_tabela: 'comissao_metas', alvo_id: nasFuncoes[0].id, chave };
    }
    case 'reembolsos': {
      const r = registro.dados;
      const chave = chaveDoHistorico(registro);
      const rep = repetido(indice, ctx, chave);
      if (rep) return rep;
      const papel: PapelSimples = r.tipo === 'CLIENTE' ? 'cliente' : 'fornecedor';
      const p = await garantirPessoa(indice, g, o, papel, r.pessoa, r.documento_pessoa);
      if ('recusa' in p) return { ...p.recusa, chave };
      const venda = r.venda ? vendaPorNumero(indice, r.venda) : null;
      // A conta deste reembolso já veio nas contas em aberto? Então o reembolso usa ESSA conta (aprovado), sem criar outra.
      const tabela = r.tipo === 'CLIENTE' ? 'contas_pagar' : 'contas_receber';
      // A mesma pessoa pode estar como cliente e como fornecedor (o reembolso ao cliente é uma conta a pagar a ele): vale o nome.
      const nomeDe = (id: string) => nomeComparavel(indice.pessoas.find(x => x.id === id)?.nome ?? '');
      const conta: TituloDoLote | null = indice.titulosDoLote.find(t => !t.reembolso && !t.liquidado && t.tabela === tabela && t.valor === r.valor
        && (t.pessoa_id === p.pessoa.id || (nomeDe(t.pessoa_id) !== '' && nomeDe(t.pessoa_id) === nomeComparavel(p.pessoa.nome)))) ?? null;
      if (conta) conta.reembolso = true;
      ctx.chavesDoLote.set(chave, onde);
      const id = await g.criarReembolso(r, { id: p.pessoa.id, nome: p.pessoa.nome }, conta, venda, chave, o);
      const avisos = [] as string[];
      if (r.venda && !venda) avisos.push(`A venda Nº ${r.venda} não veio nesta mudança: o reembolso fica sem a venda ligada.`);
      return {
        resultado: 'criar', codigo: null,
        motivo: conta
          ? `Reembolso ${r.tipo === 'CLIENTE' ? 'ao cliente' : 'do fornecedor'} de ${reais(r.valor)}: aprovado, usando a conta em aberto que já veio (nenhuma conta nova).`
          : `Reembolso ${r.tipo === 'CLIENTE' ? 'ao cliente' : 'do fornecedor'} de ${reais(r.valor)}: entra como solicitado; a conta nasce quando for aprovado aqui.`,
        avisos, alvo_tabela: 'reembolsos', alvo_id: id, chave,
      };
    }
    case 'creditos': {
      const c = registro.dados;
      const chave = chaveDoHistorico(registro);
      const rep = repetido(indice, ctx, chave);
      if (rep) return rep;
      const p = await garantirPessoa(indice, g, o, 'cliente', c.cliente, c.documento_pessoa);
      if ('recusa' in p) return { ...p.recusa, chave };
      const venda = c.venda ? vendaPorNumero(indice, c.venda) : null;
      ctx.chavesDoLote.set(chave, onde);
      const id = await g.criarCredito(c, { id: p.pessoa.id, nome: p.pessoa.nome }, venda, chave, o);
      return {
        resultado: 'criar', codigo: null,
        motivo: `Crédito de ${reais(c.saldo)} para ${p.pessoa.nome}${c.validade ? ` válido até ${dataBR(c.validade)}` : ''}: entra na carteira do cliente, pronto para usar.`,
        avisos: [], alvo_tabela: 'creditos_cliente', alvo_id: id, chave,
      };
    }
  }
}

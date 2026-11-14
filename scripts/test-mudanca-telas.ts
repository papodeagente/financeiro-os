/**
 * E4 · Mudança — lógica pura das telas (05/11/2026): em que passo o
 * assistente abre e o que trava cada passo, avisos dos arquivos, meses que
 * faltam, colunas obrigatórias, ensaio, progresso, provas, o guia do que
 * exportar, o glossário e a montagem do checklist de paridade a partir dos
 * 15 blocos do plano. E o vocabulário: nenhum termo proibido nos arquivos
 * novos, e toda rota citada existe.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-mudanca-telas.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ORDEM_DAS_LISTAS, type ArquivoDoLote, type Lote, type MapeamentoDoArquivo } from '../src/lib/migracao/contrato-telas.ts';
import {
  bloqueioDasColunas, bloqueioDoEnsaio, bloqueioDosArquivos, camposFaltando, camposRepetidos, colunasIgnoradas, contarProvas,
  dataBR, ensaioEmDia, erroDaDataDeCorte, ETAPAS, etapaInicial, jaAplicou, listaEmFrase, listasSemArquivo, mensagemDeErro,
  mesesFaltando, nomeDoMes, ordenarArquivos, percentual, problemaDoArquivoLocal, resumoNaOrdem, situacaoDaProva, textoDoAviso,
  totaisDoEnsaio, travaDaEtapa,
} from '../src/lib/migracao/telas/assistente.ts';
import { GLOSSARIO, buscarNoGlossario, glossarioPorAssunto } from '../src/lib/migracao/telas/glossario.ts';
import { GUIA_DE_EXPORTACAO, ROTULO_DA_LISTA } from '../src/lib/migracao/telas/listas.ts';
import { BLOCOS_DA_PARIDADE, ENTREGA_NO_AR, itemNoAr, montarChecklist, rotuloDaEntrega, type BlocoDaParidade } from '../src/lib/migracao/telas/paridade.ts';
import { buscarPorTermoDeMercado } from '../src/lib/busca-de-mercado.ts';
import { buildTrail } from '../src/lib/breadcrumbs.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const rotaExiste = (href: string) => {
  const rota = href.split('?')[0].replace(/^\//, '');
  return existsSync(new URL(`../src/app/${rota ? `${rota}/` : ''}page.tsx`, import.meta.url));
};

function arquivo(p: Partial<ArquivoDoLote> = {}): ArquivoDoLote {
  return { id: 'a1', nome: 'contas.xlsx', tamanho: 1000, formato: 'xlsx', tipo_lista: 'contas', linhas: 10, periodo: null, avisos: [], erro: null, ...p };
}
function lote(p: Partial<Lote> = {}): Lote {
  return {
    id: 'l1', situacao: 'rascunho', data_corte: '2026-10-31', arquivos: [], versao: 1, versao_do_ensaio: null, resumo_do_ensaio: null,
    criado_em: '2026-11-05T12:00:00Z', criado_por_nome: 'Ana', aplicado_em: null, concluido_em: null, desfeito_em: null,
    nao_desfeitos: null, erro: null, ...p,
  };
}
const RESUMO = [{ tipo_lista: 'pessoas' as const, criar: 3, vincular: 2, recusar: 1 }, { tipo_lista: 'contas' as const, criar: 1, vincular: 0, recusar: 0 }];
const ensaiado = (p: Partial<Lote> = {}) => lote({ situacao: 'ensaiado', arquivos: [arquivo()], versao: 4, versao_do_ensaio: 4, resumo_do_ensaio: RESUMO, ...p });

// ─── Passos do assistente ──────────────────────────────────────────────────
console.log('--- Em que passo o assistente abre ---');
eq(ETAPAS.map(e => e.id), ['exportar', 'arquivos', 'colunas', 'ensaio', 'aplicar', 'provas', 'concluir', 'recriar', 'paralelo'], 'os sete passos da mudança e os dois de depois (E7), na ordem');
eq(etapaInicial(null), 'exportar', 'sem mudança: começa pelo que exportar');
eq(etapaInicial(lote()), 'arquivos', 'mudança criada sem arquivo: soltar arquivos');
eq(etapaInicial(lote({ arquivos: [arquivo({ tipo_lista: null })] })), 'arquivos', 'arquivo sem lista: volta aos arquivos');
eq(etapaInicial(lote({ arquivos: [arquivo({ erro: 'protegido' })] })), 'arquivos', 'arquivo com erro: volta aos arquivos');
eq(etapaInicial(lote({ arquivos: [arquivo()] })), 'colunas', 'arquivos lidos, sem ensaio: colunas');
eq(etapaInicial(ensaiado()), 'ensaio', 'ensaio em dia: abre no ensaio');
eq(etapaInicial(ensaiado({ versao: 5 })), 'colunas', 'arquivo mudou depois do ensaio: colunas');
eq(etapaInicial(ensaiado({ situacao: 'aplicando', aplicado_em: '2026-11-05' })), 'aplicar', 'gravando: abre na barra de progresso');
eq(etapaInicial(ensaiado({ situacao: 'aplicado', aplicado_em: '2026-11-05' })), 'provas', 'aplicado: provas');
eq(etapaInicial(ensaiado({ situacao: 'falhou', aplicado_em: '2026-11-05' })), 'aplicar', 'falhou gravando: mostra onde parou');
eq(etapaInicial(ensaiado({ situacao: 'falhou' })), 'ensaio', 'falhou antes de gravar: ensaio');
eq(etapaInicial(ensaiado({ situacao: 'concluido' })), 'concluir', 'concluído: última tela');
eq(etapaInicial(ensaiado({ situacao: 'desfeito' })), 'concluir', 'desfeito: última tela, com o que ficou');

console.log('--- O que trava cada passo ---');
eq(travaDaEtapa('exportar', null), null, 'exportar sempre abre');
eq(typeof travaDaEtapa('arquivos', null), 'string', 'arquivos pede a data de corte antes');
eq(travaDaEtapa('aplicar', lote({ arquivos: [arquivo()] })), 'Rode o ensaio antes de aplicar.', 'aplicar sem ensaio: trava com o motivo');
eq(travaDaEtapa('aplicar', ensaiado()), null, 'aplicar com ensaio em dia: abre');
eq(travaDaEtapa('provas', ensaiado()), 'As provas e a conclusão aparecem depois de aplicar.', 'provas antes de aplicar: trava');
const aplicado = ensaiado({ situacao: 'aplicado', aplicado_em: '2026-11-05' });
eq(jaAplicou(aplicado), true, 'aplicado conta como gravado');
eq(jaAplicou(ensaiado({ situacao: 'falhou' })), false, 'falhou sem aplicado_em: nada gravado');
eq(travaDaEtapa('arquivos', aplicado)?.includes('desfaça'), true, 'depois de aplicar, arquivos travam e dizem como mudar');
eq(travaDaEtapa('colunas', aplicado)?.includes('desfaça'), true, 'depois de aplicar, colunas travam');
eq(travaDaEtapa('ensaio', aplicado), null, 'o ensaio aplicado continua para consulta');
eq(travaDaEtapa('provas', aplicado), null, 'provas abrem depois de aplicar');
eq(travaDaEtapa('recriar', null), null, 'recriar regras e planos abre sempre (não depende dos arquivos)');
eq([typeof travaDaEtapa('paralelo', ensaiado()), travaDaEtapa('paralelo', aplicado)], ['string', null], 'o mês em paralelo só depois de aplicar');
eq(ensaioEmDia(ensaiado()), true, 'ensaio na mesma versão: em dia');
eq(ensaioEmDia(ensaiado({ versao: 5 })), false, 'versão nova: ensaio velho');
eq(ensaioEmDia(ensaiado({ resumo_do_ensaio: null })), false, 'sem resumo: não está em dia');

// ─── Arquivos ──────────────────────────────────────────────────────────────
console.log('--- Arquivos ---');
eq(bloqueioDosArquivos([]), 'Solte pelo menos um arquivo.', 'nenhum arquivo: diz o que fazer');
eq(bloqueioDosArquivos([arquivo({ nome: 'x.xls', erro: 'vazio' })]), 'O arquivo "x.xls" não foi lido. Tire ou troque por outro.', 'arquivo com erro bloqueia, com o nome');
eq(bloqueioDosArquivos([arquivo({ nome: 'y.csv', tipo_lista: null })]), 'Diga de qual lista é o arquivo "y.csv".', 'lista não reconhecida bloqueia');
eq(bloqueioDosArquivos([arquivo()]), null, 'arquivo lido e reconhecido: segue');
eq(ordenarArquivos([
  arquivo({ id: '1', nome: 'b.xlsx', tipo_lista: 'titulos' }), arquivo({ id: '2', nome: 'z.xlsx', tipo_lista: null }),
  arquivo({ id: '3', nome: 'a.xlsx', tipo_lista: 'titulos' }), arquivo({ id: '4', nome: 'c.xlsx', tipo_lista: 'contas' }),
]).map(a => a.id), ['4', '3', '1', '2'], 'ordem de aplicação, depois nome; sem lista no fim');
eq(listasSemArquivo([arquivo({ tipo_lista: 'contas' }), arquivo({ tipo_lista: 'titulos' })]), ['categorias', 'pessoas', 'saldos'], 'listas obrigatórias que faltam (centro de custo é opcional)');
eq(problemaDoArquivoLocal('lista.pdf', 10)?.includes('não é lido'), true, 'PDF recusado antes de enviar');
eq(problemaDoArquivoLocal('lista.XLSX', 10), null, 'extensão em maiúscula vale');
eq(problemaDoArquivoLocal('lista.txt', 0), 'O arquivo está vazio.', 'arquivo vazio recusado');
eq(problemaDoArquivoLocal('lista.csv', 21 * 1024 * 1024)?.includes('um mês por arquivo'), true, 'grande demais: pede um mês por arquivo');
eq(textoDoAviso({ codigo: 'lista_cortada', detalhe: '500 linhas' }).tom, 'aviso', 'lista cortada é aviso');
eq(textoDoAviso({ codigo: 'lista_cortada' }).texto.includes('um arquivo por mês'), true, 'lista cortada pede um arquivo por mês');
eq(textoDoAviso({ codigo: 'linha_de_total' }).tom, 'info', 'linha de total ignorada é informação');

console.log('--- Meses que faltam nas contas em aberto ---');
const mes = (id: string, de: string, ate: string) => arquivo({ id, tipo_lista: 'titulos', periodo: { de, ate } });
eq(mesesFaltando([mes('1', '2026-01-01', '2026-01-31'), mes('2', '2026-03-01', '2026-03-31')]), ['2026-02'], 'janeiro e março: falta fevereiro');
eq(mesesFaltando([mes('1', '2025-11-01', '2025-11-30'), mes('2', '2026-02-01', '2026-02-28')]), ['2025-12', '2026-01'], 'atravessa o ano');
eq(mesesFaltando([mes('1', '2026-01-01', '2026-03-31')]), [], 'um arquivo de três meses: nada falta');
eq(mesesFaltando([mes('1', '2026-01-05', '2026-01-20')]), [], 'um mês só: nada a comparar');
eq(mesesFaltando([mes('1', '2026-01-01', '2026-01-31'), arquivo({ tipo_lista: 'pessoas', periodo: { de: '2026-05-01', ate: '2026-05-02' } })]), [], 'só as contas a pagar e receber contam');
eq(nomeDoMes('2026-02'), 'fev/2026', 'nome curto do mês');
eq(nomeDoMes('2026-13'), '2026-13', 'mês inválido volta como veio');
eq(dataBR('2026-10-31'), '31/10/2026', 'data no formato do Brasil');
eq(listaEmFrase(['A', 'B', 'C']), 'A, B e C', 'lista em frase');

console.log('--- Data de corte ---');
eq(erroDaDataDeCorte('', '2026-11-05'), 'Escolha a data de corte.', 'vazia pede a data');
eq(erroDaDataDeCorte('2026-02-30', '2026-11-05'), 'Esta data não existe.', '30 de fevereiro não existe');
eq(erroDaDataDeCorte('2026-11-06', '2026-11-05')?.includes('futuro'), true, 'no futuro: recusa');
eq(erroDaDataDeCorte('2026-10-31', '2026-11-05'), null, 'mês passado: vale');
eq(erroDaDataDeCorte('2026-11-05', '2026-11-05'), null, 'hoje: vale');

// ─── Colunas ───────────────────────────────────────────────────────────────
console.log('--- Colunas ---');
const mapa: MapeamentoDoArquivo = {
  arquivo_id: 'a1', arquivo_nome: 'novembro.xlsx', tipo_lista: 'titulos',
  campos: [
    { campo: 'pessoa', rotulo: 'Pessoa', obrigatorio: true }, { campo: 'vencimento', rotulo: 'Vencimento', obrigatorio: true },
    { campo: 'valor', rotulo: 'Valor', obrigatorio: true }, { campo: 'documento', rotulo: 'Documento', obrigatorio: false },
  ],
  colunas: [
    { indice: 0, cabecalho: 'Pessoa', exemplos: ['Ana'], campo: 'pessoa', sugerido: 'pessoa', confianca: 'certa' },
    { indice: 1, cabecalho: 'Vencto', exemplos: ['10/11/2026'], campo: 'vencimento', sugerido: 'vencimento', confianca: 'provavel' },
    { indice: 2, cabecalho: 'Obs', exemplos: [], campo: null, sugerido: null, confianca: 'nenhuma' },
  ],
};
eq(camposFaltando(mapa), ['Valor'], 'Valor obrigatório sem coluna');
eq(bloqueioDasColunas([mapa]), 'No arquivo "novembro.xlsx", falta dizer qual coluna é Valor.', 'bloqueio diz o arquivo e o campo');
eq(colunasIgnoradas(mapa), ['Obs'], 'coluna sem destino fica de fora e é listada');
const repetido: MapeamentoDoArquivo = { ...mapa, colunas: [...mapa.colunas, { indice: 3, cabecalho: 'Total', exemplos: [], campo: 'valor', sugerido: null, confianca: 'nenhuma' }, { indice: 4, cabecalho: 'Valor final', exemplos: [], campo: 'valor', sugerido: 'valor', confianca: 'certa' }] };
eq(camposFaltando(repetido), [], 'com Valor escolhido, nada falta');
eq(camposRepetidos(repetido), ['Valor'], 'duas colunas para Valor: repetido');
eq(bloqueioDasColunas([repetido])?.includes('Escolha uma só'), true, 'repetido bloqueia e diz o que fazer');
const certo: MapeamentoDoArquivo = { ...mapa, colunas: [...mapa.colunas, { indice: 3, cabecalho: 'Valor', exemplos: [], campo: 'valor', sugerido: 'valor', confianca: 'certa' }] };
eq(bloqueioDasColunas([certo]), null, 'tudo obrigatório com uma coluna só: segue');

// ─── Ensaio, aplicar e provas ──────────────────────────────────────────────
console.log('--- Ensaio ---');
eq(totaisDoEnsaio(RESUMO), { criar: 4, vincular: 2, recusar: 1, total: 7 }, 'totais somam as listas');
eq(totaisDoEnsaio(null), { criar: 0, vincular: 0, recusar: 0, total: 0 }, 'sem ensaio: zeros');
eq(resumoNaOrdem(RESUMO).map(r => r.tipo_lista), ['contas', 'pessoas'], 'resumo na ordem de aplicação');
eq(bloqueioDoEnsaio(ensaiado()), null, 'ensaio em dia com algo a trazer: pode aplicar');
eq(bloqueioDoEnsaio(ensaiado({ versao: 9 }))?.includes('Rode o ensaio de novo'), true, 'ensaio velho: rodar de novo');
eq(bloqueioDoEnsaio(ensaiado({ situacao: 'ensaiando' })), 'O ensaio ainda está rodando.', 'rodando: espera');
eq(bloqueioDoEnsaio(ensaiado({ resumo_do_ensaio: [{ tipo_lista: 'pessoas', criar: 0, vincular: 0, recusar: 5 }] }))?.includes('nada para trazer'), true, 'só recusas: não aplica');

console.log('--- Progresso ---');
eq(percentual(0, 0), 0, 'sem total: 0%');
eq(percentual(50, 200), 25, 'um quarto');
eq(percentual(999, 1000), 99, 'quase: nunca mostra 100 antes de acabar');
eq(percentual(1000, 1000), 100, 'acabou: 100%');
eq(percentual(1200, 1000), 100, 'passou do total: 100%');

console.log('--- Provas ---');
eq(situacaoDaProva(0, []), 'bate', 'sem diferença: bateu');
eq(situacaoDaProva(0.004, []), 'bate', 'menos de meio centavo: bateu');
eq(situacaoDaProva(-120, [{ motivo: 'Linha recusada', linhas: 1, valor: -120 }]), 'explicada', 'diferença toda explicada');
eq(situacaoDaProva(-120, [{ motivo: 'Linha recusada', linhas: 1, valor: -100 }]), 'sem_explicacao', 'sobra diferença: sem explicação');
eq(contarProvas([{ diferenca: 0, explicacoes: [] }, { diferenca: 5, explicacoes: [] }, { diferenca: 5, explicacoes: [{ motivo: 'x', linhas: 1, valor: 5 }] }]), { bate: 1, explicada: 1, sem_explicacao: 1 }, 'conta cada situação');

console.log('--- Erros em palavras simples ---');
eq(mensagemDeErro('ASSINATURA_VENCIDA', 'x').includes('Rode o ensaio de novo'), true, 'assinatura vencida: rodar o ensaio');
eq(mensagemDeErro(null, '', 403), 'Só o administrador da agência pode fazer a mudança.', '403: só administrador');
eq(mensagemDeErro(null, 'Arquivo protegido por senha.'), 'Arquivo protegido por senha.', 'mensagem do servidor passa');

// ─── Guia do que exportar ──────────────────────────────────────────────────
console.log('--- Guia do que exportar ---');
eq(GUIA_DE_EXPORTACAO.map(g => g.tipo), [...ORDEM_DAS_LISTAS], 'uma explicação por lista, na ordem de aplicação');
eq(GUIA_DE_EXPORTACAO.filter(g => g.umArquivoPorMes).map(g => g.tipo), ['titulos', 'liquidados', 'movimentos', 'vendas'], 'contas em aberto, liquidadas, extrato e vendas: um arquivo por mês');
eq(GUIA_DE_EXPORTACAO.every(g => g.colunas.length > 0 && g.passos.length > 0), true, 'toda lista diz as colunas e os passos');
eq(GUIA_DE_EXPORTACAO.filter(g => !rotaExiste(g.aqui.href)).map(g => g.aqui.href), [], 'todo "aqui vira" leva a uma tela que existe');
eq(GUIA_DE_EXPORTACAO.find(g => g.tipo === 'pessoas')?.colunas.includes('CPF'), true, 'pessoas pede CPF e CNPJ visíveis');
eq(Object.keys(ROTULO_DA_LISTA).sort(), [...ORDEM_DAS_LISTAS].sort(), 'rótulo para toda lista');

// ─── Glossário ─────────────────────────────────────────────────────────────
console.log('--- Glossário ---');
eq(new Set(GLOSSARIO.map(t => t.id)).size, GLOSSARIO.length, 'ids únicos');
eq(GLOSSARIO.filter(t => t.href && !rotaExiste(t.href)).map(t => t.href), [], 'toda tela citada existe');
eq(GLOSSARIO.filter(t => !t.href && !t.chega).map(t => t.id), [], 'sem tela: diz em qual entrega chega');
eq(GLOSSARIO.filter(t => t.href && t.chega).map(t => t.id), [], 'com tela: não diz que ainda vem');
eq(GLOSSARIO.filter(t => t.chega && itemNoAr(t.chega)).map(t => t.id), [], '"ainda vem" só para entrega que não está no ar');
eq(buscarNoGlossario('liquidado')[0]?.aqui, 'Pago (a pagar) ou Recebido (a receber)', '"liquidado" acha Pago/Recebido');
eq(buscarNoGlossario('cambio')[0]?.href, '/financeiro-ag/moedas', 'sem acento acha câmbio e leva à tela de Moedas e câmbio');
eq(buscarNoGlossario('remessa')[0]?.href, '/financeiro-ag/cobrancas', 'remessa leva a Cobranças');
eq(buscarNoGlossario('x'), [], 'uma letra: nada');
eq(glossarioPorAssunto().reduce((s, g) => s + g.termos.length, 0), GLOSSARIO.length, 'todo termo tem assunto');

// ─── Checklist de paridade ─────────────────────────────────────────────────
console.log('--- Checklist de paridade ---');
eq(BLOCOS_DA_PARIDADE.map(b => b.numero), Array.from({ length: 15 }, (_, i) => i + 1), 'os 15 blocos do plano, numerados');
eq(BLOCOS_DA_PARIDADE.every(b => b.itens.length > 0), true, 'todo bloco tem itens');
const montado = montarChecklist();
eq(montado.blocos.flatMap(b => b.itens).filter(i => i.pronto && !i.href).map(i => i.rotulo), [], 'o que já existe tem link para a tela');
eq(montado.blocos.flatMap(b => b.itens).filter(i => i.href && !rotaExiste(i.href)).map(i => i.href), [], 'todo link do checklist existe');
eq(montado.blocos.flatMap(b => b.itens).filter(i => !i.pronto && i.entrega === 'hoje').length, 0, 'o que já existia nunca aparece como "vem"');
eq(ENTREGA_NO_AR, 'E7', 'checklist sai com a E7 no ar (todas as entregas)');
eq(montado.blocos.find(b => b.numero === 5)?.situacao, 'parcial', 'bloco 5 (cobrança): no ar, mas falta a rodada com provedor real e o modelo do WhatsApp');
eq(montado.blocos.find(b => b.numero === 6)?.situacao, 'pronto', 'bloco 6 (faturas, E5) completo');
eq(montado.blocos.find(b => b.numero === 2)?.situacao, 'parcial', 'bloco 2: extrato automático só no Inter, o resto completo');
eq(montado.blocos.find(b => b.numero === 2)?.faltam, [], 'bloco 2 não espera mais nenhuma entrega');
eq(montarChecklist(BLOCOS_DA_PARIDADE, 'E4').blocos.find(b => b.numero === 2)?.faltam, ['E6', 'E7'], 'com a E4 no ar, o bloco 2 fechava na E6 e na E7');
eq(montado.itensTotal, BLOCOS_DA_PARIDADE.reduce((s, b) => s + b.itens.length, 0), 'conta todos os itens');
eq(montado.porEntrega.map(p => p.entrega), [], 'nada falta por entrega');
eq(montarChecklist(BLOCOS_DA_PARIDADE, 'E4').porEntrega.map(p => p.entrega), ['E5', 'E6', 'E7'], 'com a E4 no ar: o que faltava, por entrega, em ordem');
eq(montarChecklist(BLOCOS_DA_PARIDADE, 'E6').porEntrega.map(p => p.entrega), ['E7'], 'com a E6 no ar, só sobra o que a E7 fecha');
eq(BLOCOS_DA_PARIDADE.flatMap(b => b.itens).filter(i => (i.entrega === 'E5' || i.entrega === 'E7') && !i.href).map(i => i.rotulo), [], 'o que a E5 e a E7 fecham já tem o link da tela');
// Montagem por entrega: com a E7 no ar, todo bloco fica completo.
const futuro = montarChecklist(BLOCOS_DA_PARIDADE, 'E7');
eq(futuro.porEntrega, [], 'com a E7 no ar, nada mais a chegar');
const comFalta = futuro.blocos.flatMap(b => b.itens).filter(i => i.falta);
eq(comFalta.every(i => i.noAr && !i.pronto), true, 'item com falta está no ar mas não conta como pronto');
eq(futuro.comFalta, comFalta.length, 'conta os itens que dependem de um passo de fora');
eq(futuro.blocosProntos, 15 - new Set(futuro.blocos.filter(b => b.itens.some(i => i.falta)).map(b => b.numero)).size, 'bloco com item que depende de passo de fora não aparece como completo');
eq(comFalta.every(i => i.falta!.length > 20), true, 'toda falta diz o que falta, em palavras');
const sintetico: BlocoDaParidade[] = [{ numero: 1, titulo: 'X', resumo: 'x', itens: [{ rotulo: 'a', entrega: 'E2', href: '/x' }, { rotulo: 'b', entrega: 'E5' }, { rotulo: 'c', entrega: 'E7' }] }];
const s1 = montarChecklist(sintetico, 'E4');
eq([s1.blocos[0].situacao, s1.blocos[0].prontos, s1.blocos[0].faltam], ['parcial', 1, ['E5', 'E7']], 'bloco sintético: parcial, 1 pronto, falta E5 e E7');
eq(montarChecklist(sintetico, 'E1').blocos[0].situacao, 'vem', 'nada no ar: vem');
eq(rotuloDaEntrega('E5'), 'E5 · Venda e turismo', 'rótulo da entrega');

// ─── Busca ⌘K e trilha ─────────────────────────────────────────────────────
console.log('--- Busca e trilha ---');
eq(buscarPorTermoDeMercado('migrar')[0]?.destino.href, '/mudanca', '"migrar" leva ao assistente');
eq(buscarPorTermoDeMercado('glossário')[0]?.destino.href, '/mudanca/glossario', '"glossário" leva ao glossário');
eq(buscarPorTermoDeMercado('paridade')[0]?.destino.href, '/mudanca/paridade', '"paridade" leva ao checklist');
// Os itens e a busca do ⌘K moram em itens-da-busca.ts desde 14/11/2026 (por módulo).
const paleta = readFileSync(new URL('../src/components/itens-da-busca.ts', import.meta.url), 'utf8');
eq(['/mudanca\'', '/mudanca/glossario\'', '/mudanca/paridade\'', 'buscarNoGlossario('].every(t => paleta.includes(t)), true, 'a paleta ⌘K lista as três telas e busca no glossário');
eq(buildTrail('/mudanca/glossario').map(c => c.label), ['Configurações', 'Mudar para o EnturOS', 'Glossário'], 'trilha do glossário');
eq(buildTrail('/mudanca/paridade').map(c => c.label), ['Configurações', 'Mudar para o EnturOS', 'Checklist de paridade'], 'trilha do checklist');

// ─── Vocabulário nos arquivos novos ────────────────────────────────────────
console.log('--- Vocabulário ---');
const PROIBIDOS = [
  'lei kandir', 'cartao passagem', 'fornecimento', 'representacao', 'consulta global de log', 'resumo geral', 'grupos de usuario',
  'grupo de usuario', 'acesso total', 'taxa de servico oculta', 'taxa de servico destacada', 'saldo excluido', 'gerar lancamento',
  'parcelas adicionais', 'demonstrativo por categorias', 'lancamentos por', 'processar retorno', 'gerar remessa', 'reenviar remessa',
  'atualizar cambios', 'ignorar bloqueios',
];
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? arquivos(p) : /\.tsx?$/.test(p) ? [p] : []; });
}
const raiz = new URL('../src/', import.meta.url).pathname;
const novos = [
  join(raiz, 'lib/migracao/contrato-telas.ts'), ...arquivos(join(raiz, 'lib/migracao/telas')), ...arquivos(join(raiz, 'app/mudanca')),
];
eq(novos.length >= 15, true, `varre os arquivos novos (${novos.length})`);
const achados = novos.flatMap(p => PROIBIDOS.filter(t => norm(readFileSync(p, 'utf8')).includes(t)).map(t => `${p.split('/src/')[1]}: ${t}`));
eq(achados, [], 'nenhum termo proibido');

console.log(`\n${total - falhas}/${total} testes da mudança (telas) passaram`);
if (falhas > 0) process.exit(1);

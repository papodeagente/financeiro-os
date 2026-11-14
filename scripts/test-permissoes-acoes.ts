/**
 * Perfis de acesso, limites e aprovações: as regras puras (05/11/2026).
 *
 *  1. PORTEIRO — sem grupo e sem restrição, a decisão é exatamente a das
 *     funções de hoje (podeVerFinanceiro, podeEditarFinanceiro, podeExcluir,
 *     podeExportar, podeGerenciarUsuarios) para todo papel, inclusive os
 *     legados e o perfil gravado errado.
 *  2. TETO — grupo nunca dá o que o papel não tem; ADMIN nunca se bloqueia.
 *  3. Bloqueios, alçadas e quem decide pedido.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-permissoes-acoes.ts
 */
import {
  ACOES_FINANCEIRAS, acoesDoTeto, contasLiberadasPor, decidirAcao, listaDeAcoes, tetoDoPapel,
  type AcaoFinanceira, type RestricoesCarregadas,
} from '../src/lib/acoes-financeiras.ts';
import {
  podeEditarFinanceiro, podeExcluir, podeExportar, podeGerenciarUsuarios, podeVerFinanceiro,
  permissoesParaPerfil, bloqueioFinanceiro,
} from '../src/lib/permissoes.ts';
import { verificarBloqueios, normalizarBloqueios, BLOQUEIOS_PADRAO } from '../src/lib/bloqueios-financeiros.ts';
import { escolherAlcada, podeDecidirPedido, statusDepoisDaDecisao, jsonCanonico, normalizarAprovadores, type Alcada } from '../src/lib/aprovacoes.ts';
import { filtrarPorConta } from '../src/lib/filtro-de-conta.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const PERFIS = ['ADMIN', 'owner', 'OPERADOR', 'GERENTE', 'FINANCEIRO', 'VISUALIZADOR', 'VENDEDOR', 'COLABORADOR', '', 'INVENTADO'];
const MAPA: Partial<Record<AcaoFinanceira, (s: { perfil: string; isSuperAdmin?: boolean }) => boolean>> = {
  ver_financeiro: podeVerFinanceiro,
  editar_financeiro: podeEditarFinanceiro,
  excluir: podeExcluir,
  exportar: podeExportar,
  gerenciar_usuarios: podeGerenciarUsuarios,
};

console.log('--- 1. Porteiro: sem configuração, nada muda ---');
for (const perfil of PERFIS) {
  for (const superadmin of [false, true]) {
    const quem = { perfil, isSuperAdmin: superadmin };
    let iguais = 0;
    for (const a of ACOES_FINANCEIRAS) {
      const esperado = superadmin ? true : tetoDoPapel(perfil, a.id);
      if (decidirAcao(quem, a.id, null) === esperado) iguais++;
      const helper = MAPA[a.id];
      if (helper) eq(decidirAcao(quem, a.id, null), helper(quem), `${perfil || '(vazio)'}${superadmin ? '+super' : ''}: ${a.id} = função de hoje`);
    }
    eq(iguais, ACOES_FINANCEIRAS.length, `${perfil || '(vazio)'}${superadmin ? '+super' : ''}: todas as ações = teto do papel`);
    eq(contasLiberadasPor(quem, null), null, `${perfil || '(vazio)'}${superadmin ? '+super' : ''}: todas as contas`);
    // A guarda de rota de hoje continua dizendo o mesmo.
    eq(bloqueioFinanceiro({ perfil, isSuperAdmin: superadmin }, 'ler') === null, decidirAcao(quem, 'ver_financeiro', null), `${perfil || '(vazio)'}${superadmin ? '+super' : ''}: guarda de leitura igual`);
  }
}
eq(acoesDoTeto('VENDEDOR'), ['ver_proprias_comissoes'], 'vendedor: só as próprias comissões, nada de financeiro');
eq(acoesDoTeto('COLABORADOR'), [], 'colaborador: nada');
eq(acoesDoTeto('ADMIN').length, ACOES_FINANCEIRAS.length, 'administrador: tudo');
eq(acoesDoTeto('OPERADOR').includes('excluir') || acoesDoTeto('OPERADOR').includes('exportar'), false, 'operador continua sem excluir e sem exportar');
eq(permissoesParaPerfil('OPERADOR').ver_extrato_contas, [], 'campo antigo ver_extrato_contas fica como estava');

console.log('--- 2. Grupo e usuário só restringem, abaixo do teto ---');
const grupoCaixa: RestricoesCarregadas = { grupos: [{ id: 'g1', nome: 'Caixa', acesso_total: false, acoes: ['ver_financeiro', 'editar_financeiro', 'liquidar_receber', 'excluir', 'exportar'], contas: ['b1'] }], usuario: null };
const op = { perfil: 'OPERADOR' };
eq(decidirAcao(op, 'liquidar_receber', grupoCaixa), true, 'operador do grupo Caixa liquida a receber');
eq(decidirAcao(op, 'liquidar_pagar', grupoCaixa), false, 'mas não liquida a pagar (fora do grupo)');
eq(decidirAcao(op, 'excluir', grupoCaixa), false, 'grupo marcando "excluir" não dá exclusão a operador (teto)');
eq(decidirAcao(op, 'exportar', grupoCaixa), false, 'nem exportação');
eq(decidirAcao({ perfil: 'VENDEDOR' }, 'ver_financeiro', grupoCaixa), false, 'vendedor nunca ganha financeiro');
eq(decidirAcao({ perfil: 'ADMIN' }, 'liquidar_pagar', grupoCaixa), true, 'administrador nunca se bloqueia');
eq(contasLiberadasPor({ perfil: 'ADMIN' }, grupoCaixa), null, 'administrador vê todas as contas');
eq(contasLiberadasPor(op, grupoCaixa), ['b1'], 'operador do grupo vê só a conta liberada');
eq(decidirAcao(op, 'liquidar_receber', grupoCaixa, { contaBancariaId: 'b2' }), false, 'liquidar numa conta não liberada: não');
eq(decidirAcao(op, 'liquidar_receber', grupoCaixa, { contaBancariaId: 'b1' }), true, 'na conta liberada: sim');
const doisGrupos: RestricoesCarregadas = { grupos: [grupoCaixa.grupos[0], { id: 'g2', nome: 'Pagar', acesso_total: false, acoes: ['liquidar_pagar'], contas: ['b2'] }], usuario: null };
eq(decidirAcao(op, 'liquidar_pagar', doisGrupos), true, 'dois grupos: vale a soma dos direitos');
eq(contasLiberadasPor(op, doisGrupos), ['b1', 'b2'], 'e a soma das contas');
const comTotal: RestricoesCarregadas = { grupos: [{ id: 'g3', nome: 'Gerência', acesso_total: true, acoes: [], contas: ['b9'] }], usuario: null };
eq(decidirAcao(op, 'aprovar_pagamento', comTotal), true, 'acesso completo = tudo do teto');
eq(decidirAcao(op, 'aprovar_excecao', comTotal), false, 'mas não passa do teto (aprovar exceção é do administrador)');
eq(contasLiberadasPor(op, comTotal), null, 'acesso completo não restringe contas');
const soUsuario: RestricoesCarregadas = { grupos: [], usuario: { contas_liberadas: ['b1'], acoes_negadas: ['transferir'] } };
eq(decidirAcao(op, 'transferir', soUsuario), false, 'restrição do usuário nega a ação');
eq(decidirAcao(op, 'liquidar_pagar', soUsuario), true, 'sem grupo, o resto segue o papel');
eq(contasLiberadasPor(op, soUsuario), ['b1'], 'e as contas ficam só as liberadas para ele');
const grupoEUsuario: RestricoesCarregadas = { grupos: doisGrupos.grupos, usuario: { contas_liberadas: ['b2', 'b3'], acoes_negadas: [] } };
eq(contasLiberadasPor(op, grupoEUsuario), ['b2'], 'grupo e usuário: vale a interseção');
eq(listaDeAcoes(['liquidar_pagar', 'inventada', 'liquidar_pagar', 7]), ['liquidar_pagar'], 'ação desconhecida é descartada');

console.log('--- 3. Filtro de contas nas listas ---');
const linhas = [
  { id: 'cp1', status: 'PAGO', conta_bancaria_id: 'b1' },
  { id: 'cp2', status: 'PAGO', conta_bancaria_id: 'b2' },
  { id: 'cp3', status: 'PENDENTE', conta_bancaria_id: 'b2' },
  { id: 'cp4', status: 'PAGO', conta_bancaria_id: '' },
];
eq(filtrarPorConta(linhas, { campos: ['conta_bancaria_id'], soBaixados: true }, null).length, 4, 'sem restrição: lista igual');
eq(filtrarPorConta(linhas, { campos: ['conta_bancaria_id'], soBaixados: true }, ['b1']).map(l => l.id), ['cp1', 'cp3', 'cp4'], 'pago em conta não liberada some; em aberto fica');
eq(filtrarPorConta([{ id: 'b1' }, { id: 'b2' }], { cadastro: true }, ['b2']).map(l => l.id), ['b2'], 'cadastro de contas: só as liberadas');
eq(filtrarPorConta([{ id: 't1', conta_origem_id: 'b1', conta_destino_id: 'b2' }], { campos: ['conta_origem_id', 'conta_destino_id'] }, ['b1']).length, 0, 'transferência que toca conta não liberada some');

console.log('--- 4. Bloqueios ---');
const hoje = '2026-11-05';
eq(verificarBloqueios({ config: undefined, hoje, desconto: 10_000 }).ok, true, 'sem configuração: nada bloqueia');
eq(normalizarBloqueios({}), BLOQUEIOS_PADRAO, 'configuração vazia = padrão desligado');
const cfg = { desconto_max_reais: 50, desconto_max_pct: 10, retroagir_dias_max: 3, vencimento: 'so_adiantar', vencimento_dias_max: 30 };
eq(verificarBloqueios({ config: cfg, hoje, desconto: 50, valor_base: 1000 }).ok, true, 'desconto igual ao limite passa');
const d = verificarBloqueios({ config: cfg, hoje, desconto: 50.01, valor_base: 1000 });
eq([d.ok, !d.ok && d.violacoes], [false, ['desconto']], 'um centavo acima do limite pede aprovação');
eq(!d.ok && d.exigeAprovacao, true, 'resultado diz exigeAprovacao');
eq(!d.ok && d.motivo.includes('R$'), true, 'motivo em reais');
eq(verificarBloqueios({ config: { ...cfg, desconto_max_reais: null }, hoje, desconto: 100.01, valor_base: 1000 }).ok, false, 'desconto acima de 10% pede aprovação');
eq(verificarBloqueios({ config: { ...cfg, desconto_max_reais: null }, hoje, desconto: 100, valor_base: 1000 }).ok, true, 'exatamente 10% passa');
eq(verificarBloqueios({ config: cfg, hoje, acrescimo: 60 }).ok, false, 'acréscimo acima do limite também');
eq(verificarBloqueios({ config: cfg, hoje, data_movimentacao: '2026-11-02' }).ok, true, 'retroagir 3 dias passa');
eq(verificarBloqueios({ config: cfg, hoje, data_movimentacao: '2026-11-01' }).ok, false, 'retroagir 4 dias pede aprovação');
eq(verificarBloqueios({ config: cfg, hoje, vencimento_atual: '2026-11-10', vencimento_novo: '2026-11-08' }).ok, true, 'só adiantar: adiantar passa');
eq(verificarBloqueios({ config: cfg, hoje, vencimento_atual: '2026-11-10', vencimento_novo: '2026-11-11' }).ok, false, 'só adiantar: adiar pede aprovação');
eq(verificarBloqueios({ config: { ...cfg, vencimento: 'livre' }, hoje, vencimento_atual: '2026-11-10', vencimento_novo: '2026-12-11' }).ok, false, 'livre com limite: 31 dias pede aprovação');
eq(verificarBloqueios({ config: { ...cfg, vencimento: 'aprovacao' }, hoje, vencimento_atual: '2026-11-10', vencimento_novo: '2026-11-09' }).ok, false, 'sempre com aprovação: qualquer mudança');
eq(verificarBloqueios({ config: cfg, hoje, desconto: 999, dispensaAprovacao: true }).ok, true, 'quem aprova exceções lança sem pedido');
eq(normalizarBloqueios({ desconto_max_reais: '-5', retroagir_dias_max: 'x', vencimento: 'qualquer' }), BLOQUEIOS_PADRAO, 'lixo vira desligado, nunca bloqueio absurdo');

console.log('--- 5. Alçadas e quem decide ---');
const alc = (x: Partial<Alcada>): Alcada => ({ id: 'a', nome: '', prioridade: 10, ativo: true, categoria_id: null, centro_custo: null, valor_min_centavos: null, valor_max_centavos: null, aprovadores: [], niveis: 1, ...x });
const alcadas = [alc({ id: 'grande', prioridade: 20, valor_min_centavos: 500_000 }), alc({ id: 'marketing', prioridade: 10, categoria_id: 'cat-mkt', valor_min_centavos: 100_000 })];
eq(escolherAlcada(alcadas, { valor_centavos: 499_999 })?.id ?? null, null, 'abaixo de R$ 5.000 sem categoria: sem alçada');
eq(escolherAlcada(alcadas, { valor_centavos: 500_000 })?.id, 'grande', 'a partir de R$ 5.000: alçada geral');
eq(escolherAlcada(alcadas, { valor_centavos: 600_000, categoria_id: 'cat-mkt' })?.id, 'marketing', 'prioridade menor ganha');
eq(escolherAlcada([alc({ ativo: false })], { valor_centavos: 1 }), null, 'alçada desligada não vale');
const pedido = { status: 'PENDENTE' as const, solicitante_id: 'u1', aprovadores: [] as string[], decisoes: [], expira_em: '2099-01-01T00:00:00Z' };
eq(podeDecidirPedido(pedido, { id: 'u1', perfil: 'ADMIN', grupos: [], temDireito: true }).ok, false, 'quem pediu não aprova o próprio (nem administrador)');
eq(podeDecidirPedido(pedido, { id: 'u2', perfil: 'OPERADOR', grupos: [], temDireito: false }).ok, false, 'sem o direito, não decide');
eq(podeDecidirPedido(pedido, { id: 'u2', perfil: 'OPERADOR', grupos: [], temDireito: true }).ok, true, 'outra pessoa com o direito decide');
eq(podeDecidirPedido({ ...pedido, aprovadores: ['grupo:g9'] }, { id: 'u2', perfil: 'OPERADOR', grupos: [], temDireito: true }).ok, false, 'aprovador fora da lista não decide');
eq(podeDecidirPedido({ ...pedido, aprovadores: ['grupo:g9'] }, { id: 'u2', perfil: 'OPERADOR', grupos: ['g9'], temDireito: true }).ok, true, 'membro do grupo aprovador decide');
eq(podeDecidirPedido({ ...pedido, aprovadores: ['papel:ADMIN'] }, { id: 'u3', perfil: 'owner', grupos: [], temDireito: true }).ok, true, 'papel:ADMIN casa com o dono da conta');
eq(podeDecidirPedido({ ...pedido, expira_em: '2000-01-01T00:00:00Z' }, { id: 'u2', grupos: [], temDireito: true }).ok, false, 'pedido vencido não se decide');
eq(statusDepoisDaDecisao({ niveis: 2, decisoes: [] }, 'aprovar'), 'PENDENTE', 'dois níveis: a primeira aprovação não basta');
eq(statusDepoisDaDecisao({ niveis: 2, decisoes: [{ usuario_id: 'u2', usuario_nome: '', decisao: 'aprovar', motivo: '', em: '' }] }, 'aprovar'), 'APROVADO', 'a segunda aprova');
eq(statusDepoisDaDecisao({ niveis: 2, decisoes: [] }, 'recusar'), 'RECUSADO', 'uma recusa encerra');
eq(jsonCanonico({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}', 'JSON canônico ordena as chaves');
eq(normalizarAprovadores(['usuario:u1', 'grupo:g1', 'papel:ADMIN', 'papel:DONO', 'x', 'usuario:u1']), ['usuario:u1', 'grupo:g1', 'papel:ADMIN'], 'aprovadores: só formatos conhecidos, sem repetição');

console.log(`\n${total - falhas}/${total} testes de permissões passaram`);
if (falhas > 0) process.exit(1);

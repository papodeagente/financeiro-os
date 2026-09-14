/**
 * Filtro da tela de clientes com cliente vindo do CRM.
 *
 * O incidente: digitar qualquer letra na busca derrubava /pessoas/clientes
 * com "Algo deu errado". O filtro fazia `c.nome_completo.toLowerCase()`, e
 * cliente gravado pelo webhook do CRM não tem esse campo — tem `nome`. Com a
 * busca vazia o `!q` protegia, então o erro só aparecia ao usar o filtro.
 *
 * O segundo defeito era silencioso e pior: `c.tipo === 'PF'` nunca casava com
 * o 'fisica' que o CRM grava, e o filtro por tipo devolvia lista vazia sem
 * dizer nada.
 *
 * Roda com: node --experimental-strip-types scripts/test-filtro-clientes.ts
 */
import { nomeDoCliente, documentoDoCliente, tipoPessoa } from '../src/lib/cliente-nome.ts';

let falhas = 0;
let total = 0;

function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}

type Any = Record<string, unknown>;

/**
 * Mesma expressão que a tela usa. Se mudar lá, muda aqui: é a única forma de
 * este teste continuar protegendo o caminho real.
 */
const texto = (v: unknown) => String(v ?? '').toLowerCase();

function filtrar(
  clientes: Any[],
  busca: string,
  filterTipo: '' | 'PF' | 'PJ',
  filterStatus: '' | 'ATIVO' | 'INATIVO',
): Any[] {
  return clientes.filter(c => {
    const q = busca.trim().toLowerCase();
    const matchSearch =
      !q ||
      texto(nomeDoCliente(c)).includes(q) ||
      texto(documentoDoCliente(c)).includes(q) ||
      texto(c.nome_completo).includes(q) ||
      texto(c.nome_fantasia).includes(q) ||
      texto(c.cpf).includes(q) ||
      texto(c.cnpj).includes(q) ||
      texto(c.email).includes(q);
    const matchTipo = !filterTipo || tipoPessoa(c.tipo as string) === filterTipo;
    const matchStatus = !filterStatus || String(c.status ?? 'ATIVO') === filterStatus;
    return matchSearch && matchTipo && matchStatus;
  });
}

// Shape que o webhook do CRM grava: nome, tipo 'fisica', sem mais nada.
const doCrm: Any = { id: 'c1', nome: 'Esla Silva de Jesus', tipo: 'fisica', cpf_cnpj: '91227399553' };
// Shape do cadastro manual, completo.
const manual: Any = {
  id: 'c2', nome_completo: 'Bruno Barbosa da Silva', nome_fantasia: '', tipo: 'PF',
  cpf: '12345678901', cnpj: '', email: 'bruno@entur.com.br', status: 'ATIVO',
};
const pj: Any = {
  id: 'c3', nome_completo: '', nome_fantasia: 'Cativa Turismo', tipo: 'PJ',
  cpf: '', cnpj: '11222333000181', email: '', status: 'INATIVO',
};
const TODOS = [doCrm, manual, pj];

// ══════════════════════════════════════════════════════════════════════
console.log('--- buscar não derruba a tela ---');
{
  // O caso do incidente: uma letra na busca com cliente do CRM na lista.
  const r = filtrar(TODOS, 'e', '', '');
  eq(Array.isArray(r), true, 'buscar com cliente do CRM na lista não lança');
}
{
  eq(filtrar(TODOS, 'esla', '', '').map(c => c.id), ['c1'], 'acha o cliente do CRM pelo nome');
  eq(filtrar(TODOS, 'bruno', '', '').map(c => c.id), ['c2'], 'acha o manual pelo nome completo');
  eq(filtrar(TODOS, 'cativa', '', '').map(c => c.id), ['c3'], 'acha a PJ pelo nome fantasia');
}
{
  eq(filtrar(TODOS, '912273', '', '').map(c => c.id), ['c1'], 'acha pelo documento do CRM');
  eq(filtrar(TODOS, '123456789', '', '').map(c => c.id), ['c2'], 'acha pelo CPF');
  eq(filtrar(TODOS, '11222333', '', '').map(c => c.id), ['c3'], 'acha pelo CNPJ');
  eq(filtrar(TODOS, 'entur.com', '', '').map(c => c.id), ['c2'], 'acha pelo e-mail');
}
{
  eq(filtrar(TODOS, '   ', '', '').length, 3, 'busca só com espaço devolve todos');
  eq(filtrar(TODOS, 'zzz', '', ''), [], 'termo sem correspondência devolve vazio');
}
{
  // Cliente sem campo nenhum além do id não pode derrubar a busca.
  const vazio: Any = { id: 'c9' };
  eq(Array.isArray(filtrar([vazio], 'a', '', '')), true, 'cliente sem campos não lança');
  eq(filtrar([vazio], 'a', '', ''), [], 'e não casa com nada');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- filtro por tipo entende o dialeto do CRM ---');
{
  // O defeito silencioso: 'fisica' nunca casava com 'PF'.
  eq(filtrar(TODOS, '', 'PF', '').map(c => c.id), ['c1', 'c2'], 'PF pega o do CRM e o manual');
  eq(filtrar(TODOS, '', 'PJ', '').map(c => c.id), ['c3'], 'PJ pega só a jurídica');
}
{
  const juridicaCrm: Any = { id: 'c4', nome: 'Sakura Ltda', tipo: 'juridica' };
  eq(filtrar([juridicaCrm], '', 'PJ', '').map(c => c.id), ['c4'], "'juridica' do CRM é PJ");
  eq(filtrar([juridicaCrm], '', 'PF', ''), [], 'e não aparece em PF');
}
{
  const semTipo: Any = { id: 'c5', nome: 'Sem tipo' };
  eq(filtrar([semTipo], '', 'PF', '').map(c => c.id), ['c5'], 'sem tipo cai em PF, que é o padrão');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- filtro por status não some com quem nunca teve status ---');
{
  // Cliente do CRM chega sem status: sumir de "Ativo" seria puni-lo por um
  // campo que ele nunca teve como responder.
  eq(filtrar(TODOS, '', '', 'ATIVO').map(c => c.id), ['c1', 'c2'], 'sem status conta como ativo');
  eq(filtrar(TODOS, '', '', 'INATIVO').map(c => c.id), ['c3'], 'inativo só quem é');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- filtros combinados ---');
{
  eq(filtrar(TODOS, 'a', 'PF', 'ATIVO').map(c => c.id).sort(), ['c1', 'c2'], 'busca + tipo + status');
  eq(filtrar(TODOS, 'esla', 'PJ', ''), [], 'combinação sem resultado não quebra');
  eq(filtrar([], 'qualquer', 'PF', 'ATIVO'), [], 'lista vazia devolve vazia');
}

// ══════════════════════════════════════════════════════════════════════
console.log(`\n${total - falhas}/${total} testes do filtro de clientes passaram`);
if (falhas > 0) process.exit(1);

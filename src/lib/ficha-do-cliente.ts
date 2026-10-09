/**
 * A ficha do cliente que vem do CRM (Bruno, 09/10/2026): "no cadastro do
 * cliente, mostre todas as informações padrões captadas no CRM".
 *
 * Três partes, todas puras:
 *  - lerFichaDoCrm: o `cliente_ficha` do evento, saneado (texto aparado,
 *    listas sem item vazio, nunca undefined);
 *  - aplicarFichaDoCrm: copia para os campos que o cadastro daqui já tem
 *    (nascimento, estado civil, passaporte, endereço, segundo telefone,
 *    marcadores) e guarda a ficha inteira em `crm_ficha`. Venda fechada só
 *    PREENCHE; mudança de cadastro no CRM SOBRESCREVE; vazio nunca apaga;
 *  - secoesDaFicha: o que a tela mostra, agrupado, só com o que tem valor.
 */
import type { FichaClienteCRM } from './crm-types';

const t = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function passaporte(v: unknown) {
  const p = obj(v);
  return { numero: t(p.numero), validade: t(p.validade), pais_emissor: t(p.pais_emissor) };
}

/** O `cliente_ficha` do evento, ou null quando o CRM não mandou (versão anterior). */
export function lerFichaDoCrm(v: unknown): FichaClienteCRM | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const f = v as Record<string, unknown>;
  const e = obj(f.endereco);
  const c = f.conjuge && typeof f.conjuge === 'object' ? obj(f.conjuge) : null;
  return {
    data_nascimento: t(f.data_nascimento),
    data_casamento: t(f.data_casamento),
    telefones_adicionais: lista(f.telefones_adicionais)
      .map(x => ({ numero: t(obj(x).numero), rotulo: t(obj(x).rotulo) }))
      .filter(x => x.numero),
    endereco: {
      cep: t(e.cep), logradouro: t(e.logradouro), numero: t(e.numero), complemento: t(e.complemento),
      bairro: t(e.bairro), cidade: t(e.cidade), estado: t(e.estado), pais: t(e.pais),
    },
    passaporte: passaporte(f.passaporte),
    estado_civil: t(f.estado_civil),
    conjuge: c && t(c.nome)
      ? { nome: t(c.nome), cpf: t(c.cpf), data_nascimento: t(c.data_nascimento), passaporte: passaporte(c.passaporte) }
      : null,
    filhos: lista(f.filhos)
      .map(x => {
        const o = obj(x);
        return { nome: t(o.nome), cpf: t(o.cpf), data_nascimento: t(o.data_nascimento), passaporte_numero: t(o.passaporte_numero), passaporte_validade: t(o.passaporte_validade) };
      })
      .filter(x => x.nome),
    profissao: t(f.profissao),
    site: t(f.site),
    mes_de_ferias: t(f.mes_de_ferias),
    origem: t(f.origem),
    etiquetas: Array.from(new Set(lista(f.etiquetas).map(t).filter(Boolean))),
    responsavel: t(f.responsavel),
  };
}

/** Campo do cadastro daqui ← valor da ficha. */
function copias(f: FichaClienteCRM): Array<[campo: string, valor: string, rotulo: string]> {
  return [
    // Nascimento só com ano: o campo daqui é uma data inteira.
    ['data_nascimento', /^\d{4}-\d{2}-\d{2}$/.test(f.data_nascimento) ? f.data_nascimento : '', 'nascimento'],
    ['estado_civil', f.estado_civil, 'estado civil'],
    ['passaporte', f.passaporte.numero, 'passaporte'],
    ['validade_passaporte', f.passaporte.validade, 'passaporte'],
    ['cep', f.endereco.cep, 'endereço'],
    ['logradouro', f.endereco.logradouro, 'endereço'],
    ['numero', f.endereco.numero, 'endereço'],
    ['complemento', f.endereco.complemento, 'endereço'],
    ['bairro', f.endereco.bairro, 'endereço'],
    ['cidade', f.endereco.cidade, 'endereço'],
    ['estado', f.endereco.estado, 'endereço'],
    ['pais', f.endereco.pais, 'endereço'],
    ['telefone_secundario', f.telefones_adicionais[0]?.numero ?? '', 'telefone'],
  ];
}

/** Junta a ficha nova na guardada: o que veio com valor vale (ou só preenche), vazio não apaga. */
function juntarFichas(antes: FichaClienteCRM | null, nova: FichaClienteCRM, sobrescrever: boolean): FichaClienteCRM {
  if (!antes) return nova;
  const escolher = (a: string, b: string) => (b && (sobrescrever || !a) ? b : a);
  const escolherLista = <T,>(a: T[], b: T[]) => (b.length > 0 && (sobrescrever || a.length === 0) ? b : a);
  const pass = (a: FichaClienteCRM['passaporte'], b: FichaClienteCRM['passaporte']) => ({
    numero: escolher(a.numero, b.numero), validade: escolher(a.validade, b.validade), pais_emissor: escolher(a.pais_emissor, b.pais_emissor),
  });
  const conjuge = nova.conjuge && (sobrescrever || !antes.conjuge)
    ? (antes.conjuge
      ? {
          nome: escolher(antes.conjuge.nome, nova.conjuge.nome), cpf: escolher(antes.conjuge.cpf, nova.conjuge.cpf),
          data_nascimento: escolher(antes.conjuge.data_nascimento, nova.conjuge.data_nascimento),
          passaporte: pass(antes.conjuge.passaporte, nova.conjuge.passaporte),
        }
      : nova.conjuge)
    : antes.conjuge;
  const end = antes.endereco, ne = nova.endereco;
  return {
    data_nascimento: escolher(antes.data_nascimento, nova.data_nascimento),
    data_casamento: escolher(antes.data_casamento, nova.data_casamento),
    telefones_adicionais: escolherLista(antes.telefones_adicionais, nova.telefones_adicionais),
    endereco: {
      cep: escolher(end.cep, ne.cep), logradouro: escolher(end.logradouro, ne.logradouro), numero: escolher(end.numero, ne.numero),
      complemento: escolher(end.complemento, ne.complemento), bairro: escolher(end.bairro, ne.bairro),
      cidade: escolher(end.cidade, ne.cidade), estado: escolher(end.estado, ne.estado), pais: escolher(end.pais, ne.pais),
    },
    passaporte: pass(antes.passaporte, nova.passaporte),
    estado_civil: escolher(antes.estado_civil, nova.estado_civil),
    conjuge,
    filhos: escolherLista(antes.filhos, nova.filhos),
    profissao: escolher(antes.profissao, nova.profissao),
    site: escolher(antes.site, nova.site),
    mes_de_ferias: escolher(antes.mes_de_ferias, nova.mes_de_ferias),
    origem: escolher(antes.origem, nova.origem),
    etiquetas: Array.from(new Set([...antes.etiquetas, ...nova.etiquetas])),
    responsavel: escolher(antes.responsavel, nova.responsavel),
  };
}

/**
 * Aplica a ficha do CRM ao `data` do cadastro. `sobrescrever` false é venda
 * fechada (só preenche); true é mudança de cadastro no CRM. Devolve o data
 * novo e o nome do que mudou (para o histórico da integração).
 */
export function aplicarFichaDoCrm(
  atual: Record<string, unknown>,
  ficha: FichaClienteCRM | null,
  sobrescrever: boolean,
): { data: Record<string, unknown>; campos: string[] } {
  if (!ficha) return { data: atual, campos: [] };
  const data: Record<string, unknown> = { ...atual };
  const campos: string[] = [];
  const marcar = (c: string) => { if (!campos.includes(c)) campos.push(c); };

  for (const [campo, valor, rotulo] of copias(ficha)) {
    if (!valor) continue;
    const agora = t(data[campo]);
    if (agora === valor) continue;
    if (sobrescrever || !agora) { data[campo] = valor; marcar(rotulo); }
  }

  // Etiquetas do CRM entram nos marcadores; as daqui nunca saem.
  const marcadores = lista(data.marcadores).map(t).filter(Boolean);
  const novas = ficha.etiquetas.filter(e => !marcadores.some(m => m.toLowerCase() === e.toLowerCase()));
  if (novas.length > 0) { data.marcadores = [...marcadores, ...novas]; marcar('etiquetas'); }

  const antes = data.crm_ficha ? lerFichaDoCrm(data.crm_ficha) : null;
  const junta = juntarFichas(antes, ficha, sobrescrever);
  if (JSON.stringify(antes) !== JSON.stringify(junta)) {
    data.crm_ficha = junta;
    if (campos.length === 0) marcar('ficha do CRM');
  }
  return { data, campos };
}

// ---------------------------------------------------------------------------
// A tela
// ---------------------------------------------------------------------------

export interface ItemDaFicha { rotulo: string; valor: string }
export interface SecaoDaFicha { titulo: string; itens: ItemDaFicha[] }

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "1985-03-21" → "21/03/1985"; "03-21" → "21 de março". */
export function dataDaFicha(v: string): string {
  const s = t(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = s.match(/^(\d{2})-(\d{2})$/);
  if (m) {
    const mes = MESES[Number(m[1]) - 1];
    return mes ? `${Number(m[2])} de ${mes}` : s;
  }
  return s;
}

const ESTADO_CIVIL: Record<string, string> = {
  solteiro: 'Solteiro(a)', solteira: 'Solteiro(a)', casado: 'Casado(a)', casada: 'Casado(a)',
  divorciado: 'Divorciado(a)', divorciada: 'Divorciado(a)', viuvo: 'Viúvo(a)', viuva: 'Viúvo(a)',
  uniao_estavel: 'União estável', 'união estável': 'União estável', separado: 'Separado(a)',
};

function passaporteTexto(p: { numero: string; validade: string; pais_emissor?: string }): string {
  if (!p.numero) return '';
  const partes = [p.numero];
  if (p.validade) partes.push(`válido até ${dataDaFicha(p.validade)}`);
  if (p.pais_emissor) partes.push(p.pais_emissor);
  return partes.join(' · ');
}

/**
 * O que a ficha mostra: o cadastro daqui primeiro (é o que a pessoa edita) e,
 * no que ele não tem, a ficha do CRM. Seção sem nada não aparece.
 */
export function secoesDaFicha(c: Record<string, unknown>): SecaoDaFicha[] {
  const f = c.crm_ficha ? lerFichaDoCrm(c.crm_ficha) : null;
  const v = (campo: string, daFicha = '') => t(c[campo]) || daFicha;
  const item = (rotulo: string, valor: string): ItemDaFicha | null => (valor ? { rotulo, valor } : null);
  const so = (xs: Array<ItemDaFicha | null>) => xs.filter((x): x is ItemDaFicha => x !== null);

  const telefones = [
    t(c.telefone_principal) || t(c.telefone),
    t(c.whatsapp),
    t(c.telefone_secundario),
    ...(f?.telefones_adicionais ?? []).map(x => (x.rotulo ? `${x.numero} (${x.rotulo})` : x.numero)),
  ].filter(Boolean);
  // O mesmo número aparece com e sem 55, com e sem o nono dígito: os últimos 8 dizem quem é.
  const vistos = new Set<string>();
  const unicos = telefones.filter(x => {
    const k = x.replace(/\D/g, '').slice(-8) || x;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });

  const end = {
    logradouro: v('logradouro', f?.endereco.logradouro), numero: v('numero', f?.endereco.numero),
    complemento: v('complemento', f?.endereco.complemento), bairro: v('bairro', f?.endereco.bairro),
    cidade: v('cidade', f?.endereco.cidade), estado: v('estado', f?.endereco.estado),
    cep: v('cep', f?.endereco.cep), pais: v('pais', f?.endereco.pais),
  };
  const linha1 = [end.logradouro, end.numero].filter(Boolean).join(', ') + (end.complemento ? ` · ${end.complemento}` : '');
  const linha2 = [end.bairro, [end.cidade, end.estado].filter(Boolean).join('/')].filter(Boolean).join(' · ');

  const nascimento = v('data_nascimento') || f?.data_nascimento || '';
  const estadoCivil = v('estado_civil', f?.estado_civil);
  const empresa = obj(c.empresa);

  const secoes: SecaoDaFicha[] = [
    {
      titulo: 'Contato',
      itens: so([
        item(unicos.length > 1 ? 'Telefones' : 'Telefone', unicos.join(' · ')),
        item('E-mail', [t(c.email), t(c.email_secundario)].filter(Boolean).join(' · ')),
        item('Site', f?.site ?? ''),
      ]),
    },
    {
      titulo: 'Pessoal',
      itens: so([
        item('Nascimento', nascimento ? dataDaFicha(nascimento) : ''),
        item('Estado civil', ESTADO_CIVIL[estadoCivil.toLowerCase()] ?? estadoCivil),
        item('Casamento', f?.data_casamento ? dataDaFicha(f.data_casamento) : ''),
        item('Profissão', f?.profissao ?? ''),
        item('Empresa', [t(empresa.nome), t(empresa.cnpj)].filter(Boolean).join(' · ')),
        item('Mês de férias', f?.mes_de_ferias ?? ''),
      ]),
    },
    {
      titulo: 'Endereço',
      itens: so([
        item('Endereço', linha1),
        item('Bairro e cidade', linha2),
        item('CEP', end.cep),
        item('País', end.pais),
      ]),
    },
    {
      titulo: 'Documentos de viagem',
      itens: so([
        item('Passaporte', passaporteTexto({
          numero: v('passaporte', f?.passaporte.numero),
          validade: v('validade_passaporte', f?.passaporte.validade),
          pais_emissor: f?.passaporte.pais_emissor ?? '',
        })),
      ]),
    },
    {
      titulo: 'Família',
      itens: so([
        f?.conjuge
          ? item('Cônjuge', [
              f.conjuge.nome,
              f.conjuge.data_nascimento ? `nasceu em ${dataDaFicha(f.conjuge.data_nascimento)}` : '',
              passaporteTexto(f.conjuge.passaporte) ? `passaporte ${passaporteTexto(f.conjuge.passaporte)}` : '',
            ].filter(Boolean).join(' · '))
          : null,
        ...(f?.filhos ?? []).map(fi => item('Filho(a)', [
          fi.nome,
          fi.data_nascimento ? `nasceu em ${dataDaFicha(fi.data_nascimento)}` : '',
          fi.passaporte_numero ? `passaporte ${passaporteTexto({ numero: fi.passaporte_numero, validade: fi.passaporte_validade })}` : '',
        ].filter(Boolean).join(' · '))),
      ]),
    },
    {
      titulo: 'No CRM',
      itens: so([
        item('Responsável', f?.responsavel ?? ''),
        item('Origem', f?.origem ?? ''),
        item('Etiquetas', (f?.etiquetas.length ? f.etiquetas : lista(c.marcadores).map(t).filter(Boolean)).join(', ')),
      ]),
    },
  ];
  return secoes.filter(s => s.itens.length > 0);
}

/**
 * "Lançar pelo voucher" (E7, fechamento): o lado do servidor.
 *
 *  - A LEITURA fica guardada em leituras_de_documento (a mesma tabela, o
 *    mesmo limite por hora e a mesma reserva do "Ler boleto ou nota"), com a
 *    chave `voucher:<hash>`: o mesmo documento de novo não chama a IA.
 *  - CLIENTE: casa pelo CPF/CNPJ; sem documento igual, pelo nome só quando um
 *    único cadastro tem esse nome. Nada é criado.
 *  - FORNECEDOR: o mesmo caminho de identidade do cadastro (CNPJ pelos
 *    dígitos; nome só quando é único e o documento não se contradiz), pelo
 *    `sugestoesParaLeitura` do boleto. Nada é criado.
 *
 * Não importa nada do Next, para os testes rodarem contra um Postgres real.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { sugestoesParaLeitura } from './leitura-documento-servidor';
import {
  fornecedoresDoVoucher, rascunhoDoVoucher, textoComparavel,
  type CasamentosDoVoucher, type RascunhoDoVoucher, type VoucherLido,
} from './venda-voucher';

export type OrigemDoVoucher = 'pdf' | 'imagem' | 'email';

/** O que fica guardado da leitura (no campo `extracao`). */
export interface VoucherGuardado {
  voucher: VoucherLido;
  origem: OrigemDoVoucher;
  nome: string;
  /** E-mail: campos cujo trecho citado não estava no texto (foram esvaziados). */
  descartados: number;
}

export function chaveDoVoucher(hash: string): string {
  return `voucher:${hash}`;
}

/** Só o hash (64 letras hexadecimais) vale como chave pedida pela tela. */
export function hashValido(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
}

export async function lerVoucherGuardado(exec: ExecutorSQL, tenantId: string, hash: string): Promise<VoucherGuardado | null> {
  const { rows } = await exec.query(
    `SELECT extracao FROM leituras_de_documento WHERE tenant_id = $1 AND hash = $2 AND estado = 'pronto'`,
    [tenantId, chaveDoVoucher(hash)],
  );
  const g = rows[0]?.extracao as VoucherGuardado | undefined;
  if (!g || !g.voucher || !Array.isArray(g.voucher.produtos)) return null;
  return g;
}

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

async function acharCliente(exec: ExecutorSQL, tenantId: string, nome: string, documento: string): Promise<CasamentosDoVoucher['cliente']> {
  const docSql = `regexp_replace(COALESCE(NULLIF(cpf_cnpj, ''), data->>'cpf', data->>'cnpj', data->>'cpf_cnpj', ''), '\\D', '', 'g')`;
  const nomeSql = `COALESCE(NULLIF(nome, ''), data->>'nome', data->>'nome_completo', data->>'razao_social', '')`;
  if (documento) {
    const { rows } = await exec.query(
      `SELECT id, ${nomeSql} AS nome FROM clientes WHERE tenant_id = $1 AND ${docSql} = $2 ORDER BY created_at, id LIMIT 1`,
      [tenantId, documento],
    );
    if (rows[0]) return { id: txt(rows[0].id), nome: txt(rows[0].nome) || nome, documento, como: 'documento' };
  }
  if (!nome) return null;
  const alvo = textoComparavel(nome);
  if (alvo.length < 5) return null;
  const { rows } = await exec.query(
    `SELECT id, ${nomeSql} AS nome, ${docSql} AS doc FROM clientes WHERE tenant_id = $1 ORDER BY created_at, id LIMIT 50000`,
    [tenantId],
  );
  const iguais = rows.filter(r => textoComparavel(txt(r.nome)) === alvo);
  // Dois cadastros com o mesmo nome: não escolhe por ninguém.
  if (iguais.length !== 1) return null;
  const doc = txt(iguais[0].doc);
  // O documento lido contradiz o do cadastro: não é a mesma pessoa.
  if (documento && doc && doc !== documento) return null;
  return { id: txt(iguais[0].id), nome: txt(iguais[0].nome), ...(doc ? { documento: doc } : {}), como: 'nome' };
}

/** Procura no cadastro o cliente e os fornecedores lidos. Só lê. */
export async function casarVoucher(exec: ExecutorSQL, tenantId: string, lido: VoucherLido): Promise<CasamentosDoVoucher> {
  const cliente = await acharCliente(exec, tenantId, lido.cliente_nome.valor, lido.cliente_documento.valor);
  const fornecedores: CasamentosDoVoucher['fornecedores'] = {};
  for (const f of fornecedoresDoVoucher(lido)) {
    const s = await sugestoesParaLeitura(exec, tenantId, { nome: f.nome, documento: f.documento });
    if (s.fornecedor) {
      fornecedores[f.chave] = {
        id: s.fornecedor.id, nome: s.fornecedor.nome, ...(s.fornecedor.documento ? { documento: s.fornecedor.documento } : {}),
        como: s.fornecedor.como === 'documento' ? 'documento' : 'nome',
      };
    }
  }
  return { cliente, fornecedores };
}

/** A leitura guardada → o rascunho de agora (com o cadastro de agora). */
export async function rascunhoDaLeitura(
  exec: ExecutorSQL, tenantId: string, guardado: VoucherGuardado, hoje: string,
): Promise<RascunhoDoVoucher> {
  const r = rascunhoDoVoucher(guardado.voucher, await casarVoucher(exec, tenantId, guardado.voucher), hoje);
  if (guardado.descartados > 0) {
    r.avisos.unshift(`${guardado.descartados === 1 ? 'Um campo lido não foi' : `${guardado.descartados} campos lidos não foram`} achado${guardado.descartados === 1 ? '' : 's'} no texto do e-mail e ficou de fora.`);
  }
  return r;
}

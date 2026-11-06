/**
 * EXPORTAÇÃO (E7, G3): a resposta HTTP de toda exportação. Um só caminho
 * para as rotas que já leem o filtro inteiro no servidor (contas, extrato,
 * relatórios) e para o POST /api/exportacao (telas que montam o relatório
 * no navegador: DRE, fluxo de caixa, resultado por categoria...).
 *
 * Confere o direito "exportar" (Baixar em Excel e PDF), tira as colunas do
 * ganho da agência de quem não tem "ver_colunas_comissao", registra na
 * auditoria e devolve o arquivo com o filtro no nome.
 */
import type { SessionPayload } from '../auth';
import { registrarEventoAuditoria } from '../audit';
import { pode, type ExecutorPermissoes } from '../permissoes-servidor';
import { nomeDoArquivo, semColunasSensiveis, type DocumentoExportado, type FormatoDeExportacao } from './documento';
import { bytesDoDocumento, cabecalhosDoArquivo } from './arquivo';

export { bytesDoDocumento, cabecalhosDoArquivo, formatoDaConsulta } from './arquivo';

export interface OpcoesDaResposta {
  exec?: ExecutorPermissoes;
  /** Nome da lista/relatório na auditoria (ex.: "cobrancas"). */
  entidade: string;
  /** Já conferido o direito de exportar (a rota fez a conta antes). */
  direitoConferido?: boolean;
  /** As colunas sensíveis já saíram (a rota decidiu antes). */
  sensiveisConferidas?: boolean;
}

/** Confere direitos, audita e devolve o arquivo. Recusa em JSON com status 403. */
export async function responderExportacao(
  sessao: SessionPayload | null, documento: DocumentoExportado, formato: FormatoDeExportacao, opcoes: OpcoesDaResposta,
): Promise<Response> {
  if (!sessao) return Response.json({ error: 'Sessão necessária.' }, { status: 401 });
  if (!opcoes.direitoConferido && !(await pode(sessao, 'exportar', { exec: opcoes.exec }))) {
    return Response.json({ error: 'Seu acesso não inclui baixar em Excel e PDF.', codigo: 'SEM_DIREITO' }, { status: 403 });
  }
  const verSensivel = opcoes.sensiveisConferidas ? true : await pode(sessao, 'ver_colunas_comissao', { exec: opcoes.exec });
  const doc = semColunasSensiveis(documento, verSensivel);
  const nome = nomeDoArquivo(doc, formato);
  // Registro de acesso sensível (E7): o arquivo levou o ganho da agência?
  const comGanho = doc.colunas.some(c => c.sensivel);
  await registrarEventoAuditoria({
    session: sessao, acao: 'EXPORTAR', modulo: 'Financeiro', entidade: opcoes.entidade,
    descricao: `${formato === 'imprimir' ? 'Imprimiu' : 'Exportou'} "${doc.titulo}" (${doc.linhas.length} ${doc.linhas.length === 1 ? 'linha' : 'linhas'}, ${formato === 'imprimir' ? 'PDF' : formato.toUpperCase()}${comGanho ? ', com as colunas do ganho da agência' : ''}).`,
  }).catch(() => undefined);
  const bytes = await bytesDoDocumento(doc, formato);
  return new Response(new Uint8Array(bytes), { headers: cabecalhosDoArquivo(nome, formato) });
}

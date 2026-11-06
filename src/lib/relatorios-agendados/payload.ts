/**
 * O que o CRM recebe para mandar o e-mail do relatório agendado (E7, G3):
 * evento RELATORIO_ENVIAR. Arquivo puro.
 */
import { rotuloDoPeriodo, type DocumentoExportado } from '../exportacao/documento';
import type { DadosDoAgendamento, FormatoDoAnexo } from './regras';

type Agendamento = Pick<DadosDoAgendamento, 'nome' | 'destinatarios' | 'formato'> & { id: string; criado_por_nome: string };
interface LeituraCriada { url: string; token: string; expira_em: string }

export interface PayloadDoRelatorioCrm {
  agendamento_id: string;
  nome: string;
  destinatarios: string[];
  assunto: string;
  titulo: string;
  periodo: { de: string; ate: string; rotulo: string };
  filtros: Array<{ rotulo: string; valor: string }>;
  linhas: number;
  url_leitura: string;
  url_planilha: string;
  url_pdf: string;
  formato_preferido: FormatoDoAnexo;
  valido_ate: string;
  criado_por: string;
}

/** O que o CRM recebe para mandar o e-mail (texto dele, com o link). */
export function payloadDoEnvio(a: Agendamento, doc: DocumentoExportado, l: LeituraCriada, de: string, ate: string): PayloadDoRelatorioCrm {
  const rotulo = rotuloDoPeriodo(de, ate);
  const api = l.url.replace(/\/r\/[^/]+$/, `/api/leitura/${l.token}`);
  return {
    agendamento_id: a.id, nome: a.nome, destinatarios: a.destinatarios,
    assunto: `${a.nome} · ${rotulo}`, titulo: doc.titulo,
    periodo: { de, ate, rotulo }, filtros: doc.filtros ?? [], linhas: doc.linhas.length,
    url_leitura: l.url, url_planilha: `${api}?formato=xlsx`, url_pdf: `${api}?formato=pdf`,
    formato_preferido: a.formato, valido_ate: l.expira_em, criado_por: a.criado_por_nome,
  };
}


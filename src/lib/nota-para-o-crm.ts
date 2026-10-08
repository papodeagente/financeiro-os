/**
 * Publicar a nota fiscal na área do cliente do CRM.
 *
 * O ARQUIVO VIAJA, O LINK NÃO. O link que o emissor devolve exige a chave da
 * agência num cabeçalho (`x-api-key` na PlugNotas, `Bearer` na AceleraAPI) e
 * não abre no navegador de ninguém — foi assim que o botão "PDF" da ficha do
 * cliente nasceu quebrado. Então o Financeiro busca os bytes com a chave dele
 * e manda o PDF; no CRM a nota entra pelo mesmo caminho de contrato e
 * voucher. Só o PDF: o XML é documento do contador, não do viajante.
 *
 * POR QUE UM MÓDULO SÓ PARA DECIDIR E MONTAR. O evento sai uma vez por nota,
 * no instante em que a prefeitura autoriza. Errar aqui tem três formas, e
 * todas são silenciosas:
 *
 *  1. Mandar sem o vínculo com a venda do CRM. O evento chega, o CRM não acha
 *     a negociação e o documento não aparece para ninguém.
 *  2. Mandar antes da autorização. Nota em PROCESSAMENTO ainda não tem número
 *     nem PDF: o portal mostraria um documento vazio.
 *  3. Mandar duas vezes. A nota é consultada em laço até autorizar; sem trava,
 *     cada consulta publicaria o mesmo documento de novo no portal do cliente.
 */

/** O mínimo da nota para decidir e montar o aviso. */
export interface NotaParaAviso {
  id?: string;
  status?: string | null;
  numero?: string | null;
  link_pdf?: string | null;
  link_xml?: string | null;
  valor_servicos?: number | null;
  autorizada_em?: string | null;
  cliente_id?: string | null;
  venda_id?: string | null;
}

export type MotivoDeNaoAvisar =
  | 'nao-autorizada'
  | 'sem-arquivo'
  | 'sem-venda-no-crm';

export interface DecisaoDoAviso {
  avisar: boolean;
  motivo: MotivoDeNaoAvisar | null;
}

/**
 * O CRM deve ser avisado desta nota?
 *
 * `crmVendaId` é o id da venda NO CRM, gravado pelo webhook de entrada. Sem
 * ele não há negociação para pendurar o documento, e o aviso seria descartado
 * do outro lado — melhor não emitir e deixar o motivo registrado.
 */
export function decidirAviso(entrada: {
  nota: NotaParaAviso;
  crmVendaId: string | null | undefined;
}): DecisaoDoAviso {
  const { nota } = entrada;
  if (String(nota.status ?? '').toUpperCase() !== 'AUTORIZADA') {
    return { avisar: false, motivo: 'nao-autorizada' };
  }
  // Sem PDF não há o que o cliente baixe. O XML não entra no portal.
  if (!String(nota.link_pdf ?? '').trim()) {
    return { avisar: false, motivo: 'sem-arquivo' };
  }
  if (!String(entrada.crmVendaId ?? '').trim()) {
    return { avisar: false, motivo: 'sem-venda-no-crm' };
  }
  return { avisar: true, motivo: null };
}

/**
 * Chave de idempotência do evento.
 *
 * Uma por NOTA, não por tentativa: `sincronizarNota` é chamada em laço
 * enquanto a prefeitura não responde, e cada chamada que encontrasse
 * AUTORIZADA emitiria de novo. A fila do CRM ignora id repetido
 * (`ON CONFLICT DO NOTHING`), então a chave estável é a trava.
 */
export function chaveDoAviso(notaId: string): string {
  return `nf-${notaId}`;
}

/**
 * Nome do arquivo como ele chega no portal.
 *
 * Sem espaço e sem acento de propósito: do outro lado ele vira chave no S3, e
 * o CRM limparia o que sobrasse — o nome que o cliente vê seria o resto da
 * limpeza ("Notafiscal4321.pdf") em vez de um nome escolhido.
 */
export function nomeDoArquivo(numero: string | null | undefined): string {
  const n = String(numero ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '');
  return n ? `nfse-${n}.pdf` : 'nota-fiscal.pdf';
}

export interface AvisoDeNota {
  nota_id: string;
  crm_venda_id: string;
  numero: string;
  /** Nome pronto para o portal exibir e para o arquivo baixado. */
  nome_arquivo: string;
  /** O PDF inteiro. É ele que o cliente baixa no portal. */
  arquivo_base64: string;
  tipo_conteudo: string;
  valor_servicos: number;
  autorizada_em: string;
}

export function montarAviso(entrada: {
  nota: NotaParaAviso;
  crmVendaId: string;
  /** Os bytes do PDF, já buscados no emissor com a chave da agência. */
  pdf: Uint8Array;
}): AvisoDeNota {
  const { nota } = entrada;
  return {
    nota_id: String(nota.id ?? ''),
    crm_venda_id: String(entrada.crmVendaId),
    numero: String(nota.numero ?? ''),
    nome_arquivo: nomeDoArquivo(nota.numero),
    arquivo_base64: Buffer.from(entrada.pdf).toString('base64'),
    tipo_conteudo: 'application/pdf',
    valor_servicos: Number(nota.valor_servicos ?? 0),
    autorizada_em: String(nota.autorizada_em ?? ''),
  };
}

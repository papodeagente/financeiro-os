/**
 * Baixar o PDF e o XML da nota fiscal.
 *
 * O link que o emissor devolve (`link_pdf`, `link_xml`) NÃO abre no navegador:
 * a PlugNotas exige o cabeçalho `x-api-key` em todo acesso ao arquivo. Um <a>
 * apontando para ele dá erro de autenticação, não o documento. Foi o que
 * aconteceu com o botão "PDF" da ficha do cliente: ele apontava para o link
 * cru e nunca funcionou.
 *
 * Então quem baixa é o servidor: a rota busca o arquivo com a chave da agência
 * e entrega os bytes. Este módulo guarda só as regras — qual link usar, como
 * chamar o arquivo, e quando NÃO existe arquivo para baixar — para que elas
 * sejam testáveis sem rede e sem banco.
 */

export type TipoDeArquivo = 'pdf' | 'xml';

export interface NotaParaArquivo {
  numero?: string;
  codigo_verificacao?: string;
  status?: string;
  link_pdf?: string;
  link_xml?: string;
}

/** Por que não há arquivo. Vira a mensagem que o usuário lê. */
export type MotivoSemArquivo =
  | 'nota-nao-autorizada'
  | 'emissor-nao-devolveu-link';

export type DecisaoDeArquivo =
  | { pode: true; url: string; nome_arquivo: string; tipo_conteudo: string }
  | { pode: false; motivo: MotivoSemArquivo; mensagem: string };

const TIPO_CONTEUDO: Record<TipoDeArquivo, string> = {
  pdf: 'application/pdf',
  xml: 'application/xml',
};

/**
 * Só nota AUTORIZADA tem documento. CANCELADA também tem — o cancelamento não
 * apaga a nota que existiu, e quem foi fiscalizado precisa do PDF dela.
 */
const COM_DOCUMENTO = new Set(['AUTORIZADA', 'CANCELADA']);

export function ehTipoDeArquivo(v: unknown): v is TipoDeArquivo {
  return v === 'pdf' || v === 'xml';
}

/**
 * Nome com que o arquivo chega na máquina do cliente.
 *
 * Usa o número da nota, que é como a prefeitura e o contador se referem a ela.
 * Sem número (nota autorizada que não devolveu número), cai no código de
 * verificação e, por fim, em "nota-fiscal" — nunca num nome vazio, que o
 * navegador salvaria como "download".
 */
export function nomeDoArquivo(nota: NotaParaArquivo, tipo: TipoDeArquivo): string {
  const base = somenteSeguro(nota.numero) || somenteSeguro(nota.codigo_verificacao);
  return base ? `nfse-${base}.${tipo}` : `nota-fiscal.${tipo}`;
}

/** Sem barra, sem espaço, sem acento: o nome viaja num cabeçalho HTTP. */
function somenteSeguro(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .slice(0, 60);
}

export function decidirArquivo(nota: NotaParaArquivo, tipo: TipoDeArquivo): DecisaoDeArquivo {
  const status = String(nota.status ?? '').toUpperCase();
  if (!COM_DOCUMENTO.has(status)) {
    return {
      pode: false,
      motivo: 'nota-nao-autorizada',
      mensagem: 'A nota ainda não foi autorizada pela prefeitura: não existe documento para baixar.',
    };
  }
  const url = String((tipo === 'pdf' ? nota.link_pdf : nota.link_xml) ?? '').trim();
  if (!url) {
    return {
      pode: false,
      motivo: 'emissor-nao-devolveu-link',
      mensagem: `O emissor não devolveu o ${tipo.toUpperCase()} desta nota. Atualize a situação da nota e tente de novo.`,
    };
  }
  return { pode: true, url, nome_arquivo: nomeDoArquivo(nota, tipo), tipo_conteudo: TIPO_CONTEUDO[tipo] };
}

/**
 * O endereço que a tela usa. É SEMPRE a rota do próprio sistema, nunca o link
 * do emissor: é essa troca que faz o botão funcionar.
 */
export function enderecoDoArquivo(notaId: string, tipo: TipoDeArquivo): string {
  return `/api/fiscal/notas/${encodeURIComponent(notaId)}/arquivo?tipo=${tipo}`;
}

/**
 * Cabeçalho que faz o navegador salvar em vez de tentar abrir. `attachment`
 * com nome explícito, e `filename*` para o caso de o nome ter sobrado algum
 * caractere não-ASCII.
 */
export function cabecalhoDeDownload(nome: string): string {
  return `attachment; filename="${nome}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

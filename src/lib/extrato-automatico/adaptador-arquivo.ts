/**
 * Adaptador de arquivo (Modo A do plano): o CSV ou OFX que a agência baixa
 * no site de qualquer banco. Embrulha o leitor que a tela de conciliação já
 * usa (src/lib/extrato-arquivo.ts), sem mudar comportamento, para que o
 * arquivo e a coleta automática falem a mesma língua.
 *
 * Não coleta sozinho: declara `coletaAutomatica: false` e o orquestrador
 * nunca o chama para sincronizar (checagem de capacidade, nunca de nome).
 */
import { lerArquivoDeExtrato } from '../extrato-arquivo';
import { paraCentavos } from '../money';
import type { AdaptadorBancario, ResultadoColeta, TransacaoNormalizada } from './contrato';

export const adaptadorArquivo: AdaptadorBancario = {
  id: 'arquivo',
  capacidades: {
    coletaAutomatica: false,
    importaArquivo: true,
    informaSaldo: false,
    informaIdExterno: true, // o FITID do OFX; o CSV não tem
    janelaMaximaDias: null,
    chamadasPorMinuto: null,
  },
  apresentacao: {
    nome: 'Arquivo do banco (CSV ou OFX)',
    passos: [
      { titulo: 'Baixe o extrato', texto: 'No site do seu banco, procure por exportar extrato e escolha OFX (ou CSV).' },
      { titulo: 'Importe na conciliação', texto: 'Em Conciliação, escolha a conta e clique em Importar extrato.' },
    ],
    passosRenovacao: [],
    alerta: null,
    validadeCertificadoMeses: null,
  },
  camposCredencial: () => [],
  async importar(conteudo: string, nomeArquivo: string): Promise<ResultadoColeta> {
    const linhas = lerArquivoDeExtrato(conteudo, nomeArquivo);
    const transacoes: TransacaoNormalizada[] = linhas.map(l => {
      const valorCentavos = paraCentavos(l.valor);
      return {
        idExterno: l.fitid ?? null,
        data: l.data,
        valorCentavos,
        tipo: valorCentavos >= 0 ? 'CREDITO' : 'DEBITO',
        descricao: l.descricao,
        saldoAposCentavos: null,
        pendente: false,
        categoriaOrigem: null,
      };
    });
    const datas = linhas.map(l => l.data).filter(Boolean).sort();
    return {
      transacoes,
      saldo: null,
      paginasLidas: 1,
      janelaCoberta: { de: datas[0] ?? '', ate: datas[datas.length - 1] ?? '' },
    };
  },
};

// Ponto único de registro dos executores de aprovação (05/11/2026).
// A rota /api/aprovacoes importa este arquivo antes de decidir: um tipo cujo
// módulo não foi carregado ficaria aprovado sem executar.
//
// 'pagamento' (alçada de contas a pagar) se registra em ./aprovacoes-servidor.
// 'baixa' (liquidação fora dos limites) se registra em ./baixas-porteiro.
// Quem criar um tipo novo importa aqui o
// módulo que chama registrarExecutorDeAprovacao.
import './aprovacoes-servidor';
import './baixas-porteiro';

export {};

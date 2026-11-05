// Temporizador interno do agendador (05/11/2026): a cada 5 minutos roda as
// tarefas devidas (abertura e conferência do razão, fila por agência). É
// seguro com várias instâncias e junto da tarefa agendada do Coolify: cada
// tarefa roda sob trava do banco e cada janela uma vez só.
// AGENDADOR_INTERNO=0 desliga.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.AGENDADOR_INTERNO === '0') return;
  const INTERVALO_MS = 5 * 60 * 1000;
  const rodar = async () => {
    try {
      const { executarAgendadorAgora } = await import('./lib/agendador/tarefas');
      await executarAgendadorAgora();
    } catch (e) {
      console.error('[agendador] rodada falhou:', e instanceof Error ? e.message : e);
    }
  };
  // Primeira rodada 1 minuto depois de subir (não atrasa o boot nem a troca de réplica).
  const primeira = setTimeout(rodar, 60 * 1000);
  const timer = setInterval(rodar, INTERVALO_MS);
  primeira.unref?.();
  timer.unref?.();
}

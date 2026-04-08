/**
 * Centralized microcopy for toast notifications.
 * Use these helpers from the lib/toast wrapper to keep wording consistent.
 */
export const toastMsg = {
  saveSuccess: (entity: string) => `${entity} salvo`,
  saveError: (entity: string, err?: string) => ({
    title: `Falha ao salvar ${entity}`,
    description: err ?? 'Verifique sua conexão e tente novamente.',
  }),
  deleteSuccess: (entity: string) => `${entity} removido`,
  deleteError: (entity: string, err?: string) => ({
    title: `Não foi possível excluir ${entity}`,
    description: err ?? 'Tente novamente em instantes.',
  }),
  createSuccess: (entity: string) => `${entity} criado`,
  createError: (entity: string, err?: string) => ({
    title: `Falha ao criar ${entity}`,
    description: err ?? 'Verifique os dados e tente novamente.',
  }),
  genericError: (err?: string) => ({
    title: 'Algo deu errado',
    description: err ?? 'Tente novamente em instantes.',
  }),
};

import { toast as sonnerToast } from 'sonner';

type Description = string | { description?: string };

function normalize(desc?: Description) {
  if (!desc) return undefined;
  if (typeof desc === 'string') return { description: desc };
  return desc;
}

export const toast = {
  success: (msg: string, description?: Description) =>
    sonnerToast.success(msg, normalize(description)),
  error: (msg: string, description?: Description) =>
    sonnerToast.error(msg, normalize(description)),
  info: (msg: string, description?: Description) =>
    sonnerToast.info(msg, normalize(description)),
  warning: (msg: string, description?: Description) =>
    sonnerToast.warning(msg, normalize(description)),
  message: (msg: string, description?: Description) =>
    sonnerToast(msg, normalize(description)),
  promise: sonnerToast.promise,
  loading: sonnerToast.loading,
  dismiss: sonnerToast.dismiss,
};

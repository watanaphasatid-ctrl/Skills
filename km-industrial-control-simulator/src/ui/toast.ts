export type ToastKind = 'info' | 'error';
export interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
}
type Handler = (t: ToastMessage) => void;

const handlers = new Set<Handler>();
let nextId = 1;

export function toast(text: string, kind: ToastKind = 'info'): void {
  const t = { id: nextId++, kind, text };
  for (const h of handlers) h(t);
}

export function onToast(h: Handler): () => void {
  handlers.add(h);
  return () => handlers.delete(h);
}

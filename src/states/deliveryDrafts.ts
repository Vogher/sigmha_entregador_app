// src/states/deliveryDrafts.ts
export type DeliveryDraft = {
  photos: string[];
  description: string;
  receiverName: string;
  updatedAt: number;
};

type Listener = (id: number, draft: DeliveryDraft | undefined) => void;

const drafts = new Map<number, DeliveryDraft>();
const listeners = new Set<Listener>();

export function getDraft(id: number): DeliveryDraft | undefined {
  return drafts.get(id);
}

export function setDraft(id: number, next: Partial<DeliveryDraft>) {
  const prev = drafts.get(id) ?? {
    photos: [],
    description: '',
    receiverName: '',
    updatedAt: 0,
  };
  const merged = { ...prev, ...next, updatedAt: Date.now() };
  drafts.set(id, merged);
  listeners.forEach(fn => fn(id, merged));
}

export function clearDraft(id: number) {
  drafts.delete(id);
  listeners.forEach(fn => fn(id, undefined));
}

export function subscribeDrafts(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// opcional: utilitÃ¡rio para a HomeScreen
export function getAllDrafts() {
  return drafts;
}

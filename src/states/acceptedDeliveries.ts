export type AcceptedDelivery = {
  entrega_id: number;
  numero?: string | number | null;
  cliente_nome?: string | null;
  coleta_endereco?: string | null;
  entrega_endereco?: string | null;
  valor_total_motoboy?: number | string | null;
  has_retorno?: boolean | null; // <- adicione isto

};

type Listener = (list: AcceptedDelivery[]) => void;

const state: { list: AcceptedDelivery[]; listeners: Set<Listener> } = {
  list: [],
  listeners: new Set(),
};

export function addAcceptedDelivery(d: AcceptedDelivery) {
  if (!state.list.find((x) => x.entrega_id === d.entrega_id)) {
    state.list = [d, ...state.list];
    emit();
  }
}

export function setAcceptedDeliveries(list: AcceptedDelivery[]) {
  state.list = list;
  emit();
}

export function getAcceptedDeliveries() {
  return state.list;
}

export function subscribeAccepted(fn: Listener) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

function emit() {
  for (const fn of state.listeners) fn(state.list);
}

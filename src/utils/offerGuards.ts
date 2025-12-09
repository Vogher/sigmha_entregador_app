// src/utils/offerGuards.ts
import { api } from "@/services/api";

function secsLeftFromISO(expiraISO?: string | null) {
  if (!expiraISO) return null;
  const t = Date.parse(expiraISO);
  if (Number.isNaN(t)) return null;
  const diff = Math.floor((t - Date.now()) / 1000);
  return diff < 0 ? 0 : diff;
}

export async function checkOfferStillYours(
  entregaId: number,
  motoboy: { id: number; nome?: string | null }
): Promise<boolean> {
  try {
    const tries = [
      () => api.get(`/api/entregas-pendentes/${entregaId}`),
      () => api.get(`/entregas-pendentes/${entregaId}`),
    ];

    let data: any = null;
    for (const t of tries) {
      try {
        const r = await t();
        if (r?.data) { data = r.data; break; }
      } catch {}
    }
    if (!data) return false;

    const atribNome =
      data.atribuido_motoboy ??
      data.motoboy_nome ??
      data.motoboy ??
      data.assigned_to_name ?? null;

    const atribId =
      data.motoboy_id ??
      data.assigned_to_id ??
      data.atribuido_motoboy_id ?? null;

    const status = (data.status ?? data.state ?? "").toString();
    const assignDeadlineISO =
      data.assign_deadline_at ?? data.expira_em ?? data.deadline ?? null;

    const isNovo = /^(novo|pendente|await|waiting)$/i.test(status);

    const idOk = typeof atribId === "number" && Number(atribId) === Number(motoboy.id);
    const nomeOk =
      !idOk &&
      !!atribNome &&
      !!motoboy.nome &&
      typeof atribNome === "string" &&
      atribNome.trim().toLowerCase() === motoboy.nome.trim().toLowerCase();

    let dentroDoTTL = true;
    if (assignDeadlineISO) {
      const left = secsLeftFromISO(assignDeadlineISO);
      dentroDoTTL = left === null ? true : left > 0;
    }

    return isNovo && (idOk || nomeOk) && dentroDoTTL;
  } catch {
    return false;
  }
}

// também como default para evitar erro de import
export default checkOfferStillYours;

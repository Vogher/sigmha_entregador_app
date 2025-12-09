// src/config.ts
import { api } from "@/services/api";

// Base da API: usa a base do axios se existir, senão cai num default
export const API_BASE_URL: string =
  (api as any)?.defaults?.baseURL || "https://deann-grushie-chance.ngrok-free.dev";

export const SIGNUP_FINALIZE_PATH = "/api/motoboy_cadastro/finalizar";

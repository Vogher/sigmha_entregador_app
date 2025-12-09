// src/services/api.ts
import axios from "axios";

const RAW_BASE =
  (process.env.EXPO_PUBLIC_API_BASE ?? "").trim() ||
  "https://dev.alyssonrodrigues.com"; // fallback DEV (pode trocar por 127.0.0.1 se usar adb reverse)

export const API_BASE = RAW_BASE.replace(/\/+$/, ""); // remove barra no final

export const AUTH_LOGIN_PATH = "/api/motoboy/login";
export const SIGNUP_CREATE_PATH = "/api/motoboy_cadastro";
export const SIGNUP_FINALIZE_PATH = "/api/motoboy_cadastro/finalizar";
export const PING_HEALTH_PATH = "/_health/motoboy_cadastro";
export const CHECK_PHONE_PATH = "/api/motoboy/login/check-phone";

console.log("[API] baseURL =", API_BASE, "ENV =", process.env.EXPO_PUBLIC_API_BASE);

export const api = axios.create({ baseURL: API_BASE, timeout: 15000 });

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const cfg = err?.config ?? {};
    const fullUrl = `${cfg.baseURL || ""}${cfg.url || ""}`;
    const log = {
      message: err?.message,
      method: cfg.method,
      url: cfg.url,
      baseURL: cfg.baseURL,
      fullUrl,
      status: err?.response?.status,
      data: err?.response?.data,
    };
    try { console.log("API error:", JSON.stringify(log)); } catch { console.log("API error:", log); }
    return Promise.reject(err);
  }
);

export function setAuthToken(token: string | null) {
  if (!token) delete (api.defaults.headers as any).common?.Authorization;
  else (api.defaults.headers as any).common = { ...(api.defaults.headers as any).common, Authorization: `Bearer ${token}` };
}

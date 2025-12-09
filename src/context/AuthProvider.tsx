import * as SecureStore from "expo-secure-store";
import { api, AUTH_LOGIN_PATH, setAuthToken } from "@/services/api";
import { registerExpoPushToken } from "@/utils/notifications";

// src/context/AuthProvider.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// ================= Helpers =================
const onlyDigits = (s: string) => (s || "").replace(/\D/g, "");

/** Normaliza telefone para 10–11 dígitos BR (DDD + número) */
function normalizePhoneDigits(input: string) {
  let d = onlyDigits(input);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2); // remove DDI +55
  if (d.startsWith("0")) d = d.slice(1); // remove tronco
  if (d.length > 11) d = d.slice(-11); // mantém 11 finais
  return d;
}

// ================ Tipos ================
interface User {
  id: number;
  nome: string;
  email?: string | null;
  phone?: string | null;
}

interface AuthContext {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (phoneInput: string, senha: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthContext | undefined>(undefined);

// =========================================================

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Rehidrata sessão
  useEffect(() => {
    (async () => {
      try {
        const t = await SecureStore.getItemAsync("auth-token");
        const u = await SecureStore.getItemAsync("auth-user");

        if (t) {
          setTokenState(t);
          setAuthToken(t);
        }
        if (u) {
          const parsed: User = JSON.parse(u);
          setUser(parsed);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Sempre que tiver usuário autenticado, registra/atualiza o push token
  useEffect(() => {
    if (!user?.id) return;
    registerExpoPushToken(user.id).catch((e) =>
      console.warn("[Push] Falhou ao registrar token após hidratar/login:", e)
    );
  }, [user?.id]);

  const login = async (phoneInput: string, senha: string) => {
    const phone = normalizePhoneDigits(phoneInput);
    if (!phone) throw new Error("Telefone inválido");

    // Login real no backend
    const res = await api.post(AUTH_LOGIN_PATH, { celular: phone, senha });
    const { token: tok, user: usr } = res.data || {};
    if (!tok || !usr?.id) throw new Error("Resposta de login inválida");

    const safeUser: User = {
      id: usr.id,
      nome: usr?.nome ?? usr?.name ?? "Usuário",
      email: usr?.email ?? null,
      phone: usr?.phone ?? phone,
    };

    // Atualiza estado + headers globais + persistência
    setTokenState(tok);
    setUser(safeUser);
    setAuthToken(tok);
    await SecureStore.setItemAsync("auth-token", tok);
    await SecureStore.setItemAsync("auth-user", JSON.stringify(safeUser));

    // OBS: o push token será registrado pelo useEffect acima (quando user.id mudar)
  };

  const logout = async () => {
    setTokenState(null);
    setUser(null);
    setAuthToken(null);
    await SecureStore.deleteItemAsync("auth-token");
    await SecureStore.deleteItemAsync("auth-user");
    // Se quiser: notificar backend para limpar expo_token do motoboy
    // try { await api.delete('/api/me/expo-token'); } catch {}
  };

  const value = useMemo(
    () => ({ user, token: token, loading, login, logout }),
    [user, token, loading]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

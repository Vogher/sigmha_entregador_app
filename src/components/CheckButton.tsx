// src/components/CheckButton.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import type { AxiosInstance } from "axios";

type Props = {
  motoboyId: number | null;
  api: AxiosInstance;
  theme: any;
  onAfterChange?: () => void;
};

/* ==============================
   Utils / chamadas ao backend
   ============================== */
async function getCheckState(api: AxiosInstance, id: number): Promise<boolean> {
  const urls = [`/api/motoboys/${id}/check-state`
  ];
  for (const u of urls) {
    try {
      const { data } = await api.get(u);
      if (typeof data?.checkedIn === "boolean") return data.checkedIn;
    } catch {}
  }
  return false;
}

async function doCheckin(api: AxiosInstance, id: number) {
  const urls = [`/api/motoboys/${id}/checkin`, `/motoboys/${id}/checkin`];
  for (const u of urls) {
    try {
      const { data, status } = await api.post(u);
      if (status >= 200 && status < 300)
        return { ok: true, message: data?.message || "Check-in realizado." };
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || "Falha no check-in.";
      return { ok: false, message: msg };
    }
  }
  return { ok: false, message: "Falha no check-in." };
}

async function doCheckout(api: AxiosInstance, id: number) {
  const urls = [`/api/motoboys/${id}/checkout`, `/motoboys/${id}/checkout`];
  for (const u of urls) {
    try {
      const { data, status } = await api.post(u);
      if (status >= 200 && status < 300)
        return { ok: true, message: data?.message || "Check-out realizado." };
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || "Falha no check-out.";
      return { ok: false, message: msg };
    }
  }
  return { ok: false, message: "Falha no check-out." };
}

/* ==============================
   Componente principal
   ============================== */
export default function CheckButton({ motoboyId, api, theme, onAfterChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [checkedIn, setCheckedIn] = useState<boolean>(false);

  const longOkRef = useRef(false);
  const suppressAutoAlertRef = useRef(false);
  const prevCheckedInRef = useRef<boolean>(false);
  const pollIdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const gold = theme?.colors?.gold ?? "#D4AF37";
  const card = theme?.colors?.card ?? "#111";
  const border = theme?.colors?.borderDark ?? "#333";
  const text = theme?.colors?.text ?? "#fff";
  const grey = theme?.colors?.muted ?? "#8a8a8a";
  const green = "#22c55e";
  const red = "#ef4444";

  /* ======= Atualiza estado do backend ======= */
  const refreshState = useCallback(async () => {
    if (!motoboyId) return;
    try {
      const st = await getCheckState(api, motoboyId);
      if (st !== prevCheckedInRef.current) {
        setCheckedIn(st);
        prevCheckedInRef.current = st;
        // chama callback se mudou (mantém sincronismo com tela pai)
        onAfterChange?.();
      }
    } catch (err) {
      console.log("Erro ao checar estado:", err);
    }
  }, [api, motoboyId, onAfterChange]);

  /* ======= Estado inicial ======= */
  useEffect(() => {
    refreshState();
  }, [refreshState]);

  /* ======= Polling contínuo ======= */
  useEffect(() => {
    if (pollIdRef.current) clearInterval(pollIdRef.current);

    // Mantemos polling sempre ativo, mas com frequência ajustada
    const interval = checkedIn ? 15000 : 30000; // 15s se estiver logado, 30s se não
    if (motoboyId) {
      pollIdRef.current = setInterval(async () => {
        const st = await getCheckState(api, motoboyId);
        const was = prevCheckedInRef.current;

        if (st !== was) {
          // Detecção de mudança vinda do painel
          setCheckedIn(st);
          prevCheckedInRef.current = st;

          if (was && !st && !suppressAutoAlertRef.current) {
            Alert.alert(
              "Check-out automático",
              "Seu turno foi encerrado automaticamente. O valor do turno fixo foi lançado no seu relatório."
            );
          }
          suppressAutoAlertRef.current = false;
          onAfterChange?.();
        }
      }, interval);
    }

    return () => {
      if (pollIdRef.current) clearInterval(pollIdRef.current);
      pollIdRef.current = null;
    };
  }, [api, motoboyId, checkedIn, onAfterChange]);

  /* ======= Long press principal ======= */
  const onLongPress = useCallback(async () => {
    if (!motoboyId) {
      Alert.alert("Erro", "Motoboy inválido.");
      return;
    }

    longOkRef.current = true;
    setLoading(true);

    try {
      if (!checkedIn) {
        const r = await doCheckin(api, motoboyId);
        if (!r.ok) {
          Alert.alert("Check-in não permitido", r.message);
        } else {
          setCheckedIn(true);
          prevCheckedInRef.current = true;
          Alert.alert("Tudo certo!", r.message);
        }
      } else {
        const r = await doCheckout(api, motoboyId);
        if (!r.ok) {
          Alert.alert("Check-out não permitido", r.message);
        } else {
          suppressAutoAlertRef.current = true;
          setCheckedIn(false);
          prevCheckedInRef.current = false;
          Alert.alert("Tudo certo!", r.message);
        }
      }

      // garante que tela pai recarregue dados e estado
      onAfterChange?.();
    } finally {
      setLoading(false);
      // força revalidação imediata pós-ação (captura alteração de painel também)
      setTimeout(refreshState, 1000);
      setTimeout(() => {
        suppressAutoAlertRef.current = false;
      }, 2000);
    }
  }, [api, motoboyId, checkedIn, onAfterChange, refreshState]);

  const onPressOut = useCallback(() => {
    if (!longOkRef.current) {
      Alert.alert("Segure por 2 segundos", "Para confirmar, mantenha pressionado por 2 segundos.");
    }
    longOkRef.current = false;
  }, []);

  /* ======= Render ======= */
  const label = checkedIn ? "Fazer Check-Out" : "Fazer Check-In";
  const bgColor = checkedIn ? red : green;
  const brdColor = checkedIn ? red : green;

  return (
    <View
      style={{
        width: "100%",
        backgroundColor: card,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: border,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <Text style={{ color: grey, fontSize: 12, marginBottom: 2 }}>Controle de presença</Text>

      <Pressable
        onLongPress={onLongPress}
        onPressOut={onPressOut}
        delayLongPress={2000}
        disabled={loading || !motoboyId}
        style={{
          backgroundColor: bgColor,
          paddingVertical: 12,
          paddingHorizontal: 22,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: brdColor,
          minWidth: 220,
          alignItems: "center",
          justifyContent: "center",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator />
        ) : (
          <Text style={{ color: "#000", fontWeight: "900", letterSpacing: 0.3 }}>{label}</Text>
        )}
      </Pressable>

      <Text style={{ color: gold, fontSize: 12 }}>
        Mantenha pressionado por 2s para confirmar
      </Text>
    </View>
  );
}

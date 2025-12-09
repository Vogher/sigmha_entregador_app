// src/utils/notifications.ts
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api } from "../services/api";

/**
 * Handler global de notificações (registrado uma única vez)
 * - usa globalThis para evitar erro de tipo
 * - não força tipos genéricos: retorna o objeto literal esperado
 */
const g = globalThis as any;

if (!g.__notifHandlerSet) {
  Notifications.setNotificationHandler({
    handleNotification: async () =>
      ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      } as any), // <- força o shape esperado, some o erro de TS
  } as any);
  g.__notifHandlerSet = true;
}

/**
 * Garante o canal Android que seu backend usa (channelId: "ofertas-alta")
 */
export async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;

  try {
    await Notifications.setNotificationChannelAsync("ofertas-alta", {
      name: "Ofertas",
      importance: Notifications.AndroidImportance.MAX,
      sound: "alarm", // pode trocar por um som custom que exista no app
      enableVibrate: true, // <- nome correto da prop no Expo
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  } catch (e) {
    console.warn("[Push] Falha ao criar canal Android:", e);
  }
}

/**
 * Pede permissão, obtém o token Expo e envia para o backend
 * Endpoint: POST /api/motoboys/:id/push-token  body { token }
 */
export async function registerExpoPushToken(userId: number): Promise<string | null> {
  await ensureAndroidChannel();

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return null;

  // Em builds EAS recentes é necessário passar o projectId
  const projectId =
    (Constants as any).expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId;

  const { data: expoToken } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );

  try {
    await api.post(`/api/motoboys/${userId}/push-token`, { token: expoToken });
  } catch (e) {
    console.warn("[Push] Falhou ao salvar token no backend:", e);
  }

  return expoToken;
}

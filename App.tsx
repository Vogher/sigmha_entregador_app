// App.tsx
import "react-native-gesture-handler";
import React, { useEffect, useRef } from "react";
import { Platform, StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  NavigationContainer,
  NavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Notifications from "expo-notifications";

import { AuthProvider, useAuth } from "./src/context/AuthProvider";
import LoginScreen from "./src/screens/LoginScreen";
import SignupScreen, { type SignupStep1Payload } from "./src/screens/SignupScreen";
import SignupStep2Screen from "./src/screens/SignupStep2Screen";
import HomeScreen from "./src/screens/HomeScreen";
import DeliveryDetailsScreen from "./src/screens/DeliveryDetailsScreen";
// ✅ Tela de relatório de recebimentos
import RecebimentosReport from "./src/screens/RecebimentosReport";
// ✅ NOVO: tela de Vagas para agendamento
import VagasAgendamentoScreen from "./src/screens/VagasAgendamentoScreen";

// 🔊 Garante que o som está empacotado no build (Android precisa do asset no binário)
const __ensureSoundBundle = require("./assets/sounds/clock_alarm_8761.mp3");

// ======================================================
// Notificações: exibição quando o app está em primeiro plano
// ======================================================
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, // iOS/iPadOS
      shouldShowList: true,   // iOS/iPadOS
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// ========= Tipos de navegação =========
export type RootStackParamList = {
  Login: undefined;
  Signup: undefined;
  SignupStep2: { cadastroParcial: SignupStep1Payload };
  Home: undefined;
  DeliveryDetails?: { entrega?: any } | undefined;
  // ✅ rota do relatório
  RecebimentosReport: undefined;
  // ✅ rota da tela de vagas
  VagasAgendamento: undefined;
};

const AuthStackNav = createNativeStackNavigator<RootStackParamList>();
const AppStackNav = createNativeStackNavigator<RootStackParamList>();

function AuthStack() {
  return (
    <AuthStackNav.Navigator
      screenOptions={{ headerShown: false }}
      initialRouteName="Login"
    >
      <AuthStackNav.Screen name="Login" component={LoginScreen} />
      <AuthStackNav.Screen name="Signup" component={SignupScreen} />
      <AuthStackNav.Screen name="SignupStep2" component={SignupStep2Screen} />
    </AuthStackNav.Navigator>
  );
}

function AppStack() {
  return (
    <AppStackNav.Navigator screenOptions={{ headerShown: false }}>
      <AppStackNav.Screen name="Home" component={HomeScreen} />
      <AppStackNav.Screen name="DeliveryDetails" component={DeliveryDetailsScreen} />
      {/* ✅ Tela de Relatório de Recebimentos */}
      <AppStackNav.Screen
        name="RecebimentosReport"
        component={RecebimentosReport}
      />
      {/* ✅ NOVO: Tela de Vagas para Agendamento */}
      <AppStackNav.Screen
        name="VagasAgendamento"
        component={VagasAgendamentoScreen}
      />
    </AppStackNav.Navigator>
  );
}

function Router() {
  const { token } = useAuth();
  return token ? <AppStack /> : <AuthStack />;
}

// ========= Pendência de navegação caso o usuário clique na notificação antes do Nav montar =========
type PendingNav =
  | { routeName: keyof RootStackParamList; params?: Record<string, unknown> }
  | null;
let PENDING_NAV: PendingNav = null;

// ========= Util: listar canais para debug =========
async function debugChannels() {
  if (Platform.OS !== "android") return;
  const channels = await Notifications.getNotificationChannelsAsync();
  console.log("CANAIS ANDROID:", channels);
}

// ========= Cria/garante o canal Android com o som custom =========
async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync("ofertas-alta-v6", {
    name: "Novas Entregas (Alto)",
    importance: Notifications.AndroidImportance.MAX,
    sound: "clock_alarm_8761", // nome do arquivo sem extensão
    enableVibrate: true,
    vibrationPattern: [250, 250, 500, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    lightColor: "#FFD4AF37",
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.NOTIFICATION_RINGTONE,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    },
  });

  await debugChannels();
}

// =======================================
export default function App() {
  const navRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== "granted") {
          await Notifications.requestPermissionsAsync();
        }
      } catch (err) {
        console.warn("[notifications] permissão falhou:", err);
      }

      if (Platform.OS === "android") {
        try {
          await ensureAndroidChannel();
        } catch (err) {
          console.warn("[notifications] criação de canal falhou:", err);
        }
      }
    })();

    // Usuário tocou na notificação (app fechado/segundo plano)
    // -> só navega para a Home; o HomeScreen decidirá abrir ou não o modal
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      const routeName: keyof RootStackParamList = "Home";

      if (!navRef.current?.isReady()) {
        PENDING_NAV = { routeName, params: undefined };
        return;
      }
      navRef.current.navigate(routeName);
    });

    return () => sub.remove();
  }, []);

  return (
    <AuthProvider>
      <SafeAreaProvider>
        <NavigationContainer
          ref={navRef}
          onReady={() => {
            if (PENDING_NAV && navRef.current?.isReady()) {
              const { routeName, params } = PENDING_NAV;
              // @ts-expect-error params opcionais conforme sua rota
              navRef.current.navigate(routeName, params);
              PENDING_NAV = null;
            }
          }}
        >
          <StatusBar barStyle="light-content" />
          <Router />
        </NavigationContainer>
      </SafeAreaProvider>
    </AuthProvider>
  );
}

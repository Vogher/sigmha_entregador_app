// src/screens/HomeScreen.tsx
import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  Pressable,
  Modal,
  Platform,
  LogBox,
  AppState,
  AppStateStatus,
  Alert,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { Audio } from "expo-av";
import Constants from "expo-constants";

import { useAuth } from "@/context/AuthProvider";
import { api } from "@/services/api";
import { theme } from "@/theme";

import { useNavigation } from '@react-navigation/native';

import CheckButton from "@/components/CheckButton";

import {
  addAcceptedDelivery,
  setAcceptedDeliveries,
  getAcceptedDeliveries,
  subscribeAccepted,
  type AcceptedDelivery,
} from "@/states/acceptedDeliveries";

/**
 * Este arquivo está alinhado ao backend que envia push com data.type = 'new_delivery'
 * (sem tabela de ofertas). Fluxo: push chega -> abrimos modal preto+dourado com os
 * campos do push -> motoboy toca Aceitar/Recusar -> chamamos
 * /api/entregas-pendentes/:id/(accept|reject) com { motoboy_id }.
 */

// ---------- (Opcional) Silenciar o log do Expo Go sobre push ----------
if (Platform.OS === "android" && Constants?.appOwnership === "expo") {
  LogBox.ignoreLogs([/expo-notifications: Android Push notifications.*removed from Expo Go/i]);
  const originalConsoleError = console.error as (...args: any[]) => void;
  console.error = (...args: any[]) => {
    const msg = args.map(String).join(" ");
    if (/expo-notifications: Android Push notifications.*removed from Expo Go/i.test(msg)) {
      return;
    }
    originalConsoleError(...args);
  };
}

// ---------- Tipos ----------
type TabKey = "status" | "entregas" | "opcoes" | "perfil";

type OfertaPayload = {
  entrega_id: number;
  numero?: string | number | null;
  cliente_nome?: string | null;
  coleta_endereco?: string | null;
  entrega_endereco?: string | null;
  valor_total_motoboy?: number | string | null;
  expira_em?: string | null; // ISO
  has_retorno?: boolean | null;

  // 👇 já existia
  valor_adicional_motoboy?: number | string | null;

  // 👇 NOVOS CAMPOS PARA NÚMERO PÚBLICO
  corrida_code?: string | number | null;
  numero_publico?: string | number | null;
  codigo_corrida?: string | number | null;
  id_publico?: string | number | null;
};

// Estágios do botão de ação no card
type Stage = 'coletar' | 'entregar' | 'retornar' | 'finalizar';

// ---------- Utils ----------
const maskPhone = (input?: string | null) => {
  const s = String(input || "").replace(/\D/g, "").slice(-11);
  if (s.length <= 2) return s;
  if (s.length <= 6) return `(${s.slice(0, 2)}) ${s.slice(2)}`;
  if (s.length <= 10) return `(${s.slice(0, 2)}) ${s.slice(2, 6)}-${s.slice(6)}`;
  return `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7, 11)}`;
};

function coerceHasRetorno(x: any): boolean {
  if (typeof x === 'boolean') return x;
  if (x == null) return false;
  if (typeof x === 'number') return Number.isFinite(x) && x > 0;
  const s = String(x).trim();
  // aceita true/sim/yes/1
  if (/^(true|sim|yes|y|1)$/i.test(s)) return true;
  // tenta número: "0.00", "16,38"
  return parseNumberBR(s) > 0;
}

function pickFiliacao(data: any): string | null {
  const candidates: Array<unknown> = [
    data?.filiacao,
    data?.filiation,
    data?.filiado_a,
    data?.atribuido_a,
    data?.vinculado_a,
    data?.cliente_nome,
    data?.empresa,
    data?.cliente?.nome_estabelecimento,
    data?.cliente?.nome,
    data?.cliente?.fantasia,
    data?.cliente?.razao_social,
  ];
  const first = candidates.find(
    (v) => typeof v === "string" && String(v).trim().length > 0 && String(v).trim() !== "Nenhum"
  ) as string | undefined;
  return first ? String(first).trim() : null;
}

const parseMoneyBR = (v: number | string | undefined | null) => {
  if (v == null || v === "") return "R$ 0,00";
  let num: number;
  if (typeof v === "number") num = v;
  else {
    const cleaned = String(v)
      .replace(/[^\d,.-]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    num = Number(cleaned);
  }
  if (!Number.isFinite(num)) num = 0;
  if (num >= 1000 && num < 100000 && Number.isInteger(num)) num = num / 100; // centavos
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

// Converte "39,90", "R$ 39,90", 0, "0", "0.00" -> number
const parseNumberBR = (v: any): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  if (!s) return 0;
  // remove moeda/símbolos e milhares; troca vírgula por ponto
  const cleaned = s
    .replace(/[^\d.,-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

// Usa APENAS valor_adicional_motoboy (> 0 => tem retorno)
const hasRetornoFromAdicional = (dataOrValue: any): boolean => {
  const raw =
    (dataOrValue && (dataOrValue.valor_adicional_motoboy ?? dataOrValue.valor_adicional ?? dataOrValue.adicional_motoboy)) ??
    dataOrValue;
  return parseNumberBR(raw) > 0;
};

const secsLeft = (expiraISO?: string | null) => {
  if (!expiraISO) return null;
  const t = Date.parse(expiraISO);
  if (Number.isNaN(t)) return null;
  const diff = Math.floor((t - Date.now()) / 1000);
  return diff < 0 ? 0 : diff;
};

// --- Confere no backend se a oferta ainda "é sua" e está dentro do TTL ---
async function checkOfferStillYours(
  entregaId: number,
  motoboyId: number,
  motoboyNome?: string | null
): Promise<boolean> {
  try {
    const tries = [() => api.get(`/api/entregas-pendentes/${entregaId}`), () => api.get(`/entregas-pendentes/${entregaId}`)];
    let data: any = null;
    for (const t of tries) {
      try {
        const r = await t();
        if (r?.data) {
          data = r.data;
          break;
        }
      } catch {}
    }
    if (!data) return false;

    const atribNome =
      data.atribuido_motoboy ??
      data.motoboy_nome ??
      data.motoboy ??
      data.assigned_to_name ??
      null;

    const atribId =
      data.motoboy_id ??
      data.assigned_to_id ??
      data.atribuido_motoboy_id ??
      null;

    const status = (data.status ?? data.state ?? "").toString();
    const assignDeadlineISO =
      data.assign_deadline_at ?? data.expira_em ?? data.deadline ?? null;

    const isNovo = /^(novo|pendente|await|waiting)$/i.test(status);
    const idOk = typeof atribId === "number" && Number(atribId) === Number(motoboyId);
    const nomeOk =
      !idOk &&
      !!atribNome &&
      !!motoboyNome &&
      typeof atribNome === "string" &&
      atribNome.trim().toLowerCase() === motoboyNome.trim().toLowerCase();

    let dentroDoTTL = true;
    if (assignDeadlineISO) {
      const left = secsLeft(assignDeadlineISO);
      dentroDoTTL = left === null ? true : left > 0;
    }

    return isNovo && (idOk || nomeOk) && dentroDoTTL;
  } catch (err) {
    console.warn("checkOfferStillYours falhou:", err);
    return false;
  }
}

// TTL local igual ao do backend (15s)
const ASSIGN_TTL_MS = 15000;

export default function HomeScreen() {
  const { user, logout } = useAuth();

  const [activeTab, setActiveTab] = useState<TabKey>("status");
  const [isOnline, setIsOnline] = useState(false);

  const [filiacao, setFiliacao] = useState<string>("Nenhum");
  const [loadingFiliacao, setLoadingFiliacao] = useState<boolean>(false);

  const [showPerms, setShowPerms] = useState(false);
  const [locGranted, setLocGranted] = useState<boolean | null>(null);
  const [pushGranted, setPushGranted] = useState<boolean | null>(null);

  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const motoboyId = useMemo(() => user?.id ?? null, [user?.id]);

  // ---------- Oferta atual + fila ----------
  const [ofertaAtual, setOfertaAtual] = useState<OfertaPayload | null>(null);
  const filaOfertas = useRef<OfertaPayload[]>([]);
  const [segundosRestantes, setSegundosRestantes] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mapa: entrega_id -> se tem retorno
  const [hasRetornoById, setHasRetornoById] = useState<Record<number, boolean>>({});

  // ==== Anti-bounce por "versão" de atribuição (id + expira_em) ====
  const handledOffersRef = useRef<Map<string, number>>(new Map()); // key -> timestamp
  const SEEN_WINDOW_MS = 150; // 150ms: só para evitar duplicidade do próprio listener

  function offerKey(entregaId: number, expiraISO?: string | null): string {
    const stamp = expiraISO ? String(Date.parse(expiraISO) || 0) : "noexp";
    return `${entregaId}:${stamp}`;
  }

  function alreadyHandledKey(key: string): boolean {
    const now = Date.now();
    const last = handledOffersRef.current.get(key) ?? 0;
    if (now - last < SEEN_WINDOW_MS) return true;
    handledOffersRef.current.set(key, now);
    return false;
  }

  function clearAllKeysFor(entregaId: number) {
    for (const k of Array.from(handledOffersRef.current.keys())) {
      if (k.startsWith(`${entregaId}:`)) handledOffersRef.current.delete(k);
    }
  }

  // NEW: lista de entregas aceitas
  const [accepted, setAccepted] = useState<AcceptedDelivery[]>(() => getAcceptedDeliveries());

  // NEW: assinar o store ao montar
  useEffect(() => {
    const unsub = subscribeAccepted(setAccepted);
    return () => {
      unsub();
    };
  }, []);

useEffect(() => {
  setHasRetornoById(prev => {
    const next: Record<number, boolean> = { ...prev };
    for (const it of accepted as any[]) {
      if (typeof it?.has_retorno !== 'undefined') {
        next[it.entrega_id] = strictHasRetornoOnly(it);
      } else if (typeof next[it.entrega_id] === 'undefined') {
        next[it.entrega_id] = false;
      }
    }
    return next;
  });
}, [accepted]);



  const navigation = useNavigation<any>();

  function openDetails(e: AcceptedDelivery) {
    navigation.navigate('DeliveryDetails', {
      entrega: {
        id: e.entrega_id,
        // mande o que você já tem pra evitar request extra:
        cliente_nome: e.cliente_nome ?? null,
        coleta_endereco: e.coleta_endereco ?? null,
        entrega_endereco: e.entrega_endereco ?? null,
        valor_total_motoboy: e.valor_total_motoboy ?? null,
      },
    });
  }

  // ----- Som de alarme -----
  const alarmSoundRef = useRef<Audio.Sound | null>(null);
  const tocandoRef = useRef(false);

  const tocarAlarme = useCallback(async () => {
    if (tocandoRef.current) return;
    tocandoRef.current = true;

    try {
      const IM_ANDROID =
        (Audio as any)?.InterruptionModeAndroid?.DoNotMix ??
        (Audio as any)?.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX ??
        undefined;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
        ...(Platform.OS === "android" && IM_ANDROID !== undefined
          ? { interruptionModeAndroid: IM_ANDROID as any }
          : {}),
      });

      const sound = new Audio.Sound();
      await sound.loadAsync(require("../../assets/sounds/clock_alarm_8761.mp3"));
      await sound.setIsLoopingAsync(true);
      await sound.setVolumeAsync(1.0);
      await sound.playAsync();

      alarmSoundRef.current = sound;
    } catch (e) {
      console.warn("[Alarm] Erro ao tocar som:", e);
      tocandoRef.current = false;
    }
  }, []);

  const pararAlarme = useCallback(async () => {
    try {
      if (alarmSoundRef.current) {
        await alarmSoundRef.current.stopAsync().catch(() => {});
        await alarmSoundRef.current.unloadAsync().catch(() => {});
      }
    } catch {}
    alarmSoundRef.current = null;
    tocandoRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      pararAlarme();
    };
  }, [pararAlarme]);

  // ---------- Cronômetro / exibição ----------
  const fecharOferta = useCallback(
    async (abrirProxima: boolean | number = true) => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = null;
      await pararAlarme();
      if (ofertaAtual?.entrega_id) clearAllKeysFor(ofertaAtual.entrega_id); // libera a entrega
      setOfertaAtual(null);
      setSegundosRestantes(null);
      if (abrirProxima && filaOfertas.current.length > 0) {
        const next = filaOfertas.current.shift()!;
        abrirOferta(next);
      }
    },
    [pararAlarme, ofertaAtual]
  );

  const abrirOferta = useCallback(
    async (o: OfertaPayload) => {
      // garante expira_em se não veio no push (diferencia atribuições por instante)
      if (!o.expira_em) {
        o = { ...o, expira_em: new Date(Date.now() + ASSIGN_TTL_MS).toISOString() };
      }

      const k = offerKey(o.entrega_id, o.expira_em);
      const curK = ofertaAtual ? offerKey(ofertaAtual.entrega_id, ofertaAtual.expira_em) : null;

      // não reabrir se MESMA atribuição já está na tela ou já está enfileirada
      if (curK && curK === k) return;
      if (filaOfertas.current.some((x) => offerKey(x.entrega_id, x.expira_em) === k)) return;

      // defesa de backend
      if (!motoboyId) return;
      const stillOk = await checkOfferStillYours(Number(o.entrega_id), motoboyId as number, user?.nome ?? null);
      if (!stillOk) {
        setActiveTab("entregas");
        return;
      }

      setOfertaAtual(o);
      if (countdownRef.current) clearInterval(countdownRef.current);
      const tick = () => {
        const left = secsLeft(o.expira_em);
        setSegundosRestantes(left);
        if (left === 0) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          fecharOferta(false);
        }
      };
      tick();
      countdownRef.current = setInterval(tick, 1000);
      await tocarAlarme();
    },
    [fecharOferta, tocarAlarme, motoboyId, user?.nome, ofertaAtual]
  );

  const enfileirarOuAbrir = useCallback(
    async (o: OfertaPayload) => {
      if (!ofertaAtual) await abrirOferta(o);
      else filaOfertas.current.push(o);
    },
    [ofertaAtual, abrirOferta]
  );

  // ---------- Backend helpers ----------

async function fetchEntregaById(entregaId: number): Promise<any | null> {
  const urls = [
    `/api/entregas-pendentes/${entregaId}`,
    `/entregas-pendentes/${entregaId}`,
  ];
  for (const u of urls) {
    try {
      const { data } = await api.get(u);
      if (data) return data;
    } catch {}
  }
  return null;
}

 function getHasRetornoFor(entregaId: number): boolean {
  if (entregaId in hasRetornoById) return !!hasRetornoById[entregaId];
  const found = accepted.find(x => x.entrega_id === entregaId) as any | undefined;
  if (found && typeof found.has_retorno !== 'undefined') {
    return strictHasRetornoOnly(found);
  }
  return false;
}



  const fetchFiliacao = useCallback(async () => {
    if (!motoboyId) {
      setFiliacao("Nenhum");
      return;
    }
    setLoadingFiliacao(true);
    try {
      const { data } = await api.get(`/api/motoboys/${motoboyId}`);
      const nome = pickFiliacao(data) ?? "Nenhum";
      setFiliacao(nome);
    } catch (e) {
      console.warn("Falha ao buscar filiação:", e);
      setFiliacao("Nenhum");
    } finally {
      setLoadingFiliacao(false);
    }
  }, [motoboyId]);

  // ---------- Push: mapear payload do backend ----------
  const handlePushData = useCallback(
  async (data: any) => {
    const isNova = data?.type === "new_delivery";
    const isCompat = data?.type === "oferta_corrida" || data?.tipo === "oferta";
    if (!(isNova || isCompat)) return;

    const entregaId = Number(data.entrega_id ?? data.id ?? 0);
    if (!entregaId) return;

    // 1) tenta pegar o número público direto do payload do push
    let corridaCode: any =
      data.corrida_code ??
      data.numero_publico ??
      data.codigo_corrida ??
      data.id_publico ??
      null;

    let numeroPublico: any =
      corridaCode ??
      data.numero ??
      data.codigo ??
      data.pedido_numero ??
      null;

    // 2) se ainda não tiver número público, consulta o backend /entregas-pendentes/:id
    if (!numeroPublico) {
      try {
        const fresh = await fetchEntregaById(entregaId);
        if (fresh) {
          corridaCode =
            fresh.corrida_code ??
            fresh.numero_publico ??
            fresh.codigo_corrida ??
            fresh.id_publico ??
            corridaCode;

          numeroPublico =
            corridaCode ??
            fresh.numero ??
            fresh.pedido_numero ??
            entregaId;
        } else {
          numeroPublico = entregaId;
        }
      } catch {
        numeroPublico = entregaId;
      }
    }

    const payload: OfertaPayload = {
      entrega_id: entregaId,
      numero: numeroPublico ?? entregaId,
      cliente_nome: data.cliente_nome ?? data.cliente ?? null,
      coleta_endereco: data.coleta_endereco ?? data.coleta ?? null,
      entrega_endereco: data.entrega_endereco ?? data.entrega ?? null,
      valor_total_motoboy: data.valor_total_motoboy ?? data.comissao ?? null,
      expira_em: data.expira_em ?? null,
      valor_adicional_motoboy:
        data.valor_adicional_motoboy ?? data.valor_adicional ?? null,

      // guarda também os campos crus (se vierem agora ou no futuro)
      corrida_code: corridaCode,
      numero_publico: data.numero_publico ?? null,
      codigo_corrida: data.codigo_corrida ?? null,
      id_publico: data.id_publico ?? null,
    };

    // anti-bounce por atribuição (id + expira_em)
    const key = offerKey(entregaId, payload.expira_em);
    if (alreadyHandledKey(key)) return;

    if (!motoboyId) return;
    const ok = await checkOfferStillYours(entregaId, motoboyId as number, user?.nome ?? null);
    if (!ok) {
      setActiveTab("entregas");
      return;
    }

    await enfileirarOuAbrir(payload);
  },
  [enfileirarOuAbrir, motoboyId, user?.nome] // + fetchEntregaById se o TS reclamar
);


  // ---------- Permissões ----------
  useEffect(() => {
    (async () => {
      try {
        const loc = await Location.getForegroundPermissionsAsync();
        const noti = await Notifications.getPermissionsAsync();
        const okLoc = loc?.granted === true;
        const okNoti = noti?.granted === true;
        setLocGranted(okLoc);
        setPushGranted(okNoti);
        setShowPerms(!(okLoc && okNoti));
      } catch {
        setShowPerms(true);
      }
    })();
  }, []);

  const requestPermsNow = useCallback(async () => {
    try {
      const loc = await Location.requestForegroundPermissionsAsync();
      const noti = await Notifications.requestPermissionsAsync();
      const okLoc = loc?.granted === true;
      const okNoti = noti?.granted === true;
      setLocGranted(okLoc);
      setPushGranted(okNoti);
      setShowPerms(!(okLoc && okNoti));
    } catch {
      setShowPerms(true);
    }
  }, []);

  // ---------- Online/Offline + localização ----------
  const setStatus = useCallback(
    async (status: "Online" | "Offline") => {
      if (!motoboyId) return false;
      try {
        await api.put(`/api/motoboys/${motoboyId}/status`, { off_on: status });
        return true;
      } catch (e) {
        console.warn("Falha ao atualizar off_on:", e);
        return false;
      }
    },
    [motoboyId]
  );

  const sendLoc = useCallback(
    async (lat: number, lon: number) => {
      if (!motoboyId) return;
      try {
        await api.put(`/api/motoboys/${motoboyId}/loc`, { lat, lon });
      } catch (e) {
        console.warn("Falha ao enviar localização:", e);
      }
    },
    [motoboyId]
  );

  const startWatch = useCallback(async () => {
    if (watchRef.current) return;
    try {
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 8000, distanceInterval: 10 },
        (pos) => {
          const { latitude, longitude } = pos.coords || {};
          if (typeof latitude === "number" && typeof longitude === "number") {
            sendLoc(latitude, longitude);
          }
        }
      );
      watchRef.current = sub;
      const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (cur?.coords) sendLoc(cur.coords.latitude, cur.coords.longitude);
    } catch (e) {
      console.warn("watchPosition falhou:", e);
    }
  }, [sendLoc]);

  const stopWatch = useCallback(() => {
    try {
      watchRef.current?.remove?.();
    } catch {}
    watchRef.current = null;
  }, []);

  const goOnline = useCallback(async () => {
    if (!locGranted) {
      setShowPerms(true);
      return;
    }
    const ok = await setStatus("Online");
    if (ok) {
      setIsOnline(true);
      await startWatch();
      fetchFiliacao();
    } else {
      setIsOnline(false);
    }
  }, [locGranted, setStatus, startWatch, fetchFiliacao]);

  const goOffline = useCallback(async () => {
    stopWatch();
    await setStatus("Offline");
    setIsOnline(false);
    fetchFiliacao();
  }, [setStatus, stopWatch, fetchFiliacao]);

  // --------- Montagem / Desmontagem ---------
  useEffect(() => {
    fetchFiliacao();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      fetchFiliacao();
    }, 10000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [fetchFiliacao]);

  // Busca atribuições que ainda estão dentro do prazo (TTL) quando o app volta ao 1º plano
  const fetchPendingAssignment = useCallback(async () => {
    if (!motoboyId) return;
    try {
      const { data } = await api.get(`/api/motoboys/${motoboyId}/novas-atribuicoes`);
      const list = Array.isArray(data) ? data : [];
      if (list.length === 0) return;

      const e = list[0];

const numeroPublico =
  e.corrida_code ??
  e.numero_publico ??
  e.codigo_corrida ??
  e.id_publico ??
  e.numero ??
  e.entrega_id ??
  e.id;

const payload: OfertaPayload = {
  entrega_id: Number(e.entrega_id ?? e.id),
  numero: numeroPublico,
  cliente_nome: e.cliente_nome ?? null,
  coleta_endereco: e.coleta_endereco ?? null,
  entrega_endereco: e.entrega_endereco ?? null,
  valor_total_motoboy: e.valor_total_motoboy ?? null,
  expira_em: e.assign_deadline_at ?? null,
  valor_adicional_motoboy:
    e.valor_adicional_motoboy ?? e.valor_adicional ?? null,

  corrida_code: e.corrida_code ?? null,
  numero_publico: e.numero_publico ?? null,
  codigo_corrida: e.codigo_corrida ?? null,
  id_publico: e.id_publico ?? null,
};



      const ok = await checkOfferStillYours(payload.entrega_id, motoboyId as number, user?.nome ?? null);
      if (!ok) return;

      await enfileirarOuAbrir(payload);
    } catch (err) {
      console.warn("[fetchPendingAssignment] falhou:", err);
    }
  }, [motoboyId, user?.nome, enfileirarOuAbrir]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      const prev = appState.current;
      appState.current = nextState;
      if (prev.match(/inactive|background/) && nextState === "active") {
        fetchFiliacao();
        fetchPendingAssignment();
      }
    });
    return () => {
      sub.remove();
    };
  }, [fetchFiliacao, fetchPendingAssignment]);

  useEffect(() => {
    fetchPendingAssignment();
  }, [fetchPendingAssignment]);

  // --------- Buscar entregas ativas no backend ---------

  // ===== POLLING DE STATUS (a cada 3s) =====
useEffect(() => {
  if (!motoboyId) return;
  if (!accepted.length) return;

  let cancelled = false;

  const tick = async () => {
    try {
      const list = await fetchStatusesForAccepted(motoboyId);
      if (cancelled || !list.length) return;
      applyBackendStatusDiffs(list, accepted, setStageById, setAccepted, hasRetornoById);

    } catch {}
  };

  // primeira rodada
  tick();
  const id = setInterval(tick, 3000);

  return () => {
    cancelled = true;
    clearInterval(id);
  };
}, [motoboyId, accepted, setAccepted, hasRetornoById]);

// ===== ENTREGAS ATIVAS NA MONTAGEM =====
useEffect(() => {
  if (!motoboyId) return;

  (async () => {
    try {
      const { data } = await api.get(`/api/motoboys/${motoboyId}/entregas-ativas`);
      const arr = Array.isArray(data) ? data : [];

      // Guarda TUDO que precisamos localmente (incluindo has_retorno)
      const list: AcceptedDelivery[] = arr.map((e: any) => {
  const numeroPublico =
    e.corrida_code ??
    e.numero_publico ??
    e.codigo_corrida ??
    e.id_publico ??
    e.numero ??
    e.entrega_id ??
    e.id;

  return {
    entrega_id: Number(e.entrega_id ?? e.id),
    numero: numeroPublico,
    cliente_nome: e.cliente_nome ?? null,
    coleta_endereco: e.coleta_endereco ?? null,
    entrega_endereco: e.entrega_endereco ?? null,
    valor_total_motoboy: e.valor_total_motoboy ?? null,
    valor_adicional_motoboy:
      e.valor_adicional_motoboy ?? e.valor_adicional ?? null,
    has_retorno: e.has_retorno,
  } as any;
});


      setAcceptedDeliveries(list);

      // Espelha APENAS o has_retorno do backend no mapa local
      setHasRetornoById(() => {
        const next: Record<number, boolean> = {};
        for (const e of arr as any[]) {
          const id = Number(e.entrega_id ?? e.id);
          if (!Number.isFinite(id)) continue;
          // coerceBoolStrict: true/false/1/0/'sim'/'nao'...
          next[id] = coerceBoolStrict(e?.has_retorno);
        }
        return next;
      });
    } catch (err) {
      console.warn("Falha ao buscar entregas ativas:", err);
    }
  })();
}, [motoboyId]);


  useEffect(() => () => stopWatch(), [stopWatch]);

  // ---------- Notificações ----------
  useEffect(() => {
    if (Platform.OS === "android") {
      Notifications.setNotificationChannelAsync("ofertas-alta", {
        name: "Ofertas",
        importance: Notifications.AndroidImportance.MAX,
        sound: "alarm",
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (!motoboyId) return;
      try {
        const tokenResp = await Notifications.getExpoPushTokenAsync({
          projectId:
            (Constants?.expoConfig as any)?.extra?.eas?.projectId ??
            (Constants as any)?.easConfig?.projectId ??
            undefined,
        });
        const token = tokenResp?.data;
        if (!token) return;

        await api.post(`/api/motoboys/${motoboyId}/push-token`, { token }).catch(async () => {
          await api.post(`/motoboys/${motoboyId}/push-token`, { token }).catch(() => {});
        });
      } catch (e) {
        console.warn("Falha ao registrar push token:", e);
      }
    })();
  }, [motoboyId]);

  useEffect(() => {
    const sub1 = Notifications.addNotificationReceivedListener((n) => {
      const data = (n?.request?.content?.data || {}) as any;
      handlePushData(data);
    });
    const sub2 = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response?.notification?.request?.content?.data || {}) as any;
      handlePushData(data);
    });
    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, [handlePushData]);

  // ---------- Aceitar / Recusar (rotas novas) ----------
  const aceitarEntrega = useCallback(
    async (entregaId: number) => {
      if (!motoboyId) return false;
      try {
        const r = await api.post(`/api/entregas-pendentes/${entregaId}/accept`, { motoboy_id: motoboyId });
        return r.status >= 200 && r.status < 300;
      } catch {
        try {
          const r2 = await api.post(`/entregas-pendentes/${entregaId}/accept`, { motoboy_id: motoboyId });
          return r2.status >= 200 && r2.status < 300;
        } catch {
          return false;
        }
      }
    },
    [motoboyId]
  );

  const rejeitarEntrega = useCallback(
    async (entregaId: number) => {
      if (!motoboyId) return false;
      try {
        const r = await api.post(`/api/entregas-pendentes/${entregaId}/reject`, { motoboy_id: motoboyId });
        return r.status >= 200 && r.status < 300;
      } catch {
        try {
          const r2 = await api.post(`/entregas-pendentes/${entregaId}/reject`, { motoboy_id: motoboyId });
          return r2.status >= 200 && r2.status < 300;
        } catch {
          return false;
        }
      }
    },
    [motoboyId]
  );

  const sincronizarLogisticaDepoisDoAccept = useCallback(async (_entregaId: number) => {
    // Mantido como no seu código original. Se precisar, adaptamos.
    return true;
  }, []);

  // ---------- Botões do modal ----------
const aceitarOferta = useCallback(async () => {
  if (!ofertaAtual) return;

  await pararAlarme();

  const entregaId = Number(ofertaAtual.entrega_id);
  if (!entregaId) {
    Alert.alert("Erro", "Entrega inválida.");
    return;
  }

  const numeroPublico =
  (ofertaAtual as any).corrida_code ??
  (ofertaAtual as any).numero_publico ??
  (ofertaAtual as any).codigo_corrida ??
  (ofertaAtual as any).id_publico ??
  ofertaAtual.numero ??
  entregaId;

  // 1) confirma no backend
  const ok = await aceitarEntrega(entregaId);
  if (!ok) {
    Alert.alert("TEMPO EXPIRADO", "Não foi possível aceitar a entrega. Tempo de atribuição expirada");
    return;
  }

  // 2) captura SOMENTE o adicional (usa aliases se necessário)
  const adicionalRaw =
    (ofertaAtual as any).valor_adicional_motoboy ??
    (ofertaAtual as any).valor_adicional ??
    (ofertaAtual as any).adicional_motoboy ??
    0;

  const adicionalNum = parseNumberBR(adicionalRaw);
const immediateHas =
  typeof (ofertaAtual as any).has_retorno !== 'undefined'
    ? coerceBool((ofertaAtual as any).has_retorno)
    : (adicionalNum > 0);

setHasRetornoById(prev => ({ ...prev, [entregaId]: immediateHas }));


  // 3) persiste localmente (sem has_retorno)
  // ... confirmou ok no backend ...

// Persiste provisório
addAcceptedDelivery({
  entrega_id: entregaId,
  numero: numeroPublico,
  cliente_nome: ofertaAtual.cliente_nome ?? null,
  coleta_endereco: ofertaAtual.coleta_endereco ?? null,
  entrega_endereco: ofertaAtual.entrega_endereco ?? null,
  valor_total_motoboy: ofertaAtual.valor_total_motoboy ?? null,
  has_retorno: false,
} as any);

// Hidrata do backend e fixa has_retorno
try {
  const fresh = await fetchEntregaById(entregaId);
  if (fresh) {
  const has = strictHasRetornoOnly(fresh);

  const numeroPublicoFresh =
    fresh.corrida_code ??
    fresh.numero_publico ??
    fresh.codigo_corrida ??
    fresh.id_publico ??
    fresh.numero ??
    entregaId;

  setHasRetornoById(prev => ({ ...prev, [entregaId]: has }));

  setAccepted(prev =>
    prev.map(x =>
      x.entrega_id === entregaId
        ? {
            ...x,
            numero: numeroPublicoFresh,
            valor_total_motoboy:
              fresh.valor_total_motoboy ?? x.valor_total_motoboy,
            has_retorno: fresh.has_retorno,
          } as any
        : x
    )
  );

  const synced = getAcceptedDeliveries().map(x =>
    x.entrega_id === entregaId
      ? {
          ...x,
          numero: numeroPublicoFresh,
          valor_total_motoboy:
            fresh.valor_total_motoboy ?? x.valor_total_motoboy,
          has_retorno: fresh.has_retorno,
        } as any
      : x
  );
  setAcceptedDeliveries(synced);
}

} catch {}

  // libera chaves/fecha modal e vai para lista
  clearAllKeysFor(entregaId);
  await fecharOferta();
  setActiveTab("entregas");
}, [ofertaAtual, aceitarEntrega, fecharOferta, pararAlarme]);

const rejeitarOferta = useCallback(async () => {
  if (!ofertaAtual) return;

  await pararAlarme();

  const entregaId = Number(ofertaAtual.entrega_id);
  if (!entregaId) {
    Alert.alert("Erro", "Entrega inválida.");
    return;
  }

  const ok = await rejeitarEntrega(entregaId);
  if (!ok) {
    Alert.alert("TEMPO EXPIRADO", "Não foi possível rejeitar a entrega. Tempo de atribuição expirada.");
    return;
  }

  clearAllKeysFor(entregaId);
  await fecharOferta();
}, [ofertaAtual, rejeitarEntrega, fecharOferta, pararAlarme]);


  // ---------- Cores ----------
  const gold = theme?.colors?.gold ?? "#D4AF37";
  const grey = theme?.colors?.muted ?? "#666";
  const green = "#22c55e";
  const red = "#ef4444";
  const card = theme?.colors?.card ?? "#111";
  const border = theme?.colors?.borderDark ?? "#333";
  const text = theme?.colors?.text ?? "#fff";
  const bg = theme?.colors?.bg ?? "#000";
  const goldSoft = "#b0891f";

  // ====== NOVO: lógica do botão de "Pressionar por 3s" ======
  // Estágio por entrega (coletar -> entregar -> finalizar)
  const [stageById, setStageById] = useState<Record<number, Stage>>({});
  // loading de requisição de status
  const [holdLoadingIds, setHoldLoadingIds] = useState<Set<number>>(new Set());
  // marca se o último onLongPress(3s) completou — para não abrir modal de erro no onPressOut
  const longPressOkRef = useRef<Set<number>>(new Set());
  // modal de erro de hold curto
  const [showHoldError, setShowHoldError] = useState(false);

   // 👉 NOVOS MODAIS
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showMapaModal, setShowMapaModal] = useState(false);

  function labelFromStage(_entregaId: number, s: Stage): string {
  if (s === 'coletar')  return 'Coletar';
  if (s === 'entregar') return 'Entregar';
  if (s === 'retornar') return 'Retornar';
  return 'Finalizar entrega';
}

function nextStage(entregaId: number, s: Stage): Stage {
  const hasRet = getHasRetornoFor(entregaId);

  if (s === 'coletar')  return 'entregar';
  if (s === 'entregar') return hasRet ? 'retornar' : 'finalizar';
  if (s === 'retornar') return 'finalizar';
  return 'finalizar';
}



  // inicializa estágio padrão para novas entregas aceitas
  useEffect(() => {
    setStageById((prev) => {
      const draft: Record<number, Stage> = { ...prev };
      for (const e of accepted) {
        if (!draft[e.entrega_id]) draft[e.entrega_id] = 'coletar';
      }
      return draft;
    });
  }, [accepted]);

  // Atualiza status no backend (com fallback sem /api)
  async function updateEntregaStatus(entregaId: number, newStatus: string): Promise<boolean> {
    const urls = [
      `/api/entregas-pendentes/${entregaId}/status`,
      `/entregas-pendentes/${entregaId}/status`,
    ];
    for (const u of urls) {
      try {
        const r = await api.put(u, { status: newStatus });
        if (r?.status >= 200 && r?.status < 300) return true;
      } catch {}
    }
    return false;
  }

  /** Normaliza string de status vinda do backend */
function normStatus(s?: any): string {
  const t = String(s ?? '').trim().toLowerCase();
  if (!t) return 'novo';
  if (t === 'await' || t === 'waiting' || t === 'pendente') return 'novo';
  return (
    { iniciado:'iniciado', coletando:'coletando', entregando:'entregando', 'no cliente':'no cliente', retornando:'retornando', finalizado:'finalizado', novo:'novo' } as Record<string,string>
  )[t] ?? t;
}

/** Converte status do backend para o "stage" do botão */
function statusToStage(status: string, hasRetorno: boolean): Stage {
  const s = normStatus(status);
  if (s === 'coletando') return 'entregar';
  if (s === 'entregando') return hasRetorno ? 'retornar' : 'finalizar';
  if (s === 'retornando') return 'finalizar';
  // "novo" ou "iniciado"
  return 'coletar';
}

/** Tenta buscar apenas {entrega_id, status} das entregas "ativas" desse motoboy */
async function fetchStatusesForAccepted(motoboyId: number): Promise<Array<{ entrega_id: number; status: string }>> {
  // Endpoints tentados por ordem de eficiência (use os que você tiver)
  const urls = [
    '/api/entregas-pendentes/statuses',
    '/entregas-pendentes/statuses'
  ];

  for (const u of urls) {
    try {
      const { data } = await api.get(u);
      const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
      if (!arr.length) continue;

      // normaliza para {entrega_id, status}
      const out = arr
  .map((e: any) => ({
    entrega_id: Number(e.entrega_id ?? e.id ?? e.entregaId ?? e.entregaID),
    status: String(e.status ?? e.state ?? e.situacao ?? 'Novo'),
  }))
  .filter((x: { entrega_id: number }) => Number.isFinite(x.entrega_id));

      if (out.length) return out;
    } catch (_e) {}
  }

  return [];
}

/** Atualiza estágio e remove se virou novo/finalizado/cancelado
 *  OU se a entrega nem veio do endpoint (missing => considerar concluída) */
function applyBackendStatusDiffs(
  backendList: Array<{ entrega_id: number; status: string }>,
  acceptedNow: AcceptedDelivery[],
  setStage: React.Dispatch<React.SetStateAction<Record<number, Stage>>>,
  setAcceptedList: (xs: AcceptedDelivery[]) => void,
  hasRetornoMap: Record<number, boolean>
) {
  if (!acceptedNow.length) return;

  const byId = new Map(backendList.map(x => [Number(x.entrega_id), normStatus(x.status)]));
  const keep: AcceptedDelivery[] = [];

  for (const e of acceptedNow) {
    const norm = byId.get(e.entrega_id);

    if (typeof norm === 'string') {
      // Se backend diz que virou finalizado/cancelado/novo, removemos
      if (norm === 'finalizado' || norm === 'cancelado' || norm === 'novo') {
        continue;
      }
      keep.push(e);
      continue;
    }

    // Se o endpoint não trouxe essa entrega, consideramos concluída => remove
    continue;
  }

  if (keep.length !== acceptedNow.length) {
    setAcceptedDeliveries(keep);
    setAcceptedList(keep);
  }

  setStage(prev => {
    const draft = { ...prev };

    for (const e of keep as any[]) {
      const s = byId.get(e.entrega_id);
      if (!s) continue;

      // ==== has_retorno: somente fonte oficial ====
      // 1) mapa quente (preenchido quando carregamos /entregas-ativas ou após accept)
      let hasRet: boolean | undefined = hasRetornoMap[e.entrega_id];

      // 2) caso não tenha no mapa, usa o campo vindo com o item aceito (se existir)
      if (typeof hasRet === 'undefined') {
        // AcceptedDelivery pode (ou não) carregar has_retorno. Se houver, respeita.
        const rawHas = (e as any)?.has_retorno;
        hasRet = typeof rawHas !== 'undefined' ? coerceBoolStrict(rawHas) : false;
      }

      draft[e.entrega_id] = statusToStage(s, !!hasRet);
    }

    return draft;
  });
}

function coerceBool(v: any): boolean {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'sim' || s === 'yes' || s === 'y') return true;
  if (s === '0' || s === 'false' || s === 'nao' || s === 'não' || s === 'no' || s === 'n') return false;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n > 0 : false;
}

function coerceBoolStrict(v: any): boolean {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'sim' || s === 'yes' || s === 'y';
}

/** Só vale o campo do backend */
function strictHasRetornoOnly(data: any): boolean {
  return coerceBoolStrict(data?.has_retorno);
}

function pickHasRetorno(data: any): boolean {
  return strictHasRetornoOnly(data);
}

/** Regra *estrita*:
 *  1) Se vier has_retorno do backend, **usa ele** (ponto).
 *  2) Se não vier, olha valor_adicional_motoboy/aliases > 0.
 *  3) Caso contrário, assume **false** (nada de adivinhar).
 */
function strictHasRetorno(data: any): boolean {
  if (typeof data?.has_retorno !== 'undefined') return coerceBool(data.has_retorno);
  const raw = data?.valor_adicional_motoboy ?? data?.valor_adicional ?? data?.adicional_motoboy ?? 0;
  return parseNumberBR(raw) > 0;
}

  // Long-press concluído (>= 3s)
  const onHoldSuccess = useCallback(async (entregaId: number) => {
  longPressOkRef.current.add(entregaId);

  const current = stageById[entregaId] ?? 'coletar';

  if (current === 'finalizar') {
    if (!motoboyId) return;
    setHoldLoadingIds(s => new Set(s).add(entregaId));
    const ok = await finalizarEntrega(entregaId, motoboyId as number);
    setHoldLoadingIds(s => { const n = new Set(s); n.delete(entregaId); return n; });

    if (ok) {
      setAccepted(prev => prev.filter(x => x.entrega_id !== entregaId));
      setAcceptedDeliveries(getAcceptedDeliveries().filter(x => x.entrega_id !== entregaId));
      Alert.alert('Finalizado', 'Entrega finalizada com sucesso.');
    } else {
      Alert.alert('Falha', 'Não foi possível finalizar a entrega no servidor.');
    }
    return;
  }

  let newStatus: string = 'Coletando';
  if (current === 'entregar') newStatus = 'Entregando';
  else if (current === 'retornar') newStatus = 'Retornando';

  setHoldLoadingIds(s => new Set(s).add(entregaId));
  const ok = await updateEntregaStatus(entregaId, newStatus);
  setHoldLoadingIds(s => { const n = new Set(s); n.delete(entregaId); return n; });

  if (ok) {
    setStageById(prev => ({ ...prev, [entregaId]: nextStage(entregaId, current) }));
  } else {
    Alert.alert('Falha', 'Não foi possível atualizar o status no servidor.');
  }
}, [stageById, motoboyId, hasRetornoById]);


  // Soltou o botão (qualquer tempo). Se não completou 3s, mostra erro.
  const onHoldRelease = useCallback((entregaId: number) => {
    if (longPressOkRef.current.has(entregaId)) {
      longPressOkRef.current.delete(entregaId);
      return;
    }
    setShowHoldError(true);
  }, []);

  async function finalizarEntrega(entregaId: number, motoboyId: number): Promise<boolean> {
  const urls = [
    `/api/entregas-pendentes/${entregaId}/finalizar`,
    `/entregas-pendentes/${entregaId}/finalizar`,
  ];
  for (const u of urls) {
    try {
      const r = await api.post(u, { motoboy_id: motoboyId });
      if (r.status === 204 || (r.status >= 200 && r.status < 300)) return true;
    } catch {}
  }
  return false;
}


  // ---------- Views ----------
  const StatusView = (
  <>
    <View style={{ width: "100%", alignItems: "center", gap: 4 }}>
      <Text style={{ color: text, fontSize: 22, fontWeight: "800" }}>
        Olá, {user?.nome || "Motoboy"} 👋
      </Text>
      <Text style={{ color: grey }}>Autenticado com sucesso.</Text>
    </View>

    <Text style={{ color: text, fontSize: 18, fontWeight: "700", textAlign: "center", marginTop: 6 }}>
      Por favor, nos informe sobre sua situação.
    </Text>

    {/* Card "Vinculado a:" */}
    <View style={{ width: "100%", backgroundColor: card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: border }}>
      <Text style={{ color: grey, marginBottom: 6 }}>
        Vinculado a:{loadingFiliacao ? " (atualizando...)" : ""}
      </Text>
      <Text style={{ color: gold, fontSize: 16, fontWeight: "800" }}>{filiacao}</Text>
    </View>

    {/* === CHECK-IN / CHECK-OUT (2s) — no centro, entre os cards === */}
    <CheckButton
      motoboyId={motoboyId as number | null}
      api={api}
      theme={theme}
      onAfterChange={fetchFiliacao}
    />

    {/* Card OFF / ON */}
    <View style={{ width: "100%", backgroundColor: card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: border, gap: 12 }}>
      <View style={{ flexDirection: "row", borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: border }}>
        <Pressable
          onPress={goOffline}
          style={{
            flex: 1,
            paddingVertical: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: !isOnline ? "rgba(239,68,68,0.12)" : "transparent",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <MaterialCommunityIcons name="map-marker-off-outline" size={20} color={!isOnline ? red : grey} />
            <Text style={{ color: !isOnline ? red : grey, fontWeight: "800" }}>Estou OFF</Text>
          </View>
        </Pressable>
        <View style={{ width: 1, backgroundColor: border }} />
        <Pressable
          onPress={goOnline}
          style={{
            flex: 1,
            paddingVertical: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isOnline ? "rgba(34,197,94,0.10)" : "transparent",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <MaterialCommunityIcons name="map-marker-outline" size={20} color={isOnline ? green : grey} />
            <Text style={{ color: isOnline ? text : grey, fontWeight: "800" }}>Estou ON</Text>
          </View>
        </Pressable>
      </View>
      <Text style={{ color: grey, textAlign: "center", fontSize: 12 }}>Toque para alternar seu status.</Text>
    </View>

    <Pressable
      onPress={() => setActiveTab("entregas")}
      style={{
        width: "100%",
        backgroundColor: card,
        paddingVertical: 14,
        borderRadius: 16,
        alignItems: "center",
        borderWidth: 1,
        borderColor: border,
      }}
    >
      <Text style={{ color: text, fontWeight: "800" }}>Ver entregas</Text>
    </Pressable>
  </>
);


  const EntregasView = accepted.length === 0 ? (
    <View style={{ width: "100%", alignItems: "center", gap: 10 }}>
      <MaterialCommunityIcons name="package-variant-closed" size={42} color={gold} />
      <Text style={{ color: text, fontSize: 18, fontWeight: "800", textAlign: "center" }}>
        Ops... Você não tem nenhuma entrega no momento.
      </Text>
    </View>
  ) : (
    <View style={{ width: "100%", gap: 14 }}>
      {accepted.map((e) => {
        const stage = stageById[e.entrega_id] ?? 'coletar';
        const isLoading = holdLoadingIds.has(e.entrega_id);

        return (
          <View
            key={e.entrega_id}
            style={{
              backgroundColor: card,
              borderRadius: 16,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: border,
            }}
          >
            <View style={{ backgroundColor: "#2e7d32", paddingVertical: 10, paddingHorizontal: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
                <MaterialCommunityIcons name="cube-outline" size={18} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "900", marginLeft: 8 }}>
                  #{String(e.numero ?? e.entrega_id)}
                </Text>
                <Text style={{ color: "#e8f5e9", marginLeft: 10, fontWeight: "700" }}>
                  {e.cliente_nome || "Cliente"}
                </Text>
              </View>
            </View>

            <View style={{ padding: 14, gap: 12 }}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <MaterialCommunityIcons name="map-marker" size={18} color={gold} />
                <Text style={{ color: text, flex: 1 }}>{e.coleta_endereco || "—"}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <MaterialCommunityIcons name="map-marker" size={18} color={gold} />
                <Text style={{ color: text, flex: 1 }}>{e.entrega_endereco || "—"}</Text>
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
                <View style={{ flexDirection: "row", gap: 14, flex: 1 }}>
                  {/* seta -> abre detalhes */}
                  <Pressable onPress={() => openDetails(e)} hitSlop={8}>
                    <MaterialCommunityIcons name="sync" size={20} color={grey} />
                  </Pressable>

                  {/* lápis -> abre detalhes */}
                  <Pressable onPress={() => openDetails(e)} hitSlop={8}>
                    <MaterialCommunityIcons name="pencil-outline" size={20} color={grey} />
                  </Pressable>
                </View>

                {/* === BOTÃO DE PRESS-AND-HOLD (3s) === */}
                <Pressable
                  onLongPress={() => onHoldSuccess(e.entrega_id)}
                  delayLongPress={3000}
                  onPressOut={() => onHoldRelease(e.entrega_id)}
                  style={{
                    backgroundColor: gold,
                    paddingVertical: 12,
                    paddingHorizontal: 22,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: gold,
                    minWidth: 160,
                    alignItems: "center",
                    opacity: isLoading ? 0.6 : 1,
                  }}
                  disabled={isLoading}
                >
                  <Text style={{ color: "#000", fontWeight: "900" }}>
                  {labelFromStage(e.entrega_id, stage)}
                  </Text>

                </Pressable>
              </View>

              {/* DEBUG: mostra se o front entendeu que tem retorno */}
<Text style={{ color: grey, fontSize: 12 }}>
  retorno: {getHasRetornoFor(e.entrega_id) ? 'sim' : 'não'}
</Text>

            </View>
          </View>
        );
      })}
    </View>
  );

    const OpcoesView = (
    <View style={{ width: "100%", gap: 12 }}>
      {[
        {
          label: "Relatório de recebimentos",
          icon: "file-chart",
          onPress: () => navigation.navigate("RecebimentosReport"),
        },
        {
          label: "Mapa de entregas",
          icon: "map-outline",
          onPress: () => setShowMapaModal(true),
        },
        {
          label: "Vagas para agendamento",
          icon: "calendar-clock",
          onPress: () => navigation.navigate("VagasAgendamento"),
        },
        {
          label: "Notificações",
          icon: "bell-outline",
          onPress: () => setShowNotificationsModal(true),
        },
      ].map((item) => (
        <Pressable
          key={item.label}
          onPress={item.onPress}
          style={{
            backgroundColor: card,
            paddingVertical: 14,
            borderRadius: 16,
            alignItems: "center",
            borderWidth: 1,
            borderColor: border,
            flexDirection: "row",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <MaterialCommunityIcons name={item.icon as any} size={20} color={gold} />
          <Text style={{ color: text, fontWeight: "800" }}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  const PerfilView = (
    <View style={{ width: "100%", gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ color: text, fontSize: 20, fontWeight: "800", flex: 1 }}>Perfil</Text>
        <Pressable
          onPress={logout}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: border,
            backgroundColor: "transparent",
          }}
        >
          <Text style={{ color: text, fontWeight: "700" }}>Sair</Text>
        </Pressable>
      </View>

      {[
        { label: "Nome", value: user?.nome || "-" },
        { label: "Celular", value: maskPhone(user?.phone) || "-" },
        { label: "Empresa", value: filiacao !== "Nenhum" ? filiacao : "Sigmha Express" },
      ].map((row) => (
        <View
          key={row.label}
          style={{ backgroundColor: card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: border }}
        >
          <Text style={{ color: grey, marginBottom: 6 }}>{row.label}</Text>
          <Text style={{ color: gold, fontSize: 16, fontWeight: "800" }}>{row.value}</Text>
        </View>
      ))}
    </View>
  );

  const Content = (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        paddingBottom: 220,
      }}
      style={{ alignSelf: "stretch", backgroundColor: bg }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ width: "100%", maxWidth: 480, gap: 18, alignSelf: "center" }}>
        {activeTab === "status" && StatusView}
        {activeTab === "entregas" && EntregasView}
        {activeTab === "opcoes" && OpcoesView}
        {activeTab === "perfil" && PerfilView}
      </View>
    </ScrollView>
  );

  const TabButton = ({ label, icon, tab }: { label: string; icon: string; tab: TabKey }) => {
    const active = activeTab === tab;
    return (
      <Pressable
        onPress={() => setActiveTab(tab)}
        style={{
          flex: 1,
          paddingVertical: 10,
          alignItems: "center",
          justifyContent: "center",
          borderTopWidth: 2,
          borderTopColor: active ? gold : "transparent",
          backgroundColor: active ? "rgba(212, 175, 55, 0.10)" : "transparent",
          borderRadius: 12,
        }}
      >
        <MaterialCommunityIcons name={icon as any} size={22} color={active ? gold : grey} />
        <Text style={{ color: active ? gold : grey, fontSize: 12, marginTop: 2 }}>{label}</Text>
      </Pressable>
    );
  };

  const TabBar = (
    <View
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: 28,
        flexDirection: "row",
        alignItems: "stretch",
        paddingHorizontal: 6,
        paddingVertical: 6,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: card,
        borderRadius: 18,
        shadowColor: "#000",
        shadowOpacity: 0.25,
        shadowRadius: 10,
        elevation: 8,
        gap: 6,
      }}
    >
      <TabButton label="Status" icon="home-outline" tab="status" />
      <TabButton label="Entregas" icon="package-variant" tab="entregas" />
      <TabButton label="Mais opções" icon="dots-grid" tab="opcoes" />
      <TabButton label="Perfil" icon="account-outline" tab="perfil" />
    </View>
  );

  const PermsModal = (
    <Modal visible={showPerms} transparent animationType="fade">
      <View style={{ flex: 1, backgroundColor: "#000B", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View
          style={{
            width: "100%",
            maxWidth: 520,
            backgroundColor: bg,
            borderRadius: 18,
            overflow: "hidden",
            borderWidth: 1.2,
            borderColor: gold,
          }}
        >
          <View style={{ padding: 16, borderBottomWidth: 1, borderColor: gold + "55", backgroundColor: "transparent" }}>
            <Text
              style={{
                fontWeight: "900",
                fontSize: 18,
                color: gold,
                textAlign: "center",
                letterSpacing: 0.3,
              }}
            >
              Permissões necessárias
            </Text>
          </View>
          <View style={{ padding: 18, gap: 10 }}>
            <Text style={{ color: text, opacity: 0.9, fontSize: 14 }}>
              Para funcionar corretamente, precisamos de:
            </Text>
            <View style={{ gap: 8 }}>
              <Text style={{ color: locGranted ? gold : goldSoft, fontWeight: "800" }}>
                • Localização em tempo real: {locGranted ? "Concedida" : "Pendente"}
              </Text>
              <Text style={{ color: pushGranted ? gold : goldSoft, fontWeight: "800" }}>
                • Notificações: {pushGranted ? "Concedida" : "Pendente"}
              </Text>
            </View>
          </View>
          <View
            style={{
              padding: 14,
              borderTopWidth: 1,
              borderColor: gold + "55",
              backgroundColor: "transparent",
              flexDirection: "row",
              justifyContent: "center",
            }}
          >
            <Pressable
              onPress={requestPermsNow}
              style={{
                paddingVertical: 12,
                paddingHorizontal: 18,
                backgroundColor: gold,
                borderRadius: 12,
                minWidth: 180,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#000", fontWeight: "900", letterSpacing: 0.3 }}>Permitir agora</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  // Modal de erro de hold curto (preto+dourado)
  const HoldErrorModal = (
    <Modal visible={showHoldError} transparent animationType="fade" onRequestClose={() => setShowHoldError(false)}>
      <View style={{ flex: 1, backgroundColor: "#000C", alignItems: "center", justifyContent: "center", padding: 18 }}>
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            backgroundColor: bg,
            borderRadius: 18,
            overflow: "hidden",
            borderWidth: 1.2,
            borderColor: gold,
          }}
        >
          <View style={{ padding: 14, borderBottomWidth: 1, borderColor: gold + "55" }}>
            <Text style={{ color: gold, fontWeight: "900", fontSize: 18, textAlign: "center" }}>ERRO!</Text>
          </View>
          <View style={{ padding: 16 }}>
            <Text style={{ color: gold, fontWeight: "800", textAlign: "center" }}>
              Precisa pressionar o botão por 3 segundos
            </Text>
          </View>
          <View style={{ padding: 12, borderTopWidth: 1, borderColor: gold + "55", alignItems: "center" }}>
            <Pressable
              onPress={() => setShowHoldError(false)}
              style={{ backgroundColor: gold, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12 }}
            >
              <Text style={{ color: "#000", fontWeight: "900" }}>OK</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

    const NotificationsModal = (
    <Modal
      visible={showNotificationsModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowNotificationsModal(false)}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "#000C",
          alignItems: "center",
          justifyContent: "center",
          padding: 18,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            backgroundColor: bg,
            borderRadius: 18,
            overflow: "hidden",
            borderWidth: 1.2,
            borderColor: gold,
          }}
        >
          <View
            style={{
              padding: 14,
              borderBottomWidth: 1,
              borderColor: gold + "55",
            }}
          >
            <Text
              style={{
                color: gold,
                fontWeight: "900",
                fontSize: 18,
                textAlign: "center",
              }}
            >
              Notificações
            </Text>
          </View>
          <View style={{ padding: 16 }}>
            <Text
              style={{
                color: text,
                fontWeight: "800",
                textAlign: "center",
              }}
            >
              Nenhuma notificação!
            </Text>
          </View>
          <View
            style={{
              padding: 12,
              borderTopWidth: 1,
              borderColor: gold + "55",
              alignItems: "center",
            }}
          >
            <Pressable
              onPress={() => setShowNotificationsModal(false)}
              style={{
                backgroundColor: gold,
                paddingVertical: 10,
                paddingHorizontal: 18,
                borderRadius: 12,
              }}
            >
              <Text style={{ color: "#000", fontWeight: "900" }}>OK</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

    const MapaModal = (
    <Modal
      visible={showMapaModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowMapaModal(false)}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "#000C",
          alignItems: "center",
          justifyContent: "center",
          padding: 18,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            backgroundColor: bg,
            borderRadius: 18,
            overflow: "hidden",
            borderWidth: 1.2,
            borderColor: gold,
          }}
        >
          <View
            style={{
              padding: 14,
              borderBottomWidth: 1,
              borderColor: gold + "55",
            }}
          >
            <Text
              style={{
                color: gold,
                fontWeight: "900",
                fontSize: 18,
                textAlign: "center",
              }}
            >
              Mapa de entregas
            </Text>
          </View>
          <View style={{ padding: 16 }}>
            <Text
              style={{
                color: text,
                fontWeight: "800",
                textAlign: "center",
              }}
            >
              Em breve...
            </Text>
          </View>
          <View
            style={{
              padding: 12,
              borderTopWidth: 1,
              borderColor: gold + "55",
              alignItems: "center",
            }}
          >
            <Pressable
              onPress={() => setShowMapaModal(false)}
              style={{
                backgroundColor: gold,
                paddingVertical: 10,
                paddingHorizontal: 18,
                borderRadius: 12,
              }}
            >
              <Text style={{ color: "#000", fontWeight: "900" }}>OK</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  const numeroPublicoOferta =
  (ofertaAtual as any)?.corrida_code ??
  (ofertaAtual as any)?.numero_publico ??
  (ofertaAtual as any)?.codigo_corrida ??
  (ofertaAtual as any)?.id_publico ??
  (ofertaAtual as any)?.numero ??
  (ofertaAtual as any)?.entrega_id;

  const OfertaModal = (
    <Modal visible={!!ofertaAtual} transparent animationType="fade" onRequestClose={() => fecharOferta(false)}>
      <View style={{ flex: 1, backgroundColor: "#000C", alignItems: "center", justifyContent: "center", padding: 18 }}>
        <View
          style={{
            width: "100%",
            maxWidth: 520,
            backgroundColor: bg,
            borderRadius: 18,
            overflow: "hidden",
            borderWidth: 1.2,
            borderColor: gold,
          }}
        >
          <View style={{ padding: 14, borderBottomWidth: 1, borderColor: gold + "55" }}>
            <Text style={{ color: gold, fontWeight: "900", fontSize: 18, textAlign: "center" }}>Novas Entregas</Text>
          </View>
          <View style={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ color: text, fontSize: 16, fontWeight: "800", flex: 1 }}>
              Nº {numeroPublicoOferta ?? "—"}
              </Text>
              {!!segundosRestantes && <Text style={{ color: gold, fontWeight: "900" }}>{segundosRestantes}s</Text>}
            </View>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <MaterialCommunityIcons name="storefront-outline" size={20} color={gold} />
              <Text style={{ color: gold, fontWeight: "800" }}>
                {ofertaAtual?.cliente_nome ?? "Cliente"}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
              <MaterialCommunityIcons name="map-marker-outline" size={20} color={text} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: grey, fontSize: 12, marginBottom: 2 }}>Coleta</Text>
                <Text style={{ color: text, fontWeight: "700" }}>
                  {ofertaAtual?.coleta_endereco ?? "—"}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
              <MaterialCommunityIcons name="package-variant" size={20} color={text} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: grey, fontSize: 12, marginBottom: 2 }}>Entrega</Text>
                <Text style={{ color: text, fontWeight: "700" }}>
                  {ofertaAtual?.entrega_endereco ?? "—"}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <MaterialCommunityIcons name="cash-100" size={20} color={text} />
              <Text style={{ color: grey, fontSize: 12 }}>Comissão</Text>
              <Text style={{ color: gold, fontWeight: "900", fontSize: 16 }}>
                {parseMoneyBR(ofertaAtual?.valor_total_motoboy)}
              </Text>
            </View>
          </View>
          <View
            style={{
              padding: 14,
              borderTopWidth: 1,
              borderColor: gold + "55",
              flexDirection: "row",
              gap: 10,
              justifyContent: "center",
            }}
          >
            <Pressable
              onPress={rejeitarOferta}
              style={{
                paddingVertical: 12,
                paddingHorizontal: 20,
                borderRadius: 12,
                backgroundColor: "#8B0000",
                borderWidth: 1,
                borderColor: "#8B0000",
                minWidth: 140,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>Rejeitar</Text>
            </Pressable>
            <Pressable
              onPress={aceitarOferta}
              style={{
                paddingVertical: 12,
                paddingHorizontal: 20,
                borderRadius: 12,
                backgroundColor: gold,
                borderWidth: 1,
                borderColor: gold,
                minWidth: 140,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#000", fontWeight: "900" }}>Aceitar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }}>
      {Content}
      {TabBar}
      {PermsModal}
      {HoldErrorModal}
      {NotificationsModal}
      {MapaModal}
      {OfertaModal}
    </SafeAreaView>
  );
}

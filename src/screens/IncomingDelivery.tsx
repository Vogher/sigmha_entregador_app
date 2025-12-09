import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, BackHandler } from "react-native";
import { api } from "../services/api";
import { addAcceptedDelivery } from "@/states/acceptedDeliveries";
import checkOfferStillYours from "@/utils/offerGuards";

export default function IncomingDelivery({ route, navigation }: any) {
  const { entrega, user } = route.params || {};
  const [seconds, setSeconds] = useState(15);
  const ticking = useRef<ReturnType<typeof setInterval> | null>(null);

  // evita expiração automática depois que o usuário já respondeu
  const respondedRef = useRef<boolean>(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const ok = await checkOfferStillYours(entrega.entrega_id, {
          id: user.id,
          nome: user?.nome ?? null,
        });
        if (!ok) navigation.goBack(); // fecha porque já não é válida
      } catch {
        navigation.goBack();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Expira somente se ninguém respondeu ainda
  useEffect(() => {
    if (seconds === 0 && !respondedRef.current) {
      onReject(true); // true = foi expiração, navega de volta silenciosamente
    }
  }, [seconds]);

  function stopTimer() {
    if (ticking.current) {
      clearInterval(ticking.current);
      ticking.current = null;
    }
    setSeconds(-1);
  }

  async function onAccept() {
    if (busy || respondedRef.current) return;
    respondedRef.current = true;
    stopTimer();
    setBusy(true);
    try {
      await api.post(`/entregas-pendentes/${entrega.entrega_id}/accept`, {
        motoboy_id: user.id,
      });

      // Adiciona ao store usando SOMENTE o código da corrida
      addAcceptedDelivery({
        entrega_id: entrega.entrega_id,
        numero: entrega.codigo_corrida ?? null,
        cliente_nome: entrega.cliente_nome ?? null,
        coleta_endereco: entrega.coleta_endereco ?? null,
        entrega_endereco: entrega.entrega_endereco ?? null,
        valor_total_motoboy: entrega.valor_total_motoboy ?? null,
      });

      // fecha imediatamente e volta para a Home (vai aparecer na aba Entregas)
      navigation.replace("Home");
    } catch (e) {
      // se falhar (ex.: expirou/reatribuída) apenas fecha
      navigation.goBack();
    } finally {
      setBusy(false);
    }
  }

  async function onReject(fromExpire = false) {
    if (busy || respondedRef.current) return;
    respondedRef.current = true;
    stopTimer();
    setBusy(true);
    try {
      await api.post(`/entregas-pendentes/${entrega.entrega_id}/reject`, {
        motoboy_id: user.id,
      });
    } catch {}
    // se foi usuário que tocou, fecha igual; se foi expiração automática, também fecha
    navigation.goBack();
    setBusy(false);
  }

  // Mostra SOMENTE o código da corrida (se não vier, usa "—" para ficar evidente)
  const numeroVisivel = entrega?.codigo_corrida ?? "—";

  return (
    <View style={s.container}>
      <Text style={s.title}>Novas Entregas</Text>
      <View style={s.card}>
        <Text style={s.id}>
          Nº {numeroVisivel} <Text style={s.client}>{entrega?.cliente_nome}</Text>
        </Text>
        <View style={s.sep} />
        <Text style={s.label}>Endereço de Coleta</Text>
        <Text style={s.value}>{entrega?.coleta_endereco}</Text>
        <Text style={[s.label, { marginTop: 10 }]}>Endereço de Entrega</Text>
        <Text style={s.value}>{entrega?.entrega_endereco}</Text>
        <Text style={[s.value, { marginTop: 12 }]}>
          Comissão: R$ {Number(entrega?.valor_total_motoboy || 0).toFixed(2)}
        </Text>
      </View>

      <Text style={s.timer}>Expira em {Math.max(0, seconds)}s</Text>

      <View style={s.row}>
        <TouchableOpacity
          disabled={busy}
          onPress={() => onReject(false)}
          style={[s.btn, s.btnOutline, busy && { opacity: 0.6 }]}
        >
          <Text style={s.btnOutlineText}>Recusar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={busy}
          onPress={onAccept}
          style={[s.btn, s.btnSolid, busy && { opacity: 0.6 }]}
        >
          <Text style={s.btnSolidText}>Iniciar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const GOLD = "#D4AF37";
const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
    marginBottom: 10,
  },
  card: {
    borderWidth: 1,
    borderColor: GOLD,
    borderRadius: 14,
    padding: 16,
    backgroundColor: "#0a0a0a",
  },
  id: { fontSize: 20, fontWeight: "800", color: "#fff" },
  client: { color: "#bbb", fontWeight: "700", fontSize: 16 },
  sep: { height: 1, backgroundColor: GOLD, opacity: 0.5, marginVertical: 10 },
  label: { color: GOLD, fontWeight: "700", fontSize: 12, letterSpacing: 0.5 },
  value: { color: "#fff", fontSize: 14, lineHeight: 20 },
  timer: { color: GOLD, textAlign: "center", marginTop: 16, fontWeight: "700" },
  row: { flexDirection: "row", gap: 12, marginTop: 14, justifyContent: "center" },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 12,
    minWidth: 140,
    alignItems: "center",
  },
  btnOutline: { borderWidth: 1, borderColor: GOLD, backgroundColor: "transparent" },
  btnOutlineText: { color: GOLD, fontWeight: "800" },
  btnSolid: { backgroundColor: GOLD },
  btnSolidText: { color: "#000", fontWeight: "900" },
});

import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  View, Text, ScrollView, Pressable, Modal, Platform, Animated, Easing, SafeAreaView,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useAuth } from "@/context/AuthProvider";
import { api } from "@/services/api";
import { theme } from "@/theme";

/** ===== Utils de moeda/data ===== */
const parseNumberBR = (v: any): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  if (!s) return 0;
  const cleaned = s.replace(/[^\d.,-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};
const fmtMoney = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (d: Date) =>
  `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;

const ymdLocal = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

// agendado_at_br: "DD/MM/AAAA"
const parseBRDate = (s?: string | null): Date | null => {
  if (!s) return null;
  const m = String(s).match(/^\s*(\d{1,2})[\/](\d{1,2})[\/](\d{4})/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (!dd || !mm || !yyyy) return null;
  return new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
};

// posted_at_client: "YYYY-MM-DD"
const parseISODateOnly = (s?: string | null): Date | null => {
  if (!s) return null;
  const m = String(s).match(/^\s*(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (!dd || !mm || !yyyy) return null;
  return new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
};

type Finalizada = {
  entrega_id_origem?: number;
  id?: number;
  coleta_endereco?: string | null;
  entrega_endereco?: string | null;
  km?: number | string | null;
  cliente_nome?: string | null;
  valor_total_motoboy?: number | string | null;
  valor_adicional_motoboy?: number | string | null;
  created_at?: string | null;
  finalizado_at?: string | null;
  agendado_at_br?: string | null;
  posted_at_client?: string | null;

  // campos que vêm do backend pra saber de quem é a entrega
  atribuido_motoboy?: string | null;
  entregador_nome?: string | null;
  motoboy_nome?: string | null;

  _entregaDate?: Date | null;
  _entregaYMD?: string | null;
};

type Lancamento = {
  id: number;
  tipo_transacao: "Credito" | "Debito";
  valor: number;
  data_card?: string | null;  // preferível para Turno Fixo
  created_at?: string | null; // fallback
  observacoes?: string | null;
};

function useTapHintAnimation(enabled: boolean) {
  const handY = useRef(new Animated.Value(0)).current;
  const ripple = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!enabled) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(handY, { toValue: -6, duration: 550, useNativeDriver: true, easing: Easing.inOut(Easing.quad)}),
        Animated.timing(handY, { toValue: 0,  duration: 550, useNativeDriver: true, easing: Easing.inOut(Easing.quad)}),
      ])
    );
    const rippleLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(ripple, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(ripple, { toValue: 0, duration: 0,  useNativeDriver: true }),
        Animated.delay(200),
      ])
    );
    loop.start(); rippleLoop.start();
    return () => { loop.stop(); rippleLoop.stop(); };
  }, [enabled, handY, ripple]);

  const rippleStyle = {
    transform: [{ scale: ripple.interpolate({ inputRange:[0,1], outputRange:[0.6, 1.5] }) }],
    opacity: ripple.interpolate({ inputRange:[0,1], outputRange:[0.35, 0] }),
  };

  return { handY, rippleStyle };
}

// helper pra identificar crédito de Turno Fixo por observação
const isTurnoFixoObs = (s?: string | null) => {
  if (!s) return false;
  const n = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return n.startsWith("turno fixo");
};

// normaliza string (remove acento, espaços extras e põe em minúsculo)
const normalizeStr = (s?: string | null) =>
  s
    ? s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
    : "";

// tenta pegar o nome completo do motoboy logado
const getMotoboyFullName = (user: any): string =>
  String(
    user?.nome_completo ??
      user?.nome ??
      user?.full_name ??
      user?.name ??
      ""
  ).trim();

export default function RecebimentosReport() {
  const { user } = useAuth();
  const gold = theme?.colors?.gold ?? "#D4AF37";
  const text = theme?.colors?.text ?? "#fff";
  const bg   = theme?.colors?.bg ?? "#000";
  const card = theme?.colors?.card ?? "#111";
  const border = theme?.colors?.borderDark ?? "#333";
  const muted = theme?.colors?.muted ?? "#909090";

  // ===== offset para “descer” tudo =====
  const TOP_GAP = 75;

  // datas
  const [dIni, setDIni] = useState<Date | null>(null);
  const [dFim, setDFim] = useState<Date | null>(null);

  // UI
  const [openEntregas, setOpenEntregas] = useState(false);
  const [openTurnoFixo, setOpenTurnoFixo] = useState(false);
  const [openTurnoMin, setOpenTurnoMin] = useState(false);
  const [openDebitos, setOpenDebitos] = useState(false);
  const [openCreditos, setOpenCreditos] = useState(false);
  const [loading, setLoading] = useState(false);

  // dados
  const [rows, setRows] = useState<Finalizada[]>([]);
  const [creditos, setCreditos] = useState<Lancamento[]>([]);
  const [debitos, setDebitos]   = useState<Lancamento[]>([]);

  const needBothDates = !dIni || !dFim;
  const showHint = needBothDates;

  const { handY, rippleStyle } = useTapHintAnimation(showHint);

  // === totais de entregas / débitos simples ===
  const totalEntregas = useMemo(
    () => rows.reduce((acc, it) => acc + parseNumberBR(it.valor_total_motoboy), 0),
    [rows]
  );
  const totalDebitos = useMemo(
    () => debitos.reduce((acc, it) => acc + (Number(it.valor) || 0), 0),
    [debitos]
  );

  // === separar Turnos (Fixo) de Créditos (geral) ===
  const turnosFixo = useMemo(() => {
    // normaliza datas para exibição por data_card (preferencial)
    return creditos
      .filter(c => c.tipo_transacao === "Credito" && isTurnoFixoObs(c.observacoes))
      .map(c => {
        const dPref = c.data_card ? parseISODateOnly(c.data_card) : (c.created_at ? new Date(c.created_at) : null);
        const dataView = dPref ? fmtDate(dPref) : "—";
        return { ...c, _dataView: dataView, _dateObj: dPref } as any;
      })
      .sort((a: any, b: any) => {
        const da = a._dateObj ? a._dateObj.getTime() : 0;
        const db = b._dateObj ? b._dateObj.getTime() : 0;
        return da - db;
      });
  }, [creditos]);

  const creditosGerais = useMemo(
    () => creditos.filter(c => !(c.tipo_transacao === "Credito" && isTurnoFixoObs(c.observacoes))),
    [creditos]
  );

  const totalTurnoFixo = useMemo(
    () => turnosFixo.reduce((acc: number, it: any) => acc + (Number(it.valor) || 0), 0),
    [turnosFixo]
  );

  const totalCreditosGerais = useMemo(
    () => creditosGerais.reduce((acc, it) => acc + (Number(it.valor) || 0), 0),
    [creditosGerais]
  );

  // === Total geral: Entregas + Turnos(Fixo) + Créditos(geral) – Débitos ===
  const totalGeral = useMemo(
    () => totalEntregas + totalTurnoFixo + totalCreditosGerais - totalDebitos,
    [totalEntregas, totalTurnoFixo, totalCreditosGerais, totalDebitos]
  );

  const feitosCount = rows.length;
  const feitosTurnos = turnosFixo.length;

  const temRetorno = (it: Finalizada) =>
    parseNumberBR(it.valor_adicional_motoboy ?? 0) > 0 ? "Sim" : "Não";

  const pickEntregaDate = (row: Finalizada): Date | null => {
    const ag = row.agendado_at_br && row.agendado_at_br !== "0" ? row.agendado_at_br : null;
    const po = row.posted_at_client && row.posted_at_client !== "0" ? row.posted_at_client : null;
    const byAg = parseBRDate(ag);
    if (byAg) return byAg;
    const byPo = parseISODateOnly(po);
    if (byPo) return byPo;
    return null;
  };

  const fetchFinalizadas = useCallback(async (fromISO: string, toISO: string) => {
    if (!user?.id) return [];
    const qs = `from=${fromISO}&to=${toISO}&motoboy_id=${user.id}&status=Finalizado`;
    const urls = [
      `/api/entregas-finalizadas?${qs}`,
      `/entregas-finalizadas?${qs}`,
      `/api/motoboys/${user.id}/entregas-finalizadas?from=${fromISO}&to=${toISO}`,
    ];
    for (const u of urls) {
      try {
        const { data } = await api.get(u);
        const arr: any[] = Array.isArray(data) ? data : Array.isArray((data as any)?.data) ? (data as any).data : [];
        if (arr.length >= 0) return arr as Finalizada[];
      } catch {}
    }
    return [];
  }, [user?.id]);

  // ===== buscar créditos/débitos do motoboy no período (preferindo data_card no filtro) =====
    const fetchCredDeb = useCallback(async (fromISO: string, toISO: string) => {
    if (!user?.id) return { creditos: [], debitos: [] as Lancamento[] };
    const qs = `limit=1000&sort=data_desc&entregador=${user.id}&de=${fromISO}&ate=${toISO}`;
    const urls = [
      `/api/credito-debito?${qs}`,
      `/credito-debito?${qs}`,
    ];
    let arr: any[] = [];
    for (const u of urls) {
      try {
        const { data } = await api.get(u);
        const list: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        if (Array.isArray(list)) { arr = list; break; }
      } catch {}
    }

    // Preferimos filtrar por data_card (dia contábil do turno); se ausente, cai no created_at.
    const inRange = (it:any) => {
      const pickISO = (iso?: string | null) => {
        if (!iso) return null;
        const m = String(iso).match(/^\s*(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return null;
        return `${m[1]}-${m[2]}-${m[3]}`;
      };
      const cardISO = pickISO(it.data_card);
      const createdISO = it.created_at ? (() => {
        const d = new Date(it.created_at);
        const y = d.getFullYear();
        const m = String(d.getMonth()+1).padStart(2,"0");
        const dd = String(d.getDate()).padStart(2,"0");
        return `${y}-${m}-${dd}`;
      })() : null;

      const ref = cardISO || createdISO;
      if (!ref) return false;
      return ref >= fromISO && ref <= toISO;
    };

    const mine = arr.filter(it => String(it.entregador_card) === String(user.id) && inRange(it));
    const map = (it:any): Lancamento => ({
      id: Number(it.id),
      tipo_transacao: String(it.tipo_transacao) === "Debito" ? "Debito" : "Credito",
      valor: Number(it.valor) || 0,
      data_card: it.data_card,
      created_at: it.created_at,
      observacoes: it.observacoes || null,
    });

    const creditos = mine.filter(x => String(x.tipo_transacao).toLowerCase() === "credito").map(map);
    const debitos  = mine.filter(x => String(x.tipo_transacao).toLowerCase() === "debito").map(map);
    return { creditos, debitos };
  }, [user?.id]);

  const load = useCallback(async () => {
  if (!dIni || !dFim) return;
  setLoading(true);
  try {
    const from = ymdLocal(dIni);
    const to   = ymdLocal(dFim);

    // 1) Busca todas as finalizadas no período
    const listRaw = await fetchFinalizadas(from, to);

    // 2) Nome do motoboy logado (normalizado)
    const selfName = getMotoboyFullName(user);
    const selfNorm = normalizeStr(selfName);

    // 3) Filtra por atribuido_motoboy (ou campos equivalentes) comparando nomes
    const listByMotoboy: Finalizada[] =
      selfNorm
        ? listRaw.filter((raw: any) => {
            const atrib =
              raw.atribuido_motoboy ??
              raw.entregador_nome ??
              raw.motoboy_nome ??
              null;

            return normalizeStr(atrib) === selfNorm;
          })
        : listRaw;

    // 4) Aplica filtro de data e ordenação como antes
    const filtered: Finalizada[] = listByMotoboy
      .map((raw) => {
        const d = pickEntregaDate(raw);
        return { ...raw, _entregaDate: d, _entregaYMD: d ? ymdLocal(d) : null };
      })
      .filter(
        (it) =>
          it._entregaYMD &&
          it._entregaYMD >= from &&
          it._entregaYMD <= to
      )
      .sort((a, b) =>
        (a._entregaYMD || "").localeCompare(b._entregaYMD || "")
      );

    setRows(filtered);

    // 5) Créditos/Débitos continuam iguais
    const { creditos, debitos } = await fetchCredDeb(from, to);
    setCreditos(creditos);
    setDebitos(debitos);
  } finally {
    setLoading(false);
  }
}, [dIni, dFim, fetchFinalizadas, fetchCredDeb, user]);

  useEffect(() => { if (!needBothDates) load(); }, [needBothDates, load]);

  /** Picker de data */
  const [pickerVisible, setPickerVisible] = useState<null | "ini" | "fim">(null);
  const [pickerDate, setPickerDate] = useState<Date>(new Date());

  const openPicker = (which: "ini" | "fim") => {
    const base = which === "ini" ? (dIni ?? new Date()) : (dFim ?? dIni ?? new Date());
    setPickerDate(base);
    setPickerVisible(which);
  };

  const onPickerChange = (which: "ini" | "fim") => (e: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === "android") {
      if (e.type === "set" && date) {
        if (which === "ini") setDIni(date);
        else setDFim(date);
      }
      setPickerVisible(null); // fecha sempre
    } else {
      if (date) setPickerDate(date);
    }
  };

  const confirmIOSPicker = () => {
    if (pickerVisible === "ini") setDIni(pickerDate);
    if (pickerVisible === "fim") setDFim(pickerDate);
    setPickerVisible(null);
  };

  /** Cabeçalho “Total” */
  const HeaderTotal = (
    <View style={{ backgroundColor: card, borderRadius: 18, borderWidth: 1, borderColor: gold, overflow:"hidden" }}>
      <View style={{ paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: gold + "55", flexDirection:"row", alignItems:"center" }}>
        <Text style={{ color: text, fontWeight:"900", fontSize: 24, flex: 1 }}>Total</Text>
        <Text style={{ color: gold, fontWeight:"900", fontSize: 22 }}>{fmtMoney(totalGeral)}</Text>
      </View>

      {/* datas */}
      <View style={{ flexDirection:"row", padding: 16, gap: 12 }}>
        {/* Data inicial */}
        <View style={{ flex:1 }}>
          <Text style={{ color: muted, marginBottom: 6, fontWeight:"700" }}>Data inicial</Text>
          <Pressable
            onPress={() => openPicker("ini")}
            style={{
              height: 42, borderRadius: 12, borderWidth: 1, borderColor: gold + "55",
              justifyContent:"center", paddingHorizontal: 12, backgroundColor: "#00000022",
              overflow:"visible"
            }}
          >
            <Text style={{ color: text, fontWeight:"800" }}>
              {dIni ? fmtDate(dIni) : "— — / — — / — —"}
            </Text>

            {showHint && !dIni && (
              <View style={{ position:"absolute", right: 10, top: -4 }}>
                <Animated.View style={[{ position:"absolute", width: 30, height:30, borderRadius: 30, borderWidth: 2, borderColor: gold }, rippleStyle]} />
                <Animated.View style={{ transform:[{ translateY: handY }] }}>
                  <MaterialCommunityIcons name="gesture-tap" size={28} color={gold} />
                </Animated.View>
              </View>
            )}
          </Pressable>
        </View>

        {/* Data final */}
        <View style={{ flex:1 }}>
          <Text style={{ color: muted, marginBottom: 6, fontWeight:"700" }}>Data final</Text>
          <Pressable
            onPress={() => openPicker("fim")}
            style={{
              height: 42, borderRadius: 12, borderWidth: 1, borderColor: gold + "55",
              justifyContent:"center", paddingHorizontal: 12, backgroundColor: "#00000022",
              overflow:"visible"
            }}
          >
            <Text style={{ color: text, fontWeight:"800" }}>
              {dFim ? fmtDate(dFim) : "— — / — — / — —"}
            </Text>

            {showHint && !dFim && (
              <View style={{ position:"absolute", right: 10, top: -4 }}>
                <Animated.View style={[{ position:"absolute", width: 30, height:30, borderRadius: 30, borderWidth: 2, borderColor: gold }, rippleStyle]} />
                <Animated.View style={{ transform:[{ translateY: handY }] }}>
                  <MaterialCommunityIcons name="gesture-tap" size={28} color={gold} />
                </Animated.View>
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );

  /** Cabeçalho de seção (2 chips: R$ e Feitos) */
  const SectionHeader = ({
    title, amount, count, open, onToggle,
  }: { title: string; amount?: number; count?: number; open: boolean; onToggle: () => void }) => (
    <Pressable
      onPress={onToggle}
      style={{
        backgroundColor: card, borderRadius: 14, borderWidth: 1, borderColor: gold + "55",
        paddingVertical: 14, paddingHorizontal: 16, flexDirection:"row", alignItems:"center", marginTop: 12
      }}
    >
      <Text style={{ color: text, fontSize: 16, fontWeight:"800", flex:1 }}>{title}</Text>

      {!!(typeof amount === "number") && (
        <View style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: "#222", borderWidth: 1, borderColor: border, marginRight: 8 }}>
          <Text style={{ color: gold, fontWeight:"900" }}>{fmtMoney(amount)}</Text>
        </View>
      )}

      {!!(typeof count === "number") && (
        <View style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: "#222", borderWidth: 1, borderColor: border, marginRight: 12 }}>
          <Text style={{ color: gold, fontWeight:"900" }}>Feitos: {count}</Text>
        </View>
      )}

      <MaterialCommunityIcons name={open ? "minus" : "plus"} size={20} color={text} />
    </Pressable>
  );

  /** Lista de entregas */
  const EntregasList = (
    <View style={{ backgroundColor: "#00000010", borderLeftWidth: 2, borderRightWidth: 2, borderBottomWidth: 2, borderColor: gold + "55", borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }}>
      {rows.length === 0 ? (
        <View style={{ padding: 16 }}>
          <Text style={{ color: muted, textAlign:"center", fontWeight:"700" }}>
            {loading ? "Carregando..." : "Você não tem entregas nesse período"}
          </Text>
        </View>
      ) : (
        <View style={{ padding: 8, gap: 8 }}>
          {rows.map((it, idx) => {
  const code = (String((it as any)?.corrida_code || "").trim()) || "—";
  // mantém uma key estável; se quiser pode continuar usando id na key
  const key = (it.entrega_id_origem ?? it.id ?? code ?? idx) as any;

  return (
    <View key={String(key) + "_" + idx} style={{ backgroundColor: card, borderRadius: 12, borderWidth: 1, borderColor: border, padding: 12 }}>
      <View style={{ flexDirection:"row", marginBottom: 6 }}>
        <Text style={{ color: gold, fontWeight:"900" }}>ID:&nbsp;</Text>
        <Text style={{ color: text, fontWeight:"800" }}>#{code}</Text>
      </View>

      <Row label="Data da entrega" value={it._entregaDate ? fmtDate(it._entregaDate) : "—"} />
      <Row label="Ponto de coleta" value={it.coleta_endereco || "—"} />
      <Row label="Ponto de entrega" value={it.entrega_endereco || "—"} />
      <Row label="KM" value={String(it.km ?? "—")} />
      <Row label="Estabelecimento" value={it.cliente_nome || "—"} />
      <Row label="Valor R$" value={fmtMoney(parseNumberBR(it.valor_total_motoboy))} />
      <Row label="Tem Retorno?" value={temRetorno(it)} />
    </View>
  );
})}

        </View>
      )}
    </View>
  );

  /** NOVO — Lista de Turnos (Fixo) */
  const TurnosFixoList = (
    <View style={{ backgroundColor: "#00000010", borderLeftWidth: 2, borderRightWidth: 2, borderBottomWidth: 2, borderColor: gold + "55", borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }}>
      {turnosFixo.length === 0 ? (
        <View style={{ padding: 16 }}>
          <Text style={{ color: muted, textAlign:"center", fontWeight:"700" }}>
            {loading ? "Carregando..." : "Você não tem turnos fixos nesse período"}
          </Text>
        </View>
      ) : (
        <View style={{ padding: 8, gap: 8 }}>
          {turnosFixo.map((it: any) => (
            <View key={`tf_${it.id}`} style={{ backgroundColor: card, borderRadius: 12, borderWidth: 1, borderColor: border, padding: 12 }}>
              <Row label="Data do turno" value={it._dataView as string} />
              <Row label="Valor" value={fmtMoney(it.valor)} />
              <Row label="Observações" value={it.observacoes || "—"} />
            </View>
          ))}
        </View>
      )}
    </View>
  );

  /** Créditos (geral, exclui turnos fixos) */
  const CreditosList = (
    <View style={{ backgroundColor: "#00000010", borderLeftWidth: 2, borderRightWidth: 2, borderBottomWidth: 2, borderColor: gold + "55", borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }}>
      {creditosGerais.length === 0 ? (
        <View style={{ padding: 16 }}>
          <Text style={{ color: muted, textAlign:"center", fontWeight:"700" }}>
            {loading ? "Carregando..." : "Você não tem créditos nesse período"}
          </Text>
        </View>
      ) : (
        <View style={{ padding: 8, gap: 8 }}>
          {creditosGerais.map((it) => {
            const d = it.data_card ? parseISODateOnly(it.data_card) : (it.created_at ? new Date(it.created_at) : null);
            return (
              <View key={`c_${it.id}`} style={{ backgroundColor: card, borderRadius: 12, borderWidth: 1, borderColor: border, padding: 12 }}>
                <Row label="Data" value={d ? fmtDate(d) : "—"} />
                <Row label="Valor" value={fmtMoney(it.valor)} />
                <Row label="Observações" value={it.observacoes || "—"} />
              </View>
            );
          })}
        </View>
      )}
    </View>
  );

  const DebitosList = (
    <View style={{ backgroundColor: "#00000010", borderLeftWidth: 2, borderRightWidth: 2, borderBottomWidth: 2, borderColor: gold + "55", borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }}>
      {debitos.length === 0 ? (
        <View style={{ padding: 16 }}>
          <Text style={{ color: muted, textAlign:"center", fontWeight:"700" }}>
            {loading ? "Carregando..." : "Você não tem débitos nesse período"}
          </Text>
        </View>
      ) : (
        <View style={{ padding: 8, gap: 8 }}>
          {debitos.map((it) => {
            const d = it.data_card ? parseISODateOnly(it.data_card) : (it.created_at ? new Date(it.created_at) : null);
            return (
              <View key={`d_${it.id}`} style={{ backgroundColor: card, borderRadius: 12, borderWidth: 1, borderColor: border, padding: 12 }}>
                <Row label="Data" value={d ? fmtDate(d) : "—"} />
                <Row label="Valor" value={fmtMoney(it.valor)} />
                <Row label="Observações" value={it.observacoes || "—"} />
              </View>
            );
          })}
        </View>
      )}
    </View>
  );

  /** Seções “Turnos (Mínimo Garantido)” ainda em breve */
  const Soon = (
    <View style={{ backgroundColor: "#00000010", borderLeftWidth: 2, borderRightWidth: 2, borderBottomWidth: 2, borderColor: gold + "55", borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }}>
      <View style={{ padding: 16 }}>
        <Text style={{ color: muted, textAlign:"center", fontWeight:"700" }}>Em breve</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex:1, backgroundColor: bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: TOP_GAP,
          paddingBottom: 64,
          gap: 12,
        }}
        showsVerticalScrollIndicator
      >
        {/* topo */}
        <View style={{ marginBottom: 6, flexDirection:"row", alignItems:"center" }}>
          <MaterialCommunityIcons name="chevron-left" size={26} color={text} />
          <Text style={{ color: text, fontSize: 20, fontWeight:"900", flex:1, textAlign:"center" }}>
            Relatório de Recebimentos
          </Text>
          <MaterialCommunityIcons name="calendar-month" size={22} color={gold} />
        </View>

        {HeaderTotal}

        {/* Seção Entregas */}
        <View>
          <SectionHeader
            title="Entregas"
            amount={totalEntregas}
            count={feitosCount}
            open={openEntregas}
            onToggle={() => setOpenEntregas(v => !v)}
          />
          {openEntregas && EntregasList}
        </View>

        {/* Turnos (Fixo) */}
        <View>
          <SectionHeader
            title="Turnos (Fixo)"
            amount={totalTurnoFixo}
            count={feitosTurnos}
            open={openTurnoFixo}
            onToggle={() => setOpenTurnoFixo(v => !v)}
          />
          {openTurnoFixo && TurnosFixoList}
        </View>

        {/* Turnos (Mínimo Garantido) */}
        <View>
          <SectionHeader title="Turnos (Mínimo Garantido)" open={openTurnoMin} onToggle={() => setOpenTurnoMin(v => !v)} />
          {openTurnoMin && Soon}
        </View>

        {/* Débitos */}
        <View>
          <SectionHeader title="Débitos" amount={-totalDebitos} open={openDebitos} onToggle={() => setOpenDebitos(v => !v)} />
          {openDebitos && DebitosList}
        </View>

        {/* Créditos (geral, sem turnos fixos) */}
        <View>
          <SectionHeader title="Créditos" amount={totalCreditosGerais} open={openCreditos} onToggle={() => setOpenCreditos(v => !v)} />
          {openCreditos && CreditosList}
        </View>
      </ScrollView>

      {/* ANDROID: sem Modal (evita tela escura) */}
      {Platform.OS === "android" && pickerVisible !== null && (
        <DateTimePicker
          value={pickerDate}
          mode="date"
          display="calendar"
          onChange={onPickerChange(pickerVisible)}
          maximumDate={new Date(2100, 11, 31)}
          minimumDate={new Date(2020, 0, 1)}
        />
      )}

      {/* iOS: com Modal */}
      {Platform.OS === "ios" && (
        <Modal transparent visible={pickerVisible !== null} animationType="fade" onRequestClose={() => setPickerVisible(null)}>
          <View style={{ flex:1, backgroundColor:"#0008", justifyContent:"flex-end" }}>
            <View style={{ backgroundColor: "#111", paddingTop: 8, borderTopLeftRadius:16, borderTopRightRadius:16, borderWidth: 1, borderColor: border }}>
              <DateTimePicker
                value={pickerDate}
                mode="date"
                display="spinner"
                onChange={pickerVisible ? onPickerChange(pickerVisible) : undefined}
                maximumDate={new Date(2100, 11, 31)}
                minimumDate={new Date(2020, 0, 1)}
              />
              <View style={{ flexDirection:"row", justifyContent:"space-between", padding: 10 }}>
                <Pressable onPress={() => setPickerVisible(null)} style={{ padding:10 }}>
                  <Text style={{ color: muted, fontWeight:"700" }}>Cancelar</Text>
                </Pressable>
                <Pressable onPress={confirmIOSPicker} style={{ padding:10 }}>
                  <Text style={{ color: gold, fontWeight:"900" }}>OK</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

/** Linha de detalhe (label forte + valor) */
function Row({ label, value }: { label: string; value: string }) {
  const gold = theme?.colors?.gold ?? "#D4AF37";
  const text = theme?.colors?.text ?? "#fff";
  return (
    <View style={{ marginVertical: 3 }}>
      <Text style={{ color: gold, fontWeight:"800", marginBottom: 2 }}>{label}</Text>
      <Text style={{ color: text }}>{value}</Text>
    </View>
  );
}

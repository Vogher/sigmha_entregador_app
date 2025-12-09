// src/screens/VagasAgendamentoScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  ActivityIndicator,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import { useNavigation } from "@react-navigation/native";
import { useAuth } from "@/context/AuthProvider";
import { api } from "@/services/api";
import { theme } from "@/theme";

type VagaAgendamento = {
  id: number;
  data_inicial: string | null;
  hora_inicial: string | null;
  data_final: string | null;
  hora_final: string | null;
  unidade_estabelecimento: string | null;
  a_pagar: string | number | null;
};

// --------- UTC ↔ Brasília conversions ---------

/**
 * Converte ISO 8601 datetime UTC para o timezone de Brasília (America/Sao_Paulo)
 * Retorna um objeto Date ajustado para Brasília
 */
function utcToBrasilia(isoUTC: string): Date {
  // Cria data a partir do ISO string (assume UTC)
  const utcDate = new Date(isoUTC);
  
  // Brasília é UTC-3 (quando não está em horário de verão)
  // Usamos a API intl para obter o offset correto do timezone
  const brasiliaFormatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = brasiliaFormatter.formatToParts(utcDate);
  const brasiliaObj = Object.fromEntries(
    parts.map((p) => [p.type, p.value])
  ) as Record<string, string>;

  const brasiliaDate = new Date(
    `${brasiliaObj.year}-${brasiliaObj.month}-${brasiliaObj.day}T${brasiliaObj.hour}:${brasiliaObj.minute}:${brasiliaObj.second}`
  );

  return brasiliaDate;
}

/**
 * Extrai apenas a data (YYYY-MM-DD) a partir de um ISO 8601 string UTC
 * Converte para Brasília primeiro
 */
function extractDateBrasilia(isoUTC: string | null): string | null {
  if (!isoUTC) return null;
  try {
    const brasiliaDate = utcToBrasilia(isoUTC);
    const year = brasiliaDate.getFullYear();
    const month = String(brasiliaDate.getMonth() + 1).padStart(2, "0");
    const day = String(brasiliaDate.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch {
    return isoUTC;
  }
}

/**
 * Extrai apenas a hora (HH:MM) a partir de um ISO 8601 string UTC
 * Converte para Brasília primeiro
 */
function extractTimeBrasilia(isoUTC: string | null): string | null {
  if (!isoUTC) return null;
  try {
    const brasiliaDate = utcToBrasilia(isoUTC);
    const hour = String(brasiliaDate.getHours()).padStart(2, "0");
    const minute = String(brasiliaDate.getMinutes()).padStart(2, "0");
    return `${hour}:${minute}`;
  } catch {
    return isoUTC;
  }
}

export default function VagasAgendamentoScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const motoboyId = user?.id ?? null;

  const gold = theme?.colors?.gold ?? "#D4AF37";
  const grey = theme?.colors?.muted ?? "#666";
  const text = theme?.colors?.text ?? "#fff";
  const bg = theme?.colors?.bg ?? "#000";
  const card = theme?.colors?.card ?? "#111";
  const border = theme?.colors?.borderDark ?? "#333";

  // Data efetiva usada para filtrar e mostrar no cabeçalho
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  // Data temporária escolhida no picker (antes de confirmar no modal preto)
  const [tempDate, setTempDate] = useState<Date | null>(null);

  // 1º modal (nativo do sistema: branco, com CANCELAR / OK)
  const [showNativePicker, setShowNativePicker] = useState(false);
  // 2º modal (preto+dourado, só com texto da data + Cancelar/Salvar)
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const [loading, setLoading] = useState(false);
  const [vagas, setVagas] = useState<VagaAgendamento[]>([]);
  const [error, setError] = useState<string | null>(null);

  // --------- Utils de data/horário/dinheiro ---------

  /**
   * Converte uma data local (Date objeto) para YYYY-MM-DD em Brasília
   * Usado ao enviar filtros para o servidor
   */
  const toYMD = (d: Date): string => {
    const brasiliaFormatter = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    const parts = brasiliaFormatter.formatToParts(d);
    const brasiliaObj = Object.fromEntries(
      parts.map((p) => [p.type, p.value])
    ) as Record<string, string>;

    return `${brasiliaObj.year}-${brasiliaObj.month}-${brasiliaObj.day}`;
  };

  const formatHeaderDate = (d: Date): string => {
    try {
      const fmt = new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
      });
      return fmt.format(d); // ex: "terça-feira, 21/10"
    } catch {
      return toYMD(d).split("-").reverse().join("/");
    }
  };

  const formatDateBR = (value: string | null): string => {
    if (!value) return "—";
    // Se value for um ISO 8601 UTC string, converte para Brasília
    if (value.includes("T")) {
      const converted = extractDateBrasilia(value);
      const v = converted?.slice(0, 10) ?? value.slice(0, 10);
      const [y, m, d] = v.split("-");
      if (!y || !m || !d) return value;
      return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
    }
    // Se já for apenas data (YYYY-MM-DD), formata normalmente
    const v = value.slice(0, 10);
    const [y, m, d] = v.split("-");
    if (!y || !m || !d) return value;
    return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
  };

  const formatDateObjBR = (d: Date | null): string => {
    if (!d) return "—";
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const formatTimeHM = (value: string | null): string => {
    if (!value) return "—";
    // Se value for um ISO 8601 UTC string, converte para Brasília
    if (value.includes("T")) {
      const converted = extractTimeBrasilia(value);
      if (!converted) return "—";
      return converted;
    }
    // Se já for apenas hora (HH:MM), formata normalmente
    const parts = value.split(":");
    if (parts.length >= 2) {
      return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
    }
    return value;
  };

  const parseNumberBR = (v: any): number => {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const s = String(v).trim();
    if (!s) return 0;
    const cleaned = s
      .replace(/[^\d.,-]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  };

  const formatMoneyBR = (v: any): string => {
    const num = parseNumberBR(v);
    return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  // --------- Carregar vagas para o motoboy + data selecionada ---------

  const loadVagas = useCallback(async () => {
    if (!motoboyId) {
      setVagas([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const dateParam = toYMD(selectedDate);

      // GET /vagas-agendamento/motoboy/:motoboyId?date=YYYY-MM-DD
      const { data } = await api.get(
        `api/vagas-agendamento/motoboy/${motoboyId}`,
        {
          params: { date: dateParam },
        }
      );

      const arr = Array.isArray(data) ? data : [];
      setVagas(
        arr.map((v: any) => ({
          id: Number(v.id),
          data_inicial: v.data_inicial ?? null,
          hora_inicial: v.hora_inicial ?? null,
          data_final: v.data_final ?? null,
          hora_final: v.hora_final ?? null,
          unidade_estabelecimento: v.unidade_estabelecimento ?? null,
          a_pagar: v.a_pagar ?? null,
        }))
      );
    } catch (e) {
      console.warn("[VagasAgendamentoScreen] Falha ao carregar vagas:", e);
      setError("Não foi possível carregar as vagas para esta data.");
      setVagas([]);
    } finally {
      setLoading(false);
    }
  }, [motoboyId, selectedDate]);

  useEffect(() => {
    loadVagas();
  }, [loadVagas]);

  // --------- Fluxo de seleção de data ---------

  // Abrir o PRIMEIRO modal (nativo: branco, com CANCELAR / OK)
  const openDatePicker = () => {
    setTempDate(selectedDate); // baseia-se na data atual
    setShowNativePicker(true);
  };

  // Handler do picker nativo (primeiro modal)
  const onChangeNativePicker = (event: DateTimePickerEvent, newDate?: Date) => {
    if (event.type === "dismissed") {
      // Usuário tocou em CANCELAR no modal branco
      setShowNativePicker(false);
      setTempDate(null);
      return;
    }

    if (event.type === "set" && newDate) {
      // Usuário tocou em OK no modal branco
      setShowNativePicker(false);
      setTempDate(newDate);
      // Agora abrimos o modal preto+dourado de confirmação
      setShowConfirmModal(true);
    }
  };

  // Cancelar no modal preto (não altera selectedDate)
  const cancelConfirm = () => {
    setShowConfirmModal(false);
    setTempDate(null);
  };

  // Salvar no modal preto (confirma a data escolhida e refaz o filtro)
  const confirmDate = () => {
    if (tempDate) {
      setSelectedDate(tempDate);
    }
    setShowConfirmModal(false);
    setTempDate(null);
  };

  const headerLabel = useMemo(
    () => formatHeaderDate(selectedDate),
    [selectedDate]
  );

  // --------- UI ---------

  const hasVagas = vagas.length > 0;
  const dateForConfirmModal = tempDate ?? selectedDate;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }}>
      {/* Header */}
      <View
  style={{
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 45, // <-- empurra o header para baixo
    borderBottomWidth: 1,
    borderBottomColor: border,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: bg,
  }}
>

        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          style={{ padding: 4, marginRight: 8 }}
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color={gold} />
        </Pressable>

        <Pressable onPress={openDatePicker} style={{ flex: 1 }}>
          <Text
            style={{
              color: text,
              fontSize: 18,
              fontWeight: "800",
            }}
          >
            Vagas para agendamento
          </Text>
          <Text
            style={{
              color: gold,
              fontSize: 14,
              marginTop: 2,
              textTransform: "capitalize",
            }}
          >
            {headerLabel}
          </Text>
        </Pressable>

        <Pressable
          onPress={openDatePicker}
          hitSlop={8}
          style={{ padding: 4 }}
        >
          <MaterialCommunityIcons
            name="calendar-month-outline"
            size={22}
            color={gold}
          />
        </Pressable>
      </View>

      {/* Conteúdo */}
      <ScrollView
  style={{ flex: 1, backgroundColor: bg }}
  contentContainerStyle={{
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 60, // empurra todo o conteúdo mais pra baixo
  }}
>

        {!motoboyId && (
          <Text style={{ color: text, textAlign: "center", marginTop: 20 }}>
            Erro: não foi possível identificar o motoboy logado.
          </Text>
        )}

        {motoboyId && (
          <>
            {loading && !hasVagas && (
              <View
                style={{
                  marginTop: 40,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                }}
              >
                <ActivityIndicator size="large" color={gold} />
                <Text style={{ color: text }}>Carregando vagas...</Text>
              </View>
            )}

            {!loading && !hasVagas && (
              <View
                style={{
                  marginTop: 40,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 16,
                }}
              >
                <MaterialCommunityIcons
                  name="clock-alert-outline"
                  size={42}
                  color={gold}
                />
                <Text
                  style={{
                    color: text,
                    fontSize: 16,
                    fontWeight: "700",
                    textAlign: "center",
                    marginTop: 8,
                  }}
                >
                  Não há vagas agendadas confirmadas.
                </Text>
                {error && (
                  <Text
                    style={{
                      color: grey,
                      fontSize: 12,
                      textAlign: "center",
                      marginTop: 4,
                    }}
                  >
                    {error}
                  </Text>
                )}
              </View>
            )}

            {hasVagas && (
              <View style={{ gap: 14 }}>
                {vagas.map((vaga) => (
                  <View
                    key={vaga.id}
                    style={{
                      backgroundColor: card,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: border,
                      padding: 16,
                    }}
                  >
                    {/* Título fixo */}
                    <Text
                      style={{
                        color: gold,
                        fontSize: 16,
                        fontWeight: "900",
                        marginBottom: 8,
                      }}
                    >
                      Vaga confirmada!
                    </Text>

                    {/* Data de início */}
                    <View style={{ marginBottom: 6 }}>
                      <Text
                        style={{
                          color: grey,
                          fontSize: 12,
                          marginBottom: 2,
                        }}
                      >
                        Data de início
                      </Text>
                      <Text
                        style={{
                          color: text,
                          fontSize: 14,
                          fontWeight: "700",
                        }}
                      >
                        {formatDateBR(vaga.data_inicial)}
                      </Text>
                    </View>

                    {/* Horário de início */}
                    <View style={{ marginBottom: 6 }}>
                      <Text
                        style={{
                          color: grey,
                          fontSize: 12,
                          marginBottom: 2,
                        }}
                      >
                        Horário de início
                      </Text>
                      <Text
                        style={{
                          color: text,
                          fontSize: 14,
                          fontWeight: "700",
                        }}
                      >
                        {formatTimeHM(vaga.hora_inicial)}
                      </Text>
                    </View>

                    {/* Data final */}
                    <View style={{ marginBottom: 6 }}>
                      <Text
                        style={{
                          color: grey,
                          fontSize: 12,
                          marginBottom: 2,
                        }}
                      >
                        Data final
                      </Text>
                      <Text
                        style={{
                          color: text,
                          fontSize: 14,
                          fontWeight: "700",
                        }}
                      >
                        {formatDateBR(vaga.data_final)}
                      </Text>
                    </View>

                    {/* Hora do fim do expediente */}
                    <View style={{ marginBottom: 6 }}>
                      <Text
                        style={{
                          color: grey,
                          fontSize: 12,
                          marginBottom: 2,
                        }}
                      >
                        Hora do fim do expediente
                      </Text>
                      <Text
                        style={{
                          color: text,
                          fontSize: 14,
                          fontWeight: "700",
                        }}
                      >
                        {formatTimeHM(vaga.hora_final)}
                      </Text>
                    </View>

                    {/* Estabelecimento */}
                    <View style={{ marginBottom: 6 }}>
                      <Text
                        style={{
                          color: grey,
                          fontSize: 12,
                          marginBottom: 2,
                        }}
                      >
                        Estabelecimento
                      </Text>
                      <Text
                        style={{
                          color: text,
                          fontSize: 14,
                          fontWeight: "700",
                        }}
                      >
                        {vaga.unidade_estabelecimento || "—"}
                      </Text>
                    </View>

                    {/* Valor a receber */}
                    <View style={{ marginTop: 4 }}>
                      <Text
                        style={{
                          color: grey,
                          fontSize: 12,
                          marginBottom: 2,
                        }}
                      >
                        Valor a receber
                      </Text>
                      <Text
                        style={{
                          color: gold,
                          fontSize: 16,
                          fontWeight: "900",
                        }}
                      >
                        {formatMoneyBR(vaga.a_pagar)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* 1º modal: DateTimePicker nativo (branco, com CANCELAR/OK) */}
      {showNativePicker && (
        <DateTimePicker
          value={tempDate ?? selectedDate}
          mode="date"
          display="spinner"
          onChange={onChangeNativePicker}
        />
      )}

      {/* 2º modal: preto+dourado, só confirmação da data */}
      <Modal
        visible={showConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={cancelConfirm}
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
                Selecionar data
              </Text>
            </View>

            <View
              style={{
                padding: 18,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  color: grey,
                  fontSize: 13,
                  marginBottom: 6,
                }}
              >
                Data selecionada
              </Text>
              <Text
                style={{
                  color: gold,
                  fontSize: 20,
                  fontWeight: "900",
                }}
              >
                {formatDateObjBR(dateForConfirmModal)}
              </Text>
            </View>

            <View
              style={{
                padding: 12,
                borderTopWidth: 1,
                borderColor: gold + "55",
                flexDirection: "row",
                justifyContent: "space-between",
              }}
            >
              <Pressable
                onPress={cancelConfirm}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  marginRight: 6,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: border,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: text, fontWeight: "700" }}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={confirmDate}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  marginLeft: 6,
                  borderRadius: 10,
                  backgroundColor: gold,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#000", fontWeight: "900" }}>Salvar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

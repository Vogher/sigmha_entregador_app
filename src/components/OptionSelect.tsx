// src/components/OptionSelect.tsx
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  Text,
  View,
  TextInput,
  FlatList,
} from "react-native";
import { theme } from "@/theme";

export type Option = { label: string; value: string };

type Props = {
  label?: string;
  placeholder?: string;
  value?: string | null;
  onChange: (val: string | null) => void; // aceita null p/ limpar
  options: Option[];
  modalTitle?: string;

  // Novos (opcionais)
  searchable?: boolean;                 // habilita busca dentro do modal
  searchPlaceholder?: string;          // placeholder do campo de busca
  allowClear?: boolean;                // mostra ação "Limpar seleção"
};

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export default function OptionSelect({
  label,
  placeholder = "Selecionar",
  value = null,
  onChange,
  options,
  modalTitle = "Selecionar",
  searchable = true,
  searchPlaceholder = "Buscar...",
  allowClear = true,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState("");

  const current = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value]
  );

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = strip(query);
    return options.filter((o) => strip(o.label).includes(q));
  }, [options, query, searchable]);

  const close = () => {
    setVisible(false);
    setQuery("");
  };

  return (
    <View style={{ marginBottom: 14 }}>
      {label ? (
        <Text style={{ color: theme.colors.text, marginBottom: 6 }}>{label}</Text>
      ) : null}

      <Pressable
        onPress={() => setVisible(true)}
        style={{
          backgroundColor: theme.colors.card,
          borderRadius: theme.radius,
          borderWidth: 1,
          borderColor: theme.colors.borderDark,
          paddingVertical: 12,
          paddingHorizontal: 12,
        }}
      >
        <Text
          style={{
            color: current ? theme.colors.text : theme.colors.muted,
            fontSize: 16,
          }}
          numberOfLines={1}
        >
          {current ? current.label : placeholder}
        </Text>
      </Pressable>

      <Modal
        transparent
        visible={visible}
        animationType="fade"
        onRequestClose={close}
      >
        <Pressable
          onPress={close}
          style={{
            flex: 1,
            backgroundColor: "#000000aa",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              backgroundColor: theme.colors.card,
              borderRadius: theme.radius,
              borderWidth: 1,
              borderColor: theme.colors.gold,
              padding: 16,
              maxHeight: "80%",
              gap: 10,
            }}
          >
            {modalTitle ? (
              <Text
                style={{
                  color: theme.colors.text,
                  fontWeight: "800",
                  fontSize: 18,
                }}
              >
                {modalTitle}
              </Text>
            ) : null}

            {searchable && (
              <TextInput
                placeholder={searchPlaceholder}
                placeholderTextColor={theme.colors.muted}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.borderDark,
                  borderRadius: theme.radius,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  color: theme.colors.text,
                }}
              />
            )}

            {allowClear && current && (
              <Pressable
                onPress={() => {
                  onChange(null);
                  close();
                }}
                style={({ pressed }) => ({
                  alignSelf: "flex-start",
                  paddingVertical: 6,
                  paddingHorizontal: 8,
                  borderWidth: 1,
                  borderColor: theme.colors.borderDark,
                  borderRadius: theme.radius,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ color: theme.colors.muted, fontSize: 14 }}>
                  Limpar seleção
                </Text>
              </Pressable>
            )}

            <FlatList
              data={filtered}
              keyExtractor={(item) => item.value}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    onChange(item.value);
                    close();
                  }}
                  style={({ pressed }) => ({
                    paddingVertical: 12,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{ color: theme.colors.text, fontSize: 16 }}>
                    {item.label}
                  </Text>
                </Pressable>
              )}
              ItemSeparatorComponent={() => (
                <View
                  style={{
                    height: 1,
                    backgroundColor: theme.colors.borderDark,
                  }}
                />
              )}
              style={{ minHeight: 200 }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

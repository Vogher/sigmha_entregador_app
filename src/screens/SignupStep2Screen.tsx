// src/screens/SignupStep2Screen.tsx
import { useMemo, useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  Platform,
  StatusBar,
  KeyboardAvoidingView,
  Image,
  Alert,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../App";
import { theme } from "@/theme";
import BrandLogo from "@/components/BrandLogo";
import PrimaryButton from "@/components/PrimaryButton";
import type { SignupStep1Payload } from "./SignupScreen";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Clipboard from "expo-clipboard";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { finalizarCadastro } from "@/api/signup";
import { API_BASE_URL } from "@/config";

type Nav = NativeStackNavigationProp<RootStackParamList, "SignupStep2">;

type DocType =
  | "foto_entregador"
  | "doc_entregador"
  | "doc_veiculo"
  | "comprovante_residencia";

const REQUIRED_DOCS: readonly DocType[] = [
  "foto_entregador",
  "doc_entregador",
  "doc_veiculo",
  "comprovante_residencia",
] as const;

const TITLES: Record<DocType, string> = {
  foto_entregador: "Foto do entregador",
  doc_entregador: "Documento do entregador",
  doc_veiculo: "Documento do veículo",
  comprovante_residencia: "Comprovante de residência",
};

const LEFT_ICONS: Record<DocType, ReactNode> = {
  foto_entregador: <Ionicons name="person-circle-outline" size={24} color={theme.colors.text} />,
  doc_entregador: <Ionicons name="id-card-outline" size={24} color={theme.colors.text} />,
  doc_veiculo: <Ionicons name="car-outline" size={24} color={theme.colors.text} />,
  comprovante_residencia: <Ionicons name="home-outline" size={24} color={theme.colors.text} />,
};

type LocalFile = {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
  kind: "image" | "pdf" | "other";
  fromCamera?: boolean;
};

function Instructions({ type }: { type: DocType }) {
  const txt = useMemo(() => {
    switch (type) {
      case "foto_entregador":
        return [
          "Tire uma selfie recente, com boa iluminação, mostrando o rosto inteiro.",
          "Sem óculos escuros, boné ou capacete. Fundo neutro ajuda na validação.",
          "Você pode tirar a foto agora ou selecionar da galeria.",
        ];
      case "doc_entregador":
        return [
          "Envie foto do RG ou CNH.",
          "Mostre frente e verso (se necessário) e garanta legibilidade.",
          "Evite reflexos e cortes nas bordas.",
        ];
      case "doc_veiculo":
        return [
          "Envie o documento do veículo (CRLV ou digital).",
          "Dados legíveis: placa, renavam, validade etc.",
          "Se precisar, anexe mais de uma imagem.",
        ];
      case "comprovante_residencia":
        return [
          "Envie um comprovante recente (até 90 dias): água, luz, internet, fatura bancária.",
          "Nome e endereço devem estar visíveis.",
          "Foto plana, sem cortes e sem reflexos fortes.",
        ];
    }
  }, [type]);

  return (
    <View style={{ gap: 8 }}>
      {txt.map((line, i) => (
        <Text key={i} style={{ color: theme.colors.text, fontSize: 14 }}>
          • {line}
        </Text>
      ))}
    </View>
  );
}

export default function SignupStep2Screen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute();
  const { cadastroParcial } = (route.params || {}) as {
    cadastroParcial: SignupStep1Payload;
  };

  // anexos por tipo de documento
  const [files, setFiles] = useState<Record<DocType, LocalFile[]>>({
    foto_entregador: [],
    doc_entregador: [],
    doc_veiculo: [],
    comprovante_residencia: [],
  });

  // modal de instruções/seleção
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState<DocType | null>(null);

  // sub-modal: escolher origem
  const [chooserOpen, setChooserOpen] = useState(false);

  // modal de sucesso (4s)
  const [successOpen, setSuccessOpen] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const openModal = (t: DocType) => {
    setDocType(t);
    setOpen(true);
  };
  const closeModal = () => {
    setOpen(false);
    setDocType(null);
    setChooserOpen(false);
  };

  const addFiles = (t: DocType, newOnes: LocalFile[]) => {
    setFiles((prev) => ({
      ...prev,
      [t]: [...prev[t], ...newOnes],
    }));
  };

  // pickers
  const pickFromCamera = async () => {
    if (!docType) return;

    try {
      const { status, canAskAgain } = await ImagePicker.requestCameraPermissionsAsync();

      const allowed = status === "granted"; // <= aqui corrigido

      if (!allowed) {
        if (!canAskAgain && Platform.OS === "ios") {
          Alert.alert(
            "Permissão necessária",
            "A câmera está sem permissão para o Expo Go.\n\n" +
              "Para liberar: Ajustes > Expo Go > Câmera."
          );
        } else {
          Alert.alert("Permissão negada", "Não foi possível acessar a câmera.");
        }
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.8,
        allowsEditing: false,
        base64: false,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
      });

      if (!result.canceled && result.assets?.length) {
        const a = result.assets[0];
        addFiles(docType, [
          {
            uri: a.uri,
            name: (a as any).fileName || "camera.jpg",
            mimeType: (a as any).mimeType || "image/jpeg",
            size: (a as any).fileSize ?? null,
            kind: "image",
            fromCamera: true,
          },
        ]);
      }
    } catch (err) {
      console.log("[pickFromCamera] erro:", err);
      Alert.alert("Erro", "Não foi possível abrir a câmera.");
    }
  };

  const pickFromGallery = async () => {
    if (!docType) return;

    try {
      const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();

      const allowed = status === "granted"; // <= aqui corrigido

      if (!allowed) {
        if (!canAskAgain && Platform.OS === "ios") {
          Alert.alert(
            "Permissão necessária",
            "A galeria está sem permissão para o Expo Go.\n\n" +
              "Para liberar: Ajustes > Expo Go > Fotos."
          );
        } else {
          Alert.alert("Permissão negada", "Não foi possível acessar a galeria.");
        }
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        quality: 0.8,
        allowsEditing: false,
        base64: false,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
      });

      if (!result.canceled && result.assets?.length) {
        const mapped: LocalFile[] = result.assets.map((a: any) => ({
          uri: a.uri,
          name: a.fileName || "foto.jpg",
          mimeType: a.mimeType || "image/jpeg",
          size: a.fileSize ?? null,
          kind: "image",
        }));
        addFiles(docType, mapped);
      }
    } catch (err) {
      console.log("[pickFromGallery] erro:", err);
      Alert.alert("Erro", "Não foi possível abrir a galeria.");
    }
  };

  const pickFromFiles = async () => {
    if (!docType) return;

    try {
      const result: any = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*"] as any,
        multiple: true as any,
        copyToCacheDirectory: true,
      } as any);

      const canceled = result?.canceled === true || result?.type === "cancel";
      if (canceled) return;

      const assets: any[] =
        Array.isArray(result?.assets) ? result.assets :
        Array.isArray(result?.output) ? result.output :
        result?.type === "success" ? [result] :
        [];

      if (!assets.length) return;

      const mapped: LocalFile[] = assets.map((a: any) => {
        const uri: string = a.uri;
        const name: string =
          a.name || (uri ? uri.split("/").pop() : "arquivo") || "arquivo";
        const mime = a.mimeType || a.type || null;
        const size = a.size ?? null;

        const m = String(mime || "").toLowerCase();
        let kind: LocalFile["kind"] = "other";
        if (m.includes("pdf")) kind = "pdf";
        else if (m.includes("image")) kind = "image";

        return { uri, name, mimeType: mime, size, kind };
      });

      if (mapped.length) addFiles(docType, mapped);
    } catch (err) {
      console.log("[pickFromFiles] erro:", err);
      Alert.alert("Erro", "Não foi possível abrir os arquivos.");
    }
  };


  // Helpers de validação
  const missingDocTypes: DocType[] = useMemo(() => {
    return REQUIRED_DOCS.filter((t) => (files[t]?.length || 0) === 0);
  }, [files]);

  const allDocsOk = missingDocTypes.length === 0;

  // finalizar cadastro (POST de tudo apenas aqui)
  const [submitting, setSubmitting] = useState(false);
  const onFinalizar = async () => {
    // Bloqueia se houver pendências
    if (!allDocsOk) {
      const linhas = missingDocTypes.map((t) => `• ${TITLES[t]}`).join("\n");
      Alert.alert(
        "Documentos pendentes",
        `Para finalizar é necessário enviar:\n\n${linhas}`
      );
      return;
    }

    try {
      setSubmitting(true);

      // Envia tudo para /motoboy_cadastro/finalizar (com fotos)
      const out = await finalizarCadastro(API_BASE_URL, cadastroParcial, {
        foto_entregador: files.foto_entregador,
        doc_entregador: files.doc_entregador,
        doc_veiculo: files.doc_veiculo,
        comprovante_residencia: files.comprovante_residencia,
      });

      const id = out?.id;
      if (!id) throw new Error("Servidor não retornou ID do cadastro (finalizar).");

      // sucesso: mostra modal por 4s e depois volta pro Login
      setSuccessOpen(true);
      successTimerRef.current = setTimeout(() => {
        setSuccessOpen(false);
        navigation.reset({
          index: 0,
          routes: [{ name: "Login" as never }],
        });
      }, 4000);
    } catch (e: any) {
      console.log("[Step2 Finalizar] error", e?.message, e?.response?.data);
      const errorMsg = e?.response?.data?.error || e?.message || "Falha ao finalizar";
      
      // Tenta copiar para o clipboard para facilitar o debug
      try {
        await Clipboard.setStringAsync(errorMsg);
      } catch (err) {
        console.log("Erro ao copiar para clipboard:", err);
      }

      Alert.alert(
        "Falha ao finalizar (Copiado)",
        errorMsg
      );
    } finally {
      setSubmitting(false);
    }
  };

  // “safe top” para não cortar título
  const SAFE_TOP = Platform.select({
    android: (StatusBar.currentHeight || 0) + 16,
    ios: 16,
    default: 16,
  });

  // conteúdo do modal: miniaturas e tile de "+"
  const Thumbs = () => {
    if (!docType) return null;
    const list = files[docType];

    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
        {list.map((f, idx) => (
          <View
            key={idx}
            style={{
              width: 72,
              height: 72,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: theme.colors.borderDark,
              overflow: "hidden",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.colors.card,
            }}
          >
            {f.kind === "image" ? (
              <Image source={{ uri: f.uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
            ) : f.kind === "pdf" ? (
              <MaterialCommunityIcons name="file-pdf-box" size={40} color={theme.colors.text} />
            ) : (
              <MaterialCommunityIcons name="file-outline" size={40} color={theme.colors.text} />
            )}
          </View>
        ))}

        {/* tile de adicionar mais */}
        <Pressable
          onPress={() => setChooserOpen(true)}
          style={({ pressed }) => ({
            width: 72,
            height: 72,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: theme.colors.gold,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? "#00000010" : "transparent",
          })}
        >
          <Ionicons name="add" size={28} color={theme.colors.text} />
        </Pressable>
      </View>
    );
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.bg,
        paddingTop: SAFE_TOP,
      }}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingBottom: 40,
            gap: 18,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <BrandLogo />

          <Text
            style={{
              color: theme.colors.text,
              fontSize: 22,
              fontWeight: "800",
              marginTop: 4,
            }}
          >
            Segunda etapa
          </Text>
          <Text style={{ color: theme.colors.muted, marginTop: -4 }}>
            Envie os documentos para validar seu cadastro.
          </Text>

          {/* LISTA DE BOTÕES */}
          <View style={{ marginTop: 8, gap: 12 }}>
            <RowButton
              label="Foto do entregador"
              leftIcon={LEFT_ICONS.foto_entregador}
              onPress={() => openModal("foto_entregador")}
              completed={(files.foto_entregador?.length || 0) > 0}
              count={files.foto_entregador?.length || 0}
            />
            <RowButton
              label="Documento do entregador"
              leftIcon={LEFT_ICONS.doc_entregador}
              onPress={() => openModal("doc_entregador")}
              completed={(files.doc_entregador?.length || 0) > 0}
              count={files.doc_entregador?.length || 0}
            />
            <RowButton
              label="Documento do veículo"
              leftIcon={LEFT_ICONS.doc_veiculo}
              onPress={() => openModal("doc_veiculo")}
              completed={(files.doc_veiculo?.length || 0) > 0}
              count={files.doc_veiculo?.length || 0}
            />
            <RowButton
              label="Comprovante de residência"
              leftIcon={LEFT_ICONS.comprovante_residencia}
              onPress={() => openModal("comprovante_residencia")}
              completed={(files.comprovante_residencia?.length || 0) > 0}
              count={files.comprovante_residencia?.length || 0}
            />
          </View>

          <View style={{ height: 14 }} />

          <PrimaryButton
            title="Finalizar cadastro"
            onPress={onFinalizar}
            loading={submitting}
          />
        </ScrollView>
      </KeyboardAvoidingView>

            {/* MODAL DE INSTRUÇÕES + THUMBS + CHOOSER INLINE */}
      <Modal transparent visible={open} animationType="fade" onRequestClose={closeModal}>
        <Pressable
          onPress={closeModal}
          style={{
            flex: 1,
            backgroundColor: "#00000090",
            padding: 24,
            justifyContent: "center",
          }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              backgroundColor: theme.colors.card,
              borderRadius: theme.radius,
              borderWidth: 1,
              borderColor: theme.colors.borderDark,
              padding: 16,
            }}
          >
            {/* header do modal */}
            <View style={{ paddingRight: 24 }}>
              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: 18,
                  fontWeight: "800",
                  marginBottom: 8,
                }}
              >
                {docType ? TITLES[docType] : ""}
              </Text>
            </View>

            {/* botão X (fechar) */}
            <Pressable
              onPress={closeModal}
              style={{
                position: "absolute",
                right: 10,
                top: 10,
                padding: 6,
              }}
            >
              <Text style={{ color: theme.colors.muted, fontSize: 16 }}>✕</Text>
            </Pressable>

            {/* instruções */}
            {docType && <Instructions type={docType} />}

            {/* MINIATURAS + TILE "+" */}
            <Thumbs />

            {/* ações (botões Selecionar / Pronto) */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "flex-end",
                gap: 12,
                marginTop: 16,
              }}
            >
              <Pressable
                onPress={() => setChooserOpen(true)}
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.gold,
                  borderRadius: theme.radius,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Ionicons name="folder-open-outline" size={18} color={theme.colors.text} />
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                  Selecionar
                </Text>
              </Pressable>

              <Pressable
                onPress={closeModal}
                style={{
                  backgroundColor: theme.colors.gold,
                  borderRadius: theme.radius,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                }}
              >
                <Text style={{ color: "#000", fontWeight: "800" }}>Pronto</Text>
              </Pressable>
            </View>

            {/* OVERLAY "Selecionar de:" DENTRO DO MESMO MODAL */}
            {chooserOpen && (
              <Pressable
                onPress={() => setChooserOpen(false)}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 0,
                  bottom: 0,
                  backgroundColor: "#00000080",
                  justifyContent: "center",
                  alignItems: "center",
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
                    width: "100%",
                  }}
                >
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontWeight: "800",
                      fontSize: 18,
                      marginBottom: 10,
                    }}
                  >
                    Selecionar de:
                  </Text>

                  <ChooserRow
                    icon={
                      <Ionicons
                        name="camera-outline"
                        size={20}
                        color={theme.colors.text}
                      />
                    }
                    label="Tirar foto agora"
                    onPress={async () => {
                      setChooserOpen(false);
                      await pickFromCamera();
                    }}
                  />
                  <View style={{ height: 6 }} />
                  <ChooserRow
                    icon={
                      <Ionicons
                        name="images-outline"
                        size={20}
                        color={theme.colors.text}
                      />
                    }
                    label="Galeria (imagens)"
                    onPress={async () => {
                      setChooserOpen(false);
                      await pickFromGallery();
                    }}
                  />
                  <View style={{ height: 6 }} />
                  <ChooserRow
                    icon={
                      <Ionicons
                        name="document-outline"
                        size={20}
                        color={theme.colors.text}
                      />
                    }
                    label="Arquivos (PDF / Imagens)"
                    onPress={async () => {
                      setChooserOpen(false);
                      await pickFromFiles();
                    }}
                  />
                </Pressable>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>


      {/* MODAL DE SUCESSO (4s) */}
      <Modal transparent visible={successOpen} animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: "#00000080",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: theme.colors.card,
              borderRadius: theme.colors ? theme.radius : 12,
              borderWidth: 1,
              borderColor: theme.colors.borderDark,
              padding: 16,
              width: "85%",
            }}
          >
            <Text
              style={{
                color: theme.colors.text,
                fontSize: 16,
                fontWeight: "800",
                marginBottom: 6,
              }}
            >
              Cadastro realizado com sucesso!
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 14 }}>
              Aguarde a aprovação para poder acessar o aplicativo.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ————— componentes auxiliares —————
function RowButton({
  label,
  leftIcon,
  onPress,
  completed = false,
  count = 0,
}: {
  label: string;
  leftIcon: ReactNode;
  onPress: () => void;
  completed?: boolean;
  count?: number;
}) {
  const RightIcon = completed ? (
    <Ionicons name="checkmark-circle" size={22} color={theme.colors.gold} />
  ) : (
    <Ionicons name="alert-circle-outline" size={22} color={theme.colors.muted} />
  );

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: theme.colors.card,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: completed ? theme.colors.gold : theme.colors.borderDark,
        paddingVertical: 14,
        paddingHorizontal: 12,
        opacity: pressed ? 0.9 : 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      })}
    >
      {/* esquerda: ícone + label */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {leftIcon}
        <View>
          <Text style={{ color: theme.colors.text, fontSize: 16 }}>{label}</Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
            {completed ? `${count} arquivo(s) anexado(s)` : "Pendente"}
          </Text>
        </View>
      </View>

      {/* direita: status */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {RightIcon}
      </View>
    </Pressable>
  );
}

function ChooserRow({
  icon,
  label,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: theme.colors.borderDark,
        paddingVertical: 12,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {icon}
      <Text style={{ color: theme.colors.text, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

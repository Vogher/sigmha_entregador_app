// src/screens/LoginScreen.tsx
import { useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
} from "react-native";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { theme } from "@/theme";
import PrimaryButton from "@/components/PrimaryButton";
import OutlineButton from "@/components/OutlineButton";
import FormTextInput from "@/components/FormTextInput";
import BrandLogo from "@/components/BrandLogo";
import { useAuth } from "@/context/AuthProvider";
import { api } from "@/services/api";

import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../App";

// ========================= Helpers =========================
const onlyDigits = (s: string) => (s || "").replace(/\D/g, "");

/**
 * Normaliza qualquer entrada de telefone para 10–11 dígitos BR:
 * - remove tudo que não for dígito
 * - remove prefixo 55 (se colado com DDI)
 * - remove zero inicial de tronco (eventual)
 * - se sobrar >11, pega os últimos 11 (caso venham com DDI+extras)
 */
function normalizePhoneDigits(input: string) {
  let d = onlyDigits(input);

  if (d.startsWith("55") && d.length >= 12) d = d.slice(2); // remove DDI BR
  if (d.length > 0 && d[0] === "0") d = d.slice(1); // remove tronco
  if (d.length > 11) d = d.slice(-11); // mantém 11 finais

  return d;
}

function maskBRPhone(input: string) {
  const d = normalizePhoneDigits(input).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
}

type PhoneCheckResult = {
  exists: boolean;
  status?: "aprovado" | "pendente" | "desativado" | "rejeitado" | string | null;
  id?: number | string | null;
  name?: string | null;
};

async function checkPhoneStatus(phoneDigits: string): Promise<PhoneCheckResult> {
  const candidates = [
    "/api/motoboy/login/check-phone",
    "/motoboy/login/check-phone",
    "/api/motoboys/check-phone",
    "/motoboys/check-phone",
    "/api/motoboy_cadastro/check-phone",
    "/motoboy_cadastro/check-phone",
  ];

  // tenta GET
  for (const p of candidates) {
    console.log(p)
    try {
      const res = await api.get(p, { params: { phone: phoneDigits } });
      if (res?.data) return normalizeCheckResponse(res.data);
    } catch {}
  }
  // tenta POST
  for (const p of candidates) {
    try {
      const res = await api.post(p, { phone: phoneDigits });
      if (res?.data) return normalizeCheckResponse(res.data);
    } catch {}
  }
  throw new Error("Não foi possível verificar o número agora.");
}

function normalizeCheckResponse(raw: any): PhoneCheckResult {
  const statusRaw = String(
    raw?.status ??
      raw?.situacao ??
      raw?.estado ??
      raw?.aprovacao ??
      ""
  ).toLowerCase();

  const statusList = ["aprovado", "pendente", "desativado", "rejeitado"] as const;
  const status =
    (statusList.find((s) => statusRaw.includes(s)) as
      | "aprovado"
      | "pendente"
      | "desativado"
      | "rejeitado"
      | undefined) ?? (statusRaw || null);

  const exists =
    raw?.exists === true ||
    raw?.found === true ||
    !!raw?.id ||
    !!raw?.motoboy_id ||
    !!statusRaw;

  const id = raw?.id ?? raw?.motoboy_id ?? null;
  const name = raw?.nome ?? raw?.name ?? raw?.motoboy_nome ?? null;

  return { exists: !!exists, status: status ?? null, id, name };
}

// ========================= Form (senha) =========================
const senhaSchema = z.object({
  senha: z.string().min(4, "Mínimo 4 caracteres"),
});
type FormData = z.infer<typeof senhaSchema>;

type Nav = NativeStackNavigationProp<RootStackParamList, "Login">;

export default function LoginScreen() {
  const navigation = useNavigation<Nav>();
  const { login } = useAuth();

  // Etapas: primeiro celular; depois senha
  const [step, setStep] = useState<"phone" | "password">("phone");

  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const [phoneInput, setPhoneInput] = useState("");   // o que o usuário digita/cola (qualquer formato)
  const [phoneMasked, setPhoneMasked] = useState(""); // exibido com máscara
  const [phoneDigits, setPhoneDigits] = useState(""); // apenas dígitos normalizados
  const [phoneError, setPhoneError] = useState<string | undefined>(undefined);
  const [motoboyName, setMotoboyName] = useState<string | null>(null);

  const senhaRef = useRef<TextInput>(null);

  const {
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(senhaSchema),
    defaultValues: { senha: "" },
  });

  const validatePhoneLocally = () => {
    const d = normalizePhoneDigits(phoneInput);
    // aceita 10 ou 11 dígitos (com DDD). Para celulares atuais normalmente 11.
    if (d.length < 10 || d.length > 11) {
      setPhoneError("Digite um celular válido com DDD");
      return false;
    }
    setPhoneError(undefined);
    setPhoneDigits(d);
    return true;
  };

  const handleCheckPhone = async () => {
    if (!validatePhoneLocally()) return;

    try {
      setLoading(true);
      console.log(phoneDigits)
      const res = await checkPhoneStatus(phoneDigits);

      if (!res.exists) {
        Alert.alert("Número não cadastrado", "Verifique o celular informado ou realize seu cadastro.");
        return;
      }

      const status = String(res.status || "").toLowerCase();

      if (status !== "aprovado") {
        const msg =
          status === "pendente"
            ? "Seu cadastro está PENDENTE de aprovação."
            : status === "desativado"
            ? "Seu cadastro está DESATIVADO."
            : status === "rejeitado"
            ? "Seu cadastro foi REJEITADO."
            : `Seu cadastro não está liberado (status: ${res.status ?? "desconhecido"}).`;

        Alert.alert("Acesso indisponível", msg);
        return;
      }

      // aprovado => avança para a etapa da senha
      setMotoboyName(res.name ?? null);
      setStep("password");
      setTimeout(() => senhaRef.current?.focus(), 50);
    } catch (e: any) {
      Alert.alert(
        "Falha ao verificar",
        e?.response?.data?.error || e?.message || "Tente novamente."
      );
    } finally {
      setLoading(false);
    }
  };

  const onSubmitSenha = async ({ senha }: FormData) => {
    if (!validatePhoneLocally()) return;
    try {
      setLoading(true);
      // login por celular: 1º param = dígitos (DDD+numero)
      await login(phoneDigits, senha);
    } catch (e: any) {
      Alert.alert("Falha no login", e?.response?.data?.error || e?.message || "Tente novamente");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
        <BrandLogo />

        <Text
          style={{
            color: theme.colors.text,
            fontSize: 26,
            fontWeight: "800",
            marginBottom: 6,
          }}
        >
          Entrar
        </Text>
        <Text style={{ color: theme.colors.muted, marginBottom: 24 }}>
          {step === "phone"
            ? "Informe seu celular com DDD"
            : motoboyName
            ? `Olá, ${motoboyName}! Agora digite sua senha.`
            : "Digite sua senha para continuar"}
        </Text>

        {/* Celular */}
        <FormTextInput
          label="Celular (com DDD)"
          placeholder="(11) 91234-5678"
          keyboardType="phone-pad"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={18} // tolera colagens com +55, etc.
          returnKeyType={step === "phone" ? "go" : "next"}
          onSubmitEditing={step === "phone" ? handleCheckPhone : () => senhaRef.current?.focus()}
          value={phoneMasked}
          onChangeText={(t) => {
            setPhoneInput(t);
            setPhoneMasked(maskBRPhone(t));      // sempre mostra em máscara BR
            setPhoneError(undefined);
            // atualiza dígitos normalizados em tempo real
            setPhoneDigits(normalizePhoneDigits(t));
            // se editar o celular, volta para a etapa de verificação
            if (step === "password") {
              setStep("phone");
              setMotoboyName(null);
              setValue("senha", "");
            }
          }}
          error={phoneError}
        />

        {/* Quando ainda está na etapa de celular, mostra o botão "Verificar Celular" aqui */}
        {step === "phone" && (
          <View style={{ marginTop: 12 }}>
            <PrimaryButton
              title="Verificar Celular"
              onPress={handleCheckPhone}
              loading={loading}
            />
          </View>
        )}

        {/* Senha — aparece somente após status aprovado */}
        {step === "password" && (
          <>
            <View style={{ height: 12 }} />
            <FormTextInput
              ref={senhaRef}
              label="Senha"
              placeholder="******"
              secureTextEntry={!showPass}
              autoCapitalize="none"
              returnKeyType="go"
              onSubmitEditing={handleSubmit(onSubmitSenha)}
              onChangeText={(t) => setValue("senha", t, { shouldValidate: true })}
              right={
                <Text
                  onPress={() => setShowPass((s) => !s)}
                  style={{ color: theme.colors.gold, fontWeight: "700", paddingLeft: 12 }}
                >
                  {showPass ? "Ocultar" : "Mostrar"}
                </Text>
              }
              error={errors.senha?.message}
            />

            {/* Botão "Entrar" logo abaixo do campo Senha */}
            <View style={{ marginTop: 12 }}>
              <PrimaryButton
                title="Entrar"
                onPress={handleSubmit(onSubmitSenha)}
                loading={loading}
              />
            </View>
          </>
        )}

        {/* Botões secundários */}
        <View style={{ height: 12 }} />
        <OutlineButton
          title="Cadastrar"
          onPress={() => navigation.navigate("Signup")}
        />

        <View style={{ height: 12 }} />
        <OutlineButton
          title="Esqueceu sua senha?"
          onPress={() =>
            Alert.alert(
              "Recuperar senha",
              "Entre em contato com a nossa central para redefinir sua senha."
            )
          }
        />
      </View>
    </KeyboardAvoidingView>
  );
}

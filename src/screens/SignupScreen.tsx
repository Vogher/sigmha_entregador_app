// src/screens/SignupScreen.tsx
import { useRef, useState, useEffect } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
  Modal,
  Pressable,
  ScrollView,
} from "react-native";
import { theme } from "@/theme";
import BrandLogo from "@/components/BrandLogo";
import FormTextInput from "@/components/FormTextInput";
import PrimaryButton from "@/components/PrimaryButton";
import OptionSelect, { Option } from "@/components/OptionSelect";

import { API_BASE, PING_HEALTH_PATH } from "@/services/api"; // não postamos nada na etapa 1
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../App";

type Nav = NativeStackNavigationProp<RootStackParamList, "Signup">;

function onlyDigits(s: string) { return s.replace(/\D+/g, ""); }
function formatPhoneBR(v: string) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}
function formatCPF(v: string) {
  const d = onlyDigits(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}
function formatCNPJ(v: string) {
  const d = onlyDigits(v).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}
function formatDateBR(v: string) {
  const d = onlyDigits(v).slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0,2)}/${d.slice(2)}`;
  return `${d.slice(0,2)}/${d.slice(2,4)}/${d.slice(4)}`;
}
function formatPlate(v: string) {
  const up = v.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 7);
  if (up.length <= 3) return up;
  return `${up.slice(0,3)}-${up.slice(3)}`;
}

const Req = " *";

// Padronizado: values em linha com o backend
const vehicleOptions: Option[] = [
  { label: "Moto",  value: "moto" },
  { label: "Carro", value: "carro" },
  { label: "Bike",  value: "bike" },
  { label: "Van",   value: "van" },
  { label: "Outro", value: "outro" },
];

const pixTypeOptions: Option[] = [
  { label: "CPF", value: "cpf" },
  { label: "CNPJ", value: "cnpj" },
  { label: "Celular", value: "celular" },
  { label: "E-mail", value: "email" },
  { label: "Aleatória", value: "aleatoria" },
];

const BANKS_BR: Option[] = [
  { label: "Banco do Brasil", value: "bb" },
  { label: "Caixa Econômica Federal", value: "caixa" },
  { label: "Bradesco", value: "bradesco" },
  { label: "Itaú Unibanco", value: "itau" },
  { label: "Santander", value: "santander" },
  { label: "BTG Pactual", value: "btg" },
  { label: "Safra", value: "safra" },
  { label: "Banrisul", value: "banrisul" },
  { label: "Banco de Brasília (BRB)", value: "brb" },
  { label: "Banco do Nordeste (BNB)", value: "bnb" },
  { label: "Banco da Amazônia (BASA)", value: "basa" },
  { label: "Nubank", value: "nubank" },
  { label: "Inter", value: "inter" },
  { label: "C6 Bank", value: "c6" },
  { label: "Original", value: "original" },
  { label: "Agibank", value: "agibank" },
  { label: "Banco Pan", value: "pan" },
  { label: "Next", value: "next" },
  { label: "Modal", value: "modal" },
  { label: "Neon", value: "neon" },
  { label: "Mercado Pago", value: "mercadopago" },
  { label: "PagBank (PagSeguro)", value: "pagbank" },
  { label: "Stone (Conta PJ)", value: "stone" },
  { label: "XP Investimentos (Conta)", value: "xp" },
  { label: "Sicredi", value: "sicredi" },
  { label: "Sicoob", value: "sicoob" },
  { label: "Cresol", value: "cresol" },
  { label: "Unicred", value: "unicred" },
  { label: "Banese (SE)", value: "banese" },
  { label: "Banpará (PA)", value: "banpara" },
  { label: "Banestes (ES)", value: "banestes" },
  { label: "Banespa (legado)", value: "banespa" },
  { label: "Badesc (SC)", value: "badesc" },
  { label: "Badesul (RS)", value: "badesul" },
  { label: "Daycoval", value: "daycoval" },
  { label: "Sofisa", value: "sofisa" },
  { label: "Banco Rendimento", value: "rendimento" },
  { label: "BS2", value: "bs2" },
  { label: "Itaú Consignado", value: "itau-consignado" },
  { label: "Acesso Soluções de Pagamento", value: "acesso" },
  { label: "BRL Trust", value: "brltrust" },
  { label: "Omni", value: "omni" },
  { label: "Western Union (Conta)", value: "western" },
  { label: "J.P. Morgan", value: "jpmorgan" },
  { label: "Citibank", value: "citibank" },
  { label: "HSBC (legado)", value: "hsbc" },
];

// Exportamos o tipo para o App.tsx tipar a rota da etapa 2
export type SignupStep1Payload = {
  nome: string;
  celular: string;
  email: string;
  endereco: string;
  modal: string | null;
  placa: string;
  nascimento: string;
  cpf: string;
  cnpj: string | null;

  pay_method: "PIX" | "BANCO" | null;
  pix_type: string | null;
  pix_key: string | null;
  pix_bank: string | null;

  bank_name: string | null;
  agencia: string | null;
  conta: string | null;
};

export default function SignupScreen(){
  const navigation = useNavigation<Nav>();

  // Ping de conectividade (opcional; útil para diagnosticar)
  useEffect(() => {
    console.log("[SIGNUP] baseURL:", API_BASE, "| healthPath:", PING_HEALTH_PATH);
    (async () => {
      try {
        const r = await fetch(`${API_BASE}${PING_HEALTH_PATH}`);
        const t = await r.text();
        console.log("[SIGNUP] PING", PING_HEALTH_PATH, "->", r.status, t);
      } catch (e: any) {
        console.log("[SIGNUP] PING error:", e?.message || e);
      }
    })();
  }, []);

  // estados do formulário
  const [nome, setNome] = useState("");
  const [celular, setCelular] = useState("");
  const [email, setEmail] = useState("");
  const [endereco, setEndereco] = useState("");
  const [modalVeiculo, setModalVeiculo] = useState<string | null>(null);
  const [placa, setPlaca] = useState("");
  const [nascimento, setNascimento] = useState("");
  const [cpf, setCpf] = useState("");
  const [cnpj, setCnpj] = useState("");

  // pagamento
  const [showPayModal, setShowPayModal] = useState(false);
  const [payMethod, setPayMethod] = useState<"PIX" | "BANCO" | null>(null);

  // PIX
  const [pixType, setPixType] = useState<string | null>(null);
  const [pixKey, setPixKey] = useState("");
  const [pixBank, setPixBank] = useState<string | null>(null);

  // Banco
  const [bankName, setBankName] = useState<string | null>(null);
  const [agencia, setAgencia] = useState("");
  const [conta, setConta] = useState("");

  const [saving, setSaving] = useState(false);
  const emailRef = useRef<TextInput>(null);

  const handlePixKeyChange = (text: string) => {
    if (pixType === "cpf") setPixKey(formatCPF(text));
    else if (pixType === "cnpj") setPixKey(formatCNPJ(text));
    else if (pixType === "celular") setPixKey(formatPhoneBR(text));
    else setPixKey(text);
  };

  // validação mínima
  const validate = () => {
    if (!nome || !celular || !email || !endereco || !modalVeiculo || !placa || !nascimento || !cpf) {
      Alert.alert("Campos obrigatórios", "Preencha todos os campos com *.");
      return false;
    }
    if (!payMethod) {
      Alert.alert("Receber Pagamento", "Escolha PIX ou Banco.");
      return false;
    }
    if (payMethod === "PIX" && (!pixType || !pixKey)) {
      Alert.alert("PIX", "Informe o tipo e a chave PIX.");
      return false;
    }
    if (payMethod === "BANCO" && (!bankName || !agencia || !conta)) {
      Alert.alert("Banco", "Informe banco, agência e conta.");
      return false;
    }
    if (nascimento.length !== 10) {
      Alert.alert("Data de nascimento", "Use o formato dd/mm/aaaa.");
      return false;
    }
    return true;
  };

  // Etapa 1: NÃO posta no backend; apenas empacota e navega
  const onProsseguir = async () => {
    if (!validate()) return;
    try {
      setSaving(true);

      const cadastroParcial: SignupStep1Payload = {
        nome: nome.trim(),
        celular: celular.trim(),
        email: email.trim(),
        endereco: endereco.trim(),
        modal: modalVeiculo, // validado acima
        placa: placa.trim(),
        nascimento: nascimento.trim(),
        cpf: cpf.trim(),
        cnpj: cnpj ? cnpj.trim() : null,
        pay_method: payMethod,
        pix_type:   payMethod === "PIX"   ? pixType  : null,
        pix_key:    payMethod === "PIX"   ? pixKey   : null,
        pix_bank:   payMethod === "PIX"   ? pixBank  : null,
        bank_name:  payMethod === "BANCO" ? bankName : null,
        agencia:    payMethod === "BANCO" ? agencia  : null,
        conta:      payMethod === "BANCO" ? conta    : null,
      };

      console.log("[SIGNUP] cadastroParcial ->", cadastroParcial);
      navigation.navigate("SignupStep2", { cadastroParcial });
    } catch (e: any) {
      Alert.alert("Falha", e?.message || "Tente novamente");
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <BrandLogo />
        <Text style={{ color: theme.colors.text, fontSize: 26, fontWeight: "800", marginBottom: 6 }}>
          Crie sua conta
        </Text>

        <FormTextInput
          label={`Nome completo${Req}`}
          placeholder="Seu nome"
          autoCapitalize="words"
          onChangeText={setNome}
          value={nome}
        />

        <FormTextInput
          label={`Celular (DDD)${Req}`}
          placeholder="(00) 00000-0000"
          keyboardType="phone-pad"
          onChangeText={(t) => setCelular(formatPhoneBR(t))}
          value={celular}
        />

        <FormTextInput
          label={`E-mail${Req}`}
          placeholder="seu@email.com"
          keyboardType="email-address"
          autoCapitalize="none"
          returnKeyType="next"
          onChangeText={setEmail}
          value={email}
          ref={emailRef}
        />

        <FormTextInput
          label={`Endereço completo${Req}`}
          placeholder="Rua, número, bairro, cidade"
          onChangeText={setEndereco}
          value={endereco}
        />

        <OptionSelect
          label={`Modal (veículo)${Req}`}
          placeholder="Selecione o tipo de veículo"
          value={modalVeiculo}
          onChange={setModalVeiculo}
          options={vehicleOptions}
          modalTitle="Selecione o tipo de veículo"
          searchable
          searchPlaceholder="Buscar veículo..."
          allowClear
        />

        <FormTextInput
          label={`Placa do veículo${Req}`}
          placeholder="ABC-1D23"
          autoCapitalize="characters"
          onChangeText={(t) => setPlaca(formatPlate(t))}
          value={placa}
        />

        <FormTextInput
          label={`Data de nascimento${Req}`}
          placeholder="dd/mm/aaaa"
          keyboardType="number-pad"
          onChangeText={(t) => setNascimento(formatDateBR(t))}
          value={nascimento}
        />

        <FormTextInput
          label={`CPF${Req}`}
          placeholder="000.000.000-00"
          keyboardType="number-pad"
          onChangeText={(t) => setCpf(formatCPF(t))}
          value={cpf}
        />

        <FormTextInput
          label="CNPJ"
          placeholder="00.000.000/0000-00"
          keyboardType="number-pad"
          onChangeText={(t) => setCnpj(formatCNPJ(t))}
          value={cnpj}
        />

        <View style={{ marginTop: 6, marginBottom: 6 }}>
          <Text style={{ color: theme.colors.text, marginBottom: 6 }}>
            {`Receber Pagamento${Req}`}
          </Text>
          <Pressable
            onPress={() => setShowPayModal(true)}
            style={{
              backgroundColor: theme.colors.card,
              borderRadius: theme.radius,
              borderWidth: 1,
              borderColor: theme.colors.borderDark,
              paddingVertical: 12,
              paddingHorizontal: 12,
            }}
          >
            <Text style={{ color: payMethod ? theme.colors.text : theme.colors.muted, fontSize: 16 }}>
              {payMethod || "Selecionar"}
            </Text>
          </Pressable>
        </View>

        <Modal
          transparent
          visible={showPayModal}
          animationType="fade"
          onRequestClose={() => setShowPayModal(false)}
        >
          <Pressable
            onPress={() => setShowPayModal(false)}
            style={{ flex: 1, backgroundColor: "#000000aa", justifyContent: "center", padding: 24 }}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{
                backgroundColor: theme.colors.card,
                borderRadius: theme.radius,
                borderWidth: 1,
                borderColor: theme.colors.gold,
                padding: 16,
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 18, marginBottom: 10 }}>
                Receber Pagamento
              </Text>

              <Pressable
                onPress={() => { setPayMethod("PIX"); setShowPayModal(false); }}
                style={({ pressed }) => ({ paddingVertical: 12, opacity: pressed ? 0.8 : 1 })}
              >
                <Text style={{ color: theme.colors.text, fontSize: 16 }}>PIX</Text>
              </Pressable>

              <View style={{ height: 4, backgroundColor: theme.colors.borderDark, marginVertical: 6 }} />

              <Pressable
                onPress={() => { setPayMethod("BANCO"); setShowPayModal(false); }}
                style={({ pressed }) => ({ paddingVertical: 12, opacity: pressed ? 0.8 : 1 })}
              >
                <Text style={{ color: theme.colors.text, fontSize: 16 }}>Banco</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>

        {payMethod === "PIX" && (
          <View style={{ marginTop: 10 }}>
            <OptionSelect
              label={`Tipo de chave${Req}`}
              placeholder="Selecione o tipo de chave"
              value={pixType}
              onChange={(val) => { setPixType(val); setPixKey(""); }}
              options={pixTypeOptions}
              modalTitle="Tipo de chave PIX"
              searchable
              searchPlaceholder="Buscar tipo..."
              allowClear
            />

            <FormTextInput
              label={`Chave PIX${Req}`}
              placeholder={
                pixType === "cpf" ? "000.000.000-00"
                : pixType === "cnpj" ? "00.000.000/0000-00"
                : pixType === "celular" ? "(00) 00000-0000"
                : pixType === "email" ? "email@dominio.com"
                : "Chave aleatória"
              }
              keyboardType={pixType === "email" || pixType === "aleatoria" ? "default" : "number-pad"}
              onChangeText={handlePixKeyChange}
              value={pixKey}
            />

            <OptionSelect
              label="Selecione o banco da chave"
              placeholder="Selecione o banco"
              value={pixBank}
              onChange={setPixBank}
              options={BANKS_BR} // <<— mesmas opções completas
              modalTitle="Banco da chave (opcional)"
              searchable
              searchPlaceholder="Buscar banco..."
              allowClear
            />
          </View>
        )}

        {payMethod === "BANCO" && (
          <View style={{ marginTop: 10 }}>
            <OptionSelect
              label={`Selecione seu banco${Req}`}
              placeholder="Selecione o banco"
              value={bankName}
              onChange={setBankName}
              options={BANKS_BR} // <<— lista completa
              modalTitle="Selecione seu banco"
              searchable
              searchPlaceholder="Buscar banco..."
              allowClear
            />
            <FormTextInput
              label={`Agência${Req}`}
              placeholder="0000"
              keyboardType="number-pad"
              onChangeText={(t) => setAgencia(onlyDigits(t).slice(0, 6))}
              value={agencia}
            />
            <FormTextInput
              label={`Conta${Req}`}
              placeholder="000000-0"
              keyboardType="number-pad"
              onChangeText={(t) => setConta(onlyDigits(t).slice(0, 12))}
              value={conta}
            />
          </View>
        )}

        <View style={{ height: 20 }} />
        <PrimaryButton title="Prosseguir" onPress={onProsseguir} loading={saving} />
        <View style={{ height: 28 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// src/types/signup.ts
export type SignupDraft = {
  nome: string;
  celular: string;
  email: string;
  endereco: string;
  modal: string | null;
  placa: string;
  nascimento: string; // dd/mm/aaaa
  cpf: string;
  cnpj: string | null;

  pay_method: "PIX" | "BANCO";
  pix_type: string | null;
  pix_key: string | null;
  pix_bank: string | null;

  bank_name: string | null;
  agencia: string | null;
  conta: string | null;
};

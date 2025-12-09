// src/api/signup.ts
export type LocalFile = {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
  kind: "image" | "pdf" | "other";
};

type Anexos = {
  foto_entregador: LocalFile[];
  doc_entregador: LocalFile[];
  doc_veiculo: LocalFile[];
  comprovante_residencia: LocalFile[];
};

function fixUri(uri: string) {
  // Em geral o Expo já traz "file://". Se não trouxer, adiciona.
  if (uri.startsWith("file://") || uri.startsWith("content://")) return uri;
  return "file://" + uri;
}

function guessName(base: string | null | undefined, fallback: string) {
  if (base && /\.[a-z0-9]{2,4}$/i.test(base)) return base;
  return fallback;
}

function toRNFile(f: LocalFile, fallbackName: string) {
  return {
    uri: fixUri(f.uri),
    // RN usa "type" (não "mimeType")
    type:
      f.mimeType ||
      (f.kind === "image" ? "image/jpeg" :
       f.kind === "pdf"   ? "application/pdf" :
                            "application/octet-stream"),
    name: guessName(f.name || null, fallbackName),
  } as any; // tipo do RN/FormData
}

export async function finalizarCadastro(
  API_BASE_URL: string,
  cadastroParcial: any,
  anexos: Anexos
) {
  const fd = new FormData();

  // Campos de texto
  const payload = {
    nome: cadastroParcial?.nome,
    celular: cadastroParcial?.celular,
    email: cadastroParcial?.email,
    endereco: cadastroParcial?.endereco,
    modal: cadastroParcial?.modal,
    placa: cadastroParcial?.placa,
    nascimento: cadastroParcial?.nascimento, // pode ser dd/mm/aaaa ou yyyy-mm-dd (o backend normaliza)
    cpf: cadastroParcial?.cpf,
    cnpj: cadastroParcial?.cnpj ?? "",
    pay_method: cadastroParcial?.pay_method, // "PIX" | "BANCO"
    pix_type: cadastroParcial?.pix_type ?? "",
    pix_key: cadastroParcial?.pix_key ?? "",
    pix_bank: cadastroParcial?.pix_bank ?? "",
    bank_name: cadastroParcial?.bank_name ?? "",
    agencia: cadastroParcial?.agencia ?? "",
    conta: cadastroParcial?.conta ?? "",
  };

  Object.entries(payload).forEach(([k, v]) => fd.append(k, String(v ?? "")));

  // Arquivos (use com [] para enviar múltiplos)
  (anexos.foto_entregador || []).forEach((f, i) =>
    fd.append("foto_entregador[]", toRNFile(f, `selfie_${i}.jpg`))
  );
  (anexos.doc_entregador || []).forEach((f, i) =>
    fd.append("doc_entregador[]", toRNFile(f, `doc_pessoa_${i}.jpg`))
  );
  (anexos.doc_veiculo || []).forEach((f, i) =>
    fd.append("doc_veiculo[]", toRNFile(f, `doc_veiculo_${i}.jpg`))
  );
  (anexos.comprovante_residencia || []).forEach((f, i) =>
    fd.append("comprovante_residencia[]", toRNFile(f, `comp_resid_${i}.jpg`))
  );

  // (Opcional) envie também o resumo — seu backend atual ignora aqui, mas é útil para depurar
  const resumo = {
    doc_veiculo: (anexos.doc_veiculo || []).map(({ kind, name, size, mimeType }) => ({ kind, name, size, mimeType })),
    doc_entregador: (anexos.doc_entregador || []).map(({ kind, name, size, mimeType }) => ({ kind, name, size, mimeType })),
    foto_entregador: (anexos.foto_entregador || []).map(({ kind, name, size, mimeType }) => ({ kind, name, size, mimeType })),
    comprovante_residencia: (anexos.comprovante_residencia || []).map(({ kind, name, size, mimeType }) => ({ kind, name, size, mimeType })),
  };
  fd.append("anexos_resumo", JSON.stringify(resumo));

  // Importante: NÃO defina manualmente o Content-Type — deixe o fetch colocar o boundary
  const res = await fetch(`${API_BASE_URL}/api/motoboy_cadastro/finalizar`, {
    method: "POST",
    body: fd,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const debugInfo = JSON.stringify({
      status: res.status,
      responseText: text,
      payload,
      resumo_anexos: resumo
    }, null, 2);
    throw new Error(`Falha ao finalizar: ${debugInfo}`);
  }
  return res.json();
}

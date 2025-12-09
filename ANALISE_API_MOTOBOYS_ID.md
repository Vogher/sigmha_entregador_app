# Análise: Onde a Rota `/api/motoboys/:id` é Usada

## 📍 Resumo Executivo

A rota `/api/motoboys/:id` é usada em **7 contextos principais**:

| # | Funcionalidade | Arquivo | Tipo | Descrição |
|---|---|---|---|---|
| 1 | Check-in/Check-out | `src/components/CheckButton.tsx` | GET/POST | Verifica, faz check-in e check-out |
| 2 | Informações do motoboy | `src/screens/HomeScreen.tsx` | GET | Busca dados pessoais (filiação) |
| 3 | Entregas ativas | `src/screens/HomeScreen.tsx` | GET | Lista entregas em progresso |
| 4 | Novas atribuições | `src/screens/HomeScreen.tsx` | GET | Recebe novas ofertas de entrega |
| 5 | Push token | `src/screens/HomeScreen.tsx` | POST | Registra token de notificação |
| 6 | Entregas finalizadas | `src/screens/RecebimentosReport.tsx` | GET | Relatório de recebimentos |
| 7 | Push token (alternativo) | `src/utils/notifications.ts` | POST | Registro alternativo de token |

---

## 🔍 Detalhes de Cada Uso

### 1️⃣ CHECK-IN / CHECK-OUT (src/components/CheckButton.tsx)

**3 sub-rotas relacionadas:**

#### 1a) GET `/api/motoboys/{id}/check-state`
**Propósito:** Verificar se o motoboy está marcado como "on duty" (em turno)

```typescript
async function getCheckState(api: AxiosInstance, id: number): Promise<boolean> {
  const urls = [`/api/motoboys/${id}/check-state`, `/motoboys/${id}/check-state`];
  for (const u of urls) {
    try {
      const { data } = await api.get(u);
      if (typeof data?.checkedIn === "boolean") return data.checkedIn;
    } catch {}
  }
  return false;
}
```

**Resposta esperada:**
```json
{
  "checkedIn": true  // ou false
}
```

**Quando é chamada:**
- Na inicialização do componente (linha 81)
- Em polling automático a cada 15-30s (linha 115-125)
- Após check-in ou check-out bem-sucedido (linha 175)

---

#### 1b) POST `/api/motoboys/{id}/checkin`
**Propósito:** Iniciar turno de trabalho

```typescript
async function doCheckin(api: AxiosInstance, id: number) {
  const urls = [`/api/motoboys/${id}/checkin`, `/motoboys/${id}/checkin`];
  for (const u of urls) {
    try {
      const { data, status } = await api.post(u);
      if (status >= 200 && status < 300)
        return { ok: true, message: data?.message || "Check-in realizado." };
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || "Falha no check-in.";
      return { ok: false, message: msg };
    }
  }
  return { ok: false, message: "Falha no check-in." };
}
```

**Resposta esperada:**
```json
{
  "message": "Check-in realizado.",
  ... (outros campos opcionais)
}
```

**Disparada por:**
- Long press (2s) no botão "Fazer Check-In" (linha 142-148)

---

#### 1c) POST `/api/motoboys/{id}/checkout`
**Propósito:** Encerrar turno de trabalho

```typescript
async function doCheckout(api: AxiosInstance, id: number) {
  const urls = [`/api/motoboys/${id}/checkout`, `/motoboys/${id}/checkout`];
  for (const u of urls) {
    try {
      const { data, status } = await api.post(u);
      if (status >= 200 && status < 300)
        return { ok: true, message: data?.message || "Check-out realizado." };
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || "Falha no check-out.";
      return { ok: false, message: msg };
    }
  }
  return { ok: false, message: "Falha no check-out." };
}
```

**Resposta esperada:**
```json
{
  "message": "Check-out realizado.",
  ... (outros campos opcionais)
}
```

**Disparada por:**
- Long press (2s) no botão "Fazer Check-Out" (linha 150-156)

---

### 2️⃣ INFORMAÇÕES DO MOTOBOY (src/screens/HomeScreen.tsx - linha 475)

**GET `/api/motoboys/{id}`**

**Propósito:** Buscar dados do motoboy para exibir filiação

```typescript
const { data } = await api.get(`/api/motoboys/${motoboyId}`);
const nome = pickFiliacao(data) ?? "Nenhum";
setFiliacao(nome);
```

**Helper de extração:**
```typescript
function pickFiliacao(data?: any): string | null {
  const filiacao =
    data?.filiacao ??
    data?.nome_filiacao ??
    data?.sindicato ??
    data?.sindicato_nome ??
    data?.categoria ?? null;
  return typeof filiacao === "string" && filiacao.trim() ? filiacao : null;
}
```

**Resposta esperada:**
```json
{
  "id": 123,
  "nome": "João Silva",
  "filiacao": "Sindicato X",  // ou: sindicato, categoria, etc
  "email": "joao@email.com",
  "celular": "(85) 98765-4321",
  ... (outros dados)
}
```

**Chamada em:**
- Efeito secundário que dispara quando `motoboyId` muda (linha 460-490)
- Atualiza estado local `filiacao` para exibição na tela

---

### 3️⃣ ENTREGAS ATIVAS (src/screens/HomeScreen.tsx - linha 786)

**GET `/api/motoboys/{id}/entregas-ativas`**

**Propósito:** Listar entregas que o motoboy já aceitou e que estão em progresso

```typescript
const { data } = await api.get(`/api/motoboys/${motoboyId}/entregas-ativas`);
const arr = Array.isArray(data) ? data : [];

// Mapeia para estrutura interna
const list: AcceptedDelivery[] = arr.map((e: any) => ({
  entrega_id: Number(e.entrega_id ?? e.id),
  numero: e.corrida_code ?? e.numero_publico ?? e.id,
  cliente_nome: e.cliente_nome ?? null,
  coleta_endereco: e.coleta_endereco ?? null,
  entrega_endereco: e.entrega_endereco ?? null,
  valor_total_motoboy: e.valor_total_motoboy ?? null,
  // ... mais campos
}));
```

**Resposta esperada:**
```json
[
  {
    "id": 1,
    "entrega_id": 1,
    "corrida_code": "COR-001",
    "numero_publico": "001",
    "cliente_nome": "Empresa X",
    "coleta_endereco": "Rua A, 100",
    "entrega_endereco": "Rua B, 200",
    "valor_total_motoboy": 25.50,
    "status": "Em Trânsito",
    "has_retorno": false
  },
  ...
]
```

**Chamada em:**
- Na montagem do componente (línea 793)
- Armazena em estado `acceptedDeliveries`

---

### 4️⃣ NOVAS ATRIBUIÇÕES (src/screens/HomeScreen.tsx - linha 699)

**GET `/api/motoboys/{id}/novas-atribuicoes`**

**Propósito:** Buscar novas ofertas de entrega atribuídas ao motoboy

```typescript
const { data } = await api.get(`/api/motoboys/${motoboyId}/novas-atribuicoes`);
const list = Array.isArray(data) ? data : [];
if (list.length === 0) return;

const e = list[0];
const payload: OfertaPayload = {
  entrega_id: Number(e.entrega_id ?? e.id),
  numero: e.corrida_code ?? e.numero_publico ?? e.id,
  cliente_nome: e.cliente_nome ?? null,
  coleta_endereco: e.coleta_endereco ?? null,
  entrega_endereco: e.entrega_endereco ?? null,
  valor_total_motoboy: e.valor_total_motoboy ?? null,
  expira_em: e.assign_deadline_at ?? null,
  // ... mais campos
};
```

**Resposta esperada:**
```json
[
  {
    "id": 5,
    "entrega_id": 5,
    "corrida_code": "COR-005",
    "numero_publico": "005",
    "cliente_nome": "Cliente Y",
    "coleta_endereco": "Rua C, 300",
    "entrega_endereco": "Rua D, 400",
    "valor_total_motoboy": 30.00,
    "assign_deadline_at": "2025-11-21T14:30:00Z",
    "atribuido_motoboy_id": 123
  },
  ...
]
```

**Chamada em:**
- Polling periódico a cada 8s (linha 688-720)
- Quando muda de novas para aceitas

---

### 5️⃣ REGISTRAR PUSH TOKEN (src/screens/HomeScreen.tsx - linha 870)

**POST `/api/motoboys/{id}/push-token`**

**Propósito:** Registrar token do Expo para receber notificações push

```typescript
const tokenResp = await Notifications.getExpoPushTokenAsync({
  projectId: ...
});
const token = tokenResp?.data;

await api.post(`/api/motoboys/${motoboyId}/push-token`, { token }).catch(async () => {
  await api.post(`/motoboys/${motoboyId}/push-token`, { token }).catch(() => {});
});
```

**Request body:**
```json
{
  "token": "ExponentPushToken[abcdef123456...]"
}
```

**Resposta esperada:**
```json
{
  "message": "Token registrado com sucesso.",
  "ok": true
}
```

**Chamada em:**
- Ao montar a tela Home (efeito), linha 850-875
- Uma vez por sessão

---

### 6️⃣ ENTREGAS FINALIZADAS (src/screens/RecebimentosReport.tsx - linha 254)

**GET `/api/motoboys/{id}/entregas-finalizadas?from={data}&to={data}`**

**Propósito:** Buscar entregas finalizadas para gerar relatório de recebimentos

```typescript
const { data } = await api.get(
  `/api/motoboys/${user.id}/entregas-finalizadas?from=${fromISO}&to=${toISO}`
);
const arr: any[] = Array.isArray(data) ? data : [];

const out: Finalizada[] = arr.map((f: any) => ({
  entrega_id: Number(f.entrega_id ?? f.id),
  numero_publico: f.numero_publico ?? f.codigo ?? f.id,
  cliente_nome: f.cliente_nome ?? null,
  valor_motoboy: Number(f.valor_motoboy ?? f.valor ?? 0),
  data_finalizacao: f.data_finalizacao ?? f.finished_at ?? null,
  status: f.status ?? "Finalizado",
}));
```

**Resposta esperada:**
```json
[
  {
    "id": 10,
    "entrega_id": 10,
    "numero_publico": "010",
    "cliente_nome": "Cliente Z",
    "valor_motoboy": 25.50,
    "data_finalizacao": "2025-11-21T10:15:00Z",
    "status": "Finalizado"
  },
  ...
]
```

**Query Parameters:**
- `from`: ISO date (YYYY-MM-DDTHH:MM:SSZ)
- `to`: ISO date (YYYY-MM-DDTHH:MM:SSZ)

---

### 7️⃣ REGISTRAR PUSH TOKEN (alternativo - src/utils/notifications.ts)

**POST `/api/motoboys/{id}/push-token`**

**Propósito:** Função utilitária alternativa para registrar token push

```typescript
/**
 * Endpoint: POST /api/motoboys/:id/push-token  body { token }
 */
export async function registerExpoPushToken(userId: number): Promise<string | null> {
  try {
    const { data: tokenResp } = await Notifications.getExpoPushTokenAsync({
      projectId: undefined
    });
    const token = tokenResp;

    if (!token) return null;

    await api.post(`/api/motoboys/${userId}/push-token`, { token });
    return token;
  } catch (e) {
    console.log("[registerExpoPushToken]", e?.message);
    return null;
  }
}
```

**Idêntico ao item #5, mas como função utilitária reutilizável**

---

## 📊 Matriz de Requisições

```
Rota                                      | Método | Quando                      | Frequência
──────────────────────────────────────────┼────────┼────────────────────────────┼──────────
/api/motoboys/{id}/check-state            | GET    | Verificar status            | A cada 15-30s
/api/motoboys/{id}/checkin                | POST   | Iniciar turno               | 1x por dia
/api/motoboys/{id}/checkout               | POST   | Encerrar turno              | 1x por dia
/api/motoboys/{id}                        | GET    | Buscar dados pessoais       | Ao montar Home
/api/motoboys/{id}/entregas-ativas        | GET    | Listar entregas em progresso| Ao montar Home
/api/motoboys/{id}/novas-atribuicoes      | GET    | Buscar novas ofertas        | A cada 8s (polling)
/api/motoboys/{id}/push-token             | POST   | Registrar token             | 1x ao montar Home
/api/motoboys/{id}/entregas-finalizadas   | GET    | Relatório de recebimentos   | Sob demanda (mês)
```

---

## ⚙️ Tratamento de Erros

O app implementa um padrão de **fallback** para todas as requisições:

```typescript
// Tenta rota com /api/ antes, depois sem
const urls = [
  `/api/motoboys/${id}/check-state`,
  `/motoboys/${id}/check-state`
];

for (const u of urls) {
  try {
    const { data } = await api.get(u);
    // Se conseguir, retorna
    return data;
  } catch {
    // Tenta próxima URL
  }
}

// Se nenhuma funcionar, retorna valor default
return null;
```

**Implicação:** O backend pode implementar ambas as rotas:
- `/api/motoboys/{id}/...` (preferencial)
- `/motoboys/{id}/...` (fallback)

---

## 🔐 Autenticação

Todas as requisições incluem o **Authorization Bearer Token** via interceptor do Axios:

```typescript
// src/services/api.ts
function setAuthToken(token: string | null) {
  if (!token) delete (api.defaults.headers as any).common?.Authorization;
  else (api.defaults.headers as any).common = {
    ...(api.defaults.headers as any).common,
    Authorization: `Bearer ${token}`
  };
}
```

**Cada requisição leva o header:**
```
Authorization: Bearer <token_jwt>
```

---

## 📝 Campos Extraídos do Motoboy

O app extrai dados com muita flexibilidade. Campos comuns:

```typescript
{
  // Identificação
  id: number,
  motoboy_id: number,
  
  // Pessoal
  nome: string,
  email: string,
  celular: string,
  filiacao: string,
  sindicato: string,
  sindicato_nome: string,
  categoria: string,
  
  // Status
  checkedIn: boolean,
  status: string,
  
  // Financeiro
  valor_motoboy: number,
  valor_total_motoboy: number,
  saldo: number,
  
  // Entregas
  entrega_id: number,
  numero_publico: string,
  corrida_code: string,
  codigo_corrida: string,
  
  // Localização
  coleta_endereco: string,
  entrega_endereco: string,
  
  // Timestamps
  data_finalizacao: string (ISO),
  assign_deadline_at: string (ISO),
  finished_at: string (ISO)
}
```

---

## 🎯 Conclusão

A rota `/api/motoboys/:id` é **essencial** para o app funcionar. É usada para:

1. ✅ Controle de presença (check-in/out)
2. ✅ Exibição de perfil do motoboy
3. ✅ Listagem de entregas
4. ✅ Recebimento de novas ofertas
5. ✅ Registrar capacidade de notificação
6. ✅ Gerar relatórios financeiros

**Implementação mínima obrigatória:**
- `GET /api/motoboys/{id}` - Dados do motoboy
- `GET /api/motoboys/{id}/check-state` - Status check-in
- `POST /api/motoboys/{id}/checkin` - Check-in
- `POST /api/motoboys/{id}/checkout` - Check-out
- `GET /api/motoboys/{id}/entregas-ativas` - Entregas em progresso
- `POST /api/motoboys/{id}/push-token` - Registrar notificações

**Implementação completa (recomendada):**
- + `GET /api/motoboys/{id}/novas-atribuicoes` - Novas ofertas
- + `GET /api/motoboys/{id}/entregas-finalizadas` - Relatório

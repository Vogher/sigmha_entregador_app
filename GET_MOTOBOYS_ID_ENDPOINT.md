╔════════════════════════════════════════════════════════════════════════════════╗
║        GET /api/motoboys/:id - ANÁLISE DO ENDPOINT ÚNICO                        ║
╚════════════════════════════════════════════════════════════════════════════════╝

🎯 PROPÓSITO
═══════════════════════════════════════════════════════════════════════════════════

Buscar dados gerais do motoboy autenticado, especialmente para extrair informações
sobre a filiação/vinculação (sindicato, empresa, cliente, categoria, etc).

Essa é uma das primeiras informações carregadas quando o motoboy acessa a tela Home.

═══════════════════════════════════════════════════════════════════════════════════

📍 ONDE É CHAMADO
═══════════════════════════════════════════════════════════════════════════════════

Arquivo: src/screens/HomeScreen.tsx
Função:  fetchFiliacao()
Linha:   479

```typescript
const fetchFiliacao = useCallback(async () => {
  if (!motoboyId) {
    setFiliacao("Nenhum");
    return;
  }
  setLoadingFiliacao(true);
  try {
    const { data } = await api.get(`/api/motoboys/${motoboyId}`);
    const nome = pickFiliacao(data) ?? "Nenhum";
    setFiliacao(nome);
  } catch (e) {
    console.warn("Falha ao buscar filiação:", e);
    setFiliacao("Nenhum");
  } finally {
    setLoadingFiliacao(false);
  }
}, [motoboyId]);
```

═══════════════════════════════════════════════════════════════════════════════════

⏰ QUANDO É CHAMADO
═══════════════════════════════════════════════════════════════════════════════════

Em um useEffect disparado sempre que `motoboyId` muda:

Linha 453-458:
```typescript
useEffect(() => {
  fetchFiliacao();
}, [fetchFiliacao]);
```

Timing:
  • Na inicialização da tela Home
  • Quando o usuário faz login e o motoboyId é carregado
  • Se o ID do motoboy mudar (raro)

Frequência:
  • UMA VEZ por sessão (não é polling)
  • Chamada bloqueante que aguarda resposta

═══════════════════════════════════════════════════════════════════════════════════

📨 REQUEST
═══════════════════════════════════════════════════════════════════════════════════

Método:  GET
URL:     /api/motoboys/{id}

Headers automáticos (via interceptor):
  Authorization: Bearer <token_jwt>
  Content-Type:  application/json

Query Parameters: NENHUM

Body: VAZIO (é GET)

Exemplo de requisição:
  GET /api/motoboys/123 HTTP/1.1
  Host: api.example.com
  Authorization: Bearer eyJhbGc...
  Accept: application/json

═══════════════════════════════════════════════════════════════════════════════════

✅ RESPONSE ESPERADA
═══════════════════════════════════════════════════════════════════════════════════

Status HTTP: 200 OK

Body (JSON):
```json
{
  "id": 123,
  "nome": "João Silva dos Santos",
  "email": "joao@email.com",
  "celular": "(85) 98765-4321",
  
  "filiacao": "Sindicato dos Motoboys XYZ",
  // OU um destes campos alternativos:
  "filiado_a": "...",
  "atribuido_a": "...",
  "vinculado_a": "...",
  
  "cliente_nome": "Empresa ABC Ltda",
  "empresa": "...",
  
  "cliente": {
    "id": 1,
    "nome": "...",
    "nome_estabelecimento": "...",
    "fantasia": "...",
    "razao_social": "Empresa ABC Comércio Ltda"
  },
  
  // Outros campos (opcionais):
  "status": "ativo",
  "cpf": "123.456.789-00",
  "criado_em": "2025-01-01T00:00:00Z",
  "atualizado_em": "2025-11-21T10:30:00Z"
}
```

═══════════════════════════════════════════════════════════════════════════════════

🔍 O QUE O APP EXTRAI
═══════════════════════════════════════════════════════════════════════════════════

O app usa a função `pickFiliacao(data)` para extrair a filiação em ordem de prioridade:

Função (src/screens/HomeScreen.tsx, linha 105):
```typescript
function pickFiliacao(data: any): string | null {
  const candidates: Array<unknown> = [
    data?.filiacao,              // 1ª prioridade
    data?.filiado_a,             // 2ª prioridade
    data?.atribuido_a,           // 3ª prioridade
    data?.vinculado_a,           // 4ª prioridade
    data?.cliente_nome,          // 5ª prioridade
    data?.empresa,               // 6ª prioridade
    data?.cliente?.nome_estabelecimento,  // 7ª prioridade
    data?.cliente?.nome,         // 8ª prioridade
    data?.cliente?.fantasia,     // 9ª prioridade
    data?.cliente?.razao_social, // 10ª prioridade (última)
  ];
  
  const first = candidates.find(
    (v) => typeof v === "string" && String(v).trim().length > 0 && String(v).trim() !== "Nenhum"
  ) as string | undefined;
  
  return first ?? null;
}
```

Lógica:
  • Procura o PRIMEIRO campo NÃO-VAZIO em ordem de preferência
  • Ignora valores vazio ou "Nenhum"
  • Se nenhum encontrado, retorna null
  • Se null, o app exibe "Nenhum" na tela

═══════════════════════════════════════════════════════════════════════════════════

📺 O QUE É EXIBIDO NA TELA
═══════════════════════════════════════════════════════════════════════════════════

A filiação extraída é armazenada em um estado:
```typescript
const [filiacao, setFiliacao] = useState("Nenhum");
const [loadingFiliacao, setLoadingFiliacao] = useState(false);
```

E exibida na UI, algo como:

┌─────────────────────────────────────┐
│  Bem-vindo, João!                   │
│                                     │
│  Filiado a: Sindicato dos Motoboys  │ ← Extraído do GET
│                                     │
│  [Botão: Fazer Check-In]            │
└─────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════════

⚠️ COMPORTAMENTO EM CASO DE ERRO
═══════════════════════════════════════════════════════════════════════════════════

Se a requisição falhar:
  • console.warn("Falha ao buscar filiação:", error)
  • setFiliacao("Nenhum") — exibe "Nenhum" na tela
  • A tela CONTINUA funcionando normalmente (não bloqueia)
  • Sem Alert ao usuário

Se a resposta não tem filiação:
  • pickFiliacao retorna null
  • setFiliacao("Nenhum") — exibe "Nenhum"
  • Tudo normal

═══════════════════════════════════════════════════════════════════════════════════

🔄 FLUXO COMPLETO
═══════════════════════════════════════════════════════════════════════════════════

1. Usuário faz LOGIN
   ↓
2. App armazena motoboyId no estado
   ↓
3. Tela Home é montada
   ↓
4. useEffect detecta motoboyId ≠ null
   ↓
5. Chama fetchFiliacao()
   ↓
6. GET /api/motoboys/{motoboyId}
   ↓
7. Backend retorna { filiacao: "...", ... }
   ↓
8. pickFiliacao() extrai valor
   ↓
9. setFiliacao(nome) atualiza estado
   ↓
10. UI re-renderiza com filiação exibida

═══════════════════════════════════════════════════════════════════════════════════

💾 REQUISITOS MÍNIMOS PARA O BACKEND
═══════════════════════════════════════════════════════════════════════════════════

✅ OBRIGATÓRIO ter UM dos seguintes campos na resposta:
   • filiacao
   • filiado_a
   • atribuido_a
   • vinculado_a
   • cliente_nome
   • empresa
   • cliente.nome_estabelecimento
   • cliente.nome
   • cliente.fantasia
   • cliente.razao_social

✅ Campo deve ser:
   • string (não null, não número)
   • não-vazio
   • diferente de "Nenhum"

✅ Resposta deve ser:
   • JSON object
   • Status 200 OK
   • Pode ter outros campos (ignorados pelo app)

═══════════════════════════════════════════════════════════════════════════════════

📝 EXEMPLO DE RESPOSTAS VÁLIDAS
═══════════════════════════════════════════════════════════════════════════════════

Caso 1 - Com filiacao direta:
```json
{
  "id": 123,
  "nome": "João",
  "filiacao": "Sindicato ABC"
}
```
→ App exibe: "Sindicato ABC"

---

Caso 2 - Com cliente vinculado:
```json
{
  "id": 123,
  "nome": "Maria",
  "cliente": {
    "nome_estabelecimento": "Pizzaria da Vila"
  }
}
```
→ App exibe: "Pizzaria da Vila"

---

Caso 3 - Sem filiação:
```json
{
  "id": 123,
  "nome": "Pedro"
}
```
→ App exibe: "Nenhum"

---

Caso 4 - Com múltiplos campos (usa o 1º não-vazio):
```json
{
  "id": 123,
  "nome": "Ana",
  "filiacao": "Sindicato XYZ",
  "cliente_nome": "Supermercado Y"
}
```
→ App exibe: "Sindicato XYZ" (filiacao tem prioridade)

═══════════════════════════════════════════════════════════════════════════════════

🔐 NOTAS DE SEGURANÇA
═══════════════════════════════════════════════════════════════════════════════════

• Requisição autenticada (requer Bearer token válido)
• Retorna dados apenas do motoboy autenticado (self)
• Sem parâmetros que possam expor outros usuários
• Chamada segura, sem efeitos colaterais (GET puro)

═══════════════════════════════════════════════════════════════════════════════════

📊 COMPARAÇÃO COM OUTRAS ROTAS DO MOTOBOY
═══════════════════════════════════════════════════════════════════════════════════

GET /api/motoboys/{id}
  ├─ Tipo: Informações gerais do motoboy
  ├─ Dados: Pessoais, filiação, empresa
  ├─ Frequência: 1x na inicialização
  ├─ Crítico: SIM (exibição do perfil)
  └─ Pode falhar: Sim, mas gracefully (exibe "Nenhum")

GET /api/motoboys/{id}/check-state
  ├─ Tipo: Status de presença (on/off duty)
  ├─ Dados: { checkedIn: boolean }
  ├─ Frequência: A cada 15-30s (polling contínuo)
  ├─ Crítico: SIM (controle de turno)
  └─ Pode falhar: Retorna false como default

GET /api/motoboys/{id}/entregas-ativas
  ├─ Tipo: Entregas em progresso
  ├─ Dados: Array de entregas aceitas
  ├─ Frequência: 1x na inicialização
  ├─ Crítico: SIM (exibe entregas)
  └─ Pode falhar: Exibe array vazio

═══════════════════════════════════════════════════════════════════════════════════

🎯 RESUMO
═══════════════════════════════════════════════════════════════════════════════════

GET /api/motoboys/:id SERVE PARA:
  ✓ Buscar dados pessoais do motoboy autenticado
  ✓ Extrair informação de filiação/vinculação
  ✓ Exibir "Filiado a: XXX" na tela Home
  ✓ Carregar perfil completo na inicialização

RESPOSTA REQUERIDA:
  ✓ { filiacao: "string" } ou equivalente
  ✓ Status 200 OK
  ✓ Pode ter outros campos

CHAMADA:
  ✓ UMA VEZ por sessão
  ✓ Sincronizadamente (aguarda resposta)
  ✓ Com autenticação Bearer token

FALHA ACEITÁVEL:
  ✓ Sim, app continua funcionando
  ✓ Exibe "Nenhum" no lugar da filiação

═══════════════════════════════════════════════════════════════════════════════════

Data de análise: 21/11/2025
Arquivo fonte: src/screens/HomeScreen.tsx (linha 475-490)

# GET /api/motoboys/:id — O QUE SERVE?

## 🎯 Resumo em Uma Linha

Busca as informações pessoais do motoboy autenticado, **especialmente a filiação/vinculação** (sindicato, empresa, cliente) para exibir na tela inicial.

---

## 📍 Uso Prático

```
┌─────────────────────────────────────────────────────┐
│ Tela Home do App (HomeScreen.tsx)                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Bem-vindo, João Silva!                             │
│  👥 Filiado a: Sindicato dos Motoboys ← [DESTE GET]│
│                                                     │
│  [Botão Check-In] [Botão Entregas]                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 📤 Requisição

```http
GET /api/motoboys/{id}
Authorization: Bearer <token>
```

Exemplo:
```
GET /api/motoboys/123
Authorization: Bearer eyJhbGc...
```

---

## 📥 Resposta Esperada

```json
{
  "id": 123,
  "nome": "João Silva",
  "email": "joao@email.com",
  "filiacao": "Sindicato dos Motoboys XYZ",
  ...outros campos opcionais...
}
```

---

## 🔍 O Que o App Extrai

O app procura por este campo **nesta ordem de prioridade**:

1. `filiacao` ← preferencial
2. `filiado_a`
3. `atribuido_a`
4. `vinculado_a`
5. `cliente_nome`
6. `empresa`
7. `cliente.nome_estabelecimento`
8. `cliente.nome`
9. `cliente.fantasia`
10. `cliente.razao_social` ← última tentativa

**Usa o PRIMEIRO campo não-vazio encontrado.**

Se nenhum encontrado → Exibe `"Nenhum"`

---

## ⏰ Quando é Chamado

- **UMA VEZ** na inicialização da tela Home
- Quando o usuário faz login
- Não é polling (não repete)

---

## 💡 Exemplo de Resposta Mínima

```json
{
  "id": 123,
  "nome": "Maria Santos",
  "filiacao": "STCQRSP - Sindicato dos Motoboys"
}
```

App exibe: **"Filiado a: STCQRSP - Sindicato dos Motoboys"**

---

## ❌ Se Falhar

- Tela Home continua funcionando
- Exibe `"Filiado a: Nenhum"`
- Sem erro crítico

---

## 📊 Dados Opcionais (Ignorados pelo App)

Pode incluir sem problemas:

```json
{
  "id": 123,
  "nome": "João",
  "email": "joao@email.com",
  "celular": "(85) 98765-4321",
  "cpf": "123.456.789-00",
  "status": "ativo",
  "criado_em": "2025-01-01T00:00:00Z",
  "saldo": 100.50,
  "filiacao": "Sindicato ABC"
}
```

O app pegará apenas `filiacao` e ignorará o resto.

---

## 🎯 Conclusão

**GET /api/motoboys/:id** é um endpoint básico que retorna:
- ✅ Dados pessoais do motoboy
- ✅ **Informação de filiação/vinculação** (principal uso)
- ✅ Pode conter outros campos
- ✅ Chamado uma vez ao iniciar a sessão
- ✅ Não bloqueia o app se falhar

**Resposta mínima obrigatória:**
```json
{
  "id": <número>,
  "nome": "<string>",
  "filiacao": "<string>"  // ou outro campo da lista acima
}
```

---

**Análise detalhada:** Ver `GET_MOTOBOYS_ID_ENDPOINT.md`

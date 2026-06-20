# 🛵 Rota Esperta

> Aplicativo web para entregadores otimizarem suas rotas de entrega a partir de fotos das etiquetas dos pacotes.

*(nome provisório — pode mudar depois)*

---

## 🎯 O problema

No dia a dia da entrega, montar a rota é manual e ineficiente. O entregador acaba seguindo a ordem aleatória em que os pacotes vieram, gastando **mais tempo e mais combustível** do que o necessário.

## 💡 A solução

Um site (que abre no celular) onde o entregador:

1. **📷 Tira foto** da etiqueta de cada pacote
2. **📝 O app lê** o endereço automaticamente (OCR)
3. **🗺️ O app calcula** a melhor ordem de entrega
4. **🚀 Abre a rota otimizada** direto no Google Maps

---

## 🔄 Fluxo completo

```
🏠 LANCHONETE (ponto de partida E de chegada)
        ↓
📷 Fotos das etiquetas
   • 1ª foto = entrega prioritária (a mais atrasada)
   • cada foto → lê endereço + guarda complemento (AP/bloco)
   • ⚠️ marca os endereços que vieram SEM complemento
        ↓
🗺️ OTIMIZAÇÃO da ordem, considerando:
   ✅ rota fechada (precisa voltar pra lanchonete)
   ✅ menor distância/tempo possível
   ✅ prioritária fura a fila SÓ se custar quase nada (modo conservador ~5%)
        ↓
🚀 Melhor sequência de entregas
        ↓
🏠 Retorno à lanchonete
```

---

## 📐 Regras de negócio

| Regra | Comportamento |
|-------|---------------|
| **Ponto de origem** | A lanchonete é o ponto fixo de partida **e** de chegada (rota fechada/circular). |
| **Entrega prioritária** | Por padrão é a **1ª foto** enviada. Tem preferência para ser entregue mais cedo. |
| **Prioridade flexível (conservadora)** | A prioritária só "fura a fila" se isso **não aumentar a rota em mais de ~5%**. Caso contrário, mantém a ordem mais eficiente (economia de combustível em primeiro lugar). |
| **Complemento (AP/bloco)** | Guardado como observação, **não interfere** no cálculo da rota (o mapa usa só rua + número + bairro). Exibido na hora da entrega. |
| **Complemento ausente** | Endereços sem complemento são **destacados** para o entregador prestar atenção. |

---

## 🛠️ Tecnologia (tudo gratuito, sem cartão de crédito)

| Função | Ferramenta | Custo |
|--------|-----------|-------|
| Ler a foto (OCR) | Tesseract.js (roda no navegador) | 🟢 Grátis |
| Localizar endereços (geocodificação) | Nominatim / OpenStreetMap | 🟢 Grátis |
| Otimizar a ordem das paradas | Cálculo no próprio site (JavaScript) | 🟢 Grátis |
| Abrir a rota | Link do Google Maps | 🟢 Grátis |

> O app é um **site estático** — não precisa de servidor, banco de dados nem chaves de API pagas.

---

## 🗺️ Roadmap (etapas de construção)

- [x] **Etapa 1** — Estrutura do projeto + documentação *(este commit)*
- [ ] **Etapa 2** — Versão funcional: digitar endereços → otimizar ordem → gerar link do Maps
- [ ] **Etapa 3** — Ler endereço a partir da foto da etiqueta (OCR)
- [ ] **Etapa 4 (opcional)** — Botão "espiar no Street View" + alerta de complemento ausente

---

## 📁 Estrutura de arquivos

```
rota-entregador/
├── index.html      → a página principal
├── css/
│   └── style.css   → aparência (visual mobile-first)
├── js/
│   └── app.js      → a lógica do app
└── README.md       → este arquivo
```

---

## 🚀 Como rodar (por enquanto)

Como é um site estático, basta **abrir o arquivo `index.html` no navegador**. Nas próximas etapas isso vai evoluir.

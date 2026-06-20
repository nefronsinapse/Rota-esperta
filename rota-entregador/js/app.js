/* ===========================================================
   Rota Esperta — lógica do app
   -----------------------------------------------------------
   ETAPA 1: por enquanto este arquivo só deixa o esqueleto
   pronto. As funções abaixo são "esboços" (ainda vazios) que
   vamos preencher nas próximas etapas.
   =========================================================== */

"use strict";

// -----------------------------------------------------------
// CONFIGURAÇÕES (o "painel de ajustes" do app)
// -----------------------------------------------------------
const CONFIG = {
  // Tolerância da entrega prioritária (modo Conservador).
  // 0.05 = a prioritária só fura a fila se a rota aumentar no máximo 5%.
  toleranciaPrioridade: 0.05,

  // Ponto de origem/retorno (a lanchonete). Será preenchido na Etapa 2.
  lanchonete: null,
};

// -----------------------------------------------------------
// ESTADO (os dados que o app guarda enquanto está aberto)
// -----------------------------------------------------------
const estado = {
  entregas: [], // lista de paradas: { endereco, complemento, prioritaria, lat, lng }
};

// -----------------------------------------------------------
// FUNÇÕES (esboços — serão implementadas nas próximas etapas)
// -----------------------------------------------------------

// Etapa 3: ler o endereço a partir da foto da etiqueta (OCR)
function lerEnderecoDaFoto(/* arquivoDeImagem */) {
  // TODO (Etapa 3): usar Tesseract.js para extrair o texto da foto
}

// Etapa 2: descobrir a localização (lat/lng) de um endereço
function geocodificar(/* endereco */) {
  // TODO (Etapa 2): consultar o Nominatim / OpenStreetMap
}

// Etapa 2: calcular a melhor ordem das entregas (rota fechada)
function otimizarRota(/* entregas */) {
  // TODO (Etapa 2): vizinho mais próximo + ajuste, respeitando
  //                 o retorno à lanchonete e a prioridade conservadora
}

// Etapa 2: montar o link do Google Maps com as paradas na ordem
function gerarLinkDoMaps(/* entregasOrdenadas */) {
  // TODO (Etapa 2): construir a URL de rota do Google Maps
}

// -----------------------------------------------------------
// INÍCIO
// -----------------------------------------------------------
function iniciar() {
  console.log("Rota Esperta — Etapa 1 carregada ✅");
}

iniciar();

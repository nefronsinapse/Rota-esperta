/* ===========================================================
   Rota Esperta — lógica do app (Etapa 2)
   -----------------------------------------------------------
   Fluxo: digitar endereços -> geocodificar (achar lat/lng)
          -> otimizar a ordem (rota fechada + prioridade
          conservadora) -> gerar o link do Google Maps.
   =========================================================== */

"use strict";

// -----------------------------------------------------------
// CONFIGURAÇÕES (o "painel de ajustes" do app)
// -----------------------------------------------------------
const CONFIG = {
  // Tolerância da entrega prioritária (modo Conservador).
  // 0.05 = a prioritária só "fura a fila" se a rota aumentar no máximo 5%.
  toleranciaPrioridade: 0.05,

  // País usado para ajudar a busca de endereços (Nominatim).
  pais: "br",

  // Pausa entre buscas de endereço (Nominatim pede no máx. 1 por segundo).
  pausaGeocodificacaoMs: 1100,
};

// -----------------------------------------------------------
// ESTADO (os dados que o app guarda enquanto está aberto)
// -----------------------------------------------------------
const estado = {
  entregas: [], // cada item: { id, endereco, complemento, lat, lng }
  proximoId: 1,
};

// -----------------------------------------------------------
// ATALHOS para elementos da página
// -----------------------------------------------------------
const el = (id) => document.getElementById(id);

// =====================================================================
// PARTE A — GERENCIAR A LISTA DE ENTREGAS
// =====================================================================

function adicionarEntrega(endereco, complemento) {
  estado.entregas.push({
    id: estado.proximoId++,
    endereco: endereco.trim(),
    complemento: complemento.trim(),
    lat: null,
    lng: null,
  });
  renderizarLista();
}

function removerEntrega(id) {
  estado.entregas = estado.entregas.filter((e) => e.id !== id);
  renderizarLista();
}

function renderizarLista() {
  const lista = el("lista-entregas");
  const cartao = el("cartao-lista");
  lista.innerHTML = "";

  el("contador").textContent = estado.entregas.length;
  cartao.hidden = estado.entregas.length === 0;

  estado.entregas.forEach((entrega, indice) => {
    const ehPrioritaria = indice === 0; // a 1ª da lista é a prioritária

    const li = document.createElement("li");
    li.className = "item-entrega";

    // Complemento: mostra o texto, ou um aviso amarelo se estiver vazio
    const linhaComplemento = entrega.complemento
      ? `<div class="item-complemento">📝 ${entrega.complemento}</div>`
      : `<div class="sem-complemento">⚠️ Sem complemento</div>`;

    const badge = ehPrioritaria
      ? `<div><span class="badge-prioridade">⭐ PRIORITÁRIA</span></div>`
      : "";

    li.innerHTML = `
      <span class="item-numero">${indice + 1}</span>
      <div class="item-corpo">
        <div class="item-endereco">${entrega.endereco}</div>
        ${linhaComplemento}
        ${badge}
      </div>
      <button class="btn-remover" title="Remover" data-id="${entrega.id}">✕</button>
    `;
    lista.appendChild(li);
  });

  // Liga o botão de remover de cada item
  lista.querySelectorAll(".btn-remover").forEach((botao) => {
    botao.addEventListener("click", () => removerEntrega(Number(botao.dataset.id)));
  });
}

// =====================================================================
// PARTE B — GEOCODIFICAÇÃO (achar a latitude/longitude de um endereço)
// =====================================================================

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodificar(endereco, cidade) {
  // Junta a cidade base ao endereço, se ela não estiver já escrita
  let consulta = endereco;
  if (cidade && !endereco.toLowerCase().includes(cidade.toLowerCase())) {
    consulta += ", " + cidade;
  }

  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1" +
    "&countrycodes=" + CONFIG.pais +
    "&q=" + encodeURIComponent(consulta);

  const resposta = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
  if (!resposta.ok) throw new Error("Falha ao consultar o mapa");

  const dados = await resposta.json();
  if (!dados.length) return null; // endereço não encontrado

  return {
    lat: parseFloat(dados[0].lat),
    lng: parseFloat(dados[0].lon),
  };
}

// =====================================================================
// PARTE C — CÁLCULO DE DISTÂNCIA E OTIMIZAÇÃO DA ROTA
// =====================================================================

// Distância em km entre dois pontos (fórmula de Haversine — leva em
// conta a curvatura da Terra). É uma boa aproximação para ordenar paradas.
function distancia(a, b) {
  const R = 6371; // raio da Terra em km
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Comprimento total de uma rota FECHADA: lanchonete -> entregas -> lanchonete
function comprimentoRota(origem, entregas) {
  const pontos = [origem, ...entregas, origem];
  let total = 0;
  for (let i = 0; i < pontos.length - 1; i++) {
    total += distancia(pontos[i], pontos[i + 1]);
  }
  return total;
}

// Passo 1: "vizinho mais próximo" — começa na lanchonete e sempre vai
// para a entrega mais perto que ainda falta. Dá uma rota razoável.
function vizinhoMaisProximo(origem, entregas) {
  const restantes = [...entregas];
  const rota = [];
  let atual = origem;
  while (restantes.length) {
    let melhor = 0;
    let menorDist = Infinity;
    restantes.forEach((e, i) => {
      const d = distancia(atual, e);
      if (d < menorDist) {
        menorDist = d;
        melhor = i;
      }
    });
    atual = restantes[melhor];
    rota.push(restantes.splice(melhor, 1)[0]);
  }
  return rota;
}

// Passo 2: "2-opt" — tenta desfazer cruzamentos invertendo trechos da
// rota. Repete enquanto conseguir encurtar. Melhora bastante o resultado.
function melhorar2opt(origem, entregas) {
  let rota = [...entregas];
  let melhorou = true;
  while (melhorou) {
    melhorou = false;
    for (let i = 0; i < rota.length - 1; i++) {
      for (let j = i + 1; j < rota.length; j++) {
        const nova = [
          ...rota.slice(0, i),
          ...rota.slice(i, j + 1).reverse(),
          ...rota.slice(j + 1),
        ];
        if (comprimentoRota(origem, nova) < comprimentoRota(origem, rota) - 1e-9) {
          rota = nova;
          melhorou = true;
        }
      }
    }
  }
  return rota;
}

// Passo 3: prioridade CONSERVADORA — tenta colocar a entrega prioritária
// como a primeira parada, mas só aceita se a rota não piorar mais que a
// tolerância (5%). Senão, mantém a ordem eficiente.
function aplicarPrioridade(origem, rota, idPrioritaria) {
  const indice = rota.findIndex((e) => e.id === idPrioritaria);
  if (indice <= 0) return { rota, priorizada: indice === 0 }; // já é a 1ª (ou sumiu)

  const distOtima = comprimentoRota(origem, rota);
  const prioritaria = rota[indice];
  const candidata = [prioritaria, ...rota.filter((e) => e.id !== idPrioritaria)];
  const distCandidata = comprimentoRota(origem, candidata);

  if (distCandidata <= distOtima * (1 + CONFIG.toleranciaPrioridade)) {
    return { rota: candidata, priorizada: true }; // vale a pena adiantar
  }
  return { rota, priorizada: false }; // ficou caro demais, mantém a ordem
}

// =====================================================================
// PARTE D — GERAR O LINK DO GOOGLE MAPS
// =====================================================================

function gerarLinkDoMaps(origem, entregasOrdenadas) {
  const ponto = (p) => `${p.lat},${p.lng}`;
  const paradas = entregasOrdenadas.map(ponto).join("|");

  return (
    "https://www.google.com/maps/dir/?api=1" +
    "&origin=" + ponto(origem) +
    "&destination=" + ponto(origem) + // rota fechada: volta para a lanchonete
    "&waypoints=" + encodeURIComponent(paradas) +
    "&travelmode=driving"
  );
}

// =====================================================================
// PARTE E — O BOTÃO "OTIMIZAR" JUNTA TUDO
// =====================================================================

function mostrarStatus(texto, ehErro = false) {
  const s = el("status");
  s.textContent = texto;
  s.hidden = false;
  s.classList.toggle("erro", ehErro);
}

async function otimizar() {
  const enderecoLanchonete = el("input-lanchonete").value.trim();
  const cidade = el("input-cidade").value.trim();

  // Validações básicas
  if (!enderecoLanchonete) {
    mostrarStatus("Preencha o endereço da lanchonete primeiro.", true);
    return;
  }
  if (estado.entregas.length < 2) {
    mostrarStatus("Adicione pelo menos 2 entregas para otimizar.", true);
    return;
  }

  const botao = el("btn-otimizar");
  botao.disabled = true;
  el("cartao-resultado").hidden = true;

  try {
    // 1) Geocodificar a lanchonete
    mostrarStatus("🔎 Localizando a lanchonete...");
    const origem = await geocodificar(enderecoLanchonete, cidade);
    if (!origem) {
      mostrarStatus("Não encontrei a lanchonete. Tente um endereço mais completo.", true);
      botao.disabled = false;
      return;
    }

    // 2) Geocodificar cada entrega (uma por vez, respeitando o limite)
    const naoEncontrados = [];
    for (let i = 0; i < estado.entregas.length; i++) {
      const entrega = estado.entregas[i];
      mostrarStatus(`🔎 Localizando endereços... (${i + 1}/${estado.entregas.length})`);
      await esperar(CONFIG.pausaGeocodificacaoMs);
      const coord = await geocodificar(entrega.endereco, cidade);
      if (coord) {
        entrega.lat = coord.lat;
        entrega.lng = coord.lng;
      } else {
        naoEncontrados.push(entrega.endereco);
      }
    }

    const validas = estado.entregas.filter((e) => e.lat !== null);
    if (validas.length < 2) {
      mostrarStatus("Não consegui localizar endereços suficientes. Verifique o que foi digitado.", true);
      botao.disabled = false;
      return;
    }

    // 3) Otimizar a ordem
    mostrarStatus("🧮 Calculando a melhor rota...");
    const idPrioritaria = estado.entregas[0].id; // a 1ª adicionada
    let rota = vizinhoMaisProximo(origem, validas);
    rota = melhorar2opt(origem, rota);
    const resultado = aplicarPrioridade(origem, rota, idPrioritaria);

    // 4) Mostrar o resultado
    exibirResultado(origem, resultado.rota, idPrioritaria, resultado.priorizada, naoEncontrados);
    el("status").hidden = true;
  } catch (erro) {
    mostrarStatus("Ops, deu um problema ao consultar o mapa. Tente de novo em instantes.", true);
    console.error(erro);
  } finally {
    botao.disabled = false;
  }
}

function exibirResultado(origem, rota, idPrioritaria, priorizada, naoEncontrados) {
  const km = comprimentoRota(origem, rota).toFixed(1);

  // Resumo
  let resumo = `Distância total (ida e volta): ~${km} km · ${rota.length} paradas.`;
  if (priorizada) {
    resumo += " ⭐ A prioritária foi adiantada (cabia dentro do limite).";
  } else {
    resumo += " A prioritária ficou na ordem eficiente (adiantar sairia caro).";
  }
  el("resumo-rota").textContent = resumo;

  // Lista ordenada
  const ol = el("resultado-ordem");
  ol.innerHTML = "";
  rota.forEach((entrega) => {
    const li = document.createElement("li");
    const tag = entrega.id === idPrioritaria ? `<span class="tag-prio">⭐ prioritária</span>` : "";
    const compl = entrega.complemento
      ? `<span class="compl">📝 ${entrega.complemento}</span>`
      : `<span class="compl">⚠️ sem complemento</span>`;
    li.innerHTML = `${entrega.endereco}${tag}${compl}`;
    ol.appendChild(li);
  });

  // Link do Maps
  el("link-maps").href = gerarLinkDoMaps(origem, rota);

  // Aviso de endereços não encontrados (se houver)
  if (naoEncontrados.length) {
    mostrarStatus("⚠️ Não localizei: " + naoEncontrados.join("; ") + ". Eles ficaram de fora.", true);
  }

  el("cartao-resultado").hidden = false;
  el("cartao-resultado").scrollIntoView({ behavior: "smooth" });
}

// =====================================================================
// INÍCIO — liga os botões da página
// =====================================================================

function iniciar() {
  // Formulário de adicionar entrega
  el("form-entrega").addEventListener("submit", (evento) => {
    evento.preventDefault();
    const endereco = el("input-endereco").value;
    const complemento = el("input-complemento").value;
    if (!endereco.trim()) return;
    adicionarEntrega(endereco, complemento);
    el("input-endereco").value = "";
    el("input-complemento").value = "";
    el("input-endereco").focus();
  });

  // Botão otimizar
  el("btn-otimizar").addEventListener("click", otimizar);

  console.log("Rota Esperta — Etapa 2 carregada ✅");
}

iniciar();

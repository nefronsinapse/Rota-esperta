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

  // Nome da "gaveta" onde guardamos os dados no navegador (localStorage).
  chaveStorage: "rotaEsperta.v1",
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
  salvarEstado();
  renderizarLista();
}

function removerEntrega(id) {
  estado.entregas = estado.entregas.filter((e) => e.id !== id);
  salvarEstado();
  renderizarLista();
}

function limparTudo() {
  estado.entregas = [];
  estado.proximoId = 1;
  salvarEstado();
  renderizarLista();
  el("cartao-resultado").hidden = true;
}

// -----------------------------------------------------------
// PERSISTÊNCIA — guarda os dados no navegador (localStorage),
// para a lista não sumir ao recarregar ou fechar a página.
// -----------------------------------------------------------
function salvarEstado() {
  try {
    const dados = {
      entregas: estado.entregas,
      proximoId: estado.proximoId,
      lanchonete: el("input-lanchonete").value,
      cidade: el("input-cidade").value,
    };
    localStorage.setItem(CONFIG.chaveStorage, JSON.stringify(dados));
  } catch (e) {
    // Navegação privada pode bloquear o localStorage — segue sem salvar.
  }
}

function carregarEstado() {
  try {
    const bruto = localStorage.getItem(CONFIG.chaveStorage);
    if (!bruto) return;
    const dados = JSON.parse(bruto);

    // Recarrega as entregas, mas zera as coordenadas: elas serão
    // recalculadas na próxima otimização (evita usar localização velha).
    estado.entregas = (dados.entregas || []).map((e) => ({
      id: e.id,
      endereco: e.endereco,
      complemento: e.complemento || "",
      lat: null,
      lng: null,
    }));
    estado.proximoId = dados.proximoId || estado.entregas.length + 1;

    if (dados.lanchonete) el("input-lanchonete").value = dados.lanchonete;
    if (dados.cidade) el("input-cidade").value = dados.cidade;
  } catch (e) {
    // Dados corrompidos — ignora e começa do zero.
  }
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
// PARTE A.1 — LER ENDEREÇO DE UMA FOTO (OCR com Tesseract.js)
// =====================================================================

function mostrarOcrStatus(texto, ehErro = false) {
  const s = el("ocr-status");
  s.textContent = texto;
  s.hidden = false;
  s.classList.toggle("erro", ehErro);
}

// Extrai o endereço do texto lido. Os cupons (iFood/Cardápio Web) têm um
// bloco fixo começando em "ENDEREÇO PARA ENTREGA:", então usamos essa
// estrutura. Retorna { endereco, complemento, aviso }.
function extrairEndereco(textoBruto) {
  const linhas = textoBruto
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Procura o cabeçalho do bloco de entrega
  const idxCab = linhas.findIndex((l) => /para\s+entrega/i.test(l));
  if (idxCab === -1) {
    return extrairPorPalavraChave(linhas, textoBruto); // plano B
  }

  let rua = "";
  const complemento = [];
  let bairroCidade = "";

  for (let i = idxCab + 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (/previs[aã]o/i.test(linha)) break;                 // fim do bloco
    if (!rua) {
      rua = linha;                                          // 1ª linha = rua + número
      continue;
    }
    if (/\s[-–]\s/.test(linha) && !/^comp/i.test(linha)) {
      bairroCidade = linha;                                 // "Bairro - Cidade"
      break;
    }
    complemento.push(linha.replace(/^comp\s*:\s*/i, ""));   // "Comp: ..." vira complemento
  }

  if (!rua) return extrairPorPalavraChave(linhas, textoBruto);

  // Monta o endereço para o mapa: rua, número + bairro, cidade
  let endereco = rua;
  if (bairroCidade) {
    endereco += ", " + bairroCidade.replace(/\s[-–]\s/, ", ");
  }

  // Detecta número da casa ausente ou inválido (ex.: ", 0")
  let aviso = "";
  const numero = rua.match(/,\s*(\d+)\b/);
  if (!numero) {
    aviso = "Não identifiquei o número da casa — confirme com o cliente.";
  } else if (numero[1] === "0") {
    aviso = "O número da casa veio como 0 (provavelmente faltando) — confirme com o cliente.";
  }

  return {
    endereco: endereco.trim(),
    complemento: complemento.join(" ").trim(),
    aviso,
  };
}

// Plano B: sem o cabeçalho padrão, procura uma linha que pareça logradouro.
function extrairPorPalavraChave(linhas, textoBruto) {
  const regexRua = /\b(rua|r\.|av\.?|avenida|travessa|tv\.?|alameda|al\.?|estrada|rod\.?|rodovia|pra[cç]a|p[cç]\.?)\b/i;
  const idx = linhas.findIndex((l) => regexRua.test(l));
  if (idx === -1) return null;

  const partes = [linhas[idx]];
  if (!/\d/.test(linhas[idx]) && linhas[idx + 1] && /\d/.test(linhas[idx + 1])) {
    partes.push(linhas[idx + 1]);
  }
  const cep = textoBruto.match(/\d{5}-?\d{3}/);
  if (cep) partes.push(cep[0]);

  return { endereco: partes.join(", "), complemento: "", aviso: "" };
}

async function lerFoto(arquivo) {
  if (!arquivo) return;

  if (typeof Tesseract === "undefined") {
    mostrarOcrStatus("O leitor de fotos não carregou (precisa de internet). Tente recarregar a página.", true);
    return;
  }

  el("ocr-bruto-box").hidden = true;
  mostrarOcrStatus("🔎 Lendo a foto... (a 1ª vez baixa o idioma e demora um pouco mais)");

  try {
    const { data } = await Tesseract.recognize(arquivo, "por", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          mostrarOcrStatus("🔎 Lendo a foto... " + Math.round(m.progress * 100) + "%");
        }
      },
    });

    const texto = (data.text || "").trim();

    // Sempre mostra o texto completo lido (pra conferência/cópia manual)
    el("ocr-bruto").textContent = texto || "(nada reconhecido)";
    el("ocr-bruto-box").hidden = false;

    const extraido = extrairEndereco(texto);
    if (extraido && extraido.endereco) {
      el("input-endereco").value = extraido.endereco;
      if (extraido.complemento) el("input-complemento").value = extraido.complemento;
      el("input-endereco").focus();

      if (extraido.aviso) {
        mostrarOcrStatus('⚠️ ' + extraido.aviso + ' Ajuste e clique em "Adicionar à lista".', true);
      } else {
        mostrarOcrStatus('✅ Endereço lido! Confira/ajuste e clique em "Adicionar à lista".');
      }
    } else {
      mostrarOcrStatus("⚠️ Não identifiquei o endereço sozinho. Veja o texto lido abaixo e preencha à mão.", true);
    }
  } catch (e) {
    mostrarOcrStatus("Ops, não consegui ler essa foto. Tente outra imagem (mais nítida e reta).", true);
    console.error(e);
  }
}

// =====================================================================
// PARTE B — GEOCODIFICAÇÃO (achar a latitude/longitude de um endereço)
// =====================================================================

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Faz UMA busca no Nominatim. Se levar uma "freada" por excesso de buscas
// (códigos 429/503) ou der um erro de rede pontual, espera e tenta de novo.
async function buscarNominatim(consulta) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1" +
    "&countrycodes=" + CONFIG.pais +
    "&q=" + encodeURIComponent(consulta);

  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const resposta = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
      if (resposta.status === 429 || resposta.status === 503) {
        await esperar(1500); // "calma, muitas buscas" — espera e repete
        continue;
      }
      if (!resposta.ok) return null;
      const dados = await resposta.json();
      if (!dados.length) return null;
      return { lat: parseFloat(dados[0].lat), lng: parseFloat(dados[0].lon) };
    } catch (e) {
      await esperar(800); // erro de rede pontual: respira e tenta mais uma vez
    }
  }
  return null;
}

// Geocodifica um endereço (acha lat/lng). Se não encontrar com o número
// exato da casa, tenta de novo só com a rua + cidade — melhor um ponto na
// rua certa do que perder a parada inteira.
async function geocodificar(endereco, cidade) {
  const montar = (texto) =>
    cidade && !texto.toLowerCase().includes(cidade.toLowerCase())
      ? texto + ", " + cidade
      : texto;

  // Tentativa 1: endereço completo
  let resultado = await buscarNominatim(montar(endereco));
  if (resultado) return resultado;

  // Tentativa 2 (reserva): remove o número da casa e busca a rua
  const semNumero = endereco
    .replace(/\b\d+\b/g, "")     // tira números soltos (o nº da casa)
    .replace(/\s*,\s*,/g, ",")   // limpa vírgulas duplicadas
    .replace(/\s{2,}/g, " ")     // limpa espaços extras
    .replace(/^[\s,]+|[\s,]+$/g, "") // tira vírgulas/espaços nas pontas
    .trim();

  if (semNumero && semNumero.toLowerCase() !== endereco.toLowerCase()) {
    await esperar(CONFIG.pausaGeocodificacaoMs);
    resultado = await buscarNominatim(montar(semNumero));
    if (resultado) return { ...resultado, aproximado: true };
  }

  return null;
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
    // Zera as coordenadas antes, para sempre recalcular do zero.
    estado.entregas.forEach((e) => {
      e.lat = null;
      e.lng = null;
      e.aproximado = false;
    });
    const naoEncontrados = [];
    for (let i = 0; i < estado.entregas.length; i++) {
      const entrega = estado.entregas[i];
      mostrarStatus(`🔎 Localizando endereços... (${i + 1}/${estado.entregas.length})`);
      await esperar(CONFIG.pausaGeocodificacaoMs);
      const coord = await geocodificar(entrega.endereco, cidade);
      if (coord) {
        entrega.lat = coord.lat;
        entrega.lng = coord.lng;
        entrega.aproximado = !!coord.aproximado;
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
    const aprox = entrega.aproximado
      ? `<span class="compl">📍 local aproximado (rua, sem o número exato)</span>`
      : "";
    li.innerHTML = `${entrega.endereco}${tag}${compl}${aprox}`;
    ol.appendChild(li);
  });

  // Link do Maps
  el("link-maps").href = gerarLinkDoMaps(origem, rota);

  // Aviso PERSISTENTE de endereços não localizados (fica dentro do resultado)
  const aviso = el("aviso-drops");
  if (naoEncontrados.length) {
    aviso.innerHTML =
      `⚠️ <strong>${naoEncontrados.length} endereço(s) não localizado(s)</strong> — ` +
      "ficaram de fora da rota:<br>• " +
      naoEncontrados.join("<br>• ") +
      "<br><br>Confira a escrita (rua, número, bairro) e a cidade base, depois otimize de novo.";
    aviso.hidden = false;
  } else {
    aviso.hidden = true;
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

  // Leitura por foto (OCR)
  el("input-foto").addEventListener("change", (evento) => {
    const arquivo = evento.target.files && evento.target.files[0];
    lerFoto(arquivo);
    evento.target.value = ""; // permite reenviar a mesma foto depois
  });

  // Botão otimizar
  el("btn-otimizar").addEventListener("click", otimizar);

  // Botão limpar lista
  el("btn-limpar").addEventListener("click", () => {
    if (estado.entregas.length === 0) return;
    if (confirm("Apagar todas as entregas da lista?")) limparTudo();
  });

  // Salva a lanchonete e a cidade conforme o usuário digita
  ["input-lanchonete", "input-cidade"].forEach((id) => {
    el(id).addEventListener("input", salvarEstado);
  });

  // Recupera os dados salvos da última vez e mostra a lista
  carregarEstado();
  renderizarLista();

  console.log("Rota Esperta — Etapa 2.1 carregada ✅");
}

iniciar();

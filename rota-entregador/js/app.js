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

  // Formato com RÓTULOS (Endereco:/Comp:/Bairro:/Cidade:/Ref:). Detecta pela
  // presença de "Bairro:" ou "Cidade:".
  if (/bairro\s*:/i.test(textoBruto) || /cidade\s*:/i.test(textoBruto)) {
    const r = extrairPorRotulos(linhas);
    if (r && r.endereco) return r;
  }

  // Formato em BLOCO "ENDEREÇO PARA ENTREGA" (uma linha por campo).
  if (linhas.some((l) => /entrega/i.test(l) && !/entrega\s*pr[oó]?pria/i.test(l))) {
    const r = extrairBloco(textoBruto);
    if (r && r.endereco) return r;
  }

  // Último recurso: procura uma linha que pareça logradouro.
  return extrairPorPalavraChave(linhas, textoBruto);
}

// Lê o formato com RÓTULOS. Junta palavras quebradas entre linhas (ex.:
// "Sou" + "za" -> "Souza") e separa os campos pelos rótulos.
function extrairPorRotulos(linhas) {
  // Reconstrói o texto: se a próxima linha começa com letra minúscula, é
  // continuação de palavra quebrada (cola sem espaço); senão, é palavra ou
  // rótulo novo (junta com espaço).
  let texto = "";
  linhas.forEach((l, i) => {
    if (i === 0) { texto = l; return; }
    texto += /^\p{Ll}/u.test(l) ? l : " " + l;
  });

  const rotulos = [
    { chave: "endereco", re: /endere[çc]o\s+para\s+entrega\s*:?|endere[çc]o\s*:|entrega\s*:/i },
    { chave: "comp", re: /comp(?:lemento)?\s*:/i },
    { chave: "ref", re: /ref(?:er[êe]ncia)?\s*:/i },
    { chave: "bairro", re: /bairro\s*:/i },
    { chave: "cidade", re: /cidade\s*:/i },
    { chave: "cep", re: /cep\s*:/i },
  ];

  const marcas = [];
  rotulos.forEach((r) => {
    const m = texto.match(r.re);
    if (m) marcas.push({ chave: r.chave, inicio: m.index, fim: m.index + m[0].length });
  });
  if (!marcas.length) return null;
  marcas.sort((a, b) => a.inicio - b.inicio);

  // Onde cortar o último campo (pra não engolir itens/valores do cupom)
  const terminador = /previs|entrega\s*pr[oó]?pria|itens\s*do\s*pedido|valor\s*unit|formas?\s*de\s*pagamento|r\$/i;

  const campos = {};
  marcas.forEach((marca, i) => {
    const fim = i + 1 < marcas.length ? marcas[i + 1].inicio : texto.length;
    let valor = texto.slice(marca.fim, fim);
    const t = valor.match(terminador);
    if (t) valor = valor.slice(0, t.index);
    if (!(marca.chave in campos)) campos[marca.chave] = valor;
  });

  const limparCampo = (s) =>
    (s || "")
      .replace(/["'\[\]{}()\\/|]+/g, " ")
      .replace(/\bn[º°o]\.?\s+(?=\d)/gi, "")  // remove "Nº " antes do número
      .replace(/_/g, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s,.\-:;]+|[\s,.\-:;]+$/g, "")
      .trim();

  const ruaNum = limparCampo(campos.endereco);
  if (!ruaNum) return null;

  const comp = limparCampo(campos.comp);
  const ref = limparCampo(campos.ref);
  const complemento = [comp, ref].filter(Boolean).join(" · ");

  const bairro = limparCampo(campos.bairro);
  const cidade = limparCampo(campos.cidade).replace(/\s[-–]\s/g, ", "); // "Maringa - PR" -> "Maringa, PR"

  const endereco = [ruaNum, bairro, cidade].filter(Boolean).join(", ");

  let aviso = "";
  const numero = ruaNum.match(/,\s*(\d+)/) || ruaNum.match(/(\d+)\s*$/);
  const composto = ruaNum.match(/,\s*\d+\s*[_\-\/]\s*\d+/);
  if (!numero) aviso = "Não identifiquei o número da casa — confirme com o cliente.";
  else if (numero[1] === "0") aviso = "O número da casa veio como 0 (provavelmente faltando) — confirme com o cliente.";
  else if (composto) aviso = "Confira o número da casa — pode ter apartamento/unidade junto.";

  return { endereco, complemento, aviso };
}

// Lê o formato em BLOCO ("ENDEREÇO PARA ENTREGA" + uma linha por campo).
function extrairBloco(textoBruto) {
  const linhas = textoBruto
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Procura o cabeçalho do bloco de entrega. Tolerante a erros de OCR: basta
  // a palavra "entrega" (o trecho "ENTREGA:" costuma sobreviver mesmo quando
  // "ENDEREÇO PARA" sai bagunçado). Ignora a linha "ENTREGA PRÓPRIA".
  const idxCab = linhas.findIndex(
    (l) => /entrega/i.test(l) && !/entrega\s*pr[oó]?pria/i.test(l)
  );
  if (idxCab === -1) {
    return extrairPorPalavraChave(linhas, textoBruto); // plano B
  }

  // Marcadores que indicam o FIM do bloco de endereço. São tolerantes a
  // erros do OCR (ex.: "Previsão" pode virar "revisão"). Se a linha bater
  // em qualquer um deles, paramos de ler o endereço ali.
  const ehFimDoBloco = (l) =>
    /previs|revis[aã]o|entrega\s*pr|itens\s*do\s*pedido|valor\s*unit|^\s*qtd\b|pedido\s*n|r\$/i.test(l);

  // Coleta só as primeiras linhas após o cabeçalho (no máx. 5), parando no
  // 1º marcador de fim — assim itens e valores do cupom não vazam.
  const bloco = [];
  for (let i = idxCab + 1; i < linhas.length && bloco.length < 5; i++) {
    if (ehFimDoBloco(linhas[i])) break;
    bloco.push(linhas[i]);
  }
  if (!bloco.length) return extrairPorPalavraChave(linhas, textoBruto);

  // Limpa uma linha: corta restos de item/valor e tira pontuação solta.
  const limpar = (l) =>
    l
      .replace(/\s*(r\$|itens\s*do\s*pedido|entrega\s*pr|valor\s*unit|previs|revis[aã]o).*$/i, "")
      .replace(/["'\[\]{}()\\/|]+/g, " ")          // tira aspas, colchetes, parênteses, barras
      .replace(/_/g, " ")                          // underscore costuma ser ruído de OCR
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s,.\-:;]+|[\s,.\-:;]+$/g, "")    // tira pontuação solta nas pontas
      .trim();

  const rua = limpar(bloco[0]); // 1ª linha = rua + número

  // Bairro - Cidade: a última linha do bloco que tenha " - " (e não seja Comp)
  let bairroLinha = "";
  for (let i = bloco.length - 1; i >= 1; i--) {
    if (/\s[-–]\s/.test(bloco[i]) && !/^comp/i.test(bloco[i])) {
      bairroLinha = bloco[i];
      break;
    }
  }
  // Reserva: se o OCR perdeu o "-", usa a última linha do bloco como
  // bairro/cidade — desde que não seja a rua, não seja um "Comp:" e tenha
  // letras suficientes (evita lixo mutilado tipo "A," virar bairro).
  if (!bairroLinha && bloco.length >= 2) {
    const ultima = bloco[bloco.length - 1];
    const letras = (limpar(ultima).match(/[a-zà-ú]/gi) || []).length;
    if (!/^comp/i.test(ultima) && letras >= 4) bairroLinha = ultima;
  }
  const bairroCidade = bairroLinha ? limpar(bairroLinha).replace(/\s[-–]\s/, ", ") : "";

  // Complemento: as demais linhas do bloco (fora a rua e o bairro).
  // Descarta pedaços curtos demais (lixo de OCR como "A").
  const complemento = bloco
    .filter((l, idx) => idx !== 0 && l !== bairroLinha)
    .map((l) => limpar(l.replace(/^comp\s*:?\s*/i, "")))
    .filter((l) => l.length >= 3)
    .join(" ");

  if (!rua) return extrairPorPalavraChave(linhas, textoBruto);

  let endereco = rua;
  if (bairroCidade) endereco += ", " + bairroCidade;

  // Detecta número da casa ausente ou inválido (ex.: ", 0")
  let aviso = "";
  const numero = rua.match(/,\s*(\d+)/) || rua.match(/(\d+)\s*$/);
  const composto = bloco[0].match(/,\s*\d+\s*[_\-\/]\s*\d+/); // ex.: "360_43"
  if (!numero) {
    aviso = "Não identifiquei o número da casa — confirme com o cliente.";
  } else if (numero[1] === "0") {
    aviso = "O número da casa veio como 0 (provavelmente faltando) — confirme com o cliente.";
  } else if (composto) {
    aviso = "Confira o número da casa — pode ter apartamento/unidade junto.";
  }

  return { endereco: endereco.trim(), complemento, aviso };
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

// Melhora a imagem antes do OCR: amplia fotos pequenas, converte para tons de
// cinza e estica o contraste. Ajuda bastante em cupons térmicos / fotos
// "médias". Se algo falhar, o chamador usa a imagem original.
function preprocessarImagem(arquivo) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(arquivo);

    img.onload = () => {
      try {
        const escala = Math.min(2.5, Math.max(1, 1600 / img.width));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const p = imgData.data;

        // Tons de cinza + descobre o mais claro e o mais escuro
        let min = 255, max = 0;
        for (let i = 0; i < p.length; i += 4) {
          const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
          p[i] = p[i + 1] = p[i + 2] = g;
          if (g < min) min = g;
          if (g > max) max = g;
        }
        // Estica o contraste (min..max -> 0..255)
        const range = Math.max(1, max - min);
        for (let i = 0; i < p.length; i += 4) {
          const v = ((p[i] - min) / range) * 255;
          p[i] = p[i + 1] = p[i + 2] = v;
        }
        ctx.putImageData(imgData, 0, 0);

        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          blob ? resolve(blob) : reject(new Error("sem blob"));
        }, "image/png");
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("falha ao carregar imagem"));
    };
    img.src = url;
  });
}

async function lerFoto(arquivo) {
  if (!arquivo) return;

  if (typeof Tesseract === "undefined") {
    mostrarOcrStatus("O leitor de fotos não carregou (precisa de internet). Tente recarregar a página.", true);
    return;
  }

  el("ocr-bruto-box").hidden = true;
  mostrarOcrStatus("🔎 Preparando a imagem...");

  try {
    // Trata a imagem (cinza + contraste + ampliação) antes de ler.
    // Se falhar por algum motivo, segue com a foto original.
    let entrada = arquivo;
    try {
      entrada = await preprocessarImagem(arquivo);
    } catch (e) {
      entrada = arquivo;
    }

    mostrarOcrStatus("🔎 Lendo a foto... (a 1ª vez baixa o idioma e demora um pouco mais)");
    const { data } = await Tesseract.recognize(entrada, "por", {
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

// Centro geográfico de um conjunto de pontos. Usado como "âncora" para
// ordenar a rota quando o ponto de partida não pôde ser localizado em
// coordenadas (ex.: o usuário digitou o nome da lanchonete).
function centroide(pontos) {
  const n = pontos.length || 1;
  const soma = pontos.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 }
  );
  return { lat: soma.lat / n, lng: soma.lng / n };
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

function gerarLinkDoMaps(origemTexto, entregasOrdenadas, cidade) {
  // Usa o ENDEREÇO ESCRITO (não a coordenada do OpenStreetMap). Assim quem
  // localiza é o próprio Google Maps, que tem os números das casas com
  // precisão. Também faz o ponto de partida por NOME funcionar.
  const comCidade = (s) => {
    let v = (s || "").trim();
    if (cidade && !v.toLowerCase().includes(cidade.toLowerCase())) v += ", " + cidade;
    return encodeURIComponent(v);
  };

  const origem = comCidade(origemTexto);
  const paradas = entregasOrdenadas.map((e) => comCidade(e.endereco)).join("|");

  return (
    "https://www.google.com/maps/dir/?api=1" +
    "&origin=" + origem +
    "&destination=" + origem + // rota fechada: volta ao ponto de partida
    "&waypoints=" + paradas +
    "&travelmode=driving"
  );
}

// Link de navegação direta no Waze (usado quando há só 1 entrega).
function gerarLinkWaze(endereco, cidade) {
  let v = (endereco || "").trim();
  if (cidade && !v.toLowerCase().includes(cidade.toLowerCase())) v += ", " + cidade;
  return "https://waze.com/ul?q=" + encodeURIComponent(v) + "&navigate=yes";
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

  const total = estado.entregas.length;
  if (total === 0) {
    mostrarStatus("Adicione pelo menos 1 entrega.", true);
    return;
  }

  // 1 entrega: navegação direta no Waze (sem otimizar nem ponto de partida).
  if (total === 1) {
    exibirResultadoUnico(estado.entregas[0], cidade);
    return;
  }

  // 2+ entregas: precisa do ponto de partida para fechar a rota.
  if (!enderecoLanchonete) {
    mostrarStatus("Preencha o ponto de partida primeiro.", true);
    return;
  }

  const botao = el("btn-otimizar");
  botao.disabled = true;
  el("cartao-resultado").hidden = true;

  try {
    // 1) Geocodificar o ponto de partida (só para ORDENAR a rota). Se não
    // achar a coordenada (ex.: nome de lanchonete), seguimos mesmo assim:
    // a navegação usa o texto e a ordenação usa o centro das entregas.
    mostrarStatus("🔎 Localizando o ponto de partida...");
    const origem = await geocodificar(enderecoLanchonete, cidade);

    // 2) Geocodificar cada entrega (uma por vez, respeitando o limite)
    // Zera as coordenadas antes, para sempre recalcular do zero.
    estado.entregas.forEach((e) => {
      e.lat = null;
      e.lng = null;
      e.aproximado = false;
    });
    for (let i = 0; i < estado.entregas.length; i++) {
      const entrega = estado.entregas[i];
      mostrarStatus(`🔎 Localizando endereços... (${i + 1}/${estado.entregas.length})`);
      await esperar(CONFIG.pausaGeocodificacaoMs);
      const coord = await geocodificar(entrega.endereco, cidade);
      if (coord) {
        entrega.lat = coord.lat;
        entrega.lng = coord.lng;
      }
    }

    // 3) Ordenar. Se ao menos 2 entregas têm coordenada, otimiza; as demais
    // entram no fim (o Google ainda navega por elas, via texto). Assim a rota
    // nunca falha por causa de um endereço que o OpenStreetMap não achou.
    mostrarStatus("🧮 Calculando a melhor rota...");
    const idPrioritaria = estado.entregas[0].id; // a 1ª adicionada
    const comCoord = estado.entregas.filter((e) => e.lat !== null);
    const semCoord = estado.entregas.filter((e) => e.lat === null);

    let rotaFinal;
    let priorizada = false;
    let ancora = null;
    if (comCoord.length >= 2) {
      ancora = origem || centroide(comCoord);
      let rota = vizinhoMaisProximo(ancora, comCoord);
      rota = melhorar2opt(ancora, rota);
      const resultado = aplicarPrioridade(ancora, rota, idPrioritaria);
      rotaFinal = resultado.rota.concat(semCoord);
      priorizada = resultado.priorizada;
    } else {
      rotaFinal = estado.entregas.slice(); // ordem em que foram adicionadas
    }

    // 4) Mostrar o resultado (a navegação usa o TEXTO do endereço)
    exibirResultado(ancora, rotaFinal, idPrioritaria, priorizada, semCoord.map((e) => e.endereco), enderecoLanchonete, cidade);
    el("status").hidden = true;
  } catch (erro) {
    mostrarStatus("Ops, deu um problema ao consultar o mapa. Tente de novo em instantes.", true);
    console.error(erro);
  } finally {
    botao.disabled = false;
  }
}

function exibirResultado(ancora, rota, idPrioritaria, priorizada, naoOrdenados, origemTexto, cidade) {
  // Só estima a distância quando dá para medir todos os pontos.
  const podeMedir = ancora && rota.every((e) => e.lat != null);
  let resumo;
  if (podeMedir) {
    const km = comprimentoRota(ancora, rota).toFixed(1);
    resumo = `Distância total (ida e volta): ~${km} km · ${rota.length} paradas.`;
    resumo += priorizada
      ? " ⭐ A prioritária foi adiantada (cabia dentro do limite)."
      : " A prioritária ficou na ordem eficiente.";
  } else {
    resumo = `${rota.length} paradas na rota.`;
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

  // Botão do Google Maps (usa o TEXTO dos endereços, para o número ser preciso)
  const link = el("link-maps");
  link.href = gerarLinkDoMaps(origemTexto, rota, cidade);
  link.textContent = "🚀 Abrir rota no Google Maps";

  // Aviso: endereços que não consegui ordenar (entraram na ordem adicionada)
  const aviso = el("aviso-drops");
  if (naoOrdenados && naoOrdenados.length) {
    aviso.innerHTML =
      `ℹ️ <strong>${naoOrdenados.length} endereço(s)</strong> eu não localizei para ordenar, ` +
      "então entraram na ordem em que você adicionou (o Google Maps ainda navega por eles):<br>• " +
      naoOrdenados.join("<br>• ");
    aviso.hidden = false;
  } else {
    aviso.hidden = true;
  }

  el("cartao-resultado").hidden = false;
  el("cartao-resultado").scrollIntoView({ behavior: "smooth" });
}

// Resultado quando há só 1 entrega: navegação direta no Waze.
function exibirResultadoUnico(entrega, cidade) {
  el("resumo-rota").textContent = "1 entrega — toque para navegar direto no Waze. 🟦";

  const ol = el("resultado-ordem");
  ol.innerHTML = "";
  const li = document.createElement("li");
  const compl = entrega.complemento
    ? `<span class="compl">📝 ${entrega.complemento}</span>`
    : `<span class="compl">⚠️ sem complemento</span>`;
  li.innerHTML = `${entrega.endereco}${compl}`;
  ol.appendChild(li);

  const link = el("link-maps");
  link.href = gerarLinkWaze(entrega.endereco, cidade);
  link.textContent = "🟦 Abrir no Waze";

  el("aviso-drops").hidden = true;
  el("status").hidden = true;
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

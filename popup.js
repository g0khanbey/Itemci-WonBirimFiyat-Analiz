const scanButton = document.getElementById("taraBtn");
const buttonText = document.getElementById("buttonText");
const statusBox = document.getElementById("status");
const summary = document.getElementById("summary");
const resultsSection = document.getElementById("resultsSection");
const list = document.getElementById("liste");
const resultCount = document.getElementById("resultCount");
const bestPrice = document.getElementById("bestPrice");
const averagePrice = document.getElementById("averagePrice");

const moneyFormatter = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const wonFormatter = new Intl.NumberFormat("tr-TR", {
  maximumFractionDigits: 0
});

scanButton.addEventListener("click", scanActivePage);

function setLoading(isLoading) {
  scanButton.disabled = isLoading;
  scanButton.classList.toggle("is-loading", isLoading);
  buttonText.textContent = isLoading ? "İlanlar taranıyor…" : "Sayfadaki ilanları tara";
}

function showStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", isError);
  statusBox.hidden = !message;
}

function clearResults() {
  list.replaceChildren();
  summary.hidden = true;
  resultsSection.hidden = true;
}

function calculateAverageUnitPrice(items) {
  const values = items
    .map(item => item.birim)
    .filter(value => Number.isFinite(value) && value > 0);

  if (!values.length) return NaN;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

async function scanActivePage() {
  setLoading(true);
  clearResults();
  showStatus("Açık sayfadaki ürün kartları okunuyor…");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !/^https?:/i.test(tab.url || "")) {
      throw new Error("Taranabilir bir web sayfası açık değil.");
    }

    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanItemciPage
    });

    const scanResult = injectionResults?.[0]?.result;
    const items = Array.isArray(scanResult?.items) ? scanResult.items : [];

    if (!items.length) {
      const detail = scanResult?.totalCards
        ? `${scanResult.totalCards} ürün kartı bulundu ancak başlığında WON miktarı olan uygun ilan yok.`
        : "Bu sayfada Itemci ürün ilanı bulunamadı. Önce WON ilanlarının listelendiği kategori sayfasını açın.";
      showStatus(detail, true);
      return;
    }

    const sortedItems = items
      .filter(item => Number.isFinite(item.birim) && item.birim > 0)
      .sort((a, b) => a.birim - b.birim)
      .slice(0, 10);

    if (!sortedItems.length) {
      showStatus("İlanlar bulundu ancak birim fiyat hesaplanamadı.", true);
      return;
    }

    renderResults(sortedItems, items);
    showStatus("");
  } catch (error) {
    const message = error?.message || "Sayfa taranırken beklenmeyen bir hata oluştu.";
    showStatus(message, true);
  } finally {
    setLoading(false);
  }
}

function renderResults(items, allItems) {
  const fragment = document.createDocumentFragment();

  items.forEach((item, index) => {
    const link = document.createElement("a");
    link.className = "result-link";
    link.href = item.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = item.title || "İlanı aç";

    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = String(index + 1).padStart(2, "0");

    const main = document.createElement("span");
    main.className = "result-main";

    const unitPrice = document.createElement("strong");
    unitPrice.className = "unit-price";
    unitPrice.textContent = `${moneyFormatter.format(item.birim)} TL / WON`;

    const detail = document.createElement("span");
    detail.className = "result-detail";
    detail.textContent = `${wonFormatter.format(item.won)} WON · ${moneyFormatter.format(item.fiyat)} TL`;

    const seller = document.createElement("span");
    seller.className = "seller";
    seller.textContent = `Satıcı: ${item.satici || "Belirtilmemiş"}`;

    const openIcon = document.createElement("span");
    openIcon.className = "open-icon";
    openIcon.setAttribute("aria-hidden", "true");
    openIcon.textContent = "→";

    main.append(unitPrice, detail, seller);
    link.append(rank, main, openIcon);
    fragment.append(link);
  });

  list.replaceChildren(fragment);
  // `items` contains the ten cheapest listings currently shown below.
  const averageUnitPrice = calculateAverageUnitPrice(items);

  resultCount.textContent = wonFormatter.format(allItems.length);
  bestPrice.textContent = `${moneyFormatter.format(items[0].birim)} TL/WON`;
  averagePrice.textContent = `${moneyFormatter.format(averageUnitPrice)} TL/WON`;
  summary.hidden = false;
  resultsSection.hidden = false;
}

// This function runs inside the active tab and must remain self-contained.
function scanItemciPage(pageDocument = document, pageOrigin = location.origin) {
  function parseTurkishNumber(value) {
    let normalized = String(value ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/[^\d,.-]/g, "")
      .replace(/^-/, "-");

    if (!normalized) return NaN;

    if (normalized.includes(",")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else if ((normalized.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(normalized)) {
      normalized = normalized.replace(/\./g, "");
    }

    return Number.parseFloat(normalized);
  }

  function extractWon(title) {
    // Only read the single number immediately before WON/W. For example,
    // "BİRİM 8.9 2500WON" must resolve to 2500, not 892500.
    const match = String(title ?? "").match(/\b(\d[\d.,]*)\s*(?:WON|W)\b/i);
    if (!match) return NaN;
    return Number.parseInt(match[1].replace(/[.,]/g, ""), 10);
  }

  function absoluteUrl(value) {
    try {
      return new URL(value, pageOrigin).href;
    } catch {
      return String(value || "");
    }
  }

  function findSchemaProducts() {
    const products = new Map();

    pageDocument.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try {
        const root = JSON.parse(script.textContent);
        const queue = Array.isArray(root) ? [...root] : [root];

        while (queue.length) {
          const node = queue.shift();
          if (!node || typeof node !== "object") continue;

          if (node["@type"] === "Product") {
            const priceValue = Array.isArray(node.offers)
              ? node.offers[0]?.price
              : node.offers?.price;
            const url = absoluteUrl(node.url);
            const price = parseTurkishNumber(priceValue);
            if (url && Number.isFinite(price)) {
              products.set(url, { title: String(node.name || ""), price });
            }
          }

          Object.values(node).forEach(value => {
            if (value && typeof value === "object") {
              if (Array.isArray(value)) queue.push(...value);
              else queue.push(value);
            }
          });
        }
      } catch {
        // Ignore unrelated or malformed structured-data blocks.
      }
    });

    return products;
  }

  const schemaProducts = findSchemaProducts();
  const resultsByLink = new Map();
  const productCards = [...pageDocument.querySelectorAll('a[href*="/product/"]')]
    .filter(card => card.querySelector("h3"));

  productCards.forEach(card => {
    const titleElement = card.querySelector("h3");
    const link = absoluteUrl(card.href);
    const schemaProduct = schemaProducts.get(link);
    const title = titleElement?.textContent?.trim() || schemaProduct?.title || "";
    const won = extractWon(title);
    if (!Number.isFinite(won) || won <= 0) return;

    const priceRow = titleElement?.nextElementSibling;
    let priceText = priceRow?.firstElementChild?.textContent || "";

    if (!/TL/i.test(priceText)) {
      const priceElement = [...card.querySelectorAll("div")]
        .find(element => /^\s*[\d.,]+\s*TL\s*$/i.test(element.textContent || ""));
      priceText = priceElement?.textContent || "";
    }

    let price = parseTurkishNumber(priceText);
    if (!Number.isFinite(price)) price = schemaProduct?.price;
    if (!Number.isFinite(price) || price <= 0) return;

    const sellerRow = priceRow?.nextElementSibling;
    const sellerImage = sellerRow?.querySelector("img[alt]")
      || [...card.querySelectorAll("img[alt]")].find(image => image.alt && image.alt !== title);
    const sellerText = sellerRow?.querySelector(".truncate")?.textContent?.trim();
    const seller = sellerImage?.alt?.trim() || sellerText || "Belirtilmemiş";

    resultsByLink.set(link, {
      won,
      fiyat: price,
      birim: price / won,
      satici: seller,
      title,
      link
    });
  });

  // If the visual card markup changes again, use Itemci's structured product data.
  if (!resultsByLink.size) {
    schemaProducts.forEach((product, link) => {
      const won = extractWon(product.title);
      if (!Number.isFinite(won) || won <= 0 || product.price <= 0) return;

      resultsByLink.set(link, {
        won,
        fiyat: product.price,
        birim: product.price / won,
        satici: "Belirtilmemiş",
        title: product.title,
        link
      });
    });
  }

  // Keep compatibility with Itemci's previous listing layout as a final fallback.
  if (!resultsByLink.size) {
    pageDocument.querySelectorAll(".advert-data").forEach(card => {
      const title = card.querySelector(".AdvertMd-Title")?.textContent?.trim() || "";
      const price = parseTurkishNumber(card.querySelector(".AdvertPriceText")?.textContent);
      const won = extractWon(title);
      const link = absoluteUrl(card.querySelector("a.showPostLink")?.href);
      if (!link || !Number.isFinite(price) || !Number.isFinite(won) || price <= 0 || won <= 0) return;

      resultsByLink.set(link, {
        won,
        fiyat: price,
        birim: price / won,
        satici: card.querySelector(".uUserName")?.textContent?.trim() || "Belirtilmemiş",
        title,
        link
      });
    });
  }

  return {
    items: [...resultsByLink.values()],
    totalCards: productCards.length
  };
}

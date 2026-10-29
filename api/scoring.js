function firstDefined(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePrice(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return { min: value, max: value, isRange: false, display: String(value) };
  }
  const text = String(value);
  const matches = text.match(/\d+(\.\d+)?/g);
  if (!matches) return null;
  const numbers = matches.map(Number).filter((n) => Number.isFinite(n));
  if (!numbers.length) return null;
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  return { min, max, isRange: min !== max, display: text.trim() };
}

function parseName(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const arr = JSON.parse(value);
      if (Array.isArray(arr) && arr.length) return String(arr[0]);
    } catch { /* keep raw */ }
  }
  return String(value);
}

function parseImage(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const arr = JSON.parse(value);
      if (Array.isArray(arr) && arr.length) return String(arr[0]);
    } catch { /* keep raw */ }
  }
  return String(value);
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "product";
}

function buildProductUrl(name, id) {
  if (!id) return null;
  return `https://cjdropshipping.com/product/${slugify(name)}-p-${encodeURIComponent(String(id))}.html`;
}

export function recommendSellingSites({ category, name }) {
  const hay = `${String(category || "")} ${String(name || "")}`.toLowerCase();
  const match = (words) => words.some((w) => hay.includes(w));
  const picks = [];
  const add = (site, why) => {
    if (!picks.some((p) => p.site === site)) picks.push({ site, why });
  };

  if (match(["handmade", "jewelry", "jewellery", "craft", "wedding", "personalized", "ornament"])) {
    add("Etsy", "Custom/handmade-style items fit Etsy buyers who pay for uniqueness.");
  }
  if (match(["beauty", "makeup", "nail", "cosmetic", "skin care", "perfume", "hair ", "acne", "pimple", "lip "])) {
    add("TikTok Shop", "Beauty products sell through quick demo videos.");
    add("Instagram Shop", "Before/after visuals convert well on Reels and feed posts.");
  }
  if (match(["clothing", "apparel", "fashion", "dress", "shirt", "shoe", "bag", "watch", "underwear", "swimwear", "accessor", "pantie", "boxer", "waist", "legging", "sock", "bra ", "glove", "hat ", "scarf"])) {
    add("TikTok Shop", "Fashion impulse buys perform strongly on TikTok.");
    add("Instagram Shop", "Fashion audiences engage with visual feeds and creators.");
  }
  if (match(["pet ", "dog", "cat ", "pet supplies"])) {
    add("Amazon", "Pet owners reorder on marketplaces with reviews and Prime.");
  }
  if (match(["electronic", "gadget", "charger", "earbud", "headphone", "led ", "smart ", "phone "])) {
    add("Amazon", "Gadget shoppers compare specs and reviews on Amazon.");
  }
  if (match(["kitchen", "home ", "garden", "furniture", "storage", "cleaning", "decor"])) {
    add("Amazon", "Home and kitchen is a huge search category on Amazon.");
    add("eBay", "Utility items sell steadily with lower ad pressure on eBay.");
  }
  if (match(["mask", "health", "medical", "first aid", "thermometer"])) {
    add("Amazon", "Health-care buyers trust marketplaces with reviews.");
  }
  if (match(["toy", "kids", "baby", "children"])) {
    add("Amazon", "Parents trust marketplaces with reviews and fast shipping.");
  }
  if (match(["sport", "outdoor", "fitness", "camping", "bike", "yoga"])) {
    add("Amazon", "Sports buyers rely on reviews and fast delivery.");
  }
  if (match(["car ", "auto ", "tool", "motorcycle", "truck"])) {
    add("eBay", "Auto parts and tools sell well as eBay listings.");
  }

  add("Shopify", "Your own brand store — CJ syncs products and orders directly.");
  add("TikTok Shop", "CJ provides product videos you can run as short-video ads.");
  if (picks.length < 4) add("Amazon", "Large marketplace demand once the product is validated.");
  if (picks.length < 5) add("eBay", "Steady marketplace traffic with low entry cost.");
  if (picks.length < 5) add("WooCommerce", "Self-hosted store option CJ can integrate with.");
  return picks.slice(0, 5);
}

export function analyzeProduct(raw) {
  const id = firstDefined(raw, ["id", "pid", "productId", "product_id", "sku"]);
  const name = parseName(firstDefined(raw, ["nameEn", "productNameEn", "productName", "name", "title"]))
    || "Unnamed CJ product";
  const image = parseImage(firstDefined(raw, ["bigImage", "productImage", "image", "imageUrl"]));
  const cjCost = parsePrice(firstDefined(raw, ["sellPrice", "productPrice", "price"]));
  const promo = parsePrice(firstDefined(raw, ["nowPrice", "discountPrice"]));
  const stock = numberOrNull(firstDefined(raw, [
    "warehouseInventoryNum", "totalVerifiedInventory", "库存", "stock", "inventory", "availableStock", "quantity"
  ]));
  const listedNum = numberOrNull(firstDefined(raw, ["listedNum", "listed_num"]));
  const isFreeShipping = firstDefined(raw, ["addMarkStatus", "isFreeShipping"]) === 1
    || firstDefined(raw, ["isFreeShipping"]) === true;
  const hasVideo = firstDefined(raw, ["isVideo", "isVedio"]) === 1;
  const verifiedWarehouse = firstDefined(raw, ["verifiedWarehouse"]) === 1;
  const deliveryCycle = firstDefined(raw, ["deliveryCycle"]);
  const deliveryDays = deliveryCycle ? numberOrNull(String(deliveryCycle).split("-").pop()) : null;
  const category = parseName(firstDefined(raw, ["threeCategoryName", "categoryName", "twoCategoryName", "oneCategoryName"]));
  const currency = firstDefined(raw, ["currency"]) || "USD";
  const suggest = parsePrice(firstDefined(raw, ["suggestSellPrice"]));
  const supplierNameValue = firstDefined(raw, ["supplierName"]);
  const supplierIdValue = firstDefined(raw, ["supplierId"]);
  const supplierId = supplierIdValue !== null && supplierIdValue !== "{}" ? String(supplierIdValue) : null;
  const sourceFrom = firstDefined(raw, ["sourceFrom"]);

  const effectiveCost = promo && cjCost && promo.min < cjCost.min ? promo : cjCost;

  const evidence = [];
  let score = 0;

  if (listedNum !== null) {
    if (listedNum >= 1000) score += 30;
    else if (listedNum >= 100) score += 24;
    else if (listedNum >= 50) score += 17;
    else if (listedNum >= 20) score += 11;
    else if (listedNum >= 5) score += 5;
    evidence.push(`Listed ${listedNum}× by sellers — strongest demand signal CJ provides.`);
  } else {
    evidence.push("Listing count not available; demand is unproven from this field.");
  }

  if (effectiveCost) {
    const price = effectiveCost.min;
    if (price >= 8 && price <= 45) {
      score += 12;
      evidence.push(`CJ cost $${price} sits in a common dropship test range — heuristic only.`);
    } else if (price > 45 && price <= 80) {
      score += 6;
      evidence.push(`CJ cost $${price} is mid-range; usually needs stronger proof of demand — heuristic only.`);
    } else if (price > 0 && price < 8) {
      score += 4;
      evidence.push(`CJ cost $${price} is low; shipping/ads can eat margin — heuristic only.`);
    } else {
      evidence.push(`CJ cost $${price}.`);
    }
    if (effectiveCost.isRange) {
      evidence.push(`Variant price range ${effectiveCost.display}.`);
    }
  } else {
    evidence.push("CJ sell price not recognized; verify API field mapping.");
  }

  if (promo && cjCost && promo.min < cjCost.min) {
    score += 4;
    evidence.push(`Promo price active (${promo.display} vs ${cjCost.display}).`);
  }

  if (stock !== null) {
    if (stock > 0) score += 10;
    else score += 2;
    if (stock >= 500) score += 5;
    else if (stock >= 100) score += 3;
    evidence.push(stock > 0 ? `Warehouse inventory ${stock}.` : "Warehouse inventory is zero; verify before testing.");
  } else {
    evidence.push("Inventory not confirmed from recognized fields.");
  }

  if (isFreeShipping) {
    score += 8;
    evidence.push("Free shipping flagged by CJ.");
  }

  if (hasVideo) {
    score += 5;
    evidence.push("Product video available for ad creative.");
  }

  if (verifiedWarehouse) {
    score += 5;
    evidence.push("Verified warehouse inventory.");
  }

  if (category) {
    score += 5;
    evidence.push(`Category: ${category}.`);
  }

  if (deliveryCycle) {
    const days = deliveryDays;
    if (days !== null && days <= 7) {
      score += 5;
      evidence.push(`Delivery cycle ${deliveryCycle} day(s) — relatively fast.`);
    } else if (days !== null && days <= 10) {
      score += 3;
      evidence.push(`Delivery cycle ${deliveryCycle} day(s) — quick-delivery candidate.`);
    }
  }

  let suggestedMarginPercent = null;
  if (suggest && effectiveCost) {
    const costMax = effectiveCost.max;
    if (suggest.min > 0 && suggest.min > costMax) {
      suggestedMarginPercent = Number((((suggest.min - costMax) / suggest.min) * 100).toFixed(2));
      if (suggestedMarginPercent >= 60) score += 15;
      else if (suggestedMarginPercent >= 40) score += 10;
      else if (suggestedMarginPercent >= 20) score += 5;
      evidence.push(`CJ suggested retail ${suggest.display} → suggested margin ~${suggestedMarginPercent}% before fees/ads.`);
    } else {
      evidence.push(`CJ suggested retail ${suggest.display} leaves little or no margin at top variant cost.`);
    }
  } else {
    evidence.push("CJ suggested retail price not available in this response.");
  }

  const normalizedScore = Math.min(100, score);
  const scoreLabel = normalizedScore >= 70
    ? "Strong test candidate (heuristic)"
    : normalizedScore >= 45
      ? "Needs manual review"
      : "Insufficient evidence";

  return {
    id: id === null ? null : String(id),
    sku: firstDefined(raw, ["sku", "productSku", "spu"]) ? String(firstDefined(raw, ["sku", "productSku", "spu"])) : null,
    name: String(name),
    image: image || null,
    productUrl: buildProductUrl(name, id),
    cjCost: cjCost ? cjCost.min : null,
    cjCostDisplay: cjCost ? cjCost.display : null,
    promoPrice: promo ? promo.min : null,
    suggestSellPrice: suggest ? suggest.min : null,
    suggestSellPriceDisplay: suggest ? suggest.display : null,
    suggestedMarginPercent,
    supplierName: supplierNameValue !== null && supplierNameValue !== "{}" ? String(supplierNameValue) : null,
    supplierId,
    sourceFrom: sourceFrom !== null ? sourceFrom : null,
    currency: String(currency),
    stock,
    listedNum,
    isFreeShipping,
    hasVideo,
    verifiedWarehouse,
    category,
    deliveryCycle: deliveryCycle ? String(deliveryCycle) : null,
    deliveryDays,
    quickDelivery: deliveryDays !== null && deliveryDays > 0 && deliveryDays <= 10,
    score: normalizedScore,
    scoreLabel,
    scoreType: "heuristic-winning-product-v2",
    sellingSites: recommendSellingSites({ category, name }),
    evidence,
    raw
  };
}

export function sortProducts(products, sort) {
  const list = [...products];
  switch (sort) {
    case "price_asc":
      return list.sort((a, b) => (a.cjCost ?? Infinity) - (b.cjCost ?? Infinity));
    case "price_desc":
      return list.sort((a, b) => (b.cjCost ?? -1) - (a.cjCost ?? -1));
    case "stock_desc":
      return list.sort((a, b) => (b.stock ?? -1) - (a.stock ?? -1));
    case "listed_desc":
      return list.sort((a, b) => (b.listedNum ?? -1) - (a.listedNum ?? -1));
    case "winning":
    default:
      return list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }
}

export function estimateProfit({ sellingPrice, productCost, shippingCost, adCost, fees, otherCosts }) {
  const values = [sellingPrice, productCost, shippingCost, adCost, fees, otherCosts].map(Number);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Enter valid non-negative numbers.");
  }
  const [sell, product, shipping, ads, platformFees, other] = values;
  const profit = sell - product - shipping - ads - platformFees - other;
  return { profit: Number(profit.toFixed(2)), marginPercent: sell > 0 ? Number((profit / sell * 100).toFixed(2)) : null };
}

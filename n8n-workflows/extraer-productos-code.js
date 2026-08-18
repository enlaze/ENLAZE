const items = $input.all();
const prices = [];
const seen = new Set();

function cleanText(t) {
  return (t || '').replace(/\s+/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#[0-9]+;/g, '').trim();
}

function detectSource(html) {
  const lower = (html || '').toLowerCase();
  if (lower.includes('bigmat.es')) return 'BigMat';
  if (lower.includes('porcelanosa.com')) return 'Porcelanosa';
  if (lower.includes('roca.es')) return 'Roca';
  if (lower.includes('bauhaus.es')) return 'Bauhaus';
  if (lower.includes('bricoking.es')) return 'Bricoking';
  if (lower.includes('grupopuma.com')) return 'Grupo Puma';
  return 'Proveedor Web';
}

function detectCategory(title) {
  const t = (title || '').toLowerCase();
  if (/cement|mortero|yeso|escayola|hormig/.test(t)) return 'albanileria';
  if (/azulejo|baldosa|porcelan|ceramica|gres/.test(t)) return 'revestimientos';
  if (/grifo|ducha|inodoro|lavabo|mampara|sanitario/.test(t)) return 'fontaneria';
  if (/pintura|barniz|esmalte/.test(t)) return 'pintura';
  if (/madera|tablero|tarima|parquet/.test(t)) return 'madera';
  if (/tubo|tuberia|valvula/.test(t)) return 'instalaciones';
  if (/ladrillo|bloque|termoarcilla/.test(t)) return 'obra_gruesa';
  if (/aislamiento|lana|poliestireno/.test(t)) return 'aislamiento';
  if (/puerta|ventana|persiana/.test(t)) return 'carpinteria';
  return 'general';
}

function detectUnit(title) {
  const t = (title || '').toLowerCase();
  if (/\/m2|metro cuadrado/.test(t)) return 'm2';
  if (/\/ml|metro lineal/.test(t)) return 'ml';
  if (/saco|bolsa/.test(t)) return 'saco';
  if (/kg|kilo/.test(t)) return 'kg';
  return 'ud';
}

// Try real scraping first
for (const item of items) {
  const html = item.json.data || item.json.body || '';
  if (!html || html.length < 200) continue;
  const source = detectSource(html);

  // JSON-LD
  const jsonLdBlocks = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [];
  for (const block of jsonLdBlocks) {
    try {
      const jsonStr = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '').trim();
      const data = JSON.parse(jsonStr);
      const products = data['@type'] === 'ItemList' ? (data.itemListElement || []).map(i => i.item || i) : data['@type'] === 'Product' ? [data] : [];
      for (const p of products) {
        if (!p.name || !p.offers) continue;
        const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
        const price = parseFloat(offer.price);
        if (!price || price <= 0 || price > 50000) continue;
        const name = cleanText(p.name);
        const key = `${name}|${source}`;
        if (seen.has(key)) continue;
        seen.add(key);
        prices.push({ name: name.substring(0, 160), sku: p.sku || '', brand: p.brand?.name || '', price, unit: detectUnit(name), category: detectCategory(name), is_available: true, _source: source });
      }
    } catch {}
  }

  // Price regex
  const priceBlocks = html.match(/.{0,300}(\d{1,4}[.,]\d{2})\s*(?:€|&euro;|EUR).{0,100}/gi) || [];
  for (const block of priceBlocks.slice(0, 100)) {
    const priceMatch = block.match(/(\d{1,4}[.,]\d{2})\s*(?:€|&euro;|EUR)/i);
    if (!priceMatch) continue;
    const value = parseFloat(priceMatch[1].replace(',', '.'));
    if (!value || value <= 0.5 || value > 50000) continue;
    const titleMatch = block.match(/(?:title|alt|data-name|aria-label|product-name)["':>\s]*([^"<>|]{8,140})/i) || block.match(/>([^<>]{10,120})</);
    if (!titleMatch) continue;
    const name = cleanText(titleMatch[1]);
    if (name.length < 8 || /cookie|politi|legal|pago|envio|devolu/i.test(name)) continue;
    const key = `${name}|${source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    prices.push({ name: name.substring(0, 160), price: Number(value.toFixed(2)), unit: detectUnit(name), category: detectCategory(name), is_available: true, _source: source });
  }
}

// Fail closed: nunca convertir valores manuales o estimados en precios oficiales.
if (prices.length === 0) {
  return [{
    json: {
      _empty: true,
      message: 'No se encontraron productos con precio y evidencia oficial; no se enviaron estimaciones.'
    }
  }];
}

// Group by provider
const byProvider = {};
for (const p of prices) {
  const src = p._source || 'Proveedor Web';
  if (!byProvider[src]) byProvider[src] = [];
  delete p._source;
  byProvider[src].push(p);
}

const batches = Object.entries(byProvider).map(([provName, items]) => ({
  action: 'upsert_products',
  source: { name: 'n8n-' + provName.toLowerCase().replace(/\s+/g, '-') + '-scraper', type: 'n8n_webhook' },
  provider: { name: provName, region: 'ES' },
  items,
  metadata: { scraped_at: new Date().toISOString(), workflow_id: 'proveedores-extra', n8n_execution_id: $execution.id }
}));

return batches.map(b => ({ json: b }));

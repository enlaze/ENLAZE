#!/usr/bin/env node
/**
 * Scraper de precios de construcción para ENLAZE
 * Usa Puppeteer (navegador headless) para evitar bloqueos de Cloudflare.
 *
 * Uso:
 *   node scraper-precios.js
 *
 * También puede ejecutarse desde n8n con el nodo "Execute Command"
 * Salida: JSON con formato compatible con /api/pb/ingest
 */

const puppeteer = require('puppeteer');

// ── Configuración de URLs a scrapear ──────────────────────────────
const SOURCES = [
  {
    name: 'Cementos y morteros',
    url: 'https://www.manomano.es/cementos-y-morteros-3950',
    category: 'material',
    subcategory: 'cementos'
  },
  {
    name: 'Puertas de interior',
    url: 'https://www.manomano.es/las-categorias-de-productos-mas-populares/5756',
    category: 'material',
    subcategory: 'puertas'
  },
  {
    name: 'Albañilería',
    url: 'https://www.manomano.es/hub/albanileria-3944',
    category: 'material',
    subcategory: 'albanileria'
  },
  {
    name: 'Iluminación',
    url: 'https://www.manomano.es/cat/iluminacion',
    category: 'material',
    subcategory: 'iluminacion'
  },
  {
    name: 'Fontanería',
    url: 'https://www.manomano.es/cat/fontaneria',
    category: 'material',
    subcategory: 'fontaneria'
  }
];

// ── Configuración de ENLAZE API ───────────────────────────────────
const ENLAZE_API_URL = process.env.ENLAZE_API_URL || 'https://enlaze.vercel.app/api/pb/ingest';
const ENLAZE_API_KEY = process.env.ENLAZE_API_KEY || 'enlaze-sync-2026-precio';

async function scrapeCategory(browser, source) {
  const page = await browser.newPage();

  // Simular un navegador real
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  try {
    console.error(`Scrapeando: ${source.name} (${source.url})`);

    await page.goto(source.url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Esperar carga inicial
    await new Promise(r => setTimeout(r, 3000));

    // Cerrar banner de cookies si aparece
    try {
      await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')];
        const acceptBtn = buttons.find(b =>
          b.textContent.includes('Aceptar y cerrar') ||
          b.textContent.includes('Aceptar') ||
          b.textContent.includes('Accept')
        );
        if (acceptBtn) acceptBtn.click();
      });
      console.error('  → Banner de cookies cerrado');
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.error('  → No se encontró banner de cookies');
    }

    // Scroll para cargar productos
    await page.evaluate(() => window.scrollBy(0, 1000));
    await new Promise(r => setTimeout(r, 2000));

    // DEBUG: guardar captura y HTML para ver qué carga realmente
    const debugDir = require('path').join(__dirname, '..', 'debug-scraper');
    require('fs').mkdirSync(debugDir, { recursive: true });
    const safeName = source.name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    await page.screenshot({ path: `${debugDir}/${safeName}.png`, fullPage: false });
    const html = await page.content();
    require('fs').writeFileSync(`${debugDir}/${safeName}.html`, html.substring(0, 5000));
    console.error(`  → Debug guardado en debug-scraper/${safeName}.png`);

    // Guardar HTML completo para debug de selectores
    require('fs').writeFileSync(`${debugDir}/${safeName}-full.html`, html);

    // Extraer productos con múltiples estrategias
    const products = await page.evaluate((source) => {
      const items = [];
      const seen = new Set();

      // ESTRATEGIA 1: Buscar botones "Añadir a la cesta", subir 3 niveles (no 5)
      const addButtons = [...document.querySelectorAll('button')].filter(b =>
        b.textContent.trim() === 'Añadir a la cesta'
      );

      addButtons.forEach(btn => {
        try {
          // Subir solo 3 niveles - más preciso
          let card = btn;
          for (let i = 0; i < 3; i++) {
            if (card.parentElement) card = card.parentElement;
          }
          if (!card) return;

          const cardText = card.textContent || '';
          const priceMatch = cardText.match(/(\d+[.,]\d{2})\s*€/);
          if (!priceMatch) return;
          const price = parseFloat(priceMatch[1].replace(',', '.'));

          // Buscar el link del producto (contiene el nombre)
          const link = card.querySelector('a[href*="/p/"]') || card.querySelector('a');
          const name = link ? link.textContent.trim() : '';

          if (name && name.length > 5 && price > 0 && !seen.has(name)) {
            seen.add(name);
            items.push({ name: name.substring(0, 200), price, unit: 'ud',
              category: source.category, subcategory: source.subcategory, brand: '', sku: '' });
          }
        } catch (e) {}
      });

      // ESTRATEGIA 2: Buscar links de producto (/p/ en href)
      if (items.length < 5) {
        const productLinks = document.querySelectorAll('a[href*="/p/"]');
        productLinks.forEach(link => {
          try {
            const name = link.textContent.trim();
            if (!name || name.length < 10 || name.length > 200 || seen.has(name)) return;
            if (name.includes('Añadir') || name.includes('Ver') || name.includes('€')) return;

            // Buscar precio cerca: en el padre o hermanos
            let container = link.parentElement;
            for (let i = 0; i < 3; i++) {
              if (container && container.parentElement) container = container.parentElement;
            }
            if (!container) return;

            const containerText = container.textContent || '';
            const priceMatch = containerText.match(/(\d+[.,]\d{2})\s*€/);
            if (!priceMatch) return;
            const price = parseFloat(priceMatch[1].replace(',', '.'));

            if (price > 0 && price < 50000) {
              seen.add(name);
              items.push({ name: name.substring(0, 200), price, unit: 'ud',
                category: source.category, subcategory: source.subcategory, brand: '', sku: '' });
            }
          } catch (e) {}
        });
      }

      // ESTRATEGIA 3: Regex en el HTML completo como último recurso
      if (items.length < 3) {
        const bodyHtml = document.body.innerHTML;
        // Buscar patrones: texto seguido de precio
        const regex = /title="([^"]{10,150})"[^>]*>.*?(\d+[.,]\d{2})\s*€/gs;
        let match;
        while ((match = regex.exec(bodyHtml)) !== null) {
          const name = match[1].trim();
          const price = parseFloat(match[2].replace(',', '.'));
          if (name && price > 0 && price < 50000 && !seen.has(name)) {
            seen.add(name);
            items.push({ name: name.substring(0, 200), price, unit: 'ud',
              category: source.category, subcategory: source.subcategory, brand: '', sku: '' });
          }
        }
      }

      return items;
    }, source);

    console.error(`  → ${products.length} productos encontrados en ${source.name}`);
    return products;

  } catch (error) {
    console.error(`  ✗ Error en ${source.name}: ${error.message}`);
    return [];
  } finally {
    await page.close();
  }
}

async function sendToEnlaze(products, sourceUrl) {
  if (products.length === 0) {
    console.error('  → No hay productos para enviar, saltando...');
    return null;
  }

  const body = {
    provider_name: 'ManoMano',
    sector: 'construccion',
    source_url: sourceUrl,
    products: products
  };

  try {
    const response = await fetch(ENLAZE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ENLAZE_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    const result = await response.json();
    console.error(`  → Enviado a ENLAZE: ${result.inserted || 0} nuevos, ${result.updated || 0} actualizados`);
    return result;
  } catch (error) {
    console.error(`  ✗ Error enviando a ENLAZE: ${error.message}`);
    return null;
  }
}

async function main() {
  console.error('=== ENLAZE Price Scraper ===');
  console.error(`Fecha: ${new Date().toISOString()}`);
  console.error(`API: ${ENLAZE_API_URL}`);
  console.error('');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const allResults = [];
  let totalProducts = 0;

  try {
    for (const source of SOURCES) {
      const products = await scrapeCategory(browser, source);
      totalProducts += products.length;

      if (products.length > 0) {
        const result = await sendToEnlaze(products, source.url);
        allResults.push({
          source: source.name,
          products_found: products.length,
          result: result
        });
      } else {
        allResults.push({
          source: source.name,
          products_found: 0,
          result: null
        });
      }

      // Pausa entre peticiones para no saturar
      await new Promise(r => setTimeout(r, 2000));
    }
  } finally {
    await browser.close();
  }

  // Resumen final (stdout = JSON para n8n)
  const summary = {
    timestamp: new Date().toISOString(),
    total_products: totalProducts,
    sources_scraped: SOURCES.length,
    results: allResults
  };

  console.error('');
  console.error(`=== Resumen: ${totalProducts} productos de ${SOURCES.length} fuentes ===`);

  // Salida JSON por stdout (para que n8n pueda leerlo)
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});

/**
 * Statsmaster KD dashboard -> dkp.json
 *
 * Sayfayı gerçek bir tarayıcıda açar ve iki şekilde veri almayı dener:
 *   1) Sayfanın kendi JSON isteğini ağ trafiğinden yakalar  (tercih edilen)
 *   2) Olmazsa ekrandaki tabloyu okur                        (yedek)
 *
 * Bulduğu endpoint'i data/_source.json dosyasına yazar; ileride
 * tarayıcıya hiç gerek kalmadan doğrudan oradan çekebiliriz.
 *
 * Çalıştırma:  STATS_URL="https://..." node scripts/scrape-dkp.mjs
 */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const URL = process.env.STATS_URL;
const OUT = process.env.OUT || 'dkp.json';
const DEBUG_DIR = 'debug';

if (!URL) {
  console.error('STATS_URL tanımlı değil. GitHub secret olarak eklemelisin.');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* yardımcılar                                                         */
/* ------------------------------------------------------------------ */

// "60.8M", "4.579B", "1,234", "209% reached", "#203455451" -> sayı
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s+/g, '').replace(/,/g, '');
  const m = s.match(/-?\d*\.?\d+/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (/b/i.test(s.slice(m.index + m[0].length))) n *= 1e9;
  else if (/m/i.test(s.slice(m.index + m[0].length))) n *= 1e6;
  else if (/k/i.test(s.slice(m.index + m[0].length))) n *= 1e3;
  return Number.isFinite(n) ? n : null;
}

const txt = v => (v === null || v === undefined ? '' : String(v).trim());

// alan adı eşleştirme — hem JSON anahtarları hem tablo başlıkları için
const MATCH = {
  name:     /^(player|governor|name|nickname|nick|username)$/i,
  id:       /(governor.?id|player.?id|gov.?id|^id$|^uid$)/i,
  alliance: /(alliance|guild|^tag$)/i,
  power:    /^(current.?)?power$/i,
  dkp:      /(^dkp$|dkp.?score|dkp.?point|score)/i,
  goal:     /(dkp.?goal|goal|requirement|target)/i,
  t4:       /t4.*(kill|kp)/i,
  t5:       /t5.*(kill|kp)/i,
  kp:       /(total.?kp|kill.?point|t4.?\+.?t5)/i,
  deads:    /(^dead|dead.?troop|deaths?$|all.?dead)/i,
  honor:    /honor/i
};

function mapKeys(sampleKeys) {
  const map = {};
  for (const [field, re] of Object.entries(MATCH)) {
    const hit = sampleKeys.find(k => re.test(String(k).replace(/[_\-]/g, ' ')));
    if (hit !== undefined) map[field] = hit;
  }
  return map;
}

function normalise(records, map) {
  const players = records.map(r => {
    const o = {};
    o.name = txt(r[map.name]);
    o.dkp = num(r[map.dkp]);
    if (map.id) o.id = txt(r[map.id]).replace(/^#/, '');
    if (map.alliance) o.alliance = txt(r[map.alliance]);
    for (const k of ['power', 'goal', 't4', 't5', 'kp', 'deads', 'honor']) {
      if (map[k]) {
        const n = num(r[map[k]]);
        if (n !== null) o[k] = n;
      }
    }
    return o;
  }).filter(p => p.name && p.dkp !== null);

  players.sort((a, b) => b.dkp - a.dkp);
  players.forEach((p, i) => { p.rank = i + 1; });
  return players;
}

/* ------------------------------------------------------------------ */
/* JSON gövdesi içinde oyuncu listesi arama                            */
/* ------------------------------------------------------------------ */

function findPlayerArrays(node, out = [], depth = 0) {
  if (depth > 6 || node === null || typeof node !== 'object') return out;

  if (Array.isArray(node)) {
    const objs = node.filter(x => x && typeof x === 'object' && !Array.isArray(x));
    if (objs.length >= 5 && objs.length === node.length) {
      const keys = Object.keys(objs[0]);
      const map = mapKeys(keys);
      if (map.name && map.dkp) out.push({ rows: objs, map, size: objs.length });
    }
    node.forEach(v => findPlayerArrays(v, out, depth + 1));
    return out;
  }

  Object.values(node).forEach(v => findPlayerArrays(v, out, depth + 1));
  return out;
}

/* ------------------------------------------------------------------ */
/* ana akış                                                            */
/* ------------------------------------------------------------------ */

const captures = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1200 },
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
});
const page = await ctx.newPage();

page.on('response', async res => {
  try {
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    const body = await res.json();
    captures.push({ url: res.url(), body });
  } catch { /* json değilse boşver */ }
});

console.log('Sayfa açılıyor…');
await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });

// tablo geç yükleniyor olabilir
await page.waitForTimeout(6000);
try {
  await page.waitForSelector('table tbody tr, [role="row"]', { timeout: 20000 });
} catch { console.log('Tablo seçicisi bulunamadı, yine de devam ediliyor.'); }

// sanal listeler için sayfayı sonuna kadar kaydır
for (let i = 0; i < 25; i++) {
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(350);
}
await page.waitForTimeout(2000);

/* --- tarama bilgileri (formül ve tarih aralığı) --- */
const meta = await page.evaluate(() => {
  const body = document.body.innerText;
  const formula = (body.match(/[A-Z0-9\-+ ]*KILLS[^\n]{0,80}/i) || [''])[0].trim();
  const dates = [...document.querySelectorAll('select')]
    .map(s => (s.selectedOptions[0] || {}).textContent || '')
    .filter(t => /UTC/i.test(t));
  return { formula, start: dates[0] || '', end: dates[1] || '' };
});

/* --- 1) ağ trafiğinden --- */
let players = [];
let source = null;

const candidates = [];
for (const c of captures) {
  findPlayerArrays(c.body).forEach(f => candidates.push({ ...f, url: c.url }));
}
candidates.sort((a, b) => b.size - a.size);

if (candidates.length) {
  const best = candidates[0];
  players = normalise(best.rows, best.map);
  source = { method: 'network', url: best.url, fields: best.map };
  console.log(`Ağ isteğinden ${players.length} oyuncu alındı: ${best.url}`);
}

/* --- 2) yedek: ekrandaki tablo --- */
if (players.length < 5) {
  console.log('Ağdan veri alınamadı, tablo okunuyor…');
  const table = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')];
    if (!tables.length) return null;
    const t = tables.sort((a, b) => b.rows.length - a.rows.length)[0];
    const head = [...t.querySelectorAll('thead th, thead td')].map(th => th.innerText.trim());
    const rows = [...t.querySelectorAll('tbody tr')].map(tr =>
      [...tr.querySelectorAll('td, th')].map(td => td.innerText.replace(/\s+/g, ' ').trim())
    );
    return { head, rows };
  });

  if (table && table.rows.length) {
    const map = mapKeys(table.head);
    const objs = table.rows.map(r => {
      const o = {};
      table.head.forEach((h, i) => { o[h] = r[i]; });
      return o;
    });
    players = normalise(objs, map);
    source = { method: 'dom', headers: table.head, fields: map };
    console.log(`Tablodan ${players.length} oyuncu alındı.`);
  }
}

/* --- sonuç --- */
if (players.length < 5) {
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  await page.screenshot({ path: path.join(DEBUG_DIR, 'page.png'), fullPage: true });
  await fs.writeFile(path.join(DEBUG_DIR, 'page.html'), await page.content());
  await fs.writeFile(path.join(DEBUG_DIR, 'captures.json'),
    JSON.stringify(captures.map(c => ({ url: c.url, keys: Object.keys(c.body || {}) })), null, 1));
  await browser.close();
  console.error('Veri çekilemedi. debug/ klasöründeki ekran görüntüsü ve captures.json dosyasına bak.');
  process.exit(1);
}

await browser.close();

const payload = {
  updated: new Date().toISOString(),
  period: { start: meta.start, end: meta.end },
  formula: meta.formula,
  players
};

await fs.writeFile(OUT, JSON.stringify(payload, null, 1));
await fs.mkdir('data', { recursive: true });
await fs.writeFile('data/_source.json', JSON.stringify(source, null, 1));

console.log(`${OUT} yazıldı — ${players.length} oyuncu, ilk sıra: ${players[0].name} (${players[0].dkp}).`);

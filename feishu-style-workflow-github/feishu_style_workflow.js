const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright-core');

function loadDotEnv(file = '.env') {
  const envPath = path.resolve(file);
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const CFG = {
  sourceAppToken: process.env.FEISHU_SOURCE_APP_TOKEN || 'KMOAbNea0apS6WsPKtmcdfibnbe',
  sourceTableId: process.env.FEISHU_SOURCE_TABLE_ID || 'tblFw0YDQZEJtFmS',
  sourceViewId: process.env.FEISHU_SOURCE_VIEW_ID || 'vew9OolRq2',
  targetFormUrl: process.env.FEISHU_TARGET_FORM_URL || 'https://merjic-ai.feishu.cn/share/base/form/shrcnjGhxDbVZuaxu2LR5Xix40d?iframeFrom=docx&ccm_open=iframe',
  resultUrl: process.env.FEISHU_RESULT_URL || 'https://merjic-ai.feishu.cn/base/PKf4bQCEaa6t38sXMmwcpwjinJs?table=tblNblsVDhI768On&view=vewckV2RX3',
  resultAppToken: process.env.FEISHU_RESULT_APP_TOKEN || 'PKf4bQCEaa6t38sXMmwcpwjinJs',
  resultTableId: process.env.FEISHU_RESULT_TABLE_ID || 'tblNblsVDhI768On',
  resultViewId: process.env.FEISHU_RESULT_VIEW_ID || 'vewckV2RX3',
  miner: process.env.FEISHU_MINER || '沐柒Moki',
  workDir: path.resolve(process.env.FEISHU_WORK_DIR || '.feishu-work'),
};

const FIELD = {
  seed: '风格种子',
  person: '人',
  animal: '动物',
  architecture: '建筑',
  environment: '环境',
  resultSeed: '风格种子或p（每周上限10个）',
  miner: '种子挖掘者',
};

const IMAGE_FIELDS = [
  [FIELD.person, 'person'],
  [FIELD.animal, 'animal'],
  [FIELD.architecture, 'architecture'],
  [FIELD.environment, 'environment'],
];

function rowsFromArg() {
  const raw = process.argv[3] || process.env.FEISHU_ROWS || '';
  const rows = raw.split(',').map((x) => Number(x.trim())).filter(Boolean);
  if (!rows.length) throw new Error('Pass rows, for example: node feishu_style_workflow.js prepare 3,5,6');
  return rows;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function chromePath() {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  return fs.existsSync(chrome) ? chrome : edge;
}

async function tenantToken() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error('Missing FEISHU_APP_ID or FEISHU_APP_SECRET');
  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const json = await resp.json();
  if (json.code !== 0) throw new Error(`tenant token failed: ${JSON.stringify(json)}`);
  return json.tenant_access_token;
}

async function listRecords(token, appToken, tableId, viewId, pageSize = 100, maxPages = Infinity) {
  const items = [];
  let pageToken = '';
  let pages = 0;
  do {
    const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`);
    url.searchParams.set('page_size', String(pageSize));
    url.searchParams.set('view_id', viewId);
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await resp.json();
    if (json.code !== 0) throw new Error(`records failed: ${JSON.stringify(json)}`);
    items.push(...json.data.items);
    pages += 1;
    pageToken = json.data.has_more ? json.data.page_token : '';
  } while (pageToken && pages < maxPages);
  return items;
}

function extFor(file) {
  const byName = path.extname(file.name || '');
  if (byName) return byName;
  if (file.type === 'image/jpeg') return '.jpg';
  if (file.type === 'image/png') return '.png';
  return '.bin';
}

async function downloadFile(token, file, outPath) {
  const resp = await fetch(file.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`download failed ${resp.status} for ${file.file_token}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outPath, buffer);
  if (!buffer.length) throw new Error(`downloaded empty file: ${outPath}`);
  if (file.size && Math.abs(buffer.length - file.size) > Math.max(4096, file.size * 0.02)) {
    throw new Error(`download size mismatch for ${outPath}: got ${buffer.length}, expected ${file.size}`);
  }
  return buffer.length;
}

async function downloadRows(rows) {
  ensureDir(CFG.workDir);
  const token = await tenantToken();
  const records = await listRecords(token, CFG.sourceAppToken, CFG.sourceTableId, CFG.sourceViewId);
  const report = [];
  for (const row of rows) {
    const rec = records[row - 1];
    if (!rec) throw new Error(`Source row ${row} does not exist`);
    const seed = String(rec.fields[FIELD.seed] || '').trim();
    if (!seed) throw new Error(`Source row ${row} missing ${FIELD.seed}`);
    const dir = path.join(CFG.workDir, 'rows', `${row}_${seed}`);
    ensureDir(dir);
    const item = { row, seed, record_id: rec.record_id, dir, files: {} };
    for (const [sourceField, targetName] of IMAGE_FIELDS) {
      const file = Array.isArray(rec.fields[sourceField]) ? rec.fields[sourceField][0] : null;
      if (!file || !file.url) throw new Error(`Source row ${row} missing attachment field ${sourceField}`);
      const outPath = path.join(dir, `${targetName}${extFor(file)}`);
      const bytes = await downloadFile(token, file, outPath);
      item.files[targetName] = { sourceField, outPath, bytes, expectedSize: file.size, file_token: file.file_token };
    }
    report.push(item);
  }
  const reportPath = path.join(CFG.workDir, 'download_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return report;
}

function readReport() {
  const reportPath = path.join(CFG.workDir, 'download_report.json');
  if (!fs.existsSync(reportPath)) throw new Error('Missing download report. Run prepare first.');
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

async function makeSourceScreenshots(report) {
  const outDir = path.join(CFG.workDir, 'confirm');
  ensureDir(outDir);
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  for (const r of report) {
    const cells = IMAGE_FIELDS.map(([, name]) => {
      const src = path.resolve(r.files[name].outPath).replace(/\\/g, '/');
      return `<div class="cell"><img src="file:///${src}" alt="${name}"></div>`;
    }).join('');
    const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;font-family:Arial,"Microsoft YaHei",sans-serif;color:#1f2329}
.row{display:grid;grid-template-columns:72px 150px repeat(4,170px);border-top:1px solid #dee0e3;border-left:1px solid #dee0e3;width:max-content}
.cell{border-right:1px solid #dee0e3;border-bottom:1px solid #dee0e3;height:142px;display:flex;align-items:center;justify-content:center;font-size:17px}
.head{height:34px;font-size:14px;background:#fafafa;color:#646a73}
img{width:124px;height:124px;object-fit:cover}.seed{font-size:17px}
</style><div class="row">
<div class="cell head">序号</div><div class="cell head">风格种子</div><div class="cell head">人</div><div class="cell head">动物</div><div class="cell head">建筑</div><div class="cell head">环境</div>
<div class="cell">${r.row}</div><div class="cell seed">${r.seed}</div>${cells}</div>`;
    const htmlPath = path.join(outDir, `row_${r.row}_source.html`);
    const pngPath = path.join(outDir, `row_${r.row}_source.png`);
    fs.writeFileSync(htmlPath, html, 'utf8');
    const page = await browser.newPage({ viewport: { width: 960, height: 220 } });
    await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
    await page.screenshot({ path: pngPath, fullPage: true });
    await page.close();
    r.sourceScreenshot = pngPath;
  }
  await browser.close();
}

async function fillText(locator, text) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ force: true });
  await locator.fill(text);
  await locator.evaluate((el) => {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: el.textContent || '' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  });
}

async function fillOrSubmitForm(rowInfo, shouldSubmit) {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1600 } });
  const responses = [];
  page.on('response', (response) => {
    const url = response.url();
    if (/upload|submit|form|attachment|file|record|bitable|base/i.test(url)) {
      responses.push({ status: response.status(), url, contentType: response.headers()['content-type'] || '' });
    }
  });
  await page.goto(CFG.targetFormUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  const editors = page.locator('.bitable-form__editor__text_editor [contenteditable="true"]');
  if (await editors.count() < 1) throw new Error('No seed text editor found');
  await fillText(editors.nth(0), rowInfo.seed);

  const uploadInputs = page.locator('input[type="file"].attache-upload');
  if (await uploadInputs.count() < 4) throw new Error('Expected four Feishu upload inputs');
  for (let i = 0; i < 4; i++) {
    const name = IMAGE_FIELDS[i][1];
    await uploadInputs.nth(i).setInputFiles(rowInfo.files[name].outPath);
    await page.waitForTimeout(2500);
  }
  await page.waitForTimeout(10000);

  const refreshedEditors = page.locator('.bitable-form__editor__text_editor [contenteditable="true"]');
  if (await refreshedEditors.count() >= 2) await fillText(refreshedEditors.nth(1), CFG.miner);

  const outDir = path.join(CFG.workDir, 'confirm');
  ensureDir(outDir);
  const beforePath = path.join(outDir, `row_${rowInfo.row}_target.png`);
  await page.screenshot({ path: beforePath, fullPage: true });

  let afterPath = null;
  if (shouldSubmit) {
    const submit = page.getByText('提交', { exact: true }).last();
    await submit.scrollIntoViewIfNeeded();
    await submit.click();
    await page.waitForTimeout(12000);
    afterPath = path.join(outDir, `row_${rowInfo.row}_after_submit.png`);
    await page.screenshot({ path: afterPath, fullPage: true });
  }
  const bodyText = await page.locator('body').innerText().catch((e) => String(e));
  const result = {
    row: rowInfo.row,
    seed: rowInfo.seed,
    submitted: shouldSubmit,
    success: shouldSubmit ? /提交成功|继续开动|已提交/.test(bodyText) && !/必填/.test(bodyText) : false,
    beforePath,
    afterPath,
    bodyText,
    responses,
  };
  fs.writeFileSync(path.join(outDir, `row_${rowInfo.row}_form_result.json`), JSON.stringify(result, null, 2), 'utf8');
  await browser.close();
  if (shouldSubmit && !result.success) throw new Error(`Submit failed for row ${rowInfo.row}; form did not show success`);
  return result;
}

async function waitForResultTableScreenshotReady(page, seeds) {
  const expectedSeeds = seeds.map(String);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction((values) => {
    const text = document.body.innerText || '';
    return values.every((seed) => text.includes(seed));
  }, expectedSeeds, { timeout: 30000 }).catch(() => {});

  const deadline = Date.now() + 120000;
  let lastHash = null;
  let stableSince = null;
  let attempts = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
    const buffer = await page.screenshot({ fullPage: false });
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    attempts += 1;
    if (hash === lastHash) {
      if (stableSince && Date.now() - stableSince >= 5000) {
        return { stable: true, attempts };
      }
      if (!stableSince) stableSince = Date.now();
    } else {
      lastHash = hash;
      stableSince = null;
    }
  }
  return { stable: false, attempts, timedOut: true };
}

async function verifyResultTable(seeds) {
  const token = await tenantToken();
  const records = await listRecords(token, CFG.resultAppToken, CFG.resultTableId, CFG.resultViewId, 100, 1);
  const found = [];
  for (const seed of seeds.map(String)) {
    const rec = records.find((r) => String(r.fields[FIELD.resultSeed] || '').trim() === seed);
    if (!rec) throw new Error(`Result table missing submitted seed ${seed}`);
    for (const name of ['person', 'animal', 'architecture', 'environment']) {
      if (!Array.isArray(rec.fields[name]) || !rec.fields[name][0]) throw new Error(`Result seed ${seed} missing ${name}`);
    }
    if (String(rec.fields[FIELD.miner] || '').trim() !== CFG.miner) throw new Error(`Result seed ${seed} has wrong miner`);
    found.push({ seed, record_id: rec.record_id });
  }

  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 2048, height: 1000 } });
  await page.goto(CFG.resultUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const screenshotReady = await waitForResultTableScreenshotReady(page, seeds);
  const shot = path.join(CFG.workDir, 'result_table_after_submit.png');
  await page.screenshot({ path: shot, fullPage: false });
  await browser.close();
  fs.writeFileSync(path.join(CFG.workDir, 'result_verify.json'), JSON.stringify({ found, screenshot: shot, screenshotReady }, null, 2), 'utf8');
  return { found, screenshot: shot, screenshotReady };
}

function cleanupRows(rows) {
  const report = fs.existsSync(path.join(CFG.workDir, 'download_report.json')) ? readReport() : [];
  const selected = new Set(rows.map(Number));
  for (const r of report) {
    if (!selected.has(Number(r.row))) continue;
    fs.rmSync(r.dir, { recursive: true, force: true });
    for (const suffix of ['source.html', 'source.png', 'target.png', 'after_submit.png', 'form_result.json']) {
      fs.rmSync(path.join(CFG.workDir, 'confirm', `row_${r.row}_${suffix}`), { force: true });
    }
  }
}

async function main() {
  const command = process.argv[2];
  if (!command || !['prepare', 'submit', 'verify', 'cleanup'].includes(command)) {
    throw new Error('Commands: prepare <rows>, submit <rows>, verify <seeds>, cleanup <rows>');
  }
  if (command === 'prepare') {
    const report = await downloadRows(rowsFromArg());
    await makeSourceScreenshots(report);
    for (const r of report) await fillOrSubmitForm(r, false);
    console.log(JSON.stringify(report.map((r) => ({ row: r.row, seed: r.seed, sourceScreenshot: r.sourceScreenshot, targetScreenshot: path.join(CFG.workDir, 'confirm', `row_${r.row}_target.png`) })), null, 2));
  }
  if (command === 'submit') {
    const rows = rowsFromArg();
    const report = readReport().filter((r) => rows.includes(Number(r.row)));
    if (report.length !== rows.length) throw new Error('Some rows are missing from download report. Run prepare again.');
    const results = [];
    for (const r of report) results.push(await fillOrSubmitForm(r, true));
    const verify = await verifyResultTable(report.map((r) => r.seed));
    cleanupRows(rows);
    console.log(JSON.stringify({ submitted: results.map((r) => ({ row: r.row, seed: r.seed, success: r.success })), verify }, null, 2));
  }
  if (command === 'verify') {
    const seeds = (process.argv[3] || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!seeds.length) throw new Error('Pass seeds, for example: node feishu_style_workflow.js verify 2429955584');
    console.log(JSON.stringify(await verifyResultTable(seeds), null, 2));
  }
  if (command === 'cleanup') {
    cleanupRows(rowsFromArg());
    console.log('cleanup complete');
  }
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});

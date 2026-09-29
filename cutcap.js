const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const CAPCUT_CLI_VERSION = '0.26.0';
const MARGIN_BEFORE = 0.20;
const MARGIN_AFTER = 0.40;
const SMOOTH_CUT = 0.35;
const SMOOTH_CLIP = 0.10;

function fail(message) { throw new Error(message); }

function requireFile(value) {
  const input = String(value || '').trim().replace(/^"|"$/g, '');
  if (!input) fail('Enter a video path. Example: cutcap "D:\\video.mp4"');
  const file = path.resolve(input);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`Video not found: ${file}`);
  return file;
}

function findAutoEditor() {
  const candidates = [
    process.env.CUTCAP_AUTO_EDITOR,
    path.join(__dirname, 'auto-editor.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'CutCap', 'auto-editor.exe'),
  ].filter(Boolean);
  return candidates.find(file => {
    try { return fs.existsSync(file) && fs.statSync(file).isFile(); } catch { return false; }
  }) || '';
}

function findCapCutCliJs() {
  const candidates = [
    process.env.CUTCAP_CAPCUT_CLI_JS,
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', 'capcut-cli', 'dist', 'index.js'),
  ].filter(Boolean);
  return candidates.find(file => {
    try { return fs.existsSync(file) && fs.statSync(file).isFile(); } catch { return false; }
  }) || '';
}

function findCapCutDraftsDir() {
  const dir = process.env.CUTCAP_DRAFTS_DIR ||
    (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft'));
  try { return dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : ''; } catch { return ''; }
}

function editorProcesses() {
  if (process.platform !== 'win32') return [];
  try {
    const output = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 3000 }).stdout || '';
    const seen = new Set();
    for (const raw of output.split(/\r?\n/)) {
      const match = raw.trim().match(/^"([^"]+)"/);
      if (match) seen.add(match[1].toLowerCase());
    }
    return ['CapCut.exe', 'JianyingPro.exe'].filter(name => seen.has(name.toLowerCase()));
  } catch { return []; }
}

function ensureCapCutClosed() {
  const running = editorProcesses();
  if (running.length) fail(`Close CapCut first, then run the command again. (${running.join(' / ')})`);
}

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd || process.cwd(),
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', code => resolve({ code: Number(code ?? 1), stdout, stderr, output: [stdout, stderr].filter(Boolean).join('\n').trim() }));
  });
}

async function runAutoEditor(args, cwd) {
  const exe = findAutoEditor();
  if (!exe) fail('CutCap is not installed correctly. Run install.cmd once.');
  return run(exe, args, { cwd });
}

async function runCapCut(args) {
  const cli = findCapCutCliJs();
  if (!cli) fail(`capcut-cli ${CAPCUT_CLI_VERSION} is not installed. Run install.cmd.`);
  return run(process.execPath, [cli, ...args], { cwd: __dirname });
}

function parseTimebase(value) {
  if (typeof value === 'number') return value;
  const text = String(value || '').trim();
  const match = text.match(/^([\d.]+)\s*\/\s*([\d.]+)$/);
  if (match) return Number(match[1]) / Number(match[2]);
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

async function getMediaInfo(source) {
  const result = await runAutoEditor(['info', source, '--json'], path.dirname(source));
  if (result.code !== 0) fail(result.output || 'Could not read video information.');
  let data;
  try { data = JSON.parse(result.stdout); } catch { fail('Auto-Editor returned invalid video information.'); }
  const item = Object.values(data || {})[0] || {};
  const duration = Number(item?.container?.duration || item?.video?.[0]?.duration || item?.audio?.[0]?.duration || 0);
  const fps = parseTimebase(item?.recommendedTimebase || item?.video?.[0]?.fps || '30/1');
  return { duration, fps, raw: item };
}

function histPercentile(hist, minDb, maxDb, total, p) {
  if (!total) return minDb;
  const target = total * Math.min(1, Math.max(0, p));
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= target) return minDb + (i + 0.5) / hist.length * (maxDb - minDb);
  }
  return maxDb;
}

function otsuDb(hist, minDb, maxDb) {
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return -28;
  let sum = 0;
  for (let i = 0; i < hist.length; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let i = 0; i < hist.length - 1; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = i; }
  }
  return minDb + (best + 0.5) / hist.length * (maxDb - minDb);
}

function dbToPercent(db) { return Math.pow(10, db / 20) * 100; }
function round1(n) { return Math.round(n * 10) / 10; }

function recommendedThreshold(hist, total) {
  const minDb = -80, maxDb = 0;
  if (!total) return 4;
  const p40 = histPercentile(hist, minDb, maxDb, total, 0.40);
  const p75 = histPercentile(hist, minDb, maxDb, total, 0.75);
  const p90 = histPercentile(hist, minDb, maxDb, total, 0.90);
  const floorDb = Math.max(-60, p40);
  const activeDb = Math.max(p75, p90 - 8);
  const separation = activeDb - floorDb;
  const otsu = otsuDb(hist, minDb, maxDb);
  const bridge = floorDb + Math.max(5, separation * 0.55);
  let recDb = 0.25 * otsu + 0.75 * bridge - 0.5;
  if (separation < 10) recDb = 0.75 * (-27.96) + 0.25 * recDb;
  else if (separation < 16) recDb = 0.30 * (-27.96) + 0.70 * recDb;
  recDb = Math.max(-30, Math.min(-18, recDb));
  return round1(Math.max(1.2, Math.min(13, dbToPercent(recDb))));
}

async function analyzeRecommendedThreshold(source) {
  const exe = findAutoEditor();
  if (!exe) fail('Auto-Editor is not installed. Run install.cmd.');
  const hist = new Uint32Array(200);
  const minDb = -80, maxDb = 0;
  let total = 0;
  await new Promise((resolve, reject) => {
    const child = spawn(exe, ['levels', source], { cwd: path.dirname(source), windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    let stderr = '';
    rl.on('line', line => {
      const value = Number(String(line).trim());
      if (!Number.isFinite(value)) return;
      const level = Math.max(0, Math.min(1, value));
      const db = Math.max(minDb, Math.min(maxDb, 20 * Math.log10(Math.max(level, 0.0001))));
      const index = Math.min(hist.length - 1, Math.max(0, Math.floor((db - minDb) / (maxDb - minDb) * hist.length)));
      hist[index]++;
      total++;
    });
    child.stderr.on('data', chunk => { if (stderr.length < 20000) stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', code => {
      rl.close();
      if (code !== 0) reject(new Error(stderr.trim() || `Auto-Editor levels exited with ${code}`));
      else resolve();
    });
  });
  if (!total) fail('No usable audio level data was found in the video.');
  return recommendedThreshold(Array.from(hist), total);
}

function isCutSpeed(value) {
  const speed = Number(value);
  return speed === 0 || speed >= 99999;
}

function buildOtio({ source, fps, sourceDuration, chunks, name }) {
  const rate = Number(fps);
  const lastChunkFrame = chunks.reduce((max, chunk) => {
    const end = Number(chunk?.[1]);
    return Number.isFinite(end) ? Math.max(max, end) : max;
  }, 0);
  const fullFrames = Math.max(1, Math.round(Number(sourceDuration) * rate), lastChunkFrame);
  const rt = value => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value });
  const range = (start, duration) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: rt(start), duration: rt(duration) });
  const mediaName = path.basename(source);
  const clips = [];
  for (const chunk of chunks) {
    if (!Array.isArray(chunk) || chunk.length < 3 || isCutSpeed(chunk[2])) continue;
    const start = Number(chunk[0]), end = Number(chunk[1]), speed = Number(chunk[2]) || 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !(speed > 0)) continue;
    clips.push({
      OTIO_SCHEMA: 'Clip.1', name: mediaName,
      source_range: range(start, end - start),
      effects: Math.abs(speed - 1) > 1e-9 ? [{ OTIO_SCHEMA: 'LinearTimeWarp.1', name: 'Speed', time_scalar: speed, metadata: {} }] : [],
      markers: [], metadata: {},
      media_reference: { OTIO_SCHEMA: 'ExternalReference.1', name: mediaName, target_url: source, available_range: range(0, fullFrames), metadata: {} },
    });
  }
  if (!clips.length) fail('The automatic settings would remove the entire video.');
  return {
    OTIO_SCHEMA: 'Timeline.1', name: `${name} - Auto Cut`, global_start_time: rt(0), metadata: { cutcap: { source } },
    tracks: {
      OTIO_SCHEMA: 'Stack.1', name: 'tracks', source_range: null, effects: [], markers: [], metadata: {},
      children: [{ OTIO_SCHEMA: 'Track.1', name: 'Auto Cut', kind: 'Video', source_range: null, effects: [], markers: [], metadata: {}, children: clips }],
    },
  };
}

function compareVersions(a, b) {
  const left = String(a || '').split('.').map(n => Number(n) || 0);
  const right = String(b || '').split('.').map(n => Number(n) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function isAppAuthored(draft) {
  return (typeof draft.version === 'number' && draft.version > 0) ||
    (typeof draft.new_version === 'string' && draft.new_version !== '') ||
    (draft.last_modified_platform !== undefined && draft.last_modified_platform !== null);
}

function findSeedProject(draftsDir) {
  let best = null;
  for (const entry of fs.readdirSync(draftsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(draftsDir, entry.name);
    for (const fileName of ['draft_info.json', 'draft_content.json']) {
      const file = path.join(projectDir, fileName);
      try {
        if (!fs.existsSync(file)) continue;
        const draft = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        const appVersion = String(draft?.platform?.app_version || '');
        if (draft?.platform?.app_source !== 'cc' || !appVersion) continue;
        const candidate = { projectDir, draft, appVersion, appAuthored: isAppAuthored(draft), mtimeMs: fs.statSync(file).mtimeMs };
        if (!best ||
            (candidate.appAuthored && !best.appAuthored) ||
            (candidate.appAuthored === best.appAuthored && compareVersions(candidate.appVersion, best.appVersion) > 0) ||
            (candidate.appAuthored === best.appAuthored && compareVersions(candidate.appVersion, best.appVersion) === 0 && candidate.mtimeMs > best.mtimeMs)) best = candidate;
        break;
      } catch {}
    }
  }
  return best;
}

function reducedRatio(width, height, fallback = 'original') {
  let a = Math.round(Number(width)), b = Math.round(Number(height));
  if (!(a > 0) || !(b > 0)) return fallback;
  let x = a, y = b;
  while (y) { const t = x % y; x = y; y = t; }
  return `${a / x}:${b / x}`;
}

async function createTemplate(draftsDir, media) {
  const seed = findSeedProject(draftsDir);
  if (!seed) fail('Open CapCut once, create a blank project, close CapCut, then run cutcap again.');
  const cli = findCapCutCliJs();
  const { seedDraftSkeleton } = await import(pathToFileURL(path.join(path.dirname(cli), 'factory.js')).href);
  const donorCanvas = seed.draft?.canvas_config || { width: 1920, height: 1080, ratio: '16:9' };
  const width = Number(media.width) > 0 ? Number(media.width) : donorCanvas.width;
  const height = Number(media.height) > 0 ? Number(media.height) : donorCanvas.height;
  const canvas = { width, height, ratio: reducedRatio(width, height, donorCanvas.ratio || 'original') };
  const fps = Number(media.fps) > 0 ? Number(media.fps) : (Number(seed.draft?.fps) || 30);
  const { draft } = seedDraftSkeleton(seed.draft, {
    name: 'CutCap Template', id: crypto.randomUUID(), canvas, fps, nowMs: Date.now(), materialKeys: Object.keys(seed.draft?.materials || {}),
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutcap-template-'));
  const content = JSON.stringify(draft);
  fs.writeFileSync(path.join(dir, 'draft_content.json'), content);
  fs.writeFileSync(path.join(dir, 'draft_info.json'), content);
  try {
    JSON.parse(fs.readFileSync(path.join(seed.projectDir, 'template-2.tmp'), 'utf8').replace(/^\uFEFF/, ''));
    fs.writeFileSync(path.join(dir, 'template-2.tmp'), content);
  } catch {}
  return { dir, seed };
}

function safeName(value) {
  const clean = String(value || 'Video').replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  return (clean || 'Video').slice(0, 80);
}

function uniqueDraftPath(root, name) {
  let candidate = path.join(root, name);
  for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(root, `${name} (${n})`);
  return candidate;
}

async function makeCapCutProject(source, threshold) {
  const draftsDir = findCapCutDraftsDir();
  if (!draftsDir) fail('CapCut is not installed or has not been opened on this PC yet.');
  if (!findCapCutCliJs()) fail(`capcut-cli ${CAPCUT_CLI_VERSION} is not installed. Run install.cmd.`);
  ensureCapCutClosed();

  const cwd = path.dirname(source);
  const timelineFile = path.join(os.tmpdir(), `cutcap-${crypto.randomUUID()}.v1`);
  const otioFile = path.join(os.tmpdir(), `cutcap-${crypto.randomUUID()}.otio`);
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutcap-stage-'));
  let templateDir = '', publishTemp = '', publishedDraft = '';
  let registrationStarted = false, completed = false;

  try {
    const edit = await runAutoEditor([
      source, '--edit', `audio:threshold=${threshold}%`, '--margin', `${MARGIN_BEFORE}sec,${MARGIN_AFTER}sec`,
      '--smooth', `${SMOOTH_CUT}sec,${SMOOTH_CLIP}sec`, '--export', 'v1', '-o', timelineFile,
    ], cwd);
    if (edit.code !== 0 || !fs.existsSync(timelineFile)) fail(edit.output || 'Auto-Editor could not create the timeline.');

    const timeline = JSON.parse(fs.readFileSync(timelineFile, 'utf8').replace(/^\uFEFF/, ''));
    const fps = parseTimebase(timeline.timebase);
    const info = await getMediaInfo(source);
    const resolution = Array.isArray(info.raw?.video?.[0]?.resolution) ? info.raw.video[0].resolution.map(Number) : [];
    const base = safeName(path.basename(source, path.extname(source)));
    const projectName = `${base} - Auto Cut`;
    const otio = buildOtio({ source, fps, sourceDuration: info.duration, chunks: timeline.chunks || [], name: base });
    fs.writeFileSync(otioFile, JSON.stringify(otio, null, 2));

    const template = await createTemplate(draftsDir, { width: resolution[0], height: resolution[1], fps });
    templateDir = template.dir;
    const stagedDraft = path.join(stagingRoot, projectName);
    const imported = await runCapCut(['import-timeline', otioFile, '--out', stagedDraft, '--template', templateDir]);
    if (imported.code !== 0 || !fs.existsSync(stagedDraft)) fail(imported.output || 'Could not build the CapCut project.');
    const stagedLint = await runCapCut(['lint', stagedDraft, '--frame-grid']);
    if (stagedLint.code >= 2) fail(stagedLint.output || 'The staged CapCut project failed validation.');

    ensureCapCutClosed();
    const finalDraft = uniqueDraftPath(draftsDir, projectName);
    publishTemp = path.join(draftsDir, `.cutcap-${crypto.randomUUID()}`);
    fs.cpSync(stagedDraft, publishTemp, { recursive: true, errorOnExist: true });
    fs.renameSync(publishTemp, finalDraft);
    publishTemp = '';
    publishedDraft = finalDraft;

    const relink = await runCapCut(['relink', finalDraft, '--from', stagedDraft, '--to', finalDraft]);
    if (relink.code !== 0) fail(relink.output || 'Could not finalize the project media paths.');
    const publishedLint = await runCapCut(['lint', finalDraft, '--frame-grid']);
    if (publishedLint.code >= 2) fail(publishedLint.output || 'The final CapCut project failed validation.');

    const plan = await runCapCut(['register', finalDraft, '--materials', '--drafts', draftsDir]);
    if (plan.code !== 0) fail(plan.output || 'Could not prepare CapCut project registration.');
    ensureCapCutClosed();
    registrationStarted = true;
    const register = await runCapCut(['register', finalDraft, '--materials', '--drafts', draftsDir, '--apply']);
    if (register.code !== 0) fail(`The project was created, but CapCut registration failed.\n${register.output}`);

    ensureCapCutClosed();
    const fix = await runCapCut(['lint', finalDraft, '--fix', '--frame-grid']);
    if (fix.code >= 2) fail(fix.output || 'Could not repair media linking inside the CapCut project.');
    const finalLint = await runCapCut(['lint', finalDraft, '--frame-grid']);
    if (finalLint.code >= 2) fail(finalLint.output || 'Final CapCut project validation failed.');

    completed = true;
    return { projectName: path.basename(finalDraft), clips: otio.tracks.children[0].children.length };
  } finally {
    for (const file of [timelineFile, otioFile]) try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
    try { if (templateDir && fs.existsSync(templateDir)) fs.rmSync(templateDir, { recursive: true, force: true }); } catch {}
    try { if (publishTemp && fs.existsSync(publishTemp)) fs.rmSync(publishTemp, { recursive: true, force: true }); } catch {}
    try { if (publishedDraft && !completed && !registrationStarted && fs.existsSync(publishedDraft)) fs.rmSync(publishedDraft, { recursive: true, force: true }); } catch {}
    try { if (fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  try {
    if (process.platform !== 'win32') fail('This CutCap build supports Windows only.');
    const source = requireFile(process.argv[2]);
    ensureCapCutClosed();
    console.log('1/3 Analyzing audio...');
    const threshold = await analyzeRecommendedThreshold(source);
    console.log(`2/3 Recommended threshold: ${threshold}% - cutting silence...`);
    const result = await makeCapCutProject(source, threshold);
    console.log(`3/3 Done: ${result.projectName}`);
    console.log(`Clips: ${result.clips} | Threshold: ${threshold}% | Speech padding: ${MARGIN_BEFORE}s before / ${MARGIN_AFTER}s after`);
    console.log('Open CapCut. The editable project is ready in your project list.');
  } catch (error) {
    console.error(`Error: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

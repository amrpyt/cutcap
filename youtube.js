const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const DEFAULT_QUALITY = '720';
const QUALITY_CHOICES = new Set(['best', '2160', '1440', '1080', '720', '480', '360', '240']);

function fail(message) {
  throw new Error(message);
}

function existingFile(candidates) {
  return candidates.filter(Boolean).find(function (file) {
    try {
      return fs.existsSync(file) && fs.statSync(file).isFile();
    } catch {
      return false;
    }
  }) || '';
}

function findYtDlp() {
  return existingFile([
    process.env.CUTCAP_YTDLP,
    path.join(__dirname, 'yt-dlp.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'CutCap', 'yt-dlp.exe'),
  ]);
}

function findFfmpeg() {
  return existingFile([
    process.env.CUTCAP_FFMPEG,
    path.join(__dirname, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
    path.join(__dirname, 'node_modules', 'ffmpeg-static', 'ffmpeg'),
  ]);
}

function runLive(file, args, cwd) {
  return new Promise(function (resolve, reject) {
    const child = spawn(file, args, {
      cwd: cwd || process.cwd(),
      windowsHide: true,
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', function (code) {
      resolve(Number(code == null ? 1 : code));
    });
  });
}

function runLiveCapture(file, args, cwd) {
  return new Promise(function (resolve, reject) {
    const child = spawn(file, args, {
      cwd: cwd || process.cwd(),
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = function (chunk, target) {
      const text = chunk.toString('utf8');
      target.write(text);
      if (output.length < 200000) output += text;
    };
    child.stdout.on('data', function (chunk) { collect(chunk, process.stdout); });
    child.stderr.on('data', function (chunk) { collect(chunk, process.stderr); });
    child.once('error', reject);
    child.once('close', function (code) {
      resolve({ code: Number(code == null ? 1 : code), output: output });
    });
  });
}

function shouldRetryYoutube403(output) {
  return /\b403\b|forbidden|forcing sabr|missing a url/i.test(String(output || ''));
}

function requireYoutubeTools() {
  const ytDlp = findYtDlp();
  const ffmpeg = findFfmpeg();
  if (!ytDlp || !ffmpeg) {
    fail('YouTube tools are missing. Run install.cmd again.');
  }
  return { ytDlp, ffmpeg };
}

function normalizeQuality(value) {
  const quality = String(value || DEFAULT_QUALITY).toLowerCase();
  if (!QUALITY_CHOICES.has(quality)) {
    fail('Quality must be one of: 240, 360, 480, 720, 1080, 1440, 2160, best');
  }
  return quality;
}

function normalizeTime(value, label) {
  const text = String(value || '').trim();
  if (!text) fail(label + ' time is required.');
  if (!/^\d+(?::[0-5]?\d){0,2}(?:\.\d+)?$/.test(text)) {
    fail(label + ' time must look like 90, 12:30, or 01:02:03.5');
  }
  return text;
}

function defaultDownloadsDir() {
  const dir = path.join(os.homedir(), 'Downloads');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function parseFlags(args) {
  const out = { positionals: [], exact: false, audio: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--exact') {
      out.exact = true;
    } else if (arg === '--audio') {
      out.audio = true;
    } else if (arg === '--from' || arg === '--to' || arg === '--quality' || arg === '--output') {
      const value = args[++i];
      if (value == null) fail('Missing value after ' + arg);
      out[arg.slice(2)] = value;
    } else if (arg === '-h' || arg === '--help') {
      out.help = true;
    } else if (arg.startsWith('-')) {
      fail('Unknown option: ' + arg);
    } else {
      out.positionals.push(arg);
    }
  }
  return out;
}

function formatSelector(quality) {
  if (quality === 'best') return 'bv*+ba/b';
  return 'bv*[height<=' + quality + ']+ba/b[height<=' + quality + ']/b';
}

async function downloadYoutube(options) {
  const tools = requireYoutubeTools();
  const url = String(options.url || '').trim();
  if (!url) fail('YouTube URL is required.');

  const hasStart = options.start != null && String(options.start).trim() !== '';
  const hasEnd = options.end != null && String(options.end).trim() !== '';
  if (hasStart !== hasEnd) fail('Use both --from and --to for a clip.');

  const quality = normalizeQuality(options.quality);
  const outputDir = path.resolve(String(options.output || defaultDownloadsDir()));
  fs.mkdirSync(outputDir, { recursive: true });

  const args = [
    url,
    '--no-playlist',
    '--js-runtimes', 'node',
    '--ffmpeg-location', tools.ffmpeg,
    '--newline',
  ];

  let clip = false;
  if (hasStart && hasEnd) {
    const start = normalizeTime(options.start, 'Start');
    const end = normalizeTime(options.end, 'End');
    args.push('--download-sections', '*' + start + '-' + end);
    clip = true;
  }

  if (options.exact && clip) {
    args.push('--force-keyframes-at-cuts');
  }

  if (options.audio) {
    args.push('-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    args.push('-f', formatSelector(quality), '--merge-output-format', 'mp4');
  }

  const suffix = clip ? ' [clip]' : '';
  args.push('-o', path.join(outputDir, '%(title).100s' + suffix + '.%(ext)s'));

  console.log('');
  if (clip) {
    console.log('Downloading only ' + options.start + ' -> ' + options.end + ' ...');
    if (!options.exact) {
      console.log('Fast cut mode: minimal network use; boundaries can be near the closest media keyframe.');
    } else {
      console.log('Exact cut mode: slower because FFmpeg re-encodes around the cut.');
    }
  } else {
    console.log('Downloading full media...');
  }
  console.log('Output: ' + outputDir);
  console.log('');

  let result = await runLiveCapture(tools.ytDlp, args, outputDir);

  if (result.code !== 0 && shouldRetryYoutube403(result.output)) {
    console.log('');
    console.log('YouTube blocked the first media URL (403/SABR). Retrying with the Android player client...');
    console.log('');
    const retryArgs = args.concat(['--extractor-args', 'youtube:player_client=android']);
    result = await runLiveCapture(tools.ytDlp, retryArgs, outputDir);
  }

  if (result.code !== 0) {
    fail('yt-dlp exited with code ' + result.code + '. Run "cutcap update" and try again.');
  }
  console.log('');
  console.log('Done.');
}

async function updateYtDlp() {
  const ytDlp = findYtDlp();
  if (!ytDlp) fail('yt-dlp is missing. Run install.cmd again.');
  console.log('Updating yt-dlp...');
  const code = await runLive(ytDlp, ['-U'], __dirname);
  if (code !== 0) fail('yt-dlp update failed with code ' + code + '.');
}

function ask(rl, question) {
  return new Promise(function (resolve) {
    rl.question(question, function (answer) { resolve(String(answer || '').trim()); });
  });
}

async function interactive(onCut) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('');
    console.log('CutCap');
    console.log('1) Auto-cut silence -> editable CapCut project');
    console.log('2) Download a YouTube clip');
    console.log('3) Download a full YouTube video');
    console.log('4) Download YouTube audio');
    console.log('5) Update YouTube downloader');
    console.log('6) Help');
    console.log('0) Exit');
    console.log('');

    const choice = await ask(rl, 'Choose: ');

    if (choice === '0') return;
    if (choice === '1') {
      const source = await ask(rl, 'Video path: ');
      await onCut(source);
      return;
    }
    if (choice === '2') {
      const url = await ask(rl, 'YouTube URL: ');
      const start = await ask(rl, 'Start time (example 12:30): ');
      const end = await ask(rl, 'End time (example 14:00): ');
      const quality = (await ask(rl, 'Max quality [720]: ')) || DEFAULT_QUALITY;
      const exact = /^y(es)?$/i.test(await ask(rl, 'Exact cut? Slower [y/N]: '));
      rl.close();
      await downloadYoutube({ url, start, end, quality, exact, audio: false });
      return;
    }
    if (choice === '3') {
      const url = await ask(rl, 'YouTube URL: ');
      const quality = (await ask(rl, 'Max quality [720]: ')) || DEFAULT_QUALITY;
      rl.close();
      await downloadYoutube({ url, quality, audio: false });
      return;
    }
    if (choice === '4') {
      const url = await ask(rl, 'YouTube URL: ');
      rl.close();
      await downloadYoutube({ url, audio: true, quality: DEFAULT_QUALITY });
      return;
    }
    if (choice === '5') {
      rl.close();
      await updateYtDlp();
      return;
    }
    if (choice === '6') {
      printHelp();
      return;
    }
    fail('Unknown menu choice.');
  } finally {
    try { rl.close(); } catch {}
  }
}

function printHelp() {
  console.log('');
  console.log('CutCap commands');
  console.log('');
  console.log('  cutcap');
  console.log('      Open the interactive menu.');
  console.log('');
  console.log('  cutcap "D:\\Videos\\video.mp4"');
  console.log('  cutcap cut "D:\\Videos\\video.mp4"');
  console.log('      Remove silence and create an editable CapCut project.');
  console.log('');
  console.log('  cutcap yt URL --from 12:30 --to 14:00 --quality 720');
  console.log('      Download only a time range. Fast mode is default.');
  console.log('');
  console.log('  cutcap yt URL --from 12:30 --to 14:00 --quality 1080 --exact');
  console.log('      Download a time range and re-encode for a more exact cut.');
  console.log('');
  console.log('  cutcap yt URL --quality 720');
  console.log('      Download the full video.');
  console.log('');
  console.log('  cutcap audio URL');
  console.log('      Download audio as MP3.');
  console.log('');
  console.log('  cutcap update');
  console.log('      Update yt-dlp.');
  console.log('');
  console.log('Quality: 240, 360, 480, 720, 1080, 1440, 2160, best');
}

async function handle(args, onCut) {
  if (!Array.isArray(args) || args.length === 0) {
    await interactive(onCut);
    return true;
  }

  const command = String(args[0] || '').toLowerCase();

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return true;
  }

  if (command === 'update') {
    await updateYtDlp();
    return true;
  }

  if (command === 'cut') {
    if (!args[1]) fail('Video path is required. Example: cutcap cut "D:\\video.mp4"');
    await onCut(args[1]);
    return true;
  }

  if (command === 'yt' || command === 'youtube') {
    const parsed = parseFlags(args.slice(1));
    if (parsed.help) {
      printHelp();
      return true;
    }
    const url = parsed.positionals[0];
    await downloadYoutube({
      url,
      start: parsed.from,
      end: parsed.to,
      quality: parsed.quality || DEFAULT_QUALITY,
      output: parsed.output,
      exact: parsed.exact,
      audio: parsed.audio,
    });
    return true;
  }

  if (command === 'audio') {
    const parsed = parseFlags(args.slice(1));
    const url = parsed.positionals[0];
    await downloadYoutube({
      url,
      start: parsed.from,
      end: parsed.to,
      output: parsed.output,
      exact: parsed.exact,
      audio: true,
      quality: DEFAULT_QUALITY,
    });
    return true;
  }

  return false;
}

module.exports = { handle };

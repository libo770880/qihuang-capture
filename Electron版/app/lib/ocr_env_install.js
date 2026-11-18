// lib/ocr_env_install.js - OCR 专用 Python 环境一键离线安装
// 预置包 vendor/ocr_env/：
//   python-embed.zip    Python 3.13 嵌入式版（无需系统安装 Python）
//   get-pip.py          pip 引导（内置 wheel，离线可用）
//   wheels/             RapidOCR(ONNX) 通用通道轮子（onnxruntime 1.20.1 + rapidocr + opencv 等）
//                       —— 不依赖 AVX，任何 x64 CPU 可用（CPU 无 AVX 的解决办法）
//   wheels-paddle/      （可选，当前不随包分发——为控发布包体积已移除）
//                       PP-OCRv6 原生通道轮子（paddlepaddle 3.3.1 + paddleocr 3.7.0 全依赖）
//                       —— 仅支持 AVX 的 CPU；目录存在则优先尝试，import 失败自动回落 wheels/
//                       缺省时直接走 wheels/ 通道，识别模型同为 scripts/models/PP-OCRv6_*.onnx
// 安装步骤：解压嵌入式 Python 到 runtime/ocr → 开启 site → 离线装 pip →
//           （可选）装 paddle 并子进程验证 → 验证失败自动切 RapidOCR(ONNX) → probe 验收
// 安装完成后 py.js 的探测路径 runtime/ocr/python.exe 即命中，无需改配置。
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { findPython } = require('./py');

const APP_ROOT = path.join(__dirname, '..');
const PKG_DIR = path.join(APP_ROOT, 'vendor', 'ocr_env');
const TARGET = path.join(APP_ROOT, 'runtime', 'ocr');
const WHEELS = path.join(PKG_DIR, 'wheels');
const WHEELS_PADDLE = path.join(PKG_DIR, 'wheels-paddle');

let _running = false; // 防并发

function log(line, onLog) { try { onLog && onLog(line); } catch (e) { /* 忽略 */ } }

/** 运行子进程，逐行回调 stdout/stderr；返回 {code} */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    // Python/pip 在管道下默认按系统 locale（中文 Windows=GBK）写 stdout，
    // 而本侧按 UTF-8 解码 → 含中文的路径（如「岐黄鉴方采集助手-net」）整段乱码。
    // 强制子进程 UTF-8 模式，与解码侧对齐（对 tar/powershell 等非 Python 进程无害）。
    const env = Object.assign({}, process.env, opts.env || {}, { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' });
    const child = spawn(cmd, args, { windowsHide: true, ...opts, env });
    const feed = (buf, tag) => String(buf).split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(l => opts.onLine && opts.onLine(tag + l));
    child.stdout.on('data', d => feed(d, ''));
    child.stderr.on('data', d => feed(d, '· '));
    child.on('error', e => { log('  进程启动失败: ' + e.message, opts.onLine); resolve({ code: -1 }); });
    child.on('close', code => resolve({ code }));
  });
}

/** 解压 zip：优先系统 bsdtar（C:\Windows\System32\tar.exe 支持 zip），失败回落 PowerShell Expand-Archive */
async function unzip(zipPath, destDir, onLog) {
  fs.mkdirSync(destDir, { recursive: true });
  const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  if (fs.existsSync(sysTar)) {
    const r = await run(sysTar, ['-xf', zipPath, '-C', destDir], { onLine: l => log('  ' + l, onLog) });
    if (r.code === 0 && fs.readdirSync(destDir).length > 0) return true;
  }
  log('系统 tar 不可用，改用 PowerShell Expand-Archive…', onLog);
  const r = await run('powershell.exe', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`], { onLine: l => log('  ' + l, onLog) });
  return r.code === 0 && fs.readdirSync(destDir).length > 0;
}

/** 嵌入式 Python 默认隔离 site-packages，必须开启 import site 才能用 pip */
function patchPth(target) {
  const pthFile = fs.readdirSync(target).find(f => /^python\d+\._pth$/.test(f));
  if (!pthFile) return false;
  const p = path.join(target, pthFile);
  let s = fs.readFileSync(p, 'utf8');
  if (/^#\s*import\s+site/m.test(s)) {
    s = s.replace(/^#\s*(import\s+site)/m, '$1');
    fs.writeFileSync(p, s, 'utf8');
  }
  return true;
}

/** 当前机器是否已具备可用 OCR Python */
function envReady() {
  try { return !!findPython(''); } catch (e) { return false; }
}

/**
 * 一键离线安装（幂等：环境已就绪直接返回）
 * @returns {Promise<{ok:boolean, skipped?:boolean, engine?:string, target?:string, error?:string}>}
 */
async function installOcrEnv(onLog) {
  if (_running) return { ok: false, error: '已有安装任务进行中' };
  if (!fs.existsSync(path.join(PKG_DIR, 'python-embed.zip'))) {
    return { ok: false, error: '预置安装包缺失（vendor/ocr_env/python-embed.zip）' };
  }
  if (!fs.existsSync(path.join(WHEELS, ''))) {
    return { ok: false, error: '预置轮子缺失（vendor/ocr_env/wheels/）' };
  }
  _running = true;
  const py = path.join(TARGET, 'python.exe');
  const hasPaddleWheels = fs.existsSync(path.join(WHEELS_PADDLE)) && fs.readdirSync(WHEELS_PADDLE).some(f => f.endsWith('.whl'));
  try {
    if (envReady()) {
      // 环境已就绪：仍需确保 RapidOCR(ONNX) 可选通道齐备（早期版本只装原生通道）
      const detected = findPython('');
      let hasRapid = false;
      try { hasRapid = (await run(detected, ['-c', 'import rapidocr_onnxruntime, onnxruntime'], {})).code === 0; } catch (e) { /* 忽略 */ }
      if (hasRapid) {
        log('✓ 检测到可用 OCR Python 环境，无需安装', onLog);
        return { ok: true, skipped: true };
      }
      log('检测到可用 OCR 环境，补装 RapidOCR(ONNX) 可选通道（约 20MB，装完可在「识别引擎」中选用）…', onLog);
      const rc = await run(detected, ['-m', 'pip', 'install', '--no-index', '--find-links', WHEELS,
        '--no-warn-script-location', 'rapidocr-onnxruntime==1.2.3', 'onnxruntime==1.20.1'],
        { onLine: l => log('  ' + l, onLog) });
      if (rc.code !== 0) return { ok: false, error: 'RapidOCR 通道补装失败（exit ' + rc.code + '）' };
      log('✓ RapidOCR(ONNX) 通道已补齐，可在「识别引擎」中主动选用', onLog);
      return { ok: true, engine: 'rapidocr-onnx', target: detected };
    }
    log('① 解压嵌入式 Python 3.13 → runtime/ocr …', onLog);
    if (fs.existsSync(py)) { // 上次装到一半，清理重来
      try { fs.rmSync(TARGET, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
    }
    if (!(await unzip(path.join(PKG_DIR, 'python-embed.zip'), TARGET, onLog))) {
      return { ok: false, error: '解压 python-embed.zip 失败' };
    }
    if (!patchPth(TARGET)) log('⚠ 未找到 python._pth（跳过 site 开关）', onLog);

    log('② 离线安装 pip …', onLog);
    let r = await run(py, [path.join(PKG_DIR, 'get-pip.py'), '--no-index', '--find-links', WHEELS, '--no-warn-script-location'],
      { onLine: l => log('  ' + l, onLog) });
    if (r.code !== 0) return { ok: false, error: 'get-pip 安装失败（exit ' + r.code + '）' };

    let engine = 'rapidocr-onnx';
    if (hasPaddleWheels) {
      log('③ 尝试原生 PP-OCRv6 通道（paddlepaddle 3.3.1，约 1.2GB，需数分钟）…', onLog);
      r = await run(py, ['-m', 'pip', 'install', '--no-index', '--find-links', WHEELS_PADDLE,
        '--no-warn-script-location', 'paddlepaddle==3.3.1', 'paddleocr==3.7.0'],
        { onLine: l => log('  ' + l, onLog) });
      if (r.code === 0) {
        // paddle 核心在无 AVX 的 CPU 上 import 即 segfault（进程级崩溃）→ 子进程验证
        log('④ 验证 paddle 核心可加载…', onLog);
        r = await run(py, ['-c', 'import paddleocr, paddle'], { onLine: l => log('  ' + l, onLog) });
        if (r.code === 0) {
          engine = 'paddleocr-ppocrv6';
        } else {
          log('⚠ 本机 CPU 不支持 AVX，paddle 原生核心无法加载 → 自动切换 RapidOCR(ONNX) 通道', onLog);
        }
      } else {
        log('⚠ paddle 轮子安装失败 → 自动切换 RapidOCR(ONNX) 通道', onLog);
      }
    } else {
      log('③ 未内置 wheels-paddle（原生 PP-OCRv6 轮子），直接安装通用通道', onLog);
    }

    // RapidOCR(ONNX) 通道：无论原生通道是否可用都安装 —— 它可在后台「识别引擎」中主动选用
    // （内存占用更低、任何 x64 CPU 可用），也是无 AVX 机器的唯一可选通道。
    log('⑤ 安装 RapidOCR(ONNX) 通道（onnxruntime 1.20.1，任何 CPU 可用）…', onLog);
    r = await run(py, ['-m', 'pip', 'install', '--no-index', '--find-links', WHEELS,
      '--no-warn-script-location', 'rapidocr-onnxruntime==1.2.3', 'onnxruntime==1.20.1'],
      { onLine: l => log('  ' + l, onLog) });
    if (r.code !== 0) {
      if (engine === 'rapidocr-onnx') return { ok: false, error: 'RapidOCR 轮子安装失败（exit ' + r.code + '）' };
      log('⚠ RapidOCR 通道安装失败（不影响原生通道，可稍后重试）', onLog);
    } else if (engine === 'paddleocr-ppocrv6') {
      engine = 'paddleocr-ppocrv6 + rapidocr-onnx';
    }

    log('⑥ 验收：探测 OCR 引擎 …', onLog);
    r = await run(py, [path.join(APP_ROOT, 'scripts', 'ocr_paddle.py'), '--probe'],
      { onLine: l => log('  ' + l, onLog) });
    if (r.code !== 0) return { ok: false, error: 'OCR 引擎验收失败（probe exit ' + r.code + '）' };

    log('✓ OCR 环境离线安装完成（' + engine + '）', onLog);
    return { ok: true, engine, target: TARGET };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally {
    _running = false;
  }
}

module.exports = { installOcrEnv, envReady, PKG_DIR, TARGET };

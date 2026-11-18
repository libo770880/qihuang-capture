/**
 * tesseract.js 离线 OCR 引擎（纯 JS，无 Python/网络依赖）
 * 定位：PaddleOCR 不可用时的离线兜底 + 「屏幕文字」快速通道。
 * 语言包：vendor/tessdata（chi_sim + eng，4.0.0 标准版，随应用分发）。
 * 常驻 worker（惰性创建），识别约 1~3s/张。
 * 可靠性：worker 创建 / 识别均带超时守卫，超时自动销毁重建，绝不无限卡死。
 */
const path = require('path');
const fs = require('fs');

const LANG_DIR = path.join(__dirname, '..', 'vendor', 'tessdata');
const CACHE_DIR = path.join(__dirname, '..', 'vendor', 'tesscache');
const LANGS = ['chi_sim', 'eng'];
const CREATE_TIMEOUT = 60 * 1000;  // worker 创建超时（首次含 wasm+语言包加载）
const OCR_TIMEOUT = 90 * 1000;     // 单张识别超时
const UPSCALE = 3;                 // HIS 截图字号小，放大 3 倍识别（tesseract 对缩放极敏感）

let _worker = null;       // 常驻 worker
let _creating = null;     // 创建中的 Promise（防并发重复创建）
let _log = () => {};      // 阶段日志钩子（main.js 注入 logLine）
let _prog = null;         // 识别进度钩子（ocrTess 调用期注入，logger 转发）

function setLog(fn) { if (typeof fn === 'function') _log = fn; }

// tesseract.js 进度事件 → 归一化 { status, p(0~1) }
function progEvent(m) {
  if (!_prog || !m) return;
  try { _prog({ status: String(m.status || ''), p: Math.max(0, Math.min(1, Number(m.progress) || 0)) }); } catch (e) {}
}

/**
 * 生成放大临时图（k 倍）：Electron 主进程内用原生 nativeImage 重采样（零依赖、离线）。
 * 非 Electron 环境（smoke/node 直测）或图过大返回 null。失败也不影响原识别流程。
 */
function makeUpscaled(imagePath, k) {
  try {
    const electron = require('electron');
    if (!electron || !electron.nativeImage || process.type !== 'browser') return null;
    const img = electron.nativeImage.createFromPath(imagePath);
    if (img.isEmpty()) return null;
    const sz = img.getSize();
    if (sz.width * k > 6000 || sz.height * k > 6000) return null; // 防爆内存
    const big = img.resize({ width: sz.width * k, height: sz.height * k, quality: 'best' });
    const out = imagePath.replace(/\.png$/i, '') + `.x${k}.png`;
    fs.writeFileSync(out, big.toPNG());
    return out;
  } catch (e) {
    _log('upscale skip: ' + e.message);
    return null;
  }
}

function withTimeout(p, ms, what) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(what + '超时（' + Math.round(ms / 1000) + 's），已终止')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

async function getWorker() {
  if (_worker) return _worker;
  if (_creating) return _creating;
  _creating = (async () => {
    const { createWorker } = require('tesseract.js');
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    _log('creating worker (langs=' + LANGS.join('+') + ')');
    const w = await withTimeout(createWorker(LANGS, 1, {
      langPath: LANG_DIR,
      gzip: true,
      cachePath: CACHE_DIR,
      logger: m => progEvent(m) // 进度转发（语言包加载/识别进度），非静默
    }), CREATE_TIMEOUT, 'tesseract worker 创建');
    _log('worker ready');
    _worker = w;
    return w;
  })();
  try { return await _creating; }
  catch (e) { _worker = null; throw e; } // 创建失败清空缓存态，下次重试
  finally { _creating = null; }
}

/**
 * tesseract 输出后清理（针对其高频系统性错误）：
 * ① 分隔符引号 “ → 空格  ② 汉字之间的空格剔除（"制 吴 茱 萸"→"制吴茱萸"）
 * ③ 剂量单位混淆还原：g↔8/¢/%（128→12g、128g→12g、12¢→12g、12%→12g；单独 8 不动）
 * ④ Sg/S8g→5g（S↔5 形近）
 */
function postClean(s) {
  return s
    .replace(/[“”„‟]/g, ' ')
    .replace(/(?<=[\u4e00-\u9fa5])[ \t]+(?=[\u4e00-\u9fa5])/g, '')
    .replace(/\b(\d{2,})8\b/g, '$1g')      // 128 → 12g（≥2位数字 + 结尾8）
    .replace(/\b(\d{2,})8g\b/g, '$1g')     // 128g → 12g
    .replace(/\b(\d{1,2})[%¢]/g, '$1g')    // 12% / 12¢ → 12g
    .replace(/\bS(?:8)?g\b/g, '5g')        // Sg / S8g → 5g
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** 识别结果客观评分：药味+剂量模式命中数（处方场景最可靠的择优指标） */
function doseScore(text) {
  const m = String(text || '').match(/[\u3400-\u4dbf\u4e00-\u9fa5·]{1,7}\s*\d{1,3}(?:\.\d)?\s*[gG克]/g);
  return m ? m.length : 0;
}

/** 单次识别（含超时守卫）→ data；失败时抛出（调用方决定是否终止 worker） */
async function recognizeOnce(w, usePath) {
  const { data } = await withTimeout(w.recognize(usePath), OCR_TIMEOUT, 'tesseract 识别');
  return data;
}

/** 识别单张图片 → { ok, engine, lines:[{text}], text }；onProgress({status,p}) 转发加载/识别进度 */
async function ocrTess(imagePath, onProgress) {
  _prog = (typeof onProgress === 'function') ? onProgress : null;
  let w;
  try { w = await getWorker(); }
  catch (e) { _log('worker create ERR ' + e.message); _prog = null; throw e; }

  // 双尺度对比：1x 适合照片/清晰大图（放大反而糊成乱码），3x 适合 HIS 小字截图——
  // 两版都识别，按「药味+剂量」命中数择优，无需用户判断图片类型。
  const scale3Path = makeUpscaled(imagePath, UPSCALE);
  _log('recognize start (1x)');
  let best = null;
  try {
    const d1 = await recognizeOnce(w, imagePath);
    best = String(d1.text || '');
  } catch (e) {
    _log('recognize ERR ' + e.message + ' → terminate worker');
    try { await w.terminate(); } catch (e2) {}
    _worker = null;
    if (scale3Path) { try { fs.unlinkSync(scale3Path); } catch (e2) {} }
    _prog = null;
    throw e;
  }
  if (scale3Path) {
    try {
      _log('recognize start (3x 对比)');
      const d3 = await recognizeOnce(w, scale3Path);
      const s1 = doseScore(best), s3 = doseScore(String(d3.text || ''));
      if (s3 > s1) { _log('pick 3x (dose ' + s3 + '>' + s1 + ')'); best = String(d3.text || ''); }
      else _log('pick 1x (dose ' + s1 + '>=' + s3 + ')');
    } catch (e) { _log('3x skipped: ' + e.message); }
    try { fs.unlinkSync(scale3Path); } catch (e2) {}
  }
  _log('recognize done');
  _prog = null;

  // 药名纠错直连 kb（OCR_HERB_FIX）：粘贴框所见即纠错后药名；kb 不可用时跳过不影响识别
  let kbFix = null;
  try { kbFix = require('./kb'); } catch (e) {}
  const lines = String(best || '')
    .split('\n')
    .map(l => {
      let t = postClean(l);
      if (t && kbFix && kbFix.fixOcrText) {
        try { t = kbFix.fixOcrText(t).text || t; } catch (e) {}
      }
      return { text: t };
    })
    .filter(l => l.text);
  return { ok: true, engine: 'tesseract', lines, text: lines.map(l => l.text).join('\n') };
}

/** 可用性探测（语言包是否就位） */
async function tessStatus() {
  const files = LANGS.map(l => path.join(LANG_DIR, l + '.traineddata.gz'));
  const ok = files.every(f => fs.existsSync(f));
  let live = !!_worker;
  if (ok) {
    try { await getWorker(); live = true; } catch (e) { return { ok: false, error: e.message }; }
  }
  return { ok, live, langDir: LANG_DIR, version: require('tesseract.js/package.json').version };
}

async function stopTess() {
  if (_worker) { try { await _worker.terminate(); } catch (e) {} _worker = null; }
}

module.exports = { ocrTess, tessStatus, stopTess, setLog };

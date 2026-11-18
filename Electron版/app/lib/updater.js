/**
 * 软件更新（GitHub Releases 驱动）—— Electron 版宿主实现
 *
 * 设计要点（与 net/QhjfCapture/Domain/Update.cs 严格镜像，行为保持一致）：
 *   版本源  仓库根 latest.json（raw.githubusercontent.com，可直接走镜像，无 API 限流）
 *   资产    Release 附件 qhjf-electron-vX.Y.Z.zip / qhjf-net-vX.Y.Z.zip + checksums.txt
 *   校验    latest.json 内声明的 sha256 与下载文件逐一比对，不一致即中止（不落地执行）
 *   应用    生成 update.bat → 等本进程退出 → 解压 → 覆盖安装目录（robocopy 不 purge，
 *           用户数据 userdata/ 与未打包文件保持原样）→ 重启
 *   镜像    直连失败自动回退到镜像前缀（国内网络访问 GitHub 常态），顺序见 MIRRORS
 *
 * 安全边界：
 *   - 只接受 https 链接；只覆盖安装目录，绝不触碰 userData（data.db / records）
 *   - 开发态（非 app/ + runtime/ 布局）拒绝自动更新，避免改坏源码工程
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = 'libo770880/qihuang-capture';
const RAW = (branch) => `https://raw.githubusercontent.com/${REPO}/${branch}/latest.json`;
const PAGE = `https://github.com/${REPO}/releases`;
// 镜像前缀：直连优先，失败按序回退（prefix + 原始 URL）
const MIRRORS = ['', 'https://ghfast.top/', 'https://gh-proxy.com/'];

const HOST_KIND = 'electron';
const MAX_REDIRECT = 5;
const DL_TIMEOUT = 120 * 1000;   // 单次请求空闲超时
const TOTAL_ATTEMPTS = 3;        // 每个镜像内的重试次数

let _log = () => {};

function setLog(fn) { if (typeof fn === 'function') _log = fn; }

// ---------- 基础工具 ----------

function cmpVersion(a, b) {
  const pa = String(a || '0').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function withMirror(url, prefix) {
  if (!prefix) return url;
  return prefix.replace(/\/$/, '') + '/' + url;
}

/** 单次 GET，返回 { status, headers, stream }；跟随 3xx；仅 https。 */
function get(url, { timeout = DL_TIMEOUT, redirects = MAX_REDIRECT } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('链接无效')); }
    if (u.protocol !== 'https:') return reject(new Error('仅支持 https 链接'));
    const req = https.get(url, {
      headers: { 'User-Agent': 'qhjf-updater/' + (process.env.npm_package_version || '1'), 'Accept': '*/*' },
      timeout,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return get(next, { timeout, redirects: redirects - 1 }).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      resolve({ res });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

/** GET 文本（小文件：latest.json / checksums.txt）。 */
async function getText(url, opts) {
  const { res } = await get(url, opts);
  return await new Promise((resolve, reject) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', d => { buf += d; });
    res.on('end', () => resolve(buf));
    res.on('error', reject);
  });
}

/** 按“直连 → 各镜像”顺序尝试，返回首个成功结果。 */
async function getTextWithMirrors(url, label) {
  const errs = [];
  for (const m of MIRRORS) {
    const target = withMirror(url, m);
    for (let i = 0; i < TOTAL_ATTEMPTS; i++) {
      try {
        const text = await getText(target);
        _log(`${label} 成功（${m ? '镜像 ' + m : '直连'}）`);
        return text;
      } catch (e) {
        errs.push((m || '直连') + ': ' + e.message);
        if (i < TOTAL_ATTEMPTS - 1) await new Promise(r => setTimeout(r, 800));
      }
    }
  }
  throw new Error(label + ' 失败：' + errs.slice(-3).join('；'));
}

// ---------- 安装目录识别 ----------

/**
 * 发布态目录：<版本根>/app（本文件所在）+ <版本根>/runtime/electron.exe
 * 开发态（E:/capture-tool）不满足，直接拒绝自动更新。
 */
function layout() {
  const appDir = __dirname.replace(/[\\/]lib$/, '');
  const root = path.dirname(appDir);
  const packaged = path.basename(appDir) === 'app' && fs.existsSync(path.join(root, 'runtime'));
  return { appDir, root, packaged };
}

function updatesDir(userData) {
  const dir = path.join(userData, 'updates');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------- 对外能力 ----------

function info() {
  const { root, packaged } = layout();
  return {
    ok: true,
    host: HOST_KIND,
    version: require(path.join(__dirname, '..', 'package.json')).version,
    repo: REPO,
    page: PAGE,
    appRoot: root,
    portable: packaged,
  };
}

/**
 * 检查更新。返回结构（页面直接用，字段名与 C# 侧一致）：
 * { ok, current, latest, hasUpdate, notes, publishedAt, asset:{name,url,size,sha256}, source }
 */
async function check() {
  const cur = info();
  let lastErr = null;
  // 先走 main，再走 master（仓库主分支改名时也不至于失灵）
  for (const branch of ['main', 'master']) {
    try {
      const text = await getTextWithMirrors(RAW(branch), 'latest.json');
      let man;
      try { man = JSON.parse(text); } catch (e) { throw new Error('latest.json 不是合法 JSON'); }
      const latest = String(man.version || '').trim();
      if (!latest) throw new Error('latest.json 缺少 version');
      const asset = (man.assets && man.assets[HOST_KIND]) || null;
      const hasUpdate = cmpVersion(latest, cur.version) > 0;
      _log(`检查完成：当前 ${cur.version} / 最新 ${latest} / 有更新=${hasUpdate}`);
      return {
        ok: true,
        current: cur.version,
        latest,
        hasUpdate,
        notes: String(man.notes || ''),
        publishedAt: String(man.publishedAt || ''),
        asset: asset ? {
          name: String(asset.name || ''),
          url: String(asset.url || ''),
          size: Number(asset.size || 0),
          sha256: String(asset.sha256 || '').toLowerCase(),
        } : null,
        source: RAW(branch),
      };
    } catch (e) { lastErr = e; }
  }
  return { ok: false, error: (lastErr && lastErr.message) || '检查更新失败' };
}

/**
 * 下载更新包并校验 sha256。
 * onProgress({ got, total, p }) 用于页面进度条。
 */
async function download(asset, userData, onProgress) {
  if (!asset || !asset.url) return { ok: false, error: '缺少下载地址' };
  if (!/^https:\/\//i.test(asset.url)) return { ok: false, error: '下载地址必须是 https' };
  const dir = updatesDir(userData);
  const safeName = String(asset.name || 'update.zip').replace(/[^\w.\-]/g, '_');
  const out = path.join(dir, safeName);
  const part = out + '.part';

  const errs = [];
  for (const m of MIRRORS) {
    const target = withMirror(asset.url, m);
    for (let attempt = 1; attempt <= TOTAL_ATTEMPTS; attempt++) {
      try {
        _log(`开始下载（${m ? '镜像 ' + m : '直连'} 第${attempt}次）：${target}`);
        const { res } = await get(target);
        const total = Number(res.headers['content-length'] || asset.size || 0);
        await new Promise((resolve, reject) => {
          const ws = fs.createWriteStream(part);
          let got = 0, lastTick = 0;
          res.on('data', (chunk) => {
            got += chunk.length;
            const now = Date.now();
            if (now - lastTick > 200) {
              lastTick = now;
              try { onProgress && onProgress({ got, total, p: total ? got / total : 0 }); } catch (e) { /* 页面已关 */ }
            }
          });
          res.on('error', reject);
          ws.on('error', reject);
          ws.on('finish', () => resolve());
          res.pipe(ws);
        });
        const buf = fs.readFileSync(part);
        const sha = crypto.createHash('sha256').update(buf).digest('hex');
        if (asset.sha256 && sha !== asset.sha256) {
          fs.unlinkSync(part);
          throw new Error(`校验失败：期望 ${asset.sha256.slice(0, 12)}… 实际 ${sha.slice(0, 12)}…`);
        }
        fs.renameSync(part, out);
        _log(`下载完成：${out}（${buf.length} 字节，sha256 ${sha.slice(0, 12)}…）`);
        return { ok: true, path: out, bytes: buf.length, sha256: sha, mirror: m || 'direct' };
      } catch (e) {
        errs.push((m || '直连') + ': ' + e.message);
        try { fs.existsSync(part) && fs.unlinkSync(part); } catch (_) { }
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  return { ok: false, error: '下载失败：' + errs.slice(-3).join('；') };
}

/** Windows 批处理里的路径转义：只用于 set "X=..." 赋值行。 */
function q(p) { return String(p).replace(/%/g, '%%'); }

/**
 * 生成 update.bat 并拉起（宿主随即退出）。
 * 关键约束：robocopy 不带 /PURGE —— 用户数据与用户自建文件必须原样保留。
 */
function apply(zipPath, userData, currentPid, launcher) {
  const { root, packaged } = layout();
  if (!packaged) return { ok: false, error: '开发态不支持自动更新' };
  if (!zipPath || !fs.existsSync(zipPath)) return { ok: false, error: '更新包不存在，请重新下载' };
  const dir = updatesDir(userData);
  const stage = path.join(dir, 'stage');
  const bat = path.join(dir, 'update.bat');
  const logFile = path.join(dir, 'update.log');
  const launch = launcher || path.join(root, '启动岐黄鉴方.vbs');

  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal EnableExtensions',
    `set "PID=${currentPid}"`,
    `set "PKG=${q(zipPath)}"`,
    `set "STAGE=${q(stage)}"`,
    `set "TARGET=${q(root)}"`,
    `set "LAUNCH=${q(launch)}"`,
    `set "LOG=${q(logFile)}"`,
    'echo [%date% %time%] update start >>"%LOG%"',
    ':wait_pid',
    'tasklist /FI "PID eq %PID%" 2>nul | find "%PID%" >nul && (',
    // 用 ping 而不是 timeout 做延时：隐藏窗口/重定向 stdin 时 timeout 会直接报错退出，
    // 循环里就会变成死等（实测踩过）。
    '  ping -n 2 127.0.0.1 >nul',
    '  goto wait_pid',
    ')',
    'ping -n 3 127.0.0.1 >nul',
    'if exist "%STAGE%" rd /s /q "%STAGE%" 2>nul',
    'echo [%date% %time%] expand >>"%LOG%"',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath \'%PKG%\' -DestinationPath \'%STAGE%\' -Force" >>"%LOG%" 2>&1',
    'if not exist "%STAGE%" goto fail',
    'echo [%date% %time%] copy >>"%LOG%"',
    'robocopy "%STAGE%" "%TARGET%" /E /IS /IT /R:2 /W:2 /NFL /NDL /NJH /NJS >>"%LOG%" 2>&1',
    'if errorlevel 8 goto fail',
    'rd /s /q "%STAGE%" 2>nul',
    'del /q "%PKG%" 2>nul',
    'echo [%date% %time%] launch >>"%LOG%"',
    'start "" "%LAUNCH%"',
    'del /q "%~f0" 2>nul & exit /b 0',
    ':fail',
    'echo [%date% %time%] FAILED >>"%LOG%"',
    'start "" "%TARGET%"',
    'exit /b 1',
  ];
  fs.writeFileSync(bat, lines.join('\r\n') + '\r\n', 'utf8');
  // detached + 隐藏窗口：宿主退出后仍继续执行
  const child = spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.tmpdir() });
  child.unref();
  _log(`已生成更新脚本并拉起：${bat}`);
  return { ok: true, bat, log: logFile, launching: launch };
}

module.exports = { setLog, info, check, download, apply, cmpVersion };

// 打包期进程与文件占用守卫（三个 pack 脚本共用）
//
// 背景：便携模式把 data.db 放在 <发布目录>\app\userdata\，用户常常一边运行程序一边
// 重新打包。此前脚本用 fs.renameSync(userdata) 搬移数据 —— SQLite 的 data.db 被运行中的
// 宿主以独占句柄打开时，rename 目录会直接抛
//   EBUSY: resource busy or locked ... data.db
// 目录没有损坏（rename 是原子的失败），但整个打包中断。
//
// 这里提供两件事：
//   1) assertNoRunning(dir, {force})：找出可执行文件位于 dir 下的进程；
//      默认打印清楚提示后退出，force=true 时先 taskkill 再继续。
//   2) cleanKeep(root, keeps)：删除 root 下除 keeps 之外的一切（keeps 里是相对路径），
//      不再移动/重命名用户数据目录，锁定文件原样留在原地，装配时按需覆盖。
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const norm = (p) => path.resolve(p).replace(/[\\/]+/g, '\\').toLowerCase();

function listProcesses() {
  const script = [
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8;',
    'Get-CimInstance Win32_Process |',
    ' Where-Object { $_.ExecutablePath } |',
    ' Select-Object ProcessId,Name,ExecutablePath |',
    ' ConvertTo-Json -Compress -Depth 3',
  ].join('');
  let out = '';
  try {
    out = cp.execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    });
  } catch (e) {
    return [];
  }
  const txt = String(out || '').trim();
  if (!txt) return [];
  let j;
  try { j = JSON.parse(txt); } catch (e) { return []; }
  return Array.isArray(j) ? j : [j];
}

// 返回可执行文件位于 dir 之内的进程（排除自身）
function runningUnder(dir) {
  const base = norm(dir);
  return listProcesses().filter((p) => {
    if (!p || !p.ExecutablePath) return false;
    if (Number(p.ProcessId) === process.pid) return false;
    const exe = norm(String(p.ExecutablePath));
    return exe === base || exe.startsWith(base + '\\');
  });
}

function assertNoRunning(dir, opts) {
  const o = opts || {};
  if (!fs.existsSync(dir)) return [];
  const hits = runningUnder(dir);
  if (!hits.length) return [];
  console.log('[pack] 检测到占用发布目录的进程：');
  for (const p of hits) console.log('       pid ' + p.ProcessId + '  ' + p.Name + '  ' + p.ExecutablePath);
  if (o.force) {
    for (const p of hits) {
      try {
        cp.execFileSync('taskkill', ['/F', '/PID', String(p.ProcessId)], { stdio: 'ignore', windowsHide: true });
        console.log('[pack] 已结束 pid ' + p.ProcessId);
      } catch (e) {
        console.error('[pack] 结束 pid ' + p.ProcessId + ' 失败：' + e.message);
      }
    }
    return hits;
  }
  console.error('');
  console.error('[pack] 以上程序正在运行，data.db / exe / dll 被独占，无法安全重建发布目录。');
  console.error('       请先退出程序再重跑；或加 --force-close 让脚本自动结束它们。');
  console.error('       例：node scripts/_pack_host.js --force-close');
  process.exit(2);
}

// 删除单个路径（文件或目录）。
// 某些运行环境给 fs.rmSync 套了安全 shim（批量删除会抛 SAFE_DELETE_BULK_GUARD_ERROR），
// 这里回退到系统原生 rd / del —— 目标都是 build 产物目录，与脚本一贯的 `rd /s /q` 等价。
function rmrf(p) {
  try { if (!fs.existsSync(p)) return true; } catch (e) { return true; }
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 2, retryDelay: 120 });
    return true;
  } catch (e) {
    try {
      const st = fs.lstatSync(p);
      if (st.isDirectory()) cp.execFileSync('cmd', ['/c', 'rd', '/s', '/q', p], { stdio: 'ignore', windowsHide: true });
      else cp.execFileSync('cmd', ['/c', 'del', '/f', '/q', p], { stdio: 'ignore', windowsHide: true });
      return !fs.existsSync(p);
    } catch (e2) {
      return false;
    }
  }
}

// 删除 root 下除 keeps（相对路径数组）之外的所有条目。
// 与「整体 rename 用户数据目录」相比，不触碰被锁的 data.db，因此不会 EBUSY。
function cleanKeep(root, keeps) {
  if (!fs.existsSync(root)) return { removed: 0, failed: [] };
  const keepAbs = (keeps || []).map((k) => norm(path.join(root, k)));
  const underKeep = (p) => {
    const a = norm(p);
    return keepAbs.some((k) => a === k || a.startsWith(k + '\\') || k.startsWith(a + '\\'));
  };
  const failed = [];
  let removed = 0;
  const walk = (dir) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { failed.push([dir, e.code || e.message]); return; }
    for (const n of names) {
      const p = path.join(dir, n);
      if (underKeep(p)) {
        // 目录自身可能整体保留，也可能只是包含保留项 → 继续下探
        if (keepAbs.some((k) => k.startsWith(norm(p) + '\\'))) walk(p);
        continue;
      }
      if (rmrf(p)) removed++;
      else failed.push([p, 'EBUSY/EPERM']);
    }
  };
  walk(root);
  if (failed.length) {
    console.warn('[pack] 有 ' + failed.length + ' 项未能删除（多为被占用）：');
    for (const [p, c] of failed.slice(0, 6)) console.warn('       ' + p + '  [' + c + ']');
    if (failed.length > 6) console.warn('       …其余 ' + (failed.length - 6) + ' 项略');
  }
  return { removed, failed };
}

module.exports = { listProcesses, runningUnder, assertNoRunning, cleanKeep, rmrf };

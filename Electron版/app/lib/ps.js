// lib/ps.js - 统一封装 PowerShell 脚本调用
const { spawn } = require('child_process');
const path = require('path');

const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

/**
 * 运行一个 ps1 脚本，解析 stdout 的 JSON。
 * @param {string} scriptName ps1 文件名
 * @param {Object} args 具名参数（会被转为 -X val）
 * @param {number} timeoutMs
 * @returns {Promise<any>} JSON 解析结果
 */
function runPs(scriptName, args = {}, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    const psArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
    for (const [k, v] of Object.entries(args)) {
      psArgs.push(`-${k}`);
      psArgs.push(String(v));
    }
    const child = spawn('powershell.exe', psArgs, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: SCRIPTS_DIR
    });
    let out = '', err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`[${scriptName}] timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      const trimmed = out.trim();
      if (!trimmed) {
        reject(new Error(`[${scriptName}] no output (exit ${code}) stderr=${err.slice(0, 500)}`));
        return;
      }
      try {
        resolve(JSON.parse(trimmed));
      } catch (e) {
        reject(new Error(`[${scriptName}] bad json (exit ${code}): ${trimmed.slice(0, 300)} stderr=${err.slice(0, 300)}`));
      }
    });
  });
}

module.exports = { runPs, SCRIPTS_DIR };

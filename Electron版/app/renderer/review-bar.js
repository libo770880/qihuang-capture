/* 人工复核条 —— panel.html（记录详情）与 consult.html（辨证咨询结果弹窗）共用的唯一实现源。
 *
 * 背景：机器核查给出「已核查·有提示」时，需要药师人工裁定：
 *   通过 → 打「已存档」标记，默认列表隐去；驳回 → 红标留痕，记录留在列表待修改；均可撤销/改判。
 * 数据落在记录的 review 字段（panel:patch 白名单第三字段），两侧页面共用同一份 data.db。
 *
 * 用法（宿主页面）：
 *   ReviewBar.mount({ get, patch, toast, applied, rerender });   // 绑一次即可
 *   渲染：容器.innerHTML = ReviewBar.html(rec) + 内容;  ReviewBar.bind();
 * HTML 内联 onclick 用的是 mount 时挂到 window 的 rvSet / rvClear / rvAsk / rvCancel。
 *
 * 纯函数（印章/列表/统计共用，口径必须与印章 reviewSeal 一致）：
 *   sealCounts(r) / sealCls(r) / isAnalyzed(r) / reviewOf(r) / rvTime(rv)
 *
 * UMD：浏览器挂 window.ReviewBar；Node 下 module.exports（便于探针/单测直接引）。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReviewBar = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // ===== 样式：随模块注入，两个页面不各存一份（改一处即全站生效） =====
  // 变量取值带兜底：consult.html 的 :root 未定义 --soft / --card2。
  var CSS = [
    '.rvbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-left:3px solid var(--amber);border-radius:10px;padding:9px 14px;margin:0 0 12px;font-size:12.5px;color:var(--deep)}',
    '.rvbar .rvt{font-weight:700;letter-spacing:.5px}',
    '.rvbar .rvs{font-size:11.5px;color:var(--mut)}',
    '.rvbar .rvn{font-size:11.5px;color:var(--mut);background:var(--soft,#e7f1eb);border:1px solid var(--line);border-radius:6px;padding:1px 8px;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.rvbar .sp{flex:1;min-width:8px}',
    '.rvbar.pass{border-left-color:#17734a;background:#f4faf4}',
    '.rvbar.rej{border-left-color:#c53f33;background:#fdf6f5}',
    '.rvbar button{border:1px solid var(--line);background:var(--card);border-radius:7px;padding:4px 12px;font-size:12px;cursor:pointer;color:var(--deep);font-family:inherit;white-space:nowrap}',
    '.rvbar button:hover{border-color:#7cc49a;color:var(--green)}',
    '.rvbar button.ok{border-color:#8fd0a8;background:#e2f2e4;color:#16674a;font-weight:600}',
    '.rvbar button.ok:hover{background:#d3ebd6}',
    '.rvbar button.no{border-color:#f5cac5;background:#fbe4e1;color:#bf3a2f;font-weight:600}',
    '.rvbar button.no:hover{background:#f7d6d1}',
    '.rvbar .rvinput{flex:1;min-width:170px;border:1px solid var(--line);border-radius:7px;padding:4px 9px;font-size:12px;font-family:inherit;background:var(--card2,#f8fbfa);color:var(--ink);outline:none}',
    '.rvbar .rvinput:focus{border-color:#d8a49f}',
    'body.dark .rvbar{background:var(--card);color:var(--deep)}',
    'body.dark .rvbar.pass{background:#1d2a1d;border-left-color:#4e8a5c}',
    'body.dark .rvbar.rej{background:#2a1e1d;border-left-color:#a8544a}',
    'body.dark .rvbar button{background:var(--card2,#f8fbfa);border-color:var(--line);color:var(--deep)}',
    'body.dark .rvbar button.ok{background:#25402a;border-color:#3f6a48;color:#a8dcb4}',
    'body.dark .rvbar button.no{background:#3a2320;border-color:#6b3a33;color:#f0a79c}',
    'body.dark .rvbar .rvinput{background:var(--card2,#f8fbfa);border-color:var(--line);color:var(--ink)}'
  ].join('\n');

  function ensureCss() {
    if (typeof document === 'undefined') return;
    var el = document.getElementById('rvbar-css');
    if (!el) {
      el = document.createElement('style');
      el.id = 'rvbar-css';
      document.head.appendChild(el);
      el.textContent = CSS;
    }
  }

  // ===== 纯函数：印章与复核条共用同一口径 =====
  function isAnalyzed(r) { return !!(r && (r.compliance || r.tcm)); }

  // 审方印章 / 人工复核条共用的计数口径（错误数、提示数）
  function sealCounts(r) {
    var bad = 0, warn = 0;
    var c = r && r.compliance; if (c && c.hasRecord) { bad += c.errorN || 0; warn += c.warnN || 0; }
    var t = r && r.tcm; if (t && t.rx) { bad += t.rx.errorN || 0; warn += t.rx.warnN || 0; }
    if (t && t.diagCheck) { if (t.diagCheck.level === 'weak') bad++; else if (t.diagCheck.level === 'partial') warn++; }
    ((t && t.chosen) || []).forEach(function (x) { if (x && (x.okSynd === false || x.okDiag === false)) bad++; });
    return { bad: bad, warn: warn };
  }
  // 与 reviewSeal 同口径的简化判定
  function sealCls(r) {
    var c = sealCounts(r);
    if (c.bad > 0) return 'bad';
    if (!(r.tcm && r.tcm.rx)) return 'idle';
    if (c.warn > 0) return 'warn';
    return 'ok';
  }
  // 人工复核裁定：pass 通过并存档 / reject 驳回留痕 / 无裁定
  function reviewOf(r) {
    var v = r && r.review;
    return (v && typeof v === 'object' && (v.status === 'pass' || v.status === 'reject')) ? v : null;
  }
  function rvTime(rv) {
    var d = new Date((rv && rv.at) || Date.now());
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ===== 状态机 =====
  var pending = null;   // 待填驳回原因的记录 id
  var H = null;         // 宿主回调

  function cur() { return (H && H.get) ? H.get() : null; }
  function say(m) { if (H && H.toast) H.toast(m); }

  function html(r) {
    ensureCss();
    if (!r || !isAnalyzed(r)) return '';
    var rv = reviewOf(r);
    if (!rv && sealCls(r) !== 'warn') return '';   // 只有「已核查·有提示」需要人工裁定
    if (rv && rv.status === 'pass')
      return '<div class="rvbar pass"><span class="rvt">✓ 已通过</span>'
        + '<span class="rvs">已存档 · ' + rvTime(rv) + ' · 本条已从默认列表隐去，可在记录面板侧栏「已存档」查看</span>'
        + '<div class="sp"></div>'
        + '<button onclick="rvSet(\'reject\')">改为驳回</button><button onclick="rvClear()">撤销裁定</button></div>';
    if (rv && rv.status === 'reject')
      return '<div class="rvbar rej"><span class="rvt">✕ 已驳回</span>'
        + (rv.note ? '<span class="rvn" title="' + esc(rv.note) + '">原因：' + esc(rv.note) + '</span>' : '')
        + '<span class="rvs">' + rvTime(rv) + ' · 记录留在列表中待修改</span>'
        + '<div class="sp"></div>'
        + '<button class="ok" onclick="rvSet(\'pass\')">改为通过并存档</button><button onclick="rvClear()">撤销裁定</button></div>';
    if (pending === r.id)
      return '<div class="rvbar rej"><span class="rvt">驳回本条</span>'
        + '<input class="rvinput" id="rvNote" maxlength="60" placeholder="驳回原因（可留空，便于日后追溯）" onkeydown="if(event.key===\'Enter\')rvSet(\'reject\')">'
        + '<button class="no" onclick="rvSet(\'reject\')">确认驳回</button>'
        + '<button onclick="rvCancel()">取消</button></div>';
    var warn = sealCounts(r).warn;
    return '<div class="rvbar"><span class="rvt">人工复核</span>'
      + '<span class="rvs">机器核查：合规通过 · ' + warn + ' 项提示待裁定</span>'
      + '<div class="sp"></div>'
      + '<button class="ok" onclick="rvSet(\'pass\')">✓ 通过并存档</button>'
      + '<button class="no" onclick="rvAsk()">✕ 驳回</button></div>';
  }

  // 容器重渲染后调用：驳回原因输入框自动聚焦（Enter 即提交）
  function bind() {
    if (typeof document === 'undefined') return;
    var el = document.getElementById('rvNote');
    if (el && pending) { try { el.focus(); } catch (e) { } }
  }

  function ask() { var r = cur(); if (!r) return; pending = r.id; if (H) H.rerender(); }
  function cancel() { pending = null; if (H) H.rerender(); }

  // 裁定后统一：写库 → 同步宿主内存 → 重渲染 → 提示
  function after(id, rv) { pending = null; if (H && H.applied) H.applied(id, rv); if (H) H.rerender(); }

  function set(st) {
    var r = cur();
    if (!r || !H) return;
    var note = '';
    if (st === 'reject' && typeof document !== 'undefined') {
      var el = document.getElementById('rvNote');
      note = el && el.value ? el.value.trim() : '';
    }
    var p;
    try { p = Promise.resolve(H.patch(r.id, { review: { status: st, note: note } })); }
    catch (e) { say('复核失败：' + ((e && e.message) || e)); return Promise.resolve(); }
    return p.then(function (res) {
      if (!res || !res.ok) { say('复核失败：' + ((res && res.error) || '未知')); return; }
      var rv = (res.rec && res.rec.review) || { status: st, note: note, at: new Date().toISOString() };
      after(r.id, rv);
      say(st === 'pass' ? '已通过并存档' : '已驳回，记录留在列表中待修改');
    }).catch(function (e) { say('复核失败：' + ((e && e.message) || e)); });
  }

  function clear() {
    var r = cur();
    if (!r || !H) return Promise.resolve();
    var p;
    try { p = Promise.resolve(H.patch(r.id, { review: null })); }
    catch (e) { say('撤销失败：' + ((e && e.message) || e)); return Promise.resolve(); }
    return p.then(function (res) {
      if (!res || !res.ok) { say('撤销失败：' + ((res && res.error) || '未知')); return; }
      after(r.id, null);
      say('裁定已撤销');
    }).catch(function (e) { say('撤销失败：' + ((e && e.message) || e)); });
  }

  /* mount(handlers)
   *   get()      → 当前记录（panel 为详情记录，consult 为带进来的那条）
   *   patch(id,p)→ Promise，落库（window.qhjf.patchRecord）
   *   toast(msg) → 轻提示
   *   applied(id,rv) → 落库成功后同步宿主内存里的记录（rv 为 null 表示撤销）
   *   rerender() → 重渲染宿主容器（panel：详情+列表；consult：结果弹窗）
   */
  function mount(h) {
    H = h || {};
    ensureCss();
    if (typeof window !== 'undefined') {
      window.rvSet = set; window.rvClear = clear; window.rvAsk = ask; window.rvCancel = cancel;
    }
  }

  return {
    mount: mount, html: html, bind: bind, set: set, clear: clear, ask: ask, cancel: cancel,
    isAnalyzed: isAnalyzed, sealCounts: sealCounts, sealCls: sealCls, reviewOf: reviewOf, rvTime: rvTime,
    get pending() { return pending; },
    reset: function () { pending = null; }
  };
});

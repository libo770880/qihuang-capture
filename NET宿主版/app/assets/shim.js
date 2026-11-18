/* shim.js —— WebView2 桥接层（宿主在每次页面脚本执行前注入）
 *
 * 作用：在 WebView2 中精确复刻 Electron preload.js 暴露的 window.qhjf 契约，
 *       使 renderer/*.html 与 renderer/*.js 无需任何改动即可运行。
 *
 * 协议（页面 ⇄ 宿主，走 chrome.webview.postMessage）：
 *   页面 → 宿主   { c: channel, a: [args...], r: reqId }     调用
 *   宿主 → 页面   { r: reqId, ok: true, v: value }           应答成功
 *   宿主 → 页面   { r: reqId, ok: false, e: message }        应答失败
 *   宿主 → 页面   { ev: channel, v: payload }                主动事件
 *
 * 与 preload 的语义对齐：invoke → Promise；send → 不等待（吞掉错误）；
 *                        on* → 事件订阅（返回取消函数）。
 */
(function () {
  'use strict';
  if (window.qhjf) return; // 幂等
  var wv = window.chrome && window.chrome.webview;
  if (!wv) { console.error('[shim] 未检测到 WebView2 宿主，window.qhjf 不可用'); return; }

  var seq = 0;
  var pending = Object.create(null);
  var events = Object.create(null);

  wv.addEventListener('message', function (ev) {
    var m = ev.data;
    if (!m || typeof m !== 'object') return;
    // 1) 调用应答
    if (m.r !== undefined) {
      var p = pending[m.r];
      if (!p) return;
      delete pending[m.r];
      if (m.ok) p.resolve(m.v);
      else p.reject(new Error(m.e || 'invoke failed'));
      return;
    }
    // 2) 宿主主动事件
    if (m.ev) {
      var arr = events[m.ev];
      if (!arr) return;
      for (var i = 0; i < arr.length; i++) {
        try { arr[i](m.v); } catch (e) { console.error('[shim] 事件处理异常 ' + m.ev, e); }
      }
    }
  });

  function invoke(channel) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      wv.postMessage({ c: channel, a: args, r: id });
    });
  }
  // send 语义：不等待结果，异常静默（对应 ipcRenderer.send）
  function send(channel) {
    var args = Array.prototype.slice.call(arguments, 1);
    invoke.apply(null, [channel].concat(args)).catch(function () { /* 静默 */ });
  }
  function listen(channel) {
    return function (fn) {
      if (typeof fn !== 'function') return function () {};
      (events[channel] || (events[channel] = [])).push(fn);
      return function () { // 取消订阅
        var a = events[channel]; if (!a) return;
        var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
      };
    };
  }

  window.qhjf = {
    // ---------- 悬浮球 ----------
    captureClipboard: function () { return invoke('ball:capture-clipboard'); },
    openPasteBox: function () { return invoke('ball:open-paste'); },
    pasteSubmit: function (t) { return invoke('paste:submit', t); },
    pasteSegment: function (t) { return invoke('paste:segment', t); },
    pasteClose: function () { return send('paste:close'); },
    openPanel: function () { return invoke('ball:open-panel'); },
    openSearch: function () { return invoke('ball:open-search'); },
    openAi: function () { return invoke('ball:open-ai'); },
    openConsult: function (id) { return invoke(id ? 'panel:open-consult' : 'ball:open-consult', id); },
    startRegion: function () { return invoke('ball:region'); },
    startScreentext: function () { return invoke('ball:screentext'); },
    onPastePrefill: listen('paste:prefill'),
    onPasteHint: listen('paste:hint'),
    onPasteProgress: listen('paste:progress'),
    clipboardRead: function () { return invoke('clipboard:read'); },
    clipboardWrite: function (t) { return invoke('clipboard:write', t); },
    quit: function () { return send('ball:quit'); },
    moveBall: function (pos) { return send('ball:move', pos); },
    ballDragStart: function () { return send('ball:drag-start'); },
    ballDragEnd: function () { return send('ball:drag-end'); },
    setBallExpanded: function (expanded) { return send('ball:set-size', !!expanded); },

    // ---------- 框选遮罩 ----------
    overlaySelected: function (rect, withAnno, opts) { return invoke('overlay:selected', rect, !!withAnno, opts || null); },
    overlayCancel: function () { return invoke('overlay:cancel'); },
    overlayHerbInfo: function (img) { return invoke('overlay:herb-info', { img: String(img || '') }); },
    onStrip: listen('overlay:strip'),
    onOverlayBg: listen('overlay:bg'),

    // ---------- 记录面板 ----------
    panelCaptureClipboard: function () { return invoke('panel:capture-clipboard'); },
    panelStartRegion: function () { return invoke('panel:start-region'); },
    photoOpen: function () { return invoke('photo:open'); },
    photoSubmit: function (dataUrl) { return invoke('photo:submit', dataUrl); },
    listRecords: function () { return invoke('panel:list'); },
    getRecord: function (id) { return invoke('panel:get', id); },
    removeRecord: function (id) { return invoke('panel:remove', id); },
    recordAnalyze: function (id, diag, synd, force, reason) { return invoke('record:analyze', { id: id, diag: diag, synd: synd, force: force, reason: reason }); },
    recordAddRx: function (id, rxText) { return invoke('record:addRx', { id: id, rxText: rxText }); },
    recordSetRx: function (id, text, usage) { return invoke('record:setRx', { id: id, text: text, usage: usage }); },
    recordSetUsage: function (id, usage) { return invoke('record:set-usage', { id: id, usage: usage }); },
    openImage: function (p) { return invoke('panel:openImage', p); },
    openRecordsDir: function () { return invoke('panel:openDir'); },
    exportRecord: function (id) { return invoke('panel:exportRecord', id); },
    patchRecord: function (id, patch) { return invoke('panel:patch', { id: id, patch: patch }); },
    exportRecordsTxt: function (ids) { return invoke('panel:exportTxt', ids); },
    seedDemo: function () { return invoke('panel:seedDemo'); },
    clearRecords: function () { return invoke('records:clear'); },
    version: function () { return invoke('app:version'); },
    // ---------- 软件更新（GitHub Releases） ----------
    updateInfo: function () { return invoke('update:info'); },
    updateCheck: function () { return invoke('update:check'); },
    updateDownload: function (asset) { return invoke('update:download', asset || null); },
    updateApply: function (zipPath) { return invoke('update:apply', { zipPath: String(zipPath || '') }); },
    onUpdateProgress: listen('update:progress'),
    onCaptureResult: listen('capture:result'),
    onPanelRefresh: listen('panel:refresh'),
    onCapProgress: listen('cap:progress'),
    onAiProgress: listen('ai:progress'),

    // ---------- 知识库后台 ----------
    openAdmin: function () { return invoke('admin:open'); },
    kbStats: function () { return invoke('kb:stats'); },
    kbListAll: function () { return invoke('kb:list-all'); },
    kbList: function (kind) { return invoke('kb:list', kind); },
    kbUpsert: function (kind, obj) { return invoke('kb:upsert', kind, obj); },
    kbRemove: function (kind, name) { return invoke('kb:remove', kind, name); },
    kbImport: function (kind, arr) { return invoke('kb:import', kind, arr); },
    xlsxImport: function (target) { return invoke('kb:xlsx-import', target); },
    xlsxTemplate: function (target) { return invoke('kb:xlsx-template', target); },
    kbPickImport: function (kind) { return invoke('kb:pick-import', kind); },
    kbOpenDir: function () { return invoke('kb:open-dir'); },

    // ---------- 辨证库（诊断证型 + 症状） ----------
    clinicalStats: function () { return invoke('kb:clinical-stats'); },
    clinicalList: function (kind) { return invoke('kb:clinical-list', kind); },
    clinicalUpsert: function (kind, obj) { return invoke('kb:clinical-upsert', kind, obj); },
    clinicalRemove: function (kind, name) { return invoke('kb:clinical-remove', kind, name); },
    clinicalImport: function (kind, arr) { return invoke('kb:clinical-import', kind, arr); },
    clinicalPickImport: function (kind) { return invoke('kb:clinical-pick-import', kind); },
    // 兼容别名（admin 辨证页签历史命名）
    kbClinicalStats: function () { return invoke('kb:clinical-stats'); },
    kbClinicalList: function (kind) { return invoke('kb:clinical-list', kind); },
    kbClinicalUpsert: function (kind, obj) { return invoke('kb:clinical-upsert', kind, obj); },
    kbClinicalRemove: function (kind, name) { return invoke('kb:clinical-remove', kind, name); },
    kbClinicalImport: function (kind, arr) { return invoke('kb:clinical-import', kind, arr); },
    kbClinicalPickImport: function (kind) { return invoke('kb:clinical-pick-import', kind); },
    consultData: function () { return invoke('kb:consult-data'); },
    consultCtx: function () { return invoke('consult:ctx'); },
    clearConsultCtx: function () { return invoke('consult:clear-ctx'); },
    onConsultCtx: listen('consult-ctx'),

    // ---------- OCR 文字纠错自定义表 ----------
    ocrFixList: function () { return invoke('kb:ocr-list'); },
    ocrFixUpsert: function (obj) { return invoke('kb:ocr-upsert', obj); },
    ocrFixRemove: function (w) { return invoke('kb:ocr-remove', w); },
    ocrFixTest: function (text) { return invoke('kb:ocr-test', text); },

    // ---------- 配伍禁忌规则库 ----------
    sbfList: function () { return invoke('kb:sbf-list'); },
    sbfAdd: function (rule) { return invoke('kb:sbf-add', rule); },
    sbfDel: function (id) { return invoke('kb:sbf-del', id); },

    // ---------- 中药医保规则库 ----------
    ybList: function () { return invoke('kb:yibao-list'); },
    ybFull: function () { return invoke('kb:yibao-full'); },
    ybExport: function () { return invoke('kb:yibao-export'); },
    ybAdd: function (rule) { return invoke('kb:yibao-add', rule); },
    ybDel: function (id) { return invoke('kb:yibao-del', id); },
    unmList: function () { return invoke('kb:unm-list'); },
    unmDel: function (id) { return invoke('kb:unm-del', id); },
    unmIgnore: function (id) { return invoke('kb:unm-ignore', id); },
    unmAi: function (onlyId) { return invoke('kb:unm-ai', onlyId); },

    // ---------- 国家标准库 GB/T 15657-2021 ----------
    gbtStats: function () { return invoke('gbt:stats'); },
    gbtSearch: function (kind, q, l1) { return invoke('gbt:search', { kind: kind, q: q, l1: l1 }); },
    gbtMatchDiag: function () { return invoke('gbt:match-diag'); },

    // ---------- 医保编码对照库（国临版 ↔ 医保版2.0） ----------
    icdStats: function () { return invoke('icd:stats'); },
    icdSearch: function (q, mode) { return invoke('icd:search', { q: q, mode: mode }); },
    icdLookupName: function (name) { return invoke('icd:lookup-name', name); },

    // ---------- 参照库 ----------
    refInfo: function () { return invoke('ref:info'); },
    refSync: function () { return invoke('ref:sync'); },

    // ---------- 西医诊断 → 中医诊断候选 ----------
    westCandidates: function (west) { return invoke('tcm:west-candidates', west); },

    // ---------- AI 智能层 ----------
    aiConfigGet: function () { return invoke('ai:config-get'); },
    aiConfigSet: function (patch) { return invoke('ai:config-set', patch); },
    backupExport: function () { return invoke('backup:export'); },
    backupImport: function () { return invoke('backup:import'); },
    backupMirrorInfo: function () { return invoke('backup:mirror-info'); },
    backupMirrorNow: function () { return invoke('backup:mirror-now'); },
    // 处方点评（后台管理）
    rxReview: function (p) { return invoke('rx:review', p || {}); },
    rxBatch: function (p) { return invoke('rx:batch', p || {}); },
    rxExport: function (p) { return invoke('rx:export', p || {}); },
    rxRuleGet: function () { return invoke('rxrule:get'); },
    rxRuleSet: function (p) { return invoke('rxrule:set', p || {}); },
    rxRuleReset: function () { return invoke('rxrule:reset'); },
    stripSuggest: function (text, existing) { return invoke('admin:strip-suggest', { text: text, existing: existing }); },
    stripFromImage: function (dataUrl, opts) { return invoke('admin:strip-from-image', { dataUrl: dataUrl, opts: opts }); },
    dataInfo: function () { return invoke('data:info'); },
    dataRelocate: function () { return invoke('data:relocate'); },
    // 配置搬家（全部设置已在 data.db，单文件即全量）
    dataAudit: function () { return invoke('data:audit'); },
    dataExportConfig: function () { return invoke('data:export-config'); },
    dataExportDb: function () { return invoke('data:export-db'); },
    dataImportConfig: function () { return invoke('data:import-config'); },
    // 界面偏好（主题 / 侧栏 / 导航折叠）：存 kv，随 data.db 搬家
    uiPrefsGet: function () { return invoke('ui:prefs-get'); },
    uiPrefsSet: function (p) { return invoke('ui:prefs-set', p || {}); },
    aiTest: function () { return invoke('ai:test'); },
    aiTestModel: function (id) { return invoke('ai:test-model', id); },
    aiRun: function (kind, payload) { return invoke('ai:run', { kind: kind, payload: payload }); },
    ocrStatus: function (opts) { return invoke('ocr:status', opts); },
    ocrConfigGet: function () { return invoke('ocr:config-get'); },
    ocrConfigSet: function (patch) { return invoke('ocr:config-set', patch); },
    ocrEnvInstall: function () { return invoke('ocr:env-install'); },
    onOcrEnvInstallProgress: listen('ocr-env-install-progress'),

    // ---------- HIS 接口（双向 REST JSON：拉取患者/医嘱 + 回写审方结论） ----------

    // ---------- 基础信息维护（系统设置） ----------
    sysGet: function () { return invoke('sys:get'); },
    sysSetApp: function (patch) { return invoke('sys:set-app', patch); },
    sysSetAdmin: function (p) { return invoke('sys:set-admin', p); },
    sysClearAdmin: function (p) { return invoke('sys:clear-admin', p); },
    sysDeptsSet: function (list) { return invoke('sys:depts-set', list); },
    sysUsersList: function () { return invoke('sys:users-list'); },
    sysUserUpsert: function (u) { return invoke('sys:user-upsert', u); },
    sysUserRemove: function (user) { return invoke('sys:user-remove', user); },
    sysLogin: function (scope, user, pass) { return invoke('sys:login', { scope: scope, user: user, pass: pass }); },
    sysBackup: function (dir) { return invoke('sys:backup', dir); },
    sysLogsGet: function (n) { return invoke('sys:logs-get', n); },
    sysLogsOpen: function () { return invoke('sys:logs-open'); },
    sysDataOpen: function () { return invoke('sys:data-open'); },
    sysOpenUrl: function (url) { return invoke('sys:open-url', url); }
  };

  console.log('[shim] window.qhjf 已就绪（WebView2 桥接）');

  // ---------- 无边框窗口拖拽区（对应 Electron 的 -webkit-app-region 命中） ----------
  // WebView2 不实现 app-region 的窗口命中测试：renderer 里 -webkit-app-region:drag
  // 的标题栏在 Electron 原生可拖，在这里动不了（pastebox/photo 的实际缺陷）。
  // 监听按下/双击，自 target 沿父链判定命中——与 Chromium 语义一致：先遇 no-drag
  // 不放行（标题栏上的最小化/关闭按钮），先遇 drag 命中——转发宿主执行
  // DragMove / 最大化切换（WindowManager 的 win:drag / win:drag-dbl）。
  function appRegionOf(el) {
    try {
      var cs = getComputedStyle(el);
      return (cs.getPropertyValue('-webkit-app-region') || cs.webkitAppRegion || '').trim();
    } catch (_) { return ''; }
  }
  function inDragRegion(t) {
    for (var el = t; el && el !== document.documentElement; el = el.parentElement) {
      var r = appRegionOf(el);
      if (r === 'no-drag') return false;
      if (r === 'drag') return true;
    }
    return false;
  }
  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || !inDragRegion(e.target)) return;
    wv.postMessage({ c: 'win:drag', a: [] });  // 无 r：宿主无需应答
  }, true);
  document.addEventListener('dblclick', function (e) {
    if (!inDragRegion(e.target)) return;
    wv.postMessage({ c: 'win:drag-dbl', a: [] });
  }, true);
})();

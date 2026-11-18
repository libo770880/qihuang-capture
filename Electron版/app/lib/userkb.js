// lib/userkb.js - 用户知识库（后台导入/编辑的中药与方剂数据）
// 独立于内置 kb.js：数据存于 SQLite data.db 的 kb_items 表（kind=herb/formula/ocrfix/sbf/yibao/unmatched）
// 任何增删改/导入都会：落库 → KB.setUserData 合并 → tcm.invalidateCache 热刷新引擎。
// 另管理 OCR 文字纠错自定义表（条目 {w:错字名, r:正确名}）。
const fs = require('fs');
const path = require('path');
const DB = require('./db');
const KB = require('./kb');
const TCM = require('./tcm');

const KIND_HERB = 'herb';
const KIND_FORMULA = 'formula';
const KIND_OCRFIX = 'ocrfix';

function initUserKb(userDataDir) {
  const dir = path.join(userDataDir, 'knowledge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const herbFile = path.join(dir, 'herbs.json');       // .json 路径仅为兼容旧 files 导出/迁移映射
  const formulaFile = path.join(dir, 'formulas.json');
  const ocrFixFile = path.join(dir, 'ocrfixes.json');
  const sbfFile = path.join(dir, 'shibafan.json');
  const yibaoFile = path.join(dir, 'yibao.json');
  const unmatchedFile = path.join(dir, 'unmatched.json');

  // 落盘层：旧 JSON 文件路径 → SQLite kb_items kind（db.migrateJson 首启已把旧数据迁入）
  const KIND_BY_FILE = new Map([
    [herbFile, KIND_HERB], [formulaFile, KIND_FORMULA], [ocrFixFile, 'ocrfix'],
    [sbfFile, 'sbf'], [yibaoFile, 'yibao'], [unmatchedFile, 'unmatched'],
  ]);
  function readFile(f) {
    const kind = KIND_BY_FILE.get(f);
    return kind ? DB.kbLoad(kind) : [];
  }
  function writeFile(f, arr) {
    const kind = KIND_BY_FILE.get(f);
    if (kind) DB.kbSave(kind, arr);
  }

  let herbs = readFile(herbFile);
  let formulas = readFile(formulaFile);
  let ocrFixes = readFile(ocrFixFile); // [{w, r}]
  let sbfRules = readFile(sbfFile);    // [{a:'药、药', b:'药、药', v:'备注', kind:'十八反'|'十九畏'}]
  let yibaoRules = readFile(yibaoFile); // [{id, name:'药名', code:'医保编码', payType:'甲类|乙类|丙类|自费', limit:'限定支付范围', copay:'自付比例%', note}]
  // 首次使用种子化：yibao 为空时按内置规则库生成（已有数据不覆盖，后台可改）
  if (yibaoRules.length === 0) {
    try {
      const { buildSeedRows } = require('./yibao-seed');
      const names = [...new Set(KB.getAllHerbs().map(h => h.n).filter(Boolean))];
      yibaoRules = buildSeedRows(names).map((r, i) => ({ id: 'yb-seed-' + i, ...r }));
      writeFile(yibaoFile, yibaoRules);
    } catch (e) { /* 种子失败不阻断启动 */ }
  }

  // 合并到引擎知识库并热刷新
  function refresh() {
    KB.setUserData({ herbs, formulas });
    KB.setOcrFixes(ocrFixes);
    KB.setIncompatRules(sbfRules);
    TCM.setYibaoRules(yibaoRules);
    TCM.invalidateCache();
  }

  function stats() {
    const all = listAll();
    return {
      dir,
      herbCount: herbs.length,
      formulaCount: formulas.length,
      herbBuiltin: all.herbs.filter(h => !h.user).length,
      herbUser: all.herbs.filter(h => h.user).length,
      formulaBuiltin: all.formulas.filter(f => !f.user).length,
      formulaUser: all.formulas.filter(f => f.user).length
    };
  }

  function list(kind) {
    return kind === KIND_HERB ? herbs.slice() : formulas.slice();
  }
  function listAll() {
    // 完整合库（含来源标记），供后台列表使用
    return {
      herbs: KB.getAllHerbs(),
      formulas: KB.getAllFormulas()
    };
  }

  function upsert(kind, obj) {
    if (!obj || !obj.name) return { ok: false, error: '缺少 name 字段' };
    const arr = kind === KIND_HERB ? herbs : formulas;
    const idx = arr.findIndex(x => x.name === obj.name);
    const isNew = idx < 0;
    if (isNew) arr.push(obj); else arr[idx] = { ...arr[idx], ...obj };
    persist();
    return { ok: true, isNew, name: obj.name };
  }

  function remove(kind, name) {
    const arr = kind === KIND_HERB ? herbs : formulas;
    const before = arr.length;
    const out = arr.filter(x => x.name !== name);
    if (out.length === before) return { ok: false, error: '未找到' };
    if (kind === KIND_HERB) herbs = out; else formulas = out;
    persist();
    return { ok: true, name };
  }

  // 清空某类用户数据（恢复纯内置）
  function clear(kind) {
    if (kind === KIND_HERB) herbs = []; else formulas = [];
    persist();
    return { ok: true };
  }

  // 批量导入：arr 为原始对象数组（宽松字段名由 kb.norm 归一）
  // 同名 → 覆盖（更新），不同名 → 新增
  function importBatch(kind, arr) {
    if (!Array.isArray(arr)) return { ok: false, error: '数据格式错误：应为 JSON 数组' };
    let added = 0, updated = 0, skipped = 0;
    const target = kind === KIND_HERB ? herbs : formulas;
    const map = new Map(target.map(x => [x.name, x]));
    for (const raw of arr) {
      if (!raw || !raw.name) { skipped++; continue; }
      if (map.has(raw.name)) {
        const old = map.get(raw.name);
        map.set(raw.name, { ...old, ...raw });
        updated++;
      } else {
        map.set(raw.name, raw);
        added++;
      }
    }
    const merged = [...map.values()];
    if (kind === KIND_HERB) herbs = merged; else formulas = merged;
    persist();
    return { ok: true, added, updated, skipped, total: merged.length };
  }

  function persist() {
    writeFile(herbFile, herbs);
    writeFile(formulaFile, formulas);
    refresh();
  }

  // ===== OCR 文字纠错自定义表 =====
  function ocrList() {
    return ocrFixes.map(x => ({ w: String(x.w || '').trim(), r: String(x.r || '').trim() })).filter(x => x.w && x.r);
  }
  function ocrUpsert({ w, r }) {
    w = String(w || '').trim(); r = String(r || '').trim();
    if (!w || !r) return { ok: false, error: '错字名与正确名均不能为空' };
    if (w === r) return { ok: false, error: '错字名与正确名不能相同' };
    if (!KB.getCanon()[r]) return { ok: false, error: `「${r}」不在中药知识库中，请先在中药库添加或更正` };
    const idx = ocrFixes.findIndex(x => String(x.w).trim() === w);
    const isNew = idx < 0;
    if (isNew) ocrFixes.push({ w, r }); else ocrFixes[idx] = { w, r };
    writeFile(ocrFixFile, ocrFixes);
    refresh();
    return { ok: true, isNew, w, r };
  }
  function ocrRemove(w) {
    const before = ocrFixes.length;
    ocrFixes = ocrFixes.filter(x => String(x.w).trim() !== String(w || '').trim());
    if (ocrFixes.length === before) return { ok: false, error: '未找到该自定义条目' };
    writeFile(ocrFixFile, ocrFixes);
    refresh();
    return { ok: true, w };
  }
  function ocrTest(text) {
    return KB.fixOcrText(String(text || ''));
  }

  // ===== 配伍禁忌自定义规则（十八反/十九畏扩展） =====
  function sbfList() {
    const builtin = KB.getAllIncompat().filter(r => !r.user);
    return {
      builtin: builtin.map(r => ({ kind: r.kind, a: r.A.join('、'), b: r.B.join('、'), v: r.v })),
      user: sbfRules.map(r => ({ id: r.id, kind: r.kind || '十八反', a: r.a || '', b: r.b || '', v: r.v || '' })),
      // 规则总览（2026-10-15 禁忌库扩充后新增）：让后台能看到自动核查覆盖的全部规则类别与数量
      meta: {
        shibaFan: builtin.filter(r => r.kind === '十八反').length,
        shijiuWei: builtin.filter(r => r.kind === '十九畏').length,
        pregForbid: KB.PREG_FORBID.length,
        pregCaution: KB.PREG_CAUTION.length,
        toxLimits: KB.TOX_LIMITS.length,
        doseLimits: KB.DOSE_LIMITS.length,
        westDrugs: KB.WEST_DRUGS.length,
        drugInteract: (KB.DRUG_INTERACT || []).map(g => ({
          id: g.id, v: g.v,
          west: (g.west || []).join('、'),
          herbs: (g.herbs || []).join('、')
        })),
        stackRules: (KB.STACK_RULES || []).map(g => ({
          id: g.id, v: g.v, min: g.min || 1,
          herbs: (g.herbs || []).join('、')
        }))
      }
    };
  }
  function sbfUpsert({ kind, a, b, v, id }) {
    const norm = (s) => String(s || '').trim();
    const kindN = norm(kind) === '十九畏' ? '十九畏' : '十八反';
    const aN = norm(a), bN = norm(b);
    if (!aN || !bN) return { ok: false, error: '两组药名都不能为空（多味药用 、 分隔）' };
    // 目标药名须在库（含别名），防止录错字导致规则永不命中
    const canon = KB.getCanon();
    const bad = [...aN.split(/[、,，;；\s]+/), ...bN.split(/[、,，;；\s]+/)].filter(Boolean).find(n => !canon[n]);
    if (bad) return { ok: false, error: `药名「${bad}」不在中药知识库中，请先核对或先在中药库添加` };
    const rule = { id: id || ('sbf-' + Date.now().toString(36)), kind: kindN, a: aN, b: bN, v: norm(v) || '机构自定义配伍禁忌规则' };
    const idx = sbfRules.findIndex(x => x.id === rule.id);
    const isNew = idx < 0;
    if (isNew) sbfRules.push(rule); else sbfRules[idx] = { ...sbfRules[idx], ...rule };
    writeFile(sbfFile, sbfRules);
    refresh();
    return { ok: true, isNew, id: rule.id };
  }
  function sbfRemove(id) {
    const before = sbfRules.length;
    sbfRules = sbfRules.filter(x => x.id !== id);
    if (sbfRules.length === before) return { ok: false, error: '未找到该自定义规则' };
    writeFile(sbfFile, sbfRules);
    refresh();
    return { ok: true, id };
  }

  // ===== 中药医保规则库（支付类别/限定支付/自付比例，机构自维护） =====
  const YB_PAY = ['甲类', '乙类', '丙类', '自费'];
  function ybList() {
    return yibaoRules.map(r => ({
      id: r.id, name: r.name || '', code: r.code || '', payType: r.payType || '',
      limit: r.limit || '', copay: r.copay || '', note: r.note || ''
    }));
  }
  function ybUpsert({ id, name, code, payType, limit, copay, note }) {
    const norm = (s) => String(s || '').trim();
    const nameN = norm(name);
    if (!nameN) return { ok: false, error: '药名不能为空' };
    const canon = KB.getCanon();
    if (!canon[nameN]) return { ok: false, error: `药名「${nameN}」不在中药知识库中，请先核对或先在中药库添加` };
    const payN = norm(payType);
    if (payN && !YB_PAY.includes(payN)) return { ok: false, error: `支付类别须为：${YB_PAY.join(' / ')}` };
    const rule = {
      id: id || ('yb-' + Date.now().toString(36)),
      name: nameN,
      code: norm(code), payType: payN,
      limit: norm(limit), copay: norm(copay), note: norm(note)
    };
    const idx = yibaoRules.findIndex(x => x.id === rule.id || x.name === rule.name);
    const isNew = idx < 0;
    if (isNew) yibaoRules.push(rule); else yibaoRules[idx] = { ...yibaoRules[idx], ...rule };
    writeFile(yibaoFile, yibaoRules);
    refresh();
    return { ok: true, isNew, id: rule.id };
  }
  function ybRemove(id) {
    const before = yibaoRules.length;
    yibaoRules = yibaoRules.filter(x => x.id !== id);
    if (yibaoRules.length === before) return { ok: false, error: '未找到该条目' };
    writeFile(yibaoFile, yibaoRules);
    refresh();
    return { ok: true, id };
  }

  // ===== 未匹配药名队列（AI 补库）=====
  // 采集分析时未能匹配到知识库的药名自动入队（去重计数），后台可 AI 解析→纠错表/新增中药，或忽略
  let unmatched = readFile(unmatchedFile); // [{id, name, count, first, last, status:'pending'|'done'|'ignored', resolved}]
  function unmatchedAdd(names, source) {
    let added = 0;
    const now = Date.now();
    for (const raw of (names || [])) {
      const name = String(raw || '').trim();
      if (!name || name.length < 2 || /^\d+$/.test(name)) continue;
      const idx = unmatched.findIndex(x => x.name === name);
      if (idx >= 0) {
        if (unmatched[idx].status === 'pending') { unmatched[idx].count++; unmatched[idx].last = now; unmatched[idx].source = source || unmatched[idx].source; added++; }
        continue; // 已处理过的不重复入队
      }
      unmatched.push({ id: 'un-' + now.toString(36) + '-' + unmatched.length, name, count: 1, first: now, last: now, status: 'pending', source: source || '' });
      added++;
    }
    if (added) writeFile(unmatchedFile, unmatched);
    return { ok: true, added };
  }
  function unmatchedList() {
    return unmatched.slice().sort((a, b) => (a.status === b.status ? b.last - a.last : (a.status === 'pending' ? -1 : 1)));
  }
  function unmatchedSetStatus(id, status, resolved) {
    const it = unmatched.find(x => x.id === id);
    if (!it) return { ok: false, error: '未找到该条目' };
    it.status = status;
    if (resolved) it.resolved = resolved;
    writeFile(unmatchedFile, unmatched);
    return { ok: true, id, status };
  }
  function unmatchedRemove(id) {
    const before = unmatched.length;
    unmatched = unmatched.filter(x => x.id !== id);
    if (unmatched.length === before) return { ok: false, error: '未找到' };
    writeFile(unmatchedFile, unmatched);
    return { ok: true };
  }
  function unmatchedPending() { return unmatched.filter(x => x.status === 'pending').map(x => x.name); }
  // Excel 批量导入：同名覆盖；药名校验在库，不合格跳过
  function ybImport(arr) {
    if (!Array.isArray(arr)) return { ok: false, error: '数据格式错误：应为对象数组' };
    let added = 0, updated = 0, skipped = 0;
    const errors = [];
    for (const raw of arr) {
      if (!raw || !String(raw.name || '').trim()) { skipped++; continue; }
      const r = ybUpsert(raw);
      if (r.ok) { r.isNew ? added++ : updated++; }
      else { skipped++; if (errors.length < 5) errors.push(`${String(raw.name).trim()}: ${r.error}`); }
    }
    return { ok: true, added, updated, skipped, total: yibaoRules.length, errors };
  }

  function loadFromDisk() {
    herbs = readFile(herbFile);
    formulas = readFile(formulaFile);
    ocrFixes = readFile(ocrFixFile);
    sbfRules = readFile(sbfFile);
    yibaoRules = readFile(yibaoFile);
    refresh();
  }

  // 初始：启动即合并一次
  refresh();

  return {
    dir, stats, list, listAll,
    upsert, remove, clear, importBatch, persist, loadFromDisk,
    ocrList, ocrUpsert, ocrRemove, ocrTest,
    sbfList, sbfUpsert, sbfRemove,
    ybList, ybUpsert, ybRemove, ybImport,
    unmatchedAdd, unmatchedList, unmatchedSetStatus, unmatchedRemove, unmatchedPending,
    files: { herbs: herbFile, formulas: formulaFile, ocrfixes: ocrFixFile, shibafan: sbfFile, yibao: yibaoFile, unmatched: unmatchedFile }
  };
}

module.exports = { initUserKb, KIND_HERB, KIND_FORMULA, KIND_OCRFIX };

// lib/clinicalkb.js - 辨证库：标准中医诊断(病名)→证型 + 症状库(西医/中医) + 西医诊断↔中医诊断对照
// 数据存于 SQLite data.db 的 kb_items 表（kind=diag/symptom/westmap）
// 诊断条目：{ name:病名, cat:科别(内科/外科/妇科/儿科/骨伤/五官/皮肤…), syndromes:[证型…], note? }
// 证型由诊断条目内嵌（扁平的 syndromes 亦可独立展示，携带其归属 diag）
// 症状条目：{ name, cls:'中医'|'西医', syndromes:[证型…](中医症状推荐关联), diag?(归属诊断), note? }
// 西医对照条目：{ west:西医病名(含包含匹配), tcm:中医病名(须在诊断库), note? }
const fs = require('fs');
const path = require('path');
const DB = require('./db');

const KIND_DIAG = 'diag';      // 诊断证型库（诊断条目）
const KIND_SX = 'symptom';     // 症状库（中医/西医）
const KIND_WESTMAP = 'westmap'; // 西医诊断↔中医诊断对照库

function normDiag(raw) {
  if (!raw || !raw.name) return null;
  const name = String(raw.name).trim();
  if (!name) return null;
  const synd = (raw.syndromes || raw.syndrome || raw.zhengxing || []);
  const syndromes = (Array.isArray(synd) ? synd : String(synd).split(/[,，;；、]/))
    .map(s => String(s).trim()).filter(Boolean);
  return {
    name,
    cat: String(raw.cat || raw.ke || raw.category || '').trim(),
    syndromes,
    note: String(raw.note || raw.desc || '').trim()
  };
}

function normSymptom(raw) {
  if (!raw || !raw.name) return null;
  const name = String(raw.name).trim();
  if (!name) return null;
  const cls = String(raw.cls || raw.type || '中医').trim();
  const synd = raw.syndromes || raw.syndrome || [];
  const syndromes = (Array.isArray(synd) ? synd : String(synd).split(/[,，;；、]/))
    .map(s => String(s).trim()).filter(Boolean);
  return {
    name,
    cls: cls === '西医' || cls === '西' || /western|west/i.test(cls) ? '西医' : '中医',
    syndromes,
    diag: String(raw.diag || raw.disease || '').trim(),
    note: String(raw.note || raw.desc || '').trim()
  };
}

function normWestMap(raw) {
  if (!raw) return null;
  const west = String(raw.west || raw.w || raw.name || '').trim();
  const tcm = String(raw.tcm || raw.r || raw.diag || '').trim();
  if (!west || !tcm) return null;
  return {
    west,
    tcm,
    note: String(raw.note || raw.desc || '').trim()
  };
}

function initClinicalKb(userDataDir) {
  const dir = path.join(userDataDir, 'knowledge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const diagFile = path.join(dir, 'diagnoses.json');
  const sxFile = path.join(dir, 'symptoms.json');
  const westFile = path.join(dir, 'westmap.json');

  // 落盘层：旧 JSON 文件路径 → SQLite kb_items kind（db.migrateJson 首启已把旧数据迁入）
  const KIND_BY_FILE = new Map([
    [diagFile, KIND_DIAG], [sxFile, KIND_SX], [westFile, KIND_WESTMAP],
  ]);
  function readFile(f) {
    const kind = KIND_BY_FILE.get(f);
    return kind ? DB.kbLoad(kind) : [];
  }
  function writeFile(f, arr) {
    const kind = KIND_BY_FILE.get(f);
    if (kind) DB.kbSave(kind, arr);
  }

  let diagnoses = readFile(diagFile);
  let symptoms = readFile(sxFile);
  let westmaps = readFile(westFile);

  // 内置种子：首次运行（库为空）时自动补全，避免后台空库。
  // 仅当磁盘文件为空数组/缺失且存在种子文件时才导入，绝不覆盖用户已有数据。
  function loadSeed(file) {
    try {
      const p = path.join(__dirname, '..', 'data', file);
      if (!fs.existsSync(p)) return null;
      const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
      return Array.isArray(arr) ? arr : null;
    } catch (e) { return null; }
  }
  const seedDiag = diagnoses.length === 0 ? loadSeed('seed-diagnoses.json') : null;
  const seedSx = symptoms.length === 0 ? loadSeed('seed-symptoms.json') : null;
  const seedWest = westmaps.length === 0 ? loadSeed('seed-westmap.json') : null;

  function stats() {
    const sxTcm = symptoms.filter(s => s.cls === '中医').length;
    const sxWest = symptoms.filter(s => s.cls === '西医').length;
    const syndromeNames = new Set();
    diagnoses.forEach(d => (d.syndromes || []).forEach(s => syndromeNames.add(s)));
    return {
      dir,
      diagCount: diagnoses.length,
      symptomCount: symptoms.length,
      symptomTcm: sxTcm,
      symptomWest: sxWest,
      syndromeCount: syndromeNames.size,
      westMapCount: westmaps.length
    };
  }

  // 扁平证型视图（含归属诊断），供检索/打分
  function syndromeRows() {
    const out = [];
    diagnoses.forEach(d => (d.syndromes || []).forEach(s => {
      out.push({ name: s, diag: d.name, cat: d.cat, diagNote: d.note });
    }));
    return out;
  }

  function list(kind) {
    if (kind === KIND_DIAG) return diagnoses.slice();
    if (kind === KIND_SX) return symptoms.slice();
    if (kind === KIND_WESTMAP) return westmaps.slice();
    return { diagnoses: diagnoses.slice(), symptoms: symptoms.slice(), westmaps: westmaps.slice() };
  }

  function upsert(kind, obj) {
    if (kind === KIND_WESTMAP) {
      const n = normWestMap(obj);
      if (!n) return { ok: false, error: '缺少 west(西医病名)/tcm(中医病名) 字段' };
      const idx = westmaps.findIndex(x => x.west === n.west);
      const isNew = idx < 0;
      if (isNew) westmaps.push(n); else westmaps[idx] = { ...westmaps[idx], ...n };
      persist();
      return { ok: true, isNew, name: n.west };
    }
    const n = kind === KIND_DIAG ? normDiag(obj) : normSymptom(obj);
    if (!n) return { ok: false, error: '缺少 name 字段' };
    const arr = kind === KIND_DIAG ? diagnoses : symptoms;
    const idx = arr.findIndex(x => x.name === n.name);
    const isNew = idx < 0;
    if (isNew) arr.push(n); else arr[idx] = { ...arr[idx], ...n };
    persist();
    return { ok: true, isNew, name: n.name };
  }

  function remove(kind, name) {
    if (kind === KIND_WESTMAP) {
      const out = westmaps.filter(x => x.west !== name);
      if (out.length === westmaps.length) return { ok: false, error: '未找到' };
      westmaps = out;
      persist();
      return { ok: true, name };
    }
    const isDiag = kind === KIND_DIAG;
    const arr = isDiag ? diagnoses : symptoms;
    const out = arr.filter(x => x.name !== name);
    if (out.length === arr.length) return { ok: false, error: '未找到' };
    if (isDiag) diagnoses = out; else symptoms = out;
    persist();
    return { ok: true, name };
  }

  function clear(kind) {
    if (kind === KIND_DIAG) diagnoses = [];
    else if (kind === KIND_SX) symptoms = [];
    else if (kind === KIND_WESTMAP) westmaps = [];
    else return { ok: false, error: '未知类型' };
    persist();
    return { ok: true };
  }

  function importBatch(kind, arr) {
    if (!Array.isArray(arr)) return { ok: false, error: '数据格式错误：应为 JSON 数组' };
    let added = 0, updated = 0, skipped = 0;
    if (kind === KIND_WESTMAP) {
      const map = new Map(westmaps.map(x => [x.west, x]));
      for (const raw of arr) {
        const n = normWestMap(raw);
        if (!n) { skipped++; continue; }
        if (map.has(n.west)) { map.set(n.west, { ...map.get(n.west), ...n }); updated++; }
        else { map.set(n.west, n); added++; }
      }
      westmaps = [...map.values()];
      persist();
      return { ok: true, added, updated, skipped, total: westmaps.length };
    }
    const isDiag = kind === KIND_DIAG;
    const cur = isDiag ? diagnoses : symptoms;
    const norm = isDiag ? normDiag : normSymptom;
    const map = new Map(cur.map(x => [x.name, x]));
    for (const raw of arr) {
      const n = norm(raw);
      if (!n) { skipped++; continue; }
      if (map.has(n.name)) {
        const old = map.get(n.name);
        map.set(n.name, { ...old, ...n });
        updated++;
      } else {
        map.set(n.name, n);
        added++;
      }
    }
    const merged = [...map.values()];
    if (isDiag) diagnoses = merged; else symptoms = merged;
    persist();
    return { ok: true, added, updated, skipped, total: merged.length };
  }

  function persist() {
    writeFile(diagFile, diagnoses);
    writeFile(sxFile, symptoms);
    writeFile(westFile, westmaps);
  }

  const api = {
    dir, stats, list, syndromeRows,
    upsert, remove, clear, importBatch,
    files: { diagnoses: diagFile, symptoms: sxFile, westmap: westFile }
  };
  // 空库自动补种子并落盘（仅在磁盘为空时执行一次）
  if (seedDiag && seedDiag.length) api.importBatch(KIND_DIAG, seedDiag);
  if (seedSx && seedSx.length) api.importBatch(KIND_SX, seedSx);
  if (seedWest && seedWest.length) api.importBatch(KIND_WESTMAP, seedWest);
  return api;
}

module.exports = { initClinicalKb, KIND_DIAG, KIND_SX, KIND_WESTMAP };

// lib/stripsuggest.js - 从一段识别文本里「自动推荐」清理噪音规则（后台 AI 设置页用）
//
// 场景：医院 HIS/EMR 界面各有各的噪音（勾号、序号、统计串、页脚…），医生不想手写正则。
// 这里按 HIS 常见噪音特征从识别结果里挑候选，再逐条做**安全试跑**：凡是会删掉
// 用法行（每日1剂 / 分早晚两次饭后内服 / 外用…）的候选一律不推 —— 用法是外用豁免
// 与剂量核查的依据，删了会直接改变审方结论。
//
// 本文件是**纯本地**逻辑（不联网、确定性好），供两侧（Electron / .NET 宿主）对拍；
// 「让大模型再补几条」的联网部分在调用方（main.js / Channels.cs）里，不在本文件。
'use strict';
const noise = require('./noise');
const SR = require('../renderer/strip-rules');

// 用法/服法特征：命中即视为「要保留的行」
const USAGE_RE = /用法|服法|用量|每日\s*\d+\s*剂|隔日|分早晚|早晚|中午|饭后|饭前|睡前|顿服|温服|水煎|煎服|内服|外用|外洗|外敷|熏洗|患处/;

const MARKS = ['✓', '√', '✔', '☑', '✅', '●', '◆', '★', '※', '[已核对]', '（已核对）', '(已核对)'];

function uniq(arr) { return arr.filter((v, i) => arr.indexOf(v) === i); }

/**
 * @param {string} text        识别出来的文本（可多行）
 * @param {{drop?:string[], cut?:string[], adv?:string}} existing 已有规则（已存在的不再推荐）
 * @returns {{candidates:{kind:string,value:string,label:string,reason:string,src:string}[], stats:object}}
 */
function suggest(text, existing) {
  const ex = existing || {};
  const exWords = new Set([].concat(ex.drop || [], ex.cut || []).map(s => String(s || '').trim()).filter(Boolean));
  const exAdv = String(ex.adv || '');

  const src = String(text || '');
  const lines = src.split('\n').map(s => s.trim());
  const body = lines.filter(Boolean);
  const usageLines = body.filter(l => USAGE_RE.test(l));

  const all = [];
  const push = (kind, value, label, reason) => {
    if (!value) return;
    if (all.some(c => c.kind === kind && c.value === value)) return;
    all.push({ kind, value, label, reason, src: 'local' });
  };

  // —— 安全试跑：把候选单独应用到原文，凡「动到了用法行」就否掉 ——
  function safe(rule) {
    if (!usageLines.length) return true;
    let after;
    try { after = SR.applyText(usageLines.join('\n'), rule); }
    catch (e) { return false; }
    const kept = after.filter(s => String(s || '').trim());
    if (kept.length < usageLines.length) return false;      // 用法行被整行删掉了
    return USAGE_RE.test(kept.join('\n'));                  // 用法关键词还在吗
  }

  // ① 勾选标记 / 核对标记（行内删）
  for (const m of MARKS) {
    if (src.indexOf(m) >= 0) push('cut', m, '勾选标记', '识别结果里有「' + m + '」这类勾选/核对记号');
  }

  // ② 行首序号「1. / 2、」（行内删，只删每行首个）
  if (body.some(l => /^\d+\s*[.、)]\s*\S/.test(l))) {
    push('adv', '/^\\d+\\s*[.、)]\\s*/', '行首序号', '药味/医嘱行前的自动序号（1. 2、3)）');
  }

  // ③ 处方尾部统计串（共N味M剂）：整行 / 括号包裹两种形态
  if (body.some(l => /^\s*共\s*\d+\s*味/.test(l))) {
    push('adv', '~/^共\\s*\\d+\\s*味/', '统计行整行删', '整行就是「共14味7剂…」这类统计，没有诊疗信息');
  }
  if (/[（(]\s*共\s*\d+\s*味/.test(src) || /共\s*\d+\s*味\s*\d+\s*剂/.test(src)) {
    // 只删统计串本身，保留括号里后面的用法（如「（共14味7剂 每日1剂…）」）→ 用法要留着
    push('adv', '/[（(]\\s*共\\s*\\d+\\s*味\\s*\\d*\\s*剂/g', '统计串行内删',
      '括号里的「（共14味7剂…）」统计串，会混进药味识别（用法部分保留）');
  }

  // ④ 行尾孤立右括号（HIS 用括号包统计串，OCR 常只剩半个）
  if (body.some(l => /[)）]\s*$/.test(l))) {
    push('adv', '/[)）]\\s*$/g', '行尾孤括号', '统计串被清掉后残留的行尾「)」');
  }

  // ⑤ 分隔线
  if (body.some(l => /^[-—_=]{3,}$/.test(l))) {
    push('adv', '~/^[-—_=]{3,}$/', '分隔线', '表格分隔线 / 横线');
  }

  // ⑥ 规格列「1克*1g/g」（每行都有的列值，会把药名与剂量隔成两行）
  for (const m of uniq((src.match(/\d+\s*克\s*\*\s*\d+\s*g\s*\/\s*g/gi) || [])).slice(0, 2)) {
    push('cut', m, '规格列', 'HIS 处方表格的规格列值「' + m + '」');
  }

  // ⑦ 页脚（第 N 页 / 共 N 页）
  if (/第\s*\d+\s*页|共\s*\d+\s*页/.test(src)) {
    push('adv', '/第\\s*\\d+\\s*页|共\\s*\\d+\\s*页/g', '页脚', '界面页脚页码');
  }

  // ⑧ 打印信息行（打印时间/打印人/打印日期）
  for (const w of ['打印时间', '打印日期', '打印人']) {
    if (src.indexOf(w) >= 0) push('drop', w, '打印信息', '含「' + w + '」的行是打印留痕，不是病历内容');
  }

  // ⑨ 短碎片行（≤6 字、不是药味/用法、看着像界面碎片，且重复出现 ≥2 次）
  const freq = new Map();
  for (const l of body) {
    if (l.length > 6) continue;
    if (USAGE_RE.test(l)) continue;
    if (/\d+\s*(g|G|克|ml|mg)/.test(l)) continue;      // 带剂量 → 可能是药味行
    freq.set(l, (freq.get(l) || 0) + 1);
  }
  for (const [l, n] of freq) {
    if (n < 2) continue;
    if (!noise.isNoiseLine(l)) continue;                // 只推「已被判为界面噪音」的，避免误删病历要素
    push('drop', l, '重复碎片行', '这一行出现了 ' + n + ' 次且不含诊疗信息');
  }

  // —— 过滤：已存在的 + 不安全的一律不推 ——
  const candidates = all.filter(c => {
    if (c.kind === 'adv') { if (exAdv.indexOf(c.value) >= 0) return false; }
    else if (exWords.has(c.value)) return false;
    return safe(c.kind === 'adv' ? c.value : (c.kind === 'drop' ? '~' + c.value : c.value));
  });

  return {
    candidates,
    stats: { lines: body.length, usageLines: usageLines.length, noiseLines: body.filter(l => noise.isNoiseLine(l)).length },
  };
}

/** 让大模型补规则时用的提示词（两侧共用同一份，保证行为一致） */
const AI_SYSTEM = '你是医院信息系统（HIS/EMR）界面文本清洗助手。用户会给你一段从处方/医嘱界面识别（OCR）出来的文本，'
  + '你要指出其中属于「界面噪音」、不应进入病历采集内容的片段。输出规则，每行一条，格式二选一：\n'
  + '整行删：<文本>   —— 一行里含有该文本就整行丢弃\n'
  + '删词：<文本>     —— 只删这个片段，该行其余内容保留\n'
  + '规则：\n'
  + '1. 只输出规则行本身，不要序号、不要引号、不要解释、不要 markdown 代码块。\n'
  + '2. 绝对不要删「用法/服法/每日N剂/分早晚两次饭后内服/外用/外洗/外敷」等用法信息 —— 它是审方依据。\n'
  + '3. 也不要删药名、剂量、诊断、证型、舌脉等任何诊疗内容。\n'
  + '4. 最多 8 条，宁缺毋滥；没有可清理的就只输出一行「（无）」。';

function aiPrompt(text) {
  return '下面是从医院处方界面识别出来的文本，请给出清理规则：\n\n' + String(text || '').slice(0, 3000);
}

/** 解析大模型返回的规则行 → 候选（src 标记为 ai，供前端区分来源） */
function parseAiRules(reply) {
  const out = [];
  for (const raw of String(reply || '').split('\n')) {
    const line = raw.trim().replace(/^[-*•\d.\s]+/, '');
    if (!line || line.indexOf('（无）') >= 0 || line.indexOf('(无)') >= 0) continue;
    let m = line.match(/^整行删[:：]\s*(.+)$/);
    if (m) { out.push({ kind: 'drop', value: m[1].trim(), label: '界面噪音（AI）', reason: '大模型判定：整行丢弃', src: 'ai' }); continue; }
    m = line.match(/^删词[:：]\s*(.+)$/);
    if (m) { out.push({ kind: 'cut', value: m[1].trim(), label: '界面噪音（AI）', reason: '大模型判定：只删该片段', src: 'ai' }); continue; }
  }
  // 兜底：模型没按格式输出时，把「整行删/删词」关键字之外的纯文本行当删词（长度 2~16，避免长句）
  if (!out.length) {
    for (const raw of String(reply || '').split('\n')) {
      const v = raw.trim().replace(/^[-*•\d.\s]+/, '');
      if (v.length >= 2 && v.length <= 16 && !/[：:]/.test(v)) {
        out.push({ kind: 'cut', value: v, label: '界面噪音（AI）', reason: '大模型判定：只删该片段', src: 'ai' });
      }
    }
  }
  return out.slice(0, 8);
}

module.exports = { suggest, parseAiRules, AI_SYSTEM, aiPrompt, USAGE_RE };

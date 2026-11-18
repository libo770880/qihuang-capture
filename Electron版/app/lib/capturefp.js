// lib/capturefp.js —— 重复截取识别（纯函数、不碰 IO；C# 镜像 Domain/CaptureFp.cs，两侧必须逐字同源）
// 场景：左侧记录栏避免重复截取 —— 同文（去空白后指纹一致）再次采集时覆盖原记录而不是新增一条。
// 医生维护过的字段全部保留，采集字段与自动分析按本次结果刷新。

'use strict';
const crypto = require('crypto');

/** 采集文本指纹：去全部空白后 sha1 hex */
function textFp(s) {
  try { return crypto.createHash('sha1').update(String(s || '').replace(/\s+/g, '')).digest('hex'); }
  catch (e) { return ''; }
}

/**
 * 重复截取合并：dup（已有记录）+ recData（本次采集载荷）→ 覆盖用 patch（null = 不是重复）。
 * 保留：患者标注 / 置顶 / 复核裁定 / 手填剂数 / 手填用法 / 诊断证型覆盖 / 改过的诊断要素；
 * 刷新：采集字段（文本/截图/来源/时间）与自动分析（compliance/tcm/qc/an）。
 */
function dedupPatch(dup, recData) {
  if (!dup || !dup.id || !recData) return null;
  const patch = Object.assign({}, recData, {
    ts: new Date().toISOString(),
    keys: (dup.keys && Object.keys(dup.keys).length) ? dup.keys : recData.keys, // 改过的诊断要素不丢
  });
  if (dup.diag) patch.diag = dup.diag;
  if (dup.synd) patch.synd = dup.synd;
  if (dup.patient !== undefined) patch.patient = dup.patient;
  if (dup.dept) patch.dept = dup.dept;   // 科室：人工改过的归属不被重采覆盖（文本改了科室也不改，除非用户手动再改）
  if (dup.pinned !== undefined) patch.pinned = dup.pinned;
  if (dup.review !== undefined) patch.review = dup.review;
  if (dup.rxJi !== undefined) patch.rxJi = dup.rxJi;
  if (dup.usageEdited) { patch.usage = dup.usage; patch.usageEdited = true; } // 手填用法保留
  return patch;
}

module.exports = { textFp, dedupPatch };

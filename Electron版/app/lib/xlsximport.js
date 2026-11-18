// lib/xlsximport.js - 后台知识库 Excel 批量导入：模板定义 + 行→对象映射
// 每个导入目标：sheet 名 / 表头列（中文表头, 归一化字段, 示例值）/ 所属存储(user/clinical)
const XLSX_TARGETS = {
  herb: { title: '中药库', store: 'user', sheet: '中药', cols: [
    ['名称*', 'name', '人参叶'], ['别名(、分隔)', 'aliases', ''], ['性味', 'nature', '苦、甘，寒'], ['功效', 'actions', '补气益肺，祛暑生津'],
    ['主治', 'indications', '暑热口渴；肺虚咳嗽'], ['用法用量', 'usage', '3-9g'], ['注意/禁忌', 'note', '不宜与藜芦同用'], ['毒性', 'toxicity', '无'],
    ['妊娠', 'pregnancy', '慎用'], ['分类', 'category', '补气药'], ['拼音', 'pinyin', 'renshenye'], ['基原', 'origin', '五加科植物人参的叶'], ['文献出处', 'source', '《中国药典》2020']
  ] },
  formula: { title: '方剂库', store: 'user', sheet: '方剂', cols: [
    ['方名*', 'name', '小青龙汤'], ['类别(汤方/成药)', 'kind', '汤方'], ['主治证型(、分隔)', 'syndromes', '外寒内饮'], ['组成', 'composition', '麻黄9g 桂枝9g 干姜9g 细辛3g 五味子6g 白芍9g 半夏9g 炙甘草6g'],
    ['功效', 'actions', '解表散寒，温肺化饮'], ['主治', 'indications', '外寒里饮证。恶寒发热，无汗，咳喘'], ['用法', 'usage', '水煎服'], ['加减', 'modification', '兼郁热加石膏'],
    ['备注', 'notes', '细辛用量3g内'], ['别名(、分隔)', 'aliases', ''], ['出处', 'origin', '《伤寒论》']
  ] },
  diag: { title: '诊断证型库', store: 'clinical', sheet: '诊断证型', cols: [
    ['诊断病名*', 'name', '胃脘痛'], ['科别', 'cat', '内科'], ['辨证分型(、分隔)', 'syndromes', '寒邪客胃证、饮食伤胃证、肝胃不和证'], ['诊疗要点', 'note', '以上腹部疼痛为主症，多与情志、饮食相关']
  ] },
  symptom: { title: '症状库', store: 'clinical', sheet: '症状', cols: [
    ['症状名*', 'name', '胃脘胀满疼痛'], ['类别(中医/西医)', 'cls', '中医'], ['提示证型(、分隔)', 'syndromes', '肝胃不和证、饮食伤胃证'], ['关联诊断', 'diag', '胃脘痛'], ['备注', 'note', '胀痛连胁、嗳气频作为肝气犯胃']
  ] },
  westmap: { title: '西医对照库', store: 'clinical', sheet: '西医对照', cols: [
    ['西医病名*', 'west', '糖尿病'], ['中医诊断*', 'tcm', '消渴'], ['备注', 'note', '多饮多尿多食消瘦']
  ] },
  yibao: { title: '中药医保规则库', store: 'yibao', sheet: '医保规则', cols: [
    ['药名*', 'name', '三七'], ['医保编码', 'code', 'T300500'], ['支付类别(甲类/乙类/丙类/自费)', 'payType', '乙类'],
    ['限定支付范围', 'limit', '限工伤保险'], ['自付比例(%)', 'copay', '20'], ['备注', 'note', '首自付比例按当地医保目录']
  ] }
};

/** sheet_to_json(header:1) 的行数组 → 对象数组（按表头中文映射字段；跳过空行/无名称行） */
function xlsxRowsToObjects(rows, cols) {
  if (!rows || !rows.length) return [];
  const header = rows[0].map(c => String(c || '').trim());
  const map = header.map(h => cols.find(c => c[0] === h || c[1] === h));
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length || r.every(c => String(c || '').trim() === '')) continue;
    const obj = {};
    let has = false;
    map.forEach((m, ci) => {
      if (!m) return;
      const v = String(r[ci] === undefined || r[ci] === null ? '' : r[ci]).trim();
      if (v === '') return;
      obj[m[1]] = v;
      if (m[1] === 'name' || m[1] === 'west' || m[1] === 'tcm') has = true;
    });
    if (has) out.push(obj);
  }
  return out;
}

/** 生成模板 workbook（数据页 + 说明页） */
function buildTemplateWorkbook(target) {
  const t = XLSX_TARGETS[target];
  if (!t) return null;
  const XLSX = require('xlsx');
  const aoa = [t.cols.map(c => c[0]), t.cols.map(c => c[2])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = t.cols.map(c => ({ wch: Math.max(10, Math.min(40, c[2].length * 2 + 6)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t.sheet);
  const note = XLSX.utils.aoa_to_sheet([
    ['填写说明'],
    ['1. 首行为表头，请勿修改表头文字；第 2 行为示例，导入前请删除或覆盖'],
    ['2. 带 * 的列为必填；多值列（别名/证型等）用「、」分隔'],
    ['3. 与库内同名记录导入后将被覆盖更新'],
    ['4. 导入入口：后台对应库页签 → 「从 Excel 文件导入」']
  ]);
  XLSX.utils.book_append_sheet(wb, note, '说明');
  return { wb, t };
}

module.exports = { XLSX_TARGETS, xlsxRowsToObjects, buildTemplateWorkbook };

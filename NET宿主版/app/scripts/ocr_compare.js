// scripts/ocr_compare.js - OCR 引擎精度对比：同一张图分别跑 PP-OCRv6 与系统 OCR
// 用法: node scripts/ocr_compare.js <图片路径> [tier]
const capture = require('../lib/capture');
const fs = require('fs');

async function main() {
  const img = process.argv[2];
  const tier = process.argv[3] || 'medium';
  if (!img || !fs.existsSync(img)) { console.log('用法: node scripts/ocr_compare.js <图片路径> [medium|small|tiny]'); process.exit(1); }

  console.log('图片:', img, '\n');
  capture.setOcrConfig({ engine: 'paddle', tier, python: '' });
  const t0 = Date.now();
  try {
    const r = await capture.ocrImage(img, 'zh-Hans-CN');
    const ms = Date.now() - t0;
    console.log('=== PP-OCRv6 (' + tier + ') · ' + ms + 'ms · ' + r.lines.length + ' 行 ===');
    console.log(capture.linesToText(r.lines));
  } catch (e) {
    console.log('=== PP-OCRv6 失败:', e.message, '===');
  }

  console.log('\n');
  capture.setOcrConfig({ engine: 'win' });
  const t1 = Date.now();
  try {
    const r2 = await capture.ocrImage(img, 'zh-Hans-CN');
    const ms2 = Date.now() - t1;
    console.log('=== 系统 OCR · ' + ms2 + 'ms · ' + r2.lines.length + ' 行 ===');
    console.log(capture.linesToText(r2.lines));
  } catch (e) {
    console.log('=== 系统 OCR 失败:', e.message, '===');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

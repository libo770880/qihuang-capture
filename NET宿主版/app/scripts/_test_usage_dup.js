const A = require('E:/capture-tool/lib/analyze.js');
const U = '每日1剂院内煎常规煎分早晚两次饭后内服。';
// 场景1：用法行每味药重复印（连续多行）→ reflow 后 pickUsage 不出重复
const t1 = ['黄芪 - 60 g', U, U, U, '杜仲 - 15 g', U, U].join('\n');
const r1 = A.reflowWrappedUsage(t1);
const p1 = A.pickUsage(r1).usage;
console.log('reflow:  ', JSON.stringify(r1.split('\n')));
console.log('pickUsage:', JSON.stringify(p1));
// 场景2：OCR 把整列并成一行「A。A。A。」→ 句级去重兜底
const p2 = A.pickUsage('用法 每日1剂院内煎常规煎分早晚两次饭后内服。每日1剂院内煎常规煎分早晚两次饭后内服。每日1剂院内煎常规煎分早晚两次饭后内服。').usage;
console.log('单行重复:', JSON.stringify(p2));
// 场景3：正常折行回拼仍工作（「每」悬挂 + 续行）
const t3 = ['党参10g每', '日1剂院内煎常规煎', '分早晚两次', '饭后内服'].join('\n');
const p3 = A.pickUsage(A.reflowWrappedUsage(t3)).usage;
console.log('折行回拼:', JSON.stringify(p3));
// 场景4：外用 + 内服两个不同片段仍都保留
const p4 = A.pickUsage('外用\n' + U).usage;
console.log('外用合并:', JSON.stringify(p4));
const ok =
  p1 === '每日1剂院内煎常规煎分早晚两次饭后内服' &&
  p2 === '每日1剂院内煎常规煎分早晚两次饭后内服' &&
  (p3 || '').includes('每日1剂') && (p3 || '').includes('分早晚') &&
  (p4 || '').includes('外用') && (p4 || '').includes('每日1剂');
console.log(ok ? 'USAGE_DUP_TEST_OK' : 'USAGE_DUP_TEST_FAIL');
process.exit(ok ? 0 : 1);

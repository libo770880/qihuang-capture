const tess = require('../lib/tess');
tess.setLog(m => console.log('[tess]', m));
(async () => {
  const t0 = Date.now();
  const img = process.argv[2];
  const r = await tess.ocrTess(img);
  console.log('elapsed=' + ((Date.now() - t0) / 1000).toFixed(1) + 's lines=' + r.lines.length);
  console.log('--- text head ---');
  console.log(r.text.split('\n').slice(0, 8).join('\n'));
  const st = await tess.tessStatus();
  console.log('status=', JSON.stringify(st));
  await tess.stopTess();
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });

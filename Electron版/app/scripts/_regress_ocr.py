# -*- coding: utf-8 -*-
"""回归测试：对 qhjf-capture 下所有截图跑 OCR，打印药名列表"""
import glob
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
SCRIPT = os.path.join(HERE, 'ocr_paddle.py')
TMP = os.path.join(os.environ['TEMP'], 'qhjf-capture')

for src in sorted(glob.glob(os.path.join(TMP, 'win_*.png'))):
    r = subprocess.run([PY, SCRIPT, '--image', src, '--tier', 'medium', '--lang', 'ch'],
                       capture_output=True, text=True, timeout=300)
    try:
        d = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        print(os.path.basename(src), '| PARSE FAIL:', r.stdout[:200], r.stderr[:200])
        continue
    if not d.get('ok'):
        print(os.path.basename(src), '| ERR:', d.get('error'))
        continue
    herbs = [l['text'] for l in d['lines']
             if len(l['text']) >= 2 and not any(c.isdigit() for c in l['text'])
             and '克' not in l['text'] and 'g' not in l['text'].lower()]
    has_cx = any('川芎' in t for t in herbs)
    print(os.path.basename(src), '|', len(d['lines']), '行 | 川芎:', '✓' if has_cx else '✗', '|', ' '.join(herbs))

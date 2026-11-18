# -*- coding: utf-8 -*-
"""双通道 OCR 对比：对同一批截图分别跑 auto(原生 PP-OCRv6) 与 rapid(RapidOCR-ONNX)，
输出行数 / 耗时 / 医学术语命中对比。

用法：
    python _regress_ocr_ab.py                 # 跑 %TEMP%/qhjf-capture 下所有 win_*.png
    python _regress_ocr_ab.py <img1> <img2>   # 指定图片
环境变量 QHJF_OCR_PY 可指定 OCR 专用解释器（默认取本机托管 OCR 环境）。
"""
import glob
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'ocr_paddle.py')
DEFAULT_PY = os.path.join(os.path.expanduser('~'), '.workbuddy', 'binaries',
                          'python', 'envs', 'ocr', 'Scripts', 'python.exe')
PY = os.environ.get('QHJF_OCR_PY') or (DEFAULT_PY if os.path.exists(DEFAULT_PY) else sys.executable)

# 医学关键词：用于两条通道的「识别质量」可比对（出现即为命中）
TERMS = ['川芎', '炒桃仁', '红花', '熟地黄', '当归', '炒白芍', '龙骨', '牡蛎',
         '北柴胡', '黄芪', '法半夏', '甘草', '茯苓', '白术', '党参']


def run(force, img):
    t0 = time.time()
    r = subprocess.run([PY, SCRIPT, '--image', img, '--tier', 'medium', '--lang', 'ch',
                        '--force', force],
                       capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
    dt = time.time() - t0
    try:
        d = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        return {'ok': False, 'error': (r.stdout or '')[:200] + (r.stderr or '')[:200], 'sec': dt}
    d['sec'] = dt
    return d


def main():
    imgs = sys.argv[1:] or sorted(glob.glob(os.path.join(os.environ.get('TEMP', ''), 'qhjf-capture', 'win_*.png')))
    if not imgs:
        print('未找到测试截图（%TEMP%/qhjf-capture/win_*.png），可显式传图片路径')
        return 1
    print('OCR 解释器:', PY)
    print('对比图片数:', len(imgs))
    for img in imgs:
        print('\n=== ' + os.path.basename(img))
        res = {}
        for force in ('auto', 'rapid'):
            d = run(force, img)
            res[force] = d
            if not d.get('ok'):
                print('  %-6s ✗ %s (%.1fs)' % (force, d.get('error'), d.get('sec', 0)))
                continue
            texts = [l['text'] for l in d.get('lines', [])]
            hits = [t for t in TERMS if any(t in x for x in texts)]
            print('  %-6s engine=%-18s lines=%-4d 术语命中=%-2d %.1fs'
                  % (force, d.get('engine'), len(texts), len(hits), d['sec']))
        a, b = res.get('auto'), res.get('rapid')
        if a and b and a.get('ok') and b.get('ok'):
            ta = [l['text'] for l in a['lines']]
            tb = [l['text'] for l in b['lines']]
            sa = [t for t in TERMS if any(t in x for x in ta)]
            sb = [t for t in TERMS if any(t in x for x in tb)]
            print('  差异: 行数 %+d | 术语命中差 %s | 耗时 %.1fs → %.1fs'
                  % (len(tb) - len(ta), (set(sa) ^ set(sb)) or '无', a['sec'], b['sec']))
    return 0


if __name__ == '__main__':
    sys.exit(main())

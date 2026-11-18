# -*- coding: utf-8 -*-
"""OCR 耗时分解基准：单次调用 vs 常驻服务。

测量项：
  ① 单次调用（现状，.NET 宿主走这条）：进程启动 + import + 建引擎 + 推理 + 退出
  ② 常驻服务 ready：进程启动 + import + 建引擎（只付一次）
  ③ 常驻服务每次请求：纯推理（模型常驻内存）
另测 --probe 预检（_paddle_importable 子进程）的额外开销。

用法: python _bench_ocr.py [图片路径...]
"""
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
FORCE = os.environ.get('FORCE', 'auto')
TIER = os.environ.get('TIER', 'medium')
EXTRA = os.environ.get('EXTRA_ARGS', '').split()


def one_shot(img):
    """现状：单次调用（每次重新加载模型）"""
    t0 = time.time()
    r = subprocess.run([PY, SCRIPT, '--image', img, '--tier', TIER, '--lang', 'ch', '--force', FORCE] + EXTRA,
                       capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
    dt = time.time() - t0
    try:
        d = json.loads(r.stdout.strip().splitlines()[-1])
        n = len(d.get('lines', [])) if d.get('ok') else -1
    except Exception:
        n = -2
    return dt, n


def probe_cost():
    """_paddle_importable() 预检子进程的额外开销（serve 模式的建引擎前会跑一次）"""
    t0 = time.time()
    subprocess.run([PY, SCRIPT, '--probe'], capture_output=True, timeout=300)
    return time.time() - t0


def serve_bench(imgs):
    """常驻服务：ready 一次，之后逐张请求"""
    t0 = time.time()
    p = subprocess.Popen([PY, SCRIPT, '--serve', '--tier', TIER, '--lang', 'ch', '--force', FORCE] + EXTRA,
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                         text=True, encoding='utf-8', bufsize=1)
    ready_line = p.stdout.readline()
    ready = time.time() - t0
    try:
        rj = json.loads(ready_line)
    except Exception:
        rj = {'ok': False, 'raw': ready_line[:120]}
    print('  serve ready = %.1fs  %s' % (ready, json.dumps(rj, ensure_ascii=False)[:120]))
    per = []
    for img in imgs:
        t1 = time.time()
        p.stdin.write(img + '\n')
        p.stdin.flush()
        line = p.stdout.readline()
        dt = time.time() - t1
        try:
            d = json.loads(line)
            n = len(d.get('lines', [])) if d.get('ok') else -1
        except Exception:
            n = -2
        per.append((os.path.basename(img), dt, n))
    try:
        p.stdin.write('__exit__\n')
        p.stdin.flush()
        p.wait(timeout=15)
    except Exception:
        p.kill()
    return ready, per


def main():
    imgs = sys.argv[1:] or [os.path.join(os.environ['TEMP'], 'qhjf-capture', 'win_1792047815374_2.png')]
    print('解释器:', PY, '| force=%s tier=%s extra=%s' % (FORCE, TIER, EXTRA))
    print('图片:', [os.path.basename(i) for i in imgs])
    print()

    print('① --probe 预检开销（serve 建引擎前跑一次；单次调用模式不跑）')
    print('   probe = %.1fs' % probe_cost())

    print('\n② 单次调用（.NET 宿主现状）')
    for img in imgs:
        dt, n = one_shot(img)
        print('   %-28s %.1fs  lines=%s' % (os.path.basename(img), dt, n))

    print('\n③ 常驻服务（Electron 版现状）')
    ready, per = serve_bench(imgs)
    for name, dt, n in per:
        print('   请求 %-24s %.2fs  lines=%s' % (name, dt, n))
    print('\n小结：常驻后每张 ≈ %.2fs（首张）' % (per[0][1] if per else -1))


if __name__ == '__main__':
    main()

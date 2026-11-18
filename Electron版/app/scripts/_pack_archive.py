#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
发布包压缩：release/<名字>/ -> release/<名字>.7z（LZMA2 固实，优先）
            若无 py7zr 则回落 .tar.xz（标准库 lzma）

为什么不用 zip：zip 只能 deflate。实测 electron.exe（234.7MB）：
  deflate-9 → 101.6MB (43.3%)      lzma-6 → 72.9MB (31.1%)
LZMA 固实压缩可让整体交付包再降约 25%~30%。

依赖（仅打包机需要，隔离环境安装）：
  <envs>/default/Scripts/python.exe -m pip install py7zr

用法：
  python scripts/_pack_archive.py                 # 默认压 release/岐黄鉴方采集助手
  python scripts/_pack_archive.py <目录> <输出文件>
"""
import os
import sys
import time
import tarfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = '岐黄鉴方采集助手'
DEFAULT_SRC = os.path.join(ROOT, 'release', NAME)
PRESET = 6  # 体积/耗时平衡点（9 更小但慢一倍以上）
_ARCNAME = NAME  # 归档内的根目录名，main() 里按第三参数覆盖

try:
    import py7zr
    HAS_7Z = True
except ImportError:
    HAS_7Z = False


def count_files(src):
    n = 0
    total = 0
    for dirpath, _dirnames, filenames in os.walk(src):
        for fn in filenames:
            n += 1
            try:
                total += os.path.getsize(os.path.join(dirpath, fn))
            except OSError:
                pass
    return n, total


def pack_7z(src, out, n, total):
    filters = [{'id': py7zr.FILTER_LZMA2, 'preset': PRESET}]
    print('压缩器 : py7zr %s / LZMA2 preset=%d / 固实 / 多进程' % (py7zr.__version__, PRESET))
    with py7zr.SevenZipFile(out, 'w', filters=filters, mp=True) as z:
        z.writeall(src, arcname=_ARCNAME)


def pack_tarxz(src, out, n, total):
    print('压缩器 : 标准库 lzma / tar.xz preset=%d / 固实（未安装 py7zr，回落）' % PRESET)
    last = 0
    done = 0
    t0 = time.time()
    items = []
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames.sort()
        for fn in sorted(filenames):
            full = os.path.join(dirpath, fn)
            items.append((full, os.path.relpath(full, src)))
    with tarfile.open(out, 'w:xz', preset=PRESET) as tar:
        for i, (full, rel) in enumerate(items, 1):
            tar.add(full, arcname=os.path.join(_ARCNAME, rel), recursive=False)
            try:
                done += os.path.getsize(full)
            except OSError:
                pass
            pct = i * 100 // max(1, len(items))
            if pct >= last + 5 or i == len(items):
                last = pct
                print('  %3d%%  %d/%d  %.1f/%.1f MB  %.0fs'
                      % (pct, i, len(items), done / 1048576, total / 1048576,
                         time.time() - t0), flush=True)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        ROOT, 'release', NAME + ('.7z' if HAS_7Z else '.tar.xz'))
    # 归档内的根目录名。默认沿用 NAME；多版本并存时必须显式区分
    #（否则 .NET 版与 Electron 版解压后都是「岐黄鉴方采集助手/」，互相覆盖）。
    arcname = sys.argv[3] if len(sys.argv) > 3 else NAME
    global _ARCNAME
    _ARCNAME = arcname
    if not os.path.isdir(src):
        print('源目录不存在: %s' % src)
        return 1

    n, total = count_files(src)
    print('源目录 : %s' % src)
    print('文件数 : %d   原始体积: %.1f MB' % (n, total / 1048576))
    print('输出   : %s' % out)

    for p in [out]:
        if os.path.exists(p):
            os.remove(p)

    t0 = time.time()
    if HAS_7Z:
        pack_7z(src, out, n, total)
    else:
        pack_tarxz(src, out, n, total)

    zsize = os.path.getsize(out)
    print('-' * 60)
    print('完成   : %.1f MB  (原始 %.1f MB, 压缩率 %.1f%%)  耗时 %.0fs'
          % (zsize / 1048576, total / 1048576, zsize / total * 100, time.time() - t0))
    return 0


if __name__ == '__main__':
    sys.exit(main())

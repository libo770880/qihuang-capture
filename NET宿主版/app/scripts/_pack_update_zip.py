#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""为更新机制打 zip 包（Windows 自带 Expand-Archive 只认 zip）+ 计算 SHA-256。

排除项：
  userdata/     真实采集记录与配置，绝不能进更新包（覆盖会毁数据）
  logs/ *.log   运行日志
"""
import hashlib
import os
import sys
import time
import zipfile

REL = r"E:\capture-tool\release\岐黄鉴方采集助手-完整版"
OUT = os.path.join(REL, os.pardir)

TARGETS = [
    ("Electron版", "qhjf-electron-v0.2.0.zip"),
    ("NET宿主版", "qhjf-net-v0.2.0.zip"),
]

SKIP_DIRS = {"userdata", "logs", "__pycache__"}
SKIP_EXT = {".log", ".pyc"}
SKIP_FILES = {"portable.dat"}


def add_tree(zf, root, base, stats):
    for name in sorted(os.listdir(base)):
        abs_p = os.path.join(base, name)
        rel_p = os.path.relpath(abs_p, root).replace("\\", "/")
        if os.path.isdir(abs_p):
            if name.lower() in SKIP_DIRS:
                continue
            add_tree(zf, root, abs_p, stats)
            continue
        if name.lower() in SKIP_FILES:
            continue
        if os.path.splitext(name)[1].lower() in SKIP_EXT:
            continue
        zf.write(abs_p, rel_p)
        stats["files"] += 1
        stats["raw"] += os.path.getsize(abs_p)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


results = []
for src_name, zip_name in TARGETS:
    src = os.path.join(REL, src_name)
    dst = os.path.join(OUT, zip_name)
    if not os.path.isdir(src):
        print("缺少目录:", src)
        sys.exit(1)
    t0 = time.time()
    stats = {"files": 0, "raw": 0}
    if os.path.exists(dst):
        os.remove(dst)
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as zf:
        add_tree(zf, src, src, stats)
    size = os.path.getsize(dst)
    digest = sha256(dst)
    print(f"{zip_name}: {stats['files']} 文件 / 原始 {stats['raw']/1048576:.1f} MB → {size/1048576:.1f} MB"
          f" / sha256 {digest} / {time.time()-t0:.0f}s")
    results.append((zip_name, size, digest))

print("\n=== latest.json 资产片段 ===")
for name, size, digest in results:
    print(f"{name}\tsize={size}\tsha256={digest}")

# -*- coding: utf-8 -*-
"""7z 归档验收：解压后逐文件 sha256 比对（不要用 py7zr 的 z.test()，会误报）。

用法：
  python scripts/_verify_archive.py <7z路径> <源目录> <解压临时目录> <归档内根目录名>

判定：条目数一致、缺失/多余/哈希不一致 均为 0 才 PASS（目录条目不参与计数）。
"""
import hashlib
import os
import sys

import py7zr


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def walk(root):
    """返回 {相对路径: sha256}，路径用 / 分隔。"""
    out = {}
    for dirpath, dirnames, filenames in os.walk(root):
        for name in filenames:
            p = os.path.join(dirpath, name)
            rel = os.path.relpath(p, root).replace("\\", "/")
            out[rel] = sha256(p)
    return out


def main():
    archive, src, tmp, arcname = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    dest = os.path.join(tmp, arcname)

    # 清空解压点：环境安全钩子可能拦截整目录批量删除（SAFE_DELETE_BULK_CONFIRM），
    # 删不掉就直接中止并提示先手动清空（rm -rf <tmp>/*），不要静默带着旧解压产物验收。
    os.makedirs(tmp, exist_ok=True)
    leftover = os.listdir(tmp)
    if leftover:
        try:
            for name in leftover:
                p = os.path.join(tmp, name)
                if os.path.isdir(p):
                    import shutil
                    shutil.rmtree(p, ignore_errors=False)
                else:
                    os.remove(p)
        except Exception as ex:
            print(f"[verify] 临时目录未清空（{len(leftover)} 项残留，{ex.__class__.__name__}）。"
                  f"请先手动执行： rm -rf {tmp}/*")
            sys.exit(3)

    print("[verify] 解压中…")
    with py7zr.SevenZipFile(archive, mode="r") as z:
        z.extractall(path=tmp)

    a = walk(src)
    b = walk(dest)
    missing = sorted(set(a) - set(b))
    extra = sorted(set(b) - set(a))
    diff = sorted(k for k in set(a) & set(b) if a[k] != b[k])

    print(f"[verify] 源 {len(a)} 文件 / 解压 {len(b)} 文件")
    print(f"[verify] 缺失 {len(missing)}  多余 {len(extra)}  哈希不一致 {len(diff)}")
    for k in missing[:10]:
        print("  MISSING", k)
    for k in extra[:10]:
        print("  EXTRA  ", k)
    for k in diff[:10]:
        print("  DIFF   ", k)
    print("[verify] PASS" if not missing and not extra and not diff else "[verify] FAIL")
    sys.exit(0 if not missing and not extra and not diff else 2)


if __name__ == "__main__":
    main()

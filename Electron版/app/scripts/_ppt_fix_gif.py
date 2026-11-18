# -*- coding: utf-8 -*-
# 修复 pptx 内 GIF 动图：① 移到规范路径 ppt/media/ ② <p:cNvPicPr> 补 a:picLocks
# ③ 确保 [Content_Types].xml 声明 gif。原地重写（先在同目录生成 .tmp 再替换）。
import zipfile, re, sys, shutil, os

SRC = sys.argv[1] if len(sys.argv) > 1 else "C:/Users/Administrator/Desktop/平原县中医院岐黄鉴方工具(1).pptx"
TMP = SRC + ".tmp"

zin = zipfile.ZipFile(SRC)
names = zin.namelist()

# 1) 规划重命名：ppt/slides/media/imageX.gif → ppt/media/imageX.gif
rename = {}
for n in names:
    if n.startswith("ppt/slides/media/") and n.lower().endswith(".gif"):
        dst = "ppt/media/" + n.split("/")[-1]
        # 若目标已存在（重名），加后缀
        base, ext = os.path.splitext(dst)
        i = 1
        while dst in names or dst in rename.values():
            dst = f"{base}_{i}{ext}"; i += 1
        rename[n] = dst
print("rename:", rename)

# 2) 关系文件里的目标路径修正
def fix_rels(x):
    for old, new in rename.items():
        oldt = old.replace("ppt/slides/", "")          # media/imageX.gif
        newt = "../" + new.replace("ppt/slides/", "")   # ../media/imageX.gif  (slides/_rels 相对)
        x = x.replace(f'Target="{oldt}"', f'Target="{newt}"')
    return x

# 3) 图片节点补 picLocks（<p:cNvPicPr/> → <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>）
def fix_pic(x):
    return x.replace("<p:cNvPicPr/>", '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>')

zout = zipfile.ZipFile(TMP, "w", zipfile.ZIP_DEFLATED)
for it in zin.infolist():
    n = it.filename
    if n.endswith("/"):
        continue
    data = zin.read(n)
    if n in rename:
        zout.writestr(rename[n], data)
        continue
    if n.startswith("ppt/slides/_rels/") and n.endswith(".rels"):
        t = fix_rels(data.decode("utf-8"))
        zout.writestr(n, t.encode("utf-8"))
        continue
    if re.match(r"ppt/slides/slide\d+\.xml$", n):
        t = fix_pic(data.decode("utf-8"))
        zout.writestr(n, t.encode("utf-8"))
        continue
    if n == "[Content_Types].xml":
        t = data.decode("utf-8")
        if 'Extension="gif"' not in t:
            t = t.replace('<Default Extension="png"', '<Default Extension="gif" ContentType="image/gif"/><Default Extension="png"', 1)
        zout.writestr(n, t.encode("utf-8"))
        continue
    zout.writestr(it, data)
zout.close(); zin.close()
shutil.move(TMP, SRC)
print("fixed ->", SRC)

# 校验
z = zipfile.ZipFile(SRC)
gifs = [n for n in z.namelist() if n.lower().endswith(".gif")]
print("gif count:", len(gifs), gifs)
bad = [n for n in z.namelist() if n.startswith("ppt/slides/media/")]
print("leftover slides/media:", bad)
for i in (3, 9, 12, 14, 18):
    r = z.read(f"ppt/slides/_rels/slide{i}.xml.rels").decode("utf8")
    print(i, re.findall(r'Target="([^"]*media/[^"]*)"', r))
print("picLocks ok:", z.read("ppt/slides/slide3.xml").decode("utf8").count("picLocks"))

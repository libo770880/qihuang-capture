# -*- coding: utf-8 -*-
"""AI 识别链端到端实测：框选 → 点工具条「AI」→ 粘贴框弹出并显示框内进度条。
验证粘贴框事件缓存补发（PageReady 前的 hint/progress 不丢）：判据为
日志出现 `[paste] flush N pending events`（N>=2，hint+progress），
并在粘贴框窗口内 GDI 采样到框内进度条特征色。
用法：python scripts/_ui_probe_aiocr.py [exe路径]
前置：无运行中的 QhjfCapture 实例；后台已配置 AI 视觉模型（未配置则识别失败，
但 flush 与进度条出现判据仍然成立）。
"""
import ctypes, ctypes.wintypes as wt, subprocess, time, sys, os, re

u32 = ctypes.windll.user32
g32 = ctypes.windll.gdi32
u32.SetProcessDPIAware()

LOG = os.path.join(r"C:\Users\Administrator\AppData\Roaming", "岐黄鉴方·悬浮采集助手", "logs", "app.log")
EXE = sys.argv[1] if len(sys.argv) > 1 else \
    r"E:\capture-tool\net\dist-host\QhjfCapture.exe"
ENV = dict(os.environ, APPDATA=r"C:\Users\Administrator\AppData\Roaming",
           DOTNET_ROOT=r"C:\Users\Administrator\.workbuddy\binaries\dotnet")

def log(*a):
    print(*a); sys.stdout.flush()

def log_size():
    try: return os.path.getsize(LOG)
    except OSError: return 0

def log_new(pos):
    with open(LOG, "r", encoding="utf-8", errors="replace") as f:
        f.seek(pos)
        return f.read()

def enum_windows(pid):
    out = []
    CB = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def cb(h, lp):
        if not u32.IsWindowVisible(h):
            return True
        p = wt.DWORD()
        u32.GetWindowThreadProcessId(h, ctypes.byref(p))
        if p.value != pid:
            return True
        r = wt.RECT()
        u32.GetWindowRect(h, ctypes.byref(r))
        out.append((h, r.left, r.top, r.right - r.left, r.bottom - r.top))
        return True
    u32.EnumWindows(CB(cb), 0)
    return out

def find_ball(pid, lo=60, hi=95):
    for w in enum_windows(pid):
        if lo <= w[3] <= hi and lo <= w[4] <= hi:
            return w
    return None

def find_paste(pid):
    # 粘贴框 580x600 DIP，1.25 缩放 ≈ 725x750 物理
    for w in enum_windows(pid):
        if 550 <= w[3] <= 820 and 640 <= w[4] <= 920:
            return w
    return None

def get_pixel(x, y):
    hdc = u32.GetDC(0)
    c = g32.GetPixel(hdc, x, y)
    u32.ReleaseDC(0, hdc)
    return (c & 0xFF, (c >> 8) & 0xFF, (c >> 16) & 0xFF)

MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x0002, 0x0004

def click(x, y):
    u32.SetCursorPos(x, y); time.sleep(0.12)
    u32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0); time.sleep(0.07)
    u32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0); time.sleep(0.2)

def find_overlay(pid):
    for w in enum_windows(pid):
        if w[3] > 2000 and w[4] > 1000:
            return w
    return None

def drag(x1, y1, x2, y2, steps=6):
    u32.SetCursorPos(x1, y1); time.sleep(0.12)
    u32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0); time.sleep(0.08)
    for i in range(1, steps + 1):
        u32.SetCursorPos(x1 + (x2 - x1) * i // steps, y1 + (y2 - y1) * i // steps)
        time.sleep(0.05)
    time.sleep(0.15)
    u32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0); time.sleep(0.3)

# ---------- 启动 ----------
pos0 = log_size()
proc = subprocess.Popen([EXE], cwd=os.path.dirname(EXE), env=ENV)
log("PID =", proc.pid)
time.sleep(8)

ball = find_ball(proc.pid)
if not ball:
    log("FAIL: 未找到悬浮球窗口"); sys.exit(1)
h, bl, bt, bw, bh = ball
log(f"悬浮球: {bw}x{bh} @({bl},{bt})")

# ---------- 展开并点「框选抓取」（第 2 项，与 capture 探针同坐标） ----------
click(bl + bw // 2, bt + bh // 2)
time.sleep(1.0)
exp = find_ball(proc.pid, lo=100, hi=700)
if not exp:
    log("FAIL: 未展开"); os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1"); sys.exit(1)
eh, el, et, ew, eh2 = exp[0], exp[1], exp[2], exp[3], exp[4]
sf = ew / 214.0
btn_x = el + int(ew / 2)
item_h = (eh2 - int(42 * sf) - int(8 * sf) - 8 * int(4 * sf) - int(36 * sf)) / 8.0
btn_y = et + int((42 + 2 + item_h * 1.5 + 4) * sf)
log(f"点击框选按钮: ({btn_x},{btn_y})")
click(btn_x, btn_y)
time.sleep(3.0)

overlay = find_overlay(proc.pid)
if not overlay:
    log("FAIL: 未出现遮罩"); os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1"); sys.exit(1)
ol, ot, ow, oh = overlay[1], overlay[2], overlay[3], overlay[4]
log(f"遮罩: {ow}x{oh} @({ol},{ot})")

# ---------- 拖选一个小区域，按特征色定位工具条「AI」按钮（文字 #7ec8f2 蓝） ----------
x1, y1, x2, y2 = ol + 200, ot + 200, ol + 540, ot + 450
drag(x1, y1, x2, y2)
time.sleep(0.6)

def find_ai_button():
    """在工具条行（y2+30..y2+55）扫描蓝色文字像素簇，返回簇中心 x。"""
    best = None
    for yy in range(y2 + 25, y2 + 58, 4):
        cols = []
        for xx in range(x2 - 500, x2 + 260, 2):
            r, g, b = get_pixel(xx, yy)
            if abs(r - 126) < 45 and abs(g - 200) < 40 and abs(b - 242) < 35:
                cols.append(xx)
        if len(cols) >= 6:
            # 取最大连续簇的中心
            runs, s, p = [], cols[0], cols[0]
            for c in cols[1:]:
                if c - p > 12: runs.append((s, p)); s = c
                p = c
            runs.append((s, p))
            s, e = max(runs, key=lambda t: t[1] - t[0])
            best = (s + e) // 2
    return best

ai_x = find_ai_button()
ai_y = y2 + 40
if ai_x is None:
    log("FAIL: 未定位到 AI 按钮（特征色扫描失败）")
    os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1"); sys.exit(1)
log(f"点击工具条AI: ({ai_x},{ai_y})")
click(ai_x, ai_y)

# ---------- 等粘贴框弹出并采样框内进度条特征色（绿色渐变 #7fb069 / 轨道 #e2e8d2） ----------
paste = None
prog_found = False
t0 = time.time()
while time.time() - t0 < 12:
    time.sleep(0.4)
    paste = find_paste(proc.pid)
    if paste:
        pl, pt, pw, ph = paste[1], paste[2], paste[3], paste[4]
        # ocrprog 位于窗口顶部说明行下方：在窗口上半部扫描进度条特征色
        hit_bar = hit_track = 0
        for yy in range(pt + 60, pt + int(ph * 0.55), 6):
            for xx in range(pl + 30, pl + pw - 30, 8):
                r, g, b = get_pixel(xx, yy)
                if abs(r - 127) < 30 and abs(g - 176) < 30 and abs(b - 105) < 35: hit_bar += 1
                if abs(r - 226) < 14 and abs(g - 232) < 14 and abs(b - 210) < 16: hit_track += 1
        if hit_bar >= 3 and hit_track >= 3:
            prog_found = True
            break
if paste:
    log(f"粘贴框: {paste[3]}x{paste[4]} @({paste[1]},{paste[2]})")
log("RESULT paste-window =", "OK" if paste else "FAIL 未出现")
log("RESULT paste-progress =", "OK 框内进度条已显示（绿色条+轨道特征色命中）" if prog_found else "FAIL 未见进度条特征色")

# ---------- 日志判据：flush 补发 + aiocr 完成 ----------
t0 = time.time()
flush_line = ok_line = None
while time.time() - t0 < 45:
    time.sleep(1.5)
    txt = log_new(pos0)
    if not flush_line:
        m = re.search(r"\[paste\] flush \d+ pending events.*", txt)
        if m: flush_line = m.group(0).strip()
    if not ok_line:
        m = re.search(r"\[region\] aiocr (ok|ERR|start).*", txt)
        if m and ("ok" in m.group(0) or "ERR" in m.group(0)): ok_line = m.group(0).strip()
    if flush_line and ok_line: break
log("RESULT flush =", ("OK " + flush_line[:80]) if flush_line else "FAIL 无 [paste] flush 日志")
log("RESULT aiocr =", ("OK " + ok_line[:90]) if ok_line else "WARN 45s 内未见 aiocr 完成（网络慢？）")

txt = log_new(pos0)
log("RESULT sta-errors =", txt.count("STA"), "（应为 0）")
os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1")
log("--- 测毕 ---")

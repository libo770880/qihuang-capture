# -*- coding: utf-8 -*-
"""外壳层端到端实测：悬浮球拖动 / 点击展开 / 遮罩透明度 / Esc 关闭。
用法：python scripts/_ui_probe_host.py
前置：无运行中的 QhjfCapture 实例。
"""
import ctypes, ctypes.wintypes as wt, subprocess, time, sys, os

u32 = ctypes.windll.user32
g32 = ctypes.windll.gdi32
u32.SetProcessDPIAware()

EXE = r"E://capture-tool//net//QhjfCapture//bin//Release//net8.0-windows10.0.17763.0//QhjfCapture.exe"
ENV = dict(os.environ, APPDATA=r"C:\Users\Administrator\AppData\Roaming",
           DOTNET_ROOT=r"C:\Users\Administrator\.workbuddy\binaries\dotnet")

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

def get_pixel(x, y):
    hdc = u32.GetDC(0)
    c = g32.GetPixel(hdc, x, y)
    u32.ReleaseDC(0, hdc)
    return (c & 0xFF, (c >> 8) & 0xFF, (c >> 16) & 0xFF)

MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x0002, 0x0004
MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP = 0x0008, 0x0010
def click(x, y):
    u32.SetCursorPos(x, y); time.sleep(0.12)
    u32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0); time.sleep(0.07)
    u32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0); time.sleep(0.2)

def right_click(x, y):
    u32.SetCursorPos(x, y); time.sleep(0.12)
    u32.mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0); time.sleep(0.07)
    u32.mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0); time.sleep(0.2)

def find_overlay(pid):
    for w in enum_windows(pid):
        if w[3] > 2000 and w[4] > 1000:
            return w
    return None

def press_esc():
    u32.keybd_event(0x1B, 0, 0, 0); time.sleep(0.05)
    u32.keybd_event(0x1B, 0, 2, 0); time.sleep(0.3)

def snap_full():
    """GDI 全屏截图，供视觉检查。"""
    import ctypes.wintypes as _wt
    w = u32.GetSystemMetrics(0); h = u32.GetSystemMetrics(1)
    hdc = u32.GetDC(0); mdc = g32.CreateCompatibleDC(hdc)
    bmp = g32.CreateCompatibleBitmap(hdc, w, h)
    g32.SelectObject(mdc, bmp)
    g32.BitBlt(mdc, 0, 0, w, h, hdc, 0, 0, 0x00CC0020)
    # 保存 PNG
    class BMPINFOHEADER(ctypes.Structure):
        _fields_ = [("biSize", ctypes.c_uint32), ("biWidth", ctypes.c_int32), ("biHeight", ctypes.c_int32),
                    ("biPlanes", ctypes.c_uint16), ("biBitCount", ctypes.c_uint16), ("biCompression", ctypes.c_uint32),
                    ("biSizeImage", ctypes.c_uint32), ("biXPelsPerMeter", ctypes.c_int32), ("biYPelsPerMeter", ctypes.c_int32),
                    ("biClrUsed", ctypes.c_uint32), ("biClrImportant", ctypes.c_uint32)]
    bmi = BMPINFOHEADER(ctypes.sizeof(BMPINFOHEADER), w, -h, 1, 32, 0, 0, 0, 0, 0, 0)
    buf = ctypes.create_string_buffer(w * h * 4)
    g32.GetDIBits(mdc, bmp, 0, h, buf, ctypes.byref(bmi), 0)
    # BGRA → PNG（用 zope/手写？直接写 BMP 简单可靠）
    out = os.path.join(os.environ["TEMP"], "overlay_snap.bmp")
    fh = 14 + 40
    data = buf.raw
    with open(out, "wb") as f:
        f.write(b"BM"); f.write((fh + len(data)).to_bytes(4, "little")); f.write(b"\0\0\0\0"); f.write(fh.to_bytes(4, "little"))
        f.write(bmi.biSize.to_bytes(4, "little")); f.write(w.to_bytes(4, "little")); f.write((-h).to_bytes(4, "little"))
        f.write(b"\x01\x00"); f.write(b"\x20\x00"); f.write(b"\x00\x00\x00\x00"); f.write((len(data)).to_bytes(4, "little"))
        f.write(b"\x00\x00\x00\x00"); f.write(b"\x00\x00\x00\x00"); f.write(b"\x00\x00\x00\x00"); f.write(b"\x00\x00\x00\x00")
        f.write(data)
    g32.DeleteObject(bmp); g32.DeleteDC(mdc); u32.ReleaseDC(0, hdc)
    log("全屏截图:", out)

def log(*a):
    print(*a); sys.stdout.flush()

# ---------- 启动 ----------
proc = subprocess.Popen([EXE], cwd=os.path.dirname(EXE), env=ENV)
log("PID =", proc.pid)
time.sleep(8)
wins = enum_windows(proc.pid)
log("窗口清单:", [(w[3], w[4], w[1], w[2]) for w in wins])

ball = find_ball(proc.pid)
if not ball:
    log("FAIL: 未找到悬浮球窗口"); sys.exit(1)
h, bl, bt, bw, bh = ball
log(f"悬浮球: {bw}x{bh} @({bl},{bt})")

# ---------- 1) 透明度：球窗内角落 vs 窗外 8px 桌面 ----------
in_corner = get_pixel(bl + 4, bt + 4)
out_desk = get_pixel(bl - 8, bt - 8)
log(f"透明度: 窗内角落={in_corner} 窗外桌面={out_desk}")
opaque = in_corner == (255, 255, 255) and out_desk != (255, 255, 255)
center = get_pixel(bl + bw // 2, bt + bh // 2)
log(f"球心颜色={center} (应为绿色系渐变)")
log("RESULT transparency =", "OPAQUE(白底)" if opaque else "OK")

# ---------- 2) 拖动（向左下，避开右缘 clamp） ----------
cx, cy = bl + bw // 2, bt + bh // 2
u32.SetCursorPos(cx, cy); time.sleep(0.15)
u32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0); time.sleep(0.1)
for i in range(1, 11):
    u32.SetCursorPos(cx - i * 20, cy + i * 10); time.sleep(0.04)
time.sleep(0.2)
u32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0); time.sleep(0.5)
b2 = find_ball(proc.pid)
if b2:
    dx, dy = b2[1] - bl, b2[2] - bt
    log(f"RESULT drag: dx={dx} dy={dy} (期望约 -200/+100)")
else:
    log("RESULT drag: 球窗口丢失")

# ---------- 3) 点击展开 ----------
b3 = find_ball(proc.pid)
log(f"点击前球窗: {b3[1]},{b3[2]} {b3[3]}x{b3[4]}")
click(b3[1] + b3[3] // 2, b3[2] + b3[4] // 2)
time.sleep(1.0)
b4 = find_ball(proc.pid, lo=100, hi=700)  # 展开后约 267x600 物理像素
if b4:
    log(f"RESULT expand: OK 球窗变为 {b4[3]}x{b4[4]} @({b4[1]},{b4[2]})")
    exp = b4
else:
    log("RESULT expand: FAIL 球窗未变（仍 70x70），鼠标事件未到达页面")
    sys.exit(1)

# ---------- 4) 框选遮罩：点「框选抓取」(第 2 项) ----------
eh, el, et, ew, eh2 = exp[0], exp[1], exp[2], exp[3], exp[4]
sf = ew / 214.0  # 物理/DIP
btn_x = el + int(ew / 2)
item_h = (eh2 - int(42 * sf) - int(8 * sf) - 8 * int(4 * sf) - int(36 * sf)) / 8.0
btn_y = et + int((42 + 2 + item_h * 1.5 + 4) * sf)
log(f"点击框选按钮: ({btn_x},{btn_y})")
click(btn_x, btn_y)
time.sleep(3.0)  # 隐藏窗口 → 抓底图 → 显示遮罩

overlay = None
for w in enum_windows(proc.pid):
    if w[3] > 2000 and w[4] > 1000:
        overlay = w; break
if overlay:
    ol, ot, ow, oh = overlay[1], overlay[2], overlay[3], overlay[4]
    p1 = get_pixel(ol + 60, ot + oh // 2)      # 遮罩暗化区
    p2 = get_pixel(ol + ow // 2, ot + 20)      # 顶部提示条(深色胶囊)
    log(f"遮罩: {ow}x{oh} @({ol},{ot})  暗化区={p1}  提示条={p2}")
    white = all(c > 244 for c in p1) and all(c > 244 for c in p2)
    log("RESULT overlay =", "WHITE(白屏)" if white else "OK(非白屏)")
    # 真实用户流：拖拽选区 → Esc 取消。mousedown 会把焦点交给遮罩页。
    def drag(x1, y1, x2, y2, steps=6):
        u32.SetCursorPos(x1, y1); time.sleep(0.12)
        u32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0); time.sleep(0.08)
        for i in range(1, steps + 1):
            u32.SetCursorPos(x1 + (x2 - x1) * i // steps, y1 + (y2 - y1) * i // steps)
            time.sleep(0.05)
        time.sleep(0.15)
        u32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0); time.sleep(0.3)
    drag(ol + 150, ot + 150, ol + 400, ot + 320)
    press_esc()
    time.sleep(1.2)
    if not find_overlay(proc.pid):
        log("RESULT overlay-esc = OK 已关闭（拖拽聚焦后 Esc 生效）")
    else:
        # 二分：右键取消（contextmenu → overlayCancel），区分页面/桥接问题 vs 键盘问题
        right_click(ol + 500, ot + oh // 2)
        time.sleep(1.2)
        if not find_overlay(proc.pid):
            log("RESULT overlay-esc = FAIL 键盘事件未到达页面（鼠标链路正常）")
        else:
            log("RESULT overlay = FAIL 页面脚本或桥接有问题（右键也关不掉）")
else:
    log("RESULT overlay: FAIL 未出现遮罩窗口")

# ---------- 收尾 ----------
log("--- 测毕，关闭宿主 ---")
os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1")

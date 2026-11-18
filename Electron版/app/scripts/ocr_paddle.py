# -*- coding: utf-8 -*-
# ocr_paddle.py - PP-OCRv6 (PaddleOCR 3.x) 桥接脚本
# 输出结构与 Windows OCR 版 ocr.ps1 完全一致：{ok, engine, lines:[{text, words:[{text,x,y,w,h}]}]}
# 用法: python ocr_paddle.py --image shot.png [--tier medium|small|tiny] [--lang ch] [--probe]
#       [--force auto|paddle|rapid]
# 通道: --force auto（默认）原生 PP-OCRv6 优先、不可用则回落 RapidOCR(ONNX)；
#       --force paddle 仅原生；--force rapid 仅 ONNX（可主动选用，内存占用更低）
# 注意：无 AVX 的 CPU（如 Pentium Gold）上 paddle 原生核心无法加载，
#       auto 档自动回落 RapidOCR(ONNX) 推理 PaddleOCR 系模型；此时 onnxruntime 必须锁定 1.20.1
#       （1.21+ 官方 wheel 在无 AVX CPU 上 DLL 初始化失败）。
# 安装: pip install paddlepaddle==3.3.1 paddleocr==3.7.0
#       pip install onnxruntime==1.20.1 rapidocr-onnxruntime --no-deps  (rapidocr 依赖已由 paddle 带齐)
import sys
import os
import json
import argparse
import io
import contextlib

# 屏蔽 paddle / paddleocr 的日志噪音（避免污染 stdout）
os.environ.setdefault('FLAGS_call_stack_level', '0')
os.environ.setdefault('GLOG_minloglevel', '3')
os.environ.setdefault('PADDLE_LOG_LEVEL', '3')


def _silence_logging():
    try:
        import logging
        logging.disable(logging.WARNING)
        for name in ('ppocr', 'paddle', 'paddleocr'):
            lg = logging.getLogger(name)
            lg.setLevel(logging.ERROR)
            lg.propagate = False
            if not lg.handlers:
                lg.addHandler(logging.NullHandler())
    except Exception:
        pass


def _read_image(path):
    """np.fromfile + imdecode 读图（兼容中文/特殊字符路径）"""
    import cv2
    import numpy as np
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def _upscale_factor(img):
    """小图放大系数。

    历史策略（<1000px 放大 2x）是 PP-OCRv5 时代的经验；PP-OCRv6 的检测模型明显更强，
    实测放大已无收益、反而有害（同一张 542x360 处方图）：
      medium：1x 19.6s / 56 行  →  2x 25.5s / 51 行（更慢且更少）
      small ：1x  6.4s / 56 行  →  2x  8.0s / 56 行（且漏「酒大黄」一味药）
      tiny  ：1x  1.9s / 55 行  →  2x  2.5s / 50 行
    因此只对「确实很小」（长边 < 450px，文字高度接近检测下限）的图保留 2x 放大兜底。
    """
    m = max(img.shape[:2])
    return 2.0 if m < 450 else 1.0


def _rescale_results(results, f):
    """把放大后推理得到的坐标按比例还原到原图尺度"""
    for r in (results or []):
        polys = _get(r, 'rec_polys')
        if polys is None:
            polys = _get(r, 'dt_polys')
        if polys is None:
            continue
        try:
            for i, p in enumerate(polys):
                polys[i] = [[pt[0] / f, pt[1] / f] for pt in p]
        except Exception:
            pass
    return results


class _AutoScaleEngine:
    """小图自动放大后推理、坐标还原，对调用方完全透明。
    覆盖原生 PaddleOCR 与 RapidOCR(ONNX) 两条通道。"""
    def __init__(self, inner):
        self.inner = inner

    def predict(self, input):
        import cv2
        img = input
        if isinstance(img, str):
            img = _read_image(img)
        if img is None:
            return self.inner.predict(input=input)
        f = _upscale_factor(img)
        if f == 1.0:
            return self.inner.predict(input=img)
        img2 = cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
        return _rescale_results(self.inner.predict(input=img2), f)


def _v6_rec_model(tier):
    """按档位找 scripts/models/ 下的 PP-OCRv6 ONNX 识别模型（RapidOCR 通道用）。
    返回 (rec_model_path, keys_path) 或 (None, None)。det 模型仍用内置 v3 mobile
    （实测 v6 det 在本场景更慢且漏检更多）。"""
    models_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
    name = 'PP-OCRv6_rec_medium.onnx' if tier in ('medium', '', None) else 'PP-OCRv6_rec_small.onnx'
    rec = os.path.join(models_dir, name)
    small = os.path.join(models_dir, 'PP-OCRv6_rec_small.onnx')
    if not os.path.exists(rec):
        rec = small if os.path.exists(small) else None
    keys = os.path.join(models_dir, 'ppocrv5_dict.txt')
    if rec and os.path.exists(keys):
        return rec, keys
    return None, None


class _RapidEngine:
    """RapidOCR(ONNX) 兼容封装：本机 CPU 无 AVX 时 paddle 原生核心无法加载，
    改用 onnxruntime 推理 PaddleOCR 系模型；输出与 PaddleOCR.predict 同构。
    优先使用 scripts/models/ 下的 PP-OCRv6 ONNX 识别模型（效果远超内置 v3：
    两字药名如"川芎"笔画细碎时 v3 rec 置信度 <0.5 被过滤，v6 可完整识别）。"""
    def __init__(self, tier='medium'):
        from rapidocr_onnxruntime import RapidOCR
        kwargs = {}
        rec, keys = _v6_rec_model(tier)
        if rec:
            # text_score 默认 0.5 会滤掉临界置信度的短药名；降到 0.3 宁多勿漏（后端有噪声行过滤兜底）
            kwargs = {'rec_model_path': rec, 'rec_keys_path': keys, 'text_score': 0.3}
        self.eng = RapidOCR(**kwargs)

    def predict(self, input):
        result, _ = self.eng(input)
        texts, scores, polys = [], [], []
        for item in (result or []):
            box, txt, sc = item[0], item[1], float(item[2])
            texts.append(str(txt))
            scores.append(sc)
            polys.append(box)
        return [{'rec_texts': texts, 'rec_scores': scores, 'rec_polys': polys}]


_PADDLE_IMPORTABLE_CACHE = None


def _paddle_importable(force_recheck=False):
    """paddle 原生核心在无 AVX 的 CPU 上 import 时会直接 segfault（进程级崩溃，
    try/except 接不住），故在独立子进程中预检 import 是否成功。
    结果在进程内缓存：子进程预检本身要 ~5 秒，而同一进程内答案不会变
    （常驻服务的「探针」请求因此从 5.7s 降到毫秒级）。"""
    global _PADDLE_IMPORTABLE_CACHE
    if _PADDLE_IMPORTABLE_CACHE is not None and not force_recheck:
        return _PADDLE_IMPORTABLE_CACHE
    import subprocess
    try:
        r = subprocess.run(
            [sys.executable, '-c', 'import paddleocr, paddle'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120,
        )
        _PADDLE_IMPORTABLE_CACHE = (r.returncode == 0)
    except Exception:
        _PADDLE_IMPORTABLE_CACHE = False
    return _PADDLE_IMPORTABLE_CACHE


def _rapid_importable():
    """RapidOCR(ONNX) 通道可用性：只做 find_spec（不真正 import，秒级返回）。
    onnxruntime 在无 AVX 的 CPU 上也不会崩，无需子进程隔离。"""
    import importlib.util
    for m in ('rapidocr_onnxruntime', 'onnxruntime'):
        try:
            if importlib.util.find_spec(m) is None:
                return False
        except Exception:
            return False
    return True


def _normalize_force(force):
    f = str(force or 'auto').strip().lower()
    return f if f in ('auto', 'paddle', 'rapid') else 'auto'


def _build_engine_any(kwargs, tier='', force='auto'):
    """返回 (kind, engine)：kind='paddle' 原生 PP-OCRv6；kind='rapid' RapidOCR(ONNX) 兜底
    force='auto'  原生优先，不可用回落 ONNX（默认，历史行为）
    force='paddle' 仅原生：不可用直接抛错，不再回落
    force='rapid'  仅 ONNX：用户主动选用（内存占用更低、任何 x64 CPU 可用）"""
    f = _normalize_force(force)
    if f in ('auto', 'paddle') and _paddle_importable():
        try:
            from paddleocr import PaddleOCR
            try:
                return 'paddle', _AutoScaleEngine(PaddleOCR(**kwargs))
            except Exception:
                # 档位模型名不被支持时退回默认模型（仍为 PP-OCRv6 默认档）
                kw = dict(kwargs)
                kw.pop('text_detection_model_name', None)
                kw.pop('text_recognition_model_name', None)
                return 'paddle', _AutoScaleEngine(PaddleOCR(**kw))
        except Exception:
            if f == 'paddle':
                raise
    if f == 'paddle':
        raise RuntimeError('PaddleOCR 原生通道不可用：本机 paddle 核心无法加载（CPU 无 AVX？）')
    try:
        return 'rapid', _AutoScaleEngine(_RapidEngine(tier))
    except ImportError as e:
        raise RuntimeError('RapidOCR(ONNX) 通道不可用：%s（请安装 rapidocr-onnxruntime + onnxruntime==1.20.1）' % e)


_ENGINE_KIND = {'paddle': 'paddleocr-ppocrv6', 'rapid': 'rapidocr-onnx'}


def _parse_results(results):
    lines = []
    for r in (results or []):
        texts = _get(r, 'rec_texts') or []
        scores = _get(r, 'rec_scores') or []
        polys = _get(r, 'rec_polys')
        if polys is None:
            polys = _get(r, 'dt_polys') or []
        for i, txt in enumerate(texts):
            txt = str(txt or '').strip()
            if not txt:
                continue
            poly = polys[i] if i < len(polys) else None
            x, y, w, h = _poly_to_rect(poly) if poly is not None else (0, 0, 0, 0)
            score = float(scores[i]) if i < len(scores) else 0.0
            lines.append({
                'text': txt,
                'conf': round(score, 4),
                'y': y, 'x': x,
                'words': [{'text': txt, 'x': x, 'y': y, 'w': w, 'h': h}],
            })
    lines.sort(key=lambda l: (round(l['y'] / 12.0), l['x']))
    return lines


def _serve(args):
    """常驻模式：模型只加载一次，stdin 逐行读图片路径（或 JSON {"image":..}），stdout 逐行回 JSON"""
    kwargs = dict(
        lang=args.lang,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device='cpu',
        enable_mkldnn=False,
    )
    mn = _model_names(args.tier)
    if mn:
        kwargs['text_detection_model_name'] = mn['det']
        kwargs['text_recognition_model_name'] = mn['rec']

    buf = io.StringIO()
    kind = None
    engine = None
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            kind, engine = _build_engine_any(kwargs, args.tier, args.force)
        eng_name = _ENGINE_KIND.get(kind, 'paddleocr-ppocrv6')
        sys.stdout.write(json.dumps({'ok': True, 'ready': True, 'engine': eng_name, 'tier': args.tier}, ensure_ascii=False) + '\n')
        sys.stdout.flush()
    except Exception as e:
        sys.stdout.write(json.dumps({'ok': False, 'error': 'engine init failed: %s' % e}, ensure_ascii=False) + '\n')
        sys.stdout.flush()
        return

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        if raw in ('__exit__', 'exit', 'quit'):
            break
        image = raw
        payload = None
        try:
            if raw.startswith('{'):
                payload = json.loads(raw)
                image = payload.get('image', '')
        except Exception:
            payload = None
        # 常驻状态探针：引擎已在内存，这里几乎零成本（后台「OCR 引擎」页开页/保存都走它）。
        # 与 --probe 返回同一份载荷，避免每次开页都冷启一个 Python 进程（实测 12s+）。
        if payload and payload.get('probe'):
            try:
                # 建引擎成功即证明 paddle 可用（kind='paddle'）→ 跳过 5 秒的子进程预检；
                # kind='rapid' 既可能是无 AVX 回落、也可能是用户强制 rapid，此时仍走预检（有缓存）
                out = _probe_info(True if kind == 'paddle' else None)
            except Exception as e:
                out = {'ok': False, 'error': str(e)}
            sys.stdout.write(json.dumps(out, ensure_ascii=False) + '\n')
            sys.stdout.flush()
            continue
        try:
            if not image or not os.path.exists(image):
                out = {'ok': False, 'error': 'image not found: %s' % image}
            else:
                buf2 = io.StringIO()
                with contextlib.redirect_stdout(buf2), contextlib.redirect_stderr(buf2):
                    results = engine.predict(input=image)
                out = {'ok': True, 'engine': _ENGINE_KIND.get(kind, 'paddleocr-ppocrv6'), 'tier': args.tier, 'lines': _parse_results(results)}
        except Exception as e:
            out = {'ok': False, 'error': 'predict failed: %s' % e}
        sys.stdout.write(json.dumps(out, ensure_ascii=False) + '\n')
        sys.stdout.flush()


def _probe_info(paddle_ok=None):
    """环境探针载荷。失败时抛异常（调用方决定是退出进程还是回一行错误）——
    常驻模式下绝不能因为探针失败把服务打死。
    paddle_ok 传入已知结论可跳过 ~5 秒的子进程预检（常驻服务已知自己建的是哪条引擎）。"""
    if paddle_ok is None:
        paddle_ok = _paddle_importable()
    rapid_ok = _rapid_importable()
    info = {'ok': True, 'engine': 'paddleocr'}
    # 两条通道的可用性独立上报：后台「OCR 引擎」页据此决定 RapidOCR 选项是否可选
    info['rapidok'] = rapid_ok
    info['kind'] = 'paddle' if paddle_ok else ('rapid' if rapid_ok else '')
    if rapid_ok:
        try:
            from importlib.metadata import version as _pkgver
            info['rapidver'] = _pkgver('rapidocr-onnxruntime')
        except Exception:
            info['rapidver'] = '?'
    if paddle_ok:
        try:
            import paddleocr
            import paddle
            info['paddleocr'] = getattr(paddleocr, '__version__', '?')
            info['paddle'] = getattr(paddle, '__version__', '?')
            try:
                from paddleocr._models import official_ocr_models as _om
                names = [n for n in dir(_om) if 'OCRv6' in n]
                if names:
                    info['models'] = names[:12]
            except Exception:
                pass
        except Exception as e:
            raise RuntimeError('paddleocr import failed: %s' % e)
    else:
        # paddle 原生核心不可用（常见：CPU 无 AVX，import 即 segfault）→ auto 档走 RapidOCR(ONNX)
        if not rapid_ok:
            raise RuntimeError('paddle core unloadable (no AVX?) and rapidocr fallback failed: '
                               'rapidocr_onnxruntime / onnxruntime 未安装')
        try:
            import rapidocr_onnxruntime
            import onnxruntime
            info['engine'] = 'rapidocr-onnx'
            info['paddleocr'] = 'RapidOCR(ONNX) ' + getattr(rapidocr_onnxruntime, '__version__', '?')
            info['paddle'] = 'onnxruntime ' + getattr(onnxruntime, '__version__', '?')
            info['rapid'] = True
        except Exception as e2:
            raise RuntimeError('paddle core unloadable (no AVX?) and rapidocr fallback failed: %s' % e2)
    return info


def _fail(msg, code=1):
    print(json.dumps({'ok': False, 'error': str(msg)}, ensure_ascii=False))
    sys.exit(code)


def _model_names(tier):
    """PP-OCRv6 档位 → 官方模型名（tiny/small/medium）；未知档返回 None 用默认"""
    if not tier:
        return None
    t = str(tier).strip().lower()
    if t not in ('tiny', 'small', 'medium'):
        return None
    return {
        'det': 'PP-OCRv6_%s_det' % t,
        'rec': 'PP-OCRv6_%s_rec' % t,
    }


def _poly_to_rect(poly):
    """多边形 (4 点) → 外接矩形"""
    try:
        xs = [float(p[0]) for p in poly]
        ys = [float(p[1]) for p in poly]
        x0, y0 = int(min(xs)), int(min(ys))
        return x0, y0, int(max(xs) - x0), int(max(ys) - y0)
    except Exception:
        return 0, 0, 0, 0


def _get(res_item, key):
    """兼容 dict / 结果对象两种取值方式"""
    try:
        if isinstance(res_item, dict):
            if key in res_item:
                return res_item[key]
            inner = res_item.get('res')
            if isinstance(inner, dict) and key in inner:
                return inner[key]
        inner = getattr(res_item, 'json', None)
        if isinstance(inner, dict):
            d = inner.get('res', inner)
            if isinstance(d, dict) and key in d:
                return d[key]
        return getattr(res_item, key, None)
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--image', default='')
    ap.add_argument('--tier', default='medium')
    ap.add_argument('--lang', default='ch')
    ap.add_argument('--force', default='auto', help='auto|paddle|rapid：强制 OCR 通道')
    ap.add_argument('--probe', action='store_true')
    ap.add_argument('--serve', action='store_true')
    ap.add_argument('--out', default='')
    args = ap.parse_args()

    _silence_logging()

    if args.serve:
        _serve(args)
        return

    if args.probe:
        # 载荷构造统一走 _probe_info()（常驻模式 {"probe":true} 复用同一份，见 _serve）
        try:
            info = _probe_info()
        except Exception as e:
            _fail(str(e))
        print(json.dumps(info, ensure_ascii=False))
        return

    if not args.image or not os.path.exists(args.image):
        _fail('image not found: %s' % args.image)

    # 关闭 oneDNN（部分 Paddle 3.x CPU 版本 oneDNN 内核对 PIR 属性不兼容，
    # 报 ConvertPirAttribute2RuntimeAttribute not support）
    os.environ['FLAGS_use_mkldnn'] = '0'
    kwargs = dict(
        lang=args.lang,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device='cpu',
        enable_mkldnn=False,
    )
    mn = _model_names(args.tier)
    if mn:
        kwargs['text_detection_model_name'] = mn['det']
        kwargs['text_recognition_model_name'] = mn['rec']

    buf = io.StringIO()
    kind = None
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            kind, engine = _build_engine_any(kwargs, args.tier, args.force)
            results = engine.predict(input=args.image)
    except Exception as e:
        _fail('paddleocr predict failed: %s' % e)

    try:
        lines = _parse_results(results)
    except Exception as e:
        _fail('parse result failed: %s' % e)

    out = {'ok': True, 'engine': _ENGINE_KIND.get(kind, 'paddleocr-ppocrv6'), 'tier': args.tier, 'lines': lines}
    payload = json.dumps(out, ensure_ascii=False)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(payload)
        print(json.dumps({'ok': True, 'written': args.out, 'n': len(lines)}, ensure_ascii=False))
    else:
        print(payload)


if __name__ == '__main__':
    main()

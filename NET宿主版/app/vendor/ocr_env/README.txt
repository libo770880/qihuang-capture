OCR 环境一键离线安装包（vendor/ocr_env）
==========================================

用途：目标机器无需联网、无需安装 Python，后台「OCR 引擎」页点「⚙ 一键离线安装环境」
即自动完成安装（解压嵌入式 Python → 离线 pip → 装轮子 → 自动探测验收）。
安装位置：<应用目录>/runtime/ocr，装完即被 lib/py.js 自动探测到，无需改配置。

内容清单
--------
python-embed.zip   Python 3.13.7 嵌入式版（~11MB）
get-pip.py         pip 引导脚本（需配合 wheels/ 内的 pip wheel 离线安装）
wheels/            RapidOCR(ONNX) 通用通道（~93MB，18 个轮子）
                   onnxruntime==1.20.1 + rapidocr-onnxruntime==1.2.3 + opencv-python 等
                   ★ 不依赖 AVX 指令集，任何 x64 CPU 可用 —— CPU 无 AVX 的解决办法
wheels-paddle/     PP-OCRv6 原生通道（~209MB，69 个轮子）—— 【当前不随包分发】
                   paddlepaddle==3.3.1 + paddleocr==3.7.0 + 全依赖
                   仅支持 AVX 的 CPU。目录不存在时安装器直接走 wheels/ 通道，
                   精度不受影响（识别模型同为 scripts/models/PP-OCRv6_*.onnx）。
                   如需启用原生通道，按下方「维护」命令重建该目录即可，无需改代码。

引擎优先级（安装器自动决策）
--------------------------
1. wheels-paddle 存在 → 装原生 paddle → 子进程验证 import：
   成功 → 引擎 paddleocr-ppocrv6（原生 PP-OCRv6 运行时）
   失败（典型：CPU 无 AVX，DLL 初始化失败/segfault）→ 回落
2. wheels/ 装 RapidOCR(ONNX) → 引擎 rapidocr-onnx  ← 当前默认通道
   （onnxruntime 必须锁 1.20.1：1.21+ 官方 wheel 在无 AVX CPU 上无法加载）
   注意：该通道的识别精度来自 PP-OCRv6 ONNX 模型，与原生通道同源。

维护（需联网的机器上重建轮子库）
------------------------------
pip download -d vendor/ocr_env/wheels -i https://pypi.tuna.tsinghua.edu.cn/simple ^
  rapidocr-onnxruntime==1.2.3 onnxruntime==1.20.1 pip
pip download -d vendor/ocr_env/wheels-paddle -i https://pypi.tuna.tsinghua.edu.cn/simple ^
  paddlepaddle==3.3.1 paddleocr==3.7.0
python-embed.zip 下载：https://www.python.org/ftp/python/3.13.7/python-3.13.7-embed-amd64.zip
get-pip.py 下载：https://bootstrap.pypa.io/get-pip.py

注意：本包体积治理约定 —— wheels-paddle/ 与 node_modules/@tesseract.js-data 默认不随包分发，
      以控制发布包体积；两者均为可选增强，缺失时安装器/引擎自动走等价通道。

补充：PP-OCRv6 识别模型（scripts/models/）
----------------------------------------
PP-OCRv6_rec_small.onnx   ~21MB（档位 tiny/small 用，推荐：快且准）
PP-OCRv6_rec_medium.onnx  ~76MB（档位 medium 用）
ppocrv5_dict.txt          v6 识别字符集（18383 字）
这些模型随应用 scripts/ 目录分发，RapidOCR(ONNX) 通道自动加载（无需 AVX）。
实测对细碎笔画的两字药名（如"川芎"）召回显著优于内置 v3 rec；
配合 text_score=0.3（宁多勿漏）+ 小图 2x 放大。
模型来源：https://www.modelscope.cn/models/RapidAI/RapidOCR
（onnx/PP-OCRv6/rec/*.onnx + paddle/PP-OCRv5/rec/ch_PP-OCRv5_rec_server/ppocrv5_dict.txt）

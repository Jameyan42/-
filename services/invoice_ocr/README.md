# R010 本机发票识别服务

仅供当前电脑 Chrome 使用；纯 CPU、无付费识别 API、不上传第三方。正式多用户服务、安全认证、税务验真不在本次范围。

## Windows（PowerShell）

安装 Node20.19+ 或22.12+、Python3.11/3.12 64位。在项目根目录执行：

```powershell
npm ci
npm run build
py -3.12 -m venv .venv-ocr
.\.venv-ocr\Scripts\python.exe -m pip install -r services/invoice_ocr/requirements.txt
.\.venv-ocr\Scripts\python.exe -m pip check
.\.venv-ocr\Scripts\python.exe services/invoice_ocr/server.py
```

若装的是3.11，将 `py -3.12` 换成 `py -3.11`。直接用虚拟环境的 python，无需激活脚本或修改 PowerShell 执行策略。Windows 未实机验证；若 DLL 无法加载，检查是否64位Python及微软VC++运行库，保留错误信息诊断，不从不明来源下载DLL。

## Linux / macOS

```bash
npm ci
npm run build
python3.12 -m venv .venv-ocr
.venv-ocr/bin/python -m pip install -r services/invoice_ocr/requirements.txt
.venv-ocr/bin/python -m pip check
.venv-ocr/bin/python services/invoice_ocr/server.py
```

Chrome 打开 **http://127.0.0.1:8766/?view=claims**。保持服务终端运行，关闭终端会停止。这里的 localhost 指运行服务的电脑；云端服务地址不是用户电脑地址。更新代码后先重新 `npm run build`。

`/api/r010/health` 可检查实际引擎。默认仅监听127.0.0.1，静态根目录固定构建目录dist，只允许本机同源JSON图像识别，不提供任意URL抓取/跨域接口。票据在内存识别、不写服务日志；原件和结果由浏览器本地保存。此开发服务无真实登录，不适合直接开放公网。

## 可选 PaddleOCR3.x

默认方案不需要这些依赖。只有已经取得官方权重且准备验证原生3.x时安装 `requirements-paddle.txt`。目录必须含 `PP-OCRv5_mobile_det` 和 `PP-OCRv5_mobile_rec` 的完整官方模型文件（包括 inference.pdiparams 和对应配置/模型结构），再执行：

```bash
.venv-ocr/bin/python services/invoice_ocr/server.py --engine paddle --model-root /绝对路径/模型根目录
```

适配使用3.x `predict()` 和 rec_texts/rec_scores/rec_polys，关闭文档矫正等非必要模型，拒绝在识别请求中临时下载模型。当前因模型源403，**只验证了安装及失败诊断，没有验证原生Paddle3.x推理**。正常演示使用已验证的默认RapidOCR。

## 测试与样本评估

```bash
npm test
.venv-ocr/bin/python -m unittest discover -s services/invoice_ocr -p 'test_*.py'
# 另开终端，保持默认服务运行：
R010_LOCAL_URL=http://127.0.0.1:8766 QINGBAO_BROWSER_PATH=/usr/bin/chromium npm run test:e2e -- --config=playwright.r010.config.js
node scripts/evaluate_r010.mjs
```

PowerShell 先用 `$env:R010_LOCAL_URL="http://127.0.0.1:8766"` 设置变量；未安装 `/usr/bin/chromium` 时使用本机已安装的 Playwright Chromium，或设置 QINGBAO_BROWSER_PATH 为实际浏览器绝对路径。样本评估脚本同样接受这个环境变量。结果输出 docs/r010/evaluation.json、CSV；传输测试中的测试替身不作为准确率证据。

12份已提交样票可直接使用。重新生成仅需要开发测试工具 `reportlab==4.4.4`、Pillow及Noto Sans CJK字体，执行 `scripts/create_r010_samples.py`（当前字体路径为Linux）；生成工具不属于运行时依赖，不需要真实发票。

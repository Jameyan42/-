# R010 开源选型与复现边界（2026-10-31）

本项目原来是 Vite + JavaScript 页面、TypeScript 纯规则和浏览器本地存储。统一报销在 `src/s001`，原 Tesseract 在 `src/ocr.js`，PDF 光栅化在 `src/pdf-tools.js`。本次保留技术栈、旧入口及 R001—R009，增加独立识别适配层，不整体复制别人的应用。

| 项目 | 许可证和实际查看内容 | 维护/依赖 | Windows 与结论 |
| --- | --- | --- | --- |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Apache-2.0；阅读官方 README、LICENSE，实际安装 paddleocr 3.4.0 + paddlepaddle 3.2.2 + paddlex 3.4.3 | 当前 README 有 3.7.0 发布信息；本次固定安装的 3.4.0 并非声称最新版。GitHub API 被代理拒绝，未验证 stars、归档状态或 issue 活跃度 | 官方声明 Windows/Linux/macOS、CPU。当前 Linux 中包安装和初始化成功，官方 BOS/HuggingFace/AIStudio/ModelScope 权重下载均失败（403）；没有完成 Paddle 原生推理。保留可选显式本地权重的 3.x `.predict()` 适配，禁止直接套用旧版 `.ocr(..., cls=True)` |
| [invoice-ocr-web](https://github.com/YUNJIDU/invoice-ocr-web) | MIT；实际 clone 阅读 `ocr.py`、`main.py`、requirements、LICENSE | 检查的 HEAD `b170b7174187e047dc012130988e277294f1e991`，提交时间 2026-07-25。PaddleOCR 2.9.1/Paddle 2.6.2、FastAPI、pandas、PyMuPDF 等；不能据单次提交判断持续维护 | 作者声明 Win10/11 + Python3.11.5，需要注意中文路径/USERPROFILE 和首次模型下载。旧 API、导入时解析 CLI 参数、缺金额推算或补零不适合本次“不虚构”要求。未移植其服务端和金额处理；也避免无必要引入 PyMuPDF 的许可证边界 |
| [cn-vat-invoice-ocr](https://github.com/mrliang-github/cn-vat-invoice-ocr) | MIT；实际 clone 阅读主 Python 文件、requirements、测试和 LICENSE | HEAD `acc9654e7bdaa0ad13a18dfb54cc598de4d15992`，提交时间 2026-06-28。Apple Vision/PyObjC 主路径，Tesseract 后备；不能据单次提交判断持续维护 | Apple Vision 主路径不能直接搬到 Windows。仅翻译适配显式标题和项目清洗逻辑到 `src/r010/vendor/cn-vat-fields.js`，保留完整 MIT 声明。不移植金额倒推、首号码/末税号兜底猜测 |
| [RapidOCR](https://github.com/RapidAI/RapidOCR) | Apache-2.0；安装包元数据、实际配置、模型文件及项目 LICENSE 均核对 | 实际采用 `rapidocr-onnxruntime==1.4.4`，ONNX Runtime1.23.2、NumPy1.26.4、OpenCV4.10.0.84、Pillow11.3.0。包内自带预训练 Paddle PP-OCRv4 检测/识别模型，方向分类模型为 PP-OCRv2；无需另下载 Paddle 原生权重 | 默认 CPU，本机 Linux/Python3.12.14 已真实推理。依赖支持 Windows 的路径已提供，但没有 Windows 机器实测，不能声称已验证 Windows |

## 实际采用的组合

- 文字层 PDF：沿用已安装 **PDF.js5.4.624**，按选定页直接提取文字和坐标，不调用模型。
- 图片或扫描 PDF：本机服务用 **RapidOCR1.4.4 + Paddle PP-OCRv4 ONNX**；不是自行训练，也不是“PaddleOCR3.x已经推理成功”。
- 页面静态部署：保留原 **Tesseract.js7** 后备引擎。GitHub Pages 无法运行 Python，因此在线站点不具备本机 PP-OCR 的推理能力。
- 共享字段提取：复用 MIT 标题/项目清洗，加上有文字/坐标依据的显式标签提取。不推算缺失税额，不把识别失败写成0，不用模型文本下达审批操作。

## 实际排障

1. PaddleX 默认缓存落到当前不可写的用户目录：改用项目内 `PADDLE_PDX_CACHE_HOME`，不修改 HOME 或绕过权限。
2. PaddleOCR3 原生模型源下载被403拒绝：依次检查四类官方源，保留失败结论；改用包内含合法开源权重的 ONNX CPU 路径，完成真实识别。
3. 首次依赖自动选到 NumPy2/OpenCV5：为可复现性固定 NumPy1.26/OpenCV4/ORT1.23；可选 Paddle 的 pandas 固定2.2.3以解决 NumPy依赖冲突。最终 `pip check` 实际无冲突。
4. 未关闭 TLS 校验、未请求付费 API、未上传发票到第三方。本机处理期间无外发识别接口，首次 npm/pip 安装仍需联网。

## 许可证随附

`src/r010/vendor/cn-vat-LICENSE.txt` 是所翻译函数来源的 MIT 原文；`RapidOCR-LICENSE.txt` 是 Apache2 原文。Paddle 预训练模型来源见安装包 config.yaml 和本目录 runtime.json 中 SHA256。PDF.js 与 Tesseract 继续沿用原依赖许可证。没有引入上游完整应用、Apple 专有框架或 PyMuPDF。

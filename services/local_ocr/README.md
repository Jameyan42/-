# 可选本机 RapidOCR 接入

这是实际接入主应用OCR调用链的可选引擎，不是写死识别结果。项目仍保留原Tesseract浏览器模式。服务器仅监听127.0.0.1；运行它的电脑才可打开下面地址，云端localhost不能当作用户电脑地址。

## 运行

需要Python3.10+、Node满足项目要求；首次安装依赖需要联网，无外部付费OCR API。

```bash
python3 -m venv .venv-ocr
# Linux/macOS
.venv-ocr/bin/pip install -r services/local_ocr/requirements.txt
npm ci
npm run build
.venv-ocr/bin/python services/local_ocr/server.py
```

Windows对应`.venv-ocr\Scripts\pip.exe`、`.venv-ocr\Scripts\python.exe`。本轮只实测Linux，未声称其他平台测试通过。

Chrome打开 **http://127.0.0.1:8765/**，进入员工→新建报销，可看到“本机 RapidOCR”标识。传统识别框、结构化票面采集、留存原件识别共用同一个适配器。PDF沿用选页→转图流程，只提交所选页和裁剪旋转后的识别范围。关闭服务用Ctrl+C。

`npm run dev`或GitHub Pages没有本机服务注入标志，继续使用原Tesseract，不会悄悄把资料发往127.0.0.1或任何远端。

## 项目来源与选择

2026-10-25实际读取GitHub仓库元信息及README：

- [RapidOCR](https://github.com/RapidAI/RapidOCR)，Apache-2.0。本次使用其`rapidocr-onnxruntime==1.4.4`，CPU本地检测＋识别。选择已有ONNX发行包用于小规模验证，而非复制第三方代码或调用在线演示。
- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)，Apache-2.0，中文文档方向，可进一步比较更强模型及版面解析，但本轮未接入完整PaddleOCR框架。
- [Scribe.js](https://github.com/scribeocr/scribe.js)，AGPL-3.0。本轮未引入；其许可条件与前两者不同，不能按Apache组件直接替换分发。

第三方引擎通过pip安装，未把仓库源码或模型文件复制进Git提交。发行/部署时应保留安装包及模型中的许可证和NOTICE；不是因为开源就没有署名/许可证义务。

## 接口与数据范围

`POST /api/ocr`，JSON字段`image`为PNG/JPG等图像的base64；本应用发送最大2200边长预处理后的PNG。不接收任意服务器文件路径或外部URL。

- 最多8MB请求体、1000万像素；解码检查格式，非同源Origin/非本机Host拒绝；不启用跨域CORS；单任务锁，忙碌返回429。
- 返回识别行、框、置信度和原文，不保存票据文件、原文或请求体。前端关闭后不额外保存原文，仍按已有流程人工确认后才写结构化票面字段。
- 前端取消/90秒超时会中止请求；Python已经开始的CPU推理可能继续至该次结束，不宣称强制杀停模型任务。
- 使用ONNX Runtime提供的API禁用telemetry事件。首次Python依赖安装、浏览器加载本机静态模型资源与票据上传到云端是不同的事情。
- 此服务不是生产后端：无账号、审计、TLS或多用户任务队列。不能把监听地址改为公网直接承载真实财务数据。

## 实际验证（2026-10-25）

直接CPU推理：虚构demo图片约0.78秒，结构化虚构图片约1.55秒，仅为当前机器两样本耗时，非性能承诺。

启动服务后：

```bash
QINGBAO_BROWSER_PATH=/usr/bin/chromium node services/local_ocr/browser-check.cjs
```

本轮实际通过：结构化PNG的10个字段精确比对（号码、代码、日期、双方名称/税号、不含税金额、税额、价税合计）；电子PDF识别金额106.00元；原报销识别框图片号码和268.50元；3次识别均只POST本机同源；外部Origin403、坏base64 400；页面脚本错误0。结果写到`/tmp/qingbao-local-ocr-proof.json`，不会把发票原文打印到生产服务日志。

这些样本是项目虚构样票，不是完整真实发票基准。未覆盖所有发票版式、旋转模糊、印章、二维码、银行开户信息、逐行商品明细及红票。识别完整文字也不等于结构化字段完整或真实有效。真实效果需要用户提供脱敏失败样本，逐字段标注期望值再测试；不承诺100%完整。

## 现有GitHub网页的限制

GitHub Pages只能托管静态网页，不能运行Python/ONNX。**本轮接通并实测的是本机模式，公开网页没有被宣称升级为RapidOCR。** 若未来希望在线网页也使用此引擎，需要单独部署受控后端、权限/上传说明和数据处理策略，再授权接入；不把发票发到陌生第三方演示站。

回归实际执行：`npm test` 259通过/0失败（含R001–R003类型检查），`QINGBAO_BROWSER_PATH=/usr/bin/chromium npm run test:e2e -- --workers=2 e2e/ocr.spec.js e2e/pdf-ocr.spec.js e2e/invoice-data.spec.js` 23通过/0失败；`npm run build`成功。未宣称重新执行本轮全部157项浏览器测试。

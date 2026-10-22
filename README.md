# 轻报 · 费控产品经理作品

在线体验：https://jameyan42.github.io/-/

面向 200 人成长型企业的中文响应式网页原型。支持员工报销、主管审批、财务审核、付款登记、规则预审、预算预警、发票关联台账、草稿与撤回、操作记录和备份恢复。使用虚构数据，尚无真实客户、业务运营指标或生产级身份系统。

## 本轮：真实浏览器 OCR

员工 → 新建报销 → 选择 PNG/JPG/WebP → 按需旋转、裁剪 → 识别图片 → 核对候选号码和金额 → 勾选确认并填入。也可点击“载入虚构样票”。

引擎为 Tesseract.js，模型与 Worker 由同一站点提供，无外部 OCR API、无密钥、无图片上传。首次按设备加载约 10 MB 数据；浏览器只保存字段、附件名称与核对来源，不保存原图或识别原文。OCR 不等于验真；候选提取可能失败，必须人工核对。PDF 暂不识别，仍可手工报销。

## 运行与验证

需要 Node.js 20.19+ 或 22.12+。生成单文件演示需要 Python 3。

```sh
npm ci
npm run dev
npm test
npm run build
```

predev/prebuild 自动从 lockfile 安装的 npm 包准备本地 OCR 资源，不依赖外部 CDN。

浏览器场景：

```sh
npx playwright install chromium
npm run test:e2e
```

当前云环境已安装 Chromium：`QINGBAO_BROWSER_PATH=/usr/bin/chromium npm run test:e2e`。测试使用公开虚构样票，并真正运行 OCR 引擎，不把写死文本当作识别结果。

## 发布与作品材料

先执行 `npm run export:demo`，提交源码后运行 `python3 scripts/publish_pages.py --publish` 更新已有 gh-pages。main 的工作流只验证构建，网站由 gh-pages 更新发布。单文件的基础报销功能可直接打开；OCR 需要 HTTP/HTTPS 网页与配套资源，请使用在线版或开发服务。

- [项目待办与授权边界](docs/项目待办.md)
- [产品需求与面试演示](docs/产品需求与面试演示.md)
- [产品经理面试案例](docs/产品经理面试案例.md)
- [OCR 设计与验证](docs/OCR设计与验证.md)
- [打开与发布](docs/打开与发布.md)
- 网页“项目案例”可打印或保存 PDF。

付款只登记记录，不连接银行。角色切换是演示机制，日志不防篡改；请勿用于真实财务数据。

## v0.6 体验打磨

新增旋转、四侧裁剪与恢复原图；调整图片后不覆盖已填字段，需重新识别核对。体验测试页可按角色进入任务并导出空白记录表，仍无真实用户测试结论。

# S003 发布核对

日期：2026-11-05。

- 后端实现提交：`18ef8ba`。
- 功能清单与Excel提交：`cc30da1`，已非强制推送至既有仓库main。
- 既有静态演示更新：gh-pages `16688e3fd67b48f025ea6702b5819d5f0d0008cc`；只更新原演示和只读旧数据备份工具，不代表后端已上线。
- 按不可变提交读取的README、Excel、静态主页面和只读备份工具均实际HTTP200，SHA256与本地一致。详见下表。
- GitHub Actions状态查询实际返回Forbidden，尚不能确认远端业务CI运行结果；本地已执行的测试见TEST_REPORT.md。
- 业务后端只在本地及本机Docker环境验证；没有真实公网业务URL、域名证书或企业验收。云端127.0.0.1不是用户电脑地址。
- 未上传任何测试账号密码、私有文件目录、数据库或完整旧备份；原四个既有未跟踪文件未纳入本轮提交。

| 核对对象 | HTTP | 与本地一致 |
| --- | --- | --- |
| https://raw.githubusercontent.com/Jameyan42/-/cc30da1/README.md | 200 | 是 |
| https://raw.githubusercontent.com/Jameyan42/-/cc30da1/deliverables/qingbao-feature-history.xlsx | 200 | 是 |
| https://raw.githubusercontent.com/Jameyan42/-/16688e3fd67b48f025ea6702b5819d5f0d0008cc/samples/legacy-backup.html | 200 | 是 |
| https://raw.githubusercontent.com/Jameyan42/-/16688e3fd67b48f025ea6702b5819d5f0d0008cc/index.html | 200 | 是 |

# S003 本地运行与部署手册

Node22.12+、PostgreSQL16、Docker（可选但推荐）。正式业务必须通过后端同源地址打开；`npm run dev`仍是旧浏览器演示，GitHub Pages也仍是静态演示。

## 本地首次启动

1. `npm ci`。复制根目录`.env.example`为`.env`，填写本机PostgreSQL地址和独立密码，生成至少32字符SESSION_SECRET。`.env`不得提交，不使用示例占位值。推荐用密码管理器；需要APP_DB_PASSWORD时用随机十六进制。
2. 准备空数据库如qingbao_dev和迁移owner；配置DATABASE_URL为qb_app、MIGRATION_DATABASE_URL为owner。`npm run db:migrate`创建迁移和应用角色/授权。APP_DB_PASSWORD只供首次创建qb_app；后续轮换密码应由DB管理员明确执行，脚本不默默覆盖已有密码。
3. 在本机环境临时设置BOOTSTRAP_USERNAME、BOOTSTRAP_PASSWORD，执行`npm run db:bootstrap`。仅空用户库可以初始化，不存在默认管理员或公开注册；完成后移除bootstrap密码变量。
4. `npm run build`，然后`npm run server`。Chrome打开`.env`指定的PUBLIC_ORIGIN，默认`http://127.0.0.1:8780`。localhost与127.0.0.1是不同来源，须与配置一致。云端localhost不是用户电脑地址。
5. 首次登录更改密码；管理员创建部门、主管B、财务C和员工A，给A分配直属主管B；每人用自己的账号和初始密码首次改密。
6. 管理员维护真实公司名称、税号、适用起日和住宿标准（每晚单位为整数分）。没有制度不自动套用虚构标准。第一版政策以校验JSON维护，示例结构为`{"version":1,"updatedAt":"合法ISO时间","rows":[{"id":"公司自定编号","city":"实际城市","grade":"普通员工","nightlyRateCents":公司真实标准的整数分}]}`，请替换为公司正式批准的数据。

本地业务开发修改前端后重新`npm run build`；修改后端后重启`npm run server`。后端环境配置只在服务端使用，不写VITE变量或浏览器存储。正式原件目录建议放在项目目录之外；程序禁止public/dist作为私有目录，开发服务也屏蔽.data等敏感路径，正式业务不运行Vite。

## 常规Docker Compose部署（需正常构建网络）

在境内选定服务器，准备真实域名、DNS和80/443。生产`.env`设置DOMAIN、DB_OWNER_PASSWORD、APP_DB_PASSWORD、SESSION_SECRET及初始bootstrap变量；不在聊天中分享密码/私钥。

```sh
docker compose --env-file .env -f deploy/compose.yml up -d db
docker compose --env-file .env -f deploy/compose.yml build app
docker compose --env-file .env -f deploy/compose.yml --profile tools run --rm migrate
docker compose --env-file .env -f deploy/compose.yml --profile tools run --rm bootstrap
docker compose --env-file .env -f deploy/compose.yml up -d app caddy
```

迁移owner凭据仅给tools服务，不给长期运行的app。数据库和app不发布公网端口，Caddy对外80/443并自动HTTPS；TRUST_PROXY=1只适用于此单层反向代理，不能直接把app端口暴露公网。命名卷保存DB、原件、证书。服务以非root node用户运行。

**本环境Docker构建网络DNS失败；早期系统包安装路径失败后已移除不必要的系统包安装，常规Docker内npm安装路径仍未在本环境验证完成。** 实际验证的是下面的预打包路径。没有关闭证书校验或放宽文件/DB权限。

## 已实际验证的预打包镜像路径

Docker构建器不能联网时，可在相同Linux架构的受控构建机先安装锁定生产依赖并打包；不是把开发凭据或整个工作区复制进镜像。

```sh
npm ci
npm run build
npm run typecheck:server
node scripts/package_business.mjs .data/business-image-context
docker build -t qingbao-business:local .data/business-image-context
```

脚本拒绝覆盖既有打包目录，仅放入package/lock、生产node_modules、server/src/dist，不包含.env、DB、私有附件、测试凭据或工作区备份。需Linux/对应CPU架构，不能把Windows原生模块直接用于Linux镜像。本环境实际构建并运行了此镜像，经过授权HTTP读取、原件哈希、DB/app重启验证；本地测试容器用了HTTP测试模式，不等于生产TLS验收。

可将已构建镜像标记为Compose的`qingbao-business:local`，然后执行上述迁移/bootstrap/启动命令。两种业务镜像均不内置pg_dump；备份使用DB容器内与服务版本匹配的PostgreSQL工具，或运维主机上版本不低于服务端的工具。web容器不挂载Docker socket。

## 更新、迁移和回滚

发布前保留DB+附件一致备份、原镜像标记及其源码提交。先在测试库执行迁移和验收，再在维护窗口更新生产。迁移按文件序号和SHA256追踪，已执行SQL不能原地改写。

本轮迁移新增表/字段，未提供任意数据库降级。代码回滚仅在原版本兼容当前schema时可执行；不兼容时应恢复到新空库/新私有目录、验证后切换连接与文件目录，不能覆盖唯一生产副本。不要使用`docker compose down -v`删除正式命名卷。

## 日志与运维

`docker compose --env-file .env -f deploy/compose.yml logs --tail=100 app db`。应用错误日志记录类别/PG错误码，不输出密码、SQL参数、原件或完整请求正文；操作历史保存在operations并通过单据页/我的处理页显示。调试堆栈仅显式S003_DEBUG=1且非production，正式不要启用。

监测数据库健康、磁盘空间、5xx、备份失败及账号停用/权限变更。首版为单一写入实例、同一受控附件存储；不要把多个写入实例连接同一DB却各用不同附件目录。没有故障转移或异地灾备SLA。

## 安全上线前提

确定中国境内部署地域、域名/备案适用要求、公司授权、员工告知与留存/删除制度；数据库/备份/附件采用受控加密磁盘或存储及最小运维权限。服务不自动上传到境外对象存储或模型服务。没有完成这些检查，不接收真实员工财务资料。

当前未上线真实服务器，未申请真实域名证书，未做真实异机/企业验收；不要把本地Docker测试或静态演示站点称为正式上线。

## 本地测试命令

仅对独立、明确命名为`*_dev`的虚构数据数据库设置`S003_TEST_ALLOW_WRITE=1`。测试会创建账号、修改该测试公司的政策和写入虚构报销，不能指向真实公司库。

```sh
npm test
npm run typecheck:server
# 另开终端先保持业务服务运行；没有初始用户时测试会命令行创建随机测试管理员：
S003_TEST_ALLOW_WRITE=1 npm run test:server
S003_TEST_ALLOW_WRITE=1 DB_TOOLS_CONTAINER=你的开发PG容器名 npm run test:ops
S003_BUSINESS_URL=http://127.0.0.1:8780 QINGBAO_BROWSER_PATH=/实际Chromium路径 npm run test:e2e -- --config=playwright.business.config.js
```

无显式浏览器路径时使用Playwright已安装的Chromium。测试专用账号随机密码仅在被Git忽略的`.data`中，不能复制到生产；CI中的临时数据库口令也只用于一次性虚构环境。

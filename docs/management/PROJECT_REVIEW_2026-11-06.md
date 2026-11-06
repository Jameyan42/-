# 轻报｜项目复核与开发治理基线

日期：2026-11-06（Asia/Shanghai）；源码基线：`65f15ae`，分支work。范围：仓库目录、架构/业务关键源码、现有测试与部署/数据库结构；不是逐行形式化证明、渗透测试或生产认证。

本轮仅新增文档，未修改业务代码、依赖、配置、数据库数据或原模拟样本。

## 1. 检查方法与工作区保护

- 扫描源码/服务/脚本/测试/部署目录252个文件路径及全仓库404个已跟踪文件的组织情况，重点阅读真实调用链，不以文件名认定功能完成。
- 重点代码：bootstrap、业务UI/API、schema、audit、db/migrate、files、legacy、backup、三份SQL迁移；原规则registry及R005/R009/OCR服务；测试、Docker/Compose、CI和已有交付记录。
- 本轮未逐个重新运行所有演示模块或Python模型，不声称已重新验收全部旧功能。
- 原未跟踪文件 `PROJECT_AUDIT_REPORT.md`、`deliverables/desktop.png`、`deliverables/mobile.png`、`deliverables/qingbao-project.zip`保持原状，不覆盖、不纳入本轮提交。

## 2. 整体判断

系统已经从纯浏览器演示补齐了真实单公司后端，员工到财务付款登记的主链有代码、数据库约束和本地测试证据。当前不是“只有界面”，也不是可以直接向真实企业公开收集财务资料的已上线产品。

主要差距：稳定可访问的业务环境、运维/恢复责任、真实企业制度和异机验收，以及本轮发现的部分财务口径/管理操作缺口。R005更多规则不应抢在这些事项之前。

## 3. 实际技术架构与目录

| 位置 | 真实作用 |
| --- | --- |
| package.json、vite.config.js、index.html | npm命令、Vite多入口构建、统一前端加载；原生JS+TS规则，不是React |
| src/bootstrap.js | 后端meta选择业务UI，静态站选择旧主系统；不是安全边界 |
| src/business/ | 同源API登录、报销、附件、审批、付款、筛选、公司/用户管理界面 |
| server/app.ts | Express认证、授权、输入、业务状态、原件下载、台账和API |
| server/schema.ts、audit.ts | 金额/日期/分摊规范化，服务端调用原R001—R004 |
| server/db.ts、migrate.ts、migrations/ | PG事务、维护锁、审计、迁移SHA校验、数据库角色和约束 |
| server/files.ts、legacy.ts、backup.ts | 私有原件、完整旧备份及显式草稿迁移、一致DB+文件备份/新空库恢复 |
| src/main.js及src下旧业务模块 | 原费控工作台；本地演示角色与持久化不能当正式权限/数据库 |
| src/r001、src/r002、src/s001 | 纯规则和统一模型；R005—R008大部分仍为浏览器规则/业务能力 |
| src/r003、r003.html | 旧合同付款审核，不要与统一R003发票金额一致性混淆 |
| src/s002、docs/s002 | 隔离实验及冻结源，继续保留，不作为正式公司台账 |
| services/invoice_ocr、services/local_ocr | 可选本机OCR；没有代替正式业务认证/数据库 |
| deploy、.github/workflows | 镜像、Compose/Caddy、备份模板和CI配置，不代表已经正式部署/启用 |
| e2e、business-e2e、*.test.* | 原页面、业务页面、纯规则和服务端/恢复测试，分别选择执行 |

浏览器输入→后端校验→DB草稿/原件关联→提交时人员/政策快照及发票占用→主管→财务重审→待付款→财务登记线下付款。浏览器正式业务不以localStorage作为数据源；原浏览器演示和只读旧数据备份仍保留。

## 4. 当前数据库只读核对

本次实际连接已有开发数据库，用 `BEGIN READ ONLY` 查询结构和迁移，不读取/输出员工姓名、密码、单据内容或原件。

- PostgreSQL实际版本 **16.15**。
- 17张public表：company、departments、users、sessions、claims、expense_lines、invoices、invoice_lines、invoice_occupancy、attachments、claim_versions、operations、payments、payment_corrections、payment_references、legacy_imports、schema_migrations。
- 001_initial.sql、002_actor_snapshot.sql、003_payment_reference_registry.sql均已记录；后续应使用未占用的新迁移编号，不修改已执行文件。
- qb_app不是superuser，不可createdb/createrole；查询schema_migrations返回42501符合当前权限设计，随后使用迁移连接只读核对，不为检查放宽权限。
- 金额BIGINT分；单号/付款/参考号唯一；人员与单据及分摊有外键；审计、版本和付款有不可变触发器及权限限制。
- 原件字节在私有目录，DB保存UUID、哈希、用途与单据引用；会话在PG，不是正式文件数据库之外的浏览器唯一副本。
- 已有备份恢复测试，但本轮没有再次执行恢复或更改任何库。

## 5. 功能盘点

| 功能 | 实际判断 | 证据与限制 |
| --- | --- | --- |
| 四角色登录/首次改密/停用 | 本地已验证 | app.ts、bootstrap.ts、integration.test.ts；无MFA/SSO/自助找回 |
| 公司/部门/人员/直属主管 | 部分完成 | 有UI和API；密码重置与待办重分配接口缺专门UI；政策JSON维护不够友好 |
| 多明细、多票分摊、草稿/重提 | 本地已验证 | schema.ts、replacePayload及提交接口；人民币/四类型/需发票，不支持任意费用业务 |
| 私有原件及完整性 | 本地已验证 | files.ts及受控路由；PDF/JPG/PNG/XML/OFD，10MB/件/50有效件；下载不代表完整语义扫描 |
| 主管/财务审批、终态保护 | 本地已验证 | app.ts状态与角色/版本检查、事务/行锁；固定两阶段，不是原复杂审批树生产化 |
| R001住宿 | 服务端已接入 | audit.ts调用原规则，标准独立，公司快照；原规则测试保留 |
| R002查重 | 服务端已接入 | 票面比较+invoice_occupancy原子唯一占用；自身重提排除；状态翻译/释放证据仍需专项边界验收 |
| R003金额 | 服务端已接入 | 分摊数据组装、原amountRule和policyOutcome，不是合同审核 |
| R004抬头税号 | 服务端已接入 | 单公司主数据构造上下文；手工录入核对不等于真伪验证 |
| R005科目 | 业务后端尚未开发 | account-rule.ts、r005.test.ts为旧能力；S004只有指令文档，不能标完成 |
| R006/R007/R008 | 演示能力保留 | 旧流程材料/预算/规则中心有实现，未完整接入PG业务；已有固定审批/原件限制不是完整R006迁移 |
| R009 | 模拟辅助分析 | ai-service.ts明确LOCAL_DEMO；真实adapter未配置，不能称真实AI审核 |
| R010 | 演示/可选本机识别 | Python RapidOCR/Paddle适配和浏览器后备存在；未接业务API；真实脱敏票准确率尚未验证 |
| 付款登记/追加更正 | 部分完成 | app.ts、payments/ corrections/reference注册表；原始金额不可改，最新更正与CSV口径需完善 |
| 查询/权限导出 | 本地已验证，部分口径待修 | 过滤来自服务端visibility；CSV当前取原payment_date，筛选按创建日期 |
| 原操作/版本/快照 | 本地已验证 | operations/claim_versions/快照；不是不能被超级DB管理员更改的外部防篡改系统 |
| 旧数据迁移 | 部分完成 | 原备份字节保留，仅合法S001映射真实员工为草稿；不自动继承旧批准/已付 |
| 备份/恢复/重启 | 本地历史验证 | backup.ts、ops.test.ts、validation.json；正式定时/加密/留存/报警未启用 |
| 部署/10—50人试用 | 未验收 | 本地镜像可运行；没有已交付业务公网URL/HTTPS/物理异机/企业验收与负载证据 |

## 6. 本次发现的问题与风险

| 问题 | 证据及实际影响 | 处理建议 |
| --- | --- | --- |
| 付款更正与CSV口径不一致 | payment-correction追加corrected_date等；ledger.csv只JOIN payments并输出payment_date；更正日期未成为导出当前值 | 第一项代码任务：明确定义原登记与有效更正，查询/详情/导出一致，保留原记录，验证多次更正 |
| 公司制度有静默覆盖风险 | PUT /api/admin/company未要求预期policy_version，更新虽自增却未比较旧版本 | 小步补并发版本控制/冲突提示，保留历史快照 |
| 关键管理操作不方便使用 | 有密码重置和reassign接口；业务UI未调用对应接口，不能方便完成忘密/主管离职接管 | 复用现有API补界面，不重建认证或审批系统 |
| 部分服务端/界面长行与any过多 | app.ts、backup.ts、ui.js较多整段单行，Payload为any[]，增加审阅维护难度 | 新增代码使用明确类型与可读模块；按任务局部改善，不以检查名义全仓库重构 |
| 文件与DB并非原子共同提交 | 上传/迁移在DB事务内先storeFile，后续DB失败不会回滚磁盘原件 | 记录孤立文件风险、规划安全盘点/保留；本轮不得清理删除 |
| 上线能力未落实 | Compose/Caddy/定时器只是配置，未有真实域名与公司运维证据 | 受控目标环境运行HTTPS、权限、恢复和报警验收 |
| 真实安全边界未充分验证 | 无完整病毒/文档沙箱、独立渗透、真实容量与终端安全验收 | 结合试用范围评估和验证；不因单测通过宣布安全审计完成 |
| 历史功能容易被当作正式功能 | 同仓库保留演示入口、旧合同R003、AI/预算和S002 | PRD明确状态和命名，真实业务只走authenticated backend |

尚未证实为错误、但必须核查：R002历史状态映射与企业释放制度、兼任角色的职责分离、策略停用和历史单解释、真实容量和上传压力。不能只凭静态检查宣称这些都存在漏洞或已经安全。

## 7. 本次实际运行结果

| 本次命令/动作 | 结果 | 范围 |
| --- | --- | --- |
| npm run typecheck:server | 通过 | 后端TS静态检查；不是运行时全验收 |
| npm test | 470项通过，0失败 | 原JS168、R00122、R00235、合同R00334、S001211，合计470 |
| node --import tsx --test server/time.test.ts server/config.test.ts | 6项通过，0失败 | 不写业务数据的日期/安全配置测试 |
| node scripts/freeze_s002.mjs | 原冻结一致 | cd21c40e1c8f32fac572d58a929aa86ba91be7c1b1587b018053b4d1eff69045 |
| GET 127.0.0.1:8780/api/health | ok:true，business/postgresql | 当前本地服务和DB可响应，不代表用户电脑可访问 |
| PG只读结构/角色/迁移查询 | 成功 | 17表、PG16.15、3迁移、非超级用户运行角色 |

历史记录，**本轮未重跑**：S003服务端21项、业务浏览器4项、恢复3项、原浏览器220项通过/4本机OCR跳过，及22项额外页面回归；见docs/s003/TEST_REPORT.md和validation.json。历史21项含本轮重跑的配置/日历6项，不重复相加制造新增覆盖数量。

本轮未安装依赖、未升级版本、未构建或部署新业务版本、未重启服务、未运行写库集成/恢复/浏览器主链。此前远端CI查询Forbidden，不能确认远端CI成功；文档提交触发工作流也不等于结果通过。

## 8. 下一步和试用判断

优先完成受控试用准入：先处理付款更正台账一致性、政策并发和管理入口，再在真正目标环境启用HTTPS、私有存储、备份/报警、恢复演练以及企业异机验收。

R005并非不能做，而是不应因已有指令就自动优先于主链可靠性；保留S004规格，待公司科目需求确认和前述事项推进后按单项开发。

**当前具备继续开发和使用虚构资料受控联调的条件；尚不具备直接公开接收真实公司员工财务资料的试用条件。**

## 9. 本轮治理文档

- 根目录AGENTS.md：后续代理的项目目标、栈、范围、安全、测试、Git与完成定义。
- 根目录PRODUCT_REQUIREMENTS.md：真实功能/演示能力、角色、流程、准入及需求状态。
- 根目录DEVELOPMENT_PLAN.md：有依赖的单项任务、优先级、验收和回退。
- 本文：本次检查证据；保留旧S003记录不改写历史，也不覆盖原未跟踪审计报告。

本轮文档不授权新增财务数据、付费资源、数据删除或公开范围变化；后续任务仍按用户范围执行。

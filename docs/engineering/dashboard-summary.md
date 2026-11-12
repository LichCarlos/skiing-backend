# 全局工作台汇总

2026-10-31，API-M01 / ADM-01，用户已确认《工作台汇总接口定版建议》。OpenAPI 1.45.0，复用既有表，无 migration。

`GET /api/v1/admin/dashboard/summary` 无查询参数，任何参数返回400；有效登录及 `management:portal:enter` 必需。响应固定 generatedAt 和 users、merchants、resorts、articles、dynamics、rag、revenue；无面板授权/前置商家资料时为 null，有权的空统计为0。Cache-Control: no-store，无审计或 Outbox 副作用。

## 查询与授权

Controller仅验证参数和提取服务端身份；GetDashboardSummary依赖DashboardReader端口，PrismaDashboardReader负责数据库快照和投影。专用RequireManagementEntry元数据让认证守卫验证会话，授权守卫仅验证管理入口；普通路由仍必须声明具体授权，不能用空权限绕过检查。入口不解析多个角色的入口数据范围，各业务面板独立解析。

用户与商家资料复用用户列表scopeWhere；文章复用articleWhere；商家雪场和收益复用merchantResortWhere，始终与本人有效商家归属求交。全局雪场优先且只支持all，非法范围403，不回退商家分支。已选择面板的冲突/不支持范围使整个请求403，未授权分支不执行业务查询。动态沿用全局审核可见性，仍检查有效权限范围。

RAG失败数量与全局收益另查有效RoleKey及SystemRoleCode均为system_admin的受保护身份。全局收益新增独立只读 `revenue:system:summary`，与写收益权限分离。权限目录seed补到内置管理员；已有普通/自定义角色保持显式授权，不被重复seed扩权。仅授予自定义角色该grant不会开放全局收益。

商家收益根据revenue:merchant:list解析resort范围；全局收益与商家收益均排除软删除雪场，与现有有效收益查询一致。所有时间累计，不附加日期、同比或趋势。Prisma.Decimal聚合和toFixed(2)，金额不转JS浮点，空数据为"0.00"。

## 快照与验收边界

主体、角色、grant、数据范围、受保护身份与全部聚合均位于同一个RepeatableRead交互事务；显式SET TRANSACTION READ ONLY。下一请求重新读取授权。快照建立后的撤权不能追溯取消该请求，不能宣称即时中止所有在途读取。

真实数据库/HTTP专项38项覆盖认证/入口/未知参数、user四类范围、article三类范围、非法范围、商家四类范围和归属交集、优先分支、停用/软删除、各状态求和、精确大金额/空金额、RAG专属授权、五类范围冲突、下一请求撤权、并发变更下同快照与只读标志、无写入副作用。单元测试另验证未授权面板不执行SQL、伪管理员角色键不能读取专属统计。浏览器点击/API工作流和性能压测未验收。

首轮测试夹具修正了登录HTTP状态、分类字典准备、selected范围应写RoleDataScope而非Role.DataScope、停用商家范围的预期；失败日志保留。测试清理仅移除本套件创建的UUID前缀记录。完整三仓结果见本阶段追踪矩阵。

## 本轮完整证据

三仓独立冻结安装通过；本仓check 120文件881单测、HTTP 3文件88项、数据库31文件728项（含本功能38项）、build/OpenAPI及前后db:verify通过，20迁移无变化。日志dashboard-check.log、dashboard-http.log、dashboard-db-full.log、dashboard-openapi-final.log、dashboard-db-after.log与dashboard-baseline-after.log保留。Web699项及双端构建、App342项/Doctor20/20/三平台导出通过；OpenAPI1.45.0快照三仓一致。原数据、验证容器及开发进程保留。

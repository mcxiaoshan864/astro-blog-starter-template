# 留言板

公开入口是 `/about/#guestbook`，管理员登录后进入 `/admin/guestbook/`。

访客只填写昵称（1–24 字）和留言（1–1000 字）。提交后默认待审核；站长可以公开、撤回公开、回复、移除回复和删除。回复待审核留言不会自动公开。所有内容均为纯文本，不执行 HTML，不接收附件、邮箱或头像。

## Cloudflare 配置

- D1：`mcxiaoshan-guestbook`，绑定 `GUESTBOOK_DB`，表结构保存在 `migrations/0001_guestbook.sql`。
- 首次部署前应用迁移：`wrangler d1 migrations apply mcxiaoshan-guestbook --remote`。通过 API 首次建表时也应记录到 `d1_migrations`，后续仍可使用 Wrangler 迁移。
- `TURNSTILE_SECRET` 保存在现有 Worker 的 secret 中，不写入仓库。
- `TURNSTILE_HOSTNAMES` 在 Wrangler 配置中限定生产域名，服务端还要求验证结果 hostname 与请求 hostname 完全相等，action 为 `guestbook`，success 严格为 true。
- widget 允许本机开发域名，但生产验证白名单不允许本机域名。
- `GUESTBOOK_LIMITER` 限制每个 IP 每分钟 3 次提交尝试（Cloudflare 边缘限流，非全球精确配额）。不把 IP、验证 token 或浏览器信息写入留言表。

接口：`GET /api/guestbook` 仅返回已公开留言，按 ID 倒序每页 20 条，以 `cursor` 翻页；`POST` 接受 JSON `{nickname,message,token}`，成功返回 202，不泄露待审核留言 ID。数据库语句全部参数化。接口禁止跨站提交、限制请求体大小，验证服务异常时拒绝提交。

管理操作位于 `/admin/guestbook/action`，必须通过已有管理员会话和同源 POST 检查。继承管理区的私有缓存、安全响应头和 CSP。

浏览器提交完成后会重置 Turnstile，确保重试获取新 token；Astro 页面切换时销毁旧 widget，重新进入关于页时重新初始化，不重复绑定。

## 验证

`npm run check`，随后执行 `node --test tests/*.test.mjs tests/*.integration.mjs`。集成测试使用隔离的 Miniflare D1 和一次性管理员配置，不读取生产凭据。Turnstile 用出站 mock 检查完整服务端链路；真实 widget 的首次成功和重放校验需要在已部署页面单独验证，不以测试 key 替代生产 key。

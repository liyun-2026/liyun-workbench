# SSL 证书手动续期指南（备用，仅在自动续期失败时使用）

EdgeOne 免费证书有效期 90 天，**到期前 15 天平台自动续期**（官方规则），正常情况无需人工操作。
巡检会在剩 10 天仍未见换新时报警。若触发报警，按以下步骤手动申请：

1. 登录腾讯云控制台 → 搜索「EdgeOne」（边缘安全加速平台）→ 站点列表 → 选择 liyun2026.top
2. 左侧导航：域名服务 → 域名管理
3. 找到 liyun2026.top 那一行 →「HTTPS」列 → 点「配置」
4. 「边缘 HTTPS 证书」卡片 → 点「配置」→ 配置方式选「申请免费证书」
5. 验证方式选「**DNS 委派验证**」（不要选自动验证——CNAME 接入下自动验证会导致申请期间 HTTPS 短暂不可用）
6. 按提示到 DNS 解析（DNSPod）添加一条 CNAME 验证记录 → 回到 EO 控制台等待验证通过
7. CA 签发后证书自动部署，无需手动安装

完成后验证：
- 浏览器打开 https://liyun2026.top 看小锁图标
- 终端：`echo | openssl s_client -connect liyun2026.top:443 -servername liyun2026.top 2>/dev/null | openssl x509 -noout -dates`（notAfter 应变为新日期）

注意：域名 liyun2026.top 本身 2027-09-18 到期，那是域名注册续费（另一件事），不要混淆。

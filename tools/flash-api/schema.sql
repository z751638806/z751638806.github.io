-- peipei-flash-api D1 schema
-- 表：刷写事件 / 反馈 / 公告 / 激活码 / 付费固件（M6）/ 取件授权（M6）
-- M7 投稿表后续 ALTER 追加

CREATE TABLE IF NOT EXISTS flash_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,               -- epoch ms
  device TEXT NOT NULL,              -- BW16 / ESP8266 / ...
  firmware TEXT NOT NULL,            -- 固件显示名或 slug
  success INTEGER NOT NULL,          -- 1/0
  duration_s REAL,
  err TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON flash_events(ts);
CREATE INDEX IF NOT EXISTS idx_events_fw ON flash_events(firmware);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  contact TEXT,                      -- 可选联系方式
  message TEXT NOT NULL,
  log TEXT,                          -- 可选日志摘要
  handled INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_feedback_ts ON feedback(ts);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL,                -- 绑定固件 slug；'*' 表示通用
  note TEXT,
  created_ts INTEGER NOT NULL,
  redeemed_ts INTEGER,
  status TEXT NOT NULL DEFAULT 'unused'   -- unused / redeemed / disabled
);

-- M6 付费固件注册表：bin 实体存 R2（PICKUP 绑定），D1 只存元数据
CREATE TABLE IF NOT EXISTS paid_fw (
  slug TEXT PRIMARY KEY,             -- 与站点清单 slug 一致（如 bw16-19）
  device TEXT NOT NULL DEFAULT 'bw16',
  name TEXT,
  files TEXT NOT NULL DEFAULT '{}',  -- {文件名: {size, sha256}}，上传时回填
  active INTEGER NOT NULL DEFAULT 1,
  updated_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paid_active ON paid_fw(active);

-- M6 取件授权：一次 begin 产生 N 条（每文件一条），一次性核销 + 短时效
CREATE TABLE IF NOT EXISTS pickup_grants (
  jti TEXT PRIMARY KEY,              -- 随机 128bit，不可枚举
  slug TEXT NOT NULL,
  file TEXT NOT NULL,
  code_id INTEGER,                   -- 关联 codes.id
  fp TEXT,                           -- 浏览器指纹绑定（可空）
  created_ts INTEGER NOT NULL,
  exp_ts INTEGER NOT NULL,
  used_ts INTEGER
);
CREATE INDEX IF NOT EXISTS idx_grants_slug ON pickup_grants(slug, created_ts);

-- ============ v2 完整网站后台（2026-10-01） ============
-- 原则：只新增表，不改旧表（无 ALTER，schema.sql 可重复执行，部署幂等）。
-- users       注册用户（烧录页 backend.js 契约：loginId + 密码 + 额度）
-- credit_codes 额度卡密（与 M6 取件码 codes 表相互独立，语义：兑换 +N 次刷写额度）
-- flash_sessions / flash_grants  api 模式刷写会话与一次性镜像链接（与 pickup_grants 同构 + 用户维度）
-- catalog_fw  api 模式固件目录（manifests 的 D1 化，bin 实体同样存 PICKUP）
-- site_content 主站内容块（JSON，主页水合脚本消费，静态内容为兜底）
-- quota_log   额度流水（审计：注册赠送/卡密兑换/刷写扣减/失败退还/管理员调整）

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login_id TEXT NOT NULL UNIQUE,      -- 登录标识（用户名/邮箱样式，唯一）
  pw_hash TEXT NOT NULL,              -- pbkdf2$<iter>$<saltHex>$<hashHex>
  quota INTEGER NOT NULL DEFAULT 0,   -- 剩余 BW16 刷写次数
  status TEXT NOT NULL DEFAULT 'active',  -- active / disabled
  role TEXT NOT NULL DEFAULT 'user',  -- user / admin（预留）
  created_ts INTEGER NOT NULL,
  last_login_ts INTEGER
);

CREATE TABLE IF NOT EXISTS credit_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  credits INTEGER NOT NULL DEFAULT 1, -- 兑换后 +N 次额度
  note TEXT,
  created_ts INTEGER NOT NULL,
  redeemed_ts INTEGER,
  redeemed_by INTEGER,                -- users.id
  status TEXT NOT NULL DEFAULT 'unused'   -- unused / redeemed / disabled
);

CREATE TABLE IF NOT EXISTS flash_sessions (
  session_id TEXT PRIMARY KEY,        -- 公开会话 id（前端 /api/flash/end 回传）
  user_id INTEGER,
  slug TEXT NOT NULL,
  fp TEXT,
  quota_charged INTEGER NOT NULL DEFAULT 0,
  ended_ts INTEGER,
  result TEXT,                        -- success / failed / aborted
  created_ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS flash_grants (
  jti TEXT PRIMARY KEY,               -- 随机 128bit，链接形如 /api/flash/file?g=<jti>
  session_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  file TEXT NOT NULL,
  user_id INTEGER,
  fp TEXT,
  created_ts INTEGER NOT NULL,
  exp_ts INTEGER NOT NULL,
  used_ts INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fgrants_session ON flash_grants(session_id, created_ts);

CREATE TABLE IF NOT EXISTS catalog_fw (
  slug TEXT PRIMARY KEY,              -- 与站点清单 slug 一致（如 bw16-01）
  device TEXT NOT NULL DEFAULT 'bw16',
  name TEXT NOT NULL,
  color TEXT,
  color_label TEXT,
  color_css TEXT,
  version TEXT,
  source_path TEXT,
  attribution TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  files TEXT NOT NULL DEFAULT '{}',   -- {文件名: {size, sha256, md5, fileId}}
  active INTEGER NOT NULL DEFAULT 1,
  updated_ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_content (
  key TEXT PRIMARY KEY,               -- videos / firmware_rows / timeline / stats / notice
  data TEXT NOT NULL,                 -- JSON
  updated_ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quota_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  delta INTEGER NOT NULL,             -- 正负额度变动
  reason TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quota_log_user ON quota_log(user_id, ts);

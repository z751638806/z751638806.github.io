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

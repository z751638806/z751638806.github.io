-- peipei-flash-api D1 schema
-- 表：刷写事件 / 反馈 / 公告 / 激活码
-- M5 激活码、M7 投稿表后续 ALTER 追加

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

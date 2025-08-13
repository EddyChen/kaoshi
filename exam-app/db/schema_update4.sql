-- 白名单用户表：仅允许在此表的手机号登录
CREATE TABLE IF NOT EXISTS whitelist_users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	phone TEXT UNIQUE NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_whitelist_phone ON whitelist_users(phone);



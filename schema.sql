-- Cloudflare D1 Schema for DigitalArts Tetris Rankings

CREATE TABLE IF NOT EXISTS rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  lines INTEGER NOT NULL,
  level INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'classic',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rankings_score ON rankings (score DESC, lines DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_mode_score ON rankings (mode, score DESC, lines DESC);

-- Cloudflare D1 Schema for Live Chat Messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages (created_at DESC, id DESC);

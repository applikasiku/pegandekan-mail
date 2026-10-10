PRAGMA foreign_keys = ON;
CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user')), active INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
CREATE TABLE sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires);
CREATE TABLE messages(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, sender TEXT NOT NULL, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, attachments TEXT NOT NULL DEFAULT '[]', folder TEXT NOT NULL CHECK(folder IN ('inbox','sent','drafts','trash')), unread INTEGER NOT NULL DEFAULT 1, starred INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE INDEX mailbox ON messages(user_id,folder,created DESC);
CREATE TABLE attempts(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TRIGGER user_limit BEFORE INSERT ON users WHEN (SELECT count(*) FROM users)>=20 BEGIN SELECT RAISE(ABORT,'User limit reached'); END;
CREATE TRIGGER mailbox_limit BEFORE INSERT ON messages WHEN (SELECT count(*) FROM messages WHERE user_id=NEW.user_id)>=100 BEGIN SELECT RAISE(ABORT,'Mailbox full'); END;

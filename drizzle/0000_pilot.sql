CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  document TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE sessions (
  digest TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  reviewer TEXT NOT NULL,
  expires INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX sessions_expiry ON sessions(expires);
--> statement-breakpoint
CREATE TABLE rate_windows (
  scope TEXT PRIMARY KEY,
  minute INTEGER NOT NULL,
  uses INTEGER NOT NULL
);

-- Contact addresses are optional until a managed identity provider is configured.
ALTER TABLE employees ADD COLUMN email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS employee_email_unique ON employees(email);
CREATE TABLE IF NOT EXISTS identity_invitations (
 id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),
 provider_invite_id TEXT,expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','REVOKED','EXPIRED')),
 created_by TEXT NOT NULL REFERENCES employees(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS identity_invitation_employee ON identity_invitations(employee_id,created_at);
-- No password or kiosk PIN material is stored until a reviewed identity provider
-- and credential verification implementation have been configured.

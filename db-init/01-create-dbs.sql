-- Create both databases used by the enterprise stack.
-- POSTGRES_DB already creates the "enterprise_gateway" DB; this script adds the
-- "lobechat" DB used by the LobeChat server-mode image. Idempotent.

SELECT 'CREATE DATABASE lobechat'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'lobechat')\gexec

SELECT 'CREATE DATABASE enterprise_gateway'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'enterprise_gateway')\gexec

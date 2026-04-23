-- Only the lobechat DB is needed. The old enterprise_gateway DB (used by the
-- Fastify gateway/) has been retired with the gateway service; chat-gw is a
-- remote Azure service that manages its own Postgres.
--
-- POSTGRES_DB already creates the primary database; this script is kept for
-- backward compatibility when POSTGRES_DB is not `lobechat`.

SELECT 'CREATE DATABASE lobechat'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'lobechat')\gexec

import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

/**
 * TLS options for the Postgres driver, from the environment. TypeORM ignores
 * `?sslmode=` in a connection URL, so a Postgres server outside the Docker
 * network (any managed or self-hosted box reached over the internet) needs
 * this to avoid sending credentials and customer data in clear text.
 *
 *   DB_SSL      "true" turns TLS on (default: off, as for the in-stack Postgres)
 *   DB_SSL_CA   path to the server's CA / self-signed certificate (PEM). With it
 *               the server's identity is verified against that pinned
 *               certificate (hostname matching is skipped: a self-signed
 *               certificate usually doesn't name the IP/host we dial). Without
 *               it the connection is encrypted but the server is not
 *               authenticated, so set it.
 *   DB_SSL_REJECT_UNAUTHORIZED  "false" to encrypt without verifying (discouraged)
 *
 * Returns `undefined` when TLS is off, so it can be passed straight into the
 * TypeORM options (`ssl: pgSsl()`).
 */
export function pgSsl(): ConnectionOptions | undefined {
  if (process.env.DB_SSL !== 'true') return undefined;
  const caPath = process.env.DB_SSL_CA;
  return {
    ca: caPath ? readFileSync(caPath, 'utf8') : undefined,
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    ...(caPath ? { checkServerIdentity: () => undefined } : {}),
  };
}

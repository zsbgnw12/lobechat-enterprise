import { registerTool, z } from './registry';
import { httpJson, isMock } from './http';
import { env } from '../env';

async function daytonaFetch(path: string, method: string, body?: any, timeoutMs = 15000): Promise<any> {
  return httpJson(`${env.SANDBOX_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.SANDBOX_KEY}` },
    body,
    timeoutMs,
  });
}

registerTool({
  key: 'sandbox.run',
  applyFilter: false,
  inputSchema: z.object({ code: z.string(), language: z.string().default('python') }),
  async run(_ctx, params) {
    if (!isMock('sandbox') && env.SANDBOX_URL) {
      const reuseId = process.env.SANDBOX_REUSE_WORKSPACE_ID || '';
      let workspaceId = reuseId;
      let created = false;
      try {
        if (!workspaceId) {
          // Create workspace
          let createResp: any;
          try {
            createResp = await daytonaFetch('/workspace', 'POST', {
              name: `eg-${Date.now().toString(36)}`,
              image: 'daytonaio/workspace-project:latest',
              projects: [],
            });
          } catch (e: any) {
            const msg = String(e?.message || e);
            // structured unsupported
            const statusMatch = msg.match(/upstream (\d+)/);
            return {
              unsupported: true,
              reason: msg.slice(0, 400),
              http_status: statusMatch ? parseInt(statusMatch[1], 10) : undefined,
            };
          }
          workspaceId = createResp?.id || createResp?.workspaceId || createResp?.name;
          if (!workspaceId) {
            return {
              unsupported: true,
              reason: `workspace create returned no id: ${JSON.stringify(createResp).slice(0, 300)}`,
            };
          }
          created = true;

          // Wait up to 60s for started
          const deadline = Date.now() + 60000;
          while (Date.now() < deadline) {
            try {
              const info: any = await daytonaFetch(`/workspace/${workspaceId}`, 'GET', undefined, 5000);
              const status = (info?.status || info?.state || '').toLowerCase();
              if (status === 'started' || status === 'running') break;
              if (status === 'error' || status === 'failed') {
                return {
                  unsupported: true,
                  reason: `workspace ${workspaceId} status=${status}`,
                  http_status: 500,
                };
              }
            } catch {
              // tolerate transient polling errors
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
        }

        // Exec code
        let execResp: any;
        try {
          execResp = await daytonaFetch(`/workspace/${workspaceId}/exec`, 'POST', {
            command: params.code,
            language: params.language,
          }, 30000);
        } catch (e: any) {
          const msg = String(e?.message || e);
          const statusMatch = msg.match(/upstream (\d+)/);
          return {
            unsupported: true,
            reason: `exec failed: ${msg.slice(0, 300)}`,
            http_status: statusMatch ? parseInt(statusMatch[1], 10) : undefined,
          };
        }

        return {
          stdout: execResp?.stdout ?? execResp?.output ?? '',
          stderr: execResp?.stderr ?? '',
          exit_code: execResp?.exitCode ?? execResp?.exit_code ?? 0,
        };
      } finally {
        // Cleanup (best-effort): only if we created it and no reuse id
        if (created && !reuseId && workspaceId) {
          try {
            await daytonaFetch(`/workspace/${workspaceId}`, 'DELETE', undefined, 5000);
          } catch {
            // best-effort
          }
        }
      }
    }
    return { stdout: '(mock)', stderr: '', exit_code: 0, echoed_code: params.code.slice(0, 120) };
  },
});

import { request } from 'undici';
import { registerTool, z } from './registry';
import { httpJson, isMock } from './http';
import { env } from '../env';

async function headMeta(url: string, timeoutMs = 3000): Promise<{ size?: number; contentType?: string }> {
  try {
    const res = await request(url, {
      method: 'HEAD',
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    const clen = res.headers['content-length'];
    const ctype = res.headers['content-type'];
    return {
      size: clen ? parseInt(Array.isArray(clen) ? clen[0] : String(clen), 10) : undefined,
      contentType: ctype ? (Array.isArray(ctype) ? ctype[0] : String(ctype)) : undefined,
    };
  } catch {
    return {};
  }
}

registerTool({
  key: 'doc.generate',
  applyFilter: false,
  inputSchema: z.object({
    prompt: z.string(),
    topic: z.string().default(''),
    format: z.string().default('markdown'),
  }),
  async run(_ctx, params) {
    if (!isMock('doc') && env.DOC_AGENT_URL) {
      const outputType = params.format === 'ppt' ? 'ppt' : params.format === 'table' ? 'table' : 'word';
      const r = await httpJson(`${env.DOC_AGENT_URL}/api/v1/generate`, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.DOC_AGENT_KEY}` },
        body: {
          prompt: params.prompt,
          output_type: outputType,
          title: params.topic || undefined,
        },
      });

      // Look for a file URL in common fields.
      const downloadUrl: string | undefined =
        (typeof r?.download_url === 'string' && r.download_url) ||
        (typeof r?.file_url === 'string' && r.file_url) ||
        (typeof r?.url === 'string' && r.url) ||
        (typeof r?.fileUrl === 'string' && r.fileUrl) ||
        undefined;

      const markdown: string | undefined =
        typeof r?.markdown === 'string' ? r.markdown :
        typeof r?.content === 'string' ? r.content :
        typeof r?.text === 'string' ? r.text :
        undefined;

      if (downloadUrl) {
        const fileName =
          (typeof r?.file_name === 'string' && r.file_name) ||
          (typeof r?.filename === 'string' && r.filename) ||
          decodeURIComponent(downloadUrl.split('/').pop()?.split('?')[0] || 'document.docx');
        const meta = await headMeta(downloadUrl, 3000);
        return {
          download_url: downloadUrl,
          file_name: fileName,
          file_size: meta.size ?? (typeof r?.file_size === 'number' ? r.file_size : undefined),
          mime_type: meta.contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          markdown,
        };
      }

      // Fallback: inline markdown only
      return {
        markdown: markdown ?? (typeof r === 'string' ? r : JSON.stringify(r)),
        meta: typeof r === 'object' && r !== null ? r : undefined,
      };
    }
    return {
      markdown: `# ${params.topic || params.prompt}\n\n(mock) generated document body.\n`,
      meta: { format: params.format },
    };
  },
});

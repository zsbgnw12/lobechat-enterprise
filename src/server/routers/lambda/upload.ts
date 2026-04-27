import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { createFileServiceModule } from '@/server/services/file/impls';

export const uploadRouter = router({
  createS3PreSignedUrl: authedProcedure
    .input(z.object({ pathname: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // [enterprise-fork] route through createFileServiceModule so the storage
      // backend (S3 or Azure Blob) honours AZURE_STORAGE_CONNECTION_STRING.
      const fileService = createFileServiceModule(ctx.serverDB);
      return await fileService.createPreSignedUrl(input.pathname);
    }),
});

export type FileRouter = typeof uploadRouter;

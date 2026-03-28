import { SetMetadata } from '@nestjs/common';

export const RequireResource = (resourceId: number) =>
  SetMetadata('resourceId', resourceId);

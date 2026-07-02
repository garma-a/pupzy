import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  protected getRequestResponse(context: ExecutionContext) {
    const type = context.getType();
    if (type === 'http') {
      const http = context.switchToHttp();
      return { req: http.getRequest(), res: http.getResponse() };
    }
    const gqlCtx = GqlExecutionContext.create(context);
    const ctx = gqlCtx.getContext();
    return { req: ctx.req, res: ctx.req.res };
  }
}

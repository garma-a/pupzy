import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';

@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>, context?: ExecutionContext): Promise<string> {
    const user =
      context?.getType() === 'graphql'
        ? GqlExecutionContext.create(context).getContext<{ user?: { id: string } }>().user
        : context?.getType() === 'http'
          ? (req.user as { id?: string } | undefined)
          : undefined;
    return user?.id ? `user:${user.id}` : `ip:${await super.getTracker(req)}`;
  }
  protected getRequestResponse(context: ExecutionContext) {
    const type = context.getType();
    if (type === 'http') {
      const http = context.switchToHttp();
      return {
        req: http.getRequest<Record<string, unknown>>(),
        res: http.getResponse<Record<string, unknown>>(),
      };
    }
    const gqlCtx = GqlExecutionContext.create(context);
    const ctx = gqlCtx.getContext<{
      req: { res: Record<string, unknown> } & Record<string, unknown>;
    }>();
    return { req: ctx.req, res: ctx.req.res };
  }
}

/** A generous shared-IP safety ceiling before authentication; business quotas run afterwards. */
@Injectable()
export class GqlIpThrottlerGuard extends GqlThrottlerGuard {
  protected handleRequest(props: ThrottlerRequest): Promise<boolean> {
    return super.handleRequest({
      ...props,
      limit: 10_000,
      ttl: 60_000,
      blockDuration: 60_000,
      getTracker: (req) => this.getTracker(req),
      generateKey: (_context, tracker) => `preauth:${tracker}`,
    });
  }
}

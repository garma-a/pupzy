import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { User } from '../database/schema';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext().user;
  },
);

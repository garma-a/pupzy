import type { ApolloServerPlugin, GraphQLRequestListener } from '@apollo/server';
import { GraphQLError, isListType, getNullableType, type DocumentNode, type GraphQLSchema } from 'graphql';
import { getComplexity, simpleEstimator } from 'graphql-query-complexity';
import type { GqlContext } from '../types/gql-context.type';
import { clampFirst } from '../utils/pagination.util';

export function assertQueryComplexity(
  schema: GraphQLSchema,
  query: DocumentNode,
  variables: Record<string, unknown>,
  operationName?: string | null,
): void {
  const complexity = getComplexity({
    schema,
    query,
    variables,
    operationName: operationName ?? undefined,
    maxQueryNodes: 2_000,
    estimators: [
      ({ field, args, childComplexity }) => {
        if (field.args.some((arg) => arg.name === 'first'))
          return 1 + clampFirst(args.first as number | undefined) * childComplexity;
        // Geographic lookups are expensive even when the returned fields are few.
        if (field.name === 'nearestVetClinics') return 200 + 5 * childComplexity;
        if (field.name !== 'edges' && isListType(getNullableType(field.type))) {
          const count = field.name === 'cities' ? 500 : field.name === 'media' ? 4 : 50;
          return 1 + count * childComplexity;
        }
        return undefined;
      },
      simpleEstimator({ defaultComplexity: 1 }),
    ],
  });
  if (complexity > 5_000)
    throw new GraphQLError('Query exceeds the supported complexity limit', { extensions: { code: 'BAD_USER_INPUT' } });
}

/** Run for every operation, including cached documents with new pagination variables. */
export const queryComplexityPlugin: ApolloServerPlugin<GqlContext> = {
  requestDidStart() {
    return Promise.resolve<GraphQLRequestListener<GqlContext>>({
      didResolveOperation({ schema, document, request }) {
        assertQueryComplexity(schema, document, request.variables ?? {}, request.operationName);
        return Promise.resolve();
      },
    });
  },
};

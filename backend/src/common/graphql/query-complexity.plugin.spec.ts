import { ApolloServer } from '@apollo/server';
import { buildSchema, parse } from 'graphql';
import { assertQueryComplexity, queryComplexityPlugin } from './query-complexity.plugin';
import type { GqlContext } from '../types/gql-context.type';

const schema = buildSchema(`
  type Query { feed(first: Int): Connection! me: User! }
  type Connection { edges: [Edge!]! }
  type Edge { node: Post! }
  type Post { id: ID! title: String! creator: User! nearestVetClinics: [Clinic!]! }
  type User { id: ID! fullName: String! }
  type Clinic { id: ID! name: String! }
`);
describe('query complexity budget', () => {
  it('allows a normal 50-post feed and a single geographic detail selection', () => {
    expect(() =>
      assertQueryComplexity(
        schema,
        parse('{ feed(first: 50) { edges { node { id title creator { id fullName } } } } }'),
        {},
      ),
    ).not.toThrow();
    expect(() =>
      assertQueryComplexity(
        schema,
        parse('{ feed(first: 1) { edges { node { nearestVetClinics { id name } } } } }'),
        {},
      ),
    ).not.toThrow();
  });
  it('rejects geographic lookup amplification through aliases and fragments', () => {
    const query = parse(
      'query { a: feed(first: 50) { ...Page } b: feed(first: 50) { ...Page } } fragment Page on Connection { edges { node { nearestVetClinics { id } } } }',
    );
    expect(() => assertQueryComplexity(schema, query, {})).toThrow('complexity limit');
  });
  it('evaluates only the selected operation in a multi-operation document', () => {
    const query = parse(
      'query Small { me { id } } query Large { feed(first: 50) { edges { node { nearestVetClinics { id } } } } }',
    );
    expect(() => assertQueryComplexity(schema, query, {}, 'Small')).not.toThrow();
    expect(() => assertQueryComplexity(schema, query, {}, 'Large')).toThrow();
  });
  it('rejects changed pagination variables on a cached Apollo document before resolving data', async () => {
    const server = new ApolloServer<GqlContext>({
      schema,
      plugins: [queryComplexityPlugin],
      rootValue: { feed: () => ({ edges: [] }) },
    });
    const query = 'query($first: Int) { feed(first: $first) { edges { node { nearestVetClinics { id } } } } }';
    try {
      const first = await server.executeOperation({ query, variables: { first: 1 } });
      if (first.body.kind === 'single') expect(first.body.singleResult.errors).toBeUndefined();
      const response = await server.executeOperation({ query, variables: { first: 50 } });
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single')
        expect(response.body.singleResult.errors?.[0].extensions?.code).toBe('BAD_USER_INPUT');
    } finally {
      await server.stop();
    }
  });
});

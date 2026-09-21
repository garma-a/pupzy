import * as fs from 'fs';
import * as path from 'path';
import { Kind, ObjectTypeDefinitionNode, ObjectTypeExtensionNode, parse, visit } from 'graphql';

/**
 * Ticket 18: retire saved-search runtime surfaces.
 *
 * The unfinished saved-search alert feature must disappear from every exposed
 * runtime surface (SDL, generated definitions, resolvers/services/repositories)
 * while the `saved_searches` storage contract stays temporarily compatible for
 * deployment overlap. Ticket 19 owns the storage contraction; this spec must
 * not be read as permission to drop the table or its transitional cleanup.
 */

const SRC_DIR = path.resolve(__dirname, '..');

function collectFiles(dir: string, isCandidate: (name: string) => boolean, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') collectFiles(fullPath, isCandidate, files);
    } else if (isCandidate(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function astMentionsName(source: string, name: string): boolean {
  const doc = parse(source);
  let found = false;
  visit(doc, {
    Name(node) {
      if (node.value === name) found = true;
    },
  });
  return found;
}

describe('Saved-search runtime retirement (ticket 18)', () => {
  const sdlFiles = collectFiles(SRC_DIR, (name) => name.endsWith('.graphql'));

  it('removes the SavedSearch type from every schema-first SDL file', () => {
    const offenders = sdlFiles.filter((file) => astMentionsName(fs.readFileSync(file, 'utf8'), 'SavedSearch'));
    expect(offenders.map((file) => path.relative(SRC_DIR, file))).toEqual([]);
  });

  it('removes the generated SavedSearch definition from src/graphql.ts', () => {
    const generated = fs.readFileSync(path.join(SRC_DIR, 'graphql.ts'), 'utf8');
    expect(generated).not.toMatch(/\bSavedSearch\b/);
    expect(generated).not.toMatch(/\bNewSavedSearch\b/);
  });

  it('keeps the unrelated saved-post surface intact', () => {
    const posts = parse(fs.readFileSync(path.join(SRC_DIR, 'posts', 'posts.graphql'), 'utf8'));

    const queryExt = posts.definitions.find(
      (d): d is ObjectTypeExtensionNode => d.kind === Kind.OBJECT_TYPE_EXTENSION && d.name.value === 'Query',
    );
    const mutationExt = posts.definitions.find(
      (d): d is ObjectTypeExtensionNode => d.kind === Kind.OBJECT_TYPE_EXTENSION && d.name.value === 'Mutation',
    );
    const postType = posts.definitions.find(
      (d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === 'Post',
    );

    const queryNames = queryExt?.fields?.map((f) => f.name.value) ?? [];
    const mutationNames = mutationExt?.fields?.map((f) => f.name.value) ?? [];
    const postNames = postType?.fields?.map((f) => f.name.value) ?? [];

    expect(queryNames).toContain('mySavedPosts');
    expect(mutationNames).toContain('toggleSave');
    expect(postNames).toContain('isSavedByMe');
  });

  it('leaves no saved-search reference in resolvers, services, repositories or SDL', () => {
    const runtimeFiles = collectFiles(
      SRC_DIR,
      (name) =>
        name.endsWith('.graphql') ||
        ((name.endsWith('.resolver.ts') || name.endsWith('.service.ts') || name.endsWith('.repository.ts')) &&
          !name.endsWith('.spec.ts')),
    );

    // `users/account-deletion.service.ts` is the one documented transitional
    // exception: it keeps deleting retained rows until ticket 19 contracts
    // storage. Nothing else may read or write saved searches.
    const transitionCleanup = path.join('users', 'account-deletion.service.ts');
    const offenders = runtimeFiles.filter((file) => {
      const relative = path.relative(SRC_DIR, file);
      if (relative === transitionCleanup) return false;
      return /saved.?search/i.test(fs.readFileSync(file, 'utf8'));
    });

    expect(offenders.map((file) => path.relative(SRC_DIR, file))).toEqual([]);
  });
});

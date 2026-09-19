#!/usr/bin/env node

/**
 * GraphQL schema compatibility proof for Pupzy.
 *
 * Builds the schema-first SDL from every `src/**\/*.graphql` file at two git
 * revisions, then structurally compares the baseline against the candidate.
 *
 * A change is INCOMPATIBLE when it removes or alters anything the baseline
 * exposed: a type, an operation, an argument, a field type or nullability, an
 * enum value, an input-object field, a union member, or a scalar. Additions
 * (new types, new operations, new enum values, new optional-or-not input
 * fields) are reported as additive and allowed.
 *
 * Usage (from backend/):
 *   node scripts/graphql-schema-compat.mjs [baselineRev] [candidateRev]
 *
 * Defaults: baseline `b6df50c`, candidate `HEAD`.
 * Optional: `--dump-dir <dir>` writes the sorted SDL of both revisions.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildASTSchema, lexicographicSortSchema, printSchema } from 'graphql';
import { mergeTypeDefs } from '@graphql-tools/merge';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: backendDir,
  encoding: 'utf8',
}).trim();
const backendPrefix = path.relative(gitRoot, backendDir).split(path.sep).join('/');

const args = process.argv.slice(2);
const baselineRev = args.find((a) => !a.startsWith('--')) ?? 'b6df50c';
const candidateRev = args.filter((a) => !a.startsWith('--'))[1] ?? 'HEAD';
const dumpDirIndex = args.indexOf('--dump-dir');
const dumpDir = dumpDirIndex !== -1 ? args[dumpDirIndex + 1] : null;

function git(argsArray) {
  return execFileSync('git', argsArray, { cwd: gitRoot, encoding: 'utf8' });
}

function loadSdl(rev) {
  const revision = git(['rev-parse', rev]).trim();
  const files = git(['ls-tree', '-r', revision, '--name-only', `${backendPrefix}/src`])
    .split('\n')
    .filter((file) => file.endsWith('.graphql'))
    .sort();
  if (files.length === 0) {
    throw new Error(`No .graphql files found at ${rev}`);
  }
  // `mergeTypeDefs` mirrors how @nestjs/graphql merges the schema-first SDL
  // directory: repeated enum definitions collapse, extend blocks attach.
  const schema = buildASTSchema(mergeTypeDefs(files.map((file) => git(['show', `${revision}:${file}`]))));
  return { revision, files, schema };
}

function namedType(type) {
  return type.toString();
}

/** Structural snapshot: maps of names to their shape. */
function snapshot(schema) {
  const types = new Map();
  for (const [name, type] of Object.entries(schema.getTypeMap())) {
    if (name.startsWith('__')) continue;
    const kind = type.constructor.name.replace('GraphQL', '').replace('Type', '');
    if (type.getFields && type.getFields()) {
      const fields = {};
      for (const [fieldName, field] of Object.entries(type.getFields())) {
        fields[fieldName] = {
          type: namedType(field.type),
          args: Object.fromEntries((field.args ?? []).map((arg) => [arg.name, namedType(arg.type)])),
        };
      }
      types.set(name, { kind, fields });
    } else if (type.getValues && type.getValues()) {
      types.set(name, { kind: 'ENUM', values: type.getValues().map((v) => v.name) });
    } else if (type.getTypes && type.getTypes()) {
      types.set(name, { kind: 'UNION', members: type.getTypes().map((t) => t.name) });
    } else {
      types.set(name, { kind: 'SCALAR' });
    }
  }
  return types;
}

const rootNames = ['Query', 'Mutation', 'Subscription'];

function compare(baseline, candidate) {
  const incompatible = [];
  const additive = [];

  for (const [typeName, base] of baseline) {
    const cand = candidate.get(typeName);
    if (!cand) {
      incompatible.push(`REMOVED_TYPE ${typeName}`);
      continue;
    }
    if (cand.kind !== base.kind) {
      incompatible.push(`KIND_CHANGED ${typeName}: ${base.kind} -> ${cand.kind}`);
      continue;
    }
    if (base.kind === 'ENUM') {
      for (const value of base.values) {
        if (!cand.values.includes(value)) incompatible.push(`REMOVED_ENUM_VALUE ${typeName}.${value}`);
      }
      const added = cand.values.filter((v) => !base.values.includes(v));
      if (added.length) additive.push(`ADDED_ENUM_VALUES ${typeName}: ${added.join(', ')}`);
      continue;
    }
    if (base.kind === 'UNION') {
      for (const member of base.members) {
        if (!cand.members.includes(member)) incompatible.push(`REMOVED_UNION_MEMBER ${typeName}.${member}`);
      }
      const added = cand.members.filter((m) => !base.members.includes(m));
      if (added.length) additive.push(`ADDED_UNION_MEMBERS ${typeName}: ${added.join(', ')}`);
      continue;
    }
    if (base.kind === 'SCALAR') continue;

    for (const [fieldName, baseField] of Object.entries(base.fields)) {
      const candField = cand.fields[fieldName];
      if (!candField) {
        incompatible.push(`REMOVED_FIELD ${typeName}.${fieldName}`);
        continue;
      }
      if (candField.type !== baseField.type) {
        incompatible.push(`FIELD_TYPE_CHANGED ${typeName}.${fieldName}: ${baseField.type} -> ${candField.type}`);
      }
      const labels = rootNames.includes(typeName) ? 'operation' : 'field';
      for (const [argName, baseArgType] of Object.entries(baseField.args)) {
        const candArgType = candField.args[argName];
        if (candArgType === undefined) {
          incompatible.push(`REMOVED_ARGUMENT ${typeName}.${fieldName}(${argName})`);
        } else if (candArgType !== baseArgType) {
          incompatible.push(
            `ARGUMENT_TYPE_CHANGED ${typeName}.${fieldName}(${argName}): ${baseArgType} -> ${candArgType}`,
          );
        }
      }
      const addedArgs = Object.keys(candField.args).filter((a) => !(a in baseField.args));
      if (addedArgs.length) additive.push(`ADDED_ARGUMENTS ${typeName}.${fieldName}(${labels}): ${addedArgs.join(', ')}`);
    }
    const addedFields = Object.keys(cand.fields).filter((f) => !(f in base.fields));
    if (addedFields.length) additive.push(`ADDED_FIELDS ${typeName}: ${addedFields.join(', ')}`);
  }

  for (const [typeName, cand] of candidate) {
    if (!baseline.has(typeName)) additive.push(`ADDED_TYPE ${typeName} (${cand.kind})`);
  }

  return { incompatible, additive };
}

const baseline = loadSdl(baselineRev);
const candidate = loadSdl(candidateRev);

if (dumpDir) {
  mkdirSync(dumpDir, { recursive: true });
  for (const [label, loaded] of [
    ['baseline', baseline],
    ['candidate', candidate],
  ]) {
    writeFileSync(path.join(dumpDir, `${label}-${loaded.revision.slice(0, 12)}.graphql`), printSchema(lexicographicSortSchema(loaded.schema)));
  }
}

const { incompatible, additive } = compare(snapshot(baseline.schema), snapshot(candidate.schema));

console.log('GraphQL schema compatibility report');
console.log(`Baseline:  ${baselineRev} -> ${baseline.revision} (${baseline.files.length} SDL files)`);
console.log(`Candidate: ${candidateRev} -> ${candidate.revision} (${candidate.files.length} SDL files)`);
console.log('');
console.log(`Additive changes (${additive.length}):`);
for (const entry of additive.sort()) console.log(`  + ${entry}`);
console.log('');
console.log(`Incompatible changes (${incompatible.length}):`);
for (const entry of incompatible.sort()) console.log(`  ! ${entry}`);
console.log('');
if (incompatible.length === 0) {
  console.log('RESULT: COMPATIBLE - no existing type, operation, argument, field, nullability, enum value, or scalar changed.');
  process.exit(0);
} else {
  console.log('RESULT: INCOMPATIBLE');
  process.exit(1);
}

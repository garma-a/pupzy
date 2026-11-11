import { execFileSync } from 'child_process';
import * as path from 'path';

/** The synchronous publisher stages the final formatted bytes before hashing or installation. */
export function formatCityJson(value: unknown): string {
  return execFileSync(
    process.execPath,
    [
      require.resolve('prettier/bin/prettier.cjs'),
      '--parser',
      'json',
      '--config',
      path.resolve(__dirname, '../../.prettierrc'),
    ],
    { input: JSON.stringify(value), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

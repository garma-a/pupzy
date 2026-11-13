import { sql, type SQL } from 'drizzle-orm';

/**
 * Converts SQL written with `$1`, `$2` placeholders into a Drizzle `SQL`
 * object with every occurrence bound as its own parameter.
 *
 * Lets one SQL text serve both the Nest API (Drizzle) and the AdminJS service
 * (`pg` `client.query(text, values)`), so a shared definition such as the
 * Announcement audience predicate is written once. Values are always bound,
 * never interpolated.
 */
export function positionalSql(text: string, values: readonly unknown[]): SQL {
  const parts: SQL[] = [];
  let last = 0;
  for (const match of text.matchAll(/\$(\d+)/g)) {
    const index = Number(match[1]);
    if (index < 1 || index > values.length) {
      throw new RangeError(`SQL placeholder $${index} has no value.`);
    }
    if (match.index > last) parts.push(sql.raw(text.slice(last, match.index)));
    parts.push(sql`${values[index - 1]}`);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(sql.raw(text.slice(last)));
  return sql.join(parts, sql.raw(''));
}

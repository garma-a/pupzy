import { PgDialect } from 'drizzle-orm/pg-core';
import { positionalSql } from './positional-sql.util';

const dialect = new PgDialect();

describe('positionalSql', () => {
  it('turns numbered placeholders into bound parameters in order of use', () => {
    const query = dialect.sqlToQuery(positionalSql('SELECT $2::text, $1::int, $2::text', [7, 'a']));
    expect(query.sql).toBe('SELECT $1::text, $2::int, $3::text');
    expect(query.params).toEqual(['a', 7, 'a']);
  });

  it('binds null and leaves text without placeholders untouched', () => {
    const query = dialect.sqlToQuery(positionalSql("SELECT 'a' WHERE $1::uuid IS NULL", [null]));
    expect(query.sql).toBe("SELECT 'a' WHERE $1::uuid IS NULL");
    expect(query.params).toEqual([null]);
  });

  it('refuses a placeholder with no value', () => {
    expect(() => positionalSql('SELECT $3', [1])).toThrow(/\$3/);
  });
});

import knexModule from 'knex';
import { DatabaseMetadata, Property, ResourceMetadata } from '@adminjs/sql';

const SQL_POOL_OPTIONS = Object.freeze({
  min: 0,
  max: 3,
  idleTimeoutMillis: 10_000,
  acquireTimeoutMillis: 8_000,
});

function columnType(databaseType) {
  switch (databaseType) {
    case 'uuid':
      return 'uuid';
    case 'bigint':
    case 'int8':
    case 'bigserial':
    case 'serial8':
    case 'integer':
    case 'int':
    case 'int4':
    case 'smallint':
    case 'int2':
    case 'serial':
    case 'serial4':
    case 'smallserial':
    case 'serial2':
      return 'number';
    case 'double precision':
    case 'float8':
    case 'numeric':
    case 'decimal':
    case 'real':
    case 'float4':
      return 'float';
    case 'money':
      return 'currency';
    case 'boolean':
      return 'boolean';
    case 'time':
    case 'time with time zone':
    case 'timetz':
    case 'time without time zone':
    case 'timestamp':
    case 'timestamp with time zone':
    case 'timestamptz':
    case 'timestamp without time zone':
      return 'datetime';
    case 'date':
      return 'date';
    case 'json':
    case 'jsonb':
      return 'key-value';
    default:
      return 'string';
  }
}

function relationColumns(value) {
  if (Array.isArray(value)) return value;
  return String(value ?? '')
    .replaceAll('{', '')
    .replaceAll('}', '')
    .split(',')
    .filter(Boolean);
}

export function createAdminSqlClient(connection) {
  const sql = knexModule.knex({
    client: 'pg',
    connection,
    pool: { ...SQL_POOL_OPTIONS },
  });
  const configuredPool = sql.client.pool;
  if (
    !configuredPool ||
    configuredPool.min !== SQL_POOL_OPTIONS.min ||
    configuredPool.max !== SQL_POOL_OPTIONS.max ||
    configuredPool.idleTimeoutMillis !== SQL_POOL_OPTIONS.idleTimeoutMillis
  ) {
    void sql.destroy();
    throw new Error('AdminJS SQL adapter pool limits were not applied.');
  }
  return sql;
}

async function getProperties(sql, tableName, schemaName) {
  const columns = await sql
    .from('information_schema.columns as col')
    .select(
      'col.column_name',
      'col.ordinal_position',
      'col.column_default',
      'col.is_nullable',
      'col.is_updatable',
      'col.data_type',
      'tco.constraint_type as key_type',
    )
    .leftJoin('information_schema.key_column_usage as kcu', (join) =>
      join
        .on('kcu.column_name', 'col.column_name')
        .on('kcu.table_name', 'col.table_name')
        .on('kcu.table_schema', 'col.table_schema'),
    )
    .leftJoin('information_schema.table_constraints as tco', (join) =>
      join
        .on('tco.constraint_name', 'kcu.constraint_name')
        .on('tco.constraint_schema', 'kcu.constraint_schema')
        .onVal('tco.constraint_type', 'PRIMARY KEY'),
    )
    .where('col.table_schema', schemaName)
    .where('col.table_name', tableName);

  const relations = await sql.raw(
    `SELECT
       ARRAY_AGG(source_attribute.attname ORDER BY source_attribute.attnum) AS columns,
       referenced_class.relname AS referenced_table
     FROM pg_constraint AS constraint_definition
     JOIN pg_class AS source_class
       ON source_class.oid = constraint_definition.conrelid
     JOIN pg_namespace AS source_namespace
       ON source_namespace.oid = source_class.relnamespace
     JOIN pg_class AS referenced_class
       ON referenced_class.oid = constraint_definition.confrelid
     JOIN pg_attribute AS source_attribute
       ON source_attribute.attrelid = constraint_definition.conrelid
      AND source_attribute.attnum = ANY(constraint_definition.conkey)
     WHERE source_namespace.nspname = ?
       AND source_class.relname = ?
       AND constraint_definition.contype = 'f'
     GROUP BY constraint_definition.oid, referenced_class.relname`,
    [schemaName, tableName],
  );

  return columns.map((column) => {
    const relation = relations.rows.find((candidate) => {
      const relatedColumns = relationColumns(candidate.columns);
      return relatedColumns.length === 1 && relatedColumns[0] === column.column_name;
    });
    return new Property({
      name: column.column_name,
      isId: column.key_type === 'PRIMARY KEY',
      position: column.ordinal_position,
      defaultValue: column.column_default,
      isNullable: column.is_nullable === 'YES',
      isEditable: column.is_updatable === 'YES',
      type: relation ? 'reference' : columnType(column.data_type),
      referencedTable: relation?.referenced_table ?? null,
    });
  });
}

export async function buildAdminSqlDatabase(connection) {
  const sql = createAdminSqlClient(connection);
  try {
    const schemaName =
      connection.schema ?? (await sql.raw('SELECT current_schema() AS schema_name')).rows[0]?.schema_name ?? 'public';
    const tableRows = await sql('information_schema.tables')
      .select('table_name')
      .where({ table_schema: schemaName, table_type: 'BASE TABLE' });

    const resources = [];
    for (const { table_name: tableName } of tableRows) {
      const properties = await getProperties(sql, tableName, schemaName);
      resources.push(new ResourceMetadata('postgresql', sql, connection.database, schemaName, tableName, properties));
    }
    const resourceMap = new Map(resources.map((resource) => [resource.tableName, resource]));
    return {
      db: new DatabaseMetadata(connection.database, resourceMap),
      sqlAdapterPool: sql,
    };
  } catch (error) {
    await sql.destroy();
    throw error;
  }
}

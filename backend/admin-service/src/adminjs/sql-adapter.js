import knexModule from 'knex';
import { DatabaseMetadata, Property, Resource as SqlResource, ResourceMetadata } from '@adminjs/sql';
import { ENUMS } from './enums.js';
import { applyVirtualFilter, virtualFilterProperties } from './queue-filters.js';

/**
 * Enum-backed columns whose AdminJS filter is a value selector rather than a
 * text search. Declaring the values on the adapter property makes the stock SQL
 * adapter emit an equality predicate (`where "post_type" = 'RESCUE'`) instead of
 * an ILIKE that the PostgreSQL enum type does not support.
 */
const COLUMN_AVAILABLE_VALUES = Object.freeze({
  posts: Object.freeze({
    post_type: ENUMS.postType,
    status: ENUMS.postStatus,
    moderation_status: ENUMS.moderationStatus,
    urgency: ENUMS.urgencyTier,
  }),
});

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

/**
 * SQL adapter resource that understands the admin work-queue virtual filters
 * (`posts.report_type`, `posts.queue`, report `review_state`). Everything else
 * is delegated to the stock `@adminjs/sql` resource, so filtering behavior for
 * real columns is unchanged.
 */
export class QueueAwareSqlResource extends SqlResource {
  constructor(info) {
    const virtualProperties = virtualFilterProperties(info.tableName);
    const resourceInfo =
      virtualProperties.length > 0 ? { ...info, properties: [...info.properties, ...virtualProperties] } : info;
    super(resourceInfo);
    this.virtualFilterNames = new Set(virtualProperties.map((property) => property.name()));
  }

  filterQuery(filter) {
    if (!filter?.filters || this.virtualFilterNames.size === 0) {
      return super.filterQuery(filter);
    }

    const columnFilters = {};
    const virtualSelections = [];
    for (const [key, selection] of Object.entries(filter.filters)) {
      if (this.virtualFilterNames.has(key)) {
        virtualSelections.push([key, selection?.value]);
      } else {
        columnFilters[key] = selection;
      }
    }

    const query = super.filterQuery({ ...filter, filters: columnFilters });
    for (const [key, value] of virtualSelections) {
      applyVirtualFilter(query, {
        tableName: this.tableName,
        key,
        value,
        knex: this.knex,
        schemaName: this.schemaName,
      });
    }
    return query;
  }
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

async function getProperties(sql, tableName, schemaName, availableTables) {
  const [columns, primaryKeys, relations] = await Promise.all([
    sql
      .from('information_schema.columns as col')
      .select(
        'col.column_name',
        'col.ordinal_position',
        'col.column_default',
        'col.is_nullable',
        'col.is_updatable',
        'col.data_type',
      )
      .where('col.table_schema', schemaName)
      .where('col.table_name', tableName)
      .orderBy('col.ordinal_position', 'asc'),
    sql.raw(
      `SELECT
         source_attribute.attname AS column_name
       FROM pg_constraint AS constraint_definition
       JOIN pg_class AS source_class
         ON source_class.oid = constraint_definition.conrelid
       JOIN pg_namespace AS source_namespace
         ON source_namespace.oid = source_class.relnamespace
       JOIN pg_attribute AS source_attribute
         ON source_attribute.attrelid = constraint_definition.conrelid
        AND source_attribute.attnum = ANY(constraint_definition.conkey)
       WHERE source_namespace.nspname = ?
         AND source_class.relname = ?
         AND constraint_definition.contype = 'p'`,
      [schemaName, tableName],
    ),
    sql.raw(
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
    ),
  ]);

  const primaryKeySet = new Set(primaryKeys.rows.map((row) => row.column_name));

  return columns.map((column) => {
    const relation = relations.rows.find((candidate) => {
      const relatedColumns = relationColumns(candidate.columns);
      const isAvailable = !Array.isArray(availableTables) || availableTables.includes(candidate.referenced_table);
      return isAvailable && relatedColumns.length === 1 && relatedColumns[0] === column.column_name;
    });
    return new Property({
      name: column.column_name,
      isId: primaryKeySet.has(column.column_name),
      position: column.ordinal_position,
      defaultValue: column.column_default,
      isNullable: column.is_nullable === 'YES',
      isEditable: column.is_updatable === 'YES',
      type: relation ? 'reference' : columnType(column.data_type),
      referencedTable: relation?.referenced_table ?? null,
      availableValues: COLUMN_AVAILABLE_VALUES[tableName]?.[column.column_name] ?? undefined,
    });
  });
}

export async function buildAdminSqlDatabase(connection, options = {}) {
  const sql = createAdminSqlClient(connection);
  try {
    const schemaName =
      connection.schema ?? (await sql.raw('SELECT current_schema() AS schema_name')).rows[0]?.schema_name ?? 'public';

    let tableQuery = sql('information_schema.tables')
      .select('table_name')
      .where({ table_schema: schemaName, table_type: 'BASE TABLE' });

    if (Array.isArray(options.tables) && options.tables.length > 0) {
      tableQuery = tableQuery.whereIn('table_name', options.tables);
    }

    const tableRows = await tableQuery;

    const resources = [];
    for (const { table_name: tableName } of tableRows) {
      const properties = await getProperties(sql, tableName, schemaName, options.tables);
      const hasId = properties.some((property) => property.isId);
      if (!hasId) {
        continue;
      }
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

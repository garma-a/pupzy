const MODERATION_TABLES = new Set(['users', 'posts']);

export async function runModerationAction(pool, params) {
  if (!MODERATION_TABLES.has(params.table)) {
    throw new TypeError(`Unsupported moderation table: ${params.table}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM ${params.table} WHERE id = $1 FOR UPDATE`, [params.id]);
    const row = rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, error: `${params.table} row ${params.id} not found` };
    }

    const validationError = params.validate?.(row);
    if (validationError) {
      await client.query('ROLLBACK');
      return { ok: false, error: validationError };
    }

    const mutationMetadata = await params.mutate(client, row);
    const metadata = mutationMetadata ?? params.metadata ?? null;
    await client.query(
      `INSERT INTO moderation_actions
         (admin_user_id, action_type, target_type, target_id, reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.adminUserId,
        params.actionType,
        params.targetType,
        params.id,
        params.reason ?? null,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );
    await client.query('COMMIT');
    await params.onSuccess?.(row);
    return { ok: true, row };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original transaction error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export function actionResponse(record, currentAdmin, result, successMessage) {
  return {
    record: record.toJSON(currentAdmin),
    notice: {
      message: result.ok ? successMessage : result.error,
      type: result.ok ? 'success' : 'error',
    },
  };
}
export function readModerationReason(value) {
  const reason = String(value ?? '').trim();
  if (reason.length > 500) {
    return { error: 'A reason must be at most 500 characters.' };
  }
  return { reason };
}

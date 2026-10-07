import { pool } from "../db/client.js";

export interface WorkspaceSearchResult {
  emails: Array<{
    engineId: string;
    threadId: string | null;
    subject: string | null;
    snippet: string | null;
    fromEmail: string;
    fromName: string | null;
    date: string;
    rank: number;
  }>;
  chats: Array<{
    conversationId: string;
    title: string | null;
    messageId: string;
    role: string;
    content: string;
    createdAt: string;
    rank: number;
  }>;
}

export async function searchWorkspace(input: {
  userId: string;
  accountId: string;
  query: string;
  limit?: number | undefined;
}): Promise<WorkspaceSearchResult> {
  const query = input.query.trim();
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 25);
  if (!query) return { emails: [], chats: [] };

  const emailResult = await pool.query<{
    engine_id: string;
    engine_thread_id: string | null;
    subject: string | null;
    snippet: string | null;
    from_email: string;
    from_name: string | null;
    date: Date;
    rank: number;
  }>(`
    WITH q AS (SELECT websearch_to_tsquery('simple', $1) AS query)
    SELECT
      m.engine_id,
      m.engine_thread_id,
      m.subject,
      m.snippet,
      m.from_email,
      m.from_name,
      m.date,
      ts_rank_cd(
        to_tsvector('simple', coalesce(m.subject, '') || ' ' || coalesce(m.snippet, '') || ' ' || coalesce(m.from_name, '') || ' ' || m.from_email),
        q.query
      )::float8 AS rank
    FROM inbound_messages m, q
    WHERE m.account_id = $2
      AND (
        to_tsvector('simple', coalesce(m.subject, '') || ' ' || coalesce(m.snippet, '') || ' ' || coalesce(m.from_name, '') || ' ' || m.from_email) @@ q.query
        OR m.subject ILIKE '%' || $1 || '%'
        OR m.snippet ILIKE '%' || $1 || '%'
        OR m.from_email ILIKE '%' || $1 || '%'
        OR coalesce(m.from_name, '') ILIKE '%' || $1 || '%'
      )
    ORDER BY rank DESC, m.date DESC
    LIMIT $3
  `, [query, input.accountId, limit]);

  const chatResult = await pool.query<{
    conversation_id: string;
    title: string | null;
    message_id: string;
    role: string;
    content: string;
    created_at: Date;
    rank: number;
  }>(`
    WITH q AS (SELECT websearch_to_tsquery('simple', $1) AS query)
    SELECT
      c.id AS conversation_id,
      c.title,
      m.id AS message_id,
      m.role,
      m.content,
      m.created_at,
      ts_rank_cd(
        to_tsvector('simple', coalesce(c.title, '') || ' ' || m.content),
        q.query
      )::float8 AS rank
    FROM ai_messages m
    JOIN ai_conversations c ON c.id = m.conversation_id
    CROSS JOIN q
    WHERE c.user_id = $2
      AND c.status <> 'deleted'
      AND (
        to_tsvector('simple', coalesce(c.title, '') || ' ' || m.content) @@ q.query
        OR c.title ILIKE '%' || $1 || '%'
        OR m.content ILIKE '%' || $1 || '%'
      )
    ORDER BY rank DESC, m.created_at DESC
    LIMIT $3
  `, [query, input.userId, limit]);

  return {
    emails: emailResult.rows.map((row) => ({
      engineId: row.engine_id,
      threadId: row.engine_thread_id,
      subject: row.subject,
      snippet: row.snippet,
      fromEmail: row.from_email,
      fromName: row.from_name,
      date: row.date.toISOString(),
      rank: Number(row.rank) || 0,
    })),
    chats: chatResult.rows.map((row) => ({
      conversationId: row.conversation_id,
      title: row.title,
      messageId: row.message_id,
      role: row.role,
      content: row.content.slice(0, 1200),
      createdAt: row.created_at.toISOString(),
      rank: Number(row.rank) || 0,
    })),
  };
}

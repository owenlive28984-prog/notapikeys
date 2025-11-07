const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// PostgreSQL connection pool
// For development, you can use SQLite instead by switching to better-sqlite3
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/languaro_telemetry',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Initialize database tables
async function initDatabase() {
  const client = await pool.connect();
  try {
    // Events table
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        event_id VARCHAR(255) UNIQUE NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        metadata JSONB DEFAULT '{}',
        session_id VARCHAR(255) NOT NULL,
        app_version VARCHAR(50) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        session_start TIMESTAMPTZ NOT NULL,
        session_end TIMESTAMPTZ,
        active_time_seconds INTEGER DEFAULT 0,
        idle_time_seconds INTEGER DEFAULT 0,
        features_used JSONB DEFAULT '[]',
        translations_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Indexes for performance
    await client.query('CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
    
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Batch events endpoint
app.post('/api/events/batch', async (req, res) => {
  const { events, user_id } = req.body;

  if (!events || !Array.isArray(events)) {
    return res.status(400).json({ error: 'Invalid events payload' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let inserted = 0;
    for (const event of events) {
      try {
        await client.query(
          `INSERT INTO events (event_id, user_id, event_type, timestamp, metadata, session_id, app_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (event_id) DO NOTHING`,
          [
            event.event_id,
            event.user_id || user_id,
            event.event_type,
            event.timestamp,
            event.metadata,
            event.session_id,
            event.app_version,
          ]
        );
        inserted++;
      } catch (err) {
        console.error('Error inserting event:', err.message);
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, inserted });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Batch events error:', error);
    res.status(500).json({ error: 'Failed to process events' });
  } finally {
    client.release();
  }
});

// Batch sessions endpoint
app.post('/api/sessions/batch', async (req, res) => {
  const { sessions, user_id } = req.body;

  if (!sessions || !Array.isArray(sessions)) {
    return res.status(400).json({ error: 'Invalid sessions payload' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let upserted = 0;
    for (const session of sessions) {
      try {
        await client.query(
          `INSERT INTO sessions 
           (session_id, user_id, session_start, session_end, active_time_seconds, 
            idle_time_seconds, features_used, translations_count, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (session_id) DO UPDATE SET
             session_end = EXCLUDED.session_end,
             active_time_seconds = EXCLUDED.active_time_seconds,
             idle_time_seconds = EXCLUDED.idle_time_seconds,
             features_used = EXCLUDED.features_used,
             translations_count = EXCLUDED.translations_count,
             updated_at = NOW()`,
          [
            session.session_id,
            session.user_id || user_id,
            session.session_start,
            session.session_end,
            session.active_time_seconds,
            session.idle_time_seconds,
            session.features_used,
            session.translations_count,
          ]
        );
        upserted++;
      } catch (err) {
        console.error('Error upserting session:', err.message);
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, upserted });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Batch sessions error:', error);
    res.status(500).json({ error: 'Failed to process sessions' });
  } finally {
    client.release();
  }
});

// Analytics endpoints for dashboard

// Get user stats
app.get('/api/analytics/user/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const eventsCount = await pool.query(
      'SELECT COUNT(*) as count FROM events WHERE user_id = $1',
      [userId]
    );

    const sessionsCount = await pool.query(
      'SELECT COUNT(*) as count FROM sessions WHERE user_id = $1',
      [userId]
    );

    const totalActiveTime = await pool.query(
      'SELECT SUM(active_time_seconds) as total FROM sessions WHERE user_id = $1',
      [userId]
    );

    const topFeatures = await pool.query(
      `SELECT metadata->>'feature' as feature, COUNT(*) as count
       FROM events 
       WHERE user_id = $1 AND event_type = 'feature_used'
       GROUP BY feature
       ORDER BY count DESC
       LIMIT 10`,
      [userId]
    );

    res.json({
      total_events: parseInt(eventsCount.rows[0].count),
      total_sessions: parseInt(sessionsCount.rows[0].count),
      total_active_time: parseInt(totalActiveTime.rows[0].total || 0),
      top_features: topFeatures.rows,
    });
  } catch (error) {
    console.error('User analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch user analytics' });
  }
});

// Get overall stats (all users)
app.get('/api/analytics/overall', async (req, res) => {
  try {
    const totalUsers = await pool.query('SELECT COUNT(DISTINCT user_id) as count FROM events');
    const totalEvents = await pool.query('SELECT COUNT(*) as count FROM events');
    const totalSessions = await pool.query('SELECT COUNT(*) as count FROM sessions');
    
    const avgSessionTime = await pool.query(
      'SELECT AVG(active_time_seconds) as avg FROM sessions WHERE session_end IS NOT NULL'
    );

    const topFeatures = await pool.query(
      `SELECT metadata->>'feature' as feature, COUNT(*) as count
       FROM events 
       WHERE event_type = 'feature_used'
       GROUP BY feature
       ORDER BY count DESC
       LIMIT 10`
    );

    const dailyActiveUsers = await pool.query(
      `SELECT DATE(timestamp) as date, COUNT(DISTINCT user_id) as count
       FROM events
       WHERE timestamp >= NOW() - INTERVAL '30 days'
       GROUP BY date
       ORDER BY date DESC`
    );

    res.json({
      total_users: parseInt(totalUsers.rows[0].count),
      total_events: parseInt(totalEvents.rows[0].count),
      total_sessions: parseInt(totalSessions.rows[0].count),
      avg_session_time: Math.round(parseFloat(avgSessionTime.rows[0].avg || 0)),
      top_features: topFeatures.rows,
      daily_active_users: dailyActiveUsers.rows,
    });
  } catch (error) {
    console.error('Overall analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch overall analytics' });
  }
});

// Get feature usage over time
app.get('/api/analytics/features/timeline', async (req, res) => {
  const { days = 7 } = req.query;

  try {
    const timeline = await pool.query(
      `SELECT 
         DATE(timestamp) as date,
         metadata->>'feature' as feature,
         COUNT(*) as count
       FROM events
       WHERE event_type = 'feature_used'
         AND timestamp >= NOW() - INTERVAL '${parseInt(days)} days'
       GROUP BY date, feature
       ORDER BY date DESC, count DESC`,
    );

    res.json({ timeline: timeline.rows });
  } catch (error) {
    console.error('Feature timeline error:', error);
    res.status(500).json({ error: 'Failed to fetch feature timeline' });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Telemetry backend running on http://localhost:${PORT}`);
  try {
    await initDatabase();
  } catch (error) {
    console.error('Failed to initialize database. Please check your DATABASE_URL.');
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing HTTP server...');
  await pool.end();
  process.exit(0);
});

# Languaro Telemetry Backend

Backend API for collecting and analyzing Languaro desktop app usage data.

## Features

- ✅ Event tracking with batching support
- ✅ Session metrics (active/idle time, features used)
- ✅ PostgreSQL storage with efficient indexing
- ✅ Analytics endpoints for dashboard visualization
- ✅ Offline queue support (client handles retry)
- ✅ Privacy-focused (no PII collected)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Database

**Option A: PostgreSQL (Recommended for production)**

```bash
# Create database
createdb languaro_telemetry

# Copy environment file
cp .env.example .env

# Edit .env with your database credentials
DATABASE_URL=postgresql://username:password@localhost:5432/languaro_telemetry
```

**Option B: SQLite (Development only)**

For local development without PostgreSQL, you can modify `server.js` to use SQLite with `better-sqlite3`. See code comments.

### 3. Run Server

```bash
# Development with auto-reload
npm run dev

# Production
npm start
```

The server will automatically create required tables on first run.

## API Endpoints

### Health Check
```
GET /api/health
```

### Event Tracking
```
POST /api/events/batch
Body: {
  "events": [
    {
      "event_id": "evt_123",
      "user_id": "user_abc",
      "event_type": "translation_performed",
      "timestamp": "2024-01-15T10:30:00Z",
      "metadata": { "source_lang": "ja", "target_lang": "en" },
      "session_id": "sess_456",
      "app_version": "0.1.0"
    }
  ],
  "user_id": "user_abc"
}
```

### Session Tracking
```
POST /api/sessions/batch
Body: {
  "sessions": [
    {
      "session_id": "sess_456",
      "user_id": "user_abc",
      "session_start": "2024-01-15T10:00:00Z",
      "session_end": "2024-01-15T11:30:00Z",
      "active_time_seconds": 3600,
      "idle_time_seconds": 1800,
      "features_used": ["translation", "ocr", "settings"],
      "translations_count": 45
    }
  ],
  "user_id": "user_abc"
}
```

### Analytics

**User-specific stats:**
```
GET /api/analytics/user/:userId
```

**Overall stats (all users):**
```
GET /api/analytics/overall
```

**Feature usage timeline:**
```
GET /api/analytics/features/timeline?days=7
```

## Database Schema

### Events Table
- `event_id` - Unique event identifier
- `user_id` - Anonymous user UUID
- `event_type` - Type of event (e.g., "feature_used", "translation_performed")
- `timestamp` - When the event occurred
- `metadata` - JSON object with event-specific data
- `session_id` - Associated session
- `app_version` - App version string

### Sessions Table
- `session_id` - Unique session identifier
- `user_id` - Anonymous user UUID
- `session_start` - Session start time
- `session_end` - Session end time (null if ongoing)
- `active_time_seconds` - Time user was actively using app
- `idle_time_seconds` - Time user was idle
- `features_used` - JSON array of features used in session
- `translations_count` - Number of translations in session

## Deployment

### Vercel (Recommended)

1. Install Vercel CLI: `npm i -g vercel`
2. Add PostgreSQL database (e.g., Vercel Postgres, Supabase, or Railway)
3. Set environment variables in Vercel dashboard
4. Deploy: `vercel --prod`

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t languaro-telemetry .
docker run -p 3000:3000 -e DATABASE_URL=... languaro-telemetry
```

### Traditional VPS

```bash
# Install Node.js and PostgreSQL
# Clone repo and install dependencies
npm install --production

# Use PM2 for process management
npm install -g pm2
pm2 start server.js --name languaro-telemetry
pm2 save
pm2 startup
```

## Security Considerations

1. **CORS**: Update CORS settings in production to only allow your app's domain
2. **Rate Limiting**: Add express-rate-limit for production
3. **SSL**: Always use HTTPS in production
4. **Database**: Use connection pooling and parameterized queries (already implemented)
5. **Authentication**: For admin endpoints, add API key or JWT authentication

## Privacy & GDPR Compliance

- No personally identifiable information (PII) is collected
- User IDs are randomly generated UUIDs
- Text content is never transmitted
- Users can opt-out via app settings
- Data retention: Consider implementing automatic deletion after X days

## Monitoring

Add monitoring for production:
- Use Sentry for error tracking
- Set up database query performance monitoring
- Monitor API response times
- Track storage usage

## License

MIT License - See main project LICENSE file

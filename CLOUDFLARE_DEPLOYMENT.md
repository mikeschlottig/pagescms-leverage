# Cloudflare Workers Deployment Guide for PagesCMS

This guide explains how to deploy PagesCMS to Cloudflare Workers with support for D1 databases, R2 object storage, and LLM integration.

## Overview

PagesCMS now supports multiple deployment targets:
- **Traditional**: Next.js on Vercel/Netlify with PostgreSQL
- **Cloudflare Workers**: Serverless deployment with D1, R2, and KV
- **Hybrid**: Any combination based on your needs

## Architecture

### Database Support
- **PostgreSQL** (original) - Production-ready relational database
- **Cloudflare D1** - Serverless SQL database for Workers
- **SQLite/libsql** - Local development or Turso cloud
- **Better-SQLite3** - Local Node.js development

### Storage Support
- **Cloudflare R2** - S3-compatible object storage for media/files
- **AWS S3** - Traditional object storage
- **Local filesystem** - Development/testing only

### LLM Integration
- **Cloudflare Workers AI** - Native AI models in Workers
- **OpenAI** - GPT models via API
- **Anthropic** - Claude models via API
- **Ollama** - Local LLM for development

## Quick Start: Cloudflare Workers Deployment

### Prerequisites

1. Install Wrangler CLI:
```bash
npm install -g wrangler
```

2. Login to Cloudflare:
```bash
wrangler login
```

### Step 1: Create D1 Database

```bash
# Create the database
wrangler d1 create pagescms

# Note the database_id from the output
```

Update `wrangler.toml` with your `database_id`.

### Step 2: Create R2 Bucket

```bash
# Create the bucket
wrangler r2 bucket create pagescms-media
```

### Step 3: Create KV Namespace (optional, for caching)

```bash
# Create KV namespace
wrangler kv:namespace create CACHE_KV

# Update wrangler.toml with the namespace ID
```

### Step 4: Configure Environment Variables

Set secrets via Wrangler:

```bash
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put CRYPTO_KEY
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_NAME
wrangler secret put GITHUB_APP_PRIVATE_KEY
wrangler secret put GITHUB_APP_WEBHOOK_SECRET
wrangler secret put GITHUB_APP_CLIENT_ID
wrangler secret put GITHUB_APP_CLIENT_SECRET
```

### Step 5: Run Migrations

```bash
# Generate migrations for SQLite/D1
npx drizzle-kit generate --dialect sqlite

# Apply migrations
npx drizzle-kit migrate
```

### Step 6: Deploy

```bash
# Development
npm run dev:worker

# Production
npm run deploy:worker
```

## Configuration

### wrangler.toml

```toml
name = "pagescms"
main = "src/worker.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

# D1 Database
[[d1_databases]]
binding = "D1_DATABASE"
database_name = "pagescms"
database_id = "your-database-id-here"

# R2 Storage
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "pagescms-media"

# KV Cache (optional)
[[kv_namespaces]]
binding = "CACHE_KV"
id = "your-kv-namespace-id"

# AI for LLM
[ai]
binding = "AI"
```

### Environment Variables

#### Required
- `BETTER_AUTH_SECRET` - Authentication secret
- `CRYPTO_KEY` - Encryption key
- `GITHUB_APP_*` - GitHub App credentials

#### Database (choose one)
- `DATABASE_URL=postgresql://...` - PostgreSQL connection string
- OR use D1 binding (automatic in Workers)
- OR `DATABASE_URL=libsql://...` - libsql/Turso URL
- OR `DATABASE_URL=file:./local.db` - Local SQLite

#### Storage (optional)
- R2 binding (automatic in Workers)
- Or configure S3:
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
  - `AWS_S3_BUCKET`
  - `AWS_REGION`

#### LLM (optional)
- AI binding (automatic in Workers)
- Or configure external providers:
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `OLLAMA_BASE_URL`

## REST API v1

PagesCMS now includes a simplified REST API for programmatic access.

### Endpoints

#### Entries API

```
GET    /api/v1/entries/:owner/:repo/:collection
POST   /api/v1/entries/:owner/:repo/:collection
GET    /api/v1/entries/:owner/:repo/:collection/:path
PUT    /api/v1/entries/:owner/:repo/:collection/:path
DELETE /api/v1/entries/:owner/:repo/:collection/:path
```

**Example: List entries**
```bash
curl -H "Authorization: Bearer <YOUR_API_TOKEN>" \
  "https://your-cms.com/api/v1/entries/owner/repo/posts?limit=10&offset=0"
```

Response:
```json
{
  "status": "success",
  "data": {
    "entries": [...],
    "total": 100,
    "limit": 10,
    "offset": 0
  }
}
```

**Example: Create entry**
```bash
curl -X POST \
  -H "Authorization: Bearer <YOUR_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "My Post",
      "content": "Hello world"
    },
    "message": "Creating new post"
  }' \
  "https://your-cms.com/api/v1/entries/owner/repo/posts"
```

Response:
```json
{
  "status": "success",
  "data": {
    "path": "content/posts/my-post.md",
    "sha": "abc123...",
    "url": "https://github.com/owner/repo/blob/main/content/posts/my-post.md"
  }
}
```

#### AI/LLM API

```
GET  /api/ai/chat          # Health check
POST /api/ai/chat          # Chat completion
POST /api/ai/complete      # Text completion
POST /api/ai/embed         # Generate embeddings
```

**Example: Chat**
```bash
curl -X POST \
  -H "Authorization: Bearer <YOUR_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Help me write a blog post about CMS"}
    ],
    "options": {
      "temperature": 0.7,
      "maxTokens": 500
    }
  }' \
  "https://your-cms.com/api/ai/chat"
```

Response:
```json
{
  "status": "success",
  "data": {
    "content": "Here's a draft for your blog post...",
    "model": "@cf/meta/llama-3-8b-instruct",
    "usage": {
      "promptTokens": 25,
      "completionTokens": 150,
      "totalTokens": 175
    }
  }
}
```

## Database Schema Migration

The existing PostgreSQL schema is compatible with SQLite/D1 with minor adjustments.

### Migration Script

A migration script is provided to convert PostgreSQL migrations to SQLite:

```bash
# The schema uses standard SQL that works across databases
# Drizzle Kit will handle dialect-specific conversions
npx drizzle-kit generate --dialect sqlite
```

### Schema Differences

| Feature | PostgreSQL | SQLite/D1 |
|---------|-----------|-----------|
| JSON columns | `jsonb` | `text` (stored as JSON) |
| Case-insensitive unique | `lower()` index | Application-level |
| Timestamps | `timestamp` | `integer` (unix epoch) |

## Development

### Local Development with SQLite

```bash
# Use local SQLite
export DATABASE_URL="file:./local.db"

# Run migrations
npm run db:migrate

# Start development
npm run dev
```

### Testing Cloudflare Locally

```bash
# Run with Wrangler local development
npm run dev:worker
```

## Additional Suggestions

### 1. Rate Limiting
Implement rate limiting using Cloudflare's built-in features:

```toml
# In wrangler.toml
[vars]
RATE_LIMIT_ENABLED = true
RATE_LIMIT_PER_MINUTE = 100
```

### 2. Caching Strategy
Use KV for aggressive caching:
- Config cache (5 min TTL)
- File metadata cache (15 min TTL)
- Permission cache (1 hour TTL)

### 3. Background Jobs
For long-running tasks:
- Use Cloudflare Queues for async processing
- Process webhooks asynchronously
- Batch cache updates

### 4. Monitoring
- Enable Wrangler analytics
- Log errors to Cloudflare Logpush
- Set up alerts for error rates

### 5. CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy to Cloudflare

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build:worker
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

## Troubleshooting

### Common Issues

1. **D1 Migration Errors**
   - Ensure you're using SQLite-compatible syntax
   - Check Drizzle Kit version compatibility

2. **R2 CORS Issues**
   - Configure CORS in R2 bucket settings
   - Add appropriate headers in worker

3. **AI Binding Not Found**
   - Verify AI binding in wrangler.toml
   - Check compatibility_date is recent enough

4. **Authentication Failures**
   - Ensure all secrets are set via `wrangler secret put`
   - Verify BETTER_AUTH_SECRET matches across instances

## Performance Optimization

### 1. Connection Pooling
D1 connections are serverless - no pooling needed.

### 2. Query Optimization
- Use prepared statements
- Index frequently queried columns
- Batch operations when possible

### 3. Caching Layers
```
Browser Cache → KV Cache → D1 → GitHub API
```

### 4. Bundle Size
- Enable minification in wrangler.toml
- Tree-shake unused dependencies
- Lazy-load heavy modules

## Security Considerations

1. **Secrets Management**
   - Never commit secrets to git
   - Use `wrangler secret put` for all sensitive data
   - Rotate secrets regularly

2. **API Authentication**
   - All API endpoints require authentication
   - Use short-lived tokens
   - Implement token refresh

3. **CORS Configuration**
   - Restrict allowed origins
   - Validate request headers

4. **Rate Limiting**
   - Implement per-user rate limits
   - Protect against brute force

## Cost Estimation

Cloudflare Workers pricing (as of 2024):

- **Requests**: 10M free/month, then $0.30/M
- **CPU Time**: 10M ms free/month, then $0.03/M ms
- **D1**: 5M reads free/month, then $0.75/M
- **R2**: 10GB storage free, then $0.015/GB

Estimated monthly cost for small CMS:
- < 100K requests: **Free tier**
- ~1M requests: **~$5-10/month**
- ~10M requests: **~$30-50/month**

## Migration from PostgreSQL

### Data Export

```bash
# Export PostgreSQL data
pg_dump -U user -h localhost pagescms > backup.sql

# Convert to SQLite format
# (Custom script needed for schema conversion)
```

### Hybrid Approach

Run both databases in parallel during migration:
1. Keep PostgreSQL as primary
2. Sync to D1 in background
3. Switch read traffic to D1
4. Switch write traffic to D1
5. Decommission PostgreSQL

## Support & Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [D1 Documentation](https://developers.cloudflare.com/d1/)
- [R2 Documentation](https://developers.cloudflare.com/r2/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [PagesCMS GitHub](https://github.com/pagescms/pagescms)

## License

MIT License - See LICENSE file for details

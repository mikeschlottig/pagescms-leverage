/**
 * Database driver abstraction layer
 * Supports PostgreSQL, SQLite (libsql), Cloudflare D1, and local SQLite
 */

import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Type definitions for different database clients
type DatabaseClient = 
  | ReturnType<typeof postgres>
  | import("@libsql/client").Client
  | import("cloudflare:workers").D1Database;

export type DatabaseType = "postgres" | "sqlite" | "d1" | "libsql";

export interface DatabaseConfig {
  type: DatabaseType;
  url?: string;
  d1Database?: any; // Cloudflare D1 binding
  libsqlClient?: any; // @libsql/client
  authToken?: string;
}

let dbInstance: any = null;
let clientInstance: DatabaseClient | null = null;

/**
 * Initialize database connection based on environment
 * Automatically detects and uses appropriate database driver
 */
export async function initDatabase(config?: DatabaseConfig) {
  if (dbInstance) return dbInstance;

  const dbType = config?.type || detectDatabaseType();

  switch (dbType) {
    case "postgres":
      return initPostgres(config?.url);
    case "d1":
      return initD1(config?.d1Database);
    case "libsql":
      return initLibSQL(config?.url, config?.authToken);
    case "sqlite":
      return initSQLite(config?.url);
    default:
      throw new Error(`Unsupported database type: ${dbType}`);
  }
}

/**
 * Detect database type from environment variables
 */
function detectDatabaseType(): DatabaseType {
  // Check for Cloudflare D1 binding (Workers environment)
  if (typeof globalThis !== "undefined" && (globalThis as any).D1_DATABASE) {
    return "d1";
  }

  const databaseUrl = process.env.DATABASE_URL || "";

  // Check for libsql/SQLite URL patterns
  if (databaseUrl.startsWith("libsql://") || databaseUrl.startsWith("wss://")) {
    return "libsql";
  }

  if (databaseUrl.startsWith("file:") || databaseUrl.endsWith(".db") || databaseUrl === ":memory:") {
    return "sqlite";
  }

  // Default to PostgreSQL for backwards compatibility
  return "postgres";
}

/**
 * Initialize PostgreSQL connection
 */
async function initPostgres(url?: string) {
  const databaseUrl = url || process.env.DATABASE_URL!;
  
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required for PostgreSQL");
  }

  const client = postgres(databaseUrl, {
    max: parseInt(process.env.POSTGRES_MAX_CONNECTIONS || "5", 10),
  });

  if (process.env.NODE_ENV !== "production") {
    (globalThis as any).__pagesCmsPostgresClient = client;
  }

  clientInstance = client;
  dbInstance = drizzlePostgres(client, { schema });
  return dbInstance;
}

/**
 * Initialize Cloudflare D1 connection
 * Note: This requires Cloudflare Workers runtime
 */
async function initD1(d1Database?: any) {
  const d1 = d1Database || (globalThis as any).D1_DATABASE;

  if (!d1) {
    throw new Error("D1 database binding not found. Ensure D1_DATABASE is bound in wrangler.toml");
  }

  // Dynamically import drizzle-orm/sqlite-core for D1
  const { drizzle } = await import("drizzle-orm/d1");
  
  clientInstance = d1;
  dbInstance = drizzle(d1, { schema });
  return dbInstance;
}

/**
 * Initialize libsql connection (Turso, Cloudflare D1 via libsql, etc.)
 */
async function initLibSQL(url?: string, authToken?: string) {
  const databaseUrl = url || process.env.DATABASE_URL || "file:local.db";
  const token = authToken || process.env.LIBSQL_AUTH_TOKEN;

  // Dynamically import @libsql/client to avoid dependency issues when not needed
  const { createClient } = await import("@libsql/client");

  const client = createClient({
    url: databaseUrl,
    authToken: token,
  });

  // Dynamically import drizzle-orm/libsql
  const { drizzle } = await import("drizzle-orm/libsql");

  clientInstance = client;
  dbInstance = drizzle(client, { schema });
  return dbInstance;
}

/**
 * Initialize local SQLite connection
 */
async function initSQLite(url?: string) {
  const databaseUrl = url || process.env.DATABASE_URL || "file:local.db";

  // Dynamically import better-sqlite3 or sql.js based on environment
  let client;
  try {
    // Try Node.js environment with better-sqlite3
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const Database = (await import("better-sqlite3")).default;
    
    const dbPath = databaseUrl.replace("file:", "");
    client = new Database(dbPath);
    
    clientInstance = client;
    dbInstance = drizzle(client, { schema });
  } catch (error) {
    // Fallback to sql.js for environments without better-sqlite3
    const { drizzle } = await import("drizzle-orm/sql-js");
    const initSqlJs = await import("sql.js");
    
    const SQL = await initSqlJs.default();
    client = new SQL.Database();
    
    clientInstance = client;
    dbInstance = drizzle(client, { schema });
  }

  return dbInstance;
}

/**
 * Get the current database instance
 */
export function getDatabase() {
  if (!dbInstance) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return dbInstance;
}

/**
 * Get the current database client
 */
export function getDatabaseClient() {
  return clientInstance;
}

/**
 * Close database connection
 */
export async function closeDatabase() {
  if (clientInstance) {
    if ("close" in clientInstance && typeof clientInstance.close === "function") {
      await clientInstance.close();
    }
    clientInstance = null;
    dbInstance = null;
  }
}

export { schema };

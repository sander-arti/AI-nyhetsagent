import Database from 'better-sqlite3';
import { Pool } from 'pg';
import { dbConfig } from '../config/database.js';

export interface DatabaseInterface {
  query(sql: string, params?: any[]): Promise<any[]>;
  run(sql: string, params?: any[]): Promise<{ lastInsertRowid?: number; changes: number }>;
  close(): Promise<void>;
}

class SQLiteDatabase implements DatabaseInterface {
  private db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');
  }

  async query(sql: string, params: any[] = []): Promise<any[]> {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.all(params);
    } catch (error) {
      console.error('SQLite query error:', error);
      throw error;
    }
  }

  async run(sql: string, params: any[] = []): Promise<{ lastInsertRowid?: number; changes: number }> {
    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(params);
      return {
        lastInsertRowid: result.lastInsertRowid as number,
        changes: result.changes
      };
    } catch (error) {
      console.error('SQLite run error:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class PostgreSQLDatabase implements DatabaseInterface {
  private pool: Pool;

  constructor(config: any) {
    this.pool = new Pool(config);
  }

  async query(sql: string, params: any[] = []): Promise<any[]> {
    try {
      const result = await this.pool.query(sql, params);
      return result.rows;
    } catch (error) {
      console.error('PostgreSQL query error:', error);
      throw error;
    }
  }

  async run(sql: string, params: any[] = []): Promise<{ lastInsertRowid?: number; changes: number }> {
    try {
      const result = await this.pool.query(sql, params);
      return {
        changes: result.rowCount || 0
      };
    } catch (error) {
      console.error('PostgreSQL run error:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Factory function
export function createDatabase(): DatabaseInterface {
  if (dbConfig.type === 'postgres') {
    return new PostgreSQLDatabase(dbConfig.postgres);
  } else {
    // Ensure data directory exists
    const path = require('path');
    const fs = require('fs');
    const dbPath = dbConfig.sqlite.filename;
    const dbDir = path.dirname(dbPath);
    
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    return new SQLiteDatabase(dbPath);
  }
}

// Singleton instance
let dbInstance: DatabaseInterface | null = null;

export function getDatabase(): DatabaseInterface {
  if (!dbInstance) {
    dbInstance = createDatabase();
  }
  return dbInstance;
}

export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
  }
}
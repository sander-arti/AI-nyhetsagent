import 'dotenv/config';

export const dbConfig = {
  // Environment-based database selection
  type: process.env.NODE_ENV === 'production' && process.env.DB_HOST ? 'postgres' : 'sqlite',
  
  // SQLite config (development)
  sqlite: {
    filename: process.env.SQLITE_DB_PATH || './data/ai-agent.sqlite3',
  },
  
  // PostgreSQL config (production)
  postgres: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.NODE_ENV === 'production',
  },
  
  // ChromaDB config
  chroma: {
    host: process.env.CHROMA_HOST || 'localhost',
    port: parseInt(process.env.CHROMA_PORT || '8000'),
    collectionName: process.env.CHROMA_COLLECTION || 'ai_agent_embeddings',
  }
};
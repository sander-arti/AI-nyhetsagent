import { readFileSync } from 'fs';
import { join } from 'path';
import { getDatabase } from '../src/db/database.js';
import { dbConfig } from '../src/config/database.js';

async function runMigration() {
  console.log(`Running migration for ${dbConfig.type} database...`);
  
  const db = getDatabase();
  
  try {
    // Choose the right migration file based on database type
    const migrationFile = dbConfig.type === 'postgres' 
      ? '001_initial_schema_postgres.sql'
      : '001_initial_schema.sql';
    
    const migrationPath = join(__dirname, '..', 'migrations', migrationFile);
    const sql = readFileSync(migrationPath, 'utf-8');
    
    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    for (const statement of statements) {
      await db.run(statement);
      console.log(`Executed: ${statement.substring(0, 50)}...`);
    }
    
    console.log('Migration completed successfully!');
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  runMigration();
}
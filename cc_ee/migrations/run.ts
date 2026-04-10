import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/cc_ee'
})

async function runMigration() {
  const sql = fs.readFileSync(path.join(__dirname, '001_init_schema.sql'), 'utf-8')
  try {
    await pool.query(sql)
    console.log('Migration completed successfully')
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

runMigration()

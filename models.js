const { Pool } = require('pg');

// Connects automatically using Render's built-in secret
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } 
});

// Auto-builds the Nguru database tables instantly on startup
const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mind_objects (
        user_id INTEGER REFERENCES users(id),
        learning_analogies TEXT[] DEFAULT '{}',
        voice_mode_enabled BOOLEAN DEFAULT true,
        UNIQUE(user_id)
      );
      CREATE TABLE IF NOT EXISTS learning_states (
        user_id INTEGER REFERENCES users(id),
        current_topic VARCHAR(255) DEFAULT '',
        deferred_topics TEXT[] DEFAULT '{}',
        UNIQUE(user_id)
      );
      CREATE TABLE IF NOT EXISTS weak_points (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        failed_concept VARCHAR(255) NOT NULL,
        failure_count INTEGER DEFAULT 1,
        status VARCHAR(50) DEFAULT 'unresolved'
      );
    `);
    console.log("Nguru Database Matrix Initialized.");
  } catch (err) {
    console.error("DB Init Error:", err);
  } finally {
    client.release();
  }
};

initDB();

module.exports = { pool };

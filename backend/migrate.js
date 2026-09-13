import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    console.log("Adding fb_pixel_id and ga_id to brands...");
    await pool.query(`ALTER TABLE brands ADD COLUMN IF NOT EXISTS fb_pixel_id VARCHAR(50);`);
    await pool.query(`ALTER TABLE brands ADD COLUMN IF NOT EXISTS ga_id VARCHAR(50);`);

    console.log("Adding tracking fields to destinations...");
    await pool.query(`ALTER TABLE destinations ADD COLUMN IF NOT EXISTS fb_pixel_id VARCHAR(50);`);
    await pool.query(`ALTER TABLE destinations ADD COLUMN IF NOT EXISTS ga_id VARCHAR(50);`);
    await pool.query(`ALTER TABLE destinations ADD COLUMN IF NOT EXISTS utm_term VARCHAR(255);`);

    console.log("Creating performance indexes...");
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_qrs_code ON qrs(code);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_scans_qr_id ON scans(qr_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_destinations_qr_id ON destinations(qr_id);`);

    console.log("Migration completed successfully!");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await pool.end();
  }
}

run();

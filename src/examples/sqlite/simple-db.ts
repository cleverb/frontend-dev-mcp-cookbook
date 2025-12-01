import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { pipeline } from '@xenova/transformers';
import fs from 'fs';
import path from 'path';

// 1. Setup paths
const dbPath = path.join(process.cwd(), 'src/examples/sqlite/my_docs.db');
const dataDir = path.join(process.cwd(), 'src/data/source');

// Delete the database file if it exists
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log(`Deleted existing database file: ${dbPath}`);
}

// 2. Connect to database and load extension
const db = new Database(dbPath);
sqliteVec.load(db);
console.log('Connected to database and loaded sqlite-vec extension.');

// 3. Create virtual table
// Using float[384] because Xenova/all-MiniLM-L6-v2 produces 384-dimensional vectors
db.exec(`
  CREATE VIRTUAL TABLE documents USING vec0(
    embedding float[384],
    +file_name TEXT,
    +content TEXT
  )
`);
console.log('Created documents table.');

async function main() {
  // 4. Initialize embedding pipeline
  console.log('Initializing embedding pipeline...');
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  // 5. Process files
  console.log('Processing files...');
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.txt'));

  const insertStmt = db.prepare('INSERT INTO documents (embedding, file_name, content) VALUES (?, ?, ?)');

  for (const fileName of files) {
    const filePath = path.join(dataDir, fileName);
    const content = fs.readFileSync(filePath, 'utf-8');

    // Generate embedding
    const output = await extractor(content, { pooling: 'mean', normalize: true });
    const embedding = output.data; // Float32Array

    // Insert into database
    insertStmt.run(embedding, fileName, content);
    console.log(`Indexed ${fileName}`);
  }

  // 6. Query
  const queryText = "What is general relativity?";
  console.log(`\nQuerying: "${queryText}"`);

  const queryOutput = await extractor(queryText, { pooling: 'mean', normalize: true });
  const queryEmbedding = queryOutput.data;

  const results = db.prepare(`
    SELECT
      file_name,
      content,
      distance
    FROM documents
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT 3
  `).all(queryEmbedding) as { file_name: string; content: string; distance: number }[];

  console.log('\nTop 3 most similar documents:');
  for (const row of results) {
    console.log(`\nFile: ${row.file_name} (Distance: ${row.distance})`);
    console.log(`Content: ${row.content.substring(0, 150)}...`);
  }

  db.close();
}

main().catch(console.error);

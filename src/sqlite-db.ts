import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import * as sqliteVec from 'sqlite-vec'; // Import the package

const dbPath: string = 'src/data/my_docs.db';

// 1. Delete the database file if it exists
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log(`Deleted existing database file: ${dbPath}`);
}

let db: DatabaseType | null = null;

// Use a file in the current directory, or maybe a temp one.
// For this example, we'll use 'test.db' in the same directory as the script execution or just 'test.db' relative to cwd.
// const dbPath = path.join(process.cwd(), 'src/data/my_docs.db');
// console.log(`Using database at ${dbPath}`);

// 2. Connect to the new or existing database
// const db = new Database(dbPath);
db = new Database(dbPath);
console.log('Connected to database.');

// 3. Load the extension using the package's built-in function
// This automatically finds the correct .so, .dll, or .dylib file
sqliteVec.load(db);
console.log('Loaded sqlite-vec extension.');

// You can now verify it works
const { vec_version } = db.prepare("SELECT vec_version() as vec_version;").get() as { vec_version: string };
console.log(`vec_version=${vec_version}`);

// Create table
console.log('Creating table if not exists...');
db.exec(`
   CREATE VIRTUAL TABLE documents USING vec0(
       embedding float[1536],
       +file_name TEXT,
       +content TEXT
   )
`);


// // Create table
// console.log('Creating table if not exists...');
// db.exec(`
//   CREATE TABLE IF NOT EXISTS users (
//     id INTEGER PRIMARY KEY AUTOINCREMENT,
//     name TEXT NOT NULL,
//     email TEXT
//   )
// `);

// // Check if we have data
// const count = db.prepare('SELECT count(*) as count FROM users').get() as { count: number };

// if (count.count === 0) {
//   console.log('Inserting sample data...');
//   const insert = db.prepare('INSERT INTO users (name, email) VALUES (@name, @email)');
//   const insertMany = db.transaction((users: { name: string; email: string }[]) => {
//     for (const user of users) insert.run(user);
//   });

//   insertMany([
//     { name: 'Alice', email: 'alice@example.com' },
//     { name: 'Bob', email: 'bob@example.com' },
//     { name: 'Charlie', email: 'charlie@example.com' },
//   ]);
// } else {
//   console.log('Table already has data, skipping insertion.');
// }

// // Query data
// console.log('Querying all users...');
// const stmt = db.prepare('SELECT * FROM users');
// const users = stmt.all();

// console.log('Users found:', users);

// db.close();

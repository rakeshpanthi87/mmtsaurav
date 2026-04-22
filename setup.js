require('dotenv').config();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

console.log('\n🧵  MakeMyThread — First Run Setup\n');

// Init DB (schema applied automatically)
const { db } = require('./database/db');

// Create admin user
const email = process.env.ADMIN_EMAIL || 'admin@mmt.com';
const password = process.env.ADMIN_PASSWORD || 'Admin@1234';
const name = process.env.ADMIN_NAME || 'Admin';

const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
if (existing) {
  console.log(`✓ Admin already exists: ${email}`);
} else {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    `INSERT INTO users (name, email, password, role, initials, avatar_bg, avatar_fg)
     VALUES (?, ?, ?, 'admin', ?, '#C9963A', '#fff')`
  ).run(name, email, hash, name.slice(0,2).toUpperCase());
  console.log(`✓ Admin created`);
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
}

// Create public/icons directory placeholder
const iconsDir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

// Copy .env.example to .env if not exists
if (!fs.existsSync('.env')) {
  fs.copyFileSync('.env.example', '.env');
  console.log('\n✓ .env created from .env.example');
  console.log('  ⚠  Add your ANTHROPIC_API_KEY to .env before starting');
}

console.log('\n✓ Setup complete');
console.log('\nNext steps:');
console.log('  1.  Edit .env and set ANTHROPIC_API_KEY');
console.log('  2.  npm start');
console.log(`  3.  Open http://localhost:${process.env.PORT||3000}/admin\n`);

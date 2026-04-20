/**
 * Seed script: inserts an example archived session with long-term memory
 * (summary) so you can test how the recall system behaves.
 *
 * Usage:  npx tsx src/memory/seed-example.ts
 */

import { getDb, closeDb } from './database.js'

const db = getDb()

// ---------- session ----------
const sessionId = 'ses_example_archived01'
const createdAt = '2026-02-10T09:00:00.000Z'
const updatedAt = '2026-02-10T09:45:00.000Z'

db.prepare(`
  INSERT OR REPLACE INTO sessions (id, title, status, created_at, updated_at)
  VALUES (?, ?, 'archived', ?, ?)
`).run(sessionId, 'Proyecto API de inventario', createdAt, updatedAt)

console.log(`✔ Session created: ${sessionId} (archived)`)

// ---------- summary (long-term memory) ----------
const summary = `El usuario pidió ayuda para diseñar una API REST de inventario para su tienda online.
Se discutieron los endpoints principales: GET /products, POST /products, PATCH /products/:id y DELETE /products/:id.
Se acordó usar Express con TypeScript, validación con Zod, y base de datos PostgreSQL con Prisma como ORM.
El usuario mencionó que su tienda se llama "TechNova" y que vende componentes de PC.
También se habló de agregar autenticación con JWT en una fase posterior.
El usuario prefiere respuestas en español y pidió que el código tenga comentarios descriptivos.`

const messageCount = 14

db.prepare(`
  INSERT OR REPLACE INTO session_summaries (session_id, summary, message_count, created_at)
  VALUES (?, ?, ?, ?)
`).run(sessionId, summary, messageCount, updatedAt)

console.log(`✔ Summary saved (${messageCount} messages summarized)`)

// ---------- no individual messages (they were deleted on archive) ----------

console.log('\nDone. The archived session is ready.')
console.log(`You can resume it with:  null --session ${sessionId}`)
console.log('The LLM will receive the summary as a [Recall] message.\n')

closeDb()

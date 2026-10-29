// Runs once before all tests: a brand-new test database from the migrations.
// Starting from a fresh file means tests never need to delete ledger rows (which the
// append-only trigger would refuse anyway).
import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const TEST_DB = 'prisma/test.db'

export default function setup() {
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(TEST_DB + suffix, { force: true })
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: `file:./${TEST_DB}` },
    stdio: 'pipe',
  })
}

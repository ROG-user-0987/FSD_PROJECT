// Runs in every test file: close the SQLite connection when the file is done, so the
// worker process never exits with the native database handle still open (on Windows
// that can crash the worker).
import { afterAll } from 'vitest'
import { prisma } from '../src/config/prisma.js'

afterAll(async () => {
  await prisma.$disconnect()
})

// db.ts — Prisma client singleton
//
// Why a singleton?
// PrismaClient opens a connection pool to PostgreSQL when instantiated.
// If you import and create `new PrismaClient()` in every file that needs
// the database, you end up with many connection pools running in parallel,
// which wastes memory and can exhaust the database's connection limit.
//
// By exporting a single shared instance from this file, every file in
// the server that imports `prisma` gets the SAME connection pool.

import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

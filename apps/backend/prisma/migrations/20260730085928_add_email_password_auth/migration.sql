-- AlterEnum
ALTER TYPE "AuthProvider" ADD VALUE 'EMAIL';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordHash" TEXT;

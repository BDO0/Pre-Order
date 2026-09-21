/**
 * The **demo shop**, for a local database only.
 *
 *   npm run db:seed:demo
 *
 * Fake products, a live batch, and form-field-free defaults so the storefront and
 * the admin screens have something to render on a fresh laptop. Creating the
 * first *real* account is `npm run db:seed` (`prisma/seed-admin.ts`), which is
 * also what `prisma db seed` runs — this file is no longer wired to that, because
 * it used to be the only documented way to get an admin and the shortest path to
 * demo products in a live shop.
 *
 * Two things that make it safer to have around:
 *
 *   • **It refuses to run against a remote database** unless
 *     `ALLOW_DEMO_SEED_REMOTE=1` is set. The previous version happily re-opened
 *     the `september-drop-2026` batch and re-dated its end date on whatever
 *     database `DATABASE_URL` pointed at — on a live shop that silently reopens
 *     ordering on a finished drop. A Supabase dev branch is the reason the escape
 *     hatch exists.
 *   • **It only creates.** Every write is an upsert with an empty `update`, so
 *     re-running it never edits what an operator has since changed: no reopened
 *     batch, no re-dated deadline, no resurrected product. Delete a demo product
 *     and it comes back; activate it and it stays as you left it.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPoolConfig, isLocalDatabaseHost } from "../src/lib/pg-ssl";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and provide a Postgres connection string."
  );
}

// ── Guard: demo data belongs on a laptop ──────────────────────
if (!isLocalDatabaseHost(connectionString) && process.env.ALLOW_DEMO_SEED_REMOTE !== "1") {
  const host = (() => {
    try {
      return new URL(connectionString).hostname;
    } catch {
      return "(unparseable DATABASE_URL)";
    }
  })();

  console.error("❌ Refusing to seed demo data into a remote database.\n");
  console.error(`   DATABASE_URL points at: ${host}`);
  console.error("   This script creates fake products and a live 'September Drop 2026'");
  console.error("   batch. On a real shop that is not demo data, it is stock you have");
  console.error("   to clean up by hand.");
  console.error("\n   For the first admin account, use the one that is meant for this:");
  console.error("     npm run db:seed");
  console.error("\n   For a throwaway database (a Supabase dev branch, a CI Postgres):");
  console.error("     ALLOW_DEMO_SEED_REMOTE=1 npm run db:seed:demo");
  process.exit(1);
}

// Shared with the Next.js runtime so TLS and timeouts cannot drift apart.
const pool = new Pool(createPoolConfig(connectionString));
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding demo data...");

  // No admin here on purpose. This script used to create
  // `admin@anaclothing.com` / `admin123` in plain text, which meant the
  // documented path to a first login was also a documented password. Use
  // `npm run db:seed` for an account (it generates one and prints it once).

  // ── Sample Products ───────────────────────────────────────
  const shirt = await prisma.product.upsert({
    where: { slug: "oversized-cotton-shirt" },
    update: {},
    create: {
      name: "Oversized Cotton Shirt",
      slug: "oversized-cotton-shirt",
      description: "A premium oversized cotton shirt perfect for any casual occasion. Made from 100% breathable cotton.",
      price: 899,
      currency: "PHP",
      images: [],
      category: "Tops",
      active: true,
      preorderEnabled: true,
      preorderStatus: "OPEN",
      preorderLimit: 100,
      preorderReserved: 0,
    },
  });

  // Variants for shirt
  const shirtVariants = [
    { size: "S", color: "Black", capacity: 20, remainingCapacity: 20 },
    { size: "M", color: "Black", capacity: 25, remainingCapacity: 25 },
    { size: "L", color: "Black", capacity: 25, remainingCapacity: 25 },
    { size: "XL", color: "Black", capacity: 15, remainingCapacity: 15 },
    { size: "S", color: "White", capacity: 15, remainingCapacity: 15 },
    { size: "M", color: "White", capacity: 20, remainingCapacity: 20 },
    { size: "L", color: "White", capacity: 20, remainingCapacity: 20 },
    { size: "XL", color: "White", capacity: 10, remainingCapacity: 10 },
  ];

  for (const v of shirtVariants) {
    await prisma.productVariant.upsert({
      where: {
        id: `${shirt.id}-${v.color.toLowerCase()}-${v.size.toLowerCase()}`,
      },
      update: {},
      create: {
        id: `${shirt.id}-${v.color.toLowerCase()}-${v.size.toLowerCase()}`,
        productId: shirt.id,
        ...v,
        active: true,
      },
    });
  }

  const pants = await prisma.product.upsert({
    where: { slug: "korean-cargo-pants" },
    update: {},
    create: {
      name: "Korean Cargo Pants",
      slug: "korean-cargo-pants",
      description: "Stylish Korean-inspired cargo pants with multiple pockets. Available in waist sizes.",
      price: 1299,
      currency: "PHP",
      images: [],
      category: "Bottoms",
      active: true,
      preorderEnabled: true,
      preorderStatus: "OPEN",
      preorderLimit: 50,
      preorderReserved: 0,
    },
  });

  const pantsVariants = [
    { size: "28", color: "Beige", capacity: 10, remainingCapacity: 10 },
    { size: "30", color: "Beige", capacity: 15, remainingCapacity: 15 },
    { size: "32", color: "Beige", capacity: 15, remainingCapacity: 15 },
    { size: "34", color: "Beige", capacity: 10, remainingCapacity: 10 },
    { size: "28", color: "Black", capacity: 10, remainingCapacity: 10 },
    { size: "30", color: "Black", capacity: 10, remainingCapacity: 10 },
    { size: "32", color: "Black", capacity: 10, remainingCapacity: 10 },
  ];

  for (const v of pantsVariants) {
    await prisma.productVariant.upsert({
      where: { id: `${pants.id}-${v.color.toLowerCase()}-${v.size}` },
      update: {},
      create: {
        id: `${pants.id}-${v.color.toLowerCase()}-${v.size}`,
        productId: pants.id,
        ...v,
        active: true,
      },
    });
  }

  const tee = await prisma.product.upsert({
    where: { slug: "basic-tee" },
    update: {},
    create: {
      name: "Basic Tee",
      slug: "basic-tee",
      description: "A classic basic tee in premium fabric. Coming soon.",
      price: 699,
      currency: "PHP",
      images: [],
      category: "Tops",
      active: true,
      preorderEnabled: true,
      preorderStatus: "COMING_SOON",
    },
  });

  console.log(`✅ Products: ${shirt.name}, ${pants.name}, ${tee.name}`);

  // ── Sample Batch ───────────────────────────────────────
  const batchEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const batch = await prisma.batch.upsert({
    where: { slug: "september-drop-2026" },
    // Empty on purpose. This used to force `status: "OPEN"` and push `endAt` a
    // month out on every run, which silently reopened a closed drop on any
    // database it was pointed at — including a live one.
    update: {},
    create: {
      name: "September Drop 2026",
      slug: "september-drop-2026",
      description: "Our biggest drop yet! Limited quantities available.",
      status: "OPEN",
      startAt: new Date("2026-09-01T00:00:00Z"),
      endAt: batchEnd,
    },
  });

  // Assign products to batch
  for (const productId of [shirt.id, pants.id, tee.id]) {
    await prisma.batchProduct.upsert({
      where: { batchId_productId: { batchId: batch.id, productId } },
      update: {},
      create: { batchId: batch.id, productId },
    });
  }

  console.log(`✅ Batch: ${batch.name}`);
  console.log("\n🎉 Demo data ready.");
  console.log("\nNext, if you do not have an admin account yet:");
  console.log("  npm run db:seed        (creates one and prints its password once)");
  console.log("\nThese products and the 'September Drop 2026' batch are demo data. Remove");
  console.log("them before the shop goes live — they are real, orderable stock otherwise.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

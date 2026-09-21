import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPoolConfig } from "../src/lib/pg-ssl";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set.");
}

const pool = new Pool(createPoolConfig(connectionString));
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const openBatch = await prisma.batch.findFirst({
    where: { status: "OPEN" },
  });

  if (!openBatch) {
    console.log("No open batch found.");
    return;
  }

  const products = await prisma.product.findMany({
    where: { active: true },
    include: { batches: true },
  });

  console.log(`Found ${products.length} products. Checking batch associations...`);

  for (const p of products) {
    if (p.batches.length === 0) {
      await prisma.batchProduct.create({
        data: {
          batchId: openBatch.id,
          productId: p.id,
        },
      });
      console.log(`Linked product "${p.name}" (${p.slug}) to batch "${openBatch.name}"`);
    } else {
      console.log(`Product "${p.name}" already linked to ${p.batches.length} batch(es).`);
    }
  }

  console.log("Done!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

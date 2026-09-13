import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPoolConfig } from "../src/lib/pg-ssl";
import bcrypt from "bcryptjs";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and provide a Postgres connection string."
  );
}

// Shared with the Next.js runtime so TLS and timeouts cannot drift apart.
const pool = new Pool(createPoolConfig(connectionString));
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding database...");

  // ── Admin ─────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash("admin123", 12);

  const admin = await prisma.admin.upsert({
    where: { email: "admin@anaclothing.com" },
    update: {},
    create: {
      email: "admin@anaclothing.com",
      passwordHash,
      name: "ANA Admin",
      role: "SUPER_ADMIN",
    },
  });

  console.log(`✅ Admin: ${admin.email}`);

  // ── Payment Methods ───────────────────────────────────────
  const gcash = await prisma.paymentMethod.upsert({
    where: { id: "pm-gcash" },
    update: {},
    create: {
      id: "pm-gcash",
      name: "GCash",
      instructions: "Send payment to the GCash number below. Screenshot your proof of payment and upload it.",
      accountName: "ANA Clothing",
      accountNumber: "09XXXXXXXXX",
      requiresProof: true,
      active: true,
      sortOrder: 1,
    },
  });

  const maya = await prisma.paymentMethod.upsert({
    where: { id: "pm-maya" },
    update: {},
    create: {
      id: "pm-maya",
      name: "Maya",
      instructions: "Send payment to the Maya number below.",
      accountName: "ANA Clothing",
      accountNumber: "09XXXXXXXXX",
      requiresProof: true,
      active: true,
      sortOrder: 2,
    },
  });

  const cod = await prisma.paymentMethod.upsert({
    where: { id: "pm-cod" },
    update: {},
    create: {
      id: "pm-cod",
      name: "Cash on Delivery",
      instructions: "Pay when your order arrives.",
      requiresProof: false,
      active: true,
      sortOrder: 3,
    },
  });

  console.log(`✅ Payment methods: ${gcash.name}, ${maya.name}, ${cod.name}`);

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

  // ── Sample Campaign ───────────────────────────────────────
  const campaign = await prisma.campaign.upsert({
    where: { slug: "september-drop-2026" },
    update: {},
    create: {
      name: "September Drop 2026",
      slug: "september-drop-2026",
      description: "Our biggest drop yet! Limited quantities available.",
      status: "OPEN",
      startAt: new Date("2026-09-01T00:00:00Z"),
      endAt: new Date("2026-09-07T23:59:59Z"),
    },
  });

  // Assign products to campaign
  for (const productId of [shirt.id, pants.id, tee.id]) {
    await prisma.campaignProduct.upsert({
      where: { campaignId_productId: { campaignId: campaign.id, productId } },
      update: {},
      create: { campaignId: campaign.id, productId },
    });
  }

  console.log(`✅ Campaign: ${campaign.name}`);
  console.log("\n🎉 Seed complete!");
  console.log(`\nAdmin login:`);
  console.log(`  Email:    admin@anaclothing.com`);
  console.log(`  Password: admin123`);
  console.log(`\n⚠️  Change the password after first login!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

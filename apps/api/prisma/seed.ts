import { PrismaClient } from "@prisma/client";
import { newId } from "../src/lib/id.js";
import { MB, pedals, tags } from "./seed-data.js";

const prisma = new PrismaClient();

async function main() {
  for (const p of pedals) {
    await prisma.pedal.upsert({
      where: { slug: p.slug },
      update: {
        brand: p.brand,
        model: p.model,
        aliases: p.aliases,
        validationMode: p.validationMode,
        extensions: p.extensions,
        firmwareNotes: p.firmwareNotes ?? null,
        importInstructionsMd: p.importInstructionsMd,
        maxPresetBytes: p.maxPresetBytes ?? MB,
        maxBundleBytes: p.maxBundleBytes ?? 20 * MB,
        maxCompanionBytes: 5 * MB,
        enabled: true,
      },
      create: {
        id: newId(),
        brand: p.brand,
        model: p.model,
        slug: p.slug,
        aliases: p.aliases,
        validationMode: p.validationMode,
        extensions: p.extensions,
        firmwareNotes: p.firmwareNotes ?? null,
        importInstructionsMd: p.importInstructionsMd,
        maxPresetBytes: p.maxPresetBytes ?? MB,
        maxBundleBytes: p.maxBundleBytes ?? 20 * MB,
        maxCompanionBytes: 5 * MB,
        enabled: true,
      },
    });
  }

  for (const t of tags) {
    await prisma.tag.upsert({
      where: { slug: t.slug },
      update: { label: t.label },
      create: { id: newId(), slug: t.slug, label: t.label },
    });
  }

  console.log(`Seeded ${pedals.length} pedals and ${tags.length} tags.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

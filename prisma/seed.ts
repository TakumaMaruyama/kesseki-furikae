import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.globalSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      makeupWindowDays: 30,
      cutoffTime: "16:00",
    },
  });

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  const dayAfterTomorrow = new Date(now);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
  dayAfterTomorrow.setHours(14, 0, 0, 0);

  const threeDaysLater = new Date(now);
  threeDaysLater.setDate(threeDaysLater.getDate() + 3);
  threeDaysLater.setHours(16, 0, 0, 0);

  const fourDaysLater = new Date(now);
  fourDaysLater.setDate(fourDaysLater.getDate() + 4);
  fourDaysLater.setHours(18, 0, 0, 0);

  const slots = [
    {
      id: `${tomorrow.toISOString().split("T")[0]}_10:00_shokyu`,
      date: tomorrow,
      startTime: "10:00",
      courseLabel: "月曜10時コース",
      classBand: "初級",
      capacityLimit: 10,
      capacityCurrent: 8,
      capacityMakeupAllowed: 3,
      capacityMakeupUsed: 0,
      waitlistCount: 0,
      lessonStartDateTime: tomorrow,
    },
    {
      id: `${dayAfterTomorrow.toISOString().split("T")[0]}_14:00_chukyu`,
      date: dayAfterTomorrow,
      startTime: "14:00",
      courseLabel: "火曜14時コース",
      classBand: "中級",
      capacityLimit: 12,
      capacityCurrent: 10,
      capacityMakeupAllowed: 2,
      capacityMakeupUsed: 1,
      waitlistCount: 0,
      lessonStartDateTime: dayAfterTomorrow,
    },
    {
      id: `${threeDaysLater.toISOString().split("T")[0]}_16:00_jokyu`,
      date: threeDaysLater,
      startTime: "16:00",
      courseLabel: "水曜16時コース",
      classBand: "上級",
      capacityLimit: 10,
      capacityCurrent: 9,
      capacityMakeupAllowed: 2,
      capacityMakeupUsed: 2,
      waitlistCount: 0,
      lessonStartDateTime: threeDaysLater,
    },
    {
      id: `${fourDaysLater.toISOString().split("T")[0]}_18:00_chukyu`,
      date: fourDaysLater,
      startTime: "18:00",
      courseLabel: "木曜18時コース",
      classBand: "中級",
      capacityLimit: 12,
      capacityCurrent: 11,
      capacityMakeupAllowed: 3,
      capacityMakeupUsed: 3,
      waitlistCount: 2,
      lessonStartDateTime: fourDaysLater,
    },
  ];

  for (const slot of slots) {
    await prisma.classSlot.upsert({
      where: { id: slot.id },
      update: {},
      create: slot,
    });
  }

  console.log("✅ データベースのシードが完了しました");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

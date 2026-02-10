import cron from "node-cron";
import { db } from "./db";
import { classSlots } from "@shared/schema";
import { and, gte, lte } from "drizzle-orm";
import { JST_TIME_ZONE } from "@shared/jst";

export function startScheduler() {
  // 定期的な欠席期限チェックのみ実行（順番待ち機能は削除済み）
  cron.schedule("*/30 * * * *", async () => {
    const now = new Date();
    const hourFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: JST_TIME_ZONE,
      hour: "2-digit",
      hour12: false,
    });
    const currentHour = Number(hourFormatter.format(now));

    if (currentHour < 9 || currentHour >= 21) {
      return;
    }

    console.log("[Scheduler] 定期チェック開始");

    // 今後のレッスン枠のチェック
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const upcomingSlots = await db.select().from(classSlots)
      .where(and(
        gte(classSlots.lessonStartDateTime, now),
        lte(classSlots.lessonStartDateTime, tomorrow)
      ));

    console.log(`[Scheduler] 今後24時間以内のレッスン枠: ${upcomingSlots.length}件`);
    console.log("[Scheduler] 定期チェック完了");
  });

  console.log("✅ スケジューラを起動しました（30分ごとにチェック）");
}

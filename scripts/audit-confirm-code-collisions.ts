import { desc, eq, sql } from "drizzle-orm";
import { db } from "../server/db.ts";
import { absences, requests } from "../shared/schema.ts";

async function main() {
  const duplicateCodes = await db.execute(sql`
    SELECT confirm_code AS "confirmCode", COUNT(*)::int AS "absenceCount"
    FROM absences
    GROUP BY confirm_code
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, confirm_code ASC
  `);

  const rows = Array.isArray(duplicateCodes) ? duplicateCodes : duplicateCodes.rows;
  console.log("[confirm-codes:audit] Summary");
  console.table({
    duplicate_code_count: rows.length,
  });

  if (rows.length === 0) {
    return;
  }

  const detailRows = [];
  for (const row of rows.slice(0, 100)) {
    const confirmCode = String((row as any).confirmCode);
    const matchingAbsences = await db
      .select({
        id: absences.id,
        childName: absences.childName,
        absentDate: absences.absentDate,
        makeupStatus: absences.makeupStatus,
        createdAt: absences.createdAt,
      })
      .from(absences)
      .where(eq(absences.confirmCode, confirmCode))
      .orderBy(desc(absences.createdAt));

    const requestCountRows = await Promise.all(
      matchingAbsences.map(async (absence) => {
        const relatedRequests = await db
          .select({ id: requests.id })
          .from(requests)
          .where(eq(requests.absenceId, absence.id));
        return {
          absenceId: absence.id,
          requestCount: relatedRequests.length,
        };
      }),
    );

    detailRows.push({
      confirmCode,
      absenceCount: Number((row as any).absenceCount),
      absenceIds: matchingAbsences.map((absence) => absence.id).join(", "),
      requestCounts: requestCountRows.map((entry) => `${entry.absenceId}:${entry.requestCount}`).join(", "),
    });
  }

  console.log("[confirm-codes:audit] Duplicate codes (up to 100)");
  console.table(detailRows);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[confirm-codes:audit] Failed:", error);
    process.exit(1);
  });

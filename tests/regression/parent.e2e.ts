import { test as base, expect, type Page } from "@playwright/test";
import { createSchoolFixture, CHILD_A, CHILD_B, PASSWORD, type SchoolFixture } from "./fixture";
import { attendanceSnapshot, noticeInput, transportSetup, selfSubmission } from "./transport-helpers";
import { parseJstDateTime } from "../../shared/jst";

const test = base.extend<{}, { school: SchoolFixture }>({
  school: [async ({}, use) => {
    const school = await createSchoolFixture(true);
    try { await use(school); } finally { await school.dispose(); }
  }, { scope: "worker", timeout: 60_000 }],
});

test.beforeEach(async ({ page, school }) => {
  await school.reset();
  // Only this fixture's origin can be reached; fonts, analytics and public links are blocked.
  await page.context().route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === school.baseURL) await route.continue();
    else await route.abort("blockedbyclient");
  });
});

async function fillChild(page: Page, school: SchoolFixture, index: number, name: string, band: string) {
  await page.getByTestId(`input-child-name-${index}`).fill(name);
  await page.getByTestId(`select-class-band-${index}`).click();
  await page.getByRole("option", { name: band, exact: true }).click();
  await page.getByTestId(`input-absent-date-${index}`).fill(school.dates.original);
  await expect(page.getByTestId(`original-slot-options-${index}`)).toBeVisible();
  const id = band === "中級" ? school.ids.sibling : school.ids.original;
  await expect(page.getByTestId(`button-original-slot-${index}-${id}`)).toBeVisible();
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("兄弟の欠席登録と確認コードによる対象児童の切替", async ({ page, school }, info) => {
  await page.goto(school.baseURL);
  await fillChild(page, school, 0, CHILD_A, "初級");
  await page.getByTestId("button-add-row").click();
  await fillChild(page, school, 1, CHILD_B, "中級");
  await noHorizontalOverflow(page);
  await page.getByTestId("button-submit-absence-batch").click();
  await expect(page.getByTestId("text-confirm-code-0")).toHaveText(/^[A-Z2-9]{6}$/);
  await expect(page.getByTestId("text-confirm-code-1")).toHaveText(/^[A-Z2-9]{6}$/);
  const codeA = await page.getByTestId("text-confirm-code-0").innerText();
  const codeB = await page.getByTestId("text-confirm-code-1").innerText();
  expect(codeA).not.toBe(codeB);
  await page.screenshot({ path: info.outputPath("siblings-confirmation.png"), animations: "disabled" });
  await page.getByTestId("button-close-confirm-dialog").click();
  await expect(page.getByTestId("button-close-confirm-dialog")).not.toBeVisible();
  const saved = await school.pool.query("SELECT child_name,declared_class_band,confirm_code,id FROM absences ORDER BY child_name");
  expect(saved.rows).toHaveLength(2);
  for (const [code, name, band] of [[codeA, CHILD_A, "初級"], [codeB, CHILD_B, "中級"]]) {
    await page.goto(`${school.baseURL}/status`);
    await page.getByTestId("input-confirm-code").fill(code);
    await page.getByTestId("button-search").click();
    const row = saved.rows.find((row) => row.confirm_code === code)!;
    const card = page.getByTestId(`card-absence-${row.id}`);
    await expect(card).toContainText(name);
    await expect(card).toContainText(band);
    await page.getByTestId(`button-book-${row.id}`).click();
    await expect(page).toHaveURL(/\/absence\?token=/);
    await expect(page.getByTestId("text-absence-confirm-code")).toHaveText(code);
    await expect(page.locator("main")).toContainText(name);
    await expect(page.locator("main")).not.toContainText(name === CHILD_A ? CHILD_B : CHILD_A);
  }
  await noHorizontalOverflow(page);
});

test("重複連絡では他家庭の確認コードを表示せず控えでの確認へ案内する", async ({ page, school }, info) => {
  const existing = await school.absence();
  await page.goto(school.baseURL);
  await fillChild(page, school, 0, CHILD_A, "初級");
  await page.getByTestId("button-submit-absence-batch").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("すでに登録されています");
  await expect(dialog).toContainText("保存した確認コードまたは連絡詳細リンクから確認してください。");
  await expect(page.locator("body")).not.toContainText(existing.confirmCode);
  await expect(page.locator("body")).not.toContainText(existing.resumeToken);
  await expect(page.getByTestId("button-copy-duplicate-confirm-code")).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath("duplicate-without-private-code.png"), animations: "disabled" });
  await page.getByTestId("button-close-duplicate-dialog").click();
  await expect(dialog).toHaveCount(0);
});

test("級を切り替えると前の級のレッスン枠が送信されない", async ({ page, school }) => {
  await page.goto(school.baseURL);
  await fillChild(page, school, 0, CHILD_A, "初級");
  await page.getByTestId("select-class-band-0").click();
  await page.getByRole("option", { name: "中級", exact: true }).click();
  await expect(page.getByTestId(`button-original-slot-0-${school.ids.sibling}`)).toBeVisible();
  await expect(page.getByTestId(`button-original-slot-0-${school.ids.original}`)).toHaveCount(0);
  await page.getByTestId("button-submit-absence-batch").click();
  await expect(page.getByTestId("text-confirm-code-0")).toBeVisible();
  const result = await school.pool.query("SELECT declared_class_band,original_slot_id FROM absences");
  expect(result.rows).toEqual([{ declared_class_band: "中級", original_slot_id: school.ids.sibling }]);
});

for (const entry of ["registration", "confirmation-code"] as const) test(`保護者の予約導線を維持する：${entry}`, async ({ page, school }) => {
  let absenceId: string;
  if (entry === "registration") {
    await page.goto(school.baseURL);
    await fillChild(page, school, 0, CHILD_A, "初級");
    await page.getByTestId("button-submit-absence-batch").click();
    await expect(page.getByTestId("text-confirm-code-0")).toBeVisible();
    const saved = await school.pool.query("SELECT id FROM absences");
    absenceId = saved.rows[0].id;
    await page.getByTestId("button-close-confirm-dialog").click();
  } else {
    // The receipt already exists before this browser opens; no reissue or login.
    const existing = await school.absence();
    absenceId = existing.absenceId;
    await page.goto(`${school.baseURL}/status`);
    await page.getByTestId("input-confirm-code").fill(existing.confirmCode);
    await page.getByTestId("button-search").click();
    await page.getByTestId(`button-book-${absenceId}`).click();
    await expect(page).toHaveURL(/\/absence\?token=/);
  }
  await page.getByRole("button", { name: "リスト", exact: true }).click();
  const response = page.waitForResponse(res => res.url() === `${school.baseURL}/api/book` && res.request().method() === "POST");
  await page.getByTestId(`button-book-${school.ids.available}`).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByText("振替予約が成立しました。", { exact: true })).toBeVisible();
  const requests = await school.pool.query("SELECT status FROM requests WHERE absence_id=$1", [absenceId]);
  expect(requests.rows).toEqual([{ status: "確定" }]);
});

test("満席表示・振替予約・予約済み状態の再表示・取消", async ({ page, school }, info) => {
  const a = await school.absence();
  await page.goto(`${school.baseURL}/absence?token=${a.resumeToken}`);
  await page.getByRole("button", { name: "リスト", exact: true }).click();
  await expect(page.getByTestId(`button-full-${school.ids.full}`)).toBeDisabled();
  await expect(page.getByTestId(`slot-card-${school.ids.closed}`)).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.getByTestId(`button-book-${school.ids.available}`).click();
  await expect(page.getByText("振替予約が成立しました。", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("text-absence-confirm-code")).toHaveText(a.confirmCode);
  await expect(page.getByTestId(`button-book-${school.ids.available}`)).toHaveCount(0);
  const requests = await school.pool.query("SELECT id,status FROM requests WHERE absence_id=$1", [a.absenceId]);
  expect(requests.rows).toHaveLength(1);
  expect(requests.rows[0].status).toBe("確定");
  await page.screenshot({ path: info.outputPath("booking-confirmed.png"), fullPage: true, animations: "disabled" });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("button-cancel-absence").click();
  await expect(page.getByTestId("input-child-name-0")).toBeVisible();
  expect((await school.pool.query("SELECT makeup_status FROM absences WHERE id=$1", [a.absenceId])).rows[0].makeup_status).toBe("CANCELLED");
  expect((await school.pool.query("SELECT status FROM requests WHERE absence_id=$1", [a.absenceId])).rows[0].status).toBe("却下");
});

test("期限切れ管理者セッションは再読み込み後にログインし直せる", async ({ page, school }) => {
  await page.goto(`${school.baseURL}/admin`);
  const login = async () => {
    await page.getByTestId("input-staff-login-id").fill("admin");
    await page.getByTestId("input-admin-password").fill(PASSWORD);
    await page.getByTestId("button-admin-login").click();
    await expect(page.getByTestId("button-admin-logout")).toBeVisible();
  };
  await login();
  // Let session-store touch calls from initial dashboard requests finish before expiring it.
  await page.waitForLoadState("networkidle");
  await school.expireSessions();
  await page.reload();
  await expect(page.getByTestId("input-admin-password")).toBeVisible();
  await expect(page.getByTestId("button-admin-logout")).toHaveCount(0);
  await login();
});

async function fillTransport(page: Page, school: SchoolFixture, name = CHILD_A) {
  await page.getByLabel("お子様の名前（ひらがなで入力）", { exact: true }).fill(name);
  await page.getByLabel("送迎を利用しない日", { exact: true }).fill(school.dates.original);
  await expect(page.getByLabel("クラス帯", { exact: true })).toHaveCount(0);
  await page.getByRole("radio", { name: /10:00 - 合成回帰テスト/ }).click();
  await expect(page.getByRole("radio", { name: /10:00 - 合成回帰テスト/ })).toHaveAttribute("aria-checked", "true");
}
async function recoverReceipt(page: Page, receipt: string) {
  const details = page.locator("details").filter({ hasText: "送信済みの連絡を確認・訂正" });
  if (!(await details.getAttribute("open"))) {
    if (!(await details.evaluate(node => (node as HTMLDetailsElement).open))) await details.locator("summary").click();
  }
  await page.getByLabel("本人用の受付控え", { exact: true }).fill(receipt);
  await page.getByRole("button", { name: "連絡を表示", exact: true }).click();
}
async function selectStaffDate(page: Page, date: string) {
  const calendar = page.locator(".rdp");
  const caption = (await calendar.innerText()).match(/(\d+)月\s*(\d{4})/)!;
  const delta = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - (Number(caption[2]) * 12 + Number(caption[1]));
  for (let i = 0; i < Math.abs(delta); i++) await calendar.locator("button:has(svg)").nth(delta > 0 ? 1 : 0).click();
  await calendar.locator("button:not(.day-outside)").filter({ hasText: new RegExp(`^${Number(date.slice(-2))}$`) }).click();
}

async function expectSimpleTransport(page: Page) {
  await expect(page.getByTestId("tab-transport")).toHaveCount(0);
  await expect(page.getByTestId("coach-transport")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "この内容を確認済みにする" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/スタッフ確認済み|スタッフ未確認|未確認 \d+件/);
}

async function staffLogin(page: Page, school: SchoolFixture, coach = false, oldLink = false, keepInitialDate = false) {
  await page.goto(school.baseURL + (coach ? "/coach" : "/admin") + (oldLink ? "?tab=transport" : ""));
  await page.getByTestId("input-staff-login-id").fill(coach ? "synthetic-coach" : "admin");
  await page.getByTestId("input-admin-password").fill(PASSWORD);
  await page.getByTestId("button-admin-login").click();
  if (!keepInitialDate) await selectStaffDate(page, school.dates.original);
  await expectSimpleTransport(page);
}

test("送迎不要：保護者入力→自動受付控え→再表示→訂正→取消", async ({ page, browser, school }, info) => {
  const before = await attendanceSnapshot(school);
  await staffLogin(page, school);
  await expect(page.getByRole("button", { name: /コード.*発行/ })).toHaveCount(0);
  const context = await browser.newContext({ viewport: page.viewportSize(), isMobile: info.project.name === "mobile-chromium",
    hasTouch: info.project.name === "mobile-chromium", timezoneId: "America/Los_Angeles", locale: "ja-JP", serviceWorkers: "block" });
  await context.route("**/*", async route => new URL(route.request().url()).origin === school.baseURL ? route.continue() : route.abort("blockedbyclient"));
  const parent = await context.newPage();
  try {
    await parent.goto(school.baseURL);
    const initialViewport = parent.viewportSize()!;
    if (info.project.name === "mobile-chromium") await parent.setViewportSize({ width: 320, height: 844 });
    const entry = parent.getByTestId("transport-entry");
    const help = parent.getByRole("heading", { name: "はじめての方へ - システムの使い方", exact: true });
    await expect(entry).toContainText("送迎不要の連絡");
    await expect(entry).toContainText("出席する日の送迎を使わないとき");
    const helpBox = await help.boundingBox(), entryBox = await entry.boundingBox();
    expect(entryBox!.y).toBeGreaterThan(helpBox!.y + helpBox!.height);
    expect(helpBox!.x + helpBox!.width).toBeLessThanOrEqual(parent.viewportSize()!.width);
    expect(await parent.getByTestId("transport-entry-description").evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      return range.getClientRects().length;
    })).toBe(1);
    await noHorizontalOverflow(parent);
    await parent.screenshot({ path: info.outputPath("transport-entry.png"), fullPage: true, animations: "disabled" });
    await parent.setViewportSize(initialViewport);
    await entry.click();
    await expect(parent.getByLabel("スクールから案内された送迎連絡コード")).toHaveCount(0);
    await fillTransport(parent, school);
    await parent.getByRole("radio", { name: "帰り不要（スクールから帰る便）", exact: true }).check();
    await parent.getByLabel("補足（任意・300文字まで）").fill("帰りは保護者が迎えに行きます");
    await noHorizontalOverflow(parent);
    await parent.screenshot({ path: info.outputPath("transport-input.png"), fullPage: true, animations: "disabled" });
    await parent.getByRole("button", { name: "送信内容を確認", exact: true }).click();
    await expect(parent.getByTestId("transport-review")).toContainText(school.dates.original + " のみ");
    await expect(parent.getByTestId("transport-review")).toContainText("帰り不要");
    await parent.screenshot({ path: info.outputPath("transport-parent-review.png"), fullPage: true, animations: "disabled" });
    await parent.getByRole("button", { name: "この内容で送信", exact: true }).click();
    await expect(parent.getByTestId("transport-saved")).toContainText("帰り不要");
    await expect(parent.getByTestId("transport-receipt-code")).toHaveText(/^R-[A-Za-z0-9_-]{24}$/);
    const receipt = await parent.getByTestId("transport-receipt-code").innerText();
    await parent.screenshot({ path: info.outputPath("transport-receipt.png"), fullPage: true, animations: "disabled" });
    const profileId = (await school.pool.query("SELECT id FROM transport_profiles")).rows[0].id;
    await page.getByRole("button", { name: "送迎連絡を更新", exact: true }).click();
    const card = page.getByTestId("staff-transport-" + profileId);
    await expect(card).toContainText("帰り不要");
    await expect(card).not.toContainText("保護者入力");
    await expect(card).not.toContainText(/クラス帯|初級|中級|上級/);
    await expect(parent.locator("main")).not.toContainText(/クラス帯|初級|中級|上級/);
    await expectSimpleTransport(page);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath("transport-staff-confirmed.png"), fullPage: true, animations: "disabled" });
    await parent.reload();
    await recoverReceipt(parent, receipt);
    await expectSimpleTransport(parent);
    await parent.getByRole("radio", { name: "往復不要（行き・帰りの両方）", exact: true }).check();
    await parent.getByRole("button", { name: "訂正内容を確認", exact: true }).click();
    await parent.getByRole("button", { name: "この内容で送信", exact: true }).click();
    await expect(parent.getByTestId("transport-saved")).toContainText("往復不要");
    await expectSimpleTransport(parent);
    parent.once("dialog", dialog => dialog.accept());
    await parent.getByRole("button", { name: "この日の連絡を取り消す", exact: true }).click();
    await expect(parent.getByTestId("transport-saved")).toContainText("取消済み");
    await page.getByRole("button", { name: "送迎連絡を更新", exact: true }).click();
    await expect(card).toContainText("取消済み");
    await noHorizontalOverflow(parent);
    await parent.screenshot({ path: info.outputPath("transport-parent-cancelled.png"), fullPage: true, animations: "disabled" });
    await page.screenshot({ path: info.outputPath("transport-staff-cancelled.png"), fullPage: true, animations: "disabled" });
    expect(await attendanceSnapshot(school)).toEqual(before);
    expect(await school.deliveries()).toEqual([]);
  } finally { await context.close(); }
});

test("送迎不要：兄弟も個別に入力し、本人用控えで再表示できる", async ({ page, school }) => {
  await page.goto(school.baseURL + "/transport");
  await fillTransport(page, school);
  await page.getByRole("button", { name: "送信内容を確認", exact: true }).click();
  await page.getByRole("button", { name: "この内容で送信", exact: true }).click();
  await expect(page.getByTestId("transport-receipt-code")).toBeVisible();
  const a = await page.getByTestId("transport-receipt-code").innerText();
  await page.getByRole("button", { name: "別のお子様・別の日の連絡を入力" }).click();
  await fillTransport(page, school, CHILD_B);
  await page.getByRole("radio", { name: /11:00 - 合成回帰テスト/ }).click();
  await expect(page.getByRole("radio", { name: /11:00 - 合成回帰テスト/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "送信内容を確認", exact: true }).click();
  await page.getByRole("button", { name: "この内容で送信", exact: true }).click();
  await expect(page.getByRole("heading", { name: CHILD_B + "さんの連絡" })).toBeVisible();
  const b = await page.getByTestId("transport-receipt-code").innerText();
  expect(a).not.toBe(b);
  await school.expireSessions();
  await page.reload();
  await recoverReceipt(page, a);
  await expect(page.getByRole("heading", { name: CHILD_A + "さんの連絡" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(CHILD_B);
  await noHorizontalOverflow(page);
});

test("送迎不要：スタッフは閲覧のみ、既存の送迎記録も保持する", async ({ page, school }, info) => {
  const modern = await selfSubmission(school);
  expect(modern.status).toBe(200);
  const { create, enter } = await transportSetup(school);
  const old = await create(CHILD_B);
  const cookie = await enter(old.code);
  expect((await school.api("/api/transport/notices", noticeInput(old.profile.id, school.dates.original), cookie)).status).toBe(200);
  await staffLogin(page, school, true);
  await expect(page.getByTestId("staff-transport-" + modern.body.profile.id)).toContainText(CHILD_A);
  await expect(page.getByTestId("staff-transport-" + old.profile.id)).toContainText(CHILD_B);
  await expect(page.getByTestId("staff-transport-" + old.profile.id)).not.toContainText(/クラス帯|初級|中級|上級/);
  await expect(page.getByRole("button", { name: "この内容を確認済みにする" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /コード.*発行/ })).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath("transport-staff-readonly.png"), fullPage: true, animations: "disabled" });
  await page.goto(school.baseURL + "/transport");
  await recoverReceipt(page, old.code);
  await page.getByLabel("対象日（日本時間）").fill(school.dates.original);
  await expect(page.getByTestId("transport-saved")).toContainText("行き不要");
});

test("送迎不要：開始前の確認画面から開始時刻に新規送信できない", async ({ page, school }, info) => {
  const start = parseJstDateTime(school.dates.original, "10:00").getTime();
  await school.setClock(new Date(start - 1000).toISOString());
  await page.goto(school.baseURL + "/transport");
  await fillTransport(page, school);
  await page.getByRole("button", { name: "送信内容を確認", exact: true }).click();
  await expect(page.getByTestId("transport-review")).toBeVisible();
  await school.setClock(new Date(start).toISOString());
  const response = page.waitForResponse(response => response.url().endsWith("/api/transport/submissions") && response.request().method() === "POST");
  await page.getByRole("button", { name: "この内容で送信", exact: true }).click();
  expect((await response).status()).toBe(400);
  await expect(page.getByRole("alert")).toContainText("レッスン開始");
  expect((await school.pool.query("SELECT count(*) FROM transport_notices")).rows[0].count).toBe("0");
  await noHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath("transport-deadline-closed.png"), fullPage: true, animations: "disabled" });
});


test("送迎不要：級を選ばず同時刻のコースを区別し、候補1件なら自動選択する", async ({ page, school }, info) => {
  await school.pool.query("INSERT INTO class_slots(id,date,start_time,course_label,class_band,lesson_start_date_time,capacity_limit,capacity_current) SELECT 'same-course-middle',date,start_time,course_label,'中級',lesson_start_date_time,capacity_limit,capacity_current FROM class_slots WHERE id=$1", [school.ids.original]);
  await school.pool.query("INSERT INTO class_slots(id,date,start_time,course_label,class_band,lesson_start_date_time,capacity_limit,capacity_current) SELECT 'other-course-upper',date,start_time,'別コース','上級',lesson_start_date_time,capacity_limit,capacity_current FROM class_slots WHERE id=$1", [school.ids.original]);
  await page.goto(school.baseURL + "/transport");
  await page.getByLabel("お子様の名前（ひらがなで入力）", { exact: true }).fill(CHILD_A);
  const date = page.getByLabel("送迎を利用しない日", { exact: true });
  await date.fill(school.dates.original);
  const choices = page.getByRole("radiogroup", { name: "出席するレッスン枠" });
  await expect(choices.getByRole("radio")).toHaveCount(3); // Two grades of the same course share one choice.
  await expect(choices).not.toContainText(/クラス帯|初級|中級|上級/);
  await expect(page.getByRole("button", { name: "送信内容を確認", exact: true })).toBeDisabled();
  await date.fill(school.dates.later);
  await expect(choices.getByRole("radio")).toHaveCount(1);
  await expect(choices.getByRole("radio")).toHaveAttribute("aria-checked", "true");
  await date.fill(school.dates.original);
  const other = page.getByRole("radio", { name: "10:00 - 別コース", exact: true });
  await other.click();
  await expect(other).toHaveAttribute("aria-checked", "true");
  await noHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath("transport-lesson-choices.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "送信内容を確認", exact: true }).click();
  await expect(page.getByTestId("transport-review")).toContainText("別コース");
  await expect(page.getByTestId("transport-review")).not.toContainText(/初級|中級|上級/);
  await page.getByRole("button", { name: "この内容で送信", exact: true }).click();
  await expect(page.getByTestId("transport-saved")).toBeVisible();
  expect((await school.pool.query("SELECT class_band FROM transport_profiles")).rows).toEqual([{ class_band: "上級" }]);
});

// Exercise the daily view with a browser whose civil date differs from Japan.
test.describe("本日の状況の送迎連絡", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("日本時間・日付連動・訂正・取消・再取得を出席と分けて表示", async ({ page, school }, info) => {
    test.setTimeout(90_000);
    const before = await attendanceSnapshot(school);
    await page.clock.setFixedTime(new Date(`${school.dates.original}T01:00:00+09:00`));
    const saved = await selfSubmission(school, { direction: "INBOUND", note: "合成補足：帰りは保護者が迎えます" + "あ".repeat(200) });
    expect(saved.status, saved.body.error).toBe(200);
    const profileId = saved.body.profile.id;
    const admin = await school.api("/api/admin/login", { loginId: "admin", password: PASSWORD });
    expect((await school.api(`/api/admin/transport/notices/${saved.body.notice.id}/acknowledge`, { version: 1 }, admin.cookie!)).status).toBe(200);
    const history = (await school.pool.query("SELECT * FROM transport_notices")).rows;
    await staffLogin(page, school, false, true, true);
    await expect(page.getByTestId("tab-daily-status")).toHaveAttribute("data-state", "active");
    await expect(page.locator(".rdp [aria-selected=true]")).toHaveText(String(Number(school.dates.original.slice(-2))));
    const card = page.getByTestId("staff-transport-" + profileId);
    await expect(card).toContainText(CHILD_A);
    await expect(card).toContainText("帰り不要");
    await expect(card).toContainText("合成補足：帰りは保護者が迎えます");
    await expectSimpleTransport(page);
    await expect(card).not.toContainText(/レッスンには出席予定|保護者入力|更新：|のみ/);
    await expect(card.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("欠席者はいません", { exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath("daily-transport-active.png"), fullPage: true, animations: "disabled" });
    expect((await school.pool.query("SELECT * FROM transport_notices")).rows).toEqual(history);
    expect((await school.api("/api/transport/notices", noticeInput(profileId, school.dates.original, { direction: "OUTBOUND", expectedVersion: 1 }), saved.cookie!)).status).toBe(200);
    // The real 30-second refresh must pick up a correction made elsewhere.
    await expect(card).toContainText("行き不要", { timeout: 35_000 });
    await expectSimpleTransport(page);
    expect((await school.api("/api/transport/notices", noticeInput(profileId, school.dates.original, { direction: "BOTH", expectedVersion: 2 }), saved.cookie!)).status).toBe(200);
    await page.getByTestId("tab-courses").click();
    await page.getByTestId("tab-daily-status").click();
    await expect(card).toContainText("往復不要");
    const day = Number(school.dates.original.slice(-2));
    const emptyDay = day === 1 ? 2 : day - 1;
    await page.locator(".rdp button:not(.day-outside)").filter({ hasText: new RegExp(`^${emptyDay}$`) }).click();
    await expect(page.getByText("この日の連絡はありません。", { exact: true })).toBeVisible();
    await expect(card).toHaveCount(0);
    await page.locator(".rdp button:not(.day-outside)").filter({ hasText: new RegExp(`^${day}$`) }).click();
    await expect(card).toContainText("往復不要");
    expect((await school.api("/api/transport/notices", noticeInput(profileId, school.dates.original, { direction: "BOTH", status: "CANCELLED", expectedVersion: 3 }), saved.cookie!)).status).toBe(200);
    await page.getByRole("button", { name: "送迎連絡を更新", exact: true }).click();
    await expect(card).toContainText("取消済み");
    await expect(card).toContainText("取消済み（往復不要）");
    await expectSimpleTransport(page);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath("daily-transport-cancelled.png"), fullPage: true, animations: "disabled" });
    expect(await attendanceSnapshot(school)).toEqual(before);
    expect(await school.deliveries()).toEqual([]);
  });

  test("読込失敗を0件と表示せず再試行できる", async ({ page, school }, info) => {
    await page.clock.setFixedTime(new Date(`${school.dates.original}T01:00:00+09:00`));
    await staffLogin(page, school);
    let fail = true;
    await page.route("**/api/admin/transport/notices?*", route => fail
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "合成読込失敗" }) })
      : route.continue());
    await page.getByRole("button", { name: "送迎連絡を更新", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "送迎連絡を読み込めませんでした" })).toBeVisible();
    await expect(page.getByText("この日の連絡はありません。", { exact: true })).toHaveCount(0);
    await expect(page.getByText("未確認 0件", { exact: true })).toHaveCount(0);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath("daily-transport-error.png"), fullPage: true, animations: "disabled" });
    fail = false;
    await page.getByRole("button", { name: "送迎連絡を更新", exact: true }).click();
    await expect(page.getByText("この日の連絡はありません。", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "送迎連絡を読み込めませんでした" })).toHaveCount(0);
  });

  test("コーチも日本時間の選択日で参照し必要な出席警告を表示", async ({ page, school }, info) => {
    await school.absence();
    const saved = await selfSubmission(school);
    expect(saved.status, saved.body.error).toBe(200);
    const before = await attendanceSnapshot(school);
    const history = (await school.pool.query("SELECT * FROM transport_notices")).rows;
    const acknowledgements: string[] = [];
    page.on("request", request => { if (request.url().includes("/acknowledge")) acknowledgements.push(request.url()); });
    await page.clock.setFixedTime(new Date(`${school.dates.original}T01:00:00+09:00`));
    await staffLogin(page, school, true, true, true);
    await expect(page.locator(".rdp [aria-selected=true]")).toHaveText(String(Number(school.dates.original.slice(-2))));
    const card = page.getByTestId("staff-transport-" + saved.body.profile.id);
    await expect(card.getByRole("alert")).toContainText("同名の欠席連絡があります。");
    await expect(card).not.toContainText("保護者入力の連絡です。");
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath("coach-transport-warning.png"), fullPage: true, animations: "disabled" });
    const day = Number(school.dates.original.slice(-2));
    const emptyDate = school.dates.original.slice(0, -2) + String(day === 1 ? 2 : day - 1).padStart(2, "0");
    await selectStaffDate(page, emptyDate);
    await expect(page.getByText("この日の連絡はありません。", { exact: true })).toBeVisible();
    await expect(card).toHaveCount(0);
    await selectStaffDate(page, school.dates.original);
    await expect(card).toContainText("行き不要");
    expect(acknowledgements).toEqual([]);
    expect((await school.pool.query("SELECT * FROM transport_notices")).rows).toEqual(history);
    expect(await attendanceSnapshot(school)).toEqual(before);
    expect(await school.deliveries()).toEqual([]);
  });
});

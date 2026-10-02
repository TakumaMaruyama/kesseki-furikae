import { test as base, expect, type Page } from "@playwright/test";
import { createSchoolFixture, CHILD_A, CHILD_B, PASSWORD, type SchoolFixture } from "./fixture";
import { attendanceSnapshot, noticeInput, transportSetup } from "./transport-helpers";
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

test("送迎不要：スタッフ登録→保護者送信→スタッフ確認→訂正→取消", async ({ page, browser, school }, info) => {
  await transportSetup(school);
  const before = await attendanceSnapshot(school);
  await page.goto(`${school.baseURL}/admin`);
  await page.getByTestId("input-staff-login-id").fill("admin");
  await page.getByTestId("input-admin-password").fill(PASSWORD);
  await page.getByTestId("button-admin-login").click();
  await page.getByTestId("tab-transport").click();
  await page.getByText("送迎対象の登録・連絡コード", { exact: true }).click();
  await page.getByLabel("お子様の名前（ひらがな）", { exact: true }).fill(CHILD_A);
  await page.getByLabel("通常コース", { exact: true }).selectOption("transport-course");
  await page.getByLabel("行き", { exact: true }).check();
  await page.getByLabel("帰り", { exact: true }).check();
  await page.getByRole("button", { name: "対象児童を登録してコードを発行" }).click();
  await expect(page.getByTestId("transport-issued-code")).toBeVisible();
  const code = await page.getByTestId("transport-issued-code").innerText();
  const profileId = (await school.pool.query("SELECT id FROM transport_profiles WHERE child_name=$1", [CHILD_A])).rows[0].id;
  await page.getByText("送迎対象の登録・連絡コード", { exact: true }).click();
  const context = await browser.newContext({ viewport: page.viewportSize(), isMobile: info.project.name === "mobile-chromium",
    hasTouch: info.project.name === "mobile-chromium", timezoneId: "America/Los_Angeles", locale: "ja-JP", serviceWorkers: "block" });
  await context.route("**/*", async (route) => new URL(route.request().url()).origin === school.baseURL ? route.continue() : route.abort("blockedbyclient"));
  const parent = await context.newPage();
  try {
    await parent.goto(school.baseURL);
    await parent.getByTestId("transport-entry").click();
    await parent.getByLabel("スクールから案内された送迎連絡コード").fill(code);
    await parent.getByRole("button", { name: "お子様を表示" }).click();
    await parent.getByLabel("送迎を利用しない日（日本時間）").fill(school.dates.original);
    await expect(parent.getByTestId("transport-eligibility")).toContainText("出席予定");
    await parent.getByRole("radio", { name: "帰り不要（スクールから帰る便）", exact: true }).check();
    await parent.getByLabel("補足（任意・300文字まで）").fill("帰りは保護者が迎えに行きます");
    await parent.getByRole("button", { name: "送信内容を確認", exact: true }).click();
    await expect(parent.getByTestId("transport-review")).toContainText(`${school.dates.original} のみ`);
    await expect(parent.getByTestId("transport-review")).toContainText("帰り不要");
    await noHorizontalOverflow(parent);
    await parent.screenshot({ path: info.outputPath("transport-parent-review.png"), fullPage: true, animations: "disabled" });
    await parent.getByRole("button", { name: "この内容で送信", exact: true }).click();
    await expect(parent.getByTestId("transport-saved")).toContainText("スタッフ未確認");
    await expect(parent.getByTestId("transport-saved")).toContainText("帰り不要");
    await page.getByLabel("対象日（日本時間）").fill(school.dates.original);
    await page.getByRole("button", { name: "送迎連絡を更新", exact: true }).click();
    const staffCard = page.getByTestId(`staff-transport-${profileId}`);
    await expect(staffCard).toContainText("帰り不要");
    await staffCard.getByRole("button", { name: "この内容を確認済みにする" }).click();
    await expect(staffCard).toContainText("スタッフ確認済み");
    await noHorizontalOverflow(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath("transport-staff-confirmed.png"), fullPage: true, animations: "disabled" });
    await parent.reload();
    await parent.getByLabel("送迎を利用しない日（日本時間）").fill(school.dates.original);
    await expect(parent.getByTestId("transport-saved")).toContainText("スタッフ確認済み");
    await parent.getByRole("radio", { name: "往復不要（行き・帰りの両方）", exact: true }).check();
    await parent.getByLabel("補足（任意・300文字まで）").fill("行きも保護者が送ります");
    await parent.getByRole("button", { name: "訂正内容を確認", exact: true }).click();
    await parent.getByRole("button", { name: "この内容で送信", exact: true }).click();
    await expect(parent.getByTestId("transport-saved")).toContainText("往復不要");
    await page.getByRole("button", { name: "送迎連絡を更新", exact: true }).click();
    await expect(staffCard).toContainText("往復不要");
    await expect(staffCard.getByRole("button", { name: "この内容を確認済みにする" })).toBeVisible();
    parent.once("dialog", (dialog) => dialog.accept());
    await parent.getByRole("button", { name: "この日の連絡を取り消す", exact: true }).click();
    await expect(parent.getByTestId("transport-saved")).toContainText("取消済み");
    await page.getByRole("button", { name: "送迎連絡を更新", exact: true }).click();
    await expect(staffCard).toContainText("取消済み");
    await expect(staffCard.getByRole("button", { name: "この内容を確認済みにする" })).toBeVisible();
    await parent.screenshot({ path: info.outputPath("transport-parent-cancelled.png"), fullPage: true, animations: "disabled" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath("transport-staff-cancelled.png"), fullPage: true, animations: "disabled" });
    expect(await attendanceSnapshot(school)).toEqual(before);
    expect(await school.deliveries()).toEqual([]);
  } finally { await context.close(); }
});

test("送迎不要：兄弟の切替と期限切れ後の再認証", async ({ page, school }) => {
  const { create } = await transportSetup(school);
  const a = await create(), b = await create(CHILD_B, { inbound: false });
  await page.goto(`${school.baseURL}/transport`);
  await page.getByLabel("スクールから案内された送迎連絡コード").fill(a.code);
  await page.getByRole("button", { name: "お子様を表示" }).click();
  await expect(page.getByRole("heading", { name: `${CHILD_A}さんの連絡` })).toBeVisible();
  await page.getByLabel("スクールから案内された送迎連絡コード").fill(b.code);
  await page.getByRole("button", { name: "別のお子様を追加" }).click();
  await expect(page.getByRole("heading", { name: `${CHILD_B}さんの連絡` })).toBeVisible();
  await page.getByLabel("送迎を利用しない日（日本時間）").fill(school.dates.original);
  await expect(page.getByRole("radio", { name: "帰り不要（スクールから帰る便）", exact: true })).toBeDisabled();
  await page.getByLabel("連絡するお子様", { exact: true }).selectOption(a.profile.id);
  await expect(page.getByRole("heading", { name: `${CHILD_A}さんの連絡` })).toBeVisible();
  await expect(page.getByRole("radio", { name: "帰り不要（スクールから帰る便）", exact: true })).toBeEnabled();
  await page.waitForLoadState("networkidle");
  await school.expireSessions();
  await page.reload();
  await expect(page.getByRole("button", { name: "お子様を表示", exact: true })).toBeVisible();
  await expect(page.getByLabel("連絡するお子様", { exact: true })).toHaveCount(0);
  await page.getByLabel("スクールから案内された送迎連絡コード").fill(a.code);
  await page.getByRole("button", { name: "お子様を表示" }).click();
  await expect(page.getByRole("heading", { name: `${CHILD_A}さんの連絡` })).toBeVisible();
  await noHorizontalOverflow(page);
});

test("送迎不要：スタッフ閲覧と管理者の退会停止・コード再発行", async ({ page, browser, school }, info) => {
  const { create, enter } = await transportSetup(school);
  const { profile, code } = await create();
  const cookie = await enter(code);
  expect((await school.api("/api/transport/notices", noticeInput(profile.id, school.dates.original), cookie)).status).toBe(200);
  const before = await attendanceSnapshot(school);
  const context = await browser.newContext({ viewport: page.viewportSize(), locale: "ja-JP", serviceWorkers: "block" });
  await context.route("**/*", async (route) => new URL(route.request().url()).origin === school.baseURL ? route.continue() : route.abort("blockedbyclient"));
  const parent = await context.newPage();
  try {
    await parent.goto(`${school.baseURL}/transport`);
    await parent.getByLabel("スクールから案内された送迎連絡コード").fill(code);
    await parent.getByRole("button", { name: "お子様を表示", exact: true }).click();
    await expect(parent.getByRole("heading", { name: `${CHILD_A}さんの連絡` })).toBeVisible();
    await page.goto(`${school.baseURL}/coach`);
    await page.getByTestId("input-staff-login-id").fill("synthetic-coach");
    await page.getByTestId("input-admin-password").fill(PASSWORD);
    await page.getByTestId("button-admin-login").click();
    await page.getByTestId("coach-transport").click();
    await page.getByLabel("対象日（日本時間）").fill(school.dates.original);
    const card = page.getByTestId(`staff-transport-${profile.id}`);
    await expect(card).toContainText("行き不要");
    await expect(card).toContainText("管理者が確認を記録します");
    await expect(page.getByRole("button", { name: "この内容を確認済みにする" })).toHaveCount(0);
    await expect(page.getByText("送迎対象の登録・連絡コード", { exact: true })).toHaveCount(0);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath("transport-staff-readonly.png"), fullPage: true, animations: "disabled" });
    await page.getByTestId("button-coach-logout").click();
    await page.goto(`${school.baseURL}/admin`);
    await page.getByTestId("input-staff-login-id").fill("admin");
    await page.getByTestId("input-admin-password").fill(PASSWORD);
    await page.getByTestId("button-admin-login").click();
    await page.getByTestId("tab-transport").click();
    await page.getByText("送迎対象の登録・連絡コード", { exact: true }).click();
    const roster = page.getByTestId(`transport-roster-${profile.id}`);
    page.once("dialog", (dialog) => dialog.accept());
    await roster.getByRole("button", { name: "コードを停止（退会・利用停止）", exact: true }).click();
    await expect(roster).toContainText("停止中");
    await parent.reload();
    await expect(parent.getByRole("heading", { name: `${CHILD_A}さんの連絡` })).toHaveCount(0);
    await parent.getByLabel("スクールから案内された送迎連絡コード").fill(code);
    await parent.getByRole("button", { name: "お子様を表示", exact: true }).click();
    await expect(parent.getByRole("alert")).toContainText("コード");
    page.once("dialog", (dialog) => dialog.accept());
    await roster.getByRole("button", { name: "再開してコードを発行", exact: true }).click();
    await expect(roster).toContainText("利用中");
    const newCode = await page.getByTestId("transport-issued-code").innerText();
    expect(newCode).not.toBe(code);
    await parent.getByLabel("スクールから案内された送迎連絡コード").fill(newCode);
    await parent.getByRole("button", { name: "お子様を表示", exact: true }).click();
    await parent.getByLabel("送迎を利用しない日（日本時間）").fill(school.dates.original);
    await expect(parent.getByTestId("transport-saved")).toContainText("行き不要");
    await expect(parent.getByTestId("transport-saved")).toContainText("スタッフ未確認");
    expect(await attendanceSnapshot(school)).toEqual(before);
  } finally { await context.close(); }
});

test("送迎不要：レッスン開始前の確認画面も開始時刻には送信できない", async ({ page, school }, info) => {
  const start = parseJstDateTime(school.dates.original, "10:00").getTime();
  await school.setClock(new Date(start - 1).toISOString());
  const { create, enter } = await transportSetup(school);
  const { profile, code } = await create();
  const cookie = await enter(code);
  expect((await school.api("/api/transport/notices", noticeInput(profile.id, school.dates.original), cookie)).status).toBe(200);
  await page.goto(`${school.baseURL}/transport`);
  await page.getByLabel("スクールから案内された送迎連絡コード").fill(code);
  await page.getByRole("button", { name: "お子様を表示", exact: true }).click();
  await page.getByLabel("送迎を利用しない日（日本時間）").fill(school.dates.original);
  await expect(page.getByTestId("transport-saved")).toContainText("行き不要");
  await page.getByRole("radio", { name: "帰り不要（スクールから帰る便）", exact: true }).check();
  await page.getByRole("button", { name: "訂正内容を確認", exact: true }).click();
  await expect(page.getByTestId("transport-review")).toContainText("帰り不要");
  await school.setClock(new Date(start).toISOString());
  const response = page.waitForResponse((response) => response.url().endsWith("/api/transport/notices") && response.request().method() === "POST");
  await page.getByRole("button", { name: "この内容で送信", exact: true }).click();
  expect((await response).status()).toBe(400);
  await expect(page.getByRole("alert")).toContainText("レッスン開始");
  await expect(page.getByTestId("transport-saved")).toContainText("行き不要");
  await expect(page.getByRole("button", { name: "この日の連絡を取り消す", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "訂正内容を確認", exact: true })).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath("transport-deadline-closed.png"), fullPage: true, animations: "disabled" });
  const notice = (await school.pool.query("SELECT direction,version,status FROM transport_notices WHERE profile_id=$1", [profile.id])).rows;
  expect(notice).toEqual([{ direction: "OUTBOUND", version: 1, status: "ACTIVE" }]);
});

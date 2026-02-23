import { getUncachableResendClient } from "./resend-client";

// 本番環境のURLを優先的に使用
function getBaseUrl(): string {
  // 本番デプロイメント環境（REPLIT_DEPLOYMENT=1）
  if (process.env.REPLIT_DEPLOYMENT === "1") {
    if (process.env.REPLIT_DOMAINS) {
      // REPLIT_DOMAINSはカンマ区切りなので、最初のドメインを取得
      const domains = process.env.REPLIT_DOMAINS.split(",");
      const domain = domains[0].trim();
      return `https://${domain}`;
    }
  }
  // 開発環境のURL
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  // フォールバック
  return "https://hamasui-yoyaku.replit.app";
}

const BASE_URL = getBaseUrl();
console.log(`📧 メール送信用BASE_URL: ${BASE_URL}`);

// 日本時間フォーマット関数
function formatJST(date: Date, formatString: string): string {
  const jstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const year = jstDate.getFullYear();
  const month = jstDate.getMonth() + 1;
  const day = jstDate.getDate();
  const hours = jstDate.getHours();
  const minutes = jstDate.getMinutes();

  return formatString
    .replace('yyyy', year.toString())
    .replace('M', month.toString())
    .replace('d', day.toString())
    .replace('HH', hours.toString().padStart(2, '0'))
    .replace('mm', minutes.toString().padStart(2, '0'));
}

// メール送信リトライ機能
async function sendEmailWithRetry(
  sendFn: () => Promise<any>,
  emailType: string,
  recipient: string,
  maxRetries: number = 3
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await sendFn();
      console.log(`✅ ${emailType}メール送信成功 (試行${attempt}回目):`, recipient);
      return;
    } catch (error: any) {
      console.error(`❌ ${emailType}メール送信エラー (試行${attempt}回目):`, error);
      console.error("エラー詳細:", error.message, error.response?.data);

      if (attempt === maxRetries) {
        console.error(`🚨 ${emailType}メール送信失敗 (最大試行回数に達しました):`, recipient);
        throw error;
      }

      // 指数バックオフで待機
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      console.log(`⏳ ${waitTime}ms後に再試行...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

export async function sendAbsenceConfirmationEmail(
  toEmail: string,
  childName: string,
  classBand: string,
  absentDate: string,
  makeupDeadline: string,
  resumeToken: string,
  absenceId?: string,
  courseLabel?: string,
  startTime?: string,
  confirmCode?: string
) {
  const { client, fromEmail } = await getUncachableResendClient();

  const resumeUrl = `${BASE_URL}/absence?token=${resumeToken}`;
  const cancelUrl = absenceId && resumeToken
    ? `${BASE_URL}/cancel-absence/${resumeToken}`
    : null;

  const htmlContent = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>欠席連絡受付完了</title>
  <style>
    body {
      font-family: "Noto Sans JP", sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: #ffffff;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #0066cc;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .header h1 {
      color: #0066cc;
      font-size: 24px;
      margin: 0;
    }
    .content {
      margin-bottom: 24px;
    }
    .info-box {
      background-color: #f0f7ff;
      border-left: 4px solid #0066cc;
      padding: 16px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .info-box p {
      margin: 8px 0;
      font-size: 16px;
    }
    .info-box strong {
      color: #0066cc;
    }
    .button {
      display: inline-block;
      background-color: #0066cc;
      color: #ffffff !important;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      text-align: center;
      margin: 20px 0;
    }
    .footer {
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid #e5e5e5;
      font-size: 14px;
      color: #666;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ 欠席連絡を受け付けました</h1>
    </div>

    <div class="content">
      <p>いつもご利用ありがとうございます。</p>
      <p><strong>${childName}</strong> さんの欠席連絡を受け付けました。</p>

      <div class="info-box">
        <p><strong>お子様名：</strong>${childName}</p>
        <p><strong>クラス帯：</strong>${classBand}</p>
        ${courseLabel ? `<p><strong>コース：</strong>${courseLabel}</p>` : ''}
        ${startTime ? `<p><strong>時間：</strong>${startTime}</p>` : ''}
        <p><strong>欠席日：</strong>${absentDate}</p>
        <p><strong>振替期限：</strong>${makeupDeadline}</p>
        ${confirmCode ? `<p style="margin-top: 12px; padding: 12px; background-color: #f3f4f6; border-radius: 8px; text-align: center;">
          <strong>確認コード：</strong>
          <span style="font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #0066cc;">${confirmCode}</span>
        </p>` : ''}
      </div>
      ${confirmCode ? `
      <div style="background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 12px; margin: 16px 0; border-radius: 4px; font-size: 14px;">
        <p style="font-weight: 600; color: #1e40af; margin: 0 0 8px 0;">📋 確認コードについて</p>
        <p style="margin: 0; color: #1e40af;">
          この6桁の確認コードで、予約状況の確認やキャンセルができます。メールが届かなくても大丈夫！確認コードをメモしておいてください。
        </p>
      </div>
      ` : ''}

      <div style="background-color: #f0f7ff; border-left: 4px solid #0066cc; padding: 16px; margin: 20px 0; border-radius: 4px;">
        <p style="font-weight: 600; margin: 0 0 8px 0;">📌 振替予約の流れ</p>
        <ol style="margin: 8px 0; padding-left: 20px; font-size: 14px;">
          <li style="margin: 4px 0;">下記のボタンをクリックして振替予約画面へ</li>
          <li style="margin: 4px 0;">カレンダーまたはリストから希望の日時を選択</li>
          <li style="margin: 4px 0;">空きがあればその場で予約確定</li>
          <li style="margin: 4px 0;">予約確定時にメールで通知が届きます</li>
        </ol>
      </div>

      <div style="text-align: center;">
        <a href="${resumeUrl}" class="button">振替予約へ進む</a>
      </div>

      <div style="background-color: #fff7ed; border-left: 4px solid #f59e0b; padding: 12px; margin: 20px 0; border-radius: 4px; font-size: 14px;">
        <p style="font-weight: 600; color: #f59e0b; margin: 0 0 8px 0;">⚠️ 重要</p>
        <ul style="margin: 0; padding-left: 20px; color: #92400e;">
          <li style="margin: 4px 0;"><strong>このリンクは必ず保存してください</strong> - 後から振替予約を行う際に必要です</li>
          <li style="margin: 4px 0;">リンクをブックマークまたはメールを保存しておくことをお勧めします</li>
          <li style="margin: 4px 0;">振替期限: ${makeupDeadline}まで</li>
          <li style="margin: 4px 0;">欠席連絡はレッスン開始時刻までです。開始後は振替登録できません。</li>
        </ul>
      </div>

      ${cancelUrl ? `
      <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid #e5e5e5;">
        <p style="font-size: 14px; color: #666; margin-bottom: 8px;">欠席をキャンセルする場合はこちら:</p>
        <p style="font-size: 12px; color: #dc2626; margin-bottom: 12px; font-weight: 600;">
          ⚠️ 欠席登録から10分以内のみキャンセル可能です
        </p>
        <p style="font-size: 12px; color: #666; margin-bottom: 12px;">
          振替枠の関係上、欠席登録から10分経過後は、元のレッスンに空きがある場合のみキャンセルできます
        </p>
        <a href="${cancelUrl}" style="display: inline-block; background-color: #dc2626; color: #ffffff !important; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; font-size: 14px;">
          欠席連絡をキャンセル
        </a>
      </div>
      ` : ''}
    </div>

    <div class="footer">
      <p>このメールは自動送信されています。</p>
      <p>はまスイ 欠席・振替登録システム</p>
    </div>
  </div>
</body>
</html>
  `;

  console.log("📧 メール送信開始:", {
    from: fromEmail,
    to: toEmail,
    subject: `[欠席連絡受付] ${absentDate} - ${classBand}`,
    hasResumeUrl: !!resumeUrl,
    hasCancelUrl: !!cancelUrl,
  });

  await sendEmailWithRetry(
    async () => {
      const result = await client.emails.send({
        from: fromEmail,
        to: toEmail,
        subject: `[欠席連絡受付] ${absentDate} - ${classBand}`,
        html: htmlContent,
      });
      console.log("📧 メール送信結果:", result);
    },
    "欠席連絡受付",
    toEmail
  );
}

export async function sendMakeupConfirmationEmail(
  toEmail: string,
  childName: string,
  courseLabel: string,
  date: string,
  startTime: string,
  classBand: string,
  requestId?: string,
  cancelToken?: string
) {
  const { client, fromEmail } = await getUncachableResendClient();

  const cancelUrl = requestId && cancelToken
    ? `${BASE_URL}/cancel/${cancelToken}`
    : null;

  const htmlContent = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>振替予約確定のお知らせ</title>
  <style>
    body {
      font-family: "Noto Sans JP", sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: #ffffff;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #16a34a;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .header h1 {
      color: #16a34a;
      font-size: 24px;
      margin: 0;
    }
    .content {
      margin-bottom: 24px;
    }
    .info-box {
      background-color: #f0fdf4;
      border-left: 4px solid #16a34a;
      padding: 16px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .info-box p {
      margin: 8px 0;
      font-size: 16px;
    }
    .info-box strong {
      color: #16a34a;
    }
    .footer {
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid #e5e5e5;
      font-size: 14px;
      color: #666;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ 振替予約が確定しました</h1>
    </div>

    <div class="content">
      <p>いつもご利用ありがとうございます。</p>
      <p><strong>${childName}</strong> さんの振替予約が確定いたしました。</p>

      <div class="info-box">
        <p><strong>コース：</strong>${courseLabel}</p>
        <p><strong>クラス帯：</strong>${classBand}</p>
        <p><strong>日時：</strong>${date} ${startTime}</p>
      </div>

      <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 16px; margin: 20px 0; border-radius: 4px;">
        <p style="font-weight: 600; color: #16a34a; margin: 0 0 8px 0;">✅ 予約完了</p>
        <ul style="margin: 0; padding-left: 20px; font-size: 14px; color: #166534;">
          <li style="margin: 4px 0;">当日は時間に遅れないようお越しください</li>
          <li style="margin: 4px 0;">都合がつかない場合は下記のキャンセルボタンから手続きできます</li>
        </ul>
      </div>

      ${cancelUrl ? `
      <div style="text-align: center; margin-top: 24px;">
        <a href="${cancelUrl}" style="display: inline-block; background-color: #dc2626; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">
          この予約をキャンセル
        </a>
      </div>
      ` : ''}
    </div>

    <div class="footer">
      <p>このメールは自動送信されています。</p>
      <p>はまスイ 欠席・振替登録システム</p>
    </div>
  </div>
</body>
</html>
  `;

  await sendEmailWithRetry(
    async () => {
      await client.emails.send({
        from: fromEmail,
        to: toEmail,
        subject: `[振替確定] ${date} ${startTime} - ${classBand}`,
        html: htmlContent,
      });
    },
    "振替確定",
    toEmail
  );
}

export async function sendConfirmationEmail(
  toEmail: string,
  childName: string,
  courseLabel: string,
  date: string,
  startTime: string,
  classBand: string,
  declineToken: string
) {
  const { client, fromEmail } = await getUncachableResendClient();

  const declineUrl = `${BASE_URL}/decline/${declineToken}`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>振替予約確定のお知らせ</title>
  <style>
    body {
      font-family: "Noto Sans JP", sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: #ffffff;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #0066cc;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .header h1 {
      color: #0066cc;
      font-size: 24px;
      margin: 0;
    }
    .content {
      margin-bottom: 24px;
    }
    .info-box {
      background-color: #f0f7ff;
      border-left: 4px solid #0066cc;
      padding: 16px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .info-box p {
      margin: 8px 0;
      font-size: 16px;
    }
    .info-box strong {
      color: #0066cc;
    }
    .button {
      display: inline-block;
      background-color: #dc2626;
      color: #ffffff !important;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      text-align: center;
      margin: 20px 0;
    }
    .footer {
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid #e5e5e5;
      font-size: 14px;
      color: #666;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ 振替予約が確定しました</h1>
    </div>

    <div class="content">
      <p>保護者様</p>
      <p>いつもご利用ありがとうございます。</p>
      <p><strong>${childName}</strong> さんの振替予約が確定いたしました。</p>

      <div class="info-box">
        <p><strong>コース：</strong>${courseLabel}</p>
        <p><strong>クラス帯：</strong>${classBand}</p>
        <p><strong>日時：</strong>${date} ${startTime}</p>
      </div>

      <p><strong>都合が悪くなった場合の辞退について：</strong></p>
      <p>• 以下のボタンから辞退が可能です</p>
      <p>• なるべく早めにお手続きいただけますと助かります</p>

      <div style="text-align: center;">
        <a href="${declineUrl}" class="button">辞退する</a>
      </div>
    </div>

    <div class="footer">
      <p>このメールは自動送信されています。</p>
      <p>はまスイ 欠席・振替登録システム</p>
    </div>
  </div>
</body>
</html>
  `;

  await sendEmailWithRetry(
    async () => {
      await client.emails.send({
        from: fromEmail,
        to: toEmail,
        subject: `[振替確定] ${date} ${startTime} - ${classBand}`,
        html: htmlContent,
      });
    },
    "振替確定通知",
    toEmail
  );
}

export async function sendExpiredEmail(
  toEmail: string,
  childName: string,
  courseLabel: string,
  date: string,
  startTime: string,
  classBand: string
) {
  const { client, fromEmail } = await getUncachableResendClient();

  const htmlContent = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>振替予約のご案内</title>
  <style>
    body {
      font-family: "Noto Sans JP", sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: #ffffff;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #ea580c;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .header h1 {
      color: #ea580c;
      font-size: 24px;
      margin: 0;
    }
    .content {
      margin-bottom: 24px;
    }
    .info-box {
      background-color: #fff7ed;
      border-left: 4px solid #ea580c;
      padding: 16px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .info-box p {
      margin: 8px 0;
      font-size: 16px;
    }
    .footer {
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid #e5e5e5;
      font-size: 14px;
      color: #666;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>振替予約のご案内</h1>
    </div>

    <div class="content">
      <p>いつもご利用ありがとうございます。</p>
      <p><strong>${childName}</strong> さんの振替予約についてお知らせいたします。</p>

      <div class="info-box">
        <p><strong>コース：</strong>${courseLabel}</p>
        <p><strong>クラス帯：</strong>${classBand}</p>
        <p><strong>日時：</strong>${date} ${startTime}</p>
      </div>

      <p>誠に申し訳ございませんが、振替期限切れのため今回はご案内ができませんでした。</p>
      <p>また別の機会にお申し込みください。</p>
    </div>

    <div class="footer">
      <p>このメールは自動送信されています。</p>
      <p>はまスイ 欠席・振替登録システム</p>
    </div>
  </div>
</body>
</html>
  `;

  await sendEmailWithRetry(
    async () => {
      await client.emails.send({
        from: fromEmail,
        to: toEmail,
        subject: `[振替] 今回はご案内できませんでした - ${date} ${startTime} ${classBand}`,
        html: htmlContent,
      });
    },
    "期限切れ通知",
    toEmail
  );
}

export async function sendCancellationEmail(
  toEmail: string,
  childName: string,
  absentDate: string
) {
  const { client, fromEmail } = await getUncachableResendClient();

  const htmlContent = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>欠席キャンセル完了</title>
  <style>
    body {
      font-family: "Noto Sans JP", sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: #ffffff;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #6b7280;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .header h1 {
      color: #6b7280;
      font-size: 24px;
      margin: 0;
    }
    .content {
      margin-bottom: 24px;
    }
    .footer {
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid #e5e5e5;
      font-size: 14px;
      color: #666;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>欠席連絡をキャンセルしました</h1>
    </div>

    <div class="content">
      <p><strong>${childName}</strong> さんの ${absentDate} の欠席連絡をキャンセルしました。</p>
      <p>振替予約も含めてすべてキャンセルされました。</p>
    </div>

    <div class="footer">
      <p>このメールは自動送信されています。</p>
      <p>はまスイ 欠席・振替登録システム</p>
    </div>
  </div>
</body>
</html>
  `;

  await sendEmailWithRetry(
    async () => {
      await client.emails.send({
        from: fromEmail,
        to: toEmail,
        subject: `[欠席キャンセル] ${absentDate}`,
        html: htmlContent,
      });
    },
    "欠席キャンセル",
    toEmail
  );
}

export async function sendRequestCancellationEmail(
  toEmail: string,
  childName: string,
  courseLabel: string,
  date: string,
  startTime: string,
  previousStatus: string
) {
  const { client, fromEmail } = await getUncachableResendClient();

  const statusText = "振替予約";

  const htmlContent = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>キャンセル完了</title>
  <style>
    body {
      font-family: "Noto Sans JP", sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: #ffffff;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #6b7280;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .header h1 {
      color: #6b7280;
      font-size: 24px;
      margin: 0;
    }
    .content {
      margin-bottom: 24px;
    }
    .info-box {
      background-color: #f9fafb;
      border-left: 4px solid #6b7280;
      padding: 16px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .info-box p {
      margin: 8px 0;
      font-size: 16px;
    }
    .footer {
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid #e5e5e5;
      font-size: 14px;
      color: #666;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${statusText}をキャンセルしました</h1>
    </div>

    <div class="content">
      <p><strong>${childName}</strong> さんの${statusText}をキャンセルしました。</p>

      <div class="info-box">
        <p><strong>コース：</strong>${courseLabel}</p>
        <p><strong>日時：</strong>${date} ${startTime}</p>
      </div>
    </div>

    <div class="footer">
      <p>このメールは自動送信されています。</p>
      <p>はまスイ 欠席・振替登録システム</p>
    </div>
  </div>
</body>
</html>
  `;

  await sendEmailWithRetry(
    async () => {
      await client.emails.send({
        from: fromEmail,
        to: toEmail,
        subject: `[${statusText}キャンセル] ${date} ${startTime}`,
        html: htmlContent,
      });
    },
    `${statusText}キャンセル`,
    toEmail
  );
}

export async function sendPasswordResetEmail(
  toEmail: string,
  resetToken: string
) {
  const { client, fromEmail } = await getUncachableResendClient();

  const resetUrl = `${BASE_URL}/reset-password/${resetToken}`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>パスワードリセット</title>
  <style>
    body {
      font-family: "Noto Sans JP", sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: #ffffff;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #0066cc;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .header h1 {
      color: #0066cc;
      font-size: 24px;
      margin: 0;
    }
    .content {
      margin-bottom: 24px;
    }
    .button {
      display: inline-block;
      background-color: #0066cc;
      color: #ffffff !important;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      text-align: center;
      margin: 20px 0;
    }
    .footer {
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid #e5e5e5;
      font-size: 14px;
      color: #666;
      text-align: center;
    }
    .warning {
      background-color: #fff7ed;
      border-left: 4px solid #f59e0b;
      padding: 12px;
      margin: 20px 0;
      border-radius: 4px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔐 パスワードリセット</h1>
    </div>

    <div class="content">
      <p>パスワードリセットのリクエストを受け付けました。</p>
      <p>以下のボタンをクリックして、新しいパスワードを設定してください。</p>

      <div style="text-align: center;">
        <a href="${resetUrl}" class="button">パスワードをリセット</a>
      </div>

      <div class="warning">
        <p style="font-weight: 600; color: #f59e0b; margin: 0 0 8px 0;">⚠️ 注意事項</p>
        <ul style="margin: 0; padding-left: 20px; color: #92400e;">
          <li style="margin: 4px 0;">このリンクは1時間で有効期限が切れます</li>
          <li style="margin: 4px 0;">心当たりのない場合は、このメールを無視してください</li>
          <li style="margin: 4px 0;">パスワードは安全な場所で設定してください</li>
        </ul>
      </div>
    </div>

    <div class="footer">
      <p>このメールは自動送信されています。</p>
      <p>はまスイ 欠席・振替登録システム</p>
    </div>
  </div>
</body>
</html>
  `;

  await sendEmailWithRetry(
    async () => {
      const result = await client.emails.send({
        from: fromEmail,
        to: toEmail,
        subject: "[パスワードリセット] はまスイ 欠席・振替システム",
        html: htmlContent,
      });
      console.log("📧 パスワードリセットメール送信結果:", JSON.stringify(result, null, 2));
      if (result.error) {
        throw new Error(`Resend API エラー: ${result.error.message}`);
      }
    },
    "パスワードリセット",
    toEmail
  );
}

import { Resend } from 'resend';

export async function getUncachableResendClient() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY が Secrets に設定されていません');
  }

  // 独自ドメイン認証済みのメールアドレスを使用
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@hamada-swimming.com';

  console.log('Resend設定:', {
    apiKeySet: !!apiKey,
    fromEmail: fromEmail
  });

  return {
    client: new Resend(apiKey),
    fromEmail: fromEmail
  };
}
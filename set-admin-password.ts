import bcrypt from "bcryptjs";
import { storage } from "./server/storage.ts";

async function setAdminPassword(password: string) {
  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    await storage.setAdminPasswordHash(hash);
    console.log("管理者パスワードを設定しました。");
    process.exit(0);
  } catch (error) {
    console.error("エラーが発生しました:", error);
    process.exit(1);
  }
}

const password = process.argv[2];
if (!password) {
  console.error("パスワードを指定してください: npx tsx set-admin-password.ts <password>");
  process.exit(1);
}

setAdminPassword(password);

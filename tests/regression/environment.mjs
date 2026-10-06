export function cleanEnvironment() {
  const result = { NODE_ENV: "test", TZ: "Asia/Tokyo" };
  for (const key of ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot", "USER", "LOGNAME"]) {
    if (process.env[key]) result[key] = process.env[key];
  }
  return result;
}

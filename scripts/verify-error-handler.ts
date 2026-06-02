import assert from "node:assert/strict";
import { createJsonErrorHandler, type AppErrorLogEntry } from "../server/errorHandler.ts";

type MockResponse = {
  headersSent: boolean;
  statusCode: number | null;
  payload: unknown;
  status(code: number): MockResponse;
  json(body: unknown): MockResponse;
};

function createMockResponse(headersSent = false): MockResponse {
  return {
    headersSent,
    statusCode: null,
    payload: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.payload = body;
      return this;
    },
  };
}

async function main() {
  const logs: AppErrorLogEntry[] = [];
  const forwarded: unknown[] = [];
  const handler = createJsonErrorHandler((entry) => {
    logs.push(entry);
  });

  const req = { method: "POST", path: "/api/test" } as any;
  const res = createMockResponse(false) as any;
  const err = new Error("boom");

  handler(err, req, res, (forwardedError) => {
    forwarded.push(forwardedError);
  });

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.payload, { message: "boom" });
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.method, "POST");
  assert.equal(logs[0]?.path, "/api/test");
  assert.equal(logs[0]?.status, 500);
  assert.equal(logs[0]?.message, "boom");
  assert.equal(forwarded.length, 0);

  const sentRes = createMockResponse(true) as any;
  handler(err, req, sentRes, (forwardedError) => {
    forwarded.push(forwardedError);
  });

  assert.equal(sentRes.statusCode, null);
  assert.equal(logs.length, 1);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0], err);

  console.log("verify-error-handler: ok");
}

main().catch((error) => {
  console.error("verify-error-handler: failed");
  console.error(error);
  process.exitCode = 1;
});

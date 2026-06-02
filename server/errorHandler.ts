import type { NextFunction, Request, Response } from "express";

export type AppErrorLogEntry = {
  method: string;
  path: string;
  status: number;
  message: string;
  stack?: string;
};

export function logAppError(entry: AppErrorLogEntry) {
  const { stack, ...summary } = entry;
  console.error("[app:error]", JSON.stringify(summary));
  if (stack) {
    console.error(stack);
  }
}

export function createJsonErrorHandler(
  logError: (entry: AppErrorLogEntry) => void = logAppError,
) {
  return (err: any, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    const status = err?.status || err?.statusCode || 500;
    const message = err?.message || "Internal Server Error";

    logError({
      method: req.method,
      path: req.path,
      status,
      message,
      stack: typeof err?.stack === "string" ? err.stack : undefined,
    });

    res.status(status).json({ message });
  };
}

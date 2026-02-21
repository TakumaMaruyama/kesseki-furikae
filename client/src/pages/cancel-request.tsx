import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CheckCircleIcon, XCircleIcon, Loader2 } from "lucide-react";

type CancelInfoResponse = {
  message?: string;
  childName?: string;
  canCancel?: boolean;
  alreadyCancelled?: boolean;
};

export default function CancelRequestPage() {
  const [, setLocation] = useLocation();
  const searchParams = useSearch();
  const params = new URLSearchParams(searchParams);
  const requestId = params.get("requestId");
  const token = params.get("token");

  const [status, setStatus] = useState<"loading" | "ready" | "submitting" | "success" | "error">("loading");
  const [message, setMessage] = useState<string>("");
  const [childName, setChildName] = useState<string>("");
  const [canCancel, setCanCancel] = useState<boolean>(false);

  useEffect(() => {
    if (!requestId || !token) {
      setStatus("error");
      setMessage("無効なリンクです。");
      return;
    }

    const fetchCancelInfo = async () => {
      try {
        const response = await fetch(
          `/api/cancel?requestId=${encodeURIComponent(requestId)}&token=${encodeURIComponent(token)}`,
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "情報の取得に失敗しました。");
        }

        const data = await response.json() as CancelInfoResponse;

        setChildName(data.childName || "");
        setMessage(data.message || "");

        if (data.alreadyCancelled) {
          setCanCancel(false);
          setStatus("success");
          return;
        }

        setCanCancel(data.canCancel === true);
        setStatus("ready");
      } catch (error: any) {
        setStatus("error");
        setMessage(error.message || "エラーが発生しました。");
      }
    };

    fetchCancelInfo();
  }, [requestId, token]);

  const handleCancelRequest = async () => {
    if (!requestId || !token || !canCancel) return;

    setStatus("submitting");
    try {
      const response = await fetch("/api/cancel-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requestId, cancelToken: token }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "キャンセルに失敗しました。");
      }

      const data = await response.json();
      setMessage(data.message || "振替予約をキャンセルしました。");
      setStatus("success");
    } catch (error: any) {
      setStatus("error");
      setMessage(error.message || "エラーが発生しました。");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          {(status === "loading" || status === "submitting") && (
            <>
              <Loader2 className="w-16 h-16 mx-auto mb-4 animate-spin text-primary" />
              <h1 className="text-2xl font-bold">処理中...</h1>
            </>
          )}
          {status === "ready" && (
            <>
              <XCircleIcon className="w-16 h-16 mx-auto mb-4 text-amber-500" />
              <h1 className="text-2xl font-bold text-amber-600">キャンセル確認</h1>
            </>
          )}
          {status === "success" && (
            <>
              <CheckCircleIcon className="w-16 h-16 mx-auto mb-4 text-green-600" />
              <h1 className="text-2xl font-bold text-green-600">処理完了</h1>
            </>
          )}
          {status === "error" && (
            <>
              <XCircleIcon className="w-16 h-16 mx-auto mb-4 text-red-600" />
              <h1 className="text-2xl font-bold text-red-600">エラー</h1>
            </>
          )}
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {status === "ready" && (
            <>
              {childName && (
                <p className="text-lg">
                  <strong>{childName}</strong> さんの振替予約
                </p>
              )}
              <p className="text-muted-foreground">
                {message || "この振替予約をキャンセルしますか？"}
              </p>
              {canCancel && (
                <Button
                  variant="destructive"
                  onClick={handleCancelRequest}
                  data-testid="button-confirm-cancel-request"
                >
                  キャンセルする
                </Button>
              )}
            </>
          )}
          {status === "success" && (
            <>
              {childName && (
                <p className="text-lg">
                  <strong>{childName}</strong> さんの振替予約
                </p>
              )}
              <p className="text-muted-foreground">{message}</p>
            </>
          )}
          {status === "error" && (
            <p className="text-muted-foreground">{message}</p>
          )}
          <Button
            onClick={() => setLocation("/")}
            className="mt-6"
            data-testid="button-home"
          >
            トップページへ戻る
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

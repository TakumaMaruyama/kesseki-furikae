import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CheckCircleIcon, XCircleIcon, Loader2 } from "lucide-react";

export default function CancelRequestPage() {
  const [, setLocation] = useLocation();
  const searchParams = useSearch();
  const params = new URLSearchParams(searchParams);
  const requestId = params.get("requestId");
  const token = params.get("token");

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState<string>("");
  const [childName, setChildName] = useState<string>("");

  useEffect(() => {
    if (!requestId || !token) {
      setStatus("error");
      setMessage("無効なリンクです。");
      return;
    }

    const cancelRequest = async () => {
      try {
        const response = await fetch(`/api/cancel?requestId=${requestId}&token=${token}`);
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "キャンセルに失敗しました。");
        }

        const data = await response.json();
        
        setChildName(data.childName || "");
        setStatus("success");
        setMessage(data.message || "振替予約をキャンセルしました。");
      } catch (error: any) {
        setStatus("error");
        setMessage(error.message || "エラーが発生しました。");
      }
    };

    cancelRequest();
  }, [requestId, token]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          {status === "loading" && (
            <>
              <Loader2 className="w-16 h-16 mx-auto mb-4 animate-spin text-primary" />
              <h1 className="text-2xl font-bold">処理中...</h1>
            </>
          )}
          {status === "success" && (
            <>
              <CheckCircleIcon className="w-16 h-16 mx-auto mb-4 text-green-600" />
              <h1 className="text-2xl font-bold text-green-600">キャンセル完了</h1>
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
          {status === "success" && childName && (
            <p className="text-lg">
              <strong>{childName}</strong> さんの振替予約をキャンセルしました。
            </p>
          )}
          {status === "success" && (
            <p className="text-muted-foreground">
              空き枠が発生したため、次の順番待ちの方に自動的にご案内いたします。
            </p>
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

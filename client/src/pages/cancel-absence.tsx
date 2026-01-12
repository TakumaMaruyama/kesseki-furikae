import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CheckCircleIcon, XCircleIcon, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export default function CancelAbsencePage() {
  const [, setLocation] = useLocation();
  const searchParams = useSearch();
  const token = new URLSearchParams(searchParams).get("token");

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState<string>("");
  const [childName, setChildName] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("無効なリンクです。");
      return;
    }

    const cancelAbsence = async () => {
      try {
        const response = await apiRequest("POST", "/api/cancel-absence", {
          resumeToken: token,
        });

        setStatus("success");
        setChildName(response.childName || "");
        setMessage("欠席連絡をキャンセルしました。");
      } catch (error: any) {
        setStatus("error");
        setMessage(error.message || "エラーが発生しました。");
      }
    };

    cancelAbsence();
  }, [token]);

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
              <strong>{childName}</strong> さんの欠席連絡をキャンセルしました。
            </p>
          )}
          {status === "success" && (
            <p className="text-muted-foreground">
              関連する振替予約も取り消されました。
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

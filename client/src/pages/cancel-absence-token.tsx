import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CheckCircleIcon, XCircleIcon, Loader2, AlertCircle } from "lucide-react";

export default function CancelAbsenceTokenPage() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/cancel-absence/:token");
  const token = params?.token;

  const [status, setStatus] = useState<"loading" | "confirm" | "success" | "error">("loading");
  const [message, setMessage] = useState<string>("");
  const [absenceInfo, setAbsenceInfo] = useState<any>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("無効なリンクです。");
      return;
    }

    const fetchAbsenceInfo = async () => {
      try {
        const response = await fetch(`/api/cancel-absence/${token}/info`);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "情報の取得に失敗しました。");
        }

        const data = await response.json();
        setAbsenceInfo(data);
        setStatus("confirm");
      } catch (error: any) {
        setStatus("error");
        setMessage(error.message || "エラーが発生しました。");
      }
    };

    fetchAbsenceInfo();
  }, [token]);

  const handleCancel = async () => {
    if (!token) return;

    setStatus("loading");
    try {
      const response = await fetch(`/api/cancel-absence/${token}`, {
        method: "POST",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "キャンセルに失敗しました。");
      }

      const data = await response.json();
      setStatus("success");
      setMessage(data.message || "欠席連絡をキャンセルしました。");
    } catch (error: any) {
      setStatus("error");
      setMessage(error.message || "エラーが発生しました。");
    }
  };

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
          {status === "confirm" && (
            <>
              <AlertCircle className="w-16 h-16 mx-auto mb-4 text-amber-600" />
              <h1 className="text-2xl font-bold">欠席連絡のキャンセル</h1>
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
        <CardContent className="space-y-4">
          {status === "confirm" && absenceInfo && (
            <>
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p className="text-sm text-muted-foreground">お子様名</p>
                <p className="font-semibold text-lg">{absenceInfo.childName}</p>

                <p className="text-sm text-muted-foreground mt-4">欠席日</p>
                <p className="font-semibold">{absenceInfo.absentDate}</p>
                <p className="text-sm">{absenceInfo.courseLabel} - {absenceInfo.classBand}</p>
                {absenceInfo.startTime && (
                  <p className="text-sm text-muted-foreground">{absenceInfo.startTime}</p>
                )}
              </div>

              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <p className="text-sm text-amber-900 dark:text-amber-200">
                  <strong>確認</strong>
                </p>
                <p className="text-sm text-amber-800 dark:text-amber-300 mt-2">
                  この欠席連絡をキャンセルしてもよろしいですか？
                  関連する振替予約も取り消されます。
                </p>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <Button
                  onClick={handleCancel}
                  variant="destructive"
                  size="lg"
                  className="w-full"
                  data-testid="button-confirm-cancel"
                >
                  キャンセルする
                </Button>
                <Button
                  onClick={() => setLocation("/")}
                  variant="outline"
                  size="lg"
                  className="w-full"
                  data-testid="button-back"
                >
                  戻る
                </Button>
              </div>
            </>
          )}

          {status === "success" && absenceInfo && (
            <>
              <p className="text-center text-lg">
                <strong>{absenceInfo.childName}</strong> さんの欠席連絡をキャンセルしました。
              </p>
              <p className="text-center text-muted-foreground">
                関連する振替予約も取り消されました。
              </p>
              <Button
                onClick={() => setLocation("/")}
                className="w-full mt-4"
                data-testid="button-home"
              >
                トップページへ戻る
              </Button>
            </>
          )}

          {status === "error" && (
            <>
              <p className="text-center text-muted-foreground">{message}</p>
              <Button
                onClick={() => setLocation("/")}
                className="w-full mt-4"
                data-testid="button-home"
              >
                トップページへ戻る
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

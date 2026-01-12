import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { 
  SearchIcon, 
  CalendarIcon, 
  ClockIcon, 
  CheckCircleIcon, 
  XCircleIcon, 
  AlertTriangleIcon,
  Loader2,
  HistoryIcon
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";

function parseSlotId(slotId: string): { date: string; startTime: string } | null {
  const parts = slotId.split('_');
  if (parts.length >= 2) {
    return { date: parts[0], startTime: parts[1] };
  }
  return null;
}

function formatSlotDateTime(slotId: string): string {
  const parsed = parseSlotId(slotId);
  if (!parsed) return slotId;
  const date = parseISO(parsed.date);
  return `${format(date, "yyyy年M月d日(E)", { locale: ja })} ${parsed.startTime}`;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", label: string }> = {
    "PENDING": { variant: "secondary", label: "振替待ち" },
    "MAKEUP_CONFIRMED": { variant: "default", label: "振替確定" },
    "EXPIRED": { variant: "destructive", label: "期限切れ" },
    "確定": { variant: "default", label: "確定" },
    "待ち": { variant: "secondary", label: "順番待ち" },
    "却下": { variant: "destructive", label: "キャンセル済" },
    "期限切れ": { variant: "destructive", label: "期限切れ" },
  };

  const config = variants[status] || { variant: "outline" as const, label: status };

  return (
    <Badge variant={config.variant} data-testid={`badge-status-${status}`}>
      {config.label}
    </Badge>
  );
}

export default function StatusPage() {
  const [confirmCode, setConfirmCode] = useState("");
  const [searchedCode, setSearchedCode] = useState<string | null>(null);
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/lookup", searchedCode],
    enabled: !!searchedCode,
    queryFn: async () => {
      const response = await fetch(`/api/lookup/${searchedCode}`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "検索に失敗しました");
      }
      return response.json() as Promise<{
        absences: any[];
        requests: any[];
      }>;
    }
  });

  const cancelAbsenceMutation = useMutation({
    mutationFn: async ({ absenceId, code }: { absenceId: string; code: string }) => {
      return apiRequest("POST", `/api/cancel-absence/${absenceId}`, { confirmCode: code });
    },
    onSuccess: () => {
      toast({
        title: "キャンセル完了",
        description: "欠席連絡をキャンセルしました。",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/lookup", searchedCode] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "エラー",
        description: error.message || "キャンセルに失敗しました。",
      });
    },
  });

  const cancelRequestMutation = useMutation({
    mutationFn: async ({ requestId, code }: { requestId: string; code: string }) => {
      return apiRequest("POST", `/api/cancel-request/${requestId}`, { confirmCode: code });
    },
    onSuccess: () => {
      toast({
        title: "キャンセル完了",
        description: "予約をキャンセルしました。",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/lookup", searchedCode] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "エラー",
        description: error.message || "キャンセルに失敗しました。",
      });
    },
  });

  const handleSearch = () => {
    if (confirmCode.length !== 6) {
      toast({
        variant: "destructive",
        title: "入力エラー",
        description: "6桁の確認コードを入力してください。",
      });
      return;
    }
    setSearchedCode(confirmCode);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">
            予約状況確認
          </h1>
          <p className="text-muted-foreground">
            欠席登録時に表示された6桁の確認コードを入力してください
          </p>
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SearchIcon className="w-5 h-5" />
              確認コードで検索
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <div className="flex-1">
                <Label htmlFor="confirmCode" className="sr-only">確認コード</Label>
                <Input
                  id="confirmCode"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="6桁の確認コード"
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="text-center text-2xl tracking-widest font-mono"
                  data-testid="input-confirm-code"
                />
              </div>
              <Button 
                onClick={handleSearch}
                disabled={confirmCode.length !== 6 || isLoading}
                data-testid="button-search"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchIcon className="w-4 h-4 mr-2" />}
                検索
              </Button>
            </div>
          </CardContent>
        </Card>

        {error && (
          <Card className="mb-6 border-destructive">
            <CardContent className="p-6 text-center">
              <XCircleIcon className="w-12 h-12 text-destructive mx-auto mb-4" />
              <p className="text-lg font-medium text-destructive">
                {(error as Error).message}
              </p>
            </CardContent>
          </Card>
        )}

        {searchedCode && data && (
          <div className="space-y-6">
            {data.absences.length === 0 && data.requests.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <AlertTriangleIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-lg text-muted-foreground">
                    この確認コードに該当するデータが見つかりませんでした。
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {data.absences.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <CalendarIcon className="w-5 h-5" />
                        欠席連絡 ({data.absences.length}件)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {data.absences.map((absence: any) => (
                        <div key={absence.id} className="border rounded-lg p-4" data-testid={`card-absence-${absence.id}`}>
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <h3 className="font-semibold text-lg">{absence.childName}</h3>
                              <p className="text-sm text-muted-foreground">
                                {absence.declaredClassBand}
                              </p>
                            </div>
                            <StatusBadge status={absence.makeupStatus} />
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-muted-foreground">欠席日:</span>{" "}
                              {format(new Date(absence.absentDate), "yyyy年M月d日(E)", { locale: ja })}
                            </div>
                            <div>
                              <span className="text-muted-foreground">振替期限:</span>{" "}
                              {format(new Date(absence.makeupDeadline), "yyyy年M月d日", { locale: ja })}
                            </div>
                          </div>
                          {absence.makeupStatus !== "EXPIRED" && absence.makeupStatus !== "MAKEUP_CONFIRMED" && (
                            <div className="mt-4 flex gap-2">
                              <Link href={`/absence?token=${absence.resumeToken}`}>
                                <Button size="sm" data-testid={`button-book-${absence.id}`}>
                                  振替予約へ進む
                                </Button>
                              </Link>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button 
                                    variant="destructive" 
                                    size="sm"
                                    data-testid={`button-cancel-absence-${absence.id}`}
                                  >
                                    欠席をキャンセル
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>欠席をキャンセルしますか？</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      {absence.childName}さんの欠席連絡をキャンセルします。
                                      この操作は取り消せません。
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>戻る</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => cancelAbsenceMutation.mutate({ 
                                        absenceId: absence.id, 
                                        code: searchedCode! 
                                      })}
                                    >
                                      キャンセルする
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {data.requests.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <HistoryIcon className="w-5 h-5" />
                        振替予約 ({data.requests.length}件)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {data.requests.map((request: any) => (
                        <div key={request.id} className="border rounded-lg p-4" data-testid={`card-request-${request.id}`}>
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <h3 className="font-semibold text-lg">{request.childName}</h3>
                              <p className="text-sm text-muted-foreground">
                                {request.declaredClassBand}
                              </p>
                            </div>
                            <StatusBadge status={request.status} />
                          </div>
                          <div className="text-sm mb-2">
                            <span className="text-muted-foreground">振替先:</span>{" "}
                            {formatSlotDateTime(request.toSlotId)}
                          </div>
                          {(request.status === "確定" || request.status === "待ち") && (
                            <div className="mt-4">
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button 
                                    variant="destructive" 
                                    size="sm"
                                    data-testid={`button-cancel-request-${request.id}`}
                                  >
                                    予約をキャンセル
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>予約をキャンセルしますか？</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      {request.childName}さんの振替予約をキャンセルします。
                                      この操作は取り消せません。
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>戻る</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => cancelRequestMutation.mutate({ 
                                        requestId: request.id, 
                                        code: searchedCode! 
                                      })}
                                    >
                                      キャンセルする
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        )}

        <div className="mt-8 text-center">
          <Link href="/">
            <Button variant="outline" data-testid="link-new-absence">
              新規欠席連絡へ
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

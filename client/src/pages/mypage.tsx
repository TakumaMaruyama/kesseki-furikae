import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

// データベースの日時文字列をタイムゾーン変換なしでパースする
// "2025-12-22 18:00:00" → そのまま日本時間として解釈
function parseDbDateTime(dateTimeStr: string): Date {
  // スペース区切りをTに置換してISO形式に近づける
  const isoLike = dateTimeStr.replace(' ', 'T');
  // parseISOはタイムゾーン情報がない場合、ローカル時間として解釈する
  return parseISO(isoLike);
}

// スロットIDから日付と時刻を抽出する
// "2025-12-14_10:30_shokyu" → { date: "2025-12-14", startTime: "10:30" }
function parseSlotId(slotId: string): { date: string; startTime: string } | null {
  const parts = slotId.split('_');
  if (parts.length >= 2) {
    return { date: parts[0], startTime: parts[1] };
  }
  return null;
}

// スロットIDから表示用の日時文字列を生成
function formatSlotDateTime(slotId: string): string {
  const parsed = parseSlotId(slotId);
  if (!parsed) return slotId;
  const date = parseISO(parsed.date);
  return `${format(date, "yyyy年M月d日(E)", { locale: ja })} ${parsed.startTime}`;
}
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
  UserIcon,
  UsersIcon,
  CalendarIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  AlertTriangleIcon,
  PlusIcon,
  Loader2,
  HistoryIcon
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import type { Child, Absence, Request as MakeupRequest, Course } from "@shared/schema";

type AbsenceWithSlot = Absence & {
  slotInfo?: {
    courseLabel: string;
    startTime: string;
  };
};

type RequestWithSlot = MakeupRequest & {
  slotInfo?: {
    courseLabel: string;
    startTime: string;
    date: string;
  };
};

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", label: string }> = {
    "PENDING": { variant: "secondary", label: "振替待ち" },
    "MAKEUP_CONFIRMED": { variant: "default", label: "振替確定" },
    "EXPIRED": { variant: "destructive", label: "期限切れ" },
    "確定": { variant: "default", label: "確定" },
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

function DashboardSummary({
  children,
  absences,
  requests
}: {
  children: Child[];
  absences: Absence[];
  requests: MakeupRequest[];
}) {
  const pendingAbsences = absences.filter(a => a.makeupStatus === "PENDING").length;
  const confirmedMakeups = requests.filter(r => r.status === "確定").length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <UsersIcon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="text-children-count">{children.length}</p>
              <p className="text-xs text-muted-foreground">登録済み</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/20 flex items-center justify-center">
              <AlertTriangleIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-500" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="text-pending-absences">{pendingAbsences}</p>
              <p className="text-xs text-muted-foreground">振替待ち</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
              <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="text-confirmed-makeups">{confirmedMakeups}</p>
              <p className="text-xs text-muted-foreground">振替確定</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
              <ClockIcon className="w-5 h-5 text-blue-600 dark:text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="text-waiting-count">{requests.length}</p>
              <p className="text-xs text-muted-foreground">全予約数</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ChildrenSection({ children, courses }: { children: Child[]; courses: Course[] }) {
  const getCourse = (courseId: string | null) => courses.find(c => c.id === courseId);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <UsersIcon className="w-5 h-5" />
            お子様一覧
          </CardTitle>
          <CardDescription>
            {children.length}/5人登録済み
          </CardDescription>
        </div>
        <Link href="/children">
          <Button variant="outline" size="sm" data-testid="link-manage-children">
            管理
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {children.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <UserIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>お子様が登録されていません</p>
            <Link href="/children">
              <Button variant="ghost" className="mt-2" data-testid="link-add-first-child">
                <PlusIcon className="w-4 h-4 mr-1" />
                お子様を登録する
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {children.map((child) => {
              const course = getCourse(child.courseId);
              return (
                <div
                  key={child.id}
                  className="flex items-center justify-between p-3 rounded-lg border"
                  data-testid={`card-child-summary-${child.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <UserIcon className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{child.name}</p>
                      <div className="flex gap-1 mt-0.5">
                        {course && (
                          <Badge variant="secondary" className="text-xs">
                            {course.name}
                          </Badge>
                        )}
                        {child.classBand && (
                          <Badge variant="outline" className="text-xs">
                            {child.classBand}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AbsenceHistorySection({
  absences,
  requests,
  onCancelAbsence,
  onCancelRequest,
  isCancellingAbsence,
  isCancellingRequest
}: {
  absences: Absence[];
  requests: MakeupRequest[];
  onCancelAbsence: (absenceId: string) => void;
  onCancelRequest: (requestId: string) => void;
  isCancellingAbsence: boolean;
  isCancellingRequest: boolean;
}) {
  const sortedAbsences = [...absences].sort((a, b) =>
    new Date(b.absentDate).getTime() - new Date(a.absentDate).getTime()
  );

  // 欠席に対する振替リクエストを取得
  const getRelatedRequests = (absenceId: string) => {
    return requests.filter(r => r.absenceId === absenceId);
  };

  // 欠席がキャンセル可能かどうか
  const canCancelAbsence = (absence: Absence) => {
    if (absence.makeupStatus === "EXPIRED") return false;
    const now = new Date();
    const absentDate = new Date(absence.absentDate);
    return absentDate >= now;
  };

  // 振替予約がキャンセル可能かどうか
  const canCancelRequest = (request: MakeupRequest) => {
    if (request.status !== "確定") return false;
    const slotTime = new Date(request.toSlotStartDateTime);
    const now = new Date();
    return slotTime > now;
  };

  // 振替予約が可能かどうか（振替待ち状態のみ）
  const canSearchMakeup = (absence: Absence) => {
    return absence.makeupStatus === "PENDING";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarIcon className="w-5 h-5" />
          欠席履歴
        </CardTitle>
        <CardDescription>
          登録済みの欠席連絡一覧
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sortedAbsences.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <CalendarIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>欠席履歴がありません</p>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedAbsences.map((absence) => {
              const relatedRequests = getRelatedRequests(absence.id);
              const activeRequest = relatedRequests.find(r => r.status === "確定");

              return (
                <div
                  key={absence.id}
                  className="p-4 rounded-lg border"
                  data-testid={`card-absence-${absence.id}`}
                >
                  {/* 欠席情報ヘッダー */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="font-medium">{absence.childName}</p>
                        <Badge variant="outline" className="text-xs">
                          {absence.declaredClassBand}
                        </Badge>
                        <StatusBadge status={absence.makeupStatus} />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        欠席日: {format(new Date(absence.absentDate), "yyyy年M月d日(E)", { locale: ja })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        振替期限: {format(new Date(absence.makeupDeadline), "yyyy年M月d日", { locale: ja })}
                      </p>
                    </div>
                  </div>

                  {/* 振替予約情報（確定がある場合） */}
                  {activeRequest && (
                    <div className="mt-3 p-3 rounded-md bg-muted/50 border border-muted">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-sm font-medium">振替先:</span>
                            <StatusBadge status={activeRequest.status} />
                          </div>
                          <p className="text-sm">
                            {format(new Date(activeRequest.toSlotStartDateTime), "yyyy年M月d日(E) HH:mm", { locale: ja })}
                          </p>
                        </div>
                        {canCancelRequest(activeRequest) && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive shrink-0"
                                disabled={isCancellingRequest}
                                data-testid={`button-cancel-request-${activeRequest.id}`}
                              >
                                <XCircleIcon className="w-4 h-4 mr-1" />
                                予約キャンセル
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>振替予約をキャンセル</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {activeRequest.childName}さんの{format(new Date(activeRequest.toSlotStartDateTime), "M月d日(E) HH:mm", { locale: ja })}の振替予約をキャンセルしますか？
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>戻る</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => onCancelRequest(activeRequest.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  data-testid={`button-confirm-cancel-request-${activeRequest.id}`}
                                >
                                  キャンセルする
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </div>
                  )}

                  {/* アクションボタン */}
                  <div className="mt-3 flex gap-2 flex-wrap">
                    {canSearchMakeup(absence) && (
                      <Link href={`/absence?token=${absence.resumeToken}`}>
                        <Button variant="outline" size="sm" data-testid={`button-search-makeup-${absence.id}`}>
                          <CalendarIcon className="w-4 h-4 mr-1" />
                          振替予約を検索
                        </Button>
                      </Link>
                    )}

                    {canCancelAbsence(absence) && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={isCancellingAbsence}
                            data-testid={`button-cancel-absence-${absence.id}`}
                          >
                            <XCircleIcon className="w-4 h-4 mr-1" />
                            欠席取消
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>欠席連絡を取り消し</AlertDialogTitle>
                            <AlertDialogDescription>
                              {absence.childName}さんの{format(new Date(absence.absentDate), "M月d日(E)", { locale: ja })}の欠席連絡を取り消しますか？
                              {activeRequest && (
                                <span className="block mt-2 text-yellow-600 dark:text-yellow-500">
                                  関連する振替予約も同時にキャンセルされます。
                                </span>
                              )}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>戻る</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => onCancelAbsence(absence.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              data-testid={`button-confirm-cancel-absence-${absence.id}`}
                            >
                              取り消す
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RequestHistorySection({ requests, onCancel, isCancelling }: {
  requests: MakeupRequest[];
  onCancel: (requestId: string) => void;
  isCancelling: boolean;
}) {
  const sortedRequests = [...requests].sort((a, b) => {
    const parsedA = parseSlotId(a.toSlotId);
    const parsedB = parseSlotId(b.toSlotId);
    if (!parsedA || !parsedB) return 0;
    const timeA = new Date(`${parsedA.date}T${parsedA.startTime}:00`).getTime();
    const timeB = new Date(`${parsedB.date}T${parsedB.startTime}:00`).getTime();
    return timeB - timeA;
  });

  const activeRequests = sortedRequests.filter(r => r.status === "確定");
  const pastRequests = sortedRequests.filter(r => r.status !== "確定");

  const canCancel = (request: MakeupRequest) => {
    if (request.status !== "確定") return false;
    const parsed = parseSlotId(request.toSlotId);
    if (!parsed) return false;
    const slotTime = new Date(`${parsed.date}T${parsed.startTime}:00`);
    const now = new Date();
    return slotTime > now;
  };

  const renderRequest = (request: MakeupRequest) => (
    <div
      key={request.id}
      className="flex items-start justify-between p-3 rounded-lg border gap-3"
      data-testid={`card-request-${request.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <p className="font-medium">{request.childName}</p>
          <Badge variant="outline" className="text-xs">
            {request.declaredClassBand}
          </Badge>
          <StatusBadge status={request.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          振替先: {formatSlotDateTime(request.toSlotId)}
        </p>
        <p className="text-xs text-muted-foreground">
          欠席日: {format(new Date(request.absentDate), "yyyy年M月d日", { locale: ja })}
        </p>
      </div>
      {canCancel(request) && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive shrink-0"
              disabled={isCancelling}
              data-testid={`button-cancel-request-${request.id}`}
            >
              <XCircleIcon className="w-4 h-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>予約をキャンセル</AlertDialogTitle>
              <AlertDialogDescription>
                {request.childName}さんの{formatSlotDateTime(request.toSlotId)}の振替予約をキャンセルしますか？
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>戻る</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onCancel(request.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid={`button-confirm-cancel-${request.id}`}
              >
                キャンセルする
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <HistoryIcon className="w-5 h-5" />
            振替予約履歴
          </CardTitle>
          <CardDescription>
            振替予約の状況
          </CardDescription>
        </div>
        <Link href="/absence">
          <Button variant="outline" size="sm" data-testid="button-new-absence-in-requests">
            <PlusIcon className="w-4 h-4 mr-1" />
            欠席連絡
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="space-y-6">
        {requests.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <HistoryIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>振替予約履歴がありません</p>
          </div>
        ) : (
          <>
            {activeRequests.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <CheckCircleIcon className="w-4 h-4 text-green-600" />
                  有効な予約
                </h4>
                <div className="space-y-3">
                  {activeRequests.map(renderRequest)}
                </div>
              </div>
            )}

            {pastRequests.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-3 text-muted-foreground">
                  過去の履歴
                </h4>
                <div className="space-y-3">
                  {pastRequests.map(renderRequest)}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function MyPage() {
  const { toast } = useToast();
  const { user, isLoading: isAuthLoading } = useAuth();

  const { data: children = [], isLoading: isLoadingChildren } = useQuery<Child[]>({
    queryKey: ["/api/children"],
    enabled: !!user,
  });

  const { data: courses = [] } = useQuery<Course[]>({
    queryKey: ["/api/courses"],
    enabled: !!user,
  });

  const { data: absences = [], isLoading: isLoadingAbsences } = useQuery<Absence[]>({
    queryKey: ["/api/my/absences"],
    enabled: !!user,
  });

  const { data: requests = [], isLoading: isLoadingRequests } = useQuery<MakeupRequest[]>({
    queryKey: ["/api/my/requests"],
    enabled: !!user,
  });

  const cancelRequestMutation = useMutation({
    mutationFn: (requestId: string) =>
      apiRequest("POST", `/api/my/cancel-request/${requestId}`),
    onSuccess: () => {
      toast({ title: "キャンセル完了", description: "振替予約をキャンセルしました" });
      queryClient.invalidateQueries({ queryKey: ["/api/my/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my/absences"] });
    },
    onError: (error: any) => {
      toast({
        title: "エラー",
        description: error.message || "キャンセルに失敗しました",
        variant: "destructive"
      });
    },
  });

  const cancelAbsenceMutation = useMutation({
    mutationFn: (absenceId: string) =>
      apiRequest("POST", `/api/my/cancel-absence/${absenceId}`),
    onSuccess: () => {
      toast({ title: "取消完了", description: "欠席連絡を取り消しました" });
      queryClient.invalidateQueries({ queryKey: ["/api/my/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my/absences"] });
    },
    onError: (error: any) => {
      toast({
        title: "エラー",
        description: error.message || "取り消しに失敗しました",
        variant: "destructive"
      });
    },
  });

  const isLoading = isAuthLoading || isLoadingChildren || isLoadingAbsences || isLoadingRequests;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-filter supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center px-6">
            <h1 className="text-xl font-bold">マイページ</h1>
          </div>
        </header>
        <main className="container max-w-4xl px-4 py-8">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-filter supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center px-6">
          <h1 className="text-xl font-bold">マイページ</h1>
        </div>
      </header>

      <main className="container max-w-4xl px-4 py-8 space-y-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <p className="text-muted-foreground">
              ようこそ、{user?.displayName || user?.firstName || ""}さん
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/absence">
              <Button data-testid="button-new-absence">
                <PlusIcon className="w-4 h-4 mr-2" />
                欠席連絡
              </Button>
            </Link>
          </div>
        </div>

        <DashboardSummary
          children={children}
          absences={absences}
          requests={requests}
        />

        <Tabs defaultValue="children" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="children" data-testid="tab-children">
              お子様
            </TabsTrigger>
            <TabsTrigger value="absences" data-testid="tab-absences">
              欠席履歴
            </TabsTrigger>
            <TabsTrigger value="requests" data-testid="tab-requests">
              振替予約
            </TabsTrigger>
          </TabsList>

          <TabsContent value="children" className="mt-4">
            <ChildrenSection children={children} courses={courses} />
          </TabsContent>

          <TabsContent value="absences" className="mt-4">
            <AbsenceHistorySection
              absences={absences}
              requests={requests}
              onCancelAbsence={(id) => cancelAbsenceMutation.mutate(id)}
              onCancelRequest={(id) => cancelRequestMutation.mutate(id)}
              isCancellingAbsence={cancelAbsenceMutation.isPending}
              isCancellingRequest={cancelRequestMutation.isPending}
            />
          </TabsContent>

          <TabsContent value="requests" className="mt-4">
            <RequestHistorySection
              requests={requests}
              onCancel={(id) => cancelRequestMutation.mutate(id)}
              isCancelling={cancelRequestMutation.isPending}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

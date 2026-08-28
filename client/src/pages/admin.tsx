import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import type { ClassSlotWithTrialParticipantCount } from "@shared/schema";
import { formatJstDate, parseJstDate } from "@shared/jst";
import { getMakeupCapacityLimit, getRemainingCapacity } from "@shared/capacity";
import { Calendar } from "@/components/ui/calendar";

// Import extracted admin components
import {
  AdminLoginForm,
  DashboardOverview,
  DailyStatusView,
  HistoryView,
  CoursesManagement,
  SlotDialog,
  CoachAccountSettings,
} from "@/components/admin";
import type { StaffRole } from "@/components/admin/types";
import { ListIcon, CalendarIcon, LogOutIcon, Loader2, ArchiveIcon, RefreshCw } from "lucide-react";

const CLASS_BAND_ORDER: Record<string, number> = {
  初級: 0,
  中級: 1,
  上級: 2,
};

function getClassBandOrder(classBand: string): number {
  return CLASS_BAND_ORDER[classBand] ?? Number.MAX_SAFE_INTEGER;
}

function sortByStartTimeThenClassBand(a: ClassSlotWithTrialParticipantCount, b: ClassSlotWithTrialParticipantCount): number {
  const timeCompare = a.startTime.localeCompare(b.startTime);
  if (timeCompare !== 0) return timeCompare;
  return getClassBandOrder(a.classBand) - getClassBandOrder(b.classBand);
}

function sortByClassBand(a: ClassSlotWithTrialParticipantCount, b: ClassSlotWithTrialParticipantCount): number {
  return getClassBandOrder(a.classBand) - getClassBandOrder(b.classBand);
}

function groupSlotsByStartTime(slots: ClassSlotWithTrialParticipantCount[]): Record<string, ClassSlotWithTrialParticipantCount[]> {
  const grouped: Record<string, ClassSlotWithTrialParticipantCount[]> = {};
  for (const slot of slots) {
    if (!grouped[slot.startTime]) {
      grouped[slot.startTime] = [];
    }
    grouped[slot.startTime].push(slot);
  }

  for (const startTime of Object.keys(grouped)) {
    grouped[startTime].sort(sortByClassBand);
  }

  return grouped;
}

type ClosureEventSlotSummary = {
  slotId: string;
  date: string;
  startTime: string;
  classBand: string;
  courseLabel: string;
  isClosed: boolean;
};

type ClosureEventSummary = {
  id: string;
  name: string;
  sharedCode: string;
  usageLimit: number;
  usageUsed: number;
  usageRemaining: number;
  expiresAt: string;
  isArchived: boolean;
  slots: ClosureEventSlotSummary[];
};

export default function AdminPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [editingSlots, setEditingSlots] = useState<Set<string>>(new Set());
  const [capacityValues, setCapacityValues] = useState<Record<string, any>>({});
  const [showSlotDialog, setShowSlotDialog] = useState(false);
  const [editingSlotData, setEditingSlotData] = useState<ClassSlotWithTrialParticipantCount | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("calendar");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [closureEventName, setClosureEventName] = useState("");
  const [closureSharedCode, setClosureSharedCode] = useState("");
  const [closureUsageLimit, setClosureUsageLimit] = useState<number>(30);
  const [closureExpiresAtISO, setClosureExpiresAtISO] = useState<string>(() => {
    const base = new Date();
    base.setDate(base.getDate() + 30);
    return formatJstDate(base);
  });
  const [selectedClosureSlotIds, setSelectedClosureSlotIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function checkAuth() {
      try {
        const response = await fetch("/api/staff/check", { credentials: "include" });
        const data = await response.json();
        if (data.authenticated && data.role === "coach") {
          setLocation("/coach");
          return;
        }
        setIsAuthenticated(data.authenticated && data.role === "admin");
      } catch (error) {
        setIsAuthenticated(false);
      }
    }
    checkAuth();
  }, [setLocation]);

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/staff/logout", {});
      setIsAuthenticated(false);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const { data: allSlots, isLoading: loadingSlots } = useQuery<ClassSlotWithTrialParticipantCount[]>({
    queryKey: ["/api/admin/slots"],
    enabled: isAuthenticated === true,
  });

  const { data: closureEvents, isLoading: loadingClosureEvents } = useQuery<ClosureEventSummary[]>({
    queryKey: ["/api/admin/closure-events"],
    enabled: isAuthenticated === true,
  });

  const updateCapacityMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/admin/update-slot-capacity", data),
    onSuccess: (_, variables: any) => {
      toast({
        title: "更新完了",
        description: "枠容量を更新しました。",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/waiting"] });
      const newEditingSlots = new Set(editingSlots);
      newEditingSlots.delete(variables.slotId);
      setEditingSlots(newEditingSlots);
      const newCapacityValues = { ...capacityValues };
      delete newCapacityValues[variables.slotId];
      setCapacityValues(newCapacityValues);
    },
    onError: (error: any) => {
      toast({
        title: "更新エラー",
        description: error.message || "更新に失敗しました。",
        variant: "destructive",
      });
    },
  });

  const createSlotMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/admin/create-slot", data),
    onSuccess: async (response: any) => {
      const createdCount = response?.count ?? 0;
      const skippedCount = response?.skippedCount ?? 0;
      const autoRepairedCount = response?.autoRepairedCount ?? 0;
      let description = createdCount > 0
        ? `${createdCount}個の枠を作成しました。`
        : "新しい枠を作成しました。";

      if (skippedCount > 0) {
        description += `（${skippedCount}件は既存枠と重複したためスキップしました）`;
      }
      if (autoRepairedCount > 0) {
        description += `（過去データの不整合を${autoRepairedCount}件自動補修しました）`;
      }

      toast({
        title: "作成完了",
        description,
      });

      const firstCreatedDate = response?.slots?.[0]?.date;
      if (firstCreatedDate) {
        setSelectedDate(parseJstDate(formatJstDate(firstCreatedDate)));
        setViewMode("calendar");
      }

      await queryClient.invalidateQueries({ queryKey: ["/api/admin/slots"] });
      setShowSlotDialog(false);
      setEditingSlotData(null);
    },
    onError: (error: any) => {
      toast({
        title: "作成エラー",
        description: error.message || "作成に失敗しました。",
        variant: "destructive",
      });
    },
  });

  const updateSlotMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", "/api/admin/update-slot", data),
    onSuccess: () => {
      toast({
        title: "更新完了",
        description: "枠を更新しました。",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/slots"] });
      setShowSlotDialog(false);
      setEditingSlotData(null);
    },
    onError: (error: any) => {
      toast({
        title: "更新エラー",
        description: error.message || "更新に失敗しました。",
        variant: "destructive",
      });
    },
  });

  const deleteSlotMutation = useMutation({
    mutationFn: (payload: { id: string; applyToFuture?: boolean }) =>
      apiRequest("POST", "/api/admin/delete-slot", payload),
    onSuccess: (response: any, variables) => {
      const skipped = response?.skipped ?? 0;
      const count = response?.count ?? (variables.applyToFuture ? 0 : 1);
      let description = variables.applyToFuture
        ? `${count}件の枠を削除しました。`
        : "枠を削除しました。";

      if (variables.applyToFuture && skipped > 0) {
        description += `（${skipped}件は欠席登録があるためスキップされました）`;
      }

      toast({
        title: "削除完了",
        description,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/slots"] });
    },
    onError: (error: any) => {
      toast({
        title: "削除エラー",
        description: error.message || "削除に失敗しました。",
        variant: "destructive",
      });
    },
  });

  const bulkDeleteSlotsMutation = useMutation({
    mutationFn: (slotIds: string[]) => apiRequest("POST", "/api/admin/delete-slots-bulk", { slotIds }),
    onSuccess: (response: any) => {
      let description = `${response.count}件の枠を削除しました。`;
      if (response.skipped > 0) {
        description += `（${response.skipped}件は欠席登録があるためスキップされました）`;
      }
      toast({
        title: "削除完了",
        description,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/slots"] });
      setSelectedSlots(new Set());
    },
    onError: (error: any) => {
      toast({
        title: "削除エラー",
        description: error.message || "削除に失敗しました。",
        variant: "destructive",
      });
    },
  });

  const deleteDaySlotsMutation = useMutation({
    mutationFn: (date: string) => apiRequest("POST", "/api/admin/delete-slots-by-date", { date }),
    onSuccess: (response: any) => {
      let description = `${response.count}件の枠を削除しました。`;
      if (response.skipped > 0) {
        description += `（${response.skipped}件は欠席登録があるためスキップされました）`;
      }
      toast({
        title: "削除完了",
        description,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/slots"] });
    },
    onError: (error: any) => {
      toast({
        title: "削除エラー",
        description: error.message || "削除に失敗しました。",
        variant: "destructive",
      });
    },
  });

  const createClosureEventMutation = useMutation({
    mutationFn: (data: {
      name: string;
      sharedCode: string;
      usageLimit: number;
      expiresAtISO: string;
      slotIds: string[];
    }) => apiRequest("POST", "/api/admin/closure-events", data),
    onSuccess: () => {
      toast({
        title: "休講イベントを作成しました",
        description: "共通コードの発行と対象枠の休講設定が完了しました。",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/closure-events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/slots"] });
      setClosureEventName("");
      setClosureSharedCode("");
      setClosureUsageLimit(30);
      const base = new Date();
      base.setDate(base.getDate() + 30);
      setClosureExpiresAtISO(formatJstDate(base));
      setSelectedClosureSlotIds(new Set());
    },
    onError: (error: any) => {
      toast({
        title: "休講イベント作成エラー",
        description: error.message || "作成に失敗しました。",
        variant: "destructive",
      });
    },
  });

  const archiveClosureEventMutation = useMutation({
    mutationFn: (eventId: string) => apiRequest("POST", `/api/admin/closure-events/${eventId}/archive`, {}),
    onSuccess: () => {
      toast({
        title: "休講イベントを停止しました",
        description: "イベントをアーカイブし、対象枠の休講設定を再計算しました。",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/closure-events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/slots"] });
    },
    onError: (error: any) => {
      toast({
        title: "停止エラー",
        description: error.message || "停止に失敗しました。",
        variant: "destructive",
      });
    },
  });

  const cancelRequestMutation = useMutation({
    mutationFn: (requestId: string) => apiRequest("POST", "/api/cancel-request", { requestId }),
    onSuccess: () => {
      toast({
        title: "キャンセル完了",
        description: "リクエストをキャンセルしました。",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/waiting"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/confirmed"] });
    },
    onError: (error: any) => {
      toast({
        title: "キャンセルエラー",
        description: error.message || "キャンセルに失敗しました。",
        variant: "destructive",
      });
    },
  });

  const handleToggleSlotSelection = (slotId: string) => {
    const newSelection = new Set(selectedSlots);
    if (newSelection.has(slotId)) {
      newSelection.delete(slotId);
    } else {
      newSelection.add(slotId);
    }
    setSelectedSlots(newSelection);
  };

  const handleToggleClosureSlotSelection = (slotId: string) => {
    const newSelection = new Set(selectedClosureSlotIds);
    if (newSelection.has(slotId)) {
      newSelection.delete(slotId);
    } else {
      newSelection.add(slotId);
    }
    setSelectedClosureSlotIds(newSelection);
  };

  const generateSharedCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    const array = new Uint8Array(10);
    crypto.getRandomValues(array);
    for (let index = 0; index < array.length; index += 1) {
      code += chars[array[index] % chars.length];
    }
    setClosureSharedCode(code);
  };

  const handleCreateClosureEvent = () => {
    if (!closureEventName.trim()) {
      toast({
        title: "入力エラー",
        description: "イベント名を入力してください。",
        variant: "destructive",
      });
      return;
    }
    if (!closureSharedCode.trim()) {
      toast({
        title: "入力エラー",
        description: "共通コードを入力してください。",
        variant: "destructive",
      });
      return;
    }
    if (!closureExpiresAtISO) {
      toast({
        title: "入力エラー",
        description: "有効期限を入力してください。",
        variant: "destructive",
      });
      return;
    }
    if (selectedClosureSlotIds.size === 0) {
      toast({
        title: "入力エラー",
        description: "休講対象の枠を1件以上選択してください。",
        variant: "destructive",
      });
      return;
    }

    createClosureEventMutation.mutate({
      name: closureEventName.trim(),
      sharedCode: closureSharedCode.trim().toUpperCase(),
      usageLimit: closureUsageLimit,
      expiresAtISO: closureExpiresAtISO,
      slotIds: Array.from(selectedClosureSlotIds),
    });
  };

  const handleBulkDelete = async () => {
    if (selectedSlots.size === 0) {
      toast({
        title: "選択エラー",
        description: "削除する枠を選択してください。",
        variant: "destructive",
      });
      return;
    }

    if (confirm(`選択した${selectedSlots.size}件の枠を削除しますか？関連する申し込みも全て削除されます。`)) {
      bulkDeleteSlotsMutation.mutate(Array.from(selectedSlots));
    }
  };

  const handleDeleteDay = (date: Date) => {
    const dateStr = formatJstDate(date);
    const daySlots = allSlots?.filter(slot => {
      return formatJstDate(slot.date as Date | string) === dateStr;
    }) || [];

    if (daySlots.length === 0) {
      toast({
        title: "削除エラー",
        description: "この日の枠がありません。",
        variant: "destructive",
      });
      return;
    }

    if (confirm(`${format(date, "yyyy年M月d日", { locale: ja })}の${daySlots.length}件の枠を削除しますか？関連する申し込みも全て削除されます。`)) {
      deleteDaySlotsMutation.mutate(dateStr);
    }
  };

  const fetchSlotRequestsCount = async (slotId: string): Promise<{ count: number; confirmedCount: number }> => {
    const response = await fetch(`/api/admin/slot-requests-count?slotId=${encodeURIComponent(slotId)}`, {
      credentials: "include",
    });

    if (!response.ok) {
      let errorMessage = "申し込み件数の取得に失敗しました。";
      try {
        const errorBody = await response.json();
        if (errorBody?.error) {
          errorMessage = errorBody.error;
        }
      } catch {
        // Ignore parse errors and use fallback message.
      }
      throw new Error(errorMessage);
    }

    const data = await response.json() as { count?: number; confirmedCount?: number };
    return {
      count: data.count ?? 0,
      confirmedCount: data.confirmedCount ?? 0,
    };
  };

  const confirmAndDeleteSlot = async (slot: ClassSlotWithTrialParticipantCount) => {
    try {
      const applyToFuture = confirm(
        "削除範囲を選択してください。\n\nOK: この日以降の同一枠（同曜日・同時刻・同クラス帯・同コース名）も削除\nキャンセル: この枠のみ削除"
      );

      let message = `${slot.courseLabel}の枠を削除しますか？`;
      if (applyToFuture) {
        message = `${slot.courseLabel}の枠と、この日以降の同一枠を削除しますか？\n\n※欠席登録がある枠はスキップされます。\n※対象枠にある申し込みはすべて削除されます。`;
      } else {
        const { count, confirmedCount } = await fetchSlotRequestsCount(slot.id);
        if (count > 0) {
          message = `${slot.courseLabel}の枠を削除しますか？\n\n※この枠には${count}件の申し込みがあります（確定${confirmedCount}件）。削除すると申し込みも全て削除されます。`;
        }
      }

      if (confirm(message)) {
        deleteSlotMutation.mutate({
          id: slot.id,
          applyToFuture,
        });
      }
    } catch (error: any) {
      toast({
        title: "取得エラー",
        description: error.message || "申し込み件数の取得に失敗しました。",
        variant: "destructive",
      });
    }
  };

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">認証状態を確認中...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <AdminLoginForm
        onSuccess={(role: StaffRole) => {
          if (role === "coach") {
            setLocation("/coach");
            return;
          }
          setIsAuthenticated(true);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between px-6">
          <h1 className="text-xl font-bold">はまスイ 管理画面</h1>
          <div className="flex items-center gap-2">
            <CoachAccountSettings />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              data-testid="button-admin-logout"
            >
              <LogOutIcon className="w-4 h-4 mr-2" />
              ログアウト
            </Button>
          </div>
        </div>
      </header>

      <main className="container px-4 py-8 md:py-12">
        {/* Dashboard Overview at top */}
        <div className="mb-8">
          <DashboardOverview />
        </div>

        <Tabs defaultValue="daily-status" className="w-full">
          <TabsList className="grid w-full max-w-5xl grid-cols-4 h-12">
            <TabsTrigger value="daily-status" data-testid="tab-daily-status" className="text-base">
              本日の状況
            </TabsTrigger>
            <TabsTrigger value="slots" data-testid="tab-slots" className="text-base">
              枠管理
            </TabsTrigger>
            <TabsTrigger value="courses" data-testid="tab-courses" className="text-base">
              コース管理
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history" className="text-base">
              履歴
            </TabsTrigger>
          </TabsList>

          <TabsContent value="daily-status" className="mt-6">
            <DailyStatusView />
          </TabsContent>

          <TabsContent value="history" className="mt-6">
            <HistoryView />
          </TabsContent>

          <TabsContent value="slots" className="mt-6">
            <Card className="border-2">
              <CardHeader className="p-6 flex-row items-center justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-xl">振替枠管理</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    コース設定と振替可能枠の管理
                  </p>
                </div>
                <div className="flex gap-2">
                  <div className="flex border-2 rounded-lg overflow-hidden">
                    <Button
                      variant={viewMode === "list" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setViewMode("list")}
                      className="rounded-none"
                    >
                      <ListIcon className="w-4 h-4 mr-2" />
                      リスト
                    </Button>
                    <Button
                      variant={viewMode === "calendar" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setViewMode("calendar")}
                      className="rounded-none"
                    >
                      <CalendarIcon className="w-4 h-4 mr-2" />
                      カレンダー
                    </Button>
                  </div>
                  {selectedSlots.size > 0 && (
                    <Button
                      onClick={handleBulkDelete}
                      variant="destructive"
                      size="default"
                      data-testid="button-bulk-delete"
                    >
                      選択した{selectedSlots.size}件を削除
                    </Button>
                  )}
                  {viewMode === "calendar" && selectedDate && (
                    <Button
                      onClick={() => handleDeleteDay(selectedDate)}
                      variant="outline"
                      size="default"
                      data-testid="button-delete-day"
                    >
                      この日の枠を削除
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      setEditingSlotData(null);
                      setShowSlotDialog(true);
                    }}
                    data-testid="button-create-slot"
                    size="default"
                    className="font-semibold"
                  >
                    新しい枠を作成
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-6 pt-0">
                {loadingSlots && (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                )}

                {!loadingSlots && allSlots && allSlots.length === 0 && (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground">まだ枠が作成されていません</p>
                  </div>
                )}

                {!loadingSlots && allSlots && allSlots.length > 0 && viewMode === "calendar" && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="flex justify-center">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={setSelectedDate}
                        className="rounded-md border"
                        locale={ja}
                        modifiers={{
                          hasSlots: allSlots.map(slot => parseJstDate(formatJstDate(slot.date as Date | string))),
                        }}
                        modifiersStyles={{
                          hasSlots: {
                            fontWeight: 'bold',
                            backgroundColor: 'hsl(var(--primary) / 0.1)',
                          },
                        }}
                      />
                    </div>
                    <div className="space-y-4">
                      {selectedDate && (() => {
                        const selectedDateKey = formatJstDate(selectedDate);

                        const daySlots = allSlots.filter(slot => {
                          return formatJstDate(slot.date as Date | string) === selectedDateKey;
                        });

                        if (daySlots.length === 0) {
                          return (
                            <div className="text-center py-12">
                              <p className="text-muted-foreground">
                                {format(selectedDate, "M月d日(E)", { locale: ja })}の枠はありません
                              </p>
                            </div>
                          );
                        }

                        return (
                          <>
                            <h3 className="text-lg font-bold">
                              {format(selectedDate, "yyyy年M月d日(E)", { locale: ja })}
                            </h3>
                            <div className="space-y-3">
                              {(() => {
                                const groupedByStartTime = groupSlotsByStartTime(daySlots);
                                const sortedStartTimes = Object.keys(groupedByStartTime).sort((a, b) => a.localeCompare(b));

                                return sortedStartTimes.map((startTime) => (
                                  <div key={startTime} className="border-2 rounded-lg p-3 space-y-3">
                                    <div className="border-b px-1 pb-2">
                                      <p className="text-sm font-semibold text-muted-foreground">{startTime} の枠</p>
                                    </div>
                                    <div className="space-y-3">
                                      {groupedByStartTime[startTime].map((slot) => (
                                        <div
                                          key={slot.id}
                                          className="border rounded-lg p-4 hover:bg-muted/30 transition-colors"
                                          data-testid={`row-slot-${slot.id}`}
                                        >
                                          <div className="flex items-start justify-between gap-4">
                                            <div className="flex items-start gap-3 flex-1">
                                              <input
                                                type="checkbox"
                                                checked={selectedSlots.has(slot.id)}
                                                onChange={() => handleToggleSlotSelection(slot.id)}
                                                className="mt-1 h-4 w-4 rounded border-gray-300"
                                                data-testid={`checkbox-slot-${slot.id}`}
                                              />
                                              <div className="flex-1 space-y-2">
                                                <div className="flex items-center gap-2">
                                                  <p className="font-semibold text-lg">{slot.startTime}</p>
                                                  <Badge variant="outline">{slot.classBand}</Badge>
                                                  {slot.isClosed && (
                                                    <Badge variant="destructive">休講</Badge>
                                                  )}
                                                </div>
                                                <p className="text-sm text-muted-foreground">{slot.courseLabel}</p>
                                                <div className="grid grid-cols-2 gap-2 text-sm">
                                                  <div>
                                                    <span className="text-muted-foreground">振替可能枠: </span>
                                                    <span className="font-semibold">{getMakeupCapacityLimit(slot)}</span>
                                                  </div>
                                                  <div>
                                                    <span className="text-muted-foreground">使用済み: </span>
                                                    <span className="font-semibold">{slot.capacityMakeupUsed}</span>
                                                  </div>
                                                </div>
                                                <div className="text-sm">
                                                  <span className="text-muted-foreground">残り枠数: </span>
                                                  <span className="text-lg font-bold text-primary">
                                                    {getRemainingCapacity(slot)}
                                                  </span>
                                                </div>
                                              </div>
                                            </div>
                                            <div className="flex flex-col gap-2">
                                              <Button
                                                onClick={() => {
                                                  setEditingSlotData(slot);
                                                  setShowSlotDialog(true);
                                                }}
                                                variant="outline"
                                                size="sm"
                                                data-testid={`button-edit-slot-${slot.id}`}
                                              >
                                                編集
                                              </Button>
                                              <Button
                                                onClick={() => {
                                                  confirmAndDeleteSlot(slot);
                                                }}
                                                variant="outline"
                                                size="sm"
                                                data-testid={`button-delete-slot-${slot.id}`}
                                              >
                                                削除
                                              </Button>
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ));
                              })()}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {!loadingSlots && allSlots && allSlots.length > 0 && viewMode === "list" && (
                  <div className="space-y-6">
                    {(() => {
                      // 日付でグループ化
                      const slotsByDate = allSlots.reduce((acc, slot) => {
                        const dateKey = formatJstDate(slot.date as Date | string);
                        if (!acc[dateKey]) {
                          acc[dateKey] = [];
                        }
                        acc[dateKey].push(slot);
                        return acc;
                      }, {} as Record<string, ClassSlotWithTrialParticipantCount[]>);

                      // 日付順にソート
                      const sortedDates = Object.keys(slotsByDate).sort();

                      return sortedDates.map((dateKey) => {
                        const slots = slotsByDate[dateKey];
                        const date = parseJstDate(dateKey);

                        return (
                          <div key={dateKey} className="border-2 rounded-lg overflow-hidden">
                            <div className="bg-muted/50 px-6 py-4 border-b">
                              <h3 className="text-lg font-bold">
                                {format(date, "yyyy年M月d日(E)", { locale: ja })}
                              </h3>
                              <p className="text-sm text-muted-foreground mt-1">
                                {slots.length}件の枠
                              </p>
                            </div>
                            <div className="space-y-4 p-4">
                              {(() => {
                                const sortedSlots = [...slots].sort(sortByStartTimeThenClassBand);
                                const groupedByStartTime = groupSlotsByStartTime(sortedSlots);
                                const sortedStartTimes = Object.keys(groupedByStartTime).sort((a, b) => a.localeCompare(b));

                                return sortedStartTimes.map((startTime) => (
                                  <div key={startTime} className="border-2 rounded-lg overflow-hidden">
                                    <div className="bg-muted/30 px-4 py-2 border-b">
                                      <p className="text-sm font-semibold">{startTime}</p>
                                    </div>
                                    <div className="divide-y">
                                      {groupedByStartTime[startTime].map((slot) => (
                                        <div
                                          key={slot.id}
                                          className="p-4 hover:bg-muted/30 transition-colors"
                                          data-testid={`row-slot-${slot.id}`}
                                        >
                                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                            <div className="flex items-start gap-3 flex-1">
                                              <input
                                                type="checkbox"
                                                checked={selectedSlots.has(slot.id)}
                                                onChange={() => handleToggleSlotSelection(slot.id)}
                                                className="mt-1 h-4 w-4 rounded border-gray-300"
                                                data-testid={`checkbox-slot-list-${slot.id}`}
                                              />
                                              <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-3">
                                                <div>
                                                  <p className="text-xs text-muted-foreground mb-1">時刻・コース</p>
                                                  <p className="font-semibold">{slot.startTime}</p>
                                                  <p className="text-sm text-muted-foreground">{slot.courseLabel}</p>
                                                </div>
                                                <div>
                                                  <p className="text-xs text-muted-foreground mb-1">クラス帯</p>
                                                  <div className="flex items-center gap-2">
                                                    <Badge variant="outline" className="text-sm">
                                                      {slot.classBand}
                                                    </Badge>
                                                    {slot.isClosed && (
                                                      <Badge variant="destructive" className="text-xs">
                                                        休講
                                                      </Badge>
                                                    )}
                                                  </div>
                                                </div>
                                                <div>
                                                  <p className="text-xs text-muted-foreground mb-1">振替可能枠（自動計算）</p>
                                                  <p className="font-semibold">
                                                    {getMakeupCapacityLimit(slot)} 枠
                                                  </p>
                                                  <p className="text-xs text-muted-foreground">
                                                    使用済み: {slot.capacityMakeupUsed}
                                                  </p>
                                                </div>
                                                <div>
                                                  <p className="text-xs text-muted-foreground mb-1">残り枠数</p>
                                                  <p className="text-lg font-bold text-primary">
                                                    {getRemainingCapacity(slot)}
                                                  </p>
                                                </div>
                                              </div>
                                            </div>
                                            <div className="flex gap-2">
                                              <Button
                                                onClick={() => {
                                                  setEditingSlotData(slot);
                                                  setShowSlotDialog(true);
                                                }}
                                                variant="outline"
                                                size="sm"
                                                data-testid={`button-edit-slot-${slot.id}`}
                                              >
                                                編集
                                              </Button>
                                              <Button
                                                onClick={() => {
                                                  confirmAndDeleteSlot(slot);
                                                }}
                                                variant="outline"
                                                size="sm"
                                                data-testid={`button-delete-slot-${slot.id}`}
                                              >
                                                削除
                                              </Button>
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ));
                              })()}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-2 mt-6">
              <CardHeader className="p-6">
                <CardTitle className="text-xl">休講イベント管理</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  共通コードを発行し、対象枠を休講扱いにして振替権を付与します
                </p>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">イベント名</p>
                    <Input
                      value={closureEventName}
                      onChange={(event) => setClosureEventName(event.target.value)}
                      placeholder="例: 台風休講 2026-08-15"
                      data-testid="input-closure-event-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">共通コード <span className="text-muted-foreground font-normal text-xs">（8文字以上）</span></p>
                    <div className="flex gap-2">
                      <Input
                        value={closureSharedCode}
                        onChange={(event) => setClosureSharedCode(event.target.value.toUpperCase())}
                        placeholder="例: TAIFU2026"
                        data-testid="input-closure-shared-code"
                        className="font-mono"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={generateSharedCode}
                        title="ランダムに生成"
                        data-testid="button-generate-shared-code"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">推測されにくいコードにするか、右のボタンでランダム生成してください。</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">利用上限</p>
                    <Input
                      type="number"
                      min={1}
                      value={closureUsageLimit}
                      onChange={(event) => setClosureUsageLimit(Number(event.target.value || 0))}
                      data-testid="input-closure-usage-limit"
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">有効期限</p>
                    <Input
                      type="date"
                      value={closureExpiresAtISO}
                      onChange={(event) => setClosureExpiresAtISO(event.target.value)}
                      data-testid="input-closure-expiry"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">休講対象枠（複数選択）</p>
                  <div className="max-h-64 overflow-y-auto rounded border divide-y">
                    {(allSlots || []).map((slot) => (
                      <label key={slot.id} className="flex items-center gap-3 p-3 text-sm hover:bg-muted/30">
                        <input
                          type="checkbox"
                          checked={selectedClosureSlotIds.has(slot.id)}
                          onChange={() => handleToggleClosureSlotSelection(slot.id)}
                          className="h-4 w-4 rounded border-gray-300"
                          data-testid={`checkbox-closure-slot-${slot.id}`}
                        />
                        <span className="font-medium">{format(parseJstDate(formatJstDate(slot.date as Date | string)), "yyyy/MM/dd", { locale: ja })} {slot.startTime}</span>
                        <Badge variant="outline">{slot.classBand}</Badge>
                        <span className="text-muted-foreground">{slot.courseLabel}</span>
                      </label>
                    ))}
                    {(!allSlots || allSlots.length === 0) && (
                      <p className="p-3 text-sm text-muted-foreground">枠がありません。先に枠を作成してください。</p>
                    )}
                  </div>
                </div>

                <Button
                  onClick={handleCreateClosureEvent}
                  disabled={createClosureEventMutation.isPending}
                  data-testid="button-create-closure-event"
                >
                  {createClosureEventMutation.isPending ? "作成中..." : "休講イベントを作成"}
                </Button>

                <div className="border-t pt-6 space-y-3">
                  <h3 className="font-semibold">作成済みイベント</h3>
                  {loadingClosureEvents && (
                    <div className="flex justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin" />
                    </div>
                  )}
                  {!loadingClosureEvents && (!closureEvents || closureEvents.length === 0) && (
                    <p className="text-sm text-muted-foreground">イベントはまだ作成されていません。</p>
                  )}
                  {(closureEvents || []).map((event) => (
                    <div key={event.id} className="rounded-lg border p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{event.name}</p>
                          <p className="text-xs text-muted-foreground">コード: <span className="font-mono">{event.sharedCode}</span></p>
                          <p className="text-xs text-muted-foreground">残り利用: {event.usageRemaining} / {event.usageLimit}（使用済み {event.usageUsed}）</p>
                          <p className="text-xs text-muted-foreground">期限: {event.expiresAt}</p>
                        </div>
                        <div className="flex gap-2">
                          {event.isArchived ? (
                            <Badge variant="secondary">アーカイブ済み</Badge>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => archiveClosureEventMutation.mutate(event.id)}
                              disabled={archiveClosureEventMutation.isPending}
                              data-testid={`button-archive-closure-event-${event.id}`}
                            >
                              <ArchiveIcon className="w-4 h-4 mr-1" />
                              停止
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">対象枠</p>
                        {event.slots.length === 0 && (
                          <p className="text-xs text-muted-foreground">対象枠なし</p>
                        )}
                        {event.slots.map((slot) => (
                          <p key={`${event.id}-${slot.slotId}`} className="text-xs text-muted-foreground">
                            {slot.date} {slot.startTime} {slot.classBand} {slot.courseLabel}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

          </TabsContent>

          <TabsContent value="courses" className="mt-6">
            <CoursesManagement />
          </TabsContent>
        </Tabs>

      </main>

      <SlotDialog
        slot={editingSlotData}
        open={showSlotDialog}
        onOpenChange={setShowSlotDialog}
        onSave={(data) => {
          if (editingSlotData) {
            const classBand = editingSlotData.classBand;
            const capacityData = data.classBandCapacities?.[classBand];
            updateSlotMutation.mutate({
              id: editingSlotData.id,
              date: data.date,
              startTime: data.startTime,
              courseLabel: data.courseLabel,
              classBand: classBand,
              capacityLimit: capacityData?.capacityLimit,
              capacityCurrent: capacityData?.capacityCurrent,
              applyToFuture: data.applyToFuture,
            });
          } else {
            createSlotMutation.mutate(data);
          }
        }}
      />
    </div>
  );
}

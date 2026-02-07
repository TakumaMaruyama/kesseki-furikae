import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ListIcon, CalendarIcon, InfoIcon, LogOutIcon, Loader2 } from "lucide-react";
import type { ClassSlot } from "@shared/schema";
import { Calendar } from "@/components/ui/calendar";

// Import extracted admin components
import {
  AdminLoginForm,
  DashboardOverview,
  DailyStatusView,
  HistoryView,
  CoursesManagement,
  LessonsStatusView,
  SlotDialog,
} from "@/components/admin";

export default function AdminPage() {
  const { toast } = useToast();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [editingSlots, setEditingSlots] = useState<Set<string>>(new Set());
  const [capacityValues, setCapacityValues] = useState<Record<string, any>>({});
  const [showSlotDialog, setShowSlotDialog] = useState(false);
  const [editingSlotData, setEditingSlotData] = useState<ClassSlot | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("calendar");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function checkAuth() {
      try {
        const response = await fetch("/api/admin/check", { credentials: "include" });
        const data = await response.json();
        setIsAuthenticated(data.authenticated);
      } catch (error) {
        setIsAuthenticated(false);
      }
    }
    checkAuth();
  }, []);

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/admin/logout", {});
      setIsAuthenticated(false);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const { data: allSlots, isLoading: loadingSlots } = useQuery<ClassSlot[]>({
    queryKey: ["/api/admin/slots"],
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
    onSuccess: (response: any) => {
      const description = response.count
        ? `${response.count}個の枠を作成しました。`
        : "新しい枠を作成しました。";

      toast({
        title: "作成完了",
        description,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/slots"] });
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
    mutationFn: (id: string) => apiRequest("POST", "/api/admin/delete-slot", { id }),
    onSuccess: () => {
      toast({
        title: "削除完了",
        description: "枠を削除しました。",
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
    const dateStr = date.toISOString().split('T')[0];
    const daySlots = allSlots?.filter(slot => {
      const slotDate = new Date(slot.date);
      return slotDate.toISOString().split('T')[0] === dateStr;
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
    return <AdminLoginForm onSuccess={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between px-6">
          <h1 className="text-xl font-bold">はまスイ 管理画面</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const helpSection = document.getElementById("help-section");
                if (helpSection) {
                  helpSection.scrollIntoView({ behavior: "smooth" });
                }
              }}
            >
              <InfoIcon className="w-4 h-4 mr-2" />
              使い方
            </Button>
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
          <TabsList className="grid w-full max-w-5xl grid-cols-5 h-12">
            <TabsTrigger value="daily-status" data-testid="tab-daily-status" className="text-base">
              本日の状況
            </TabsTrigger>
            <TabsTrigger value="lessons" data-testid="tab-lessons" className="text-base">
              レッスン状況
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

          <TabsContent value="lessons" className="mt-6">
            <LessonsStatusView />
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
                          hasSlots: allSlots.map(slot => new Date(slot.date)),
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
                        const selectedYear = selectedDate.getFullYear();
                        const selectedMonth = selectedDate.getMonth();
                        const selectedDay = selectedDate.getDate();

                        const daySlots = allSlots.filter(slot => {
                          const slotDate = new Date(slot.date);
                          return slotDate.getFullYear() === selectedYear &&
                            slotDate.getMonth() === selectedMonth &&
                            slotDate.getDate() === selectedDay;
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
                              {daySlots
                                .sort((a, b) => a.startTime.localeCompare(b.startTime))
                                .map((slot) => (
                                  <div
                                    key={slot.id}
                                    className="border-2 rounded-lg p-4 hover:bg-muted/30 transition-colors"
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
                                          </div>
                                          <p className="text-sm text-muted-foreground">{slot.courseLabel}</p>
                                          <div className="grid grid-cols-2 gap-2 text-sm">
                                            <div>
                                              <span className="text-muted-foreground">振替可能枠: </span>
                                              <span className="font-semibold">{slot.capacityLimit - slot.capacityCurrent}</span>
                                            </div>
                                            <div>
                                              <span className="text-muted-foreground">使用済み: </span>
                                              <span className="font-semibold">{slot.capacityMakeupUsed}</span>
                                            </div>
                                          </div>
                                          <div className="text-sm">
                                            <span className="text-muted-foreground">残り枠数: </span>
                                            <span className="text-lg font-bold text-primary">
                                              {(slot.capacityLimit - slot.capacityCurrent) - slot.capacityMakeupUsed}
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
                                          onClick={async () => {
                                            const response = await fetch(`/api/admin/slot-requests-count?slotId=${slot.id}`);
                                            const data = await response.json();
                                            const requestsCount = data.count || 0;

                                            let message = `${slot.courseLabel}の枠を削除しますか？`;
                                            if (requestsCount > 0) {
                                              message = `${slot.courseLabel}の枠を削除しますか？\n\n※この枠には${requestsCount}件の申し込みがあります。削除すると申し込みも全て削除されます。`;
                                            }

                                            if (confirm(message)) {
                                              deleteSlotMutation.mutate(slot.id);
                                            }
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
                        const dateKey = new Date(slot.date).toISOString().split('T')[0];
                        if (!acc[dateKey]) {
                          acc[dateKey] = [];
                        }
                        acc[dateKey].push(slot);
                        return acc;
                      }, {} as Record<string, ClassSlot[]>);

                      // 日付順にソート
                      const sortedDates = Object.keys(slotsByDate).sort();

                      return sortedDates.map((dateKey) => {
                        const slots = slotsByDate[dateKey];
                        const date = new Date(dateKey);

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
                            <div className="divide-y">
                              {slots
                                .sort((a, b) => a.startTime.localeCompare(b.startTime))
                                .map((slot) => (
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
                                            <Badge variant="outline" className="text-sm">
                                              {slot.classBand}
                                            </Badge>
                                          </div>
                                          <div>
                                            <p className="text-xs text-muted-foreground mb-1">振替可能枠（自動計算）</p>
                                            <p className="font-semibold">
                                              {slot.capacityLimit - slot.capacityCurrent} 枠
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                              使用済み: {slot.capacityMakeupUsed}
                                            </p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-muted-foreground mb-1">残り枠数</p>
                                            <p className="text-lg font-bold text-primary">
                                              {(slot.capacityLimit - slot.capacityCurrent) - slot.capacityMakeupUsed}
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
                                          onClick={async () => {
                                            // 申し込み件数を確認
                                            const response = await fetch(`/api/admin/slot-requests-count?slotId=${slot.id}`);
                                            const data = await response.json();
                                            const requestsCount = data.count || 0;

                                            let message = `${slot.courseLabel}の枠を削除しますか？`;
                                            if (requestsCount > 0) {
                                              message = `${slot.courseLabel}の枠を削除しますか？\n\n※この枠には${requestsCount}件の申し込みがあります。削除すると申し込みも全て削除されます。`;
                                            }

                                            if (confirm(message)) {
                                              deleteSlotMutation.mutate(slot.id);
                                            }
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
                        );
                      });
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>

          </TabsContent>

          <TabsContent value="courses" className="mt-6">
            <CoursesManagement />
          </TabsContent>
        </Tabs>

        <section id="help-section" className="mt-12 space-y-6">
          <h2 className="text-2xl font-bold">システム利用ガイド</h2>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">レッスン状況の見方</h3>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-semibold mb-1">📅 日付を選択すると...</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                  <li>その日のレッスン枠一覧が表示されます</li>
                  <li>各枠の欠席者と振替予約者を確認できます</li>
                  <li>受入可能人数の計算は自動で行われます</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold mb-1">👥 表示される情報</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                  <li><strong>欠席者</strong>: このレッスンを欠席する生徒</li>
                  <li><strong>振替予約者</strong>: 他のレッスンから振替でこのレッスンに参加する生徒</li>
                  <li><strong>受入枠</strong>: 定員 - 通常参加者 + 欠席者 = 振替で受入可能な人数</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">自動処理について</h3>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-semibold mb-1">🔄 振替予約について</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                  <li>保護者は空き枠があるレッスンを選択して振替予約を行います</li>
                  <li>確定時に保護者へメール通知が送信されます</li>
                  <li>満席の枠は予約できません</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold mb-1">⏰ 振替期限について</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                  <li>欠席日から30日以内に振替予約を行う必要があります</li>
                  <li>振替予約はレッスン開始30分前まで可能です</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">保護者側の操作フロー</h3>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="space-y-2">
                <p className="font-semibold">1️⃣ 欠席連絡の登録</p>
                <p className="text-muted-foreground ml-4">トップページから欠席情報を入力して登録</p>

                <p className="font-semibold">2️⃣ メールでリンク受信</p>
                <p className="text-muted-foreground ml-4">登録したメールアドレスに専用の振替予約リンクが送信される</p>

                <p className="font-semibold">3️⃣ 振替枠の検索・予約</p>
                <p className="text-muted-foreground ml-4">メールのリンクから振替可能な枠を検索し、空きがあれば予約を確定</p>

                <p className="font-semibold">4️⃣ 確認メール</p>
                <p className="text-muted-foreground ml-4">振替予約が確定するとメール通知が届く</p>
              </div>

              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="font-semibold text-yellow-800 mb-1">⚠️ 重要ポイント</p>
                <ul className="list-disc list-inside text-yellow-700 space-y-1">
                  <li>メールのリンクは<strong>専用トークン付き</strong>で、後からでもアクセス可能</li>
                  <li>トークンなしではトップページから新規欠席登録しかできません</li>
                  <li>保護者にはメールを保存するよう案内しています</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </section>
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
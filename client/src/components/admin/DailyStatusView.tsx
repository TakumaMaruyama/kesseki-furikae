import { useDeferredValue, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import type { Course } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, UserX, UserCheck, UserIcon, PlusIcon, PencilIcon, TrashIcon, UsersIcon } from "lucide-react";

interface DailyStatusItem {
  childName: string;
  courseLabel: string;
  classBand: string;
  startTime: string;
}

interface DailyAbsenceItem extends DailyStatusItem {
  reportType: "ABSENCE" | "LATE";
}

interface TrialParticipantItem {
  id: string;
  participantName: string;
  grade: string;
  swimLevel: string;
  slotId: string;
  courseLabel: string;
  classBand: string;
  startTime: string;
}

interface NewEnrolleeItem {
  id: string;
  childName: string;
  grade: string | null;
  classBand: string | null;
  joinedAt: string;
  courseId: string | null;
  courseName: string;
  startTime: string;
  sourceTrialParticipantId: string | null;
}

interface DailyStatusData {
  date: string;
  absentees: DailyAbsenceItem[];
  makeups: DailyStatusItem[];
  trialParticipants: TrialParticipantItem[];
  newEnrollees: NewEnrolleeItem[];
}

interface DailyLessonItem {
  id: string;
  startTime: string;
  courseLabel: string;
  classBand: string;
}

interface TrialParticipantPayload {
  participantName: string;
  grade: string;
  swimLevel: string;
  slotId: string;
}

interface NewEnrolleePayload {
  childName: string;
  grade: string;
  classBand: string | null;
  joinedAtISO: string;
  courseId: string;
  sourceTrialParticipantId: string | null;
}

interface TrialParticipantSearchItem {
  id: string;
  participantName: string;
  grade: string;
  swimLevel: string;
  slotId: string;
  slotDate: string;
  startTime: string;
  courseLabel: string;
  classBand: string;
}

const CLASS_BAND_OPTIONS = ["初級", "中級", "上級"] as const;
const CLASS_BAND_ORDER: Record<string, number> = {
  初級: 0,
  中級: 1,
  上級: 2,
};

function getClassBandOrder(classBand?: string | null): number {
  if (!classBand) {
    return Number.MAX_SAFE_INTEGER;
  }
  return CLASS_BAND_ORDER[classBand] ?? Number.MAX_SAFE_INTEGER;
}

function formatClassBandLabel(classBand?: string | null): string {
  return classBand || "未設定";
}

function groupAndSortByStartTime<T extends DailyStatusItem>(items: T[]) {
  const grouped = items.reduce<Record<string, T[]>>((acc, item) => {
    if (!acc[item.startTime]) {
      acc[item.startTime] = [];
    }
    acc[item.startTime].push(item);
    return acc;
  }, {});

  return Object.keys(grouped)
    .sort((a, b) => a.localeCompare(b))
    .map((startTime) => ({
      startTime,
      items: grouped[startTime].sort((a, b) => {
        const classBandOrderDiff = getClassBandOrder(a.classBand) - getClassBandOrder(b.classBand);
        if (classBandOrderDiff !== 0) return classBandOrderDiff;
        return a.childName.localeCompare(b.childName, "ja");
      }),
    }));
}

function groupAndSortTrialParticipantsByStartTime(items: TrialParticipantItem[]) {
  const grouped = items.reduce<Record<string, TrialParticipantItem[]>>((acc, item) => {
    if (!acc[item.startTime]) {
      acc[item.startTime] = [];
    }
    acc[item.startTime].push(item);
    return acc;
  }, {});

  return Object.keys(grouped)
    .sort((a, b) => a.localeCompare(b))
    .map((startTime) => ({
      startTime,
      items: grouped[startTime].sort((a, b) => a.participantName.localeCompare(b.participantName, "ja")),
    }));
}

function groupAndSortNewEnrolleesByStartTime(items: NewEnrolleeItem[]) {
  const grouped = items.reduce<Record<string, NewEnrolleeItem[]>>((acc, item) => {
    if (!acc[item.startTime]) {
      acc[item.startTime] = [];
    }
    acc[item.startTime].push(item);
    return acc;
  }, {});

  return Object.keys(grouped)
    .sort((a, b) => a.localeCompare(b))
    .map((startTime) => ({
      startTime,
      items: grouped[startTime].sort((a, b) => {
        const classBandOrderDiff = getClassBandOrder(a.classBand) - getClassBandOrder(b.classBand);
        if (classBandOrderDiff !== 0) return classBandOrderDiff;
        return a.childName.localeCompare(b.childName, "ja");
      }),
    }));
}

function getReportTypeBadgeStyle(reportType: "ABSENCE" | "LATE"): string {
  if (reportType === "LATE") {
    return "bg-amber-100 text-amber-800 border-amber-200";
  }
  return "bg-red-100 text-red-700 border-red-200";
}

function getReportTypeLabel(reportType: "ABSENCE" | "LATE"): string {
  return reportType === "LATE" ? "遅刻" : "欠席";
}

function buildDefaultTrialPayload(defaultSlotId = ""): TrialParticipantPayload {
  return {
    participantName: "",
    grade: "",
    swimLevel: "",
    slotId: defaultSlotId,
  };
}

function buildDefaultNewEnrolleePayload(defaultJoinedAtISO: string): NewEnrolleePayload {
  return {
    childName: "",
    grade: "",
    classBand: "",
    joinedAtISO: defaultJoinedAtISO,
    courseId: "",
    sourceTrialParticipantId: null,
  };
}

export function DailyStatusView() {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isTrialDialogOpen, setIsTrialDialogOpen] = useState(false);
  const [editingTrialParticipant, setEditingTrialParticipant] = useState<TrialParticipantItem | null>(null);
  const [trialPayload, setTrialPayload] = useState<TrialParticipantPayload>(() => buildDefaultTrialPayload());
  const [isNewEnrolleeDialogOpen, setIsNewEnrolleeDialogOpen] = useState(false);
  const [editingNewEnrollee, setEditingNewEnrollee] = useState<NewEnrolleeItem | null>(null);
  const [newEnrolleePayload, setNewEnrolleePayload] = useState<NewEnrolleePayload>(() => buildDefaultNewEnrolleePayload(format(new Date(), "yyyy-MM-dd")));
  const [trialSearchQuery, setTrialSearchQuery] = useState("");
  const [hasTouchedTrialSelection, setHasTouchedTrialSelection] = useState(false);

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const deferredTrialSearchQuery = useDeferredValue(trialSearchQuery.trim());

  const { data, isLoading } = useQuery<DailyStatusData>({
    queryKey: ["/api/admin/daily-status", dateStr],
    queryFn: async () => {
      const res = await fetch(`/api/admin/daily-status?date=${dateStr}`);
      if (!res.ok) throw new Error("Failed to fetch daily status");
      return res.json();
    },
  });

  const { data: dailyLessons = [] } = useQuery<DailyLessonItem[]>({
    queryKey: ["/api/admin/daily-lessons", dateStr],
    queryFn: async () => apiRequest("GET", `/api/admin/daily-lessons?date=${dateStr}`),
  });

  const { data: courses = [], isLoading: isLoadingCourses } = useQuery<Course[]>({
    queryKey: ["/api/admin/courses"],
    queryFn: async () => apiRequest("GET", "/api/admin/courses"),
  });

  const { data: trialSearchResults = [], isFetching: isFetchingTrialSearch } = useQuery<TrialParticipantSearchItem[]>({
    queryKey: ["/api/admin/trial-participants/search", deferredTrialSearchQuery],
    queryFn: async () => apiRequest("GET", `/api/admin/trial-participants/search?query=${encodeURIComponent(deferredTrialSearchQuery)}`),
    enabled: isNewEnrolleeDialogOpen,
  });

  const invalidateDailyQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/daily-status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/daily-lessons"] });
  };

  const closeTrialDialog = () => {
    setIsTrialDialogOpen(false);
    setEditingTrialParticipant(null);
    setTrialPayload(buildDefaultTrialPayload());
  };

  const closeNewEnrolleeDialog = () => {
    setIsNewEnrolleeDialogOpen(false);
    setEditingNewEnrollee(null);
    setNewEnrolleePayload(buildDefaultNewEnrolleePayload(dateStr));
    setTrialSearchQuery("");
    setHasTouchedTrialSelection(false);
  };

  const createTrialParticipantMutation = useMutation({
    mutationFn: (payload: TrialParticipantPayload) => apiRequest("POST", "/api/admin/trial-participants", payload),
    onSuccess: () => {
      toast({
        title: "登録完了",
        description: "体験者を登録しました。",
      });
      invalidateDailyQueries();
      closeTrialDialog();
    },
    onError: (error: any) => {
      toast({
        title: "登録エラー",
        description: error.message || "体験者登録に失敗しました。",
        variant: "destructive",
      });
    },
  });

  const updateTrialParticipantMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: TrialParticipantPayload }) =>
      apiRequest("PUT", `/api/admin/trial-participants/${id}`, payload),
    onSuccess: () => {
      toast({
        title: "更新完了",
        description: "体験者情報を更新しました。",
      });
      invalidateDailyQueries();
      closeTrialDialog();
    },
    onError: (error: any) => {
      toast({
        title: "更新エラー",
        description: error.message || "体験者情報の更新に失敗しました。",
        variant: "destructive",
      });
    },
  });

  const deleteTrialParticipantMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/trial-participants/${id}`),
    onSuccess: () => {
      toast({
        title: "削除完了",
        description: "体験者情報を削除しました。",
      });
      invalidateDailyQueries();
    },
    onError: (error: any) => {
      toast({
        title: "削除エラー",
        description: error.message || "体験者情報の削除に失敗しました。",
        variant: "destructive",
      });
    },
  });

  const createNewEnrolleeMutation = useMutation({
    mutationFn: (payload: NewEnrolleePayload) => apiRequest("POST", "/api/admin/new-enrollees", payload),
    onSuccess: () => {
      toast({
        title: "登録完了",
        description: "新規入会者を登録しました。",
      });
      invalidateDailyQueries();
      closeNewEnrolleeDialog();
    },
    onError: (error: any) => {
      toast({
        title: "登録エラー",
        description: error.message || "新規入会者の登録に失敗しました。",
        variant: "destructive",
      });
    },
  });

  const updateNewEnrolleeMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: NewEnrolleePayload }) =>
      apiRequest("PUT", `/api/admin/new-enrollees/${id}`, payload),
    onSuccess: () => {
      toast({
        title: "更新完了",
        description: "新規入会者情報を更新しました。",
      });
      invalidateDailyQueries();
      closeNewEnrolleeDialog();
    },
    onError: (error: any) => {
      toast({
        title: "更新エラー",
        description: error.message || "新規入会者情報の更新に失敗しました。",
        variant: "destructive",
      });
    },
  });

  const deleteNewEnrolleeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/new-enrollees/${id}`),
    onSuccess: () => {
      toast({
        title: "削除完了",
        description: "新規入会者を削除しました。",
      });
      invalidateDailyQueries();
    },
    onError: (error: any) => {
      toast({
        title: "削除エラー",
        description: error.message || "新規入会者の削除に失敗しました。",
        variant: "destructive",
      });
    },
  });

  const hasLessonOptions = dailyLessons.length > 0;
  const hasCourseOptions = courses.length > 0;
  const isSavingTrialParticipant = createTrialParticipantMutation.isPending || updateTrialParticipantMutation.isPending;
  const isSavingNewEnrollee = createNewEnrolleeMutation.isPending || updateNewEnrolleeMutation.isPending;

  const openCreateTrialDialog = () => {
    setEditingTrialParticipant(null);
    setTrialPayload(buildDefaultTrialPayload(dailyLessons[0]?.id ?? ""));
    setIsTrialDialogOpen(true);
  };

  const openEditTrialDialog = (participant: TrialParticipantItem) => {
    setEditingTrialParticipant(participant);
    setTrialPayload({
      participantName: participant.participantName,
      grade: participant.grade,
      swimLevel: participant.swimLevel,
      slotId: participant.slotId,
    });
    setIsTrialDialogOpen(true);
  };

  const openCreateNewEnrolleeDialog = () => {
    setEditingNewEnrollee(null);
    setNewEnrolleePayload(buildDefaultNewEnrolleePayload(dateStr));
    setTrialSearchQuery("");
    setHasTouchedTrialSelection(false);
    setIsNewEnrolleeDialogOpen(true);
  };

  const openEditNewEnrolleeDialog = (enrollee: NewEnrolleeItem) => {
    setEditingNewEnrollee(enrollee);
    setNewEnrolleePayload({
      childName: enrollee.childName,
      grade: enrollee.grade ?? "",
      classBand: enrollee.classBand ?? "",
      joinedAtISO: enrollee.joinedAt,
      courseId: enrollee.courseId ?? "",
      sourceTrialParticipantId: null,
    });
    setTrialSearchQuery("");
    setHasTouchedTrialSelection(false);
    setIsNewEnrolleeDialogOpen(true);
  };

  const handleSubmitTrialParticipant = () => {
    const participantName = trialPayload.participantName.trim();
    const grade = trialPayload.grade.trim();
    const swimLevel = trialPayload.swimLevel.trim();
    const slotId = trialPayload.slotId;

    if (!participantName || !grade || !swimLevel || !slotId) {
      toast({
        title: "入力エラー",
        description: "名前・学年・泳力・参加枠を入力してください。",
        variant: "destructive",
      });
      return;
    }

    const payload: TrialParticipantPayload = {
      participantName,
      grade,
      swimLevel,
      slotId,
    };

    if (editingTrialParticipant) {
      updateTrialParticipantMutation.mutate({
        id: editingTrialParticipant.id,
        payload,
      });
      return;
    }

    createTrialParticipantMutation.mutate(payload);
  };

  const handleDeleteTrialParticipant = (participant: TrialParticipantItem) => {
    if (confirm(`${participant.participantName}さんの体験者情報を削除しますか？`)) {
      deleteTrialParticipantMutation.mutate(participant.id);
    }
  };

  const handleSelectTrialParticipant = (value: string) => {
    setHasTouchedTrialSelection(true);

    if (value === "none") {
      setNewEnrolleePayload((prev) => ({
        ...prev,
        sourceTrialParticipantId: null,
      }));
      return;
    }

    const selectedTrial = trialSearchResults.find((participant) => participant.id === value);
    if (!selectedTrial) {
      return;
    }

    setNewEnrolleePayload((prev) => ({
      ...prev,
      childName: selectedTrial.participantName,
      grade: selectedTrial.grade,
      classBand: selectedTrial.classBand,
      sourceTrialParticipantId: selectedTrial.id,
    }));
  };

  const handleSubmitNewEnrollee = () => {
    const childName = newEnrolleePayload.childName.trim();
    const grade = newEnrolleePayload.grade.trim();
    const joinedAtISO = newEnrolleePayload.joinedAtISO;
    const courseId = newEnrolleePayload.courseId;
    const sourceTrialParticipantId = hasTouchedTrialSelection
      ? newEnrolleePayload.sourceTrialParticipantId
      : (editingNewEnrollee?.sourceTrialParticipantId ?? null);

    if (!childName || !joinedAtISO || !courseId) {
      toast({
        title: "入力エラー",
        description: "名前・入会日・コースを入力してください。",
        variant: "destructive",
      });
      return;
    }

    const payload: NewEnrolleePayload = {
      childName,
      grade,
      classBand: newEnrolleePayload.classBand || null,
      joinedAtISO,
      courseId,
      sourceTrialParticipantId,
    };

    if (editingNewEnrollee) {
      updateNewEnrolleeMutation.mutate({
        id: editingNewEnrollee.id,
        payload,
      });
      return;
    }

    createNewEnrolleeMutation.mutate(payload);
  };

  const handleDeleteNewEnrollee = (enrollee: NewEnrolleeItem) => {
    if (confirm(`${enrollee.childName}さんの新規入会者表示を削除しますか？`)) {
      deleteNewEnrolleeMutation.mutate(enrollee.id);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-2">
        <CardHeader>
          <CardTitle className="text-xl">本日の欠席・遅刻・振替・体験者・新規入会者</CardTitle>
          <p className="text-sm text-muted-foreground">
            日付を選択して、その日の欠席者・遅刻者・振替者・体験者・新規入会者を確認できます
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="flex justify-center lg:justify-start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => date && setSelectedDate(date)}
                className="rounded-md border"
                locale={ja}
              />
            </div>

            <div className="space-y-6 lg:col-span-2">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <h3 className="text-lg font-bold">
                  {format(selectedDate, "yyyy年M月d日(E)", { locale: ja })}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={openCreateTrialDialog}
                    disabled={!hasLessonOptions || isSavingTrialParticipant}
                  >
                    <PlusIcon className="mr-1 h-4 w-4" />
                    体験者を追加
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={openCreateNewEnrolleeDialog}
                    disabled={isLoadingCourses || !hasCourseOptions || isSavingNewEnrollee}
                  >
                    <PlusIcon className="mr-1 h-4 w-4" />
                    新規入会者を追加
                  </Button>
                </div>
              </div>

              {!hasLessonOptions && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  この日には登録済みレッスン枠がないため、体験者を登録できません。
                </p>
              )}

              {!isLoadingCourses && !hasCourseOptions && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  コースが未登録のため、新規入会者を登録できません。先にコースを登録してください。
                </p>
              )}

              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
                  <Card className="border-destructive/30">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base text-destructive">
                        <UserX className="h-5 w-5" />
                        欠席・遅刻者
                        <span className="ml-auto text-2xl font-bold">
                          {data?.absentees.length || 0}
                        </span>
                        <span className="text-sm font-normal">名</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {data?.absentees.length === 0 ? (
                        <p className="py-4 text-center text-sm text-muted-foreground">
                          欠席者はいません
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {groupAndSortByStartTime(data?.absentees || []).map((group) => (
                            <div key={group.startTime} className="overflow-hidden rounded-lg border-2">
                              <div className="border-b bg-destructive/10 px-3 py-2">
                                <p className="text-sm font-semibold">{group.startTime}</p>
                              </div>
                              <div className="divide-y">
                                {group.items.map((item, index) => (
                                  <div
                                    key={`${group.startTime}-${item.childName}-${index}`}
                                    className="bg-destructive/5 p-3"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="font-semibold">{item.childName}</p>
                                      <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${getReportTypeBadgeStyle(item.reportType)}`}>
                                        {getReportTypeLabel(item.reportType)}
                                      </span>
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                      {item.courseLabel} （{item.classBand}）
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-primary/30">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base text-primary">
                        <UserCheck className="h-5 w-5" />
                        振替者
                        <span className="ml-auto text-2xl font-bold">
                          {data?.makeups.length || 0}
                        </span>
                        <span className="text-sm font-normal">名</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {data?.makeups.length === 0 ? (
                        <p className="py-4 text-center text-sm text-muted-foreground">
                          振替者はいません
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {groupAndSortByStartTime(data?.makeups || []).map((group) => (
                            <div key={group.startTime} className="overflow-hidden rounded-lg border-2">
                              <div className="border-b bg-primary/10 px-3 py-2">
                                <p className="text-sm font-semibold">{group.startTime}</p>
                              </div>
                              <div className="divide-y">
                                {group.items.map((item, index) => (
                                  <div
                                    key={`${group.startTime}-${item.childName}-${index}`}
                                    className="bg-primary/5 p-3"
                                  >
                                    <p className="font-semibold">{item.childName}</p>
                                    <p className="text-sm text-muted-foreground">
                                      {item.courseLabel} （{item.classBand}）
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-emerald-300/70">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base text-emerald-700">
                        <UserIcon className="h-5 w-5" />
                        体験者
                        <span className="ml-auto text-2xl font-bold">
                          {data?.trialParticipants.length || 0}
                        </span>
                        <span className="text-sm font-normal">名</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {data?.trialParticipants.length === 0 ? (
                        <p className="py-4 text-center text-sm text-muted-foreground">
                          体験者はいません
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {groupAndSortTrialParticipantsByStartTime(data?.trialParticipants || []).map((group) => (
                            <div key={group.startTime} className="overflow-hidden rounded-lg border-2">
                              <div className="border-b bg-emerald-100/60 px-3 py-2">
                                <p className="text-sm font-semibold">{group.startTime}</p>
                              </div>
                              <div className="divide-y">
                                {group.items.map((participant) => (
                                  <div
                                    key={participant.id}
                                    className="flex items-start justify-between gap-2 bg-emerald-50/60 p-3"
                                  >
                                    <div>
                                      <p className="font-semibold">{participant.participantName}</p>
                                      <p className="text-sm text-muted-foreground">
                                        学年: {participant.grade}
                                      </p>
                                      <p className="text-sm text-muted-foreground">
                                        泳力: {participant.swimLevel}
                                      </p>
                                      <p className="text-sm text-muted-foreground">
                                        {participant.courseLabel} （{participant.classBand}）
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => openEditTrialDialog(participant)}
                                        disabled={isSavingTrialParticipant}
                                      >
                                        <PencilIcon className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDeleteTrialParticipant(participant)}
                                        disabled={deleteTrialParticipantMutation.isPending}
                                        className="text-destructive hover:text-destructive"
                                      >
                                        <TrashIcon className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-sky-300/70">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base text-sky-700">
                        <UsersIcon className="h-5 w-5" />
                        新規入会者
                        <span className="ml-auto text-2xl font-bold">
                          {data?.newEnrollees.length || 0}
                        </span>
                        <span className="text-sm font-normal">名</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {data?.newEnrollees.length === 0 ? (
                        <p className="py-4 text-center text-sm text-muted-foreground">
                          新規入会者はいません
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {groupAndSortNewEnrolleesByStartTime(data?.newEnrollees || []).map((group) => (
                            <div key={group.startTime} className="overflow-hidden rounded-lg border-2">
                              <div className="border-b bg-sky-100/70 px-3 py-2">
                                <p className="text-sm font-semibold">{group.startTime}</p>
                              </div>
                              <div className="divide-y">
                                {group.items.map((enrollee) => (
                                  <div
                                    key={enrollee.id}
                                    className="flex items-start justify-between gap-2 bg-sky-50/70 p-3"
                                  >
                                    <div>
                                      <p className="font-semibold">{enrollee.childName}</p>
                                      <p className="text-sm text-muted-foreground">
                                        学年: {enrollee.grade || "未設定"}
                                      </p>
                                      <p className="text-sm text-muted-foreground">
                                        入会日: {enrollee.joinedAt}
                                      </p>
                                      <p className="text-sm text-muted-foreground">
                                        {enrollee.courseName} （{formatClassBandLabel(enrollee.classBand)}）
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => openEditNewEnrolleeDialog(enrollee)}
                                        disabled={isSavingNewEnrollee}
                                      >
                                        <PencilIcon className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDeleteNewEnrollee(enrollee)}
                                        disabled={deleteNewEnrolleeMutation.isPending}
                                        className="text-destructive hover:text-destructive"
                                      >
                                        <TrashIcon className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={isTrialDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeTrialDialog();
          } else {
            setIsTrialDialogOpen(true);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingTrialParticipant ? "体験者情報を編集" : "体験者を追加"}
            </DialogTitle>
            <DialogDescription>
              名前・学年・泳力・参加枠を入力してください。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="trial-participant-name">名前</Label>
              <Input
                id="trial-participant-name"
                value={trialPayload.participantName}
                onChange={(e) => setTrialPayload((prev) => ({
                  ...prev,
                  participantName: e.target.value,
                }))}
                placeholder="例: さとう はな"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="trial-participant-grade">学年</Label>
              <Input
                id="trial-participant-grade"
                value={trialPayload.grade}
                onChange={(e) => setTrialPayload((prev) => ({
                  ...prev,
                  grade: e.target.value,
                }))}
                placeholder="例: 小学3年"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="trial-participant-swim-level">泳力</Label>
              <Input
                id="trial-participant-swim-level"
                value={trialPayload.swimLevel}
                onChange={(e) => setTrialPayload((prev) => ({
                  ...prev,
                  swimLevel: e.target.value,
                }))}
                placeholder="例: 12.5mバタ足可"
              />
            </div>

            <div className="space-y-2">
              <Label>参加枠</Label>
              <Select
                value={trialPayload.slotId || undefined}
                onValueChange={(value) => setTrialPayload((prev) => ({
                  ...prev,
                  slotId: value,
                }))}
                disabled={!hasLessonOptions}
              >
                <SelectTrigger>
                  <SelectValue placeholder="参加枠を選択" />
                </SelectTrigger>
                <SelectContent>
                  {dailyLessons.map((lesson) => (
                    <SelectItem key={lesson.id} value={lesson.id}>
                      {lesson.startTime} {lesson.courseLabel}（{lesson.classBand}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={closeTrialDialog}
              disabled={isSavingTrialParticipant}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              onClick={handleSubmitTrialParticipant}
              disabled={!hasLessonOptions || isSavingTrialParticipant}
            >
              {isSavingTrialParticipant && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingTrialParticipant ? "更新する" : "登録する"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isNewEnrolleeDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeNewEnrolleeDialog();
          } else {
            setIsNewEnrolleeDialogOpen(true);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingNewEnrollee ? "新規入会者情報を編集" : "新規入会者を追加"}
            </DialogTitle>
            <DialogDescription>
              入会日・名前・コースを入力し、必要なら体験者から自動入力できます。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="trial-search-query">体験者を検索</Label>
              <Input
                id="trial-search-query"
                value={trialSearchQuery}
                onChange={(e) => setTrialSearchQuery(e.target.value)}
                placeholder="名前で検索"
              />
              <Select
                value={hasTouchedTrialSelection ? (newEnrolleePayload.sourceTrialParticipantId ?? "none") : "none"}
                onValueChange={handleSelectTrialParticipant}
              >
                <SelectTrigger>
                  <SelectValue placeholder="体験者から選択（任意）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">選択しない</SelectItem>
                  {trialSearchResults.map((participant) => (
                    <SelectItem key={participant.id} value={participant.id}>
                      {participant.participantName} / {participant.slotDate} {participant.startTime} {participant.courseLabel}（{participant.classBand}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isFetchingTrialSearch && (
                <p className="text-sm text-muted-foreground">体験者を検索しています...</p>
              )}
              {!isFetchingTrialSearch && trialSearchResults.length === 0 && (
                <p className="text-sm text-muted-foreground">一致する体験者がいません。</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-enrollee-name">名前</Label>
              <Input
                id="new-enrollee-name"
                value={newEnrolleePayload.childName}
                onChange={(e) => setNewEnrolleePayload((prev) => ({
                  ...prev,
                  childName: e.target.value,
                }))}
                placeholder="例: さとう はな"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-enrollee-grade">学年</Label>
              <Input
                id="new-enrollee-grade"
                value={newEnrolleePayload.grade}
                onChange={(e) => setNewEnrolleePayload((prev) => ({
                  ...prev,
                  grade: e.target.value,
                }))}
                placeholder="例: 小学3年"
              />
            </div>

            <div className="space-y-2">
              <Label>クラス帯</Label>
              <Select
                value={newEnrolleePayload.classBand || "none"}
                onValueChange={(value) => setNewEnrolleePayload((prev) => ({
                  ...prev,
                  classBand: value === "none" ? "" : value,
                }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="クラス帯を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未設定</SelectItem>
                  {CLASS_BAND_OPTIONS.map((classBand) => (
                    <SelectItem key={classBand} value={classBand}>
                      {classBand}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-enrollee-joined-at">入会日</Label>
              <Input
                id="new-enrollee-joined-at"
                type="date"
                value={newEnrolleePayload.joinedAtISO}
                onChange={(e) => setNewEnrolleePayload((prev) => ({
                  ...prev,
                  joinedAtISO: e.target.value,
                }))}
              />
            </div>

            <div className="space-y-2">
              <Label>コース</Label>
              <Select
                value={newEnrolleePayload.courseId || undefined}
                onValueChange={(value) => setNewEnrolleePayload((prev) => ({
                  ...prev,
                  courseId: value,
                }))}
                disabled={isLoadingCourses || !hasCourseOptions}
              >
                <SelectTrigger>
                  <SelectValue placeholder="コースを選択" />
                </SelectTrigger>
                <SelectContent>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.name} ({course.dayOfWeek} {course.startTime}){course.isActive ? "" : " [停止中]"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={closeNewEnrolleeDialog}
              disabled={isSavingNewEnrollee}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              onClick={handleSubmitNewEnrollee}
              disabled={isLoadingCourses || !hasCourseOptions || isSavingNewEnrollee}
            >
              {isSavingNewEnrollee && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingNewEnrollee ? "更新する" : "登録する"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

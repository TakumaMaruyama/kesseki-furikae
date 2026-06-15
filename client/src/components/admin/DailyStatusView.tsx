import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, UserX, UserCheck, UserIcon, PlusIcon, PencilIcon, TrashIcon } from "lucide-react";

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

interface DailyStatusData {
    date: string;
    absentees: DailyAbsenceItem[];
    makeups: DailyStatusItem[];
    trialParticipants: TrialParticipantItem[];
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

const CLASS_BAND_ORDER: Record<string, number> = {
    初級: 0,
    中級: 1,
    上級: 2,
};

function getClassBandOrder(classBand: string): number {
    return CLASS_BAND_ORDER[classBand] ?? Number.MAX_SAFE_INTEGER;
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

function getReportTypeBadgeStyle(reportType: "ABSENCE" | "LATE"): string {
    if (reportType === "LATE") {
        return "bg-amber-100 text-amber-800 border-amber-200";
    }
    return "bg-red-100 text-red-700 border-red-200";
}

function getReportTypeLabel(reportType: "ABSENCE" | "LATE"): string {
    return reportType === "LATE" ? "遅刻" : "欠席";
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

function buildDefaultTrialPayload(defaultSlotId = ""): TrialParticipantPayload {
    return {
        participantName: "",
        grade: "",
        swimLevel: "",
        slotId: defaultSlotId,
    };
}

export function DailyStatusView() {
    const { toast } = useToast();
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [isTrialDialogOpen, setIsTrialDialogOpen] = useState(false);
    const [editingTrialParticipant, setEditingTrialParticipant] = useState<TrialParticipantItem | null>(null);
    const [trialPayload, setTrialPayload] = useState<TrialParticipantPayload>(() => buildDefaultTrialPayload());

    const dateStr = format(selectedDate, "yyyy-MM-dd");

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

    const invalidateDailyQueries = () => {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/daily-status"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/daily-lessons"] });
    };

    const closeTrialDialog = () => {
        setIsTrialDialogOpen(false);
        setEditingTrialParticipant(null);
        setTrialPayload(buildDefaultTrialPayload());
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

    const hasLessonOptions = dailyLessons.length > 0;
    const isSavingTrialParticipant = createTrialParticipantMutation.isPending || updateTrialParticipantMutation.isPending;

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

    return (
        <div className="space-y-6">
            <Card className="border-2">
                <CardHeader>
                    <CardTitle className="text-xl">本日の欠席・遅刻・振替・体験者</CardTitle>
                    <p className="text-sm text-muted-foreground">
                        日付を選択して、その日の欠席者・遅刻者・振替者・体験者を確認できます
                    </p>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="flex justify-center lg:justify-start">
                            <Calendar
                                mode="single"
                                selected={selectedDate}
                                onSelect={(date) => date && setSelectedDate(date)}
                                className="rounded-md border"
                                locale={ja}
                            />
                        </div>

                        <div className="lg:col-span-2 space-y-6">
                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                <h3 className="text-lg font-bold">
                                    {format(selectedDate, "yyyy年M月d日(E)", { locale: ja })}
                                </h3>
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={openCreateTrialDialog}
                                    disabled={!hasLessonOptions || isSavingTrialParticipant}
                                >
                                    <PlusIcon className="w-4 h-4 mr-1" />
                                    体験者を追加
                                </Button>
                            </div>

                            {!hasLessonOptions && (
                                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                                    この日には登録済みレッスン枠がないため、体験者を登録できません。
                                </p>
                            )}

                            {isLoading ? (
                                <div className="flex justify-center py-8">
                                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <Card className="border-destructive/30">
                                        <CardHeader className="pb-3">
                                            <CardTitle className="text-base flex items-center gap-2 text-destructive">
                                                <UserX className="w-5 h-5" />
                                                欠席・遅刻者
                                                <span className="ml-auto text-2xl font-bold">
                                                    {data?.absentees.length || 0}
                                                </span>
                                                <span className="text-sm font-normal">名</span>
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            {data?.absentees.length === 0 ? (
                                                <p className="text-sm text-muted-foreground text-center py-4">
                                                    欠席者はいません
                                                </p>
                                            ) : (
                                                <div className="space-y-2">
                                                    {groupAndSortByStartTime(data?.absentees || []).map((group) => (
                                                        <div key={group.startTime} className="border-2 rounded-lg overflow-hidden">
                                                            <div className="px-3 py-2 bg-destructive/10 border-b">
                                                                <p className="text-sm font-semibold">{group.startTime}</p>
                                                            </div>
                                                            <div className="divide-y">
                                                                {group.items.map((item, index) => (
                                                                    <div
                                                                        key={`${group.startTime}-${item.childName}-${index}`}
                                                                        className="p-3 bg-destructive/5"
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
                                            <CardTitle className="text-base flex items-center gap-2 text-primary">
                                                <UserCheck className="w-5 h-5" />
                                                振替者
                                                <span className="ml-auto text-2xl font-bold">
                                                    {data?.makeups.length || 0}
                                                </span>
                                                <span className="text-sm font-normal">名</span>
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            {data?.makeups.length === 0 ? (
                                                <p className="text-sm text-muted-foreground text-center py-4">
                                                    振替者はいません
                                                </p>
                                            ) : (
                                                <div className="space-y-2">
                                                    {groupAndSortByStartTime(data?.makeups || []).map((group) => (
                                                        <div key={group.startTime} className="border-2 rounded-lg overflow-hidden">
                                                            <div className="px-3 py-2 bg-primary/10 border-b">
                                                                <p className="text-sm font-semibold">{group.startTime}</p>
                                                            </div>
                                                            <div className="divide-y">
                                                                {group.items.map((item, index) => (
                                                                    <div
                                                                        key={`${group.startTime}-${item.childName}-${index}`}
                                                                        className="p-3 bg-primary/5"
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
                                            <CardTitle className="text-base flex items-center gap-2 text-emerald-700">
                                                <UserIcon className="w-5 h-5" />
                                                体験者
                                                <span className="ml-auto text-2xl font-bold">
                                                    {data?.trialParticipants.length || 0}
                                                </span>
                                                <span className="text-sm font-normal">名</span>
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            {data?.trialParticipants.length === 0 ? (
                                                <p className="text-sm text-muted-foreground text-center py-4">
                                                    体験者はいません
                                                </p>
                                            ) : (
                                                <div className="space-y-2">
                                                    {groupAndSortTrialParticipantsByStartTime(data?.trialParticipants || []).map((group) => (
                                                        <div key={group.startTime} className="border-2 rounded-lg overflow-hidden">
                                                            <div className="px-3 py-2 bg-emerald-100/60 border-b">
                                                                <p className="text-sm font-semibold">{group.startTime}</p>
                                                            </div>
                                                            <div className="divide-y">
                                                                {group.items.map((participant) => (
                                                                    <div
                                                                        key={participant.id}
                                                                        className="p-3 bg-emerald-50/60 flex items-start justify-between gap-2"
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
                                                                                <PencilIcon className="w-4 h-4" />
                                                                            </Button>
                                                                            <Button
                                                                                type="button"
                                                                                variant="ghost"
                                                                                size="sm"
                                                                                onClick={() => handleDeleteTrialParticipant(participant)}
                                                                                disabled={deleteTrialParticipantMutation.isPending}
                                                                                className="text-destructive hover:text-destructive"
                                                                            >
                                                                                <TrashIcon className="w-4 h-4" />
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
                            {isSavingTrialParticipant && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            {editingTrialParticipant ? "更新する" : "登録する"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

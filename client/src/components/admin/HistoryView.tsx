import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { XIcon, Loader2, CheckCircleIcon } from "lucide-react";
import type { EnrichedAbsence, EnrichedRequest } from "./types";
import { formatJstDate, parseJstDate } from "@shared/jst";
import type { SlotSearchResult } from "@shared/schema";

type ClassBand = "初級" | "中級" | "上級";

function isClassBand(value: string): value is ClassBand {
    return value === "初級" || value === "中級" || value === "上級";
}

function formatJstDay(input: Date | string | number): string {
    return format(parseJstDate(formatJstDate(input)), "M/d(E)", { locale: ja });
}

function parseTimestamp(value: string | null | undefined): number | null {
    if (!value) {
        return null;
    }

    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
}

function compareNullableTimestampsDesc(aValue: string | null | undefined, bValue: string | null | undefined): number {
    const aTimestamp = parseTimestamp(aValue);
    const bTimestamp = parseTimestamp(bValue);

    if (aTimestamp !== null && bTimestamp !== null && aTimestamp !== bTimestamp) {
        return bTimestamp - aTimestamp;
    }
    if (aTimestamp === null && bTimestamp !== null) {
        return 1;
    }
    if (aTimestamp !== null && bTimestamp === null) {
        return -1;
    }

    return 0;
}

function getAbsenceReportTypeBadge(reportType: "ABSENCE" | "LATE") {
    if (reportType === "LATE") {
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">遅刻</Badge>;
    }
    return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300">欠席</Badge>;
}

export function HistoryView() {
    const { toast } = useToast();
    const [historyTab, setHistoryTab] = useState<"absences" | "requests">("absences");
    const [selectedMonth, setSelectedMonth] = useState(() => formatJstDate(new Date()).slice(0, 7));
    const [searchTerm, setSearchTerm] = useState("");
    const [bookingTarget, setBookingTarget] = useState<EnrichedAbsence | null>(null);
    const [bookingCandidates, setBookingCandidates] = useState<SlotSearchResult[]>([]);
    const [selectedBookingSlotId, setSelectedBookingSlotId] = useState<string>("");
    const [isBookingDialogOpen, setIsBookingDialogOpen] = useState(false);
    const [isLoadingBookingCandidates, setIsLoadingBookingCandidates] = useState(false);
    const [isDirectBookingDialogOpen, setIsDirectBookingDialogOpen] = useState(false);
    const [directChildName, setDirectChildName] = useState("");
    const [directClassBand, setDirectClassBand] = useState<ClassBand>("初級");
    const [directAbsentDateISO, setDirectAbsentDateISO] = useState<string>(() => formatJstDate(new Date()));
    const [directCandidates, setDirectCandidates] = useState<SlotSearchResult[]>([]);
    const [selectedDirectSlotId, setSelectedDirectSlotId] = useState<string>("");
    const [isLoadingDirectCandidates, setIsLoadingDirectCandidates] = useState(false);
    const { data: absences, isLoading: loadingAbsences } = useQuery<EnrichedAbsence[]>({
        queryKey: ["/api/admin/absences", selectedMonth],
        queryFn: () => apiRequest("GET", `/api/admin/absences?month=${encodeURIComponent(selectedMonth)}`),
        enabled: historyTab === "absences",
    });

    const { data: requests, isLoading: loadingRequests } = useQuery<EnrichedRequest[]>({
        queryKey: ["/api/admin/requests", selectedMonth],
        queryFn: () => apiRequest("GET", `/api/admin/requests?month=${encodeURIComponent(selectedMonth)}`),
        enabled: historyTab === "requests",
    });

    const cancelAbsenceMutation = useMutation({
        mutationFn: (id: string) => apiRequest("POST", `/api/admin/cancel-absence/${id}`, {}),
        onSuccess: (response: any) => {
            toast({
                title: "キャンセル完了",
                description: response.message || "欠席をキャンセルしました。",
            });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/absences"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/requests"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard-stats"] });
        },
        onError: (error: any) => {
            toast({
                title: "エラー",
                description: error.message || "キャンセルに失敗しました。",
                variant: "destructive",
            });
        },
    });

    const cancelRequestMutation = useMutation({
        mutationFn: (id: string) => apiRequest("POST", `/api/admin/cancel-request/${id}`, {}),
        onSuccess: (response: any) => {
            toast({
                title: "キャンセル完了",
                description: response.message || "振替をキャンセルしました。",
            });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/requests"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/absences"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard-stats"] });
        },
        onError: (error: any) => {
            toast({
                title: "エラー",
                description: error.message || "キャンセルに失敗しました。",
                variant: "destructive",
            });
        },
    });

    const bookFromAbsenceMutation = useMutation({
        mutationFn: async (params: { absence: EnrichedAbsence; toSlotId: string }) => {
            const { absence, toSlotId } = params;
            if (!isClassBand(absence.declaredClassBand)) {
                throw new Error("クラス帯が不正なため、振替登録できません。");
            }

            return apiRequest("POST", "/api/admin/book", {
                absenceId: absence.id,
                childName: absence.childName,
                declaredClassBand: absence.declaredClassBand,
                absentDateISO: formatJstDate(absence.absentDate),
                toSlotId,
            });
        },
        onSuccess: () => {
            toast({
                title: "振替登録完了",
                description: "管理者として振替予約を登録しました。",
            });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/absences"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/requests"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard-stats"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/daily-status"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/daily-lessons"] });
            queryClient.invalidateQueries({ queryKey: ["/api/search-slots"] });

            setIsBookingDialogOpen(false);
            setBookingTarget(null);
            setBookingCandidates([]);
            setSelectedBookingSlotId("");
        },
        onError: (error: any) => {
            toast({
                title: "振替登録エラー",
                description: error.message || "振替登録に失敗しました。",
                variant: "destructive",
            });
        },
    });

    const bookWithoutAbsenceMutation = useMutation({
        mutationFn: async (params: {
            childName: string;
            declaredClassBand: ClassBand;
            absentDateISO: string;
            toSlotId: string;
        }) => {
            return apiRequest("POST", "/api/admin/book-without-absence", {
                childName: params.childName,
                declaredClassBand: params.declaredClassBand,
                absentDateISO: params.absentDateISO,
                toSlotId: params.toSlotId,
            });
        },
        onSuccess: () => {
            toast({
                title: "振替登録完了",
                description: "欠席連絡なしで振替予約を登録しました。",
            });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/requests"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard-stats"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/daily-status"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/daily-lessons"] });
            queryClient.invalidateQueries({ queryKey: ["/api/search-slots"] });

            setIsDirectBookingDialogOpen(false);
            setDirectChildName("");
            setDirectClassBand("初級");
            setDirectAbsentDateISO(formatJstDate(new Date()));
            setDirectCandidates([]);
            setSelectedDirectSlotId("");
        },
        onError: (error: any) => {
            toast({
                title: "振替登録エラー",
                description: error.message || "振替登録に失敗しました。",
                variant: "destructive",
            });
        },
    });

    const handleCancelAbsence = (absence: EnrichedAbsence) => {
        const reportTypeLabel = absence.reportType === "LATE" ? "遅刻" : "欠席";
        const recoveryHint = absence.reportType === "ABSENCE"
            ? "\n\n※元のレッスン枠の人数が復元されます"
            : "";
        if (confirm(`${absence.childName}さんの${reportTypeLabel}連絡をキャンセルしますか？${recoveryHint}`)) {
            cancelAbsenceMutation.mutate(absence.id);
        }
    };

    const handleCancelRequest = (request: EnrichedRequest) => {
        if (confirm(`${request.childName}さんの振替予約をキャンセルしますか？\n\n※振替先の枠が空きます`)) {
            cancelRequestMutation.mutate(request.id);
        }
    };

    const openAdminBookingDialog = async (absence: EnrichedAbsence) => {
        if (absence.reportType === "LATE") {
            toast({
                title: "登録できません",
                description: "遅刻連絡では振替登録できません。",
                variant: "destructive",
            });
            return;
        }

        if (!isClassBand(absence.declaredClassBand)) {
            toast({
                title: "登録できません",
                description: "クラス帯が不正なため、振替候補を取得できません。",
                variant: "destructive",
            });
            return;
        }

        setBookingTarget(absence);
        setBookingCandidates([]);
        setSelectedBookingSlotId("");
        setIsBookingDialogOpen(true);
        setIsLoadingBookingCandidates(true);

        try {
            const candidates = await apiRequest("POST", "/api/search-slots", {
                childName: absence.childName,
                declaredClassBand: absence.declaredClassBand,
                absentDateISO: formatJstDate(absence.absentDate),
            }) as SlotSearchResult[];

            setBookingCandidates(candidates);
            const firstAvailable = candidates.find((slot) => slot.statusCode !== "×") || candidates[0];
            if (firstAvailable) {
                setSelectedBookingSlotId(firstAvailable.slotId);
            }
        } catch (error: any) {
            toast({
                title: "候補取得エラー",
                description: error.message || "振替候補の取得に失敗しました。",
                variant: "destructive",
            });
        } finally {
            setIsLoadingBookingCandidates(false);
        }
    };

    const handleAdminBook = () => {
        if (!bookingTarget || !selectedBookingSlotId) {
            toast({
                title: "入力エラー",
                description: "振替先の枠を選択してください。",
                variant: "destructive",
            });
            return;
        }

        bookFromAbsenceMutation.mutate({
            absence: bookingTarget,
            toSlotId: selectedBookingSlotId,
        });
    };

    const openDirectBookingDialog = () => {
        setIsDirectBookingDialogOpen(true);
        setDirectChildName("");
        setDirectClassBand("初級");
        setDirectAbsentDateISO(formatJstDate(new Date()));
        setDirectCandidates([]);
        setSelectedDirectSlotId("");
    };

    const loadDirectBookingCandidates = async () => {
        const childName = directChildName.trim();
        if (!childName) {
            toast({
                title: "入力エラー",
                description: "お子様名を入力してください。",
                variant: "destructive",
            });
            return;
        }

        if (!directAbsentDateISO) {
            toast({
                title: "入力エラー",
                description: "欠席日を入力してください。",
                variant: "destructive",
            });
            return;
        }

        setIsLoadingDirectCandidates(true);
        setDirectCandidates([]);
        setSelectedDirectSlotId("");

        try {
            const candidates = await apiRequest("POST", "/api/search-slots", {
                childName,
                declaredClassBand: directClassBand,
                absentDateISO: directAbsentDateISO,
            }) as SlotSearchResult[];

            setDirectCandidates(candidates);
            const firstAvailable = candidates.find((slot) => slot.statusCode !== "×") || candidates[0];
            if (firstAvailable) {
                setSelectedDirectSlotId(firstAvailable.slotId);
            }
        } catch (error: any) {
            toast({
                title: "候補取得エラー",
                description: error.message || "振替候補の取得に失敗しました。",
                variant: "destructive",
            });
        } finally {
            setIsLoadingDirectCandidates(false);
        }
    };

    const handleDirectBook = () => {
        if (!selectedDirectSlotId) {
            toast({
                title: "入力エラー",
                description: "振替先の枠を選択してください。",
                variant: "destructive",
            });
            return;
        }

        const childName = directChildName.trim();
        if (!childName || !directAbsentDateISO) {
            toast({
                title: "入力エラー",
                description: "お子様名と欠席日を入力してください。",
                variant: "destructive",
            });
            return;
        }

        bookWithoutAbsenceMutation.mutate({
            childName,
            declaredClassBand: directClassBand,
            absentDateISO: directAbsentDateISO,
            toSlotId: selectedDirectSlotId,
        });
    };

    const normalizedSearchTerm = searchTerm.trim().toLowerCase();
    const hasSearchTerm = normalizedSearchTerm.length > 0;

    const filteredAbsences = (absences || []).filter((absence) =>
        absence.childName.toLowerCase().includes(normalizedSearchTerm)
    );

    const sortedAbsences = filteredAbsences.slice().sort((a, b) => {
        const aAbsentDate = formatJstDate(a.absentDate);
        const bAbsentDate = formatJstDate(b.absentDate);
        const absentDateCompare = bAbsentDate.localeCompare(aAbsentDate);
        if (absentDateCompare !== 0) {
            return absentDateCompare;
        }

        const createdAtCompare = compareNullableTimestampsDesc(a.createdAt, b.createdAt);
        if (createdAtCompare !== 0) {
            return createdAtCompare;
        }

        return b.id.localeCompare(a.id);
    });

    const filteredRequests = (requests || []).filter((request) =>
        request.childName.toLowerCase().includes(normalizedSearchTerm)
    );

    const sortedRequests = filteredRequests.slice().sort((a, b) => {
        if (!a.toSlotDate && !b.toSlotDate) {
            const createdAtCompare = compareNullableTimestampsDesc(a.createdAt, b.createdAt);
            if (createdAtCompare !== 0) {
                return createdAtCompare;
            }

            return b.id.localeCompare(a.id);
        }
        if (!a.toSlotDate) {
            return 1;
        }
        if (!b.toSlotDate) {
            return -1;
        }

        const slotDateCompare = b.toSlotDate.localeCompare(a.toSlotDate);
        if (slotDateCompare !== 0) {
            return slotDateCompare;
        }

        const aStartTime = a.toSlotStartTime || "";
        const bStartTime = b.toSlotStartTime || "";
        if (aStartTime !== bStartTime) {
            return bStartTime.localeCompare(aStartTime);
        }

        const createdAtCompare = compareNullableTimestampsDesc(a.createdAt, b.createdAt);
        if (createdAtCompare !== 0) {
            return createdAtCompare;
        }

        return b.id.localeCompare(a.id);
    });

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "PENDING":
                return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">振替待ち</Badge>;
            case "MAKEUP_CONFIRMED":
                return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">振替済み</Badge>;
            case "EXPIRED":
            case "CANCELLED":
                return <Badge variant="outline" className="bg-gray-50 text-gray-500 border-gray-300">キャンセル済み</Badge>;
            case "確定":
                return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">確定</Badge>;
            case "キャンセル":
            case "辞退":
            case "却下":
                return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300">キャンセル済み</Badge>;
            default:
                return <Badge variant="outline">{status}</Badge>;
        }
    };

    const renderAbsenceTable = (items: EnrichedAbsence[]) => (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>お子様名</TableHead>
                        <TableHead>クラス</TableHead>
                        <TableHead>区分</TableHead>
                        <TableHead>欠席日</TableHead>
                        <TableHead>レッスン</TableHead>
                        <TableHead>ステータス</TableHead>
                        <TableHead>確認コード</TableHead>
                        <TableHead>理由</TableHead>
                        <TableHead>操作</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {items.map((absence) => (
                        <TableRow key={absence.id}>
                            <TableCell className="font-medium">{absence.childName}</TableCell>
                            <TableCell>{absence.declaredClassBand}</TableCell>
                            <TableCell>{getAbsenceReportTypeBadge(absence.reportType)}</TableCell>
                            <TableCell>{formatJstDay(absence.absentDate)}</TableCell>
                            <TableCell>
                                {absence.courseLabel && absence.startTime
                                    ? `${absence.courseLabel} ${absence.startTime}`
                                    : "-"}
                            </TableCell>
                            <TableCell>
                                {absence.reportType === "LATE"
                                    ? <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">遅刻連絡</Badge>
                                    : getStatusBadge(absence.makeupStatus)}
                            </TableCell>
                            <TableCell className="font-mono text-sm">{absence.confirmCode}</TableCell>
                            <TableCell>{absence.reason?.trim() || "-"}</TableCell>
                            <TableCell>
                                <div className="flex items-center gap-2">
                                    {absence.makeupStatus === "PENDING" && absence.reportType === "ABSENCE" && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => openAdminBookingDialog(absence)}
                                            disabled={bookFromAbsenceMutation.isPending || bookWithoutAbsenceMutation.isPending}
                                        >
                                            振替登録
                                        </Button>
                                    )}
                                    {(absence.makeupStatus === "PENDING" || absence.makeupStatus === "MAKEUP_CONFIRMED") && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleCancelAbsence(absence)}
                                            disabled={cancelAbsenceMutation.isPending}
                                            className="text-destructive hover:text-destructive"
                                        >
                                            <XIcon className="w-4 h-4" />
                                        </Button>
                                    )}
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );

    const renderRequestTable = (items: EnrichedRequest[]) => (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>お子様名</TableHead>
                        <TableHead>クラス</TableHead>
                        <TableHead>欠席日</TableHead>
                        <TableHead>振替先</TableHead>
                        <TableHead>ステータス</TableHead>
                        <TableHead>操作</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {items.map((request) => (
                        <TableRow key={request.id}>
                            <TableCell className="font-medium">{request.childName}</TableCell>
                            <TableCell>{request.declaredClassBand}</TableCell>
                            <TableCell>{formatJstDay(request.absentDate)}</TableCell>
                            <TableCell>
                                {request.toSlotDate && request.toSlotStartTime
                                    ? `${format(parseJstDate(request.toSlotDate), "M/d(E)", { locale: ja })} ${request.toSlotStartTime}`
                                    : "-"}
                            </TableCell>
                            <TableCell>{getStatusBadge(request.status)}</TableCell>
                            <TableCell>
                                {request.status === "確定" && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleCancelRequest(request)}
                                        disabled={cancelRequestMutation.isPending}
                                        className="text-destructive hover:text-destructive"
                                    >
                                        <XIcon className="w-4 h-4" />
                                    </Button>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );

    return (
        <Card className="border-2">
            <CardHeader className="p-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <CardTitle className="text-xl">欠席・振替履歴</CardTitle>
                    <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={openDirectBookingDialog}
                            disabled={bookFromAbsenceMutation.isPending || bookWithoutAbsenceMutation.isPending}
                            data-testid="button-open-direct-booking-dialog"
                        >
                            欠席連絡なしで振替登録
                        </Button>
                        <label className="space-y-1 text-sm font-medium">
                            <span className="block">表示月</span>
                            <Input
                                type="month"
                                value={selectedMonth}
                                onChange={(event) => {
                                    if (event.target.value) {
                                        setSelectedMonth(event.target.value);
                                    }
                                }}
                                className="w-full sm:w-40"
                                data-testid="input-admin-history-month"
                            />
                        </label>
                        <Input
                            placeholder="名前で検索..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full sm:w-64"
                        />
                    </div>
                </div>
                <div className="flex gap-2 mt-4">
                    <Button
                        variant={historyTab === "absences" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setHistoryTab("absences")}
                    >
                        欠席一覧{absences ? ` (${absences.length})` : ""}
                    </Button>
                    <Button
                        variant={historyTab === "requests" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setHistoryTab("requests")}
                    >
                        振替一覧{requests ? ` (${requests.length})` : ""}
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="p-6 pt-0">
                {historyTab === "absences" && (
                    <>
                        {loadingAbsences ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin" />
                            </div>
                        ) : sortedAbsences.length === 0 ? (
                            <p className="text-center text-muted-foreground py-8">
                                {hasSearchTerm ? "該当する欠席・遅刻データがありません" : "選択月の欠席・遅刻データがありません"}
                            </p>
                        ) : (
                            renderAbsenceTable(sortedAbsences)
                        )}
                    </>
                )}

                {historyTab === "requests" && (
                    <>
                        {loadingRequests ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin" />
                            </div>
                        ) : sortedRequests.length === 0 ? (
                            <p className="text-center text-muted-foreground py-8">
                                {hasSearchTerm ? "該当する振替データがありません" : "選択月の振替データがありません"}
                            </p>
                        ) : (
                            renderRequestTable(sortedRequests)
                        )}
                    </>
                )}
            </CardContent>

            <Dialog
                open={isBookingDialogOpen}
                onOpenChange={(open) => {
                    setIsBookingDialogOpen(open);
                    if (!open) {
                        setBookingTarget(null);
                        setBookingCandidates([]);
                        setSelectedBookingSlotId("");
                    }
                }}
            >
                <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>管理者による振替登録</DialogTitle>
                        <DialogDescription>
                            欠席者の振替先を選択して確定します。満員の枠も管理者登録できます。
                        </DialogDescription>
                    </DialogHeader>

                    {bookingTarget && (
                        <div className="space-y-4">
                            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                                <p><span className="text-muted-foreground">お子様名:</span> <span className="font-medium">{bookingTarget.childName}</span></p>
                                <p><span className="text-muted-foreground">クラス帯:</span> <span className="font-medium">{bookingTarget.declaredClassBand}</span></p>
                                <p><span className="text-muted-foreground">欠席日:</span> <span className="font-medium">{format(parseJstDate(formatJstDate(bookingTarget.absentDate)), "yyyy/MM/dd(E)", { locale: ja })}</span></p>
                            </div>

                            {isLoadingBookingCandidates ? (
                                <div className="flex justify-center py-6">
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                </div>
                            ) : bookingCandidates.length === 0 ? (
                                <p className="text-sm text-muted-foreground">振替候補が見つかりませんでした。</p>
                            ) : (
                                <div className="space-y-2">
                                    {bookingCandidates.map((slot) => {
                                        const isOverCapacity = slot.statusCode === "×";
                                        const isSelected = selectedBookingSlotId === slot.slotId;
                                        return (
                                            <button
                                                key={slot.slotId}
                                                type="button"
                                                disabled={bookFromAbsenceMutation.isPending}
                                                onClick={() => setSelectedBookingSlotId(slot.slotId)}
                                                className={`w-full rounded-lg border p-3 text-left transition-colors ${isSelected
                                                    ? "border-primary bg-primary/5"
                                                    : "border-border hover:border-primary/50"
                                                    } ${isOverCapacity ? "border-amber-300 bg-amber-50/50" : ""}`}
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <div>
                                                        <p className="font-medium">
                                                            {format(parseJstDate(slot.date), "M/d(E)", { locale: ja })} {slot.startTime} - {slot.courseLabel}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground mt-1">
                                                            {slot.classBand} / {isOverCapacity ? "満員（管理者登録可）" : slot.statusText}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant={slot.statusCode === "〇" ? "default" : slot.statusCode === "△" ? "secondary" : "outline"}>
                                                            {slot.statusCode}
                                                        </Badge>
                                                        {isSelected && (
                                                            <CheckCircleIcon className="w-4 h-4 text-primary" />
                                                        )}
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            <div className="flex justify-end gap-2 pt-2">
                                <Button
                                    variant="outline"
                                    onClick={() => setIsBookingDialogOpen(false)}
                                    disabled={bookFromAbsenceMutation.isPending}
                                >
                                    閉じる
                                </Button>
                                <Button
                                    onClick={handleAdminBook}
                                    disabled={!selectedBookingSlotId || bookFromAbsenceMutation.isPending}
                                >
                                    {bookFromAbsenceMutation.isPending ? "登録中..." : "この枠で振替登録"}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog
                open={isDirectBookingDialogOpen}
                onOpenChange={(open) => {
                    setIsDirectBookingDialogOpen(open);
                    if (!open) {
                        setDirectCandidates([]);
                        setSelectedDirectSlotId("");
                    }
                }}
            >
                <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>欠席連絡なしで振替登録</DialogTitle>
                        <DialogDescription>
                            欠席連絡が未登録でも、管理者が直接振替予約を登録できます。満員の枠も登録可能です。
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="space-y-2 md:col-span-1">
                                <p className="text-sm font-medium">お子様名</p>
                                <Input
                                    value={directChildName}
                                    onChange={(event) => setDirectChildName(event.target.value)}
                                    placeholder="例: やまだ たろう"
                                    data-testid="input-direct-booking-child-name"
                                />
                            </div>
                            <div className="space-y-2">
                                <p className="text-sm font-medium">クラス帯</p>
                                <Select
                                    value={directClassBand}
                                    onValueChange={(value) => {
                                        if (isClassBand(value)) {
                                            setDirectClassBand(value);
                                        }
                                    }}
                                >
                                    <SelectTrigger data-testid="select-direct-booking-class-band">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="初級">初級</SelectItem>
                                        <SelectItem value="中級">中級</SelectItem>
                                        <SelectItem value="上級">上級</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <p className="text-sm font-medium">欠席日（基準日）</p>
                                <Input
                                    type="date"
                                    value={directAbsentDateISO}
                                    onChange={(event) => setDirectAbsentDateISO(event.target.value)}
                                    data-testid="input-direct-booking-absent-date"
                                />
                            </div>
                        </div>

                        <div className="flex justify-start">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={loadDirectBookingCandidates}
                                disabled={isLoadingDirectCandidates || bookWithoutAbsenceMutation.isPending}
                                data-testid="button-load-direct-booking-candidates"
                            >
                                {isLoadingDirectCandidates ? "候補取得中..." : "候補を検索"}
                            </Button>
                        </div>

                        {isLoadingDirectCandidates ? (
                            <div className="flex justify-center py-6">
                                <Loader2 className="w-6 h-6 animate-spin" />
                            </div>
                        ) : directCandidates.length === 0 ? (
                            <p className="text-sm text-muted-foreground">候補を検索してください。</p>
                        ) : (
                            <div className="space-y-2">
                                {directCandidates.map((slot) => {
                                    const isOverCapacity = slot.statusCode === "×";
                                    const isSelected = selectedDirectSlotId === slot.slotId;
                                    return (
                                        <button
                                            key={slot.slotId}
                                            type="button"
                                            disabled={bookWithoutAbsenceMutation.isPending}
                                            onClick={() => setSelectedDirectSlotId(slot.slotId)}
                                            className={`w-full rounded-lg border p-3 text-left transition-colors ${isSelected
                                                ? "border-primary bg-primary/5"
                                                : "border-border hover:border-primary/50"
                                                } ${isOverCapacity ? "border-amber-300 bg-amber-50/50" : ""}`}
                                            data-testid={`button-direct-booking-slot-${slot.slotId}`}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="font-medium">
                                                        {format(parseJstDate(slot.date), "M/d(E)", { locale: ja })} {slot.startTime} - {slot.courseLabel}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                        {slot.classBand} / {isOverCapacity ? "満員（管理者登録可）" : slot.statusText}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Badge variant={slot.statusCode === "〇" ? "default" : slot.statusCode === "△" ? "secondary" : "outline"}>
                                                        {slot.statusCode}
                                                    </Badge>
                                                    {isSelected && (
                                                        <CheckCircleIcon className="w-4 h-4 text-primary" />
                                                    )}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        <div className="flex justify-end gap-2 pt-2">
                            <Button
                                variant="outline"
                                onClick={() => setIsDirectBookingDialogOpen(false)}
                                disabled={bookWithoutAbsenceMutation.isPending}
                            >
                                閉じる
                            </Button>
                            <Button
                                onClick={handleDirectBook}
                                disabled={!selectedDirectSlotId || bookWithoutAbsenceMutation.isPending}
                                data-testid="button-submit-direct-booking"
                            >
                                {bookWithoutAbsenceMutation.isPending ? "登録中..." : "この枠で振替登録"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

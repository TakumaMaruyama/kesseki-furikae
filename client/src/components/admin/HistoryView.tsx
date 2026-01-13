import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { XIcon, Loader2 } from "lucide-react";
import type { EnrichedAbsence, EnrichedRequest } from "./types";

export function HistoryView() {
    const { toast } = useToast();
    const [historyTab, setHistoryTab] = useState<"absences" | "requests">("absences");
    const [searchTerm, setSearchTerm] = useState("");

    const { data: absences, isLoading: loadingAbsences } = useQuery<EnrichedAbsence[]>({
        queryKey: ["/api/admin/absences"],
    });

    const { data: requests, isLoading: loadingRequests } = useQuery<EnrichedRequest[]>({
        queryKey: ["/api/admin/requests"],
    });

    const cancelAbsenceMutation = useMutation({
        mutationFn: (id: string) => apiRequest("POST", `/api/admin/cancel-absence/${id}`, {}),
        onSuccess: (response: any) => {
            toast({
                title: "キャンセル完了",
                description: response.message || "欠席をキャンセルしました。",
            });
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

    const cancelRequestMutation = useMutation({
        mutationFn: (id: string) => apiRequest("POST", `/api/admin/cancel-request/${id}`, {}),
        onSuccess: (response: any) => {
            toast({
                title: "キャンセル完了",
                description: response.message || "振替をキャンセルしました。",
            });
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

    const handleCancelAbsence = (absence: EnrichedAbsence) => {
        if (confirm(`${absence.childName}さんの欠席連絡をキャンセルしますか？\n\n※元のレッスン枠の人数が復元されます`)) {
            cancelAbsenceMutation.mutate(absence.id);
        }
    };

    const handleCancelRequest = (request: EnrichedRequest) => {
        if (confirm(`${request.childName}さんの振替予約をキャンセルしますか？\n\n※振替先の枠が空きます`)) {
            cancelRequestMutation.mutate(request.id);
        }
    };

    const filteredAbsences = absences?.filter(a =>
        a.childName.toLowerCase().includes(searchTerm.toLowerCase())
    ) || [];

    const filteredRequests = requests?.filter(r =>
        r.childName.toLowerCase().includes(searchTerm.toLowerCase())
    ) || [];

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "PENDING":
                return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">振替待ち</Badge>;
            case "MAKEUP_CONFIRMED":
                return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">振替済み</Badge>;
            case "EXPIRED":
            case "CANCELLED":
                return <Badge variant="outline" className="bg-gray-50 text-gray-500 border-gray-300">キャンセル</Badge>;
            case "確定":
                return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">確定</Badge>;
            case "却下":
                return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300">却下</Badge>;
            default:
                return <Badge variant="outline">{status}</Badge>;
        }
    };

    return (
        <Card className="border-2">
            <CardHeader className="p-6">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-xl">欠席・振替履歴</CardTitle>
                    <Input
                        placeholder="名前で検索..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="max-w-xs"
                    />
                </div>
                <div className="flex gap-2 mt-4">
                    <Button
                        variant={historyTab === "absences" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setHistoryTab("absences")}
                    >
                        欠席一覧 ({absences?.length || 0})
                    </Button>
                    <Button
                        variant={historyTab === "requests" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setHistoryTab("requests")}
                    >
                        振替一覧 ({requests?.length || 0})
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
                        ) : filteredAbsences.length === 0 ? (
                            <p className="text-center text-muted-foreground py-8">欠席データがありません</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>お子様名</TableHead>
                                            <TableHead>クラス</TableHead>
                                            <TableHead>欠席日</TableHead>
                                            <TableHead>レッスン</TableHead>
                                            <TableHead>ステータス</TableHead>
                                            <TableHead>確認コード</TableHead>
                                            <TableHead>操作</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredAbsences.map((absence) => (
                                            <TableRow key={absence.id}>
                                                <TableCell className="font-medium">{absence.childName}</TableCell>
                                                <TableCell>{absence.declaredClassBand}</TableCell>
                                                <TableCell>{format(new Date(absence.absentDate), "M/d(E)", { locale: ja })}</TableCell>
                                                <TableCell>
                                                    {absence.courseLabel && absence.startTime
                                                        ? `${absence.courseLabel} ${absence.startTime}`
                                                        : "-"}
                                                </TableCell>
                                                <TableCell>{getStatusBadge(absence.makeupStatus)}</TableCell>
                                                <TableCell className="font-mono text-sm">{absence.confirmCode}</TableCell>
                                                <TableCell>
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
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </>
                )}

                {historyTab === "requests" && (
                    <>
                        {loadingRequests ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin" />
                            </div>
                        ) : filteredRequests.length === 0 ? (
                            <p className="text-center text-muted-foreground py-8">振替データがありません</p>
                        ) : (
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
                                        {filteredRequests.map((request) => (
                                            <TableRow key={request.id}>
                                                <TableCell className="font-medium">{request.childName}</TableCell>
                                                <TableCell>{request.declaredClassBand}</TableCell>
                                                <TableCell>{format(new Date(request.absentDate), "M/d(E)", { locale: ja })}</TableCell>
                                                <TableCell>
                                                    {request.toSlotDate && request.toSlotStartTime
                                                        ? `${format(new Date(request.toSlotDate), "M/d(E)", { locale: ja })} ${request.toSlotStartTime}`
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
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}

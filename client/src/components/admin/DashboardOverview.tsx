import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { parseJstDate } from "@shared/jst";
import type { DashboardStats } from "./types";

export function DashboardOverview() {
    const { data: stats, isLoading } = useQuery<DashboardStats>({
        queryKey: ["/api/admin/dashboard-stats"],
        refetchInterval: 30000, // Refresh every 30 seconds
    });

    const latestFutureSlotLabel = stats?.latestFutureSlotDate
        ? format(parseJstDate(stats.latestFutureSlotDate), "yyyy年M月d日", { locale: ja })
        : "未登録";
    const slotCoverageNotice = stats?.futureSlots === 0
        ? "今後のレッスン枠がありません"
        : stats?.daysUntilLastFutureSlot !== null && stats?.daysUntilLastFutureSlot !== undefined && stats.daysUntilLastFutureSlot <= 14
            ? `あと${stats.daysUntilLastFutureSlot}日で未来枠が尽きます`
            : "十分な未来枠があります";

    if (isLoading) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 gap-4">
            <Card className="border-2 border-destructive/30">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-destructive">本日の欠席</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-3xl font-bold text-destructive">{stats?.todayAbsences || 0}</p>
                    <p className="text-xs text-muted-foreground mt-1">名</p>
                </CardContent>
            </Card>

            <Card className="border-2 border-primary/30">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-primary">本日の振替</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-3xl font-bold text-primary">{stats?.todayMakeups || 0}</p>
                    <p className="text-xs text-muted-foreground mt-1">名</p>
                </CardContent>
            </Card>

            <Card className={stats?.futureSlots === 0 ? "border-2 border-destructive/30" : "border-2 border-amber-500/30"}>
                <CardHeader className="pb-2">
                    <CardTitle className={stats?.futureSlots === 0 ? "text-sm font-medium text-destructive" : "text-sm font-medium text-amber-700"}>
                        今後の枠
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className={stats?.futureSlots === 0 ? "text-3xl font-bold text-destructive" : "text-3xl font-bold text-amber-700"}>
                        {stats?.futureSlots || 0}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{slotCoverageNotice}</p>
                </CardContent>
            </Card>

            <Card className={stats?.futureSlots === 0 || (stats?.daysUntilLastFutureSlot ?? 999) <= 14 ? "border-2 border-amber-500/30" : "border-2 border-emerald-500/30"}>
                <CardHeader className="pb-2">
                    <CardTitle className={(stats?.futureSlots === 0 || (stats?.daysUntilLastFutureSlot ?? 999) <= 14) ? "text-sm font-medium text-amber-700" : "text-sm font-medium text-emerald-700"}>
                        枠の最終日
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className={(stats?.futureSlots === 0 || (stats?.daysUntilLastFutureSlot ?? 999) <= 14) ? "text-lg font-bold text-amber-700" : "text-lg font-bold text-emerald-700"}>
                        {latestFutureSlotLabel}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                        {stats?.daysUntilLastFutureSlot === null || stats?.daysUntilLastFutureSlot === undefined
                            ? "未来枠を作成してください"
                            : `本日からあと${stats.daysUntilLastFutureSlot}日`}
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { DashboardStats } from "./types";

export function DashboardOverview() {
    const { data: stats, isLoading } = useQuery<DashboardStats>({
        queryKey: ["/api/admin/dashboard-stats"],
        refetchInterval: 30000, // Refresh every 30 seconds
    });

    if (isLoading) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card className="border-2">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">本日のレッスン</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-3xl font-bold">{stats?.todayLessons || 0}</p>
                    <p className="text-xs text-muted-foreground mt-1">件</p>
                </CardContent>
            </Card>

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

            <Card className="border-2 border-amber-500/30">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-amber-600">振替待ち</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-3xl font-bold text-amber-600">{stats?.pendingAbsences || 0}</p>
                    <p className="text-xs text-muted-foreground mt-1">件</p>
                </CardContent>
            </Card>

            <Card className="border-2">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">今後の枠</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-3xl font-bold">{stats?.futureSlots || 0}</p>
                    <p className="text-xs text-muted-foreground mt-1">件</p>
                </CardContent>
            </Card>
        </div>
    );
}

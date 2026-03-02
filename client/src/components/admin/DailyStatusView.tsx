import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Loader2, UserX, UserCheck } from "lucide-react";

interface DailyStatusItem {
    childName: string;
    courseLabel: string;
    classBand: string;
    startTime: string;
}

interface DailyStatusData {
    date: string;
    absentees: DailyStatusItem[];
    makeups: DailyStatusItem[];
}

const CLASS_BAND_ORDER: Record<string, number> = {
    初級: 0,
    中級: 1,
    上級: 2,
};

function getClassBandOrder(classBand: string): number {
    return CLASS_BAND_ORDER[classBand] ?? Number.MAX_SAFE_INTEGER;
}

function groupAndSortByStartTime(items: DailyStatusItem[]) {
    const grouped = items.reduce<Record<string, DailyStatusItem[]>>((acc, item) => {
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

export function DailyStatusView() {
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());

    const dateStr = format(selectedDate, "yyyy-MM-dd");

    const { data, isLoading } = useQuery<DailyStatusData>({
        queryKey: ["/api/admin/daily-status", dateStr],
        queryFn: async () => {
            const res = await fetch(`/api/admin/daily-status?date=${dateStr}`);
            if (!res.ok) throw new Error("Failed to fetch daily status");
            return res.json();
        },
    });

    return (
        <div className="space-y-6">
            <Card className="border-2">
                <CardHeader>
                    <CardTitle className="text-xl">本日の欠席・振替</CardTitle>
                    <p className="text-sm text-muted-foreground">
                        日付を選択して、その日の欠席者と振替者を確認できます
                    </p>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Calendar */}
                        <div className="flex justify-center lg:justify-start">
                            <Calendar
                                mode="single"
                                selected={selectedDate}
                                onSelect={(date) => date && setSelectedDate(date)}
                                className="rounded-md border"
                                locale={ja}
                            />
                        </div>

                        {/* Content */}
                        <div className="lg:col-span-2 space-y-6">
                            <h3 className="text-lg font-bold">
                                {format(selectedDate, "yyyy年M月d日(E)", { locale: ja })}
                            </h3>

                            {isLoading ? (
                                <div className="flex justify-center py-8">
                                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Absences Section */}
                                    <Card className="border-destructive/30">
                                        <CardHeader className="pb-3">
                                            <CardTitle className="text-base flex items-center gap-2 text-destructive">
                                                <UserX className="w-5 h-5" />
                                                欠席者
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

                                    {/* Makeups Section */}
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
                                </div>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

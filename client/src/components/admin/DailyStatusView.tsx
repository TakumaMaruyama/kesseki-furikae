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
                                                    {data?.absentees.map((item, index) => (
                                                        <div
                                                            key={index}
                                                            className="border rounded-lg p-3 bg-destructive/5"
                                                        >
                                                            <p className="font-semibold">{item.childName}</p>
                                                            <p className="text-sm text-muted-foreground">
                                                                {item.startTime} {item.courseLabel} （{item.classBand}）
                                                            </p>
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
                                                    {data?.makeups.map((item, index) => (
                                                        <div
                                                            key={index}
                                                            className="border rounded-lg p-3 bg-primary/5"
                                                        >
                                                            <p className="font-semibold">{item.childName}</p>
                                                            <p className="text-sm text-muted-foreground">
                                                                {item.startTime} {item.courseLabel} （{item.classBand}）
                                                            </p>
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

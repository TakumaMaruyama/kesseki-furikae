import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircleIcon, XCircleIcon, CalendarIcon } from "lucide-react";
import type { LessonWithStatus, LessonStatus } from "./types";

export function LessonsStatusView() {
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

    const dateString = format(selectedDate, 'yyyy-MM-dd');

    const { data: dailyLessons, isLoading: loadingDaily } = useQuery<LessonWithStatus[]>({
        queryKey: ["/api/admin/daily-lessons", dateString],
        queryFn: async () => {
            return await apiRequest("GET", `/api/admin/daily-lessons?date=${dateString}`) as LessonWithStatus[];
        },
    });

    const { data: lessonStatus, isLoading: loadingStatus } = useQuery<LessonStatus>({
        queryKey: ["/api/admin/lesson-status", selectedSlotId],
        enabled: !!selectedSlotId,
        queryFn: async () => {
            return await apiRequest("GET", `/api/admin/lesson-status?slotId=${selectedSlotId}`) as LessonStatus;
        },
    });

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
                <Card className="border-2">
                    <CardHeader className="p-6">
                        <CardTitle className="text-xl">日付を選択</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 pt-0 flex justify-center">
                        <Calendar
                            mode="single"
                            selected={selectedDate}
                            onSelect={(date) => date && setSelectedDate(date)}
                            className="rounded-md border"
                            locale={ja}
                        />
                    </CardContent>
                </Card>

                <Card className="border-2">
                    <CardHeader className="p-6">
                        <CardTitle className="text-lg">
                            {format(selectedDate, "yyyy年M月d日(E)", { locale: ja })} のレッスン
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 pt-0">
                        {loadingDaily && (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                            </div>
                        )}

                        {!loadingDaily && dailyLessons && dailyLessons.length === 0 && (
                            <div className="text-center py-8">
                                <p className="text-muted-foreground">この日のレッスンはありません</p>
                            </div>
                        )}

                        {!loadingDaily && dailyLessons && dailyLessons.length > 0 && (
                            <div className="space-y-2">
                                {dailyLessons.map((lesson) => (
                                    <button
                                        key={lesson.id}
                                        onClick={() => setSelectedSlotId(lesson.id)}
                                        className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${selectedSlotId === lesson.id
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border hover:border-primary/50'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div>
                                                <p className="font-semibold text-lg">{lesson.startTime}</p>
                                                <p className="text-sm text-muted-foreground">{lesson.courseLabel}</p>
                                            </div>
                                            <Badge variant="outline">{lesson.classBand}</Badge>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-xs">
                                            <div className="flex items-center gap-1">
                                                <span className="text-muted-foreground">欠席:</span>
                                                <span className="font-semibold text-destructive">{lesson.absenceCount}</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <span className="text-muted-foreground">振替:</span>
                                                <span className="font-semibold text-primary">{lesson.makeupCount}</span>
                                            </div>

                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <div>
                {selectedSlotId && (
                    <Card className="border-2">
                        <CardHeader className="p-6">
                            <CardTitle className="text-lg">レッスン詳細</CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 pt-0">
                            {loadingStatus && (
                                <div className="flex justify-center py-8">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                                </div>
                            )}

                            {!loadingStatus && lessonStatus && (
                                <div className="space-y-6">
                                    <div className="p-4 bg-muted/50 rounded-lg">
                                        <h3 className="font-semibold mb-2">{lessonStatus.slot.courseLabel}</h3>
                                        <p className="text-sm text-muted-foreground">
                                            {format(new Date(lessonStatus.slot.date), "yyyy年M月d日(E)", { locale: ja })} {lessonStatus.slot.startTime}
                                        </p>
                                        <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                                            <div>
                                                <p className="text-xs text-muted-foreground">定員</p>
                                                <p className="font-semibold">{lessonStatus.slot.capacityLimit}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground">現在</p>
                                                <p className="font-semibold">{lessonStatus.slot.capacityCurrent}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground">振替可能枠（自動計算）</p>
                                                <p className="font-semibold">{lessonStatus.slot.capacityLimit - lessonStatus.slot.capacityCurrent}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {lessonStatus.absences.length > 0 && (
                                        <div>
                                            <h4 className="font-semibold mb-3 text-destructive flex items-center gap-2">
                                                <XCircleIcon className="w-4 h-4" />
                                                欠席者 ({lessonStatus.absences.length}名)
                                            </h4>
                                            <div className="space-y-2">
                                                {lessonStatus.absences.map((absence) => (
                                                    <div key={absence.id} className="p-3 border rounded-lg">
                                                        <p className="font-medium">{absence.childName}</p>
                                                        <p className="text-xs text-muted-foreground">{absence.contactEmail}</p>
                                                        <Badge variant="outline" className="mt-1 text-xs">
                                                            {absence.makeupStatus === 'MAKEUP_CONFIRMED' ? '振替済み' : '振替待ち'}
                                                        </Badge>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {lessonStatus.makeupRequests.length > 0 && (
                                        <div>
                                            <h4 className="font-semibold mb-3 text-primary flex items-center gap-2">
                                                <CheckCircleIcon className="w-4 h-4" />
                                                振替参加者 ({lessonStatus.makeupRequests.length}名)
                                            </h4>
                                            <div className="space-y-2">
                                                {lessonStatus.makeupRequests.map((request) => (
                                                    <div key={request.id} className="p-3 border rounded-lg">
                                                        <p className="font-medium">{request.childName}</p>
                                                        <p className="text-xs text-muted-foreground">
                                                            欠席日: {format(new Date(request.absentDate), "M月d日", { locale: ja })}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}


                                    {lessonStatus.absences.length === 0 &&
                                        lessonStatus.makeupRequests.length === 0 && (
                                            <div className="text-center py-8">
                                                <p className="text-muted-foreground">欠席・振替はありません</p>
                                            </div>
                                        )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {!selectedSlotId && (
                    <Card className="border-2">
                        <CardContent className="p-12 text-center">
                            <CalendarIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                            <p className="text-muted-foreground">左側からレッスンを選択してください</p>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}

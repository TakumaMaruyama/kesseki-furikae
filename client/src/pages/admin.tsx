import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CheckCircleIcon, ClockIcon, XCircleIcon, ListIcon, CalendarIcon, XIcon, InfoIcon, PlusIcon, PencilIcon, TrashIcon, BookOpenIcon, LockIcon, LogOutIcon, Loader2 } from "lucide-react";
import { Link } from "wouter";
import type { Request, ClassSlot, Course } from "@shared/schema";
import { Calendar } from "@/components/ui/calendar";
import { createCourseRequestSchema, updateCourseRequestSchema } from "@shared/schema";

const adminLoginSchema = z.object({
  password: z.string().min(1, "パスワードを入力してください"),
});

const courseFormSchema = createCourseRequestSchema.extend({
  startHour: z.string().min(1, "時間を選択してください"),
  startMinute: z.string().min(1, "分を選択してください"),
});

function AdminLoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: { password: "" },
  });

  const onSubmit = async (data: { password: string }) => {
    setIsLoading(true);
    try {
      const response = await apiRequest("POST", "/api/admin/login", data);
      if (response.success) {
        onSuccess();
      }
    } catch (error: any) {
      toast({
        title: "認証エラー",
        description: error.message || "パスワードが正しくありません",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-2">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
            <LockIcon className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">管理者ログイン</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            管理画面にアクセスするにはパスワードを入力してください
          </p>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>パスワード</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        placeholder="管理者パスワード"
                        data-testid="input-admin-password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
                data-testid="button-admin-login"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ログイン中...
                  </>
                ) : (
                  "ログイン"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

type LessonWithStatus = ClassSlot & {
  absenceCount: number;
  makeupCount: number;
};

type LessonStatus = {
  slot: ClassSlot;
  absences: any[];
  makeupRequests: any[];
};

const DAY_OPTIONS = ["月曜", "火曜", "水曜", "木曜", "金曜", "土曜", "日曜"];
const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => String(9 + i).padStart(2, '0'));
const MINUTE_OPTIONS = ["00", "30"];

function CoursesManagement() {
  const { toast } = useToast();
  const [showCourseDialog, setShowCourseDialog] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);

  const { data: courses, isLoading } = useQuery<Course[]>({
    queryKey: ["/api/admin/courses"],
  });

  const createCourseMutation = useMutation({
    mutationFn: (data: { name: string; dayOfWeek: string; startTime: string }) =>
      apiRequest("POST", "/api/admin/courses", data),
    onSuccess: () => {
      toast({ title: "作成完了", description: "コースを作成しました。" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/courses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      setShowCourseDialog(false);
      setEditingCourse(null);
    },
    onError: (error: any) => {
      toast({ title: "エラー", description: error.message || "作成に失敗しました。", variant: "destructive" });
    },
  });

  const updateCourseMutation = useMutation({
    mutationFn: (data: { id: string; name?: string; dayOfWeek?: string; startTime?: string; isActive?: boolean }) =>
      apiRequest("PUT", `/api/admin/courses/${data.id}`, data),
    onSuccess: () => {
      toast({ title: "更新完了", description: "コースを更新しました。" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/courses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      setShowCourseDialog(false);
      setEditingCourse(null);
    },
    onError: (error: any) => {
      toast({ title: "エラー", description: error.message || "更新に失敗しました。", variant: "destructive" });
    },
  });

  const deleteCourseMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/courses/${id}`),
    onSuccess: () => {
      toast({ title: "削除完了", description: "コースを削除しました。" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/courses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
    },
    onError: (error: any) => {
      toast({ title: "エラー", description: error.message || "削除に失敗しました。", variant: "destructive" });
    },
  });

  const handleDelete = (course: Course) => {
    if (confirm(`「${course.name}」を削除しますか？\n\nこのコースに登録されている子どもの設定からもコースが解除されます。`)) {
      deleteCourseMutation.mutate(course.id);
    }
  };

  const handleToggleActive = (course: Course) => {
    updateCourseMutation.mutate({
      id: course.id,
      isActive: !course.isActive,
    });
  };

  return (
    <Card className="border-2">
      <CardHeader className="p-6 flex-row items-center justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-xl flex items-center gap-2">
            <BookOpenIcon className="w-5 h-5" />
            コース管理
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            保護者が子どもの通常コースとして選択できるレッスン枠を管理します
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingCourse(null);
            setShowCourseDialog(true);
          }}
          data-testid="button-add-course"
        >
          <PlusIcon className="w-4 h-4 mr-2" />
          コース追加
        </Button>
      </CardHeader>
      <CardContent className="p-6 pt-0">
        {isLoading && (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        )}

        {!isLoading && courses && courses.length === 0 && (
          <div className="text-center py-12">
            <BookOpenIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">コースがまだ登録されていません</p>
            <Button
              onClick={() => {
                setEditingCourse(null);
                setShowCourseDialog(true);
              }}
              variant="outline"
              data-testid="button-add-course-empty"
            >
              <PlusIcon className="w-4 h-4 mr-2" />
              最初のコースを追加
            </Button>
          </div>
        )}

        {!isLoading && courses && courses.length > 0 && (
          <div className="space-y-3">
            {courses.map((course) => (
              <div
                key={course.id}
                className={`p-4 border-2 rounded-lg ${course.isActive ? 'bg-background' : 'bg-muted/50 opacity-60'}`}
                data-testid={`card-course-${course.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="font-semibold text-lg" data-testid={`text-course-name-${course.id}`}>
                        {course.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" data-testid={`badge-course-day-${course.id}`}>
                          {course.dayOfWeek}
                        </Badge>
                        <Badge variant="secondary" data-testid={`badge-course-time-${course.id}`}>
                          {course.startTime}
                        </Badge>
                        {!course.isActive && (
                          <Badge variant="destructive">非アクティブ</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleActive(course)}
                      data-testid={`button-toggle-course-${course.id}`}
                    >
                      {course.isActive ? '無効化' : '有効化'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingCourse(course);
                        setShowCourseDialog(true);
                      }}
                      data-testid={`button-edit-course-${course.id}`}
                    >
                      <PencilIcon className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(course)}
                      data-testid={`button-delete-course-${course.id}`}
                    >
                      <TrashIcon className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <CourseDialog
        course={editingCourse}
        open={showCourseDialog}
        onOpenChange={setShowCourseDialog}
        onSave={(data) => {
          if (editingCourse) {
            updateCourseMutation.mutate({ id: editingCourse.id, ...data });
          } else {
            createCourseMutation.mutate(data);
          }
        }}
      />
    </Card>
  );
}

type CourseDialogProps = {
  course: Course | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: { name: string; dayOfWeek: string; startTime: string }) => void;
};

function CourseDialog({ course, open, onOpenChange, onSave }: CourseDialogProps) {
  const form = useForm({
    resolver: zodResolver(courseFormSchema),
    defaultValues: {
      name: course?.name || "",
      dayOfWeek: course?.dayOfWeek || "",
      startTime: course?.startTime || "",
      startHour: course?.startTime?.split(":")[0] || "09",
      startMinute: course?.startTime?.split(":")[1] || "00",
    },
  });

  const startHour = form.watch("startHour");
  const startMinute = form.watch("startMinute");

  useEffect(() => {
    if (course) {
      const hour = course.startTime.split(":")[0];
      const minute = course.startTime.split(":")[1];
      form.reset({
        name: course.name,
        dayOfWeek: course.dayOfWeek,
        startTime: course.startTime,
        startHour: hour,
        startMinute: minute,
      });
    } else {
      form.reset({ name: "", dayOfWeek: "", startTime: "", startHour: "09", startMinute: "00" });
    }
  }, [course, form]);

  useEffect(() => {
    if (startHour && startMinute) {
      const combinedTime = `${startHour}:${startMinute}`;
      form.setValue("startTime", combinedTime);
    }
  }, [startHour, startMinute, form]);

  const onSubmit = (data: { name: string; dayOfWeek: string; startTime: string }) => {
    onSave(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{course ? "コースを編集" : "新しいコースを追加"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>コース名</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="例: 月曜16時クラス"
                      data-testid="input-course-name"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="dayOfWeek"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>曜日</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-course-day">
                        <SelectValue placeholder="曜日を選択" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {DAY_OPTIONS.map((day) => (
                        <SelectItem key={day} value={day}>
                          {day}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startHour"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>時間</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-course-hour">
                          <SelectValue placeholder="時を選択" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {HOUR_OPTIONS.map((hour) => (
                          <SelectItem key={hour} value={hour}>
                            {hour}時
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="startMinute"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>分</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-course-minute">
                          <SelectValue placeholder="分を選択" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MINUTE_OPTIONS.map((minute) => (
                          <SelectItem key={minute} value={minute}>
                            {minute}分
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel-course"
              >
                キャンセル
              </Button>
              <Button type="submit" data-testid="button-save-course">
                {course ? "更新" : "作成"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function LessonsStatusView() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const { toast } = useToast();

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

  const { data: confirmedRequests, isLoading: loadingConfirmed } = useQuery<Request[]>({
    queryKey: ["/api/admin/confirmed"],
    enabled: isAuthenticated === true,
  });

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

  const handleEditSlot = (slotId: string, slot: ClassSlot) => {
    const newEditingSlots = new Set(editingSlots);
    newEditingSlots.add(slotId);
    setEditingSlots(newEditingSlots);

    // waitingDataから最新のslot情報を必ず取得（古いデータの混在を防ぐ）
    let latestSlot = slot;
    if (waitingData) {
      const latestWaitingItem = waitingData.find(item => item.slotId === slotId);
      if (latestWaitingItem) {
        latestSlot = latestWaitingItem.slot;
      }
    }

    // 前の編集値を完全にクリアしてから、新しい値をセット
    setTimeout(() => {
      setCapacityValues({
        [slotId]: {
          capacityLimit: latestSlot.capacityLimit,
          capacityCurrent: latestSlot.capacityCurrent,
          capacityMakeupUsed: latestSlot.capacityMakeupUsed,
        },
      });
    }, 0);
  };

  const handleSaveCapacity = (slotId: string) => {
    const values = capacityValues[slotId];
    if (!values) return;

    const limit = parseInt(values.capacityLimit, 10);
    const current = parseInt(values.capacityCurrent, 10);
    const used = parseInt(values.capacityMakeupUsed, 10);

    if (isNaN(limit) || isNaN(current) || isNaN(used)) {
      toast({
        title: "入力エラー",
        description: "正しい数値を入力してください。",
        variant: "destructive",
      });
      return;
    }

    console.log("保存値:", { slotId, capacityLimit: limit, capacityCurrent: current, capacityMakeupUsed: used });

    updateCapacityMutation.mutate({
      slotId,
      capacityLimit: limit,
      capacityCurrent: current,
      capacityMakeupUsed: used,
    });
  };

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

  const handleCancelRequest = (requestId: string) => {
    if (confirm("このリクエストをキャンセルしますか？")) {
      cancelRequestMutation.mutate(requestId);
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
        <Tabs defaultValue="confirmed" className="w-full">
          <TabsList className="grid w-full max-w-5xl grid-cols-5 h-12">
            <TabsTrigger value="confirmed" data-testid="tab-confirmed" className="text-base">
              確定一覧
            </TabsTrigger>
            <TabsTrigger value="waiting" data-testid="tab-waiting" className="text-base">
              待ち一覧
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
          </TabsList>

          <TabsContent value="confirmed" className="mt-6">
            <Card className="border-2">
              <CardHeader className="p-6 flex-row items-center justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-xl">確定済み振替リクエスト</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    既存管理システムへの手入力用データ
                  </p>
                </div>
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
              </CardHeader>
              <CardContent className="p-6 pt-0">
                {loadingConfirmed && (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                )}

                {!loadingConfirmed && confirmedRequests && confirmedRequests.length === 0 && (
                  <div className="text-center py-12">
                    <CheckCircleIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-muted-foreground">確定済みのリクエストはありません</p>
                  </div>
                )}

                {!loadingConfirmed && confirmedRequests && confirmedRequests.length > 0 && viewMode === "calendar" && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="flex justify-center">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={setSelectedDate}
                        className="rounded-md border"
                        locale={ja}
                        modifiers={{
                          hasRequests: confirmedRequests.map(req => new Date(req.toSlotStartDateTime)),
                        }}
                        modifiersStyles={{
                          hasRequests: {
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

                        const dayRequests = confirmedRequests.filter(req => {
                          const reqDate = new Date(req.toSlotStartDateTime);
                          return reqDate.getFullYear() === selectedYear &&
                            reqDate.getMonth() === selectedMonth &&
                            reqDate.getDate() === selectedDay;
                        });

                        if (dayRequests.length === 0) {
                          return (
                            <div className="text-center py-12">
                              <p className="text-muted-foreground">
                                {format(selectedDate, "M月d日(E)", { locale: ja })}の確定リクエストはありません
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
                              {dayRequests
                                .sort((a, b) => new Date(a.toSlotStartDateTime).getTime() - new Date(b.toSlotStartDateTime).getTime())
                                .map((req) => (
                                  <div
                                    key={req.id}
                                    className="border-2 rounded-lg p-4 hover:bg-muted/30 transition-colors"
                                    data-testid={`row-confirmed-${req.id}`}
                                  >
                                    <div className="space-y-2">
                                      <div className="flex items-center gap-2">
                                        <p className="font-semibold text-lg">
                                          {format(new Date(req.toSlotStartDateTime), "HH:mm", { locale: ja })}
                                        </p>
                                        <Badge variant="outline">{req.declaredClassBand}</Badge>
                                      </div>
                                      <div className="grid grid-cols-2 gap-2 text-sm">
                                        <div>
                                          <span className="text-muted-foreground">お子様名: </span>
                                          <span className="font-semibold">{req.childName}</span>
                                        </div>
                                        <div>
                                          <span className="text-muted-foreground">欠席日: </span>
                                          <span className="font-semibold">
                                            {format(new Date(req.absentDate), "M/d", { locale: ja })}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        申込: {format(new Date(req.createdAt), "M/d HH:mm", { locale: ja })}
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

                {!loadingConfirmed && confirmedRequests && confirmedRequests.length > 0 && viewMode === "list" && (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="font-semibold">お子様名</TableHead>
                          <TableHead className="font-semibold">クラス帯</TableHead>
                          <TableHead className="font-semibold">欠席日</TableHead>
                          <TableHead className="font-semibold">振替先</TableHead>
                          <TableHead className="font-semibold">振替日時</TableHead>
                          <TableHead className="font-semibold">申込日時</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {confirmedRequests.map((req) => (
                          <TableRow key={req.id} data-testid={`row-confirmed-${req.id}`}>
                            <TableCell className="font-medium">{req.childName}</TableCell>
                            <TableCell>{req.declaredClassBand}</TableCell>
                            <TableCell>
                              {format(new Date(req.absentDate), "yyyy/M/d", { locale: ja })}
                            </TableCell>
                            <TableCell className="text-sm">{req.toSlotId}</TableCell>
                            <TableCell>
                              {format(new Date(req.toSlotStartDateTime), "M/d(E) HH:mm", { locale: ja })}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {format(new Date(req.createdAt), "M/d HH:mm", { locale: ja })}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="waiting" className="mt-6">
            {!loadingWaiting && waitingData && waitingData.length > 0 && (
              <Card className="border-2 mb-6">
                <CardHeader className="p-6 flex-row items-center justify-between gap-4 space-y-0">
                  <CardTitle className="text-xl">待ちリスト一覧</CardTitle>
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
                </CardHeader>
              </Card>
            )}

            {loadingWaiting && (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            )}

            {!loadingWaiting && waitingData && waitingData.length === 0 && (
              <Card className="border-2">
                <CardContent className="p-12 text-center">
                  <ClockIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg text-muted-foreground">待ちリストはありません</p>
                </CardContent>
              </Card>
            )}

            {!loadingWaiting && waitingData && waitingData.length > 0 && viewMode === "calendar" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="flex justify-center">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    className="rounded-md border"
                    locale={ja}
                    modifiers={{
                      hasWaiting: waitingData.map(item => new Date(item.slot.date)),
                    }}
                    modifiersStyles={{
                      hasWaiting: {
                        fontWeight: 'bold',
                        backgroundColor: 'hsl(var(--warning) / 0.1)',
                        color: 'hsl(var(--warning))',
                      },
                    }}
                  />
                </div>
                <div className="space-y-4">
                  {selectedDate && (() => {
                    const selectedYear = selectedDate.getFullYear();
                    const selectedMonth = selectedDate.getMonth();
                    const selectedDay = selectedDate.getDate();

                    const dayWaitingData = waitingData.filter(item => {
                      const slotDate = new Date(item.slot.date);
                      return slotDate.getFullYear() === selectedYear &&
                        slotDate.getMonth() === selectedMonth &&
                        slotDate.getDate() === selectedDay;
                    });

                    if (dayWaitingData.length === 0) {
                      return (
                        <div className="text-center py-12">
                          <p className="text-muted-foreground">
                            {format(selectedDate, "M月d日(E)", { locale: ja })}の待ちリストはありません
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
                          {dayWaitingData
                            .sort((a, b) => a.slot.startTime.localeCompare(b.slot.startTime))
                            .map((item) => (
                              <Card key={item.slotId} className="border-2" data-testid={`card-waiting-${item.slotId}`}>
                                <CardHeader className="p-4 pb-3">
                                  <div className="flex items-start justify-between gap-4">
                                    <div>
                                      <CardTitle className="text-base mb-1">
                                        {item.slot.courseLabel} - {item.slot.classBand}
                                      </CardTitle>
                                      <p className="text-sm text-muted-foreground">
                                        {item.slot.startTime}
                                      </p>
                                    </div>
                                    <Badge className="text-sm px-3 py-1">
                                      待ち {item.requests.length} 名
                                    </Badge>
                                  </div>
                                </CardHeader>
                                <CardContent className="p-4 pt-0 space-y-3">
                                  <div className="grid grid-cols-3 gap-2 p-3 bg-muted/50 rounded-lg text-sm">
                                    <div>
                                      <p className="text-xs text-muted-foreground mb-1">振替可能枠（自動計算）</p>
                                      <p className="font-semibold">{item.slot.capacityLimit - item.slot.capacityCurrent}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-muted-foreground mb-1">使用済み</p>
                                      <p className="font-semibold">{item.slot.capacityMakeupUsed}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-muted-foreground mb-1">残り</p>
                                      <p className="font-semibold">
                                        {(item.slot.capacityLimit - item.slot.capacityCurrent) - item.slot.capacityMakeupUsed}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="space-y-2">
                                    {item.requests.slice(0, 3).map((req, index) => (
                                      <div
                                        key={req.id}
                                        className="flex items-center gap-2 text-sm"
                                      >
                                        <Badge variant="outline" className="text-xs">
                                          {index + 1}番目
                                        </Badge>
                                        <span className="font-medium">{req.childName}</span>
                                      </div>
                                    ))}
                                    {item.requests.length > 3 && (
                                      <p className="text-xs text-muted-foreground">
                                        他 {item.requests.length - 3} 名
                                      </p>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {!loadingWaiting && waitingData && waitingData.length > 0 && viewMode === "list" && (
              <div className="space-y-6">
                {waitingData.map((item) => (
                  <Card key={item.slotId} className="border-2" data-testid={`card-waiting-${item.slotId}`}>
                    <CardHeader className="p-6 pb-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <CardTitle className="text-lg mb-2">
                            {item.slot.courseLabel} - {item.slot.classBand}
                          </CardTitle>
                          <p className="text-base text-muted-foreground">
                            {format(new Date(item.slot.lessonStartDateTime), "yyyy年M月d日(E) HH:mm", { locale: ja })}
                          </p>
                        </div>
                        <Badge className="text-sm px-3 py-1">
                          待ち {item.requests.length} 名
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="p-6 pt-0 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
                        {editingSlots.has(item.slotId) ? (
                          <>
                            <div>
                              <Label className="text-xs mb-1 block">定員</Label>
                              <Input
                                type="number"
                                value={capacityValues[item.slotId]?.capacityLimit ?? ''}
                                onChange={(e) =>
                                  setCapacityValues({
                                    ...capacityValues,
                                    [item.slotId]: {
                                      ...capacityValues[item.slotId],
                                      capacityLimit: e.target.value,
                                    },
                                  })
                                }
                                className="h-10"
                              />
                            </div>
                            <div>
                              <Label className="text-xs mb-1 block">現在の参加者数</Label>
                              <Input
                                type="number"
                                value={capacityValues[item.slotId]?.capacityCurrent ?? ''}
                                onChange={(e) =>
                                  setCapacityValues({
                                    ...capacityValues,
                                    [item.slotId]: {
                                      ...capacityValues[item.slotId],
                                      capacityCurrent: e.target.value,
                                    },
                                  })
                                }
                                className="h-10"
                              />
                            </div>
                            <div>
                              <Label className="text-xs mb-1 block">使用済み枠数</Label>
                              <Input
                                type="number"
                                value={capacityValues[item.slotId]?.capacityMakeupUsed ?? ''}
                                onChange={(e) =>
                                  setCapacityValues({
                                    ...capacityValues,
                                    [item.slotId]: {
                                      ...capacityValues[item.slotId],
                                      capacityMakeupUsed: e.target.value,
                                    },
                                  })
                                }
                                className="h-10"
                              />
                            </div>
                            <div className="flex items-end gap-2">
                              <Button
                                onClick={() => handleSaveCapacity(item.slotId)}
                                size="sm"
                                data-testid={`button-save-${item.slotId}`}
                              >
                                保存
                              </Button>
                              <Button
                                onClick={() => {
                                  const newEditingSlots = new Set(editingSlots);
                                  newEditingSlots.delete(item.slotId);
                                  setEditingSlots(newEditingSlots);
                                  const newCapacityValues = { ...capacityValues };
                                  delete newCapacityValues[item.slotId];
                                  setCapacityValues(newCapacityValues);
                                }}
                                size="sm"
                                variant="outline"
                              >
                                キャンセル
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">振替可能枠（自動計算）</p>
                              <p className="text-base font-semibold">{item.slot.capacityLimit - item.slot.capacityCurrent}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">使用済み枠数</p>
                              <p className="text-base font-semibold">{item.slot.capacityMakeupUsed}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">残り枠数</p>
                              <p className="text-base font-semibold">
                                {(item.slot.capacityLimit - item.slot.capacityCurrent) - item.slot.capacityMakeupUsed}
                              </p>
                            </div>
                          </>
                        )}
                      </div>

                      {!editingSlots.has(item.slotId) && (
                        <div className="flex gap-2">
                          <Button
                            onClick={() => handleEditSlot(item.slotId, item.slot)}
                            variant="outline"
                            size="sm"
                            data-testid={`button-edit-${item.slotId}`}
                          >
                            容量を編集
                          </Button>
                          <Button
                            onClick={() => handleCloseWaitlist(item.slotId)}
                            variant="outline"
                            size="sm"
                            data-testid={`button-close-${item.slotId}`}
                          >
                            1時間前クローズ
                          </Button>
                        </div>
                      )}

                      <div className="border-t pt-4">
                        <h4 className="text-sm font-semibold mb-3">待ちリスト（順番順）</h4>
                        <div className="space-y-2">
                          {item.requests.map((req, index) => (
                            <div
                              key={req.id}
                              className="flex items-center justify-between p-3 bg-card border rounded-lg"
                              data-testid={`row-waiting-request-${req.id}`}
                            >
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">
                                  {index + 1}番目
                                </Badge>
                                <div>
                                  <p className="font-medium">{req.childName}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {req.contactEmail}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <p className="text-xs text-muted-foreground">
                                  {format(new Date(req.createdAt), "M/d HH:mm", { locale: ja })}
                                </p>
                                <Button
                                  onClick={() => handleCancelRequest(req.id)}
                                  variant="ghost"
                                  size="sm"
                                  data-testid={`button-cancel-waiting-${req.id}`}
                                >
                                  <XIcon className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="lessons" className="mt-6">
            <LessonsStatusView />
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
                <p className="font-semibold mb-1">🔄 自動振替確定</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                  <li>順番待ちに登録されている方に空きが出ると自動的に振替が確定します</li>
                  <li>確定時に保護者へメール通知が送信されます</li>
                  <li>辞退があった場合は次の順番待ちの方に自動案内されます</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold mb-1">⏰ レッスン1時間前の自動処理</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                  <li>30分ごとにシステムが自動チェックを実行します</li>
                  <li>レッスン開始1時間前になると順番待ちリストが自動クローズされます</li>
                  <li>間に合わなかった順番待ちの方にはお知らせメールが送信されます</li>
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
                <p className="text-muted-foreground ml-4">メールのリンクから振替可能な枠を検索し、空きがあれば予約、満席なら順番待ちに登録</p>

                <p className="font-semibold">4️⃣ 自動確定</p>
                <p className="text-muted-foreground ml-4">順番待ちの場合、空きが出ると自動的に振替が確定しメール通知が届く</p>
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

type SlotDialogProps = {
  slot: ClassSlot | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: any) => void;
};

function SlotDialog({ slot, open, onOpenChange, onSave }: SlotDialogProps) {
  const [classBandCapacities, setClassBandCapacities] = useState<Record<string, any>>({});
  const { data: courses = [] } = useQuery<Course[]>({
    queryKey: ["/api/admin/courses"],
  });

  const form = useForm({
    resolver: zodResolver(
      z.object({
        courseId: z.string().optional(),
        date: z.string().min(1, "日付を選択してください"),
        startTime: z.string().min(1, "開始時刻を入力してください"),
        courseLabel: z.string().min(1, "コース名を入力してください"),
        classBands: z.array(z.enum(["初級", "中級", "上級"])).min(1, "少なくとも1つのクラス帯を選択してください"),
        isRecurring: z.boolean().optional(),
        recurringWeeks: z.number().min(1).max(52).optional(),
        applyToFuture: z.boolean().optional(),
      })
    ),
    defaultValues: slot
      ? {
        courseId: "",
        date: new Date(slot.date).toISOString().split("T")[0],
        startTime: slot.startTime,
        courseLabel: slot.courseLabel,
        classBands: [slot.classBand],
        isRecurring: false,
        recurringWeeks: 12,
        applyToFuture: false,
      }
      : {
        courseId: "",
        date: "",
        startTime: "10:00",
        courseLabel: "",
        classBands: [],
        isRecurring: false,
        recurringWeeks: 12,
        applyToFuture: false,
      },
  });

  const handleCourseSelect = (courseId: string) => {
    const selected = courses.find(c => c.id === courseId);
    if (selected) {
      form.setValue("courseId", courseId);
      form.setValue("courseLabel", selected.name);
      form.setValue("startTime", selected.startTime);
    }
  };

  // 編集時の初期値設定
  useEffect(() => {
    if (slot) {
      const initialCapacities = {
        [slot.classBand]: {
          capacityLimit: slot.capacityLimit,
          capacityCurrent: slot.capacityCurrent,
        }
      };
      setClassBandCapacities(initialCapacities);
      form.reset({
        date: new Date(slot.date).toISOString().split("T")[0],
        startTime: slot.startTime,
        courseLabel: slot.courseLabel,
        classBands: [slot.classBand],
        isRecurring: false,
        recurringWeeks: 12,
        applyToFuture: false,
      });
    } else {
      setClassBandCapacities({});
      form.reset({
        date: "",
        startTime: "10:00",
        courseLabel: "",
        classBands: [],
        isRecurring: false,
        recurringWeeks: 12,
        applyToFuture: false,
      });
    }
  }, [slot, open]);

  const selectedBands = form.watch("classBands") || [];

  // クラス帯が選択されたときにデフォルト値を設定
  const handleClassBandChange = (band: string, checked: boolean) => {
    if (checked && !classBandCapacities[band]) {
      const defaultLimit = 10;
      const defaultCurrent = 0;
      setClassBandCapacities({
        ...classBandCapacities,
        [band]: {
          capacityLimit: defaultLimit,
          capacityCurrent: defaultCurrent,
        }
      });
    }
  };

  const handleSubmit = (data: any) => {
    // クラス帯ごとの設定を含めて送信
    onSave({
      ...data,
      classBandCapacities,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {slot ? "枠を編集" : "新しい枠を作成"}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {!slot && courses.length > 0 && (
              <FormField
                control={form.control}
                name="courseId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>登録済みコースから選択（省略可）</FormLabel>
                    <Select onValueChange={handleCourseSelect} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger data-testid="select-slot-course">
                          <SelectValue placeholder="コースを選択すると自動入力されます" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {courses.map((course) => (
                          <SelectItem key={course.id} value={course.id}>
                            {course.name} ({course.dayOfWeek} {course.startTime})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>日付</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" data-testid="input-slot-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="startTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>開始時刻</FormLabel>
                    <FormControl>
                      <Input {...field} type="time" data-testid="input-slot-time" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="courseLabel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>コース名</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="例：月曜10時コース"
                      data-testid="input-slot-courselabel"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="classBands"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{slot ? "クラス帯" : "クラス帯（複数選択可）"}</FormLabel>
                  {slot && (
                    <p className="text-xs text-muted-foreground mb-2">
                      ※編集モードではクラス帯の変更はできません
                    </p>
                  )}
                  <div className="space-y-2">
                    {["初級", "中級", "上級"].map((band) => (
                      <div key={band} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id={`band-${band}`}
                          checked={field.value?.includes(band as any)}
                          disabled={!!slot}
                          onChange={(e) => {
                            const currentValue = field.value || [];
                            if (e.target.checked) {
                              field.onChange([...currentValue, band]);
                              handleClassBandChange(band, true);
                            } else {
                              field.onChange(currentValue.filter((v: string) => v !== band));
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300"
                          data-testid={`checkbox-band-${band}`}
                        />
                        <label htmlFor={`band-${band}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                          {band}
                        </label>
                      </div>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedBands.length > 0 && (
              <div className="space-y-4 border-t pt-4">
                <h3 className="font-semibold text-sm">各クラス帯の定員設定</h3>
                {selectedBands.map((band) => (
                  <div key={band} className="border rounded-lg p-4 space-y-3">
                    <h4 className="font-medium text-sm">{band}</h4>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs mb-1 block">定員</Label>
                        <Input
                          type="number"
                          value={classBandCapacities[band]?.capacityLimit ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            const newLimit = value === '' ? 0 : parseInt(value);
                            const current = classBandCapacities[band]?.capacityCurrent ?? 0;
                            setClassBandCapacities(prev => ({
                              ...prev,
                              [band]: {
                                capacityLimit: newLimit,
                                capacityCurrent: current,
                              },
                            }));
                          }}
                          data-testid={`input-${band}-capacitylimit`}
                          className="h-9"
                        />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">現在の参加者数</Label>
                        <Input
                          type="number"
                          value={classBandCapacities[band]?.capacityCurrent ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            const newCurrent = value === '' ? 0 : parseInt(value);
                            const limit = classBandCapacities[band]?.capacityLimit ?? 0;
                            setClassBandCapacities(prev => ({
                              ...prev,
                              [band]: {
                                capacityLimit: limit,
                                capacityCurrent: newCurrent,
                              },
                            }));
                          }}
                          data-testid={`input-${band}-capacitycurrent`}
                          className="h-9"
                        />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">振替可能枠（自動計算）</Label>
                        <Input
                          type="number"
                          value={Math.max(0, (classBandCapacities[band]?.capacityLimit ?? 0) - (classBandCapacities[band]?.capacityCurrent ?? 0))}
                          disabled
                          data-testid={`input-${band}-capacitymakeupallowed`}
                          className="h-9 bg-muted"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          定員 - 現在の参加者数
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!slot && (
              <div className="border-t pt-4 mt-2">
                <FormField
                  control={form.control}
                  name="isRecurring"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <input
                          type="checkbox"
                          checked={field.value}
                          onChange={field.onChange}
                          className="mt-1"
                          data-testid="checkbox-recurring"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="font-semibold">
                          毎週繰り返し作成
                        </FormLabel>
                        <p className="text-sm text-muted-foreground">
                          この枠を毎週同じ曜日・時間に自動作成します
                        </p>
                      </div>
                    </FormItem>
                  )}
                />

                {form.watch("isRecurring") && (
                  <FormField
                    control={form.control}
                    name="recurringWeeks"
                    render={({ field }) => (
                      <FormItem className="mt-4">
                        <FormLabel>作成する週数</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            min="1"
                            max="52"
                            onChange={(e) => field.onChange(parseInt(e.target.value))}
                            data-testid="input-recurring-weeks"
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          {field.value}週間分の枠を作成します
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            )}

            {slot && (
              <div className="border-t pt-4 mt-2">
                <FormField
                  control={form.control}
                  name="applyToFuture"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <input
                          type="checkbox"
                          checked={field.value}
                          onChange={field.onChange}
                          className="mt-1"
                          data-testid="checkbox-apply-to-future"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="font-semibold">
                          この日以降すべての同一コースに適用
                        </FormLabel>
                        <p className="text-sm text-muted-foreground">
                          同じ曜日・時間・クラス帯のコースすべてに人数設定を適用します
                        </p>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel-slot"
              >
                キャンセル
              </Button>
              <Button type="submit" data-testid="button-save-slot">
                {slot ? "更新" : "作成"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
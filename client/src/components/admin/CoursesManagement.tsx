import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BookOpenIcon, PlusIcon, PencilIcon, TrashIcon } from "lucide-react";
import type { Course } from "@shared/schema";
import { CourseDialog } from "./CourseDialog";

export function CoursesManagement() {
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

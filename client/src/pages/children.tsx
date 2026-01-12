import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createChildRequestSchema, type CreateChildRequest, type Child, type Course } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { UserIcon, PlusIcon, PencilIcon, Trash2Icon, Loader2, ArrowLeftIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";

const CLASS_BANDS = ["初級", "中級", "上級"] as const;

function ChildForm({ 
  mode, 
  defaultValues, 
  onSubmit, 
  isPending,
  courses 
}: { 
  mode: "create" | "edit";
  defaultValues?: Partial<CreateChildRequest>;
  onSubmit: (data: CreateChildRequest) => void;
  isPending: boolean;
  courses: Course[];
}) {
  const form = useForm<CreateChildRequest>({
    resolver: zodResolver(createChildRequestSchema),
    defaultValues: {
      name: defaultValues?.name || "",
      courseId: defaultValues?.courseId || undefined,
      classBand: defaultValues?.classBand || undefined,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>お子様の名前 <span className="text-destructive">*</span></FormLabel>
              <FormControl>
                <Input 
                  placeholder="例: 山田 太郎" 
                  {...field} 
                  data-testid="input-child-name"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="courseId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>コース（任意）</FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ""}>
                <FormControl>
                  <SelectTrigger data-testid="select-course">
                    <SelectValue placeholder="コースを選択" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">未設定</SelectItem>
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

        <FormField
          control={form.control}
          name="classBand"
          render={({ field }) => (
            <FormItem>
              <FormLabel>クラス（任意）</FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ""}>
                <FormControl>
                  <SelectTrigger data-testid="select-class-band">
                    <SelectValue placeholder="クラスを選択" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">未設定</SelectItem>
                  {CLASS_BANDS.map((band) => (
                    <SelectItem key={band} value={band}>
                      {band}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button 
          type="submit" 
          className="w-full" 
          disabled={isPending}
          data-testid="button-submit-child"
        >
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              保存中...
            </>
          ) : (
            mode === "create" ? "登録する" : "更新する"
          )}
        </Button>
      </form>
    </Form>
  );
}

function ChildCard({ 
  child, 
  courses,
  onEdit, 
  onDelete 
}: { 
  child: Child;
  courses: Course[];
  onEdit: (child: Child) => void;
  onDelete: (id: string) => void;
}) {
  const course = courses.find(c => c.id === child.courseId);

  return (
    <Card data-testid={`card-child-${child.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <UserIcon className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-lg truncate" data-testid={`text-child-name-${child.id}`}>
                {child.name}
              </h3>
              <div className="flex flex-wrap gap-2 mt-1">
                {course && (
                  <Badge variant="secondary" data-testid={`badge-course-${child.id}`}>
                    {course.name}
                  </Badge>
                )}
                {child.classBand && (
                  <Badge variant="outline" data-testid={`badge-class-${child.id}`}>
                    {child.classBand}
                  </Badge>
                )}
                {!course && !child.classBand && (
                  <span className="text-sm text-muted-foreground">コース・クラス未設定</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(child)}
              data-testid={`button-edit-child-${child.id}`}
            >
              <PencilIcon className="w-4 h-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  data-testid={`button-delete-child-${child.id}`}
                >
                  <Trash2Icon className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>お子様の削除</AlertDialogTitle>
                  <AlertDialogDescription>
                    「{child.name}」を削除しますか？この操作は取り消せません。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>キャンセル</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDelete(child.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid={`button-confirm-delete-${child.id}`}
                  >
                    削除する
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ChildrenPage() {
  const { toast } = useToast();
  const [editingChild, setEditingChild] = useState<Child | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const { data: children = [], isLoading: isLoadingChildren } = useQuery<Child[]>({
    queryKey: ["/api/children"],
  });

  const { data: courses = [] } = useQuery<Course[]>({
    queryKey: ["/api/courses"],
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateChildRequest) => 
      apiRequest("POST", "/api/children", {
        ...data,
        courseId: data.courseId === "none" || !data.courseId ? undefined : data.courseId,
        classBand: (data.classBand as string) === "none" || !data.classBand ? undefined : data.classBand,
      }),
    onSuccess: () => {
      toast({ title: "登録完了", description: "お子様を登録しました" });
      queryClient.invalidateQueries({ queryKey: ["/api/children"] });
      setIsCreateDialogOpen(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "エラー", 
        description: error.message || "登録に失敗しました", 
        variant: "destructive" 
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: CreateChildRequest & { id: string }) => 
      apiRequest("PUT", `/api/children/${data.id}`, {
        name: data.name,
        courseId: data.courseId === "none" || !data.courseId ? null : data.courseId,
        classBand: (data.classBand as string) === "none" || !data.classBand ? null : data.classBand,
      }),
    onSuccess: () => {
      toast({ title: "更新完了", description: "お子様の情報を更新しました" });
      queryClient.invalidateQueries({ queryKey: ["/api/children"] });
      setEditingChild(null);
    },
    onError: (error: any) => {
      toast({ 
        title: "エラー", 
        description: error.message || "更新に失敗しました", 
        variant: "destructive" 
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/children/${id}`),
    onSuccess: () => {
      toast({ title: "削除完了", description: "お子様を削除しました" });
      queryClient.invalidateQueries({ queryKey: ["/api/children"] });
    },
    onError: (error: any) => {
      toast({ 
        title: "エラー", 
        description: error.message || "削除に失敗しました", 
        variant: "destructive" 
      });
    },
  });

  const handleCreate = (data: CreateChildRequest) => {
    createMutation.mutate(data);
  };

  const handleUpdate = (data: CreateChildRequest) => {
    if (editingChild) {
      updateMutation.mutate({ ...data, id: editingChild.id });
    }
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const canAddMore = children.length < 5;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-filter supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center gap-4 px-6">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="link-back">
              <ArrowLeftIcon className="w-5 h-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">お子様の管理</h1>
        </div>
      </header>

      <main className="container max-w-2xl px-4 py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserIcon className="w-5 h-5" />
              登録済みのお子様
            </CardTitle>
            <CardDescription>
              お子様は最大5人まで登録できます（現在 {children.length}/5人）
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoadingChildren ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : children.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <UserIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>まだお子様が登録されていません</p>
                <p className="text-sm mt-1">下のボタンから登録してください</p>
              </div>
            ) : (
              <div className="space-y-3">
                {children.map((child) => (
                  <ChildCard
                    key={child.id}
                    child={child}
                    courses={courses}
                    onEdit={setEditingChild}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}

            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button 
                  className="w-full" 
                  disabled={!canAddMore}
                  data-testid="button-add-child"
                >
                  <PlusIcon className="w-4 h-4 mr-2" />
                  お子様を追加
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>お子様を登録</DialogTitle>
                </DialogHeader>
                <ChildForm
                  mode="create"
                  onSubmit={handleCreate}
                  isPending={createMutation.isPending}
                  courses={courses}
                />
              </DialogContent>
            </Dialog>

            {!canAddMore && (
              <p className="text-sm text-muted-foreground text-center">
                登録上限（5人）に達しています
              </p>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!editingChild} onOpenChange={(open) => !open && setEditingChild(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>お子様の情報を編集</DialogTitle>
            </DialogHeader>
            {editingChild && (
              <ChildForm
                mode="edit"
                defaultValues={{
                  name: editingChild.name,
                  courseId: editingChild.courseId || undefined,
                  classBand: editingChild.classBand as "初級" | "中級" | "上級" | undefined,
                }}
                onSubmit={handleUpdate}
                isPending={updateMutation.isPending}
                courses={courses}
              />
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}

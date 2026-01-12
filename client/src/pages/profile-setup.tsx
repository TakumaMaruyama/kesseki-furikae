import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, UserCheck } from "lucide-react";

const profileSchema = z.object({
  displayName: z.string().min(1, "お名前を入力してください").max(50, "50文字以内で入力してください"),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export default function ProfileSetupPage() {
  const { toast } = useToast();

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: "",
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: (data: ProfileFormData) =>
      apiRequest("PUT", "/api/auth/profile", data),
    onSuccess: () => {
      toast({
        title: "プロフィールを登録しました",
        description: "はまスイ欠席・振替システムへようこそ！",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
    onError: (error: any) => {
      toast({
        title: "エラー",
        description: error.message || "プロフィールの登録に失敗しました",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ProfileFormData) => {
    updateProfileMutation.mutate(data);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <UserCheck className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">プロフィール設定</h1>
          <p className="text-muted-foreground">
            はじめに、お名前を登録してください
          </p>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>お名前（保護者名）</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="山田 太郎"
                        className="h-12"
                        data-testid="input-display-name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="p-4 bg-muted/50 rounded-lg text-sm text-muted-foreground">
                <p>この名前は、欠席連絡やマイページで表示されます。</p>
                <p className="mt-1">後から変更することも可能です。</p>
              </div>

              <Button
                type="submit"
                size="lg"
                className="w-full h-12 text-base font-semibold"
                disabled={updateProfileMutation.isPending}
                data-testid="button-save-profile"
              >
                {updateProfileMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    登録中...
                  </>
                ) : (
                  "登録して始める"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

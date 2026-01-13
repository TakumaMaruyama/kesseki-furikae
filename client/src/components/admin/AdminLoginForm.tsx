import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { LockIcon, Loader2 } from "lucide-react";

const adminLoginSchema = z.object({
    password: z.string().min(1, "パスワードを入力してください"),
});

type AdminLoginFormProps = {
    onSuccess: () => void;
};

export function AdminLoginForm({ onSuccess }: AdminLoginFormProps) {
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

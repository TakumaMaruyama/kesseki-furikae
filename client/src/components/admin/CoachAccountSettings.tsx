import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRoundIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type CoachAccountResponse = {
    configured: boolean;
    loginId: string;
};

export function CoachAccountSettings() {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [loginId, setLoginId] = useState("coach");
    const [password, setPassword] = useState("");
    const [passwordConfirmation, setPasswordConfirmation] = useState("");

    const { data, isLoading } = useQuery<CoachAccountResponse>({
        queryKey: ["/api/admin/coach-account"],
        enabled: open,
    });

    useEffect(() => {
        if (data) {
            setLoginId(data.loginId || "coach");
        }
    }, [data]);

    const saveMutation = useMutation({
        mutationFn: (payload: { loginId: string; password: string }) =>
            apiRequest("PUT", "/api/admin/coach-account", payload),
        onSuccess: () => {
            toast({
                title: "保存完了",
                description: "コーチアカウントを保存しました。新しい認証情報をコーチへ共有してください。",
            });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/coach-account"] });
            setPassword("");
            setPasswordConfirmation("");
            setOpen(false);
        },
        onError: (error: any) => {
            toast({
                title: "保存エラー",
                description: error.message || "コーチアカウントの保存に失敗しました。",
                variant: "destructive",
            });
        },
    });

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const normalizedLoginId = loginId.trim();

        if (!normalizedLoginId || password.length < 8) {
            toast({
                title: "入力エラー",
                description: "ログインIDと8文字以上のパスワードを入力してください。",
                variant: "destructive",
            });
            return;
        }

        if (password !== passwordConfirmation) {
            toast({
                title: "入力エラー",
                description: "パスワードと確認用パスワードが一致しません。",
                variant: "destructive",
            });
            return;
        }

        saveMutation.mutate({ loginId: normalizedLoginId, password });
    };

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(true)}
                data-testid="button-coach-account-settings"
            >
                <KeyRoundIcon className="w-4 h-4 mr-2" />
                コーチアカウント
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>コーチアカウント設定</DialogTitle>
                        <DialogDescription>
                            共有するコーチ用のログインIDとパスワードを設定します。パスワードは画面に表示・保存されません。
                        </DialogDescription>
                    </DialogHeader>

                    {isLoading ? (
                        <div className="flex justify-center py-6">
                            <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="coach-login-id">コーチログインID</Label>
                                <Input
                                    id="coach-login-id"
                                    value={loginId}
                                    onChange={(event) => setLoginId(event.target.value)}
                                    autoComplete="username"
                                    placeholder="coach"
                                    data-testid="input-coach-login-id"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="coach-password">新しいパスワード</Label>
                                <Input
                                    id="coach-password"
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    type="password"
                                    autoComplete="new-password"
                                    placeholder="8文字以上"
                                    data-testid="input-coach-password"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="coach-password-confirmation">パスワード（確認）</Label>
                                <Input
                                    id="coach-password-confirmation"
                                    value={passwordConfirmation}
                                    onChange={(event) => setPasswordConfirmation(event.target.value)}
                                    type="password"
                                    autoComplete="new-password"
                                    placeholder="もう一度入力"
                                    data-testid="input-coach-password-confirmation"
                                />
                            </div>

                            <Button
                                type="submit"
                                className="w-full"
                                disabled={saveMutation.isPending}
                                data-testid="button-save-coach-account"
                            >
                                {saveMutation.isPending ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        保存中...
                                    </>
                                ) : (
                                    data?.configured ? "更新する" : "登録する"
                                )}
                            </Button>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}

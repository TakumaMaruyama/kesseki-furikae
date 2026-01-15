import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { LogIn, Mail, Lock, User, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleGoogleLogin = () => {
    window.location.href = "/api/login";
  };

  const handleLocalAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/local-login";
      const body = mode === "register" 
        ? { email, password, displayName }
        : { email, password, rememberMe };

      const response = await apiRequest("POST", endpoint, body);

      if (response.success) {
        toast({
          title: mode === "register" ? "登録完了" : "ログイン成功",
          description: mode === "register" 
            ? "アカウントが作成されました" 
            : "ログインしました",
        });
        setLocation("/");
        window.location.reload();
      }
    } catch (error: any) {
      toast({
        title: "エラー",
        description: error.message || "認証に失敗しました",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <h1 className="text-2xl font-bold whitespace-nowrap">はまスイ 欠席・振替システム</h1>
          <p className="text-muted-foreground">
            {mode === "login" ? "ログインしてご利用ください" : "新規アカウント登録"}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="p-4 bg-muted/50 rounded-lg">
              <h3 className="font-semibold mb-2">ご利用案内</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>・お子様の欠席連絡と振替予約ができます</li>
                <li>・マイページでお子様の登録・管理ができます</li>
                <li>・欠席履歴や振替状況を確認できます</li>
              </ul>
            </div>

            <form onSubmit={handleLocalAuth} className="space-y-4">
              {mode === "register" && (
                <div className="space-y-2">
                  <Label htmlFor="displayName">お名前</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="displayName"
                      type="text"
                      placeholder="山田 太郎"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="pl-10"
                      required
                      data-testid="input-displayName"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">メールアドレス</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="example@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                    data-testid="input-email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">パスワード</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder={mode === "register" ? "6文字以上" : "••••••••"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                    required
                    minLength={mode === "register" ? 6 : 1}
                    data-testid="input-password"
                  />
                </div>
              </div>

              {mode === "login" && (
                <div className="flex items-center space-x-2">
                  <input
                    id="rememberMe"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 cursor-pointer"
                    data-testid="checkbox-remember-me"
                  />
                  <Label htmlFor="rememberMe" className="cursor-pointer text-sm font-normal">
                    ログイン状態を保持する（1年間有効）
                  </Label>
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={isLoading}
                data-testid="button-submit"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                ) : (
                  <LogIn className="w-5 h-5 mr-2" />
                )}
                {mode === "register" ? "アカウント登録" : "ログイン"}
              </Button>
            </form>

            <div className="text-center space-y-2">
              <button
                type="button"
                onClick={() => setMode(mode === "login" ? "register" : "login")}
                className="text-sm text-primary hover:underline"
                data-testid="button-toggle-mode"
              >
                {mode === "login" 
                  ? "アカウントをお持ちでない方はこちら" 
                  : "既にアカウントをお持ちの方はこちら"}
              </button>
              {mode === "login" && (
                <div>
                  <a
                    href="/forgot-password"
                    className="text-sm text-muted-foreground hover:underline"
                    data-testid="link-forgot-password"
                  >
                    パスワードをお忘れの方
                  </a>
                </div>
              )}
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">または</span>
              </div>
            </div>
            
            <Button
              onClick={handleGoogleLogin}
              variant="outline"
              size="lg"
              className="w-full"
              data-testid="button-google-login"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Googleでログイン
            </Button>
          </div>
          
          <p className="text-xs text-center text-muted-foreground">
            ログインすることで利用規約に同意したものとみなされます
          </p>
        </CardContent>
      </Card>
      <div className="fixed bottom-2 right-2 z-50">
        <a href="/admin">
          <Button
            variant="ghost"
            size="sm"
            data-testid="link-admin"
            className="h-8 w-8 p-0 text-muted-foreground/30 hover:text-muted-foreground hover:bg-transparent"
          >
            <span className="sr-only">管理画面</span>
            <Lock className="h-3 w-3" />
          </Button>
        </a>
      </div>
    </div>
  );
}

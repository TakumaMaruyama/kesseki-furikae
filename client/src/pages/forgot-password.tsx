import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";

export default function ForgotPasswordPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await apiRequest("POST", "/api/auth/forgot-password", { email });
      setIsSubmitted(true);
    } catch (error: any) {
      toast({
        title: "エラー",
        description: error.message || "エラーが発生しました",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h1 className="text-2xl font-bold">メールを送信しました</h1>
            <p className="text-muted-foreground">
              パスワードリセット用のリンクを
              <br />
              <span className="font-medium text-foreground">{email}</span>
              <br />
              に送信しました。
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-muted/50 rounded-lg text-sm">
              <ul className="space-y-2 text-muted-foreground">
                <li>・メールが届くまで数分かかる場合があります</li>
                <li>・迷惑メールフォルダもご確認ください</li>
                <li>・リンクの有効期限は1時間です</li>
              </ul>
            </div>
            <Link href="/login">
              <Button variant="outline" className="w-full" data-testid="link-back-to-login">
                <ArrowLeft className="w-4 h-4 mr-2" />
                ログイン画面に戻る
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <h1 className="text-2xl font-bold">パスワードをお忘れの方</h1>
          <p className="text-muted-foreground">
            登録されているメールアドレスを入力してください
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
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
                <Mail className="w-5 h-5 mr-2" />
              )}
              リセットメールを送信
            </Button>
          </form>

          <div className="text-center">
            <Link href="/login">
              <span className="text-sm text-muted-foreground hover:underline cursor-pointer" data-testid="link-back-to-login">
                <ArrowLeft className="w-4 h-4 inline mr-1" />
                ログイン画面に戻る
              </span>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

type FloatingActionButtonsProps = {
  isAdmin: boolean;
  isCoach: boolean;
  isStaff: boolean;
  isStatus: boolean;
};

const floatingContainerStyle = {
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)",
} as const;

export default function FloatingActionButtons({
  isAdmin,
  isCoach,
  isStaff,
  isStatus,
}: FloatingActionButtonsProps) {
  return (
    <div
      className="fixed right-2 z-50 flex items-center gap-2"
      style={floatingContainerStyle}
    >
      <Button
        variant="secondary"
        size="sm"
        data-testid="button-reload"
        className="h-10 px-3 text-xs font-semibold shadow-sm"
        onClick={() => window.location.reload()}
      >
        <RefreshCw />
        再読み込み
      </Button>

      {isAdmin ? (
        <Link href="/">
          <Button
            size="lg"
            data-testid="link-parent"
            className="h-12 px-6 text-base font-semibold shadow-lg"
          >
            保護者向け画面
          </Button>
        </Link>
      ) : isCoach ? (
        <>
          <Link href="/">
            <Button
              size="lg"
              data-testid="link-coach-parent"
              className="h-12 px-5 text-base font-semibold shadow-lg"
            >
              保護者向け画面
            </Button>
          </Link>
          <Link href="/absence">
            <Button
              variant="outline"
              size="lg"
              data-testid="link-coach-parent-input"
              className="h-12 px-5 text-base font-semibold shadow-lg"
            >
              保護者の入力画面
            </Button>
          </Link>
        </>
      ) : isStaff ? null : (
        <>
          {!isStatus && (
            <Link href="/status">
              <Button
                variant="default"
                data-testid="link-status"
                className="h-10 px-4 text-sm font-semibold bg-primary hover:bg-primary/90 shadow-sm"
              >
                予約確認
              </Button>
            </Link>
          )}

          <Link href="/admin">
            <Button
              variant="outline"
              size="sm"
              data-testid="link-admin"
              className="h-10 px-3 text-xs font-semibold shadow-sm"
            >
              管理者
            </Button>
          </Link>
        </>
      )}
    </div>
  );
}

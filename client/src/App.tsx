import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import StatusPage from "@/pages/status";
import ParentPage from "@/pages/parent";
import AdminPage from "@/pages/admin";
import CancelAbsencePage from "@/pages/cancel-absence";
import CancelAbsenceTokenPage from "@/pages/cancel-absence-token";
import CancelRequestPage from "@/pages/cancel-request";
import CancelPage from "@/pages/cancel";
import DeclinePage from "@/pages/decline";
import NotFound from "@/pages/not-found";
import { Button } from "@/components/ui/button";

function MainRouter() {
  return (
    <Switch>
      <Route path="/" component={ParentPage} />
      <Route path="/absence" component={ParentPage} />
      <Route path="/status" component={StatusPage} />
      <Route path="/cancel-absence" component={CancelAbsencePage} />
      <Route path="/cancel-absence/:token" component={CancelAbsenceTokenPage} />
      <Route path="/cancel" component={CancelRequestPage} />
      <Route path="/cancel/:token" component={CancelPage} />
      <Route path="/decline/:token" component={DeclinePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AdminRouter() {
  return (
    <Switch>
      <Route path="/admin" component={AdminPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const [location] = useLocation();
  const isAdmin = location === "/admin";
  const isStatus = location === "/status";

  if (isAdmin) {
    return (
      <>
        <AdminRouter />
        <div className="fixed bottom-6 right-6 z-50">
          <Link href="/">
            <Button
              size="lg"
              data-testid="link-parent"
              className="h-12 px-6 text-base font-semibold shadow-lg"
            >
              保護者向け画面
            </Button>
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <MainRouter />
      <div className="fixed bottom-6 right-6 z-50 flex gap-2">
        {isStatus ? (
          <Link href="/absence">
            <Button
              variant="outline"
              size="lg"
              data-testid="link-absence"
              className="h-12 px-6 text-base font-semibold shadow-lg"
            >
              欠席連絡
            </Button>
          </Link>
        ) : (
          <Link href="/status">
            <Button
              variant="outline"
              size="lg"
              data-testid="link-status"
              className="h-12 px-6 text-base font-semibold shadow-lg"
            >
              予約確認
            </Button>
          </Link>
        )}
        <Link href="/admin">
          <Button
            size="lg"
            data-testid="link-admin"
            className="h-12 px-6 text-base font-semibold shadow-lg"
          >
            管理画面
          </Button>
        </Link>
      </div>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AppContent />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

import { Switch, Route, useLocation } from "wouter";
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
import FloatingActionButtons from "@/components/FloatingActionButtons";

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

  return (
    <>
      {isAdmin ? <AdminRouter /> : <MainRouter />}
      <FloatingActionButtons isAdmin={isAdmin} isStatus={isStatus} />
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

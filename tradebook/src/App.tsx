import { useEffect, useState, lazy, Suspense } from "react";
import {
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import {
  Menu,
  LayoutDashboard,
  PenLine,
  Clock,
  CircleOff,
  BookOpen,
  BarChart3,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Trade } from "./types/trade";
import TradeForm from "./components/TradeForm";
import PaywallGate from "./components/PaywallGate";
import Onboarding from "./components/Onboarding";
import { useSubscription } from "./contexts/SubscriptionContext";
import { cn } from "./lib/utils";
import Sidebar from "./components/AppShell/Sidebar";
import MobileTabBar from "./components/AppShell/MobileTabBar";

const Dashboard = lazy(() => import("./components/Dashboard"));
const Analytics = lazy(() => import("./components/Analytics"));
const Journal = lazy(() => import("./components/Journal"));
const MissedTrades = lazy(() => import("./components/MissedTrades"));
const TradeList = lazy(() => import("./components/TradeList"));
const Settings = lazy(() => import("./components/Settings"));

function LazySpinner() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <div className="h-4 w-4 border-2 border-white/10 border-t-white/50 rounded-full animate-spin" />
    </div>
  );
}

const navItems: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/log", label: "Log Trade", icon: PenLine },
  { to: "/app/trades", label: "History", icon: Clock },
  { to: "/app/missed", label: "Missed", icon: CircleOff },
  { to: "/app/journal", label: "Journal", icon: BookOpen },
  { to: "/app/analytics", label: "Analytics", icon: BarChart3 },
];

export default function App() {
  const { isPastDue, profile, loading: profileLoading } = useSubscription();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const editingTrade =
    (location.state as { editTrade?: Trade } | null)?.editTrade ?? null;

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Show onboarding for users who haven't completed it
  if (!profileLoading && profile && !profile.onboarded) {
    return <Onboarding />;
  }

  return (
    <div className="h-[100dvh] flex bg-surface-0 text-primary overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        onDoubleClick={() => sidebarCollapsed && setSidebarCollapsed(false)}
        className={cn(
          "hidden sm:flex flex-col border-r border-white/[0.04] bg-surface-0 shrink-0 transition-[width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
          sidebarCollapsed ? "w-[60px] cursor-pointer" : "w-[240px]"
        )}
      >
        <Sidebar
          sidebarCollapsed={sidebarCollapsed}
          setSidebarCollapsed={setSidebarCollapsed}
          navItems={navItems}
        />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 sm:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={cn(
          "fixed top-0 left-0 bottom-0 z-50 w-[240px] flex flex-col border-r border-white/[0.04] bg-surface-0 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] sm:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Sidebar
          sidebarCollapsed={sidebarCollapsed}
          setSidebarCollapsed={setSidebarCollapsed}
          navItems={navItems}
        />
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-12 flex items-center gap-3 px-4 sm:px-6 border-b border-white/[0.04] shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="sm:hidden p-1 -ml-1 text-zinc-400 hover:text-white transition-colors"
          >
            <Menu size={20} strokeWidth={1.8} />
          </button>
          <h1 className="text-[13px] font-medium text-zinc-400">
            {navItems.find((n) => location.pathname.startsWith(n.to))?.label || "MyTradeBook"}
          </h1>
          <div className="flex-1" />
          {isPastDue && (
            <span className="text-xs text-amber bg-amber/10 px-2.5 py-1 rounded-md font-medium">
              Payment failed
            </span>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1200px] mx-auto px-4 sm:px-8 pt-8 pb-20 sm:pb-8">
              <div key={location.pathname} className="animate-page-enter">
                <Suspense fallback={<LazySpinner />}>
                  <Routes>
                    <Route index element={<Navigate to="/app/log" replace />} />
                    <Route
                      path="log"
                      element={
                        <div className="max-w-xl mx-auto">
                          <TradeForm
                            editTrade={editingTrade}
                            onEditDone={() =>
                              navigate(".", { replace: true, state: {} })
                            }
                          />
                        </div>
                      }
                    />
                    <Route
                      path="trades"
                      element={
                        <TradeList
                          onLogTrade={() => navigate("/app/log")}
                          onEdit={(trade) =>
                            navigate("/app/log", { state: { editTrade: trade } })
                          }
                        />
                      }
                    />
                    <Route
                      path="missed"
                      element={
                        <MissedTrades />
                      }
                    />
                    <Route
                      path="journal"
                      element={
                        <PaywallGate feature="Journal">
                          <Journal />
                        </PaywallGate>
                      }
                    />
                    <Route
                      path="analytics"
                      element={
                        <PaywallGate feature="Analytics">
                          <Analytics />
                        </PaywallGate>
                      }
                    />
                    <Route
                      path="dashboard"
                      element={
                        <Dashboard
                          onLogTrade={() => navigate("/app/log")}
                        />
                      }
                    />
                    <Route path="settings" element={<Settings />} />
                  </Routes>
                </Suspense>
              </div>
          </div>
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <MobileTabBar navItems={navItems} />
    </div>
  );
}

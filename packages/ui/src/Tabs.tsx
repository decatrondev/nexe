import { useState, createContext, useContext, type ReactNode } from "react";

// ── Types ──────────────────────────────────────────────

interface TabItem {
  id: string;
  label: string;
  /** Optional custom color class for the label (e.g. "text-red-400") */
  color?: string;
}

interface TabsContextValue {
  activeTab: string;
  setActiveTab: (id: string) => void;
}

// ── Context ────────────────────────────────────────────

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs components must be used within <Tabs>");
  return ctx;
}

// ── Root ───────────────────────────────────────────────

interface TabsProps {
  defaultTab: string;
  children: ReactNode;
  className?: string;
  /** Controlled mode — parent manages state */
  value?: string;
  onChange?: (id: string) => void;
}

function Tabs({ defaultTab, children, className = "", value, onChange }: TabsProps) {
  const [internal, setInternal] = useState(defaultTab);
  const activeTab = value ?? internal;
  const setActiveTab = onChange ?? setInternal;

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

// ── Tab List (vertical sidebar style) ──────────────────

interface TabListProps {
  tabs: TabItem[];
  /** Optional label above the tab list */
  label?: string;
  className?: string;
}

function TabList({ tabs, label, className = "" }: TabListProps) {
  const { activeTab, setActiveTab } = useTabsContext();

  return (
    <div className={className}>
      {label && (
        <p className="mb-2 px-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          {label}
        </p>
      )}
      <nav className="space-y-0.5">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const baseColor = tab.color
            ? `${tab.color} hover:bg-dark-800`
            : "text-slate-400 hover:bg-dark-800 hover:text-slate-200";

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full rounded-md px-3 py-1.5 text-left text-sm font-medium transition-colors ${
                isActive
                  ? "bg-nexe-600/15 text-white"
                  : baseColor
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ── Tab Panel ──────────────────────────────────────────

interface TabPanelProps {
  id: string;
  children: ReactNode;
  className?: string;
}

function TabPanel({ id, children, className = "" }: TabPanelProps) {
  const { activeTab } = useTabsContext();
  if (activeTab !== id) return null;
  return <div className={className}>{children}</div>;
}

// ── Horizontal Tab List ────────────────────────────────

interface TabBarProps {
  tabs: TabItem[];
  className?: string;
}

function TabBar({ tabs, className = "" }: TabBarProps) {
  const { activeTab, setActiveTab } = useTabsContext();

  return (
    <div className={`flex gap-1 ${className}`}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-dark-700 text-white"
                : "text-slate-400 hover:bg-dark-800 hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Exports ────────────────────────────────────────────

export { Tabs, TabList, TabBar, TabPanel, useTabsContext };
export type { TabsProps, TabListProps, TabBarProps, TabPanelProps, TabItem };

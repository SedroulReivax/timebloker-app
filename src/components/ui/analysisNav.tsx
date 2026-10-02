import React, { createContext, useContext } from 'react';
import { Settings } from 'lucide-react';

// Lets any Analysis card send the user to Settings → Analysis without threading a callback through every tab.
// Outside the hub (or in tests) there is no handler, and SetupNudge shows its sentence without the button.

interface AnalysisNav {
  openAnalysisSettings?: () => void;
}

const AnalysisNavContext = createContext<AnalysisNav>({});

export const AnalysisNavProvider: React.FC<{ openAnalysisSettings?: () => void; children: React.ReactNode }> = ({ openAnalysisSettings, children }) => (
  <AnalysisNavContext.Provider value={{ openAnalysisSettings }}>{children}</AnalysisNavContext.Provider>
);

export const useAnalysisNav = () => useContext(AnalysisNavContext);

/** A "this isn't set up yet" state: what is missing, why it matters, and a button that goes there. */
export const SetupNudge: React.FC<{ children: React.ReactNode; action?: string; className?: string }> = ({ children, action = 'Set it up', className = '' }) => {
  const { openAnalysisSettings } = useAnalysisNav();
  return (
    <div className={`text-sm text-muted-foreground space-y-2 ${className}`}>
      <div>{children}</div>
      {openAnalysisSettings && (
        <button
          onClick={openAnalysisSettings}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[32px] text-xs font-medium rounded-full border border-border text-foreground hover:bg-accent"
        >
          <Settings size={12} aria-hidden /> {action}
        </button>
      )}
    </div>
  );
};

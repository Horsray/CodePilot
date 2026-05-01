import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MemoryPanel } from './MemoryPanel';

interface MemoryPanelPortalProps {
  workingDirectory: string;
}

export function MemoryPanelPortal({ workingDirectory }: MemoryPanelPortalProps) {
  const [container, setContainer] = useState<Element | null>(null);

  useEffect(() => {
    const resolveContainer = () => {
      const el = document.getElementById('dashboard-memory-slot');
      setContainer(prev => (prev === el ? prev : el));
    };

    resolveContainer();
    const observer = new MutationObserver(() => resolveContainer());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  if (!container || !workingDirectory) return null;

  return createPortal(<MemoryPanel workingDirectory={workingDirectory} />, container);
}

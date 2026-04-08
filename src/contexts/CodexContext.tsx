"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { Extension, Skill, CodexTab, ExtensionCategory, SkillCategory } from "@/types/codex";

interface CodexContextValue {
  activeTab: CodexTab;
  setActiveTab: (tab: CodexTab) => void;
  extensionCategory: ExtensionCategory;
  setExtensionCategory: (cat: ExtensionCategory) => void;
  skillCategory: SkillCategory;
  setSkillCategory: (cat: SkillCategory) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  extensions: Extension[];
  installExtension: (id: string) => void;
  uninstallExtension: (id: string) => void;
  toggleExtension: (id: string) => void;
  skills: Skill[];
  toggleSkill: (id: string) => void;
}

const CodexContext = createContext<CodexContextValue | null>(null);

const mockExtensions: Extension[] = [
  { id: "1", name: "Cline", publisher: "cpratt", description: "AI coding assistant for VS Code", downloads: "6.5M", stars: "20.3k", installed: true, enabled: true, category: "ai" },
  { id: "2", name: "Trae AI", publisher: "Trae", description: "Built-in AI assistant", downloads: "2.1M", stars: "8.5k", installed: true, enabled: true, category: "ai" },
  { id: "3", name: "GitLens", publisher: "GitKraken", description: "Git supercharged", downloads: "15M", stars: "45.2k", installed: false, enabled: false, category: "git" },
  { id: "4", name: "Prettier", publisher: "Prettier", description: "Code formatter", downloads: "25M", stars: "32.1k", installed: true, enabled: true, category: "format" },
  { id: "5", name: "ESLint", publisher: "ESLint", description: "JavaScript linter", downloads: "18M", stars: "28.7k", installed: false, enabled: false, category: "lint" },
  { id: "6", name: "Docker", publisher: "Microsoft", description: "Docker support", downloads: "12M", stars: "15.3k", installed: false, enabled: false, category: "devops" },
  { id: "7", name: "Python", publisher: "Microsoft", description: "Python language support", downloads: "8.5M", stars: "12.1k", installed: true, enabled: true, category: "language" },
  { id: "8", name: "Live Share", publisher: "Microsoft", description: "Real-time collaboration", downloads: "5.2M", stars: "9.8k", installed: false, enabled: false, category: "collab" },
];

const mockSkills: Skill[] = [
  { id: "1", name: "Web Development", description: "Full-stack web development skills", enabled: true, category: "frontend" },
  { id: "2", name: "API Design", description: "REST and GraphQL API design", enabled: true, category: "backend" },
  { id: "3", name: "Database", description: "SQL and NoSQL database skills", enabled: false, category: "backend" },
  { id: "4", name: "Testing", description: "Unit and integration testing", enabled: false, category: "quality" },
  { id: "5", name: "DevOps", description: "CI/CD and deployment skills", enabled: true, category: "ops" },
];

export function CodexProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<CodexTab>("extensions");
  const [extensionCategory, setExtensionCategory] = useState<ExtensionCategory>("my-extensions");
  const [skillCategory, setSkillCategory] = useState<SkillCategory>("installed");
  const [searchQuery, setSearchQuery] = useState("");
  const [extensions, setExtensions] = useState<Extension[]>(mockExtensions);
  const [skills, setSkills] = useState<Skill[]>(mockSkills);

  const installExtension = useCallback((id: string) => {
    setExtensions(prev => prev.map(ext => 
      ext.id === id ? { ...ext, installed: true, enabled: true } : ext
    ));
  }, []);

  const uninstallExtension = useCallback((id: string) => {
    setExtensions(prev => prev.map(ext => 
      ext.id === id ? { ...ext, installed: false, enabled: false } : ext
    ));
  }, []);

  const toggleExtension = useCallback((id: string) => {
    setExtensions(prev => prev.map(ext => 
      ext.id === id && ext.installed ? { ...ext, enabled: !ext.enabled } : ext
    ));
  }, []);

  const toggleSkill = useCallback((id: string) => {
    setSkills(prev => prev.map(skill => 
      skill.id === id ? { ...skill, enabled: !skill.enabled } : skill
    ));
  }, []);

  return (
    <CodexContext.Provider value={{
      activeTab, setActiveTab,
      extensionCategory, setExtensionCategory,
      skillCategory, setSkillCategory,
      searchQuery, setSearchQuery,
      extensions, installExtension, uninstallExtension, toggleExtension,
      skills, toggleSkill,
    }}>
      {children}
    </CodexContext.Provider>
  );
}

export function useCodex(): CodexContextValue {
  const ctx = useContext(CodexContext);
  if (!ctx) throw new Error("useCodex must be used within CodexProvider");
  return ctx;
}

export interface Extension {
  id: string;
  name: string;
  publisher: string;
  description: string;
  icon?: string;
  downloads: string;
  stars: string;
  installed: boolean;
  enabled: boolean;
  category: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  icon?: string;
  enabled: boolean;
  category: string;
}

export type CodexTab = "extensions" | "skills" | "marketplace";
export type ExtensionCategory = "my-extensions" | "marketplace" | "installed" | "recent";
export type SkillCategory = "installed" | "recent";

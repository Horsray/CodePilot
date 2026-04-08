"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";
import { Globe, Lock, Plus, ArrowRight, FolderOpen } from "@/components/ui/icon";

interface GitConfigDialogProps {
  open: boolean;
  onClose: () => void;
  onConfigured: (newPath?: string) => void;
}

interface Repo {
  name: string;
  full_name: string;
  description: string;
  private: boolean;
  html_url: string;
  clone_url: string;
}

type GitHubRepoResponse = {
  name: string;
  full_name: string;
  description?: string | null;
  private: boolean;
  html_url: string;
  clone_url: string;
};

export function GitConfigDialog({ open, onClose, onConfigured }: GitConfigDialogProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"auth" | "repos" | "setup">("auth");
  const [authMethod, setAuthMethod] = useState<"token" | "https">("token");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [projectPath, setProjectPath] = useState("");

  // Get current project path on mount
  useEffect(() => {
    if (open) {
      // Use /api/settings/workspace to get working directory
      fetch("/api/settings/workspace")
        .then(res => res.json())
        .then(data => {
          const path = data.working_directory;
          if (path) {
            setProjectPath(path);
          }
        })
        .catch(() => {});
    }
  }, [open]);

  // Verify Token - calls GitHub API
  const verifyToken = async () => {
    if (!token.trim()) {
      showToast({ type: "error", message: t('git.enterTokenError') });
      return false;
    }

    setVerifying(true);
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: { "Authorization": `token ${token}` }
      });
      
      if (!res.ok) {
        showToast({ type: "error", message: t('git.tokenInvalid') });
        return false;
      }

      const user = await res.json();
      setUsername(user.login);
      
      // Save credentials
      await fetch("/api/git/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "github",
          token: token.trim(),
          username: user.login,
          authMethod: "token",
        }),
      });

      showToast({ type: "success", message: t('git.tokenVerified') });
      return true;
    } catch (err) {
      showToast({ type: "error", message: t('git.verifyFailed') });
      return false;
    } finally {
      setVerifying(false);
    }
  };

  // HTTPS auth - just save credentials, don't verify via API
  const saveHttpsCredentials = async () => {
    if (!username.trim() || !password.trim()) {
      showToast({ type: "error", message: t('git.enterCredentialsError') });
      return false;
    }

    setVerifying(true);
    try {
      // Save credentials
      await fetch("/api/git/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "github",
          token: password.trim(), // Store password as token for git credential helper
          username: username.trim(),
          authMethod: "https",
        }),
      });

      showToast({ type: "success", message: t('git.credentialsSaved') });
      return true;
    } catch (err) {
      showToast({ type: "error", message: t('git.saveFailed') });
      return false;
    } finally {
      setVerifying(false);
    }
  };

  const fetchRepos = async () => {
    setLoading(true);
    try {
      const res = await fetch("https://api.github.com/user/repos?sort=updated&per_page=100", {
        headers: { "Authorization": `token ${token}` }
      });

      if (!res.ok) throw new Error("Failed to fetch repos");

      const data = (await res.json()) as GitHubRepoResponse[];
      const formattedRepos: Repo[] = data.map((r) => ({
        name: r.name,
        full_name: r.full_name,
        description: r.description || "",
        private: r.private,
        html_url: r.html_url,
        clone_url: r.clone_url,
      }));

      setRepos(formattedRepos);
      setStep("repos");
    } catch (err) {
      showToast({ type: "error", message: t('git.fetchReposFailed') });
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    if (authMethod === "token") {
      const verified = await verifyToken();
      if (verified) {
        await fetchRepos();
      }
    } else {
      // HTTPS mode - save credentials and go to setup
      const saved = await saveHttpsCredentials();
      if (saved) {
        setStep("setup");
      }
    }
  };

  const handleSelectRepo = (repo: Repo) => {
    setSelectedRepo(repo);
    setRemoteUrl(repo.clone_url);
    setStep("setup");
  };

  const handleClone = async () => {
    if (!selectedRepo) return;
    
    setLoading(true);
    try {
      const res = await fetch("/api/git/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: selectedRepo.clone_url, cwd: projectPath }),
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Clone failed" }));
        showToast({ type: "error", message: data.error || t('git.cloneFailed') });
        return;
      }

      const result = await res.json();
      showToast({ type: "success", message: t('git.cloneSuccess') });
      
      // If clone returned a new path, update the working directory everywhere
      const newPath = result.path || projectPath;
      if (result.path) {
        await fetch("/api/settings/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ working_directory: result.path }),
        });
      }
      // Sync localStorage and notify all listeners
      localStorage.setItem('codepilot:last-working-directory', newPath);
      window.dispatchEvent(new CustomEvent('project-directory-changed', { detail: { path: newPath } }));

      onClose();
      // Delay onConfigured to allow dialog to close and state to update
      setTimeout(() => onConfigured(newPath), 100);
    } catch (err) {
      showToast({ type: "error", message: t('git.cloneFailed') });
    } finally {
      setLoading(false);
    }
  };

  const handleLinkRemote = async () => {
    if (!remoteUrl.trim()) {
      showToast({ type: "error", message: t('git.enterRepoUrlError') });
      return;
    }

    if (!projectPath.trim()) {
      showToast({ type: "error", message: t('git.enterProjectPathError') });
      return;
    }

    setLoading(true);
    try {
      // Initialize git if not already
      const initRes = await fetch("/api/git/init", { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectPath }),
      });
      
      if (!initRes.ok) {
        const data = await initRes.json().catch(() => ({ error: "Failed to initialize git" }));
        showToast({ type: "error", message: data.error || t('git.initFailed') });
        return;
      }

      // Add remote
      const res = await fetch("/api/git/remote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: remoteUrl.trim(), cwd: projectPath }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to add remote" }));
        showToast({ type: "error", message: data.error || t('git.linkFailed') });
        return;
      }

      showToast({ type: "success", message: t('git.linkSuccess') });
      // Sync localStorage and notify all listeners
      localStorage.setItem('codepilot:last-working-directory', projectPath);
      window.dispatchEvent(new CustomEvent('project-directory-changed', { detail: { path: projectPath } }));

      onClose();
      // Delay onConfigured to allow dialog to close and state to update
      setTimeout(() => onConfigured(projectPath), 100);
    } catch (err) {
      showToast({ type: "error", message: err instanceof Error ? err.message : t('git.linkFailed') });
    } finally {
      setLoading(false);
    }
  };

  const handleInitAndPush = async () => {
    if (!remoteUrl.trim()) {
      showToast({ type: "error", message: t('git.enterRepoUrlError') });
      return;
    }

    if (!projectPath.trim()) {
      showToast({ type: "error", message: t('git.enterProjectPathError') });
      return;
    }

    setLoading(true);
    try {
      // Initialize repo with project path
      const initRes = await fetch("/api/git/init", { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectPath }),
      });
      if (!initRes.ok) {
        const data = await initRes.json().catch(() => ({ error: "Init failed" }));
        throw new Error(data.error || "Init failed");
      }

      // Add remote and push
      await handleLinkRemote();
    } catch (err) {
      showToast({ type: "error", message: err instanceof Error ? err.message : t('git.initFailed') });
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[900px] w-[90vw] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "auth" && t('git.connectGitHub')}
            {step === "repos" && t('git.selectRepo')}
            {step === "setup" && t('git.setupRepo')}
          </DialogTitle>
          <DialogDescription>
            {step === "auth" && t('git.chooseAuthMethod')}
            {step === "repos" && t('git.chooseRepoOrCreate')}
            {step === "setup" && t('git.configureProject', { path: projectPath })}
          </DialogDescription>
        </DialogHeader>

        {step === "auth" && (
          <div className="space-y-6 py-4">
            {/* Auth Method Tabs */}
            <Tabs value={authMethod} onValueChange={(v) => setAuthMethod(v === "https" ? "https" : "token")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="token">
                  <Lock size={14} className="mr-1" />
                  {t('git.personalAccessToken')}
                </TabsTrigger>
                <TabsTrigger value="https">
                  <Globe size={14} className="mr-1" />
                  {t('git.https')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="token" className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('git.token')}</Label>
                  <Input
                    type="password"
                    placeholder={t('git.tokenPlaceholder')}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('git.createTokenHint')}{" "}
                    <a
                      href="https://github.com/settings/tokens"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      github.com/settings/tokens
                    </a>
                  </p>
                </div>
                <Button 
                  onClick={handleContinue} 
                  disabled={!token.trim() || verifying}
                  className="w-full"
                >
                  {verifying ? t('git.verifying') : t('git.continue')}
                  <ArrowRight size={16} className="ml-2" />
                </Button>
              </TabsContent>

              <TabsContent value="https" className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('git.username')}</Label>
                  <Input
                    placeholder={t('git.usernamePlaceholder')}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('git.password')}</Label>
                  <Input
                    type="password"
                    placeholder={t('git.passwordPlaceholder')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('git.httpsNote')}
                  </p>
                </div>
                <Button 
                  onClick={handleContinue}
                  disabled={!username.trim() || !password.trim() || verifying}
                  className="w-full"
                >
                  {verifying ? t('git.saving') : t('git.continue')}
                  <ArrowRight size={16} className="ml-2" />
                </Button>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {step === "repos" && (
          <div className="space-y-4 py-4 flex flex-col" style={{ minHeight: '400px' }}>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {t('git.foundRepos', { count: repos.length })}
              </span>
              <Button variant="outline" size="sm" onClick={() => setStep("setup")}>
                <Plus size={14} className="mr-1" />
                {t('git.createNewRepo')}
              </Button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-2 max-h-[400px] min-h-[200px]">
              {repos.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  {t('git.noReposFound')}
                </div>
              ) : (
                repos.map((repo) => (
                  <div
                    key={repo.full_name}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent cursor-pointer"
                    onClick={() => handleSelectRepo(repo)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{repo.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {repo.description || repo.full_name}
                      </div>
                    </div>
                    {repo.private && (
                      <Lock size={14} className="ml-2 text-muted-foreground" />
                    )}
                  </div>
                ))
              )}
            </div>

            <Button variant="outline" onClick={() => setStep("auth")} className="w-full mt-4">
              {t('git.back')}
            </Button>
          </div>
        )}

        {step === "setup" && (
          <div className="space-y-4 py-4">
            {selectedRepo ? (
              <div className="p-3 bg-accent rounded-lg">
                <div className="font-medium">{selectedRepo.name}</div>
                <div className="text-xs text-muted-foreground">{selectedRepo.clone_url}</div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>{t('git.remoteUrl')}</Label>
                <Input
                  placeholder={t('git.remoteUrlPlaceholder')}
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>{t('git.projectPath')}</Label>
              <div className="flex gap-2">
                <Input 
                  value={projectPath} 
                  onChange={(e) => setProjectPath(e.target.value)}
                  placeholder={t('git.projectPathPlaceholder')}
                  className="flex-1"
                />
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/folder-picker', { method: 'POST' });
                      if (res.ok) {
                        const data = await res.json();
                        if (data.path) {
                          setProjectPath(data.path);
                        }
                      }
                    } catch {
                      showToast({ type: "error", message: t('git.selectFolderFailed') });
                    }
                  }}
                  title={t('git.selectFolder')}
                >
                  <FolderOpen size={16} />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('git.currentProject')}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => selectedRepo ? setStep("repos") : setStep("auth")}>
                {t('git.back')}
              </Button>
              <Button 
                onClick={selectedRepo ? handleClone : handleLinkRemote}
                disabled={loading || !remoteUrl}
              >
                {loading ? t('git.linking') : (selectedRepo ? t('git.clone') : t('git.linkRemote'))}
              </Button>
            </div>

            {selectedRepo && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">{t('git.or')}</span>
                  </div>
                </div>
                <Button variant="outline" onClick={handleLinkRemote} disabled={loading || !remoteUrl} className="w-full">
                  <Globe size={16} className="mr-2" />
                  {t('git.linkRemote')}
                </Button>
              </>
            )}

            {!selectedRepo && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">{t('git.or')}</span>
                  </div>
                </div>
                <Button variant="outline" onClick={handleInitAndPush} disabled={loading} className="w-full">
                  <Plus size={16} className="mr-2" />
                  {t('git.initAndPush')}
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

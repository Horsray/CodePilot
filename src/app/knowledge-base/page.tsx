"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  BookOpen, 
  ArrowClockwise, 
  Plus, 
  MagnifyingGlass, 
  Database, 
  File, 
  Globe,
  Info,
  CheckCircle,
  SpinnerGap,
  UploadSimple,
  TreeStructure,
  Layout,
  CaretRight
} from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { usePanel } from "@/hooks/usePanel";

export default function KnowledgeBasePage() {
  const { t } = useTranslation();
  const { setPreviewFile, setPreviewOpen } = usePanel();
  const [loading, setLoading] = useState(true);
  const [learning, setLearning] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [kbData, setKbData] = useState<any>(null);
  const [searchQuery, setSearchPlaceholder] = useState("");
  const [activeTab, setActiveTab] = useState<'explorer' | 'graph'>('explorer');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fetchKbData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/knowledge-base");
      if (res.ok) {
        const data = await res.json();
        setKbData(data);
      }
    } catch (err) {
      console.error("Failed to fetch KB data", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKbData();
  }, [fetchKbData]);

  const handleLearn = async () => {
    if (!importValue) return;
    
    // Construct the prompt for AI
    const prompt = `请充分理解并消化以下知识内容：\n\n${importValue}\n\n要求：\n1. 使用 'graphify' 工具将其写入原子知识库。\n2. 建立相关的知识图谱节点和关联关系。\n3. 提取其中的核心概念、设计动机和架构决策。\n4. 更新 'graphify-out' 目录下的报告。`;
    
    // Copy to clipboard
    try {
      await navigator.clipboard.writeText(prompt);
      alert("学习指令已复制到剪贴板！请前往对话框粘贴并发送给 AI。\n\n指令内容：\n" + prompt.slice(0, 100) + "...");
    } catch (err) {
      console.error("Failed to copy prompt", err);
    }

    setLearning(true);
    try {
      const res = await fetch("/api/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: 'learn', target: importValue }),
      });
      if (res.ok) {
        setImportValue("");
        fetchKbData();
      }
    } catch (err) {
      console.error("Failed to learn knowledge", err);
    } finally {
      setLearning(false);
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const content = await file.text();
      
      try {
        const res = await fetch("/api/knowledge-base", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: 'upload', fileName: file.name, content }),
        });
        
        if (res.ok) {
          const data = await res.json();
          setImportValue(prev => prev ? `${prev}, ${data.path}` : data.path);
        }
      } catch (err) {
        console.error("Failed to upload file", err);
      }
    }
    fetchKbData();
  };

  const filteredNodes = useMemo(() => {
    if (!kbData?.graphData?.nodes) return [];
    return kbData.graphData.nodes.filter((n: any) => {
      const matchesSearch = (n.id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            n.label?.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCategory = selectedCategory ? (n.level === selectedCategory) : true;
      return matchesSearch && matchesCategory;
    });
  }, [kbData, searchQuery, selectedCategory]);

  const categories = useMemo(() => {
    if (!kbData?.graphData?.nodes) return [];
    const counts: Record<string, number> = {};
    kbData.graphData.nodes.forEach((n: any) => {
      const type = n.level || 'EXTRACTED';
      counts[type] = (counts[type] || 0) + 1;
    });
    return Object.entries(counts).map(([label, count]) => ({ label, count }));
  }, [kbData]);

  const handleNodeClick = (node: any) => {
    if (node.path) {
      setPreviewFile(node.path);
      setPreviewOpen(true);
    } else {
      alert(`Knowledge node: ${node.label || node.id}\nNo local file path associated.`);
    }
  };

  return (
    <div 
      className={cn(
        "flex flex-col h-full bg-background overflow-hidden transition-colors duration-200",
        isDragging && "bg-primary/5"
      )}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFileUpload(e.dataTransfer.files);
      }}
    >
      {/* Header */}
      <header className="flex-shrink-0 border-b border-border/50 bg-muted/10 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <BookOpen size={24} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{t('knowledgeBase.title')}</h1>
              <p className="text-xs text-muted-foreground mt-0.5">{t('knowledgeBase.description')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-muted/20 rounded-lg p-1 border border-border/50">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setActiveTab('explorer')}
                className={cn("h-7 text-[11px] gap-1.5 px-3", activeTab === 'explorer' && "bg-background shadow-sm")}
              >
                <Layout size={14} />
                资源管理器
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setActiveTab('graph')}
                className={cn("h-7 text-[11px] gap-1.5 px-3", activeTab === 'graph' && "bg-background shadow-sm")}
              >
                <TreeStructure size={14} />
                知识图谱
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={fetchKbData} disabled={loading} className="h-9 w-9 p-0">
              <ArrowClockwise size={14} className={loading ? "animate-spin" : ""} />
            </Button>
          </div>
        </div>

        {/* Import Bar */}
        <div className="mt-6 flex gap-2">
          <div className="relative flex-1 group">
            <Plus size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <Input 
              value={importValue}
              onChange={(e) => setImportValue(e.target.value)}
              placeholder="输入文件路径、URL 或点击右侧上传按钮..."
              className="pl-10 h-10 bg-background/50 border-border/50 focus:ring-1 focus:ring-primary/30"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <input 
                type="file" 
                id="kb-file-upload" 
                multiple 
                className="hidden" 
                onChange={(e) => handleFileUpload(e.target.files)}
              />
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 px-2 text-muted-foreground hover:text-primary gap-1.5"
                onClick={() => document.getElementById('kb-file-upload')?.click()}
              >
                <UploadSimple size={14} />
                <span className="text-[10px] font-medium">上传</span>
              </Button>
            </div>
          </div>
          <Button 
            onClick={handleLearn} 
            disabled={learning || !importValue}
            className="px-6 h-10 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-all active:scale-[0.98]"
          >
            {learning ? <SpinnerGap size={16} className="animate-spin" /> : <BookOpen size={16} />}
            {learning ? "学习中..." : "开始学习"}
          </Button>
        </div>
      </header>

      {/* Content area */}
      <main className="flex-1 overflow-hidden flex divide-x divide-border/50">
        {/* Left: Content */}
        <div className="flex-1 overflow-hidden flex flex-col bg-background/50">
          {activeTab === 'explorer' ? (
            <div className="flex-1 overflow-auto p-6 space-y-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Database size={16} className="text-primary" />
                  {selectedCategory ? `分类: ${selectedCategory}` : "所有知识节点"}
                  <span className="text-[10px] font-normal text-muted-foreground ml-1">({filteredNodes.length})</span>
                </h3>
                <div className="relative w-64">
                  <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input 
                    value={searchQuery}
                    onChange={(e) => setSearchPlaceholder(e.target.value)}
                    placeholder="搜索知识点..."
                    className="pl-8 h-8 text-xs bg-muted/20 border-none focus:ring-1 focus:ring-primary/20"
                  />
                </div>
              </div>

              {!kbData?.graphData ? (
                <div className="h-[400px] rounded-2xl border border-dashed border-border/50 flex flex-col items-center justify-center text-center p-8 bg-muted/5">
                  <div className="p-4 rounded-full bg-muted/10 mb-4">
                    <Database size={40} className="text-muted-foreground/30" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">{t('knowledgeBase.noGraph')}</p>
                  <p className="text-xs text-muted-foreground/60 mt-1 max-w-[250px]">
                    导入知识并点击“学习”以构建您的原子知识图谱。
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredNodes.map((node: any, i: number) => (
                    <button 
                      key={i} 
                      onClick={() => handleNodeClick(node)}
                      className="group p-4 rounded-xl border border-border/50 bg-background hover:border-primary/30 hover:shadow-md transition-all text-left"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="p-1.5 rounded-lg bg-muted/30 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                          {node.type === 'url' ? <Globe size={14} /> : <File size={14} />}
                        </div>
                        <span className="text-[9px] font-bold text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded uppercase tracking-wider">
                          {node.level || 'EXTRACTED'}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold truncate mb-1 group-hover:text-primary transition-colors">{node.label || node.id}</h4>
                      <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed h-8">
                        {node.description || "尚无该知识点的详细描述。"}
                      </p>
                      <div className="mt-3 pt-3 border-t border-border/30 flex items-center justify-between">
                        <span className="text-[9px] text-muted-foreground font-mono truncate max-w-[150px]">
                          {node.path ? node.path.split('/').pop() : 'external'}
                        </span>
                        <CaretRight size={12} className="text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 relative bg-muted/5">
              <iframe 
                src="/api/knowledge-base?mode=graph" 
                className="w-full h-full border-0"
                title="Knowledge Graph"
              />
              <div className="absolute top-4 left-4 p-2 rounded-lg bg-background/80 backdrop-blur-md border border-border/50 shadow-sm pointer-events-none">
                <div className="flex items-center gap-2">
                  <TreeStructure size={14} className="text-primary" />
                  <span className="text-[11px] font-bold">交互式图谱</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Sidebar / Report */}
        <aside className="w-[350px] flex-shrink-0 bg-muted/10 overflow-auto p-6">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
            <File size={16} className="text-primary" />
            {t('knowledgeBase.reportTitle')}
          </h3>
          
          {kbData?.reportMd ? (
            <div className="text-[12px] text-muted-foreground whitespace-pre-wrap leading-relaxed prose prose-invert prose-sm max-w-none">
              {kbData.reportMd}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[200px] text-center opacity-40">
              <Info size={32} className="mb-2" />
              <p className="text-xs">尚无报告生成</p>
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-border/50">
            <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-4 flex items-center justify-between">
              知识分类
              {selectedCategory && (
                <button 
                  onClick={() => setSelectedCategory(null)}
                  className="text-[10px] font-normal text-primary hover:underline"
                >
                  重置
                </button>
              )}
            </h4>
            <div className="space-y-1.5">
              {categories.length === 0 ? (
                <p className="text-[10px] text-muted-foreground italic">未检测到分类。</p>
              ) : (
                categories.map((cat) => (
                  <div 
                    key={cat.label} 
                    onClick={() => setSelectedCategory(selectedCategory === cat.label ? null : cat.label)}
                    className={cn(
                      "flex items-center justify-between p-2.5 rounded-xl cursor-pointer group transition-all",
                      selectedCategory === cat.label ? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20" : "hover:bg-primary/5"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={cn(
                        "w-2 h-2 rounded-full transition-all",
                        selectedCategory === cat.label ? "bg-primary scale-110 shadow-[0_0_8px_rgba(var(--primary),0.5)]" : "bg-primary/30 group-hover:bg-primary/60"
                      )} />
                      <span className="text-[12px] font-medium truncate">{cat.label}</span>
                    </div>
                    <span className={cn(
                      "text-[10px] px-2 py-0.5 rounded-full transition-colors",
                      selectedCategory === cat.label ? "bg-primary/20 text-primary font-bold" : "bg-muted/30 text-muted-foreground"
                    )}>{cat.count}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

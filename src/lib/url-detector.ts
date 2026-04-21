import { showToast } from "@/hooks/useToast";
import { usePanelStore } from "@/store/usePanelStore";

const LOCAL_URL_REGEX = /(https?:\/\/(?:localhost|127\.0\.0\.1):\d+)/i;

export class LocalUrlDetector {
  private buffer: string = "";
  private notifiedUrls: Set<string> = new Set();
  
  public handleData(data: string) {
    // Keep the buffer size reasonable to avoid memory leaks
    this.buffer += data;
    if (this.buffer.length > 500) {
      this.buffer = this.buffer.slice(-500);
    }
    
    const match = this.buffer.match(LOCAL_URL_REGEX);
    if (match && match[1]) {
      const url = match[1];
      if (!this.notifiedUrls.has(url)) {
        this.notifiedUrls.add(url);
        this.triggerToast(url);
      }
    }
  }
  
  public reset() {
    this.buffer = "";
    this.notifiedUrls.clear();
  }

  private triggerToast(url: string) {
    // 中文注释：检测到本地服务端口后弹出提示，允许用户直接在内置浏览器中打开预览
    showToast({
      type: "info",
      message: `检测到本地服务已启动: ${url}`,
      duration: 10000,
      action: {
        label: "在内置浏览器中打开",
        onClick: () => {
          usePanelStore.getState().openBrowserTab(url, "本地预览");
        }
      }
    });
  }
}

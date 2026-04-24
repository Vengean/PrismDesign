import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  MousePointer2,
  GripVertical,
  Undo2,
  Redo2,
  Plug,
  MessageSquare,
  Layers,
  Palette,
  ListChecks,
} from "lucide-react";

import { useAgent } from "./hooks/use-agent";
import { useDesignMode } from "./hooks/use-design-mode";
import { useChanges } from "./hooks/use-changes";
import { ChatPanel } from "./components/ChatPanel";
import { Navigator } from "./components/Navigator";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { ChangesPanel } from "./components/ChangesPanel";

export function App() {
  const agent = useAgent();
  const design = useDesignMode();
  const { changes, undoCount, redoCount, undo, redo } = useChanges();

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-card">
        <span className="text-base">🔮</span>
        <span className="font-bold text-sm bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent">
          PrismDesign
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${agent.connected ? "bg-green-500" : agent.connecting ? "bg-yellow-500 animate-pulse" : "bg-red-500"}`} />
          <span className="text-[10px] text-muted-foreground">
            {agent.connected ? "已连接" : agent.connecting ? "连接中..." : "未连接"}
          </span>
        </div>
      </div>

      {/* Connection bar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b bg-muted/30">
        <Input
          className="h-7 text-xs"
          placeholder="Agent 地址"
          value={agent.agentUrl}
          onChange={(e) => agent.setAgentUrl(e.target.value)}
        />
        <Button
          size="sm"
          variant={agent.connected ? "outline" : "default"}
          className="h-7 text-xs px-2.5 shrink-0"
          onClick={() => agent.connected ? agent.disconnect() : agent.connect(agent.agentUrl)}
          disabled={agent.connecting}
        >
          <Plug className="h-3 w-3" />
          {agent.connected ? "断开" : "连接"}
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b">
        <Button
          variant={design.active ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7"
          title="选择模式 (Ctrl+E)"
          onClick={design.toggleDesignMode}
        >
          <MousePointer2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant={design.dragMode ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7"
          title="拖拽排序 (Ctrl+D)"
          onClick={design.toggleDragMode}
          disabled={!design.active}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </Button>
        <Separator orientation="vertical" className="h-4 mx-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="撤销 (Ctrl+U)"
          disabled={undoCount === 0}
          onClick={undo}
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="重做 (Ctrl+R)"
          disabled={redoCount === 0}
          onClick={redo}
        >
          <Redo2 className="h-3.5 w-3.5" />
        </Button>
        {changes.length > 0 && (
          <>
            <Separator orientation="vertical" className="h-4 mx-1" />
            <Badge variant="secondary" className="text-[10px] px-1.5 h-5">
              {changes.length} 项变更
            </Badge>
          </>
        )}
      </div>

      {/* Main content tabs */}
      <Tabs defaultValue="chat" className="flex-1 flex flex-col min-h-0">
        <TabsList className="grid grid-cols-4 mx-2 mt-1.5 h-8">
          <TabsTrigger value="chat" className="text-[11px] gap-1 h-7">
            <MessageSquare className="h-3 w-3" />
            对话
          </TabsTrigger>
          <TabsTrigger value="navigator" className="text-[11px] gap-1 h-7">
            <Layers className="h-3 w-3" />
            导航
          </TabsTrigger>
          <TabsTrigger value="properties" className="text-[11px] gap-1 h-7">
            <Palette className="h-3 w-3" />
            属性
          </TabsTrigger>
          <TabsTrigger value="changes" className="text-[11px] gap-1 h-7">
            <ListChecks className="h-3 w-3" />
            变更
            {changes.length > 0 && (
              <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[9px]">
                {changes.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex-1 m-0 min-h-0">
          <ChatPanel />
        </TabsContent>

        <TabsContent value="navigator" className="flex-1 m-0 min-h-0">
          <Navigator />
        </TabsContent>

        <TabsContent value="properties" className="flex-1 m-0 min-h-0">
          <PropertiesPanel />
        </TabsContent>

        <TabsContent value="changes" className="flex-1 m-0 min-h-0">
          <ChangesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

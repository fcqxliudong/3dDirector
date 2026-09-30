import { useEffect } from 'react';
import { bootDirectorStage } from './embed';
import { SceneViewer } from './scene/SceneViewer';
import { Sidebar } from './panels/Sidebar';
import { Timeline } from './panels/Timeline';
import { RightPanel } from './panels/RightPanel';
import { Topbar } from './panels/Topbar';
import './styles.css';

export function App() {
  useEffect(() => {
    void bootDirectorStage();
  }, []);

  return (
    <div className="app-root">
      <Topbar />
      <div className="app-body">
        <Sidebar />
        <div className="app-center">
          <SceneViewer />
          <Timeline />
        </div>
        <RightPanel />
      </div>
      <AppStyles />
    </div>
  );
}

function AppStyles() {
  // 局部样式 · 不污染全局
  return (
    <style>{`
      .app-root {
        display: grid;
        grid-template-rows: 44px 1fr;
        height: 100vh;
        background: var(--bg);
      }
      .app-body {
        display: grid;
        grid-template-columns: 240px minmax(0, 1fr) 360px;
        min-height: 0;
      }
      .app-center {
        display: grid;
        /* SceneViewer 占 1fr(自适应填满)·Timeline 用 auto(按内容撑开)
         · 关键:不再固定 180px,否则 Actor 多了轨道被挤掉
         · Timeline 内部 max-height + overflow-y 兜底防止占满全屏 */
        grid-template-rows: minmax(0, 1fr) auto;
        min-height: 0;
        min-width: 0;
      }
    `}</style>
  );
}
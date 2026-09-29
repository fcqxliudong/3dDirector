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
        grid-template-rows: 1fr 180px;
        min-height: 0;
        min-width: 0;
      }
    `}</style>
  );
}
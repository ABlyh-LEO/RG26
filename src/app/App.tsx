/**
 * 路由表。
 *
 * 使用 hash 路由：深链在 GitHub Pages 上刷新不会 404，无需服务端重写。
 * 筛选条件写入 hash 查询参数，分享后可恢复。
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { OverviewPage } from '../pages/OverviewPage';
import { SchedulePage } from '../pages/SchedulePage';
import { ProgressPage } from '../pages/ProgressPage';
import { TeamsPage } from '../pages/TeamsPage';
import { TeamDetailPage } from '../pages/TeamDetailPage';
import { MatchDetailPage } from '../pages/MatchDetailPage';
import { RulesPage } from '../pages/RulesPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/progress" element={<ProgressPage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/teams/:teamId" element={<TeamDetailPage />} />
        <Route path="/matches/:matchId" element={<MatchDetailPage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

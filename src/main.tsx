/**
 * 前端入口（观众站）。
 * 生产构建只包含观众页面；维护模式由独立的 operator.html 入口提供。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './app/App';
import { DataProvider } from './data/DataProvider';
import './styles/tokens.css';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root 挂载点');

createRoot(container).render(
  <StrictMode>
    <DataProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </DataProvider>
  </StrictMode>,
);

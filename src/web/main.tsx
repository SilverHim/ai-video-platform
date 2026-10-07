import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import './i18n';
import './styles.css';
import { router } from './app/routes';

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

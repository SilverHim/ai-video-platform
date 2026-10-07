import { createBrowserRouter } from 'react-router';
import { Layout } from './Layout';
import { SettingsPage } from '../features/settings/SettingsPage';
import { StudioPage } from '../features/studio/StudioPage';
import { HistoryPage } from '../features/history/HistoryPage';
import { LibraryPage } from '../features/library/LibraryPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <StudioPage /> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'library', element: <LibraryPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);

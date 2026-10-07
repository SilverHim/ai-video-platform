import { createBrowserRouter } from 'react-router';
import { Layout } from './Layout';
import { SettingsPage } from '../features/settings/SettingsPage';
import { StudioPage } from '../features/studio/StudioPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <StudioPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);

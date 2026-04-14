import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { StimsWorkspaceApp } from './App.tsx';

function createWorkspaceHistory() {
  if (typeof window === 'undefined') {
    return createMemoryHistory({
      initialEntries: ['/'],
    });
  }

  try {
    return createBrowserHistory();
  } catch {
    return createMemoryHistory({
      initialEntries: [
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      ],
    });
  }
}

const rootRoute = createRootRoute({
  component: StimsWorkspaceApp,
});

export const workspaceRouter = createRouter({
  routeTree: rootRoute,
  history: createWorkspaceHistory(),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof workspaceRouter;
  }
}

export function StimsWorkspaceRouterProvider() {
  return <RouterProvider router={workspaceRouter} />;
}

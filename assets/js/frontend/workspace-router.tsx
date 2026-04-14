import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { StimsWorkspaceApp } from './App.tsx';
import {
  parsePlainSearch,
  readSessionRouteStateFromSearch,
  stringifyPlainSearch,
} from './url-state.ts';

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
  validateSearch: readSessionRouteStateFromSearch,
  component: StimsWorkspaceApp,
});

export const workspaceRouter = createRouter({
  routeTree: rootRoute,
  history: createWorkspaceHistory(),
  parseSearch: parsePlainSearch,
  stringifySearch: stringifyPlainSearch,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof workspaceRouter;
  }
}

export function StimsWorkspaceRouterProvider() {
  return <RouterProvider router={workspaceRouter} />;
}

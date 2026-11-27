import { lazyRouteComponent, type RouteComponent } from '@tanstack/react-router';
import { SkeletonLines } from '../components/ui';

/**
 * A page loaded on demand: its code is downloaded the first time the route is opened (or hovered: the router
 * preloads on intent). `name` is the page's named export. After a new version is deployed, a tab opened before it
 * asks for a file that no longer exists: lazyRouteComponent reloads the page once in that case.
 */
// biome-ignore lint/suspicious/noExplicitAny: the props of a route component are given by the router
export function page<M extends Record<string, any>>(load: () => Promise<M>, name: keyof M & string): RouteComponent {
  return lazyRouteComponent(load, name) as RouteComponent;
}

/** What takes the place of a page while its code is on the way (router `defaultPendingComponent`). */
export function PagePending() {
  return <div data-page-pending className="p-6 md:p-10"><SkeletonLines rows={5} className="max-w-xl" /></div>;
}
